import { readAirCrossTradeBasis, airCrossTradeClientBases } from "./air-cross-trade-snapshot.ts";
import { assert, assertEquals, assertThrows, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluateAirCrossTrade, classifyAirCrossTrade, retainAirCrossTradePlan, airCrossTradeFingerprint,
  type AirCrossTradeRequest, type AirPlanRevision, type AirRateSource, type AirFxSource } from "./air-cross-trade.ts";
import { prepareCommercialQuote, reviseCommercialPreparation } from "./commercial-preparation.ts";
import { composeCommercialSnapshot } from "./commercial-snapshot.ts";
import { projectClientQuote } from "./client-quote-projection.ts";
import { generateDraftPdf } from "../export-quotation-version-pdf/index.ts";

// Entirely fictitious data; arbitrary amounts exercise arithmetic, not approved tariffs.
const evidence = <T>(value: T, key: string) => ({ value, fact_id: `fact-${key}`, source_id: "synthetic-mail", status: "explicit" as const });
function fixture() {
  const request: AirCrossTradeRequest = {
    case_id: "synthetic-air-case", mode: evidence("AIR", "mode"), origin_country: evidence("KE", "origin"),
    destination_country: evidence("NL", "destination"), arrival_airport: evidence("AMS", "arrival"),
    cargo_description: evidence("Synthetic laboratory test sample", "description"),
    quantities: { gross_kg: evidence(12, "gross"), pieces: evidence(2, "pieces") },
    facts: [{ id: "fact-gross", fact_key: "cargo.weight_kg", value_number: 12, source_type: "email", source_email_id: "synthetic-mail", is_current: true },
      { id: "fact-extra", fact_key: "cargo.synthetic_condition", value_text: "documented", source_type: "manual", is_current: true }],
    requested_services: ["PICKUP_ORIGIN", "PRE_CARRIAGE", "AIR_FREIGHT"], requested_services_evidence: "synthetic-mail:pickup-and-delivery",
    cargo_acceptance_required: true,
  };
  for (const [key, e] of Object.entries({ "routing.transport_mode": request.mode, "routing.origin_country": request.origin_country,
    "routing.destination_country": request.destination_country, "routing.destination_airport": request.arrival_airport,
    "cargo.description": request.cargo_description, "cargo.pieces_count": request.quantities.pieces })) {
    if (e) request.facts.push({ id: e.fact_id, fact_key: key, value_text: typeof e.value === "string" ? e.value : null,
      value_number: typeof e.value === "number" ? e.value : null, source_type: "email", source_email_id: e.source_id, is_current: true });
  }
  const sources: AirRateSource[] = [
    { id: "source-pickup", service_key: "PICKUP_ORIGIN", fingerprint: "pickup-v1", currency: "XOF", unit: "forfait", value: 1100,
      min_charge: null, effective_from: "2026-01-01", effective_to: null, origin_country: "KE", destination_country: "KE",
      origin_airport: null, destination_airport: null, required_fact_keys: [], reference: "SYNTHETIC PURCHASE PICKUP", included_services: [{ service_key: "PRE_CARRIAGE", origin_country: "KE", destination_country: "KE", origin_airport: null, destination_airport: "NBO", reference: "SYNTHETIC INCLUDED AIRPORT TRANSFER" }] },
    { id: "source-air", service_key: "AIR_FREIGHT", fingerprint: "air-v1", currency: "EUR", unit: "kg", value: 4,
      min_charge: 60, effective_from: "2026-01-01", effective_to: "2026-12-31", origin_country: "KE", destination_country: "NL",
      origin_airport: "NBO", destination_airport: "AMS", required_fact_keys: [], reference: "SYNTHETIC PURCHASE AIR", included_services: [] },
  ];
  const fx: AirFxSource[] = [{ id: "fx-eur", fingerprint: "fx-v1", currency_code: "EUR", rate_to_xof: 600,
    valid_from: "2026-01-01", valid_until: "2026-12-31", source: "SYNTHETIC FX FOR TEST ONLY" }];
  const retained: AirPlanRevision = { id: "plan-v1", revision: 1, actor_id: "operator-a", case_id: request.case_id, context_fingerprint: "ctx-v1",
    plan: { route: { departure_airport: "NBO", departure_country: "KE", arrival_airport: "AMS", arrival_country: "NL",
      pre_carriage: "retained", routing_reference: "SYNTHETIC OPERATOR ROUTING", acceptance_reference: "SYNTHETIC CARRIER ACCEPTANCE" },
    services: [
      { service_key: "PICKUP_ORIGIN", disposition: "priced", reason: "Synthetic pickup decision", source_id: "source-pickup", source_fingerprint: "pickup-v1",
        source_role: "purchase", coverage: "pickup", applicability_reference: "SYNTHETIC APPLICABILITY", client_sale: { amount_xof: 2000, basis: "taxes_included", reason: "Synthetic sale distinct from supplier" } },
      { service_key: "PRE_CARRIAGE", disposition: "included", included_in: "PICKUP_ORIGIN", reason: "Synthetic source includes airport transfer" },
      { service_key: "AIR_FREIGHT", disposition: "priced", reason: "Synthetic air decision", source_id: "source-air", source_fingerprint: "air-v1",
        source_role: "purchase", coverage: "air_leg", weight_basis: "gross_kg", applicability_reference: "Synthetic source explicitly bills gross kg",
        fx_id: "fx-eur", fx_fingerprint: "fx-v1", client_sale: { amount_xof: 40000, basis: "taxes_included", reason: "Synthetic client sale decision" } },
    ] } };
  return { request, retained, sources, fx, as_of: "2026-10-30", context_fingerprint: "ctx-v1" };
}
const evaluate = (mutate?: (f: ReturnType<typeof fixture>) => void) => { const f = fixture(); mutate?.(f); return evaluateAirCrossTrade(f); };
const has = (r: ReturnType<typeof evaluate>, key: string) => r.needs.some(n => n.key === key);

