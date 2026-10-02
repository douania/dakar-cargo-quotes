import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateDraftPdf, lineServiceLabel } from "./index.ts";

// Presentation of incomplete multi-lot quotes (GO CTO 2026-09-28): the service column of a lot
// line shows business information already in the snapshot instead of the generic "LINE".

/** Text drawn by pdf-lib (hex strings shown with Tj), in drawing order. */
async function pdfTexts(bytes: Uint8Array): Promise<string[]> {
  const raw = new TextDecoder("latin1").decode(bytes);
  const out: string[] = [];
  for (const m of raw.matchAll(/\/Length (\d+)[^>]*>>\s*stream\r?\n/g)) {
    const start = m.index! + m[0].length;
    const chunk = bytes.slice(start, start + Number(m[1]));
    let text: string;
    try {
      text = new TextDecoder("latin1").decode(
        await new Response(new Blob([chunk]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer(),
      );
    } catch { continue; }
    for (const t of text.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      out.push(t[1].replace(/../g, (h) => String.fromCharCode(parseInt(h, 16))));
    }
  }
  return out;
}

Deno.test("lot line service label: generic code replaced by snapshot information, never invented", () => {
  assertEquals(lineServiceLabel({ service_code: "LINE", category: "Transport" }), "Transport");
  assertEquals(lineServiceLabel({ service_code: "LINE_12", category: "PICKUP_ORIGIN" }), "PICKUP_ORIGIN");
  assertEquals(lineServiceLabel({ service_code: "PAD", category: "PAD_DROIT_PASSAGE" }), "PAD");
  // Historical lot lines (before category was stored): canonical service key, else empty.
  assertEquals(lineServiceLabel({ service_code: "LINE", canonical: { service_key: "DTHC" } }), "DTHC");
  assertEquals(lineServiceLabel({ service_code: "LINE", canonical: null }), "");
  assertEquals(lineServiceLabel({}), "");
});

const lot = (i: number, lines: unknown[], ht: number) => ({ lot_index: i, label: `Lot ${i}`, lines, totals: { ht, ttc: ht, currency: "XOF" } });
const known = { service_code: "LINE", category: "AGENCY", description: "Frais d'agence", quantity: 1, unit_price: 200000, amount: 200000, source: { type: "fee_rule" } };
const unknown = { service_code: "LINE", category: "SEA_FREIGHT", description: "Fret maritime", quantity: 1, unit_price: 0, amount: 0, source: { type: "TO_CONFIRM" } };
const trueZero = { service_code: "LINE", category: "EMPTY_RETURN", description: "Retour conteneur vide", quantity: 1, unit_price: 0, amount: 0, source: { type: "business_rule" } };
const legacyLine = { service_code: "LINE", description: "Honoraires", quantity: 1, unit_price: 350000, amount: 350000, source: null, canonical: null };
const multiLot = {
  meta: { version_number: 1, created_at: "2026-09-28T00:00:00Z", quoteQualification: { level: "provisional", reasons: [{ code: "RATE_PENDING_CONFIRMATION", message: "x" }], firmTotalPolicy: "excludes_reserved_items" } },
  client: { company: "SYNTHETIC TEST — NOT FOR SENDING" }, inputs: {},
  raw_lines: [known, unknown, trueZero], lines: [],
  totals: { total_ht: 550000, total_ttc: 550000, currency: "XOF" }, sources: [],
  is_multi_lot: true, lots: [lot(1, [known, trueZero], 200000), lot(2, [unknown, legacyLine], 350000)],
};

Deno.test("multi-lot PDF: business service labels, unknown vs genuine zero, qualified subtotal, snapshot untouched", async () => {
  const before = JSON.stringify(multiLot);
  const texts = await pdfTexts(await generateDraftPdf(multiLot, "SYNTHETIC"));
  assertEquals(JSON.stringify(multiLot), before);
  assert(!texts.includes("LINE"), "generic LINE still rendered");
  for (const label of ["AGENCY", "EMPTY_RETURN", "SEA_FREIGHT"]) assert(texts.includes(label), label);
  const i = texts.indexOf("SEA_FREIGHT");
  assertEquals(texts.slice(i, i + 5), ["SEA_FREIGHT", "Fret maritime", "1", "-", "À confirmer"]);
  const z = texts.indexOf("EMPTY_RETURN");
  assertEquals(texts.slice(z + 3, z + 5), ["0", "0"]);
  assert(texts.some((t) => t.startsWith("Sous-total hors 1 poste a confirmer")), texts.join(" | "));
  assert(texts.some((t) => t.startsWith("Sous-total: ")));
});

Deno.test("mono-lot PDF: generic LINE_n replaced, real codes kept, unknown vs genuine zero, snapshot untouched", async () => {
  const mono = { ...multiLot, is_multi_lot: false, lots: undefined, raw_lines: [known, unknown, trueZero],
    lines: [{ ...known, service_code: "LINE_1" }, { ...unknown, service_code: "LINE_2" }, { ...trueZero, service_code: "DTHC" },
      { ...legacyLine, service_code: "LINE_4" }, { ...legacyLine, service_code: "LINE_5", category: null, canonical: { service_key: "CUSTOMS_DAKAR" } }] };
  const before = JSON.stringify(mono);
  const texts = await pdfTexts(await generateDraftPdf(mono, "SYNTHETIC"));
  assertEquals(JSON.stringify(mono), before);
  assert(!texts.some((t) => /^LINE(_\d+)?$/.test(t)), texts.join(" | "));
  for (const label of ["AGENCY", "SEA_FREIGHT", "DTHC", "CUSTOMS_DAKAR"]) assert(texts.includes(label), label);
  const i = texts.indexOf("SEA_FREIGHT");
  assertEquals(texts.slice(i, i + 5), ["SEA_FREIGHT", "Fret maritime", "1", "-", "À confirmer"]);
  const z = texts.indexOf("DTHC");
  assertEquals(texts.slice(z + 3, z + 5), ["0", "0"]);
  // A zero without a recorded meaning is never presented as free: the client projection says so under the line.
  assertEquals(texts[z + 5], "Montant nul : signification a verifier");
  // A line with neither category nor canonical key (older snapshot) keeps an empty cell: its description follows the previous line.
  const h = texts.indexOf("Honoraires");
  assertEquals(texts[h - 1], "Montant nul : signification a verifier");
});
