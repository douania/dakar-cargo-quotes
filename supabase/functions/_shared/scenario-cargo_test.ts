import { assert, assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveScenarioCargo, assertScenarioCargoContext, type ScenarioCargoContext } from "./scenario-cargo.ts";
import { validateScopeSnapshot } from "../manage-quote-scenario/domain.ts";
import { computeScenarioTotals, computeRequestFingerprint, buildScenarioCargoPricing, buildEngineRequest, buildPricingInputs } from "../run-scenario-pricing/domain.ts";
import { DPW_DTHC_SOURCE_DOCUMENT } from "./dpw-dthc-tariff.ts";
import { LOCAL_TRANSPORT_CONTAINER_20, LOCAL_TRANSPORT_CONTAINER_40, OFFICIAL_LOCAL_TRANSPORT_SOURCE_DOCUMENT } from "./local-transport-destination.ts";
import { readScenarioOutputContext } from "./scenario-output.ts";

function unit(ref: string, extra: Record<string, unknown> = {}) {
  return { unit_ref: ref, unit_kind: "CONTAINER", equipment_code: "20hq", packaging: "unknown", quantity: 4,
    gross_weight_kg: 25000, chargeable_weight_kg: null, volume_dm3: null, temperature_control_required: false,
    temperature_setpoint_celsius: null, classification_status: "unknown", destination_ref: null, required_attachment_status: "not_required",
    dangerous_goods: true, un_number: "UN3536", imo_class: null, ownership: "SOC", weight_basis: "per_unit", scenario_basis: "Synthetic operator assumption, not client evidence", ...extra };
}
function context(): ScenarioCargoContext {
  return { schema_version: 2, cargo_units: [unit("alpha"), unit("beta", { quantity: 2, equipment_code: "40rf", dangerous_goods: false, un_number: null, ownership: "COC" }),
    unit("gamma", { quantity: 1, dangerous_goods: null, un_number: null, gross_weight_kg: null })] };
}
function snapshot() { return { ...context(), transport_mode: "MARITIME", movement_direction: "IMPORT", terminal_operation_mode: "LOLO" }; }
Deno.test("scenario v2 caller: scenario containers replace only transient inputs, no global weight fallback", () => {
  const inputs = { containers: [{ type: "40HQ", quantity: 999 }], cargoWeight: 9999, cargoVolume: 9999, cargoValue: 1000 };
  const facts = [{ id: "synthetic-fact", fact_key: "cargo.dangerous_goods", value_text: "YES" }];
  const before = JSON.stringify({ inputs, facts });
  const cargo = buildScenarioCargoPricing(inputs, snapshot(), facts);
  assertEquals(cargo.blockers, []);
  assertEquals(cargo.inputs.cargoWeight, undefined);
  assertEquals(cargo.inputs.cargoVolume, undefined);
  assertEquals(cargo.inputs.cargoValue, 1000);
  assertEquals(cargo.inputs.containers?.map(c => c.quantity), [4, 2, 1]);
  const dto = { ...buildEngineRequest(cargo.inputs, "MARITIME"), scenarioCargoContext: cargo.context };
  assertEquals(dto.scenarioCargoContext?.cargo_units[2].dangerous_goods, null);
  assertEquals(JSON.stringify({ inputs, facts }), before);
});
Deno.test("scenario legacy: readable v1 never silently estimates unscoped DG; no automatic upgrade", () => {
  const s = { ...snapshot(), schema_version: 1 };
  for (const u of s.cargo_units) {
    u.dangerous_goods = false;
    for (const key of ["ownership", "un_number", "imo_class", "weight_basis", "scenario_basis"]) delete u[key];
  }
  const before = JSON.stringify(s);
  assert(validateScopeSnapshot(s).ok);
  const cargo = buildScenarioCargoPricing({ containers: [{ type: "20HQ", quantity: 1 }] }, s, []);
  assert(cargo.blockers.includes("SCENARIO_CARGO_V2_REQUIRED"));
  assertEquals(cargo.context, null);
  assertEquals(JSON.stringify(s), before);
});
Deno.test("scenario v2 rejects unmapped destinations and unsupported modes, never routes groups by position", () => {
  const s = snapshot(); s.cargo_units[0].destination_ref = "another-place";
  assert(buildScenarioCargoPricing({}, s, []).blockers.includes("SCENARIO_GROUP_DESTINATION_MAPPING_REQUIRED"));
  assert(buildScenarioCargoPricing({}, { ...snapshot(), transport_mode: "AIR" }, []).blockers.includes("SCENARIO_CARGO_MODE_UNSUPPORTED"));
});
Deno.test("scenario AIR v1: preserve baseline weight, request mode and isolation", () => {
  const cargoUnit: Record<string, unknown> = unit("air-lot", { unit_kind: "PACKAGE", dangerous_goods: false, equipment_code: null });
  for (const key of ["ownership", "un_number", "imo_class", "weight_basis", "scenario_basis"]) delete cargoUnit[key];
  const s = { ...snapshot(), schema_version: 1, transport_mode: "AIR", cargo_units: [cargoUnit] };
  const facts = [{ id: "synthetic-weight", fact_key: "cargo.weight_kg", value_number: 1200 }];
  const inputs = buildPricingInputs(facts);
  const before = JSON.stringify({ s, facts, inputs });
  const result = buildScenarioCargoPricing(inputs, s, facts);
  assertEquals(result.blockers, []);
  assertEquals(result.context, null);
  assertEquals(result.plan, null);
  assertEquals(buildEngineRequest(result.inputs, "AIR").transportMode, "aerien");
  assertEquals(result.inputs.cargoWeight, 1.2);
  assertEquals(JSON.stringify({ s, facts, inputs }), before);
  // Preserving AIR is not permission to bypass existing unscoped-DG guards.
  assert(buildScenarioCargoPricing(inputs, s, [...facts, { id: "synthetic-dg", fact_key: "cargo.un_number", value_text: "UN3536" }])
    .blockers.includes("SCENARIO_DG_FACTS_UNSCOPED_AIR"));
});
Deno.test("scenario legacy: distinguish unscoped DG from the container revision requirement", () => {
  const s = { schema_version: 1, transport_mode: "MARITIME", movement_direction: "IMPORT", terminal_operation_mode: "LOLO",
    cargo_units: [Object.fromEntries(Object.entries(unit("legacy")).filter(([key]) => !["ownership", "un_number", "imo_class", "weight_basis", "scenario_basis"].includes(key)))] };
  s.cargo_units[0].dangerous_goods = false;
  const result = buildScenarioCargoPricing({ containers: [{ type: "20HQ", quantity: 1 }] }, s,
    [{ id: "synthetic-dg", fact_key: "cargo.dangerous_goods", value_text: "NO" }]);
  assertEquals(result.blockers, ["SCENARIO_CARGO_V2_REQUIRED", "SCENARIO_DG_FACTS_UNSCOPED"]);
});
Deno.test("scenario v2: SOC/COC is traceable but never claims an ownership tariff adjustment", () => {
  const result = resolveScenarioCargo(context());
  const reservation = result.reservations.find(r => r.code === "SCENARIO_OWNERSHIP_NOT_PRICED");
  assert(reservation);
  assert(String(reservation.message).includes("sans ajustement tarifaire SOC/COC"));
  const output = readScenarioOutputContext({ meta: { source_kind: "scenario", quoteQualification: { level: "partial" } },
    scenario: { reference: "SIM-TEST", title: "Synthetic", revision_no: 1, pricing_run_seq: 1, reservations: result.reservations },
    totals: { currency: "XOF", firm_total_ht: 0, firm_total_ttc: 0, indicative_total_ht: 100, indicative_total_ttc: 100 } });
  assert(output?.reservations.some(r => r.includes("sans ajustement tarifaire SOC/COC")));
});
Deno.test("scenario v2: closed schema accepts tri-state, rejects absent/extra/mistyped fields", () => {
  assert(validateScopeSnapshot(snapshot()).ok);
  for (const [key, value] of [["ownership", undefined], ["un_number", undefined], ["imo_class", 9], ["weight_basis", "guess"], ["dangerous_goods", "false"], ["rogue", true], ["source_email_id", "fabricated"]] as const) {
    const s = snapshot(); s.cargo_units[0][key] = value;
    assert(!validateScopeSnapshot(s).ok, key);
  }
  assert(!validateScopeSnapshot({ ...snapshot(), schema_version: 3 }).ok);
});
Deno.test("scenario v2: weight basis requires a JSON string, never coercion (SQL parity)", () => {
  for (const value of [["per_unit"], ["total"], ["unknown"], [], {}, null, true, 1, "", "guess"]) {
    const s = snapshot(); s.cargo_units[0].weight_basis = value;
    assert(!validateScopeSnapshot(s).ok, JSON.stringify(value));
  }
  for (const value of ["per_unit", "total", "unknown"]) {
    const s = snapshot(); s.cargo_units[0].weight_basis = value;
    assert(validateScopeSnapshot(s).ok, value);
  }
});
Deno.test("scenario v2: derived IMO stays scoped, unknown does not become false, source input immutable", () => {
  const c = context(); const before = JSON.stringify(c);
  const p = resolveScenarioCargo(c);
  assertEquals(p.blockers, []);
  assertEquals(p.rows.map(r => [r.unitRef, r.dangerous, r.imoClass]), [["alpha", true, "9"], ["beta", false, null], ["gamma", null, null]]);
  assertEquals(p.cargoWeight, undefined); // never a partial sum passed off as total
  assert(p.reservations.some(r => r.code === "SCENARIO_DG_UNKNOWN" && r.unit_ref === "gamma"));
  assertEquals(JSON.stringify(c), before);
  assert(!JSON.stringify(p).includes("sourceEmailId"));
});
Deno.test("scenario v2: total and per-unit weight are explicit and group-local", () => {
  const p = resolveScenarioCargo({ schema_version: 2, cargo_units: [unit("a", { gross_weight_kg: 20000, quantity: 3 }), unit("b", { gross_weight_kg: 10000, quantity: 2, weight_basis: "total" })] });
  assertEquals(p.cargoWeight, 70);
  assertEquals(p.rows.map(r => r.weightPerContainerKg), [20000, 5000]);
});
Deno.test("scenario v2: existing scenario output reader retains every group assumption and reservation", () => {
  const p = resolveScenarioCargo(context());
  const output = readScenarioOutputContext({ meta: { source_kind: "scenario", quoteQualification: { level: "partial" } },
    scenario: { reference: "SIM-TEST", title: "Synthetic", revision_no: 1, pricing_run_seq: 1, assumptions: [], reservations: p.reservations },
    totals: { currency: "XOF", firm_total_ht: 0, firm_total_ttc: 0, indicative_total_ht: 100, indicative_total_ttc: 100 } });
  assert(output);
  for (const ref of ["alpha", "beta", "gamma"]) assert(output.reservations.some(r => r.includes(`Lot ${ref}`)));
  assert(output.reservations.some(r => r.includes("Lot gamma : danger inconnu")));
});
for (const [name, change] of [
  ["ONU/class contradiction", { imo_class: "3" }], ["negative/ONU contradiction", { dangerous_goods: false }],
  ["unknown/ONU contradiction", { dangerous_goods: null }], ["no rationale", { scenario_basis: " " }],
  ["no ownership", { ownership: null }], ["unknown equipment", { equipment_code: "eq-example" }],
  ["not a container", { unit_kind: "PACKAGE" }], ["negative quantity", { quantity: -1 }],
  ["fractional weight", { gross_weight_kg: 1.5 }], ["overflow", { gross_weight_kg: 1e12, quantity: 1e12 }],
] as const) {
  Deno.test(`scenario v2 rejects ${name}`, () => assert(resolveScenarioCargo({ schema_version: 2, cargo_units: [unit("a", change)] }).blockers.length > 0));
}
Deno.test("scenario v2: incomplete positive IMO retains reservation, not invented class", () => {
  for (const un of [null, "UN9999", "UN1950"]) {
    const p = resolveScenarioCargo({ schema_version: 2, cargo_units: [unit("a", { un_number: un })] });
    assertEquals(p.blockers, []);
    assert(p.reservations.some(r => r.code === "SCENARIO_IMO_INCOMPLETE"));
    assertEquals(p.rows[0].imoClass, null);
  }
});
Deno.test("scenario v2: boundary matches by reference despite permutation, rejects corruption", () => {
  const c = context(); const p = resolveScenarioCargo(c);
  assertScenarioCargoContext(c, [...p.containers].reverse());
  for (const key of ["quantity", "type", "unit_ref", "coc_soc"] as const) {
    const containers = structuredClone(p.containers);
    Object.assign(containers[0], { [key]: key === "quantity" ? 99 : "corrupt" });
    assertThrows(() => assertScenarioCargoContext(c, containers));
  }
  assertThrows(() => assertScenarioCargoContext(c, [p.containers[0], p.containers[0], p.containers[2]]));
});
Deno.test("scenario v2: version, tri-state and rationale are fingerprinted; all amounts indicative", async () => {
  const s = snapshot(); const hash = await computeRequestFingerprint(s);
  s.cargo_units[2].dangerous_goods = false;
  assert(hash !== await computeRequestFingerprint(s));
  s.cargo_units[0].scenario_basis = "Revised rationale";
  assert(hash !== await computeRequestFingerprint(s));
  const totals = computeScenarioTotals([{ amount: 1200, category: "Transport", source: { type: "OFFICIAL", confidence: 1 } }], new Set(["scenario.cargo_units"]));
  assertEquals(totals.firm_total_ht, 0);
  assertEquals(totals.indicative_total_ht, 1200);
  assert(totals.lines[0].scenario_provenance.assumption_dependent);
});

