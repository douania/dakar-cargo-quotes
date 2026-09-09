import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  deriveShipmentProfile,
  type FeeCaseContext,
  type FeeLineRow,
  type FeeRuleRow,
  inventoryContainers,
  resolveFeeLine,
  resolveFeeLines,
} from "./fee-rules.ts";

const TODAY = "2026-09-09";

const LINE_AGENCY: FeeLineRow = { id: "L-AG", code: "AGENCY", label_fr: "Frais d'agence", display_order: 10 };
const LINE_CUSTOMS: FeeLineRow = { id: "L-CD", code: "CUSTOMS_DAKAR", label_fr: "Honoraires de dédouanement", display_order: 20 };
const LINE_DG: FeeLineRow = { id: "L-DG", code: "SUPPL_DG", label_fr: "Supplément marchandise dangereuse", missing_rule_behavior: "SKIP", display_order: 30 };

let seq = 0;
function rule(over: Partial<FeeRuleRow> & Pick<FeeRuleRow, "fee_line_id" | "method">): FeeRuleRow {
  seq += 1;
  return { id: `R${seq}`, effective_from: "2026-09-04", is_active: true, currency: "XOF", ...over };
}

/** Amorçage H2-a : deux forfaits import. */
const SEED: FeeRuleRow[] = [
  rule({ id: "seed-agency", fee_line_id: "L-AG", label: "Forfait provisoire import", direction: "IMPORT", method: "FIXED", amount: 200000 }),
  rule({ id: "seed-customs", fee_line_id: "L-CD", label: "Forfait provisoire import", direction: "IMPORT", method: "FIXED", amount: "350000" }),
];

/** Dossier Cogoport : 50 x 20GP, 1 400 t, DAP import, ni CAF ni client ni fait DG. */
const COGOPORT: FeeCaseContext = {
  transportMode: "SEA",
  direction: "IMPORT",
  shipmentType: "FCL",
  customsRegimeCode: null,
  containers: [{ type: "20GP", quantity: 50 }],
  dangerousGoods: null,
  weightKg: 1_400_000,
  cafValue: null,
  cargoValue: null,
  clientCode: null,
  asOfDate: TODAY,
};

Deno.test("H2-b: the seeded forfaits price the Cogoport case exactly like HONORAIRES-1", () => {
  const out = resolveFeeLines([LINE_CUSTOMS, LINE_AGENCY], SEED, COGOPORT);
  assertEquals(out.map((r) => r.lineCode), ["AGENCY", "CUSTOMS_DAKAR"], "ordre d'affichage");
  assertEquals(out.map((r) => [r.status, r.amount, r.ruleId]), [
    ["RESOLVED", 200000, "seed-agency"],
    ["RESOLVED", 350000, "seed-customs"],
  ]);
  assertEquals(out[0].vatApplicable, true);
  assertEquals(out[0].message, "Frais d'agence : 200 000 XOF.");
  assertEquals(out[0].detail, "forfait 200 000 XOF = 200 000 XOF");
});

Deno.test("H2-b: an export case has no import rule — expected line is TO_CONFIRM, never 0", () => {
  const r = resolveFeeLine(LINE_AGENCY, SEED, { ...COGOPORT, direction: "EXPORT" });
  assertEquals(r.status, "TO_CONFIRM");
  assertEquals(r.reason, "NO_APPLICABLE_RULE");
  assertEquals(r.amount, null);
});

Deno.test("H2-b: a direction unknown on the case cannot be matched — TO_CONFIRM naming the missing fact", () => {
  const r = resolveFeeLine(LINE_AGENCY, SEED, { ...COGOPORT, direction: null });
  assertEquals(r.status, "TO_CONFIRM");
  assertEquals(r.reason, "CONDITION_UNKNOWN");
  assert(r.message.includes("sens (import / export / transit)"), r.message);
});

