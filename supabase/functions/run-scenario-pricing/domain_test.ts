import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildScenarioCargoPricing, classifyScenarioDanger, type PricingFactRow } from "./domain.ts";

// Synthetic legacy (v1) scenario units; no client data.
const unit = (kind: string, dangerous = false) => ({ unit_ref: `lot-${kind.toLowerCase()}`, unit_kind: kind,
  equipment_code: kind === "CONTAINER" ? "40hc" : null, quantity: 1, packaging: "unknown", gross_weight_kg: 1000,
  chargeable_weight_kg: null, volume_dm3: null, temperature_control_required: false, temperature_setpoint_celsius: null,
  classification_status: "unknown", destination_ref: null, required_attachment_status: "not_required", dangerous_goods: dangerous });
const fact = (fact_key: string, value_text: string): PricingFactRow => ({ id: `synthetic-${fact_key}-${value_text}`, fact_key, value_text });
const v1 = (kind: string, mode = "MARITIME", dangerous = false) =>
  ({ schema_version: 1, transport_mode: mode, movement_direction: "IMPORT", terminal_operation_mode: null, cargo_units: [unit(kind, dangerous)] });
const dgBlockers = (snapshot: Record<string, unknown>, facts: PricingFactRow[]) =>
  buildScenarioCargoPricing({}, snapshot, facts).blockers.filter(b => b.includes("_DG_"));

Deno.test("scenario danger: explicit states are distinguished, absence is never 'not dangerous'", () => {
  assertEquals(classifyScenarioDanger([], [unit("PACKAGE")]), "NONE");
  assertEquals(classifyScenarioDanger([fact("cargo.dangerous_goods", "NO")], []), "NOT_DANGEROUS");
  assertEquals(classifyScenarioDanger([fact("cargo.dangerous_goods", "non")], []), "NOT_DANGEROUS");
  assertEquals(classifyScenarioDanger([fact("cargo.dangerous_goods", "YES")], []), "DANGEROUS");
  assertEquals(classifyScenarioDanger([fact("cargo.un_number", "UN3480")], []), "DANGEROUS");
  assertEquals(classifyScenarioDanger([fact("cargo.imo_class", "9")], []), "DANGEROUS");
  assertEquals(classifyScenarioDanger([], [unit("PACKAGE", true)]), "DANGEROUS");
  assertEquals(classifyScenarioDanger([fact("pricing.dthc_family", "dangerous")], []), "DANGEROUS");
  assertEquals(classifyScenarioDanger([fact("pricing.dthc_family", "DRY")], []), "NONE");
  assertEquals(classifyScenarioDanger([fact("cargo.dangerous_goods", "NO"), fact("pricing.dthc_family", "DANGEROUS")], []), "CONTRADICTORY");
  assertEquals(classifyScenarioDanger([{ id: "synthetic-json", fact_key: "cargo.dangerous_goods", value_json: false }], []), "NOT_DANGEROUS");
  assertEquals(classifyScenarioDanger([{ id: "synthetic-json", fact_key: "cargo.dangerous_goods", value_json: "NO" }], []), "UNKNOWN");
  assertEquals(classifyScenarioDanger([fact("cargo.dangerous_goods", "à vérifier")], []), "UNKNOWN");
  assertEquals(classifyScenarioDanger([fact("cargo.un_number", "")], []), "UNKNOWN");
  assertEquals(classifyScenarioDanger([fact("cargo.dangerous_goods", "NO"), fact("cargo.un_number", "UN3480")], []), "CONTRADICTORY");
  assertEquals(classifyScenarioDanger([fact("cargo.dangerous_goods", "NO"), fact("cargo.dangerous_goods", "YES")], []), "CONTRADICTORY");
  assertEquals(classifyScenarioDanger([fact("cargo.dangerous_goods", "NO")], [unit("PACKAGE", true)]), "CONTRADICTORY");
});

for (const [label, kind] of [["non-containerized PACKAGE", "PACKAGE"], ["BREAKBULK", "BREAKBULK"], ["CONTAINER", "CONTAINER"]] as const) {
  Deno.test(`scenario legacy ${label}: explicit NO is no longer a false danger blocker`, () => {
    assertEquals(dgBlockers(v1(kind), [fact("cargo.dangerous_goods", "NO")]), []);
    assertEquals(dgBlockers(v1(kind), []), []);
  });
}

for (const [label, facts, dangerousUnit] of [
  ["YES", [fact("cargo.dangerous_goods", "YES")], false],
  ["ONU number", [fact("cargo.un_number", "UN3480")], false],
  ["unknown value", [fact("cargo.dangerous_goods", "inconnu")], false],
  ["contradictory NO + ONU", [fact("cargo.dangerous_goods", "NO"), fact("cargo.un_number", "UN3480")], false],
  ["scenario lot declared dangerous", [], true],
] as const) {
  Deno.test(`scenario legacy danger stays blocking (${label}) with a remedy matching the cargo`, () => {
    // Non-containerized: no impossible v2 container revision is suggested.
    assertEquals(dgBlockers(v1("PACKAGE", "MARITIME", dangerousUnit), [...facts]), ["SCENARIO_DG_NON_CONTAINER_UNSUPPORTED"]);
    assertEquals(dgBlockers(v1("BREAKBULK", "MARITIME", dangerousUnit), [...facts]), ["SCENARIO_DG_NON_CONTAINER_UNSUPPORTED"]);
    // Containerized: the v2 per-lot revision remains the documented remedy.
    assertEquals(dgBlockers(v1("CONTAINER", "MARITIME", dangerousUnit), [...facts]), ["SCENARIO_DG_FACTS_UNSCOPED"]);
    // AIR never migrates to the maritime contract.
    assertEquals(dgBlockers(v1("PACKAGE", "AIR", dangerousUnit), [...facts]), ["SCENARIO_DG_FACTS_UNSCOPED_AIR"]);
  });
}

Deno.test("scenario v2 PACKAGE keeps the explicit container-contract limit", () => {
  const snapshot = { schema_version: 2, transport_mode: "MARITIME", movement_direction: "IMPORT", terminal_operation_mode: null,
    cargo_units: [{ ...unit("PACKAGE"), dangerous_goods: false, un_number: null, imo_class: null, ownership: "SOC",
      weight_basis: "per_unit", scenario_basis: "Synthetic operator assumption" }] };
  const result = buildScenarioCargoPricing({}, snapshot, [fact("cargo.dangerous_goods", "NO")]);
  assert(result.blockers.includes("SCENARIO_CONTAINER_TYPE_REQUIRED:lot-package"));
});
