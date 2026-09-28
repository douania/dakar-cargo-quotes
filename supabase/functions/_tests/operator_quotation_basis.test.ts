import { assert, assertEquals, assertThrows, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { operatorBasisText, readOperatorBasis } from "../_shared/operator-quotation-basis.ts";
import { validateScenarioOutputRequest } from "../adopt-operator-quotation-basis/domain.ts";
import { generateDraftPdf } from "../export-quotation-version-pdf/index.ts";
import { buildDeterministicBody } from "../create-quotation-email-draft/index.ts";
import { PDFDocument, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const basis = {
  schema_version: 1, title: "SYNTHETIC TEST — NOT FOR SENDING", revision_no: 2,
  source_run_id: "11111111-1111-4111-8111-111111111111", scope_hash: "a".repeat(64), calculated_at: "2026-09-28T12:00:00Z",
  scope: { transport_mode: "SEA", movement_direction: "IMPORT", origin: { location_code: "TEST-A" }, destination: { location_code: "TEST-B" },
    cargo_units: [{ unit_ref: "test-cargo", quantity: 2, equipment_code: "20HQ", ownership: "SOC", gross_weight_kg: 55000, weight_basis: "per_unit", dangerous_goods: null, scenario_basis: "Allocation supposée par opérateur, tare non précisée" }] },
  assumptions: [{ statement: "Distance routière supposée", assumed_value: 30, basis: "Hypothèse synthétique" }],
  overlay: [{ fact_key: "route.distance", value: 30, basis: "assumption" }],
  reservations: [{ message: "Faisabilité transport lourd réservée", code: "HEAVY", service_key: "TRUCKING", unit_ref: "test-cargo" }, { message: "Fret exclu", code: "SERVICE_EXPLICITLY_REMOVED", service_key: "SEA_FREIGHT", unit_ref: "test-cargo" }], open_points: ["Danger à préciser"],
};
const snapshot = {
  operator_basis: basis,
  meta: { version_number: 2, created_at: "2026-09-28T12:00:00Z", quoteQualification: { level: "provisional", reasons: [], firmTotalPolicy: "excludes_reserved_items" } },
  client: { company: "SYNTHETIC TEST" }, inputs: {},
  raw_lines: [{ amount: null, source: { type: "TO_CONFIRM" } }],
  lines: [{ service_code: "TEST", description: "Prestation réservée", amount: null, source: { type: "TO_CONFIRM" } }],
  totals: { total_ht: 100, total_ttc: 118, subtotal_before_sodatra_vat: 100, total_payable: 118, honoraires_tva: 18, currency: "XOF" }, sources: [],
};
Deno.test("operator bases: absence legacy, malformed presence rejected, every retained cargo detail visible", () => {
  assertEquals(readOperatorBasis(undefined), null);
  for (const invalid of [null, {}, { ...basis, scope_hash: "bad" }, { ...basis, reservations: null }]) assertThrows(() => readOperatorBasis(invalid));
  const rendered = operatorBasisText(basis).join("\n");
  for (const term of ["55000", "par unité", "inconnu", "SOC", "20HQ", "Distance routière", "30", "transport lourd", "sans confirmation préalable"]) assert(rendered.includes(term), term);
});
Deno.test("adoption request rejects browser prices, actor and malformed identifiers", () => {
  const request = { case_id: basis.source_run_id, scenario_id: basis.source_run_id, scenario_pricing_run_id: basis.source_run_id, expected_scope_hash: basis.scope_hash, idempotency_key: "synthetic-key" };
  assert(validateScenarioOutputRequest(request).ok);
  for (const key of ["amount", "tariff_lines", "actor_user_id", "qualification", "operator_basis"]) assert(!validateScenarioOutputRequest({ ...request, [key]: 1 }).ok);
  assert(!validateScenarioOutputRequest({ ...request, scenario_id: "bad" }).ok);
});
Deno.test("canonical email preserves bases and reservations and never labels assumed total firm", () => {
  const before = JSON.stringify(snapshot);
  const body = buildDeterministicBody(snapshot, 2, false, [], true, { level: "provisional", reasons: [], firmTotalPolicy: "excludes_reserved_items" });
  for (const notice of operatorBasisText(basis)) assert(body.includes(notice));
  assert(!/HT ferme|TTC ferme|confirmation.*avant/i.test(body));
  assertEquals(JSON.stringify(snapshot), before);
});

async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.create();
  const fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  const raw = new TextDecoder("latin1").decode(bytes);
  const parts: string[] = [];
  for (const m of raw.matchAll(/\/Length (\d+)[^>]*>>\s*stream\r?\n/g)) {
    const start = m.index! + m[0].length;
    try {
      const content = new TextDecoder("latin1").decode(await new Response(new Blob([bytes.slice(start, start + Number(m[1]))]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
      for (const block of content.matchAll(/BT([\s\S]*?)ET/g)) {
        const tf = block[1].match(/\/(Helvetica(?:-Bold)?)-\d+ ([\d.]+) Tf/);
        const tm = block[1].match(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/);
        const tj = block[1].match(/<([0-9A-Fa-f]*)> Tj/);
        if (!tf || !tm || !tj) continue;
        const decoded = tj[1].replace(/../g, v => String.fromCharCode(parseInt(v, 16)));
        const width = (tf[1].includes('Bold') ? fonts.bold : fonts.regular).widthOfTextAtSize(decoded, Number(tf[2]));
        if (Number(tm[1]) < 49.9 || Number(tm[1]) + width > 545.1 || Number(tm[2]) < 34) throw new Error('LAYOUT_OVERFLOW:'+decoded);
      }
      for (const h of content.matchAll(/<([0-9A-Fa-f]*)> Tj/g)) parts.push(h[1].replace(/../g, v => String.fromCharCode(parseInt(v, 16))));
    } catch (error) { if (error instanceof Error && error.message.startsWith("LAYOUT_OVERFLOW")) throw error; /* Other streams. */ }
  }
  return parts.join(" ");
}
Deno.test("canonical PDF renders multipage bases, preserves history, rejects malformed basis", async () => {
  const long = structuredClone(snapshot);
  long.operator_basis.title = "W".repeat(190);
  long.operator_basis.scope.cargo_units[0].scenario_basis = "W".repeat(490);
  long.operator_basis.reservations = [...basis.reservations, ...Array.from({ length: 80 }, (_, i) => ({ message: `Réserve synthétique numéro ${i}, hors montant indiqué, à réviser selon les informations ultérieures.`, code: "TEST", service_key: "TEST", unit_ref: "test-cargo" }))];
  const before = JSON.stringify(long);
  const bytes = await generateDraftPdf(long, "SYNTHETIC");
  assert((await PDFDocument.load(bytes)).getPageCount() >= 3);
  const rendered = await pdfText(bytes);
  for (const term of ["55000", "SOC", "20HQ", "BASES RETENUES", "79", "TRUCKING", "SEA_FREIGHT", "118 XOF"]) assert(rendered.includes(term), term);
  assert(!/TOTAL HT FERME/i.test(rendered));
  assertEquals(JSON.stringify(long), before);
  await assertRejects(() => generateDraftPdf({ ...snapshot, operator_basis: {} }, "SYNTHETIC"));
  const output = Deno.env.get("OPERATOR_BASIS_PDF_FIXTURE");
  if (output) await Deno.writeFile(output, await generateDraftPdf(snapshot, "SYNTHETIC"));
});