const prior = Deno.env.get("QUOTATION_ENGINE_DISABLE_SERVE");
Deno.env.set("QUOTATION_ENGINE_DISABLE_SERVE", "1");
const { generateQuotationLines, handleRequest: handleEngineRequest } = await import("../quotation-engine/index.ts");
if (prior === undefined) Deno.env.delete("QUOTATION_ENGINE_DISABLE_SERVE"); else Deno.env.set("QUOTATION_ENGINE_DISABLE_SERVE", prior);
function fakeDb(extraTables: Record<string, Record<string, unknown>[]> = {}) {
  const reads: string[] = [];
  const base = { provider: "DPW", category: "THC", operation_type: "IMPORT", unit: "EVP", source_document: DPW_DTHC_SOURCE_DOCUMENT, effective_date: "2025-01-01", expiry_date: null, is_active: true, evidence_level: "official" };
  const tables: Record<string, Record<string, unknown>[]> = {
    port_tariffs: [{ ...base, id: "dg", cargo_type: "DANGEROUS", classification: "Produits dangereux (IMDG classe 1-9)", amount: 155000, surcharge_percent: 50 },
      { ...base, id: "rf", cargo_type: "REEFER", classification: "Conteneurs frigorifiques", amount: 170500, surcharge_percent: 0 }],
    carrier_billing_templates: [
      { carrier: "GENERIC", operation_type: "IMPORT", is_active: true, evidence_level: "official", currency: "XOF", calculation_method: "PER_BL", default_amount: 1000, charge_code: "DOC", charge_name: "Documentation" },
      { carrier: "GENERIC", operation_type: "IMPORT", is_active: true, evidence_level: "official", currency: "XOF", calculation_method: "PER_CNT", default_amount: 50, charge_code: "DG", charge_name: "DG surcharge" }],
    warehouse_franchise: [{ is_active: true, free_days: 10, rate_per_day: 100, rate_unit: "test", cargo_type: "FCL" }],
    local_transport_rates: [LOCAL_TRANSPORT_CONTAINER_20, LOCAL_TRANSPORT_CONTAINER_40].map((type, i) => ({
      origin: "Dakar Port", destination: "KAOLACK", container_type: type, cargo_category: "Dry", rate_amount: i ? 2000 : 1000,
      rate_currency: "XOF", is_active: true, evidence_level: "validated_internal", validity_start: null, validity_end: null,
      client_code: null, source_document: OFFICIAL_LOCAL_TRANSPORT_SOURCE_DOCUMENT, provider: null,
    })),
  };
  Object.assign(tables, extraTables);
  return { reads, from(table: string) {
    reads.push(table); let rows = [...(tables[table] ?? [])]; let single = false;
    const query = { select() { return query; }, eq(k: string, v: unknown) { rows = rows.filter(r => r[k] === v); return query; },
      in(k: string, v: unknown[]) { rows = rows.filter(r => v.includes(r[k])); return query; },
      ilike() { return query; }, or() { return query; }, order() { return query; }, limit() { return query; }, gte() { return query; }, lte() { return query; }, not() { return query; },
      maybeSingle() { single = true; return query; }, single() { single = true; return query; },
      then(resolve: (v: unknown) => unknown) { return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve); } };
    return query;
  } };
}
function request(c = context()) { return { finalDestination: "Dakar", transportMode: "maritime" as const, incoterm: "DAP", cargoType: "FCL", cargoValue: 100000,
  cargoDescription: "Global IMO must not contaminate other groups", containers: resolveScenarioCargo(c).containers, scenarioCargoContext: c }; }

