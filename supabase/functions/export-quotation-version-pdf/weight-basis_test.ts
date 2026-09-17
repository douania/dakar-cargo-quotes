import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { generateDraftPdf } from "./index.ts";
export const fixture = {
  meta: { version_number: 1, created_at: "2026-09-17T00:00:00Z", quoteQualification: { level: "firm", reasons: [] } },
  client: { company: "SYNTHETIC TEST — NOT FOR SENDING" }, inputs: { containers: [] },
  raw_lines: [{ quantity: 45, source: { unit_ref: "pieces", weight_basis: "provisional", weight_container_count: 3, weight_per_container_kg: 15000,
    weight_reservation: "Cotation établie sur 15 tonnes par conteneur de pièces détachées. Prestations dépendant du poids révisables selon documents définitifs et conditions tarifaires applicables." } }],
  lines: [{ service_code: "PAD", description: "Passage portuaire - base indicative", quantity: 45, unit_price: 100, amount: 4500, currency: "XOF" }],
  totals: { total_ht: 4500, total_ttc: 4500, currency: "XOF" }, sources: [],
};
Deno.test("PDF renders immutable provisional weight snapshot without mutating it", async () => {
  const before = JSON.stringify(fixture);
  const bytes = await generateDraftPdf(fixture, "SYNTHETIC");
  assertEquals((await PDFDocument.load(bytes)).getPageCount() > 0, true);
  assertEquals(JSON.stringify(fixture), before);
  const path = Deno.env.get("PAD_WEIGHT_PDF_FIXTURE");
  if (path) await Deno.writeFile(path, bytes);
});
