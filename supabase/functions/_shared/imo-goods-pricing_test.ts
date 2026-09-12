import { assert, assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { recognizeImoGoods, resolveImoGoodsPricing, assertImoGoodsPlan, imoGoodsFeeFacts, imoGoodsCarrierNeedsConfirmation,
  imoGoodsSourceFingerprint, type ImoGoodsAssessment } from "./imo-goods-recognition.ts";
import { DPW_DTHC_SOURCE_DOCUMENT } from "./dpw-dthc-tariff.ts";
import { buildFeeCaseContextFromFacts } from "./fee-case-facts.ts";

const source = "1.8 x 20HQ SOC (batteries), UN3536\n2.2 x 40RF COC (equipment), non-dangerous";
const containers = [{ type: "20HQ", quantity: 8, coc_soc: "SOC" }, { type: "40RF", quantity: 2, coc_soc: "COC" }];
const facts = [{ fact_key: "cargo.containers", value_json: containers }, { fact_key: "cargo.dangerous_goods", value_text: "YES" }];
function assessment(body = source): ImoGoodsAssessment {
  return { ...recognizeImoGoods([{ id: "synthetic-source", body, trustedClient: true, complete: true }])!, sourceFingerprint: "snapshot" };
}
const plan = () => resolveImoGoodsPricing(assessment(), facts, "snapshot");

Deno.test("IMO groups pricing: explicit mixed container allocation ready without mutating facts", () => {
  const before = JSON.stringify(facts);
  const result = plan();
  assertEquals(result.status, "READY");
  assertEquals(result.rows.map(r => [r.containerIndex, r.dangerous, r.imoClass]), [[0, true, "9"], [1, false, null]]);
  assert(result.mixed);
  assertEquals(result.reference.amendment, "42-24");
  assertImoGoodsPlan(result, containers);
  assertEquals(JSON.stringify(facts), before);
});
Deno.test("IMO groups pricing: order does not establish container association", () => {
  const result = resolveImoGoodsPricing(assessment(), [{ fact_key: "cargo.containers", value_json: [...containers].reverse() }], "snapshot");
  assertEquals(result.status, "READY");
  assertEquals(result.rows.map(r => r.containerIndex), [1, 0]);
});
for (const [name, body, reason] of [
  ["goods are not containers", source.replace("8 x 20HQ", "8 battery units: 20HQ"), "CONTAINER_ALLOCATION_REQUIRED"],
  ["missing non-DG declaration", source.replace(", non-dangerous", ""), "GROUP_2_CLASSIFICATION_REQUIRED"],
  ["conditional negative", source.replace("non-dangerous", "non-dangerous?"), "GROUP_2_CLASSIFICATION_REQUIRED"],
  ["negative followed by reservation", source.replace("non-dangerous", "non-dangerous except some items"), "GROUP_2_CLASSIFICATION_REQUIRED"],
  ["missing ownership", source.replace("20HQ SOC", "20HQ"), "CONTAINER_ALLOCATION_REQUIRED"],
  ["ambiguous equipment", source.replace("20HQ SOC", "20HQ/40HQ SOC"), "SOURCE_REVIEW_REQUIRED"],
  ["ambiguous ownership", source.replace("20HQ SOC", "20HQ SOC/COC"), "SOURCE_REVIEW_REQUIRED"],
  ["class contradicts non-DG declaration", source.replace("equipment", "equipment class 3"), "GROUP_2_CLASSIFICATION_REQUIRED"],
  ["contradictory class", source.replace("UN3536", "UN3536 class 3"), "SOURCE_REVIEW_REQUIRED"],
  ["unknown ONU", source.replace("UN3536", "UN9999"), "SOURCE_REVIEW_REQUIRED"],
] as const) {
  Deno.test(`IMO groups pricing: blocks ${name}`, () => {
    const result = resolveImoGoodsPricing(assessment(body), facts, "snapshot");
    assertEquals(result.status, "BLOCKED");
    assert(result.reasons.includes(reason));
  });
}
Deno.test("IMO groups pricing: duplicate candidate containers are ambiguous, never zipped by index", () => {
  const result = resolveImoGoodsPricing(assessment(source.replace("2 x 40RF COC", "8 x 20HQ SOC")), [
    { fact_key: "cargo.containers", value_json: [containers[0], containers[0]] },
  ], "snapshot");
  assert(result.reasons.includes("CONTAINER_ALLOCATION_REQUIRED"));
});
Deno.test("IMO groups pricing: duplicate current facts cannot select an arbitrary classification", () => {
  const result = resolveImoGoodsPricing(assessment(), [...facts, { fact_key: "cargo.dangerous_goods", value_text: "NO" }], "snapshot");
  assertEquals(result.status, "BLOCKED");
  assert(result.reasons.includes("DUPLICATE_CURRENT_IMO_FACT"));
});
for (const [key, value, reason] of [
  ["cargo.dangerous_goods", "NO", "GLOBAL_DG_CONFLICT"],
  ["cargo.un_number", "UN1203", "GLOBAL_IMO_CONFLICT"],
  ["cargo.imo_class", "3", "GLOBAL_IMO_CONFLICT"],
  ["pricing.dthc_family", "STANDARD", "GLOBAL_DTHC_FAMILY_CONFLICT"],
  ["pricing.dthc_family", "DANGEROUS", "GLOBAL_DTHC_FAMILY_CONFLICT"],
] as const) {
  Deno.test(`IMO groups pricing: manual ${key}=${value} is not silently overwritten`, () => {
    const current = [...facts.filter(f => f.fact_key !== key), { fact_key: key, value_text: value }];
    const before = JSON.stringify(current);
    assert(resolveImoGoodsPricing(assessment(), current, "snapshot").reasons.includes(reason));
    assertEquals(JSON.stringify(current), before);
  });
}
Deno.test("IMO groups pricing: stale or old unfingerprinted evidence cannot price", () => {
  assert(resolveImoGoodsPricing(assessment(), facts, "changed").reasons.includes("SOURCE_CHANGED_REANALYZE"));
  const old = assessment(); delete old.sourceFingerprint;
  assert(resolveImoGoodsPricing(old, facts, "snapshot").reasons.includes("SOURCE_CHANGED_REANALYZE"));
});
Deno.test("IMO groups pricing: source fingerprint stable on order, changes on sender/body/client/mail addition", async () => {
  const mails = [{ id: "b", from_address: "client@example.invalid", body_text: "source" }, { id: "a", body_text: "reply" }];
  const hash = await imoGoodsSourceFingerprint("client@example.invalid", mails);
  assertEquals(await imoGoodsSourceFingerprint("client@example.invalid", [...mails].reverse()), hash);
  for (const modified of [mails.slice(1), [...mails, { id: "c" }], [{ ...mails[0], body_text: "revision" }, mails[1]], [{ ...mails[0], from_address: "other@example.invalid" }, mails[1]]]) {
    assert(await imoGoodsSourceFingerprint("client@example.invalid", modified) !== hash);
  }
  assert(await imoGoodsSourceFingerprint(null, mails) !== hash);
});
Deno.test("IMO groups pricing: mixed fee context is unknown; homogeneous DG context proven", () => {
  const mixed = plan();
  assertEquals(imoGoodsFeeFacts(mixed), []);
  const ctx = buildFeeCaseContextFromFacts({ factsMap: new Map(facts.map(f => [f.fact_key, f])), requestType: "IMPORT_FCL", asOfDate: "2026-09-12", override: { imo_facts: imoGoodsFeeFacts(mixed) } });
  assertEquals(ctx.dangerousGoods, null);
  const all = resolveImoGoodsPricing(assessment(source.replace("non-dangerous", "UN1203")), facts, "snapshot");
  assertEquals(all.status, "READY");
  assertEquals(imoGoodsFeeFacts(all), [{ fact_key: "cargo.dangerous_goods", value_text: "YES" }]);
});
Deno.test("IMO groups pricing: ALL-operation carrier enrichment also respects mixed scope", () => {
  assert(imoGoodsCarrierNeedsConfirmation(plan(), { charge_code: "DG_ALL" }));
  assert(imoGoodsCarrierNeedsConfirmation(plan(), { charge_name: "IMO surcharge" }));
  assert(!imoGoodsCarrierNeedsConfirmation(plan(), { charge_code: "DOC" }));
  assert(!imoGoodsCarrierNeedsConfirmation(undefined, { charge_code: "DG" }));
});
for (const mutation of ["missing", "duplicate", "class", "quantity", "mixed", "ownership", "status"] as const) {
  Deno.test(`IMO groups engine boundary: rejects ${mutation} plan corruption`, () => {
    const p = plan();
    if (mutation === "missing") p.rows.pop();
    if (mutation === "duplicate") p.rows[1].containerIndex = 0;
    if (mutation === "class") p.rows[0].imoClass = "3";
    if (mutation === "quantity") p.rows[0].quantity = 9;
    if (mutation === "mixed") p.mixed = false;
    if (mutation === "ownership") p.rows[0].ownership = "COC";
    if (mutation === "status") p.status = "BLOCKED";
    assertThrows(() => assertImoGoodsPlan(p, containers), Error, "IMO_GOODS_PLAN_INVALID");
  });
}

// Exercise the actual engine with synthetic tariff rows and an in-memory read-only DB.
const prior = Deno.env.get("QUOTATION_ENGINE_DISABLE_SERVE");
Deno.env.set("QUOTATION_ENGINE_DISABLE_SERVE", "1");
const { generateQuotationLines } = await import("../quotation-engine/index.ts");
if (prior === undefined) Deno.env.delete("QUOTATION_ENGINE_DISABLE_SERVE"); else Deno.env.set("QUOTATION_ENGINE_DISABLE_SERVE", prior);
const tariffBase = { provider: "DPW", category: "THC", operation_type: "IMPORT", unit: "EVP", source_document: DPW_DTHC_SOURCE_DOCUMENT,
  effective_date: "2025-01-01", expiry_date: null, is_active: true, evidence_level: "official" };
const fixtureTables: Record<string, Record<string, unknown>[]> = {
  port_tariffs: [
    { ...tariffBase, id: "danger", cargo_type: "DANGEROUS", classification: "Produits dangereux (IMDG classe 1-9)", amount: 155000, surcharge_percent: 50 },
    { ...tariffBase, id: "reefer", cargo_type: "REEFER", classification: "Conteneurs frigorifiques", amount: 170500, surcharge_percent: 0 },
  ],
  carrier_billing_templates: [
    { carrier: "GENERIC", operation_type: "IMPORT", is_active: true, evidence_level: "official", currency: "XOF", calculation_method: "PER_BL", default_amount: 1000, charge_code: "DOC", charge_name: "Documentation" },
    { carrier: "GENERIC", operation_type: "IMPORT", is_active: true, evidence_level: "official", currency: "XOF", calculation_method: "PER_CNT", default_amount: 50, charge_code: "DG", charge_name: "DG surcharge" },
  ],
  warehouse_franchise: [{ is_active: true, free_days: 10, rate_per_day: 100, rate_unit: "test", cargo_type: "FCL" }],
};
function fakeDb() {
  const reads: string[] = [];
  return { reads, from(table: string) {
    reads.push(table);
    let rows = [...(fixtureTables[table] ?? [])]; let single = false;
    const query = {
      select() { return query; }, eq(k: string, v: unknown) { rows = rows.filter(r => r[k] === v); return query; },
      in(k: string, v: unknown[]) { rows = rows.filter(r => v.includes(r[k])); return query; },
      ilike() { return query; }, or() { return query; }, order() { return query; }, limit() { return query; },
      gte() { return query; }, lte() { return query; }, not() { return query; },
      maybeSingle() { single = true; return query; }, single() { single = true; return query; },
      then(resolve: (v: unknown) => unknown) { return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve); },
    };
    return query;
  } };
}
const request = { finalDestination: "Dakar", transportMode: "maritime" as const, incoterm: "DAP", cargoType: "FCL", cargoValue: 100000,
  cargoDescription: "GLOBAL IMO DANGEROUS UN3536", containers, isIMO: true, isHazmat: true };