Deno.test("H2-b: a dangerous-goods supplement is TO_CONFIRM while the DG fact is missing, SKIPPED when false, priced when true", () => {
  const rules = [rule({ fee_line_id: "L-DG", dangerous_goods: true, method: "PER_CONTAINER", amount_20: 50000, amount_40: 50000 })];
  const missing = resolveFeeLine(LINE_DG, rules, COGOPORT);
  assertEquals([missing.status, missing.reason], ["TO_CONFIRM", "CONDITION_UNKNOWN"]);
  assert(missing.message.includes("marchandise dangereuse (oui / non)"), missing.message);

  const no = resolveFeeLine(LINE_DG, rules, { ...COGOPORT, dangerousGoods: false });
  assertEquals([no.status, no.amount], ["SKIPPED", null]);

  const yes = resolveFeeLine(LINE_DG, rules, { ...COGOPORT, dangerousGoods: true });
  assertEquals([yes.status, yes.amount], ["RESOLVED", 2_500_000]);
  assertEquals(yes.detail, "50 x 20' à 50 000 XOF + 0 x 40' à 50 000 XOF = 2 500 000 XOF");
});

const LCL_GRID: FeeRuleRow[] = [
  rule({ id: "cd-generic-closed", fee_line_id: "L-CD", direction: "IMPORT", method: "FIXED", amount: 350000, effective_from: "2026-09-04", effective_to: "2026-09-08" }),
  rule({ id: "cd-lcl-1", fee_line_id: "L-CD", label: "Groupage 0-1 t", direction: "IMPORT", shipment_type: "LCL", weight_min_kg: 0, weight_max_kg: 1000, method: "FIXED", amount: 75000 }),
  rule({ id: "cd-lcl-2", fee_line_id: "L-CD", label: "Groupage 1-5 t", direction: "IMPORT", shipment_type: "LCL", weight_min_kg: 1000, weight_max_kg: 5000, method: "FIXED", amount: 150000 }),
  rule({ id: "cd-lcl-3", fee_line_id: "L-CD", label: "Groupage 5 t et plus", direction: "IMPORT", shipment_type: "LCL", weight_min_kg: 5000, method: "PER_TONNE", amount: 25000, min_amount: 150000 }),
  rule({ id: "cd-fcl", fee_line_id: "L-CD", label: "Conteneur complet", direction: "IMPORT", shipment_type: "FCL", method: "PER_CONTAINER", amount_20: 35000, amount_40: 50000 }),
];
const LCL = (weightKg: number | null): FeeCaseContext => ({ ...COGOPORT, shipmentType: "LCL", containers: [], weightKg });

Deno.test("H2-b: LCL weight tranches [min, max) — one cell per case, upper bound exclusive, tonne entamée", () => {
  assertEquals(resolveFeeLine(LINE_CUSTOMS, LCL_GRID, LCL(800)).amount, 75000);
  assertEquals(resolveFeeLine(LINE_CUSTOMS, LCL_GRID, LCL(999.99)).amount, 75000);
  assertEquals(resolveFeeLine(LINE_CUSTOMS, LCL_GRID, LCL(1000)).amount, 150000, "1 000 kg tombe dans la tranche suivante");
  assertEquals(resolveFeeLine(LINE_CUSTOMS, LCL_GRID, LCL(4999)).amount, 150000);
  const five = resolveFeeLine(LINE_CUSTOMS, LCL_GRID, LCL(5000));
  assertEquals(five.amount, 150000, "5 t x 25 000 = 125 000 relevé au minimum 150 000");
  assert(five.detail?.includes("minimum 150 000 XOF appliqué"), five.detail ?? "");
  const twelve = resolveFeeLine(LINE_CUSTOMS, LCL_GRID, LCL(12300));
  assertEquals(twelve.amount, 325000, "13 tonnes entamées x 25 000");
  assertEquals(twelve.ruleLabel, "Groupage 5 t et plus");
});

