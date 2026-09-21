import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildDemurrageComparison, demurrageReferenceExample, demurrageComparisonText, readDemurrageComparison, type DemurrageComparisonInput } from "./demurrage-reference-information.ts";
import { readStayInformation, unknownCarrierStayInformation, stayInformationText } from "./stay-information.ts";

const input = (): DemurrageComparisonInput => ({ carrier: null, equipment: "40HC", unit: {
  unit_kind: "CONTAINER", ownership: "COC", quantity: 3, dangerous_goods: null, temperature_control_required: false,
}, movement_direction: "IMPORT", destination_country: "SN", discharge_port: "Dakar Port", terminal_mode: null, is_transit: false, as_of: "2026-09-21" });

Deno.test("reference comparison: identified schedules, exact native rates, dates and conditional scope", () => {
  const request = input(); const before = JSON.stringify(request);
  const c = buildDemurrageComparison(request)!;
  assertEquals(c.references.map(r => [r.carrier, r.effective_date, r.free_days, r.currency, r.tiers.map(t => t.rate)]), [
    ["CMA CGM", "2025-01-01", 10, "XOF", [38050, 45920]], ["Hapag-Lloyd", "2024-05-01", 10, "EUR", [54, 64]],
  ]);
  assertEquals(c.consulted_on, "2026-09-21");
  const text = demurrageComparisonText(c);
  for (const content of ["Danger du lot inconnu", "pas une fourchette de tout le marché", "Non ajouté au total", "HYPOTHÉTIQUE", "magasinage", "détention", "BCEAO"]) assert(text.toLowerCase().includes(content.toLowerCase()));
  assertEquals(JSON.stringify(request), before);
  assertEquals(buildDemurrageComparison({ ...input(), equipment: "20DV" })!.references.map(r => r.tiers.map(t => t.rate)), [[17715, 22960], [27, 33]]);
});
Deno.test("reference examples: franchise boundaries, second tier, aggregate EUR conversion and no mutation", () => {
  const c = buildDemurrageComparison(input())!; const before = JSON.stringify(c);
  for (const [days, cma, hapag] of [[10, 0, 0], [11, 114150, 106265], [15, 570750, 531325], [20, 1141500, 1062650], [21, 1279260, 1188594], [25, 1830300, 1692369]]) {
    assertEquals(c.references.map(r => demurrageReferenceExample(r, 3, days).xof_amount), [cma, hapag]);
  }
  assertEquals(demurrageReferenceExample(c.references[1], 3, 15).native_amount, 810);
  assertEquals(JSON.stringify(c), before);
});
Deno.test("reference comparison: no carrier fallback, no SOC, no DG/special/reefer/out-of-scope application", () => {
  for (const changes of [{ carrier: "MSC" }, { carrier: "CMA CGM" }, { is_transit: true }, { movement_direction: "EXPORT" }, { destination_country: "ML" },
    { discharge_port: "Abidjan" }, { terminal_mode: "RORO" }, { terminal_mode: "CONRO" }, { as_of: "2026-09-20" }, { as_of: "bad" },
    { equipment: "20HQ" }, { equipment: "40RF" }, { equipment: "40OT" }, { equipment: null }]) assertEquals(buildDemurrageComparison({ ...input(), ...changes }), null);
  for (const changes of [{ ownership: "SOC" }, { ownership: null }, { unit_kind: "BREAKBULK" }, { quantity: 0 }, { quantity: 1.5 }, { quantity: 1000001 },
    { dangerous_goods: true }, { dangerous_goods: undefined }, { un_number: "3536" }, { imo_class: "9" }, { temperature_control_required: true }, { temperature_control_required: null }]) {
    assertEquals(buildDemurrageComparison({ ...input(), unit: { ...input().unit, ...changes } }), null);
  }
});
Deno.test("reference comparison: metadata parser rejects malformed additions, preserves native snapshot", () => {
  const info = unknownCarrierStayInformation(input())!;
  assertEquals(info.free_days, null); assertEquals(info.example, null); assertEquals(info.tiers, []);
  assertEquals(readStayInformation(info), info); assert(stayInformationText(info).includes("531"));
  const c = info.carrier_comparison!;
  for (const bad of [null, {}, { ...c, quantity: -1 }, { ...c, references: [null] }, { ...c, references: [c.references[0], c.references[0]] },
    { ...c, references: [{ ...c.references[0], source_url: "javascript:alert(1)" }, c.references[1]] },
    { ...c, references: [{ ...c.references[0], tiers: [null, null] }, c.references[1]] },
    { ...c, quantity: 1000000, references: [c.references[0], { ...c.references[1], tiers: c.references[1].tiers.map(t => ({ ...t, rate: 1000000 })) }] },
    { ...c, references: [c.references[0], { ...c.references[1], xof_per_currency: 1 }] }]) {
    assertEquals(readDemurrageComparison(bad), null);
    assertEquals(readStayInformation({ ...info, carrier_comparison: bad }), null);
  }
});