Deno.test("scenario DAP services: absent value never triggers CAF, FX or customs, tariff lines unchanged", async () => {
  const db = fakeDb();
  const input = { ...request(), scenarioPricingMode: "DAP_SERVICES_ONLY" as const, cargoValue: undefined,
    cargoCurrency: "USD", hsCode: "850440", regimeCode: "SYNTHETIC", freightAmount: 100, freightCurrency: "USD" };
  const before = JSON.stringify(input);
  const result = await generateQuotationLines(db, input);
  assertEquals(result.cargoValueFCFA, null);
  assertEquals(result.dutyBreakdown, []);
  assert(!result.lines.some(l => l.id.startsWith("duties_")));
  for (const table of ["exchange_rates", "customs_regimes", "tax_rates", "hs_codes"]) assert(!db.reads.includes(table), table);
  const baseline = await generateQuotationLines(fakeDb(), request());
  assertEquals(result.lines, baseline.lines.filter(l => !l.id.startsWith("duties_")));
  assertEquals(JSON.stringify(input), before);
  assertEquals(result.lines.filter(l => l.id.startsWith("thc_")).map(l => l.amount), [930000, 682000, null]);
});

Deno.test("scenario DAP services: invalid opt-ins and contradictory groups fail before DB", async () => {
  for (const changes of [
    { incoterm: "DDP" }, { incoterm: "CIF" }, { transportMode: "aerien" as const },
    { scenarioCargoContext: undefined }, { containers: [] }, { isIMO: true },
  ]) {
    const db = fakeDb();
    await assertRejects(() => generateQuotationLines(db, { ...request(), scenarioPricingMode: "DAP_SERVICES_ONLY", ...changes }));
    assertEquals(db.reads, []);
  }
});

