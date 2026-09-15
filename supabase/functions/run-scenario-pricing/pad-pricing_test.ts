import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { priceScenarioPad } from "./pad-pricing.ts";
import { priceScenarioFees } from "./fee-pricing.ts";
import { computeScenarioTotals } from "./domain.ts";
import { validateScopeSnapshot } from "../_shared/quote-scenario-domain.ts";
import { scenarioPadViolation } from "../_shared/scenario-pad-contract.ts";
import { resolveScenarioCargo, type ScenarioCargoContext } from "../_shared/scenario-cargo.ts";
const unit = (ref: string) => ({ unit_ref: ref, unit_kind: "CONTAINER", equipment_code: "20hq", packaging: "unknown", quantity: 2,
  gross_weight_kg: 15000, chargeable_weight_kg: null, volume_dm3: null, temperature_control_required: false, temperature_setpoint_celsius: null,
  classification_status: "unknown", destination_ref: null, dangerous_goods: null, required_attachment_status: "not_required", ownership: "SOC",
  un_number: null, imo_class: null, weight_basis: "per_unit", scenario_basis: "Synthetic hypothesis" });
const snapshot = () => ({ schema_version: 3, transport_mode: "MARITIME", movement_direction: "IMPORT", terminal_operation_mode: null,
  cargo_units: [unit("a"), { ...unit("b"), quantity: 3, gross_weight_kg: 10000, weight_basis: "total" }],
  pad_choices: [{ unit_ref: "a", category: "T02", basis: "Synthetic classification A" }, { unit_ref: "b", category: "T03", basis: "Synthetic classification B" }] });
const tariff = (category: string, amount: number) => ({ id: `synthetic-${category}`, provider: "PAD", category: "DROIT_PASSAGE", operation_type: "IMPORT", cargo_type: "CONTENEUR",
  classification: category, amount, unit: "tonne", currency: "XOF", source_document: "Synthetic test source", evidence_level: "official", effective_date: "2025-01-01", expiry_date: null, is_active: true });
Deno.test("v3 contract validates original, no mutation or monetary injection, strict per-group choices", () => {
  const s = snapshot(); const before = JSON.stringify(s);
  assert(validateScopeSnapshot(s).ok); assertEquals(JSON.stringify(s), before);
  for (const bad of [{ ...s, pad_choices: [] }, { ...s, pad_choices: [s.pad_choices[0], s.pad_choices[0]] },
    { ...s, pad_choices: [{ ...s.pad_choices[0], amount: 1 }, s.pad_choices[1]] },
    { ...s, transport_mode: "AIR" }, { ...s, movement_direction: "TRANSIT" },
    { ...s, unexpected: true }, { ...s, pad_choices: [{ ...s.pad_choices[0], category: "T99" }, s.pad_choices[1]] }]) assert(!validateScopeSnapshot(bad).ok);
  assertEquals(scenarioPadViolation(s), null);
});
Deno.test("v3 PAD: different categories and weight bases, one line per group, no global tariff", () => {
  const lines = priceScenarioPad(snapshot(), [tariff("T02", 100), tariff("T03", 200)], "2026-09-15");
  assertEquals(lines.map(l => l.amount), [3000, 2000]);
  assertEquals(computeScenarioTotals(lines, new Set(["scenario.cargo_units"])).firm_total_ht, 0);
  assertEquals(computeScenarioTotals(lines, new Set(["scenario.cargo_units"])).indicative_total_ht, 5000);
});
Deno.test("v3 PAD: absent/duplicate/expired/wrong unit/currency/unverified catalogs reserve only affected groups", () => {
  for (const bad of [[], [tariff("T02", 100), tariff("T02", 100)], [{ ...tariff("T02",100), expiry_date: "2020-01-01" }],
    [{ ...tariff("T02",100), effective_date: "2099-01-01" }], [{ ...tariff("T02",100), unit: "EVP" }],
    [{ ...tariff("T02",100), currency: "USD" }], [{ ...tariff("T02",100), evidence_level: "observed" }]]) {
    const lines = priceScenarioPad(snapshot(), [...bad, tariff("T03", 200)], "2026-09-15");
    assertEquals(lines.map(l => l.amount), [null, 2000]);
  }
  const unknown = snapshot(); unknown.cargo_units[0].gross_weight_kg = null as unknown as number;
  assertEquals(priceScenarioPad(unknown, [tariff("T02",100), tariff("T03",200)], "2026-09-15").map(l => l.amount), [null,2000]);
  const overflow = priceScenarioPad(snapshot(), [tariff("T02", Number.MAX_VALUE)], "2026-09-15")[0];
  assertEquals(overflow.amount, null);
  assertEquals((overflow.source as Record<string, unknown>).type, "TO_CONFIRM");
  const packages = snapshot(); packages.cargo_units[0].unit_kind = "PACKAGE";
  assertEquals(priceScenarioPad(packages, [tariff("T02",100)], "2026-09-15")[0].amount, null);
});
Deno.test("v3 fees: fixed fee once across groups; missing CAF remains unpriced; configured VAT preserved", () => {
  const cargo = { schema_version: 2, cargo_units: snapshot().cargo_units } as ScenarioCargoContext;
  const plan = resolveScenarioCargo(cargo);
  const lines = priceScenarioFees({ facts: [], cargo, containers: plan.containers, weightKg: 40000, today: "2026-09-15", requested: ["AGENCY", "AGENCY", "CUSTOMS_DAKAR"],
    lines: [{ id: "fee-a", code: "AGENCY", label_fr: "Agence", vat_applicable: false, is_active: true }, { id: "fee-c", code: "CUSTOMS_DAKAR", label_fr: "Douane", vat_applicable: true, is_active: true }],
    rules: [{ id: "rule-a", fee_line_id: "fee-a", method: "FIXED", amount: 1000, currency: "XOF", effective_from: "2025-01-01", is_active: true },
      { id: "rule-c", fee_line_id: "fee-c", method: "PERCENT_OF_VALUE", percent: 1, value_basis: "CAF", currency: "XOF", effective_from: "2025-01-01", is_active: true }] });
  assertEquals(lines.map(l => l.amount), [1000, null]);
  const totals = computeScenarioTotals(lines, new Set(["scenario.cargo_units"]));
  assertEquals(totals.indicative_total_ttc, 1000); assertEquals(totals.firm_total_ht, 0);
  const foreign = priceScenarioFees({ facts: [], cargo, containers: plan.containers, weightKg: 40000, today: "2026-09-15", requested: ["AGENCY"],
    lines: [{ id: "fee-a", code: "AGENCY", label_fr: "Agence", vat_applicable: false, is_active: true }],
    rules: [{ id: "rule-usd", fee_line_id: "fee-a", method: "FIXED", amount: 1000, currency: "USD", effective_from: "2025-01-01", is_active: true }] });
  assertEquals(foreign[0].amount, null);
  assertEquals((foreign[0].source as Record<string, unknown>).reference, "FEE_CURRENCY_UNSUPPORTED");
});
