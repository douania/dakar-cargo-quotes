import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateDraftPdf } from "./index.ts";
import { buildPricingCargoBasis } from "../_shared/quotation-cargo-basis.ts";

async function pdfText(bytes: Uint8Array): Promise<string> {
  const raw = new TextDecoder("latin1").decode(bytes), out: string[] = [];
  for (const m of raw.matchAll(/\/Length (\d+)\s*>>\s*stream\r?\n/g)) {
    const start = m.index! + m[0].length;
    try {
      const decoded = new TextDecoder("latin1").decode(await new Response(new Blob([bytes.slice(start, start + Number(m[1]))]).stream()
        .pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
      for (const t of decoded.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(t[1].replace(/../g, h => String.fromCharCode(parseInt(h, 16))));
    } catch { /* non-content streams */ }
  }
  return out.join(" ").replace(/\s+/g, " ");
}
const snapshot = (run: unknown) => ({ meta: { version_number: 2, created_at: "2026-10-08T00:00:00Z", quoteQualification: { level: "firm", reasons: [] } },
  client: { company: "SYNTHETIC TEST" }, inputs: { containers: [{ type: "20GP", quantity: 1 }], cargo_weight: 36, cargo_basis: buildPricingCargoBasis(run) },
  lines: [], raw_lines: [], totals: { total_ht: 4500, total_ttc: 4500, currency: "XOF" }, sources: [] });

Deno.test("canonical PDF takes per-lot kg and quantities from its own immutable run basis", async () => {
  const snap = snapshot({ id: "run-v2", engine_request: { mode: "multi_lot", lots: [
    { lot_index: 2, params: { cargoWeight: 12, containers: [{ type: "20DV", quantity: 1 }] } },
    { lot_index: 1, params: { cargoWeight: 45, containers: [{ type: "40HC", quantity: 3 }] } },
  ] }, outputs_json: { multi_lot: true, lots: [{ lot_index: 1, label: "Lot A" }, { lot_index: 2, label: "Lot B" }] } });
  const before = JSON.stringify(snap), text = await pdfText(await generateDraftPdf(snap, "SYNTHETIC"));
  for (const expected of ["45 000 kg", "12 000 kg", "3 × 40HC", "1 × 20DV"]) assertStringIncludes(text, expected);
  assertEquals(text.includes("20GP"), false); assertEquals(text.includes("57 000 kg"), false);
  assertEquals(JSON.stringify(snap), before);
});
Deno.test("mono-lot PDF retains the named tonne contract as kg without changing totals", async () => {
  const snap = snapshot({ id: "mono", engine_request: { cargoWeight: 36, containers: [{ type: "40HC", quantity: 2 }] } });
  const text = await pdfText(await generateDraftPdf(snap, "SYNTHETIC"));
  assertStringIncludes(text, "36 000 kg"); assertStringIncludes(text, "2 × 40HC"); assertStringIncludes(text, "4 500 XOF");
  assertEquals(snap.totals.total_ht, 4500);
});
Deno.test("PDF explicitly displays unknown or contradictory units rather than inheriting legacy globals", async () => {
  const unknown = await pdfText(await generateDraftPdf(snapshot({ engine_request: { cargo_weight: 45 } }), "SYNTHETIC"));
  assertStringIncludes(unknown, "45 (unite non precisee)"); assertEquals(unknown.includes("45 000 kg"), false);
  const conflict = await pdfText(await generateDraftPdf(snapshot({ engine_request: { cargoWeight: 45, cargoWeightUnit: "kg" } }), "SYNTHETIC"));
  assertStringIncludes(conflict, "valeurs ou unites contradictoires"); assertEquals(conflict.includes("36 ("), false);
});