Deno.test("H2-b: a weight-tranche grid without a known weight is TO_CONFIRM naming the weight", () => {
  const r = resolveFeeLine(LINE_CUSTOMS, LCL_GRID, LCL(null));
  assertEquals([r.status, r.reason], ["TO_CONFIRM", "CONDITION_UNKNOWN"]);
  assert(r.message.includes("poids"), r.message);
});

Deno.test("H2-b: a closed generic rule no longer applies; the FCL per-container cell prices the Cogoport case", () => {
  const r = resolveFeeLine(LINE_CUSTOMS, LCL_GRID, COGOPORT);
  assertEquals([r.status, r.ruleId, r.amount], ["RESOLVED", "cd-fcl", 50 * 35000]);
  // Au 6 septembre la règle générique était encore en vigueur : elle et la
  // cellule FCL visent le même dossier → conflit, jamais un choix silencieux
  // (en base, le trigger H2-a aurait refusé cette cellule tant que le générique
  // n'était pas clôturé ; le fixture contourne volontairement ce garde-fou).
  const before = resolveFeeLine(LINE_CUSTOMS, LCL_GRID, { ...COGOPORT, asOfDate: "2026-09-06" });
  assertEquals([before.status, before.reason, before.amount], ["TO_CONFIRM", "CONFLICTING_RULES", null]);
});

Deno.test("H2-b: per-container counts 20' and 40'/45' separately, family restriction counts only matching boxes", () => {
  const mixed = rule({ fee_line_id: "L-AG", method: "PER_CONTAINER", amount_20: 35000, amount_40: 50000 });
  const ctx = { ...COGOPORT, containers: [{ type: "20GP", quantity: 10 }, { type: "40HC", quantity: 5 }, { type: "45HC", quantity: 1 }] };
  const r = resolveFeeLine(LINE_AGENCY, [mixed], ctx);
  assertEquals(r.amount, 10 * 35000 + 6 * 50000);

  const reefer = rule({ fee_line_id: "L-AG", container_family: "REEFER", method: "PER_CONTAINER", amount_20: 80000, amount_40: 120000 });
  const withReefers = { ...COGOPORT, containers: [{ type: "40GP", quantity: 40 }, { type: "40RF", quantity: 10 }] };
  const rr = resolveFeeLine(LINE_AGENCY, [reefer], withReefers);
  assertEquals(rr.amount, 10 * 120000, "seuls les 10 frigos comptent");
  assert(rr.detail?.includes("(famille REEFER)"), rr.detail ?? "");

  const noReefer = resolveFeeLine(LINE_AGENCY, [reefer], COGOPORT);
  assertEquals([noReefer.status, noReefer.reason], ["TO_CONFIRM", "NO_APPLICABLE_RULE"], "pas de frigo → la règle frigo ne vise pas le dossier");
});

Deno.test("H2-b: per-container without containers or with an unknown type is TO_CONFIRM", () => {
  const pc = rule({ fee_line_id: "L-AG", method: "PER_CONTAINER", amount_20: 1, amount_40: 2 });
  assertEquals(resolveFeeLine(LINE_AGENCY, [pc], { ...COGOPORT, containers: [] }).reason, "CONTAINERS_MISSING");
  assertEquals(resolveFeeLine(LINE_AGENCY, [pc], { ...COGOPORT, containers: [{ type: "20TK", quantity: 1 }] }).reason, "CONTAINER_TYPE_UNSUPPORTED");
  assertEquals(resolveFeeLine(LINE_AGENCY, [pc], { ...COGOPORT, containers: [{ type: "20GP", quantity: 2.5 }] }).reason, "CONTAINER_TYPE_UNSUPPORTED");
});