Deno.test("cross-trade: complete positive route prices services without import fees or assumed DSS", () => {
  const f = fixture(), before = JSON.stringify(f), result = evaluateAirCrossTrade(f);
  assertEquals(result.classification, "eligible"); assertEquals(result.ready_to_price, true); assertEquals(result.needs, []);
  assertEquals(result.pricing!.total_ttc, 42000); assertEquals(result.pricing!.tariff_lines.length, 2);
  assertEquals(result.pricing!.tariff_sources[1].native_amount, 60); assertEquals(result.pricing!.tariff_sources[1].source_amount_xof, 36000);
  assertEquals(result.pricing!.tariff_lines[1].amount, 40000); assertEquals(result.pricing!.outputs_json.quoteQualification.level, "provisional");
  const saved = JSON.stringify(result.pricing); for (const forbidden of ["CUSTOMS_DAKAR", "DPI", "PORT_DAKAR", '"DSS"']) assertEquals(saved.includes(forbidden), false);
  assertEquals(JSON.stringify(f), before); assertEquals(result.pricing!.facts_snapshot, f.request.facts);
});
for (const [name, change, expected] of [
  ["sea unchanged", (f: ReturnType<typeof fixture>) => { f.request.mode = evidence("SEA", "mode"); }, "not_applicable"],
  ["SN import unchanged", (f: ReturnType<typeof fixture>) => { f.request.destination_country = evidence("SN", "destination"); }, "not_applicable"],
  ["SN export unchanged", (f: ReturnType<typeof fixture>) => { f.request.origin_country = evidence("SN", "origin"); }, "not_applicable"],
  ["domestic not cross-trade", (f: ReturnType<typeof fixture>) => { f.request.destination_country = evidence("KE", "destination"); }, "not_applicable"],
  ["assumed country not selected", (f: ReturnType<typeof fixture>) => { f.request.origin_country!.status = "assumed"; }, "undetermined"],
  ["missing country not import fallback", (f: ReturnType<typeof fixture>) => { f.request.destination_country = null; }, "undetermined"],
] as const) Deno.test(`cross-trade classification: ${name}`, () => { const f = fixture(); change(f); assertEquals(classifyAirCrossTrade(f.request), expected); assertEquals(evaluateAirCrossTrade(f).ready_to_price, false); });

