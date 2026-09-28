import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { aiBodyKeepsLotQualification, buildDeterministicBody, buildLotSummaries } from "./index.ts";

// Presentation of incomplete multi-lot quotes (GO CTO 2026-09-28): a lot amount that excludes
// lines to confirm is qualified on its own line; a complete lot keeps its plain label.
const known = { service_code: "LINE", description: "Frais d'agence", amount: 200000, source: { type: "fee_rule" } };
const unknown = { service_code: "LINE", description: "Fret maritime", amount: 0, source: { type: "TO_CONFIRM", reference: "P5:no_match" } };
const unknown2 = { service_code: "LINE", description: "Pré-acheminement", amount: 0, source: "to_confirm+note" };
const trueZero = { service_code: "LINE", description: "Retour conteneur vide", amount: 0, source: { type: "business_rule" } };
const totals = (ht: number) => ({ ht, ttc: ht, currency: "XOF", subtotal_before_sodatra_vat: ht, total_payable: ht, honoraires_tva: 0 });
const lots = [
  { lot_index: 1, label: "Lot A", lines: [known, trueZero], totals: totals(200000) },
  { lot_index: 2, label: "Lot B", lines: [known, unknown, unknown2, trueZero], totals: totals(200000) },
];
const firm = { level: "firm" as const, reasons: [], firmTotalPolicy: "all_included" as const };
const provisional = { level: "provisional" as const, reasons: [{ code: "RATE_PENDING_CONFIRMATION", message: "x" }], firmTotalPolicy: "excludes_reserved_items" as const };

Deno.test("incomplete lot is qualified individually; complete lot and genuine zero keep the plain label", () => {
  const [a, b] = buildLotSummaries(lots);
  assertEquals(a.pending, 0);
  assert(a.line.startsWith("  - Lot A: ") && a.line.endsWith(" XOF à payer"), a.line);
  assert(!/partiel|confirmer/.test(a.line));
  assertEquals(b.pending, 2);
  assert(b.line.endsWith(" XOF à payer, partiel (hors 2 postes à confirmer)"), b.line);
  const one = buildLotSummaries([{ ...lots[1], lines: [known, unknown] }])[0];
  assert(one.line.endsWith(", partiel (hors 1 poste à confirmer)"), one.line);
});

Deno.test("existing snapshots: lot lines without source and HT-only totals keep the historical wording", () => {
  const legacy = [{ lot_index: 1, label: "Lot 1", lines: [{ service_code: "LINE", amount: 0 }], totals: { ht: 1000, currency: "XOF" } },
    { lot_index: 2, lines: undefined, totals: { total_ht: 2000 } }];
  const [a, b] = buildLotSummaries(legacy);
  assert(a.line.startsWith("  - Lot 1: ") && a.line.endsWith(" XOF HT"), a.line);
  assert(b.line.startsWith("  - Lot 2: ") && b.line.endsWith(" XOF HT"), b.line);
  assertEquals([a.pending, b.pending], [0, 0]);
});

Deno.test("deterministic body carries each lot line, qualified or plain", () => {
  const summaries = buildLotSummaries(lots);
  const snapshot = { totals: { total_ht: 400000, total_ttc: 400000, currency: "XOF" }, raw_lines: [{ source: { type: "TO_CONFIRM" } }] };
  const body = buildDeterministicBody(snapshot, 1, true, summaries.map((s) => s.line), false, provisional);
  for (const s of summaries) assert(body.includes(s.line), s.line);
  const complete = buildLotSummaries([lots[0], { ...lots[0], lot_index: 2, label: "Lot C" }]);
  const firmBody = buildDeterministicBody({ totals: { total_ht: 400000, currency: "XOF" } }, 1, true, complete.map((s) => s.line), false, firm);
  assert(!/partiel \(hors/.test(firmBody));
});

Deno.test("AI enrichment is kept only if every qualified lot line survives verbatim", () => {
  const summaries = buildLotSummaries(lots);
  const faithful = `Bonjour,\n${summaries.map((s) => s.line.trim()).join("\n")}\nDevis provisoire.\nCordialement,`;
  assert(aiBodyKeepsLotQualification(faithful, summaries));
  const lost = faithful.replace(", partiel (hors 2 postes à confirmer)", "");
  assert(!aiBodyKeepsLotQualification(lost, summaries));
  // A complete lot reworded by the AI does not block enrichment.
  assert(aiBodyKeepsLotQualification("Bonjour, Lot A reformulé. " + summaries[1].line.trim(), summaries));
  assert(aiBodyKeepsLotQualification("Bonjour", buildLotSummaries([lots[0]])));
});

Deno.test("handler wires the lot guard and falls back to the deterministic body", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(source.includes("aiBodyKeepsLotQualification(sanitized, lotSummaries)"));
  assert(source.includes("lotSummaries = buildLotSummaries(snapData.lots)"));
});