Deno.test("H2-b: percentage of CAF with min and max; missing basis is TO_CONFIRM, never 0", () => {
  const pct = rule({ fee_line_id: "L-CD", direction: "IMPORT", method: "PERCENT_OF_VALUE", percent: 0.4, value_basis: "CAF", min_amount: 75000, max_amount: 500000 });
  const at = (cafValue: number | null) => resolveFeeLine(LINE_CUSTOMS, [pct], { ...COGOPORT, cafValue });
  assertEquals(at(50_000_000).amount, 200000);
  assertEquals(at(10_000_000).amount, 75000, "40 000 relevé au minimum");
  assertEquals(at(200_000_000).amount, 500000, "800 000 plafonné");
  const missing = at(null);
  assertEquals([missing.status, missing.reason, missing.amount], ["TO_CONFIRM", "VALUE_BASIS_MISSING", null]);
  assert(missing.message.includes("jamais 0"), missing.message);

  const onCargo = rule({ fee_line_id: "L-CD", direction: "IMPORT", method: "PERCENT_OF_VALUE", percent: 1, value_basis: "CARGO_VALUE" });
  assertEquals(resolveFeeLine(LINE_CUSTOMS, [onCargo], { ...COGOPORT, cargoValue: 1_000_001 }).amount, 10000, "arrondi au franc");
});

Deno.test("H2-b: a client rule beats the generic one for that client only; another client gets the generic rule", () => {
  const rules = [
    ...SEED,
    rule({ id: "ag-ai0", fee_line_id: "L-AG", label: "Négocié AI0CARGO", direction: "IMPORT", client_code: "AI0CARGO", method: "PERCENT_OF_VALUE", percent: 0.25, value_basis: "CAF", min_amount: 100000 }),
  ];
  const ai0 = resolveFeeLine(LINE_AGENCY, rules, { ...COGOPORT, clientCode: "ai0cargo", cafValue: 60_000_000 });
  assertEquals([ai0.ruleId, ai0.amount, ai0.clientSpecific], ["ag-ai0", 150000, true]);
  assert(ai0.message.includes("règle client AI0CARGO"), ai0.message);

  const other = resolveFeeLine(LINE_AGENCY, rules, { ...COGOPORT, clientCode: "AKSA_ENERGY", cafValue: 60_000_000 });
  assertEquals([other.ruleId, other.amount, other.clientSpecific], ["seed-agency", 200000, false]);

  const anonymous = resolveFeeLine(LINE_AGENCY, rules, { ...COGOPORT, cafValue: 60_000_000 });
  assertEquals(anonymous.ruleId, "seed-agency", "sans code client, aucune règle client n'est visible");

  // La règle client s'applique mais sa donnée manque : pas de repli silencieux sur le générique.
  const ai0NoCaf = resolveFeeLine(LINE_AGENCY, rules, { ...COGOPORT, clientCode: "AI0CARGO" });
  assertEquals([ai0NoCaf.status, ai0NoCaf.reason, ai0NoCaf.ruleId], ["TO_CONFIRM", "VALUE_BASIS_MISSING", "ag-ai0"]);
});

Deno.test("H2-b: a client rule that does not match falls through to the generic scope", () => {
  const rules = [...SEED, rule({ fee_line_id: "L-AG", direction: "EXPORT", client_code: "AI0CARGO", method: "FIXED", amount: 1 })];
  const r = resolveFeeLine(LINE_AGENCY, rules, { ...COGOPORT, clientCode: "AI0CARGO" });
  assertEquals([r.ruleId, r.amount], ["seed-agency", 200000]);
});

Deno.test("H2-b: two certain rules in the same scope are a conflict, never a silent pick", () => {
  const rules = [...SEED, rule({ id: "dup", fee_line_id: "L-AG", label: "Doublon", direction: "IMPORT", shipment_type: "FCL", method: "FIXED", amount: 999 })];
  const r = resolveFeeLine(LINE_AGENCY, rules, COGOPORT);
  assertEquals([r.status, r.reason, r.amount], ["TO_CONFIRM", "CONFLICTING_RULES", null]);
  assert(r.message.includes("Doublon") && r.message.includes("Forfait provisoire import"), r.message);
});