for (const [name, change, key] of [
  ["route arrival conflict", (f: ReturnType<typeof fixture>) => { f.retained.plan.route.arrival_airport = "CDG"; }, "routing.arrival_conflict"],
  ["route unselected", (f: ReturnType<typeof fixture>) => { f.retained.plan.route.departure_airport = ""; }, "routing.plan"],
  ["acceptance unknown internal", (f: ReturnType<typeof fixture>) => { f.retained.plan.route.acceptance_reference = null; }, "cargo.acceptance"],
  ["stale plan", (f: ReturnType<typeof fixture>) => { f.context_fingerprint = "ctx-v2"; }, "service.plan"],
  ["missing service", (f: ReturnType<typeof fixture>) => { f.retained.plan.services.pop(); }, "service.coverage"],
  ["inclusion cycle", (f: ReturnType<typeof fixture>) => { f.retained.plan.services[1].included_in = "PRE_CARRIAGE"; }, "service.inclusion"],
  ["excluded requested service is partial", (f: ReturnType<typeof fixture>) => { f.retained.plan.services[1].disposition = "excluded"; }, "service.excluded_requested"],
  ["missing source", (f: ReturnType<typeof fixture>) => { f.sources.pop(); }, "tariff.source"],
  ["source stale", (f: ReturnType<typeof fixture>) => { f.sources[1].fingerprint = "air-v2"; }, "tariff.source"],
  ["wrong source country", (f: ReturnType<typeof fixture>) => { f.sources[1].destination_country = "SN"; }, "tariff.applicability"],
  ["wrong source airport", (f: ReturnType<typeof fixture>) => { f.sources[1].origin_airport = "DSS"; }, "tariff.applicability"],
  ["expired source", (f: ReturnType<typeof fixture>) => { f.sources[1].effective_to = "2026-10-29"; }, "tariff.applicability"],
  ["unknown weight basis", (f: ReturnType<typeof fixture>) => { delete f.retained.plan.services[2].weight_basis; }, "tariff.quantity_basis"],
  ["chargeable not gross", (f: ReturnType<typeof fixture>) => { f.retained.plan.services[2].weight_basis = "chargeable_kg"; }, "cargo.chargeable_kg"],
  ["assumed weight", (f: ReturnType<typeof fixture>) => { f.request.quantities.gross_kg!.status = "assumed"; }, "cargo.gross_kg"],
  ["missing FX", (f: ReturnType<typeof fixture>) => { f.fx = []; }, "tariff.fx"],
  ["stale FX", (f: ReturnType<typeof fixture>) => { f.fx[0].fingerprint = "fx-v2"; }, "tariff.fx"],
  ["expired FX", (f: ReturnType<typeof fixture>) => { f.fx[0].valid_until = "2026-10-29"; }, "tariff.fx"],
  ["supplier cost not client price", (f: ReturnType<typeof fixture>) => { delete f.retained.plan.services[2].client_sale; }, "commercial.sale"],
  ["source condition not blanket documents", (f: ReturnType<typeof fixture>) => { f.sources[1].required_fact_keys = ["cargo.packaging_type"]; }, "cargo.packaging_type"],
] as const) Deno.test(`cross-trade needs: ${name}`, () => { const r = evaluate(change); assert(has(r, key)); assertEquals(r.ready_to_price, false); assertEquals(r.pricing, null); });