Deno.test("IMO groups engine: correct per-group THC, one dossier fee, no global DG carrier multiplication", async () => {
  const db = fakeDb();
  const result = await generateQuotationLines(db, { ...request, imoGoodsPlan: plan() });
  const thc = result.lines.filter(l => l.id.startsWith("thc_"));
  assertEquals(thc.map(l => l.amount), [155000 * 1.5 * 8, 170500 * 2 * 2]);
  assert(thc[0].notes?.includes("classe 9"));
  assert(thc[1].notes?.includes("non dangereux déclaré"));
  const docs = result.lines.filter(l => l.id.startsWith("carrier_doc"));
  assertEquals(docs.length, 1);
  assertEquals(docs[0].amount, 1000);
  assertEquals(result.lines.find(l => l.id.startsWith("carrier_dg"))?.amount, null);
  assertEquals(db.reads.filter(t => t === "carrier_billing_templates").length, 1);
  assert(result.lines.find(l => l.id === "warehouse_franchise")?.description.startsWith("Hors groupes IMO"));
});
Deno.test("IMO groups engine: without plan legacy global classification unchanged", async () => {
  const result = await generateQuotationLines(fakeDb(), request);
  assertEquals(result.lines.find(l => l.id.startsWith("carrier_dg"))?.amount, 500);
  assertEquals(result.lines.filter(l => l.id.startsWith("thc_")).map(l => l.amount), [1860000, null]);
  assert(!result.lines.find(l => l.id === "warehouse_franchise")?.description.startsWith("Hors groupes IMO"));
});
Deno.test("IMO groups engine: an unvalidated dry non-DG designation stays TO_CONFIRM, not dangerous", async () => {
  const dryContainers = [containers[0], { ...containers[1], type: "40HQ" }];
  const dryPlan = resolveImoGoodsPricing(assessment(source.replace("40RF", "40HQ")), [{ fact_key: "cargo.containers", value_json: dryContainers }], "snapshot");
  const result = await generateQuotationLines(fakeDb(), { ...request, containers: dryContainers, imoGoodsPlan: dryPlan });
  const dry = result.lines.filter(l => l.id.startsWith("thc_"))[1];
  assertEquals(dry.amount, null);
  assert(dry.source.reference.includes("FAMILY_UNDETERMINED"));
  assert(dry.notes?.includes("non dangereux déclaré"));
});
Deno.test("IMO groups engine: invalid or conflicting plan rejected before any DB read", async () => {
  const db = fakeDb();
  await assertRejects(() => generateQuotationLines(db, { ...request, imoGoodsPlan: { ...plan(), rows: [] } }), Error, "IMO_GOODS_PLAN_INVALID");
  await assertRejects(() => generateQuotationLines(db, { ...request, imoGoodsPlan: plan(), dthcFamily: "STANDARD" }), Error, "IMO_GOODS_PLAN_CONFLICT");
  assertEquals(db.reads.length, 0);
});
Deno.test("IMO groups wiring: fresh evidence guard before status mutation, one engine and scoped fee override", () => {
  const pricing = Deno.readTextFileSync(new URL("../run-pricing/index.ts", import.meta.url));
  assert(pricing.indexOf("const goodsAssessment") < pricing.indexOf("const { data: blockingGapsRows }"));
  assert(pricing.includes("imoGoodsPlan: inputs.imoGoodsPlan"));
  assert(pricing.includes("imo_facts: imoGoodsFeeFacts(inputs.imoGoodsPlan)"));
  assert(pricing.includes("sk !== 'DTHC'"));
  assert(pricing.includes("inputs.imoGoodsPlan = goodsPlan"));
  assert(pricing.includes("imoGoodsCarrierNeedsConfirmation(inputs.imoGoodsPlan, t)"));
  const puzzle = Deno.readTextFileSync(new URL("../build-case-puzzle/index.ts", import.meta.url));
  const block = puzzle.slice(puzzle.indexOf("// Resolve only our own guard"), puzzle.indexOf("const existingDbKeys"));
  assert(block.includes('plan.status === "READY" && supported'));
  assert(block.includes('.eq("gap_key", IMO_GOODS_GAP).eq("status", "open")'));
  assert(!block.includes("supersede_fact"));
});