Deno.test("H2-b: validity window and activity flags are honoured; an invalid evaluation date resolves nothing", () => {
  const future = rule({ fee_line_id: "L-AG", direction: "IMPORT", method: "FIXED", amount: 1, effective_from: "2026-10-01" });
  assertEquals(resolveFeeLine(LINE_AGENCY, [future], COGOPORT).reason, "NO_APPLICABLE_RULE");
  assertEquals(resolveFeeLine(LINE_AGENCY, [future], { ...COGOPORT, asOfDate: "2026-10-01" }).amount, 1);
  const inactive = rule({ fee_line_id: "L-AG", direction: "IMPORT", method: "FIXED", amount: 1, is_active: false });
  assertEquals(resolveFeeLine(LINE_AGENCY, [inactive], COGOPORT).reason, "NO_APPLICABLE_RULE");
  const badDate = resolveFeeLine(LINE_AGENCY, SEED, { ...COGOPORT, asOfDate: "hier" });
  assertEquals(badDate.reason, "NO_APPLICABLE_RULE");
  assert(badDate.message.includes("date d'évaluation invalide"), badDate.message);
  assertEquals(resolveFeeLines([{ ...LINE_AGENCY, is_active: false }], SEED, COGOPORT), [], "ligne inactive ignorée");
});

Deno.test("H2-b: an invalid rule row never prices", () => {
  const broken = rule({ fee_line_id: "L-AG", direction: "IMPORT", method: "FIXED" });
  assertEquals(resolveFeeLine(LINE_AGENCY, [broken], COGOPORT).reason, "RULE_INVALID");
  const unknownMethod = rule({ fee_line_id: "L-AG", direction: "IMPORT", method: "PER_KG", amount: 1 });
  assertEquals(resolveFeeLine(LINE_AGENCY, [unknownMethod], COGOPORT).reason, "RULE_INVALID");
});

Deno.test("H2-b: container inventory groups by family and size", () => {
  const inv = inventoryContainers([{ type: "20' Dry", quantity: 3 }, { type: "40HC", quantity: 2 }, { type: "40RF", quantity: 1 }, { type: "20OT", quantity: 1 }]);
  assertEquals(inv.status, "OK");
  assertEquals(inv.byFamily, { DRY: { c20: 3, c40: 2 }, REEFER: { c20: 0, c40: 1 }, SPECIAL: { c20: 1, c40: 0 } });
  assertEquals([...inv.families].sort(), ["DRY", "REEFER", "SPECIAL"]);
  assertEquals(inventoryContainers([]).status, "EMPTY");
  assertEquals(inventoryContainers(null).status, "EMPTY");
});

Deno.test("H2-b: shipment profile is derived from canonical request types and packages, never guessed", () => {
  assertEquals(deriveShipmentProfile("SEA_FCL_IMPORT", "DAP_PROJECT_IMPORT"), { transportMode: "SEA", direction: "IMPORT", shipmentType: "FCL" });
  assertEquals(deriveShipmentProfile("SEA_LCL_IMPORT", "LCL_IMPORT_DAP"), { transportMode: "SEA", direction: "IMPORT", shipmentType: "LCL" });
  assertEquals(deriveShipmentProfile("SEA_BREAKBULK_IMPORT", "BREAKBULK_PROJECT"), { transportMode: "SEA", direction: "IMPORT", shipmentType: "BREAKBULK" });
  assertEquals(deriveShipmentProfile("AIR_IMPORT_DAP", "AIR_IMPORT_DAP"), { transportMode: "AIR", direction: "IMPORT", shipmentType: "AIR" });
  assertEquals(deriveShipmentProfile("ROAD_IMPORT", null), { transportMode: "ROAD", direction: "IMPORT", shipmentType: null });
  assertEquals(deriveShipmentProfile(null, "TRANSIT_GAMBIA_ALL_IN"), { transportMode: "SEA", direction: "TRANSIT", shipmentType: "FCL" });
  assertEquals(deriveShipmentProfile(null, "EXPORT_SENEGAL"), { transportMode: "SEA", direction: "EXPORT", shipmentType: null });
  assertEquals(deriveShipmentProfile("n'importe quoi", 42), { transportMode: null, direction: null, shipmentType: null });
});
