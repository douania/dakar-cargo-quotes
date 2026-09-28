import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PDFDocument, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";
import { generateDraftPdf, wrapToWidth } from "./index.ts";

// PDF layout (GO CTO 2026-09-28): the qualified lot subtotal overflowed the right edge of the page
// (text started at the Tarif column). Every drawn text is now measured with the real font and must
// stay between the two margins; the subtotal is right-aligned, wrapped if needed, kept on one page.

const PAGE_W = 595;
const MARGIN = 50;

interface Drawn { page: number; bold: boolean; size: number; x: number; y: number; text: string; width: number }

/** Every text drawn by pdf-lib (BT … Tf … Tm … <hex> Tj … ET), with its real width. */
async function drawnTexts(bytes: Uint8Array): Promise<Drawn[]> {
  const measureDoc = await PDFDocument.create();
  const regular = await measureDoc.embedFont(StandardFonts.Helvetica);
  const bold = await measureDoc.embedFont(StandardFonts.HelveticaBold);
  const raw = new TextDecoder("latin1").decode(bytes);
  const out: Drawn[] = [];
  let page = 0;
  for (const m of raw.matchAll(/\/Length (\d+)[^>]*>>\s*stream\r?\n/g)) {
    const start = m.index! + m[0].length;
    let content: string;
    try {
      content = new TextDecoder("latin1").decode(await new Response(
        new Blob([bytes.slice(start, start + Number(m[1]))]).stream().pipeThrough(new DecompressionStream("deflate")),
      ).arrayBuffer());
    } catch { continue; }
    if (!content.includes(" Tj")) continue;
    page++;
    for (const block of content.matchAll(/BT([\s\S]*?)ET/g)) {
      const tf = block[1].match(/\/(Helvetica(?:-Bold)?)-\d+ ([\d.]+) Tf/);
      const tm = block[1].match(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/);
      const tj = block[1].match(/<([0-9A-Fa-f]*)> Tj/);
      if (!tf || !tm || !tj) continue;
      const text = tj[1].replace(/../g, (h) => String.fromCharCode(parseInt(h, 16)));
      const isBold = tf[1] === "Helvetica-Bold";
      const size = Number(tf[2]);
      out.push({ page, bold: isBold, size, x: Number(tm[1]), y: Number(tm[2]), text,
        width: (isBold ? bold : regular).widthOfTextAtSize(text, size) });
    }
  }
  return out;
}

function assertWithinMargins(texts: Drawn[]) {
  for (const t of texts) {
    assert(t.x >= MARGIN - 0.01, `left margin crossed: ${JSON.stringify(t)}`);
    assert(t.x + t.width <= PAGE_W - MARGIN + 0.01, `right margin crossed: ${JSON.stringify(t)}`);
  }
}

const line = (category: string, amount: number, toConfirm = false) => ({
  service_code: "LINE", category, description: category.toLowerCase(), quantity: 1, unit_price: amount, amount,
  source: { type: toConfirm ? "TO_CONFIRM" : "fee_rule" },
});
const lot = (i: number, lines: unknown[], ht: number) => ({ lot_index: i, label: `Lot ${i}`, lines, totals: { ht, ttc: ht, currency: "XOF" } });
const snapshot = (lots: unknown[], extra: Record<string, unknown> = {}) => ({
  meta: { version_number: 1, created_at: "2026-09-28T00:00:00Z", quoteQualification: { level: "provisional", reasons: [{ code: "RATE_PENDING_CONFIRMATION", message: "x" }], firmTotalPolicy: "excludes_reserved_items" } },
  client: { company: "SYNTHETIC TEST — NOT FOR SENDING" }, inputs: {}, raw_lines: [], lines: [],
  totals: { total_ht: 1, total_ttc: 1, currency: "XOF" }, sources: [], is_multi_lot: true, lots, ...extra,
});
const subtotals = (texts: Drawn[]) => texts.filter((t) => t.text.startsWith("Sous-total hors") || t.text.startsWith("Sous-total:"));

