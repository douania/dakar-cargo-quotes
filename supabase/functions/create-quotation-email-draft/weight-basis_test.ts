import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildDeterministicBody } from "./index.ts";
Deno.test("global retained weight is reserved even when every category weight was confirmed", () => {
  const snapshot = { totals: { total_ht: 4500, currency: "XOF" }, raw_lines: [{ quantity: 45, source: {
    weight_basis: "confirmed", weight_reconciliation: { id: "synthetic", total_weight_kg: 2424000, reservation: "Révisable sur documents définitifs." },
  } }] };
  const body = buildDeterministicBody(snapshot, 1, false, [], true, { level: "firm", reasons: [], firmTotalPolicy: "all_included" });
  assert(body.includes("2424 tonnes")); assert(body.includes("Révisable sur documents définitifs.")); assert(!body.includes("HT ferme"));
});
Deno.test("reserved weight never produces a firm total and preserves all exact weight notices", async () => {
  const snapshot = { totals: { total_ht: 4500, currency: "XOF" }, raw_lines: [
    { quantity: 45, source: { unit_ref: "pieces", weight_basis: "provisional", weight_container_count: 3, weight_per_container_kg: 15000, weight_reservation: "Révisable sur documents définitifs." } },
    { source: "TO_CONFIRM" },
  ] };
  for (const level of ["firm", "partial", "provisional"] as const) {
    const body = buildDeterministicBody(snapshot, 1, false, [], true, { level, reasons: [], firmTotalPolicy: "excludes_reserved_items" });
    assert(!body.includes("HT ferme")); assert(!body.includes("ferme (hors"));
    assert(body.includes("3 conteneurs × 15 tonnes/conteneur = 45 tonnes"));
    assert(body.includes("Révisable sur documents définitifs."));
  }
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assertEquals(source.includes('if (useAiEnrichment && quotationWeightNotices('), true);
});