Deno.test("cross-trade: no blanket weight/dimensions/packing-list/invoice requirement for a sourced forfait", () => {
  const r = evaluate(f => { f.sources[1].unit = "forfait"; delete f.retained.plan.services[2].weight_basis; f.request.quantities = {}; });
  assertEquals(r.ready_to_price, true); assertEquals(r.needs, []);
});
Deno.test("cross-trade: foreign departure needs pre-carriage but is not a Senegal import", () => {
  const r = evaluate(f => { f.retained.plan.route.departure_airport = "EBB"; f.retained.plan.route.departure_country = "UG";
    f.sources[1].origin_country = "UG"; f.sources[1].origin_airport = "EBB";
    f.sources[0].included_services[0] = { service_key: "PRE_CARRIAGE", origin_country: "KE", destination_country: "UG", origin_airport: null, destination_airport: "EBB", reference: "SYNTHETIC CROSS BORDER TRANSFER INCLUDED" }; });
  assertEquals(r.ready_to_price, true); assertEquals(r.request_type, "AIR_CROSS_TRADE");
  assertEquals(evaluate(f => { f.retained.plan.route.departure_country = "UG"; f.retained.plan.route.pre_carriage = "none"; }).ready_to_price, false);
});
Deno.test("cross-trade: explicit zero sale and fee tax use existing commercial totals", () => {
  const r = evaluate(f => { f.retained.plan.services[0].client_sale!.amount_xof = 0; f.retained.plan.services[2].client_sale = { amount_xof: 10000, basis: "before_sodatra_vat", reason: "Synthetic explicit fee" }; });
  assertEquals(r.pricing!.total_ht, 10000); assertEquals(r.pricing!.total_ttc, 11800);
});
Deno.test("cross-trade: required null/empty fact is not fulfilled by a row name", () => {
  const r = evaluate(f => { f.sources[1].required_fact_keys = ["cargo.synthetic_condition"]; f.request.facts[1].value_text = ""; });
  assert(has(r, "cargo.synthetic_condition"));
});
Deno.test("cross-trade: duplicate source, service or malformed numeric cannot manufacture a successful quote", () => {
  assertEquals(evaluate(f => f.sources.push(structuredClone(f.sources[1]))).ready_to_price, false);
  assertThrows(() => evaluate(f => f.retained.plan.services.push(structuredClone(f.retained.plan.services[0]))));
  for (const n of [-1, NaN, Infinity, 1e20]) assertThrows(() => evaluate(f => { f.sources[0].value = n; }));
});
Deno.test("cross-trade: quantities remain kg and one cargo; forfait source does not infer tariff quantity", () => {
  const r = evaluate(); const proof = r.pricing!.tariff_sources[1]; assertEquals(proof.quantity, 12); assertEquals(proof.quantity_basis, "gross_kg");
  assertEquals(r.pricing!.inputs_json.air_cross_trade.cargo_quantities.pieces!.value, 2);
  assertEquals('cargoWeight' in r.pricing!.inputs_json, false); assertEquals('lots' in r.pricing!.outputs_json, false);
});
Deno.test("cross-trade pure CAS: replay, actor, context, expected head and immutable history", () => {
  const f = fixture(), args = { history: [] as AirPlanRevision[], id: "plan-a", expected_id: null as string | null,
    actor_id: "actor-a", case_id: f.request.case_id, expected_context: "v1", actual_context: "v1", plan: f.retained.plan };
  const first = retainAirCrossTradePlan(args); const saved = JSON.stringify(first);
  assertEquals(retainAirCrossTradePlan({ ...args, history: [first] }), first);
  assertThrows(() => retainAirCrossTradePlan({ ...args, history: [first], actor_id: "actor-b" }));
  assertThrows(() => retainAirCrossTradePlan({ ...args, history: [first], id: "plan-b" }));
  assertThrows(() => retainAirCrossTradePlan({ ...args, id: "plan-b", actual_context: "v2" }));
  const second = retainAirCrossTradePlan({ ...args, history: [first], id: "plan-b", expected_id: "plan-a" });
  assertEquals(second.revision, 2); assertEquals(JSON.stringify(first), saved);
  second.plan.route.departure_airport = "EBB"; assertEquals(first.plan.route.departure_airport, "NBO");
});
Deno.test("cross-trade fingerprint binds context contents with canonical object key order", async () => {
  assertEquals(await airCrossTradeFingerprint({ b: 2, a: 1 }), await airCrossTradeFingerprint({ a: 1, b: 2 }));
  assert((await airCrossTradeFingerprint(fixture().request)) !== await airCrossTradeFingerprint({ ...fixture().request, facts: [] }));
});
async function pdfText(bytes: Uint8Array) {
  const raw = new TextDecoder("latin1").decode(bytes), out: string[] = [];
  for (const m of raw.matchAll(/\/Length (\d+)\s*>>\s*stream\r?\n/g)) {
    const start = m.index! + m[0].length;
    try {
      const decoded = new TextDecoder("latin1").decode(await new Response(new Blob([bytes.slice(start, start + Number(m[1]))]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
      for (const t of decoded.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(t[1].replace(/../g, h => String.fromCharCode(parseInt(h, 16))));
    } catch { /* binary/non-content stream */ }
  }
  return out.join(" ").replace(/\s+/g, " ");
}
Deno.test("cross-trade local consumers: source output → commercial correction → immutable commercial snapshot → PDF (no DB claim)", async () => {
  const r = evaluate(), p = r.pricing!;
  const snapshot = { meta: { version_id: "synthetic-version", version_number: 1, created_at: "2026-10-30T00:00:00Z", quoteQualification: p.outputs_json.quoteQualification },
    inputs: { origin: "KE", destination: "AMS", incoterm: null }, client: { company: "SYNTHETIC TEST ONLY" },
    air_cross_trade: readAirCrossTradeBasis(p.outputs_json.air_cross_trade), raw_lines: structuredClone(p.tariff_lines), lines: structuredClone(p.tariff_lines),
    sources: structuredClone(p.tariff_sources), totals: { ...p.outputs_json.totals, total_ht: p.total_ht, total_ttc: p.total_ttc } };
  const canonicalPdf = await pdfText(await generateDraftPdf(snapshot, "SYNTHETIC"));
  assertStringIncludes(canonicalPdf, "42 000 XOF"); assertStringIncludes(canonicalPdf, "NBO");
  for (const hidden of ["SYNTHETIC PURCHASE", "SYNTHETIC OPERATOR ROUTING", "36 000 XOF"]) assertEquals(canonicalPdf.includes(hidden), false);
  const saved = JSON.stringify(snapshot); let draft = prepareCommercialQuote("synthetic-air-case", "synthetic-version", snapshot);
  draft = reviseCommercialPreparation(draft, { type: "edit", line_id: "source:1", amount: 45000, basis: "taxes_included", reason: "Synthetic revised client sale" },
    { expected_revision: 0, operation_id: "sale-op", actor_id: "operator-b", occurred_at: "2026-10-30T01:00:00Z" });
  const commercial = composeCommercialSnapshot(draft, "commercial-v1"); assertEquals(commercial.totals.total_payable, 47000);
  assertEquals(JSON.stringify(snapshot), saved); assertEquals(draft.events[0].actor_id, "operator-b");
  assertEquals(commercial.air_cross_trade, snapshot.air_cross_trade);
  const client = projectClientQuote(commercial); assertStringIncludes(client.bases.join(" "), "NBO");
  assertEquals(JSON.stringify(client).includes("SYNTHETIC PURCHASE"), false);
  const text = await pdfText(await generateDraftPdf(commercial, "SYNTHETIC")); assertStringIncludes(text, "47 000 XOF"); assertStringIncludes(text, "NBO"); assertStringIncludes(text, "AMS");
  assertEquals(text.includes("SYNTHETIC PURCHASE"), false); assertEquals(text.includes("36000"), false);
});

Deno.test("cross-trade: domestic included transfer cannot cover a new foreign departure", () => {
  const result = evaluate(f => { f.retained.plan.route.departure_country = "UG"; f.retained.plan.route.departure_airport = "EBB";
    f.sources[1].origin_country = "UG"; f.sources[1].origin_airport = "EBB"; });
  assertEquals(result.ready_to_price, false); assert(has(result, "service.inclusion"));
});

Deno.test("cross-trade: quantity snapshot mismatch, duplicate fact ID and wrong fact key cannot price", () => {
  for (const change of [(f: ReturnType<typeof fixture>) => { f.request.facts[0].value_number = 120; },
    (f: ReturnType<typeof fixture>) => { f.request.facts.push(structuredClone(f.request.facts[0])); },
    (f: ReturnType<typeof fixture>) => { f.request.facts[0].fact_key = "cargo.net_weight_kg"; },
    (f: ReturnType<typeof fixture>) => { f.request.facts[0].source_email_id = "other-mail"; }]) {
    const r = evaluate(change); assertEquals(r.ready_to_price, false); assert(has(r, "cargo.gross_kg"));
  }
});
Deno.test("cross-trade: same-day timestamp FX and source bounds retain their UTC instant", () => {
  const r = evaluate(f => { f.fx[0].valid_from = "2026-10-30T00:00:00Z"; f.fx[0].valid_until = "2026-10-30T23:59:59Z"; });
  assertEquals(r.ready_to_price, true);
  for (const bad of ["not-a-date", "2026-10-30T00:00:00"]) {
    assertThrows(() => evaluate(f => { f.as_of = bad; }));
  }
  assertEquals(evaluate(f => { f.fx[0].valid_from = "bad"; }).ready_to_price, false);
});
Deno.test("cross-trade: explicit pre-carriage source reaches departure airport, not final arrival", () => {
  const f = fixture(); f.retained.plan.route.departure_country = "UG"; f.retained.plan.route.departure_airport = "EBB";
  f.sources[1].origin_country = "UG"; f.sources[1].origin_airport = "EBB";
  f.sources.push({ ...structuredClone(f.sources[0]), id: "pre-source", fingerprint: "pre-v1", service_key: "PRE_CARRIAGE",
    unit: "voyage", origin_country: "KE", destination_country: "UG", destination_airport: "EBB", included_services: [] });
  f.request.facts.push({ id: "pre-trips", fact_key: "service.pre_carriage_trips", value_number: 2, source_type: "manual", source_reference: "operator-route", is_current: true });
  f.retained.plan.services[1] = { service_key: "PRE_CARRIAGE", disposition: "priced", reason: "Synthetic pre-carriage retained",
    coverage: "pre_carriage", source_role: "purchase", source_id: "pre-source", source_fingerprint: "pre-v1", applicability_reference: "Synthetic source applicability",
    service_quantity: { value: 2, fact_id: "pre-trips", source_id: "operator-route", status: "operator" },
    client_sale: { amount_xof: 5000, basis: "taxes_included", reason: "Synthetic client price retained" } };
  assertEquals(evaluateAirCrossTrade(f).ready_to_price, true);
  f.sources[2].destination_airport = "AMS"; assertEquals(evaluateAirCrossTrade(f).ready_to_price, false);
});
Deno.test("cross-trade: voyage is not silently one trip", () => {
  const r = evaluate(f => { f.sources[0].unit = "voyage"; }); assertEquals(r.ready_to_price, false); assert(has(r, "tariff.trip_count"));
});
Deno.test("cross-trade: arrival handling source is anchored at arrival, not departure", () => {
  const r = evaluate(f => {
    f.sources.push({ ...structuredClone(f.sources[0]), id: "arrival-source", fingerprint: "arrival-v1", service_key: "AIR_HANDLING",
      origin_country: "NL", destination_country: "NL", origin_airport: "AMS", destination_airport: "AMS", included_services: [] });
    f.retained.plan.services.push({ ...structuredClone(f.retained.plan.services[0]), service_key: "AIR_HANDLING", coverage: "arrival",
      source_id: "arrival-source", source_fingerprint: "arrival-v1" });
  }); assertEquals(r.ready_to_price, true);
});

Deno.test("cross-trade: foreign departure cannot omit the retained origin transfer from coverage", () => {
  const r = evaluate(f => { f.retained.plan.route.departure_country = "UG"; f.retained.plan.route.departure_airport = "EBB";
    f.sources[1].origin_country = "UG"; f.sources[1].origin_airport = "EBB";
    f.request.requested_services = ["PICKUP_ORIGIN", "AIR_FREIGHT"];
    f.retained.plan.services = f.retained.plan.services.filter(d => d.service_key !== "PRE_CARRIAGE"); });
  assertEquals(r.ready_to_price, false); assert(has(r, "routing.pre_carriage_coverage"));
});
Deno.test("cross-trade: forged explicit status cannot promote an assumed fact", () => {
  const r = evaluate(f => { f.request.facts[0].source_type = "ai_assumption"; }); assertEquals(r.ready_to_price, false);
});
Deno.test("cross-trade: rolled-over date, malformed bounds and whitespace conditions are not valid", () => {
  assertThrows(() => evaluate(f => { f.as_of = "2026-02-30"; }));
  assertEquals(evaluate(f => { f.sources[1].effective_from = "2026-02-30"; }).ready_to_price, false);
  const r = evaluate(f => { f.sources[1].required_fact_keys = ["cargo.synthetic_condition"]; f.request.facts[1].value_text = "  "; });
  assert(has(r, "cargo.synthetic_condition"));
});

Deno.test("cross-trade snapshot: malformed or conflicting saved basis is not silently erased", () => {
  const basis = evaluate().pricing!.outputs_json.air_cross_trade;
  assertEquals(readAirCrossTradeBasis(undefined), null); assertEquals(airCrossTradeClientBases(undefined), []);
  const saved = readAirCrossTradeBasis(basis)!; assertEquals<unknown>(saved, basis);
  saved.plan.plan.route.arrival_airport = "CDG"; assertThrows(() => readAirCrossTradeBasis(saved));
  assertThrows(() => readAirCrossTradeBasis({ ...basis, unresolved: [{ key: "missing" }] }));
  assertEquals(basis.plan!.plan.route.arrival_airport, "AMS");
});

Deno.test("cross-trade: canonical net weight and operator correction sources remain usable", () => {
  const r = evaluate(f => {
    f.request.quantities.net_kg = { value: 10, fact_id: "net-fact", source_id: "operator-net", status: "operator" };
    f.request.facts.push({ id: "net-fact", fact_key: "cargo.weight_net_kg", value_number: 10, source_type: "operator_correction", source_reference: "operator-net", is_current: true });
    f.retained.plan.services[2].weight_basis = "net_kg";
  }); assertEquals(r.ready_to_price, true); assertEquals(r.pricing!.tariff_sources[1].quantity, 10);
});

Deno.test("cross-trade commercial removal: historical route is preserved but removed transfer is no longer claimed", async () => {
  const p = evaluate().pricing!;
  const source = { meta: { version_number: 1, quoteQualification: p.outputs_json.quoteQualification }, inputs: { origin: "KE", destination: "AMS" },
    air_cross_trade: readAirCrossTradeBasis(p.outputs_json.air_cross_trade), raw_lines: structuredClone(p.tariff_lines), lines: structuredClone(p.tariff_lines),
    totals: { ...p.outputs_json.totals, total_ht: p.total_ht, total_ttc: p.total_ttc } };
  let draft = prepareCommercialQuote("synthetic-air-case", "v1", source);
  draft = reviseCommercialPreparation(draft, { type: "remove", line_id: "source:0", reason: "Synthetic pickup removed from commercial scope" },
    { expected_revision: 0, operation_id: "remove", actor_id: "operator-b", occurred_at: "2026-10-30T02:00:00Z" });
  const reduced = composeCommercialSnapshot(draft, "v2");
  assertEquals(reduced.air_cross_trade, source.air_cross_trade); assertEquals(reduced.totals.total_payable, 40000);
  assertEquals(reduced.meta.quoteQualification.level, "partial");
  const client = projectClientQuote(reduced); assertStringIncludes(client.bases.join(" "), "Préacheminement non compris");
  assertEquals(client.bases.join(" ").includes("Préacheminement compris"), false);
  const pdf = await pdfText(await generateDraftPdf(reduced, "SYNTHETIC")); assertStringIncludes(pdf, "non compris");
  draft = reviseCommercialPreparation(draft, { type: "restore", line_id: "source:0", reason: "Synthetic pickup scope restored explicitly" },
    { expected_revision: 1, operation_id: "restore", actor_id: "operator-b", occurred_at: "2026-10-30T03:00:00Z" });
  const restored = composeCommercialSnapshot(draft, "v3"); assertEquals(restored.meta.quoteQualification.level, "provisional");
  assertStringIncludes(projectClientQuote(restored).bases.join(" "), "Préacheminement compris");
});