Deno.test("wrapToWidth: real-width wrapping, amount and currency kept whole, nothing dropped", () => {
  const measure = (s: string) => s.length * 6;
  const text = "Sous-total hors 12 postes a confirmer : 123 456 789 XOF";
  const keep = "123 456 789 XOF";
  assertEquals(wrapToWidth(text, measure, 1000, keep), [text]);
  const narrow = wrapToWidth(text, measure, 120, keep);
  assert(narrow.length > 1);
  assertEquals(narrow.at(-1)!.endsWith(keep), true);
  assert(narrow.every((l) => measure(l) <= 120 || l === keep), JSON.stringify(narrow));
  assertEquals(narrow.join(" "), text);
  // A token wider than the limit keeps its own line instead of being cut.
  assertEquals(wrapToWidth("a " + keep, measure, 30, keep), ["a", keep]);
});

Deno.test("multi-lot: incomplete, complete and long-amount subtotals are right-aligned inside both margins", async () => {
  const texts = await drawnTexts(await generateDraftPdf(snapshot([
    lot(1, [line("AGENCY", 200000), line("SEA_FREIGHT", 0, true), line("TRUCKING", 0, true), line("DTHC", 0, true)], 1148568),
    lot(2, [line("AGENCY", 200000)], 200000),
    lot(3, Array.from({ length: 12 }, (_, i) => line(`CAT_${i}`, 0, true)).concat([line("AGENCY", 123456789012)]), 123456789012),
  ]), "SYNTHETIC"));
  assertWithinMargins(texts);
  const sub = subtotals(texts);
  assertEquals(sub.map((t) => t.text), [
    "Sous-total hors 3 postes a confirmer : 1 148 568 XOF",
    "Sous-total: 200 000 XOF",
    "Sous-total hors 12 postes a confirmer : 123 456 789 012 XOF",
  ]);
  for (const t of sub) assert(Math.abs(t.x + t.width - (PAGE_W - MARGIN)) < 0.5, `not right-aligned: ${JSON.stringify(t)}`);
});

Deno.test("a subtotal near the page bottom moves whole to the next page, above the page number", async () => {
  let movedToNextPage = 0;
  let lastOnFirstPage = 0;
  for (let n = 20; n <= 34; n++) {
    const texts = await drawnTexts(await generateDraftPdf(snapshot([
      lot(1, Array.from({ length: n }, (_, i) => line(`CAT_${i}`, 1000 + i, i % 2 === 0)), 50000),
      lot(2, [line("AGENCY", 200000)], 200000),
    ]), "SYNTHETIC"));
    assertWithinMargins(texts);
    const sub = subtotals(texts);
    assertEquals(sub.length, 2);
    const lastRow = texts.filter((t) => t.text.startsWith("cat_")).at(-1)!;
    if (sub[0].page > lastRow.page) movedToNextPage++;
    if (sub[0].page === 1 && sub[0].y < 90) lastOnFirstPage++;
    for (const t of sub) {
      const pageNumber = texts.find((p) => p.page === t.page && p.text.startsWith("Page "));
      assert(t.y > (pageNumber?.y ?? MARGIN - 15) + 10, `subtotal over the page number (n=${n}): ${JSON.stringify(t)}`);
      assert(t.y >= MARGIN, `subtotal under the bottom margin (n=${n}): ${JSON.stringify(t)}`);
    }
  }
  // Both situations were exercised: last slot at the bottom of page 1, and a forced move to page 2.
  assert(lastOnFirstPage >= 1 && movedToNextPage >= 1, JSON.stringify({ lastOnFirstPage, movedToNextPage }));
});

Deno.test("mono-lot PDF stays inside both margins", async () => {
  const texts = await drawnTexts(await generateDraftPdf(snapshot([], {
    is_multi_lot: false, lots: undefined,
    lines: [{ ...line("AGENCY", 200000), service_code: "LINE_1" }, { ...line("SEA_FREIGHT", 0, true), service_code: "LINE_2" }, { ...line("EMPTY_RETURN", 0), service_code: "DTHC" }],
  }), "SYNTHETIC"));
  assertWithinMargins(texts);
  assert(texts.some((t) => t.text === "AGENCY"));
});