Deno.test("scenario DAP services: known value and HS still exclude customs intentionally, not a zero-value workaround", async () => {
  const tariffs = { hs_codes: [{ code: "850440", code_normalized: "850440", dd: 10 }] };
  const input = { ...request(), hsCode: "850440" };
  const before = JSON.stringify(input);
  const legacy = await generateQuotationLines(fakeDb(tariffs), input);
  assert(legacy.lines.some(l => l.id.startsWith("duties_") && Number(l.amount) > 0));
  const estimate = await generateQuotationLines(fakeDb(tariffs), { ...input, scenarioPricingMode: "DAP_SERVICES_ONLY" });
  assertEquals(estimate.cargoValueFCFA, null);
  assertEquals(estimate.lines, legacy.lines.filter(l => !l.id.startsWith("duties_")));
  assert(estimate.warnings.some(w => w.includes("droits et taxes douaniers et calcul CAF exclus")));
  assertEquals(JSON.stringify(input), before);
});

Deno.test("scenario DAP services: actual facts-to-DTO-to-engine seam accepts absent value without global cargo fallback", async () => {
  const facts = [
    { id: "incoterm", fact_key: "routing.incoterm", value_text: "DAP" },
    { id: "destination", fact_key: "routing.destination_city", value_text: "Dakar" },
  ];
  const cargo = buildScenarioCargoPricing(buildPricingInputs(facts), snapshot(), facts);
  assertEquals(cargo.blockers, []);
  const payload = JSON.parse(JSON.stringify({ ...buildEngineRequest(cargo.inputs, "MARITIME"),
    scenarioCargoContext: cargo.context, scenarioPricingMode: "DAP_SERVICES_ONLY" }));
  assertEquals(payload.transportMode, "maritime");
  assert(!("cargoValue" in payload));
  const result = await generateQuotationLines(fakeDb(), payload);
  assertEquals(result.cargoValueFCFA, null);
  assertEquals(result.lines.filter(l => l.id.startsWith("thc_")).map(l => l.amount), [930000, 682000, null]);
});

Deno.test("scenario DAP services: actual authenticated HTTP generate and validate, no Cloud or 1 FCFA fallback", async () => {
  const savedFetch = globalThis.fetch;
  const keys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  const savedEnv = keys.map(k => Deno.env.get(k));
  const unexpected: string[] = [];
  const reads: string[] = [];
  const allowed = new Set(["delivery_zones", "tariff_category_rules", "port_tariffs", "carrier_billing_templates",
    "operational_costs_senegal", "warehouse_franchise", "holidays_pad", "incoterms_reference", "learned_knowledge", "local_transport_rates"]);
  const reply = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  try {
    Deno.env.set(keys[0], "https://engine-synthetic.invalid");
    Deno.env.set(keys[1], "synthetic-anon");
    Deno.env.set(keys[2], "synthetic-service");
    globalThis.fetch = (async (input, init) => {
      const req = new Request(input, init); const url = new URL(req.url);
      if (url.origin === "https://engine-synthetic.invalid" && req.method === "GET") {
        if (url.pathname === "/auth/v1/user") {
          assertEquals(req.headers.get("Authorization"), "Bearer synthetic-user");
          return reply({ id: "33333333-3333-4333-8333-333333333333", aud: "authenticated" });
        }
        const table = url.pathname.replace("/rest/v1/", "");
        if (allowed.has(table)) { reads.push(table); return reply(req.headers.get("Accept")?.includes("vnd.pgrst.object") ? null : []); }
      }
      unexpected.push(`${req.method} ${url}`);
      throw new Error("Unexpected call refused");
    }) as typeof fetch;
    const params = { ...request(), cargoValue: undefined, cargoCurrency: "USD", hsCode: "850440", regimeCode: "SYNTHETIC",
      freightAmount: 100, freightCurrency: "USD", scenarioPricingMode: "DAP_SERVICES_ONLY" };
    const invoke = (action: string, auth = true) => handleEngineRequest(new Request("https://engine-synthetic.invalid", {
      method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: "Bearer synthetic-user" } : {}) },
      body: JSON.stringify({ action, params }),
    }));
    assertEquals((await invoke("generate", false)).status, 401);
    assertEquals(reads, []);
    const response = await invoke("generate");
    const body = await response.json();
    assertEquals(response.status, 200);
    assertEquals(body.success, true);
    assertEquals(body.metadata.caf, null);
    assertEquals(body.metadata.estimate_mode, "DAP_SERVICES_ONLY");
    assertEquals(body.metadata.totals_scope, "PRICED_SERVICES_ONLY");
    assertEquals(body.metadata.duties_excluded, true);
    assertEquals(body.totals.ddp, null);
    assertEquals(body.duty_breakdown, []);
    assertEquals(body.historical_suggestions, []);
    assert(!body.lines.some((l: { id: string }) => l.id.startsWith("duties_")));
    assert(!JSON.stringify(body.warnings).includes("approximatifs"));
    assert(!JSON.stringify(body).includes("1 FCFA"));
    const valid = await (await invoke("validate_request")).json();
    assertEquals(valid.isValid, true);
    assertEquals(unexpected, []);
  } finally {
    globalThis.fetch = savedFetch;
    keys.forEach((key, i) => savedEnv[i] === undefined ? Deno.env.delete(key) : Deno.env.set(key, savedEnv[i]!));
  }
});
Deno.test("scenario v2 actual engine: DG/dry/unknown independent, one common fee, no global DG/storage", async () => {
  const db = fakeDb(); const result = await generateQuotationLines(db, request());
  const thc = result.lines.filter(l => l.id.startsWith("thc_"));
  assertEquals(thc.map(l => l.amount), [155000 * 1.5 * 4, 170500 * 2 * 2, null]);
  assert(thc[0].notes?.includes("Scénario lot alpha"));
  assert(thc[2].source.reference.includes("SCENARIO_DG_UNKNOWN"));
  assert(!thc.some(l => l.notes?.includes("e-mail")));
  assertEquals(result.lines.filter(l => l.id.startsWith("carrier_doc")).length, 1);
  assertEquals(result.lines.find(l => l.id.startsWith("carrier_doc"))?.amount, 1000);
  assertEquals(result.lines.find(l => l.id.startsWith("carrier_dg"))?.amount, null);
  assertEquals(result.lines.find(l => l.id === "warehouse_franchise")?.amount, null);
  assertEquals(db.reads.filter(t => t === "carrier_billing_templates").length, 1);
  const reversed = await generateQuotationLines(fakeDb(), { ...request(), containers: [...request().containers].reverse() });
  assertEquals(reversed.lines.filter(l => l.id.startsWith("thc_")).map(l => l.amount), [null, 170500 * 2 * 2, 155000 * 1.5 * 4]);
});
Deno.test("scenario v2 actual engine rejects global classification or mismatched context before DB", async () => {
  const db = fakeDb();
  await assertRejects(() => generateQuotationLines(db, { ...request(), isIMO: true }), Error, "SCENARIO_CARGO_CONTEXT_CONFLICT");
  await assertRejects(() => generateQuotationLines(db, { ...request(), cargoWeight: 9000 }), Error, "SCENARIO_CARGO_CONTEXT_CONFLICT");
  await assertRejects(() => generateQuotationLines(db, { ...request(), weightTonnes: 9000 }), Error, "SCENARIO_CARGO_CONTEXT_CONFLICT");
  await assertRejects(() => generateQuotationLines(db, { ...request(), weightPerContainerKg: 9000 }), Error, "SCENARIO_CARGO_CONTEXT_CONFLICT");
  await assertRejects(() => generateQuotationLines(db, { ...request(), containers: [] }), Error, "SCENARIO_CARGO_CONTEXT_INVALID");
  assertEquals(db.reads, []);
});
Deno.test("scenario v2 actual engine: weight threshold applies per group, never to a cross-group average", async () => {
  const c: ScenarioCargoContext = { schema_version: 2, cargo_units: [unit("heavy", { quantity: 2, gross_weight_kg: 25000 }), unit("light", { quantity: 3, gross_weight_kg: 5000 })] };
  const result = await generateQuotationLines(fakeDb(), { ...request(c), finalDestination: "Kaolack", includeLocalTransport: true });
  const transport = result.lines.filter(l => l.id.startsWith("transport_"));
  assertEquals(transport.map(l => l.amount), [4000, 3000]);
});
Deno.test("scenario v2 wiring: one engine call, scenario-only ledger, unchanged canonical paths", () => {
  const code = Deno.readTextFileSync(new URL("../run-scenario-pricing/index.ts", import.meta.url));
  assertEquals((code.match(/await fetch\(engineUrl/g) ?? []).length, 1);
  assert(code.includes("scenarioCargoContext: cargoContext"));
  assert(code.includes('overlay.assumptionKeys.add("scenario.cargo_units")'));
  assert(code.indexOf("buildScenarioCargoPricing(buildPricingInputs") < code.indexOf("await fetch(engineUrl"));
  assert(code.includes("record_quote_scenario_pricing"));
  for (const forbidden of ["supersede_fact", 'from("pricing_runs").insert', 'from("quote_facts").update']) assert(!code.includes(forbidden));
});
