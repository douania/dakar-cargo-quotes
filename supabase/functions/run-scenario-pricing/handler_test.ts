/** Actual HTTP orchestration, with a fail-closed in-memory transport.
 * No socket, real JWT, database, tariff lookup or Cloud operation.
 * SQL atomicity/concurrency remains covered by the separate PostgreSQL tests.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleRequest } from "./index.ts";
import { validateScopeSnapshot } from "../manage-quote-scenario/domain.ts";
import { applyScenarioContainerTerminalLines, resolveScenarioContainerTerminal, type PricingFactRow } from "./domain.ts";

type Json = Record<string, unknown>;
const CASE = "11111111-1111-4111-8111-111111111111";
const SCENARIO = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const HASH = "a".repeat(64);
const ORIGIN = "https://scenario-test.invalid";
const AUTH = "Bearer synthetic-operator-token";

function group(ref: string, extra: Json = {}): Json {
  return { unit_ref: ref, unit_kind: "CONTAINER", equipment_code: "20hq", quantity: 4,
    packaging: "unknown", gross_weight_kg: 18000, chargeable_weight_kg: null, volume_dm3: null,
    temperature_control_required: false, temperature_setpoint_celsius: null, classification_status: "unknown",
    destination_ref: null, required_attachment_status: "not_required", dangerous_goods: true,
    un_number: "UN3536", imo_class: null, ownership: "SOC", weight_basis: "per_unit",
    scenario_basis: "Synthetic operator assumption, not client evidence", ...extra };
}
function fixture(air = false) {
  const cargoUnits = air ? [Object.fromEntries(Object.entries(group("air", {
    unit_kind: "PACKAGE", equipment_code: null, dangerous_goods: false,
  })).filter(([key]) => !["un_number", "imo_class", "ownership", "weight_basis", "scenario_basis"].includes(key)))] : [
    group("alpha"), group("beta", { quantity: 2, equipment_code: "40rf", ownership: "COC", dangerous_goods: false, un_number: null }),
    group("gamma", { quantity: 1, dangerous_goods: null, un_number: null, gross_weight_kg: null }),
  ];
  const snapshot: Json = { schema_version: air ? 1 : 2, transport_mode: air ? "AIR" : "MARITIME",
    movement_direction: "IMPORT", terminal_operation_mode: air ? null : "LOLO", cargo_units: cargoUnits };
  assert(validateScopeSnapshot(snapshot).ok);
  const facts: PricingFactRow[] = [
    { fact_key: "service.package", value_text: air ? "AIR_IMPORT_DAP" : "DAP_PROJECT_IMPORT" },
    { fact_key: "routing.incoterm", value_text: "DAP" },
    { fact_key: "routing.destination_city", value_text: "Dakar" },
    { fact_key: "cargo.value", value_number: 100000 },
    { fact_key: "cargo.weight_kg", value_number: 999999 },
    { fact_key: "cargo.pad_category", value_text: "T02" },
    { fact_key: "cargo.pad_rate_fcfa_per_ton", value_number: 100 },
    ...(!air ? [
      { fact_key: "routing.terminal_operation_mode", value_text: "LOLO" },
      { fact_key: "cargo.containers", value_json: [{ type: "40HQ", quantity: 999 }] },
      { fact_key: "cargo.imo_class", value_text: "9" },
    ] : []),
  ].map((row, i) => ({ id: `synthetic-fact-${i}`, source_type: "email", confidence: 1, ...row }));
  return { snapshot, facts };
}

interface Options {
  v3Catalog?: boolean;
  incompleteCatalog?: boolean;
  air?: boolean;
  invalidAuth?: boolean;
  invisible?: boolean;
  staleHash?: boolean;
  unselected?: boolean;
  requestLines?: number;
  readError?: boolean;
  engineFailure?: "http" | "json";
  rpcConflict?: boolean;
  linkedAssumption?: boolean;
  terminalLines?: boolean;
  legacyEngine?: boolean;
  mutate?: (state: ReturnType<typeof fixture>) => void;
}

async function withTransport(options: Options, check: (h: {
  invoke: (authenticated?: boolean) => Promise<{ response: Response; body: Json }>;
  calls: { method: string; path: string; apiKey: string | null }[];
  engineBodies: Json[];
  rpcBodies: Json[];
  state: ReturnType<typeof fixture>;
}) => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const envKeys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  const saved = envKeys.map(key => Deno.env.get(key));
  const state = fixture(options.air);
  options.mutate?.(state);
  const originalState = JSON.stringify(state);
  const calls: { method: string; path: string; apiKey: string | null }[] = [];
  const unexpected: string[] = [];
  const engineBodies: Json[] = [];
  const rpcBodies: Json[] = [];
  const reply = (data: unknown, status = 200, headers = {}) => new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json", ...headers },
  });
  try {
    Deno.env.set("SUPABASE_URL", ORIGIN);
    Deno.env.set("SUPABASE_ANON_KEY", "synthetic-anon-key");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
    globalThis.fetch = (async (input, init) => {
      const req = new Request(input, init);
      const url = new URL(req.url);
      const path = url.pathname;
      const apiKey = req.headers.get("apikey");
      calls.push({ method: req.method, path, apiKey });
      if (url.origin !== ORIGIN) {
        unexpected.push(req.url);
        throw new Error("Non-synthetic destination refused");
      }
      if (path === "/auth/v1/user" && req.method === "GET") {
        assertEquals(apiKey, "synthetic-anon-key");
        assertEquals(req.headers.get("Authorization"), AUTH);
        return options.invalidAuth ? reply({ message: "Invalid token" }, 401) : reply({ id: ACTOR, aud: "authenticated" });
      }
      if (path === "/functions/v1/quotation-engine" && req.method === "POST") {
        assertEquals(req.headers.get("Authorization"), AUTH);
        engineBodies.push(await req.json());
        if (options.engineFailure === "http") return reply({ error: "Synthetic failure" }, 503);
        if (options.engineFailure === "json") return reply({ success: true, lines: "invalid" });
        return reply({ success: true, ...(options.legacyEngine ? {} : { metadata: {
          estimate_mode: "DAP_SERVICES_ONLY", duties_excluded: true, caf: null,
        } }), lines: [
          { id: "alpha-fee", unit_ref: "alpha", category: "DTHC", amount: 100, source: { type: "OFFICIAL" } },
          { id: "beta-fee", unit_ref: "beta", category: "TRUCKING", amount: 200, source: { type: "OFFICIAL" } },
          { id: "common-fee", category: "AGENCY", amount: 50, source: { type: "OFFICIAL" } },
          ...(options.terminalLines ? [
            { id: "thc_20hq_3", category: "Terminal (DPW)", description: "THC IMPORT 20HQ", amount: 465000, source: { type: "OFFICIAL", reference: "Synthetic homologated tariff" } },
            { id: "relevage_20hq_4", category: "Terminal (DPW)", description: "Relevage", amount: 123, source: { type: "OFFICIAL" } },
            { id: "warehouse_franchise", category: "Magasinage", description: "Franchise 10 jours", amount: 0, source: { type: "OFFICIAL" } },
          ] : []),
        ] });
      }
      if (path === "/rest/v1/rpc/record_quote_scenario_pricing_run" && req.method === "POST") {
        assertEquals(apiKey, "synthetic-service-key");
        const body = await req.json();
        rpcBodies.push(body);
        if (options.rpcConflict) return reply({ message: "IDEMPOTENCY_CONFLICT" }, 400);
        return reply({ pricing_run_id: "synthetic-run", scenario_id: SCENARIO, run_seq: 1,
          status: body.p_result.status, qualification: body.p_result.qualification, idempotent_replay: rpcBodies.length > 1 });
      }
      if (path === "/rest/v1/runtime_events" && req.method === "POST") {
        assertEquals(apiKey, "synthetic-service-key");
        return reply(null);
      }
      if (options.v3Catalog && req.method === "GET" && ["/rest/v1/port_tariffs", "/rest/v1/fee_lines", "/rest/v1/fee_rules"].includes(path)) {
        assertEquals(apiKey, "synthetic-service-key");
        if (path.endsWith("port_tariffs")) assert(!String(url.searchParams.get("select")).split(",").includes("currency"), "No currency column exists in port_tariffs");
        const rows = path.endsWith("port_tariffs") ? [
          { id:"synthetic-pad",provider:"PAD",category:"DROIT_PASSAGE",operation_type:"IMPORT",cargo_type:"CONTENEUR",classification:"T02",amount:100,unit:"PER_TONNE",source_document:"Synthetic PAD source",evidence_level:"official",effective_date:"2025-01-01",expiry_date:null,is_active:true },
        ] : path.endsWith("fee_lines") ? [{ id:"synthetic-agency",code:"AGENCY",label_fr:"Agence",vat_applicable:true,is_active:true }] :
          [{ id:"synthetic-rule",fee_line_id:"synthetic-agency",method:"FIXED",amount:1000,currency:"XOF",effective_from:"2025-01-01",is_active:true }];
        return new Response(JSON.stringify(rows), { headers: { "Content-Type":"application/json", "Content-Range":`0-${rows.length-1}/${rows.length + (options.incompleteCatalog ? 1 : 0)}` } });
      }
      if (req.method === "GET" && path === "/rest/v1/quote_scenarios") {
        assertEquals(url.searchParams.get("id"), `eq.${SCENARIO}`);
        if (apiKey === "synthetic-anon-key") {
          assertEquals(req.headers.get("Authorization"), AUTH);
          assertEquals(url.searchParams.get("case_id"), `eq.${CASE}`);
          return reply(options.invisible ? null : { id: SCENARIO, case_id: CASE });
        }
        assertEquals(apiKey, "synthetic-service-key");
        return reply({ id: SCENARIO, case_id: CASE, status: "draft", scope_hash: options.staleHash ? "b".repeat(64) : HASH,
          scope_snapshot: state.snapshot, open_points: [] });
      }
      if (req.method === "HEAD" && path === "/rest/v1/quote_request_lines") {
        assertEquals(url.searchParams.get("case_id"), `eq.${CASE}`);
        return new Response(null, { headers: { "Content-Range": `*/${options.requestLines ?? 1}` } });
      }
      if (req.method === "GET" && path === "/rest/v1/quote_facts") {
        assertEquals(url.searchParams.get("case_id"), `eq.${CASE}`);
        assertEquals(url.searchParams.get("is_current"), "eq.true");
        return options.readError ? reply({ message: "Synthetic read error" }, 400) : reply(state.facts);
      }
      if (req.method === "GET" && path === "/rest/v1/quote_scenario_links") {
        assertEquals(url.searchParams.get("scenario_id"), `eq.${SCENARIO}`);
        return reply(options.linkedAssumption ? [{ assumption_id: "synthetic-assumption", reserve_code: null, open_point_key: null }] : []);
      }
      if (req.method === "GET" && path === "/rest/v1/quote_scenario_assumptions" && options.linkedAssumption) {
        assertEquals(url.searchParams.get("id"), "in.(synthetic-assumption)");
        return reply([{ id: "synthetic-assumption", status: "active", assumed_fact_key: "cargo.value",
          assumed_value_type: "number", assumed_value: 250000, statement: "Synthetic value assumption", basis: "operator_expertise" }]);
      }
      if (req.method === "GET" && path === "/rest/v1/quote_scenario_selections") {
        return reply(options.unselected ? null : { scenario_id: SCENARIO });
      }
      unexpected.push(`${req.method} ${path}`);
      throw new Error("Unlisted read/write refused");
    }) as typeof fetch;
    await check({ calls, engineBodies, rpcBodies, state, invoke: async (authenticated = true) => {
      const response = await handleRequest(new Request(`${ORIGIN}/functions/v1/run-scenario-pricing`, {
        method: "POST", headers: { "Content-Type": "application/json", ...(authenticated ? { Authorization: AUTH } : {}) },
        body: JSON.stringify({ case_id: CASE, scenario_id: SCENARIO, expected_scope_hash: HASH, idempotency_key: "synthetic-scenario-pricing-1" }),
      }));
      return { response, body: await response.json() };
    } });
    assertEquals(unexpected, [], "Only the isolated RPC and runtime log may be written");
    assertEquals(JSON.stringify(state), originalState, "Client facts and scenario snapshot are immutable");
  } finally {
    globalThis.fetch = originalFetch;
    envKeys.forEach((key, i) => saved[i] === undefined ? Deno.env.delete(key) : Deno.env.set(key, saved[i]!));
  }
}

Deno.test("scenario actual handler: v2 groups -> one engine call -> isolated persisted result", async () => {
  await withTransport({}, async h => {
    const { response, body } = await h.invoke();
    assertEquals(response.status, 200);
    assertEquals((body.data as Json).blockers, []);
    assertEquals(h.engineBodies.length, 1);
    assertEquals(h.rpcBodies.length, 1);
    const params = h.engineBodies[0].params as Json;
    assertEquals(h.engineBodies[0].action, "generate");
    assertEquals((params.containers as Json[]).map(c => [c.unit_ref, c.quantity, c.coc_soc]), [["alpha", 4, "SOC"], ["beta", 2, "COC"], ["gamma", 1, "SOC"]]);
    assertEquals((params.scenarioCargoContext as Json).cargo_units, h.state.snapshot.cargo_units);
    assert(!("cargoWeight" in params), "Unknown group weight must not use global weight");
    for (const key of ["imoClass", "unNumber", "isDangerous", "isIMO", "isHazmat"]) assert(!(key in params));
    const rpc = h.rpcBodies[0];
    assertEquals([rpc.p_case_id, rpc.p_scenario_id, rpc.p_actor_user_id, rpc.p_expected_scope_hash], [CASE, SCENARIO, ACTOR, HASH]);
    const result = rpc.p_result as Json;
    assertEquals([result.status, result.qualification, result.firm_total_ht, result.indicative_total_ht], ["success", "partial", 0, 350]);
    assertEquals(result.firm_total_ttc, 0);
    const lines = result.tariff_lines as Json[];
    assertEquals(lines.filter(l => l.id === "common-fee").length, 1);
    assertEquals(lines.filter(l => l.unit_ref).map(l => l.unit_ref), ["alpha", "beta"]);
    const reservations = result.reservations as Json[];
    assert(reservations.some(r => r.code === "SCENARIO_DG_UNKNOWN" && r.unit_ref === "gamma"));
    assert(reservations.some(r => r.code === "SCENARIO_OWNERSHIP_NOT_PRICED"));
    assertEquals(result.engine_request, params);
    assertEquals(result.scenario_snapshot, h.state.snapshot);
    assertEquals((result.facts_snapshot as Json[]).map(f => f.fact_key), h.state.facts.map(f => f.fact_key));
    const access = h.calls.findIndex(c => c.path === "/rest/v1/quote_scenarios" && c.apiKey === "synthetic-anon-key");
    const privileged = h.calls.findIndex(c => c.apiKey === "synthetic-service-key");
    assert(access >= 0 && privileged > access);
  });
});

Deno.test("scenario v3 actual route: PAD choices reach isolated result, fixed fee once, original engine remains v2", async () => {
  await withTransport({ v3Catalog:true, mutate: s => {
    s.snapshot.schema_version=3;
    s.snapshot.pad_choices=(s.snapshot.cargo_units as Json[]).map(u => ({unit_ref:u.unit_ref,category:"T02",basis:"Synthetic operator review"}));
  } }, async h => {
    assertEquals((await h.invoke()).response.status,200);
    const result=h.rpcBodies[0].p_result as Json; const lines=result.tariff_lines as Json[];
    assertEquals(result.status,"success");
    assertEquals(lines.filter(l=>l.category==="PAD_DROIT_PASSAGE").map(l=>l.amount),[7200,3600,null]);
    assertEquals(lines.filter(l=>l.category==="AGENCY").map(l=>l.amount),[1000]);
    assertEquals(lines.some(l=>l.id==="common-fee"),false);
    assertEquals(result.indicative_total_ht,12100); assertEquals(result.indicative_total_ttc,12280);
    assertEquals(((h.engineBodies[0].params as Json).scenarioCargoContext as Json).schema_version,2);
    assertEquals((result.scenario_snapshot as Json).schema_version,3);
    assertEquals(h.engineBodies.length,1);
  });
});

for (const mode of [null, "RORO", "CONRO"]) Deno.test(`scenario v3: no terminal fact retains container THC policy (${mode})`, async () => {
  await withTransport({ v3Catalog: true, terminalLines: true, mutate: s => {
    dakarContainerScope(s, mode);
    s.snapshot.schema_version = 3;
    s.snapshot.pad_choices = (s.snapshot.cargo_units as Json[]).map(u => ({ unit_ref: u.unit_ref, category: "T02", basis: "Synthetic review" }));
  } }, async h => {
    await h.invoke();
    const result = h.rpcBodies[0].p_result as Json;
    assertEquals(result.status, "success");
    assertEquals(result.blockers, []);
    assert((result.reservations as Json[]).some(r => r.code === "SCENARIO_CONTAINER_THC_OPERATOR_INDEPENDENT"));
    assertEquals(h.engineBodies.length, 1);
  });
});
Deno.test("scenario v3: incomplete catalogs preserve other prices and expose dedicated reserves", async () => {
  await withTransport({ v3Catalog: true, incompleteCatalog: true, mutate: s => {
    s.snapshot.schema_version = 3;
    s.snapshot.pad_choices = (s.snapshot.cargo_units as Json[]).map(u => ({ unit_ref: u.unit_ref, category: "T02", basis: "Synthetic review" }));
  } }, async h => {
    await h.invoke(); const result = h.rpcBodies[0].p_result as Json;
    assertEquals(result.status, "success");
    for (const code of ["PAD_CATALOG_UNAVAILABLE", "SCENARIO_FEE_CATALOG_UNAVAILABLE"])
      assert((result.reservations as Json[]).some(r => r.code === code));
    assert((result.tariff_lines as Json[]).filter(l => ["PAD_DROIT_PASSAGE", "AGENCY"].includes(String(l.category))).every(l => l.amount === null));
  });
});
Deno.test("scenario v3: non-DAP never silently ignores per-group PAD choices", async () => {
  await withTransport({ mutate: s => {
    s.snapshot.schema_version = 3;
    s.snapshot.pad_choices = (s.snapshot.cargo_units as Json[]).map(u => ({ unit_ref: u.unit_ref, category: "T02", basis: "Synthetic review" }));
    s.facts.find(f => f.fact_key === "routing.incoterm")!.value_text = "DDP";
  } }, async h => {
    await h.invoke();
    const result = h.rpcBodies[0].p_result as Json;
    assertEquals(result.status, "blocked");
    assert((result.blockers as string[]).includes("SCENARIO_PAD_PRICING_SCOPE_UNSUPPORTED"));
    assertEquals(h.engineBodies.length, 0);
  });
});

Deno.test("scenario actual handler: linked assumption reaches engine without replacing original facts", async () => {
  await withTransport({ linkedAssumption: true }, async h => {
    assertEquals((await h.invoke()).response.status, 200);
    assertEquals(h.engineBodies.length, 1);
    assertEquals((h.engineBodies[0].params as Json).cargoValue, 250000);
    const result = h.rpcBodies[0].p_result as Json;
    assertEquals((result.facts_snapshot as Json[]).find(f => f.fact_key === "cargo.value")?.value_number, 100000);
    assertEquals((result.assumptions_snapshot as Json[])[0].assumed_value, 250000);
    assertEquals(result.firm_total_ht, 0);
  });
});

for (const [name, options, code] of [
  ["contradictory group", { mutate: (s: ReturnType<typeof fixture>) => { (s.snapshot.cargo_units as Json[])[0].imo_class = "3"; } }, "SCENARIO_IMO_CONFLICT:alpha"],
  ["not selected", { unselected: true }, "SCENARIO_NOT_SELECTED"],
  ["multiple request lines", { requestLines: 2 }, "SCENARIO_MULTI_LOT_UNSUPPORTED"],
  ["AIR with unscoped danger", { air: true, mutate: (s: ReturnType<typeof fixture>) => { s.facts.push({ id: "synthetic-dg", fact_key: "cargo.un_number", value_text: "UN3536" }); } }, "SCENARIO_DG_FACTS_UNSCOPED_AIR"],
] as const) {
  Deno.test(`scenario actual handler: ${name} persists blocked with no engine call`, async () => {
    await withTransport(options, async h => {
      assertEquals((await h.invoke()).response.status, 200);
      assertEquals(h.engineBodies, []);
      assertEquals(h.rpcBodies.length, 1);
      const result = h.rpcBodies[0].p_result as Json;
      assertEquals(result.status, "blocked");
      assert((result.blockers as string[]).includes(code));
      assertEquals(result.tariff_lines, []);
      assertEquals(result.engine_request, null);
      assertEquals(result.firm_total_ht, null);
    });
  });
}

Deno.test("scenario actual handler: AIR v1 keeps its weight-based path", async () => {
  await withTransport({ air: true }, async h => {
    assertEquals((await h.invoke()).response.status, 200);
    assertEquals(h.engineBodies.length, 1);
    const params = h.engineBodies[0].params as Json;
    assertEquals(params.transportMode, "aerien");
    assertEquals(params.cargoWeight, 999.999);
    assert(!("scenarioCargoContext" in params));
    assertEquals((h.rpcBodies[0].p_result as Json).status, "success");
  });
});

for (const dg of [false, true]) {
  Deno.test(`scenario actual handler: AIR containers get a dedicated blocker, DG=${dg}`, async () => {
    await withTransport({ air: true, mutate: s => {
      s.facts.push({ id: "synthetic-containers", fact_key: "cargo.containers", value_json: [{ type: "20HQ", quantity: 2 }] });
      if (dg) s.facts.push({ id: "synthetic-dg", fact_key: "cargo.un_number", value_text: "UN3536" });
    } }, async h => {
      const { response, body } = await h.invoke();
      assertEquals(response.status, 200);
      assertEquals((body.data as Json).blockers, ["SCENARIO_CONTAINERS_UNSCOPED_AIR", ...(dg ? ["SCENARIO_DG_FACTS_UNSCOPED_AIR"] : [])]);
      assertEquals(h.engineBodies, []);
      assertEquals(h.rpcBodies.length, 1);
      const result = h.rpcBodies[0].p_result as Json;
      assertEquals(result.status, "blocked");
      assertEquals(result.scenario_snapshot, h.state.snapshot);
      assertEquals(result.tariff_lines, []);
      assertEquals(result.engine_request, null);
      assertEquals(result.indicative_total_ht, null);
    });
  });
}

for (const [name, options, status, authenticated] of [
  ["missing auth", {}, 401, false], ["invalid auth", { invalidAuth: true }, 401, true],
  ["RLS-invisible scenario", { invisible: true }, 403, true], ["stale hash", { staleHash: true }, 409, true],
  ["facts read failure", { readError: true }, 500, true],
] as const) {
  Deno.test(`scenario actual handler: ${name} does not price or persist`, async () => {
    await withTransport(options, async h => {
      assertEquals((await h.invoke(authenticated)).response.status, status);
      assertEquals(h.engineBodies, []);
      assertEquals(h.rpcBodies, []);
      if (status === 401 || status === 403) assert(!h.calls.some(c => c.apiKey === "synthetic-service-key"));
    });
  });
}

for (const engineFailure of ["http", "json"] as const) {
  Deno.test(`scenario actual handler: engine ${engineFailure} failure cannot become a priced result`, async () => {
    await withTransport({ engineFailure }, async h => {
      assertEquals((await h.invoke()).response.status, 200);
      assertEquals(h.engineBodies.length, 1);
      const result = h.rpcBodies[0].p_result as Json;
      assertEquals(result.status, "failed");
      assertEquals(result.tariff_lines, []);
      assertEquals(result.indicative_total_ht, null);
    });
  });
}

Deno.test("scenario actual handler: replay sends stable identity/fingerprint and exposes RPC replay", async () => {
  await withTransport({}, async h => {
    await h.invoke();
    const replay = await h.invoke();
    assertEquals((replay.body.data as Json).idempotent_replay, true);
    assertEquals(h.rpcBodies.length, 2);
    for (const key of ["p_idempotency_key", "p_request_fingerprint", "p_expected_scope_hash", "p_actor_user_id"]) {
      assertEquals(h.rpcBodies[0][key], h.rpcBodies[1][key]);
    }
    assert(/^[a-f0-9]{64}$/.test(String(h.rpcBodies[0].p_request_fingerprint)));
  });
});
Deno.test("scenario actual handler: RPC idempotency conflict is returned, never hidden", async () => {
  await withTransport({ rpcConflict: true }, async h => {
    const result = await h.invoke();
    assertEquals(result.response.status, 409);
    assertEquals((result.body.error as Json).code, "CONFLICT_INVALID_STATE");
    assertEquals(h.rpcBodies.length, 1);
  });
});

function dakarContainerScope(state: ReturnType<typeof fixture>, mode: string | null = null) {
  state.snapshot.terminal_operation_mode = mode;
  state.facts = state.facts.filter(f => f.fact_key !== "routing.terminal_operation_mode");
  state.facts.push({ id: "synthetic-dakar", fact_key: "routing.origin_port", value_text: "Dakar Port" });
}

for (const mode of [null, "RORO", "CONRO"]) {
  Deno.test(`scenario container THC: operator-independent ${mode}, annexes null not zero`, async () => {
    await withTransport({ terminalLines: true, mutate: s => dakarContainerScope(s, mode) }, async h => {
      assertEquals((await h.invoke()).response.status, 200);
      assertEquals(h.engineBodies.length, 1);
      const result = h.rpcBodies[0].p_result as Json;
      assertEquals(result.blockers, []);
      assertEquals(result.qualification, "partial");
      assertEquals(result.indicative_total_ht, 465350);
      assertEquals(result.firm_total_ht, 0);
      const lines = result.tariff_lines as Json[];
      const thc = lines.find(l => l.id === "thc_20hq_3")!;
      assertEquals([thc.amount, thc.category, (thc.source as Json).reference], [465000, "DTHC", "Synthetic homologated tariff"]);
      for (const id of ["relevage_20hq_4", "warehouse_franchise"]) {
        const line = lines.find(l => l.id === id)!;
        assertEquals(line.amount, null);
        assertEquals((line.source as Json).type, "TO_CONFIRM");
      }
      assert((result.reservations as Json[]).some(r => r.code === "SCENARIO_CONTAINER_THC_OPERATOR_INDEPENDENT"));
      assert((result.reservations as Json[]).some(r => r.code === "SCENARIO_TERMINAL_ANCILLARIES_TO_CONFIRM"));
      assertEquals((result.scenario_snapshot as Json).terminal_operation_mode, mode);
      assert(!(result.facts_snapshot as Json[]).some(f => f.fact_key === "routing.terminal_operation_mode"));
      assert(!("terminalOperationMode" in (h.engineBodies[0].params as Json)));
    });
  });
}

Deno.test("scenario container THC: replay preserves policy reserves and fingerprint", async () => {
  await withTransport({ terminalLines: true, mutate: s => dakarContainerScope(s) }, async h => {
    await h.invoke();
    const replay = await h.invoke();
    assertEquals((replay.body.data as Json).idempotent_replay, true);
    assertEquals(h.rpcBodies[0].p_request_fingerprint, h.rpcBodies[1].p_request_fingerprint);
    const first = h.rpcBodies[0].p_result as Json;
    const second = h.rpcBodies[1].p_result as Json;
    assertEquals(first.reservations, second.reservations);
    assertEquals(first.tariff_lines, second.tariff_lines);
    assertEquals(first.indicative_total_ht, second.indicative_total_ht);
  });
});

for (const [name, mutate, code] of [
  ["contradiction", (s: ReturnType<typeof fixture>) => { dakarContainerScope(s, "RORO"); s.facts.push({ id: "synthetic-mode", fact_key: "routing.terminal_operation_mode", value_text: "LOLO" }); }, "SCENARIO_TERMINAL_SCOPE_MISMATCH"],
  ["invalid declaration", (s: ReturnType<typeof fixture>) => { dakarContainerScope(s); s.facts.push({ id: "synthetic-mode", fact_key: "routing.terminal_operation_mode", value_text: "INVALID" }); }, "SCENARIO_TERMINAL_FACT_INVALID"],
  ["foreign port", (s: ReturnType<typeof fixture>) => { dakarContainerScope(s); s.facts.find(f => f.fact_key === "routing.origin_port")!.value_text = "Abidjan"; }, "TERMINAL_OPERATION_MODE_REQUIRED"],
] as const) {
  Deno.test(`scenario container THC: ${name} remains blocked`, async () => {
    await withTransport({ mutate }, async h => {
      const { body } = await h.invoke();
      assert((body.data as Json).blockers instanceof Array);
      assert(((body.data as Json).blockers as string[]).includes(code));
      assertEquals(h.engineBodies.length, 0);
    });
  });
}

Deno.test("scenario container THC: boundaries, explicit terminal, stable no-mutation adapter", () => {
  const s = fixture();
  dakarContainerScope(s);
  const policy = () => resolveScenarioContainerTerminal(s.snapshot, s.facts, ["DTHC"]);
  assert(policy().eligible);
  s.facts[ s.facts.length - 1 ].fact_key = "routing.destination_port";
  assert(policy().eligible);
  for (const key of ["schema_version", "transport_mode", "movement_direction", "cargo_units"]) {
    const original = s.snapshot[key];
    s.snapshot[key] = ({ schema_version: 1, transport_mode: "AIR", movement_direction: "EXPORT", cargo_units: [group("package", { unit_kind: "PACKAGE" })] } as Json)[key];
    assertEquals(policy().eligible, false, key);
    s.snapshot[key] = original;
  }
  assertEquals(resolveScenarioContainerTerminal(s.snapshot, s.facts, ["TRUCKING"]).eligible, false);
  // HEAD 24b108e already required exact equality outside this new Dakar policy.
  const unchangedAir = { ...s.snapshot, transport_mode: "AIR", terminal_operation_mode: "LOLO" };
  assertEquals(resolveScenarioContainerTerminal(unchangedAir, s.facts, []).blockers, ["SCENARIO_TERMINAL_SCOPE_MISMATCH"]);
  s.facts.push({ id: "synthetic-mode", fact_key: "routing.terminal_operation_mode", value_text: "LOLO" });
  assertEquals(policy().annexUncertain, false);
  assertEquals(policy().blockers, []);
  const lines = [{ id: "warehouse_franchise", category: "Magasinage", amount: 0 }];
  assertEquals(applyScenarioContainerTerminalLines(lines, policy()), lines);
  s.facts = s.facts.filter(f => f.fact_key !== "routing.terminal_operation_mode");
  const adapted = applyScenarioContainerTerminalLines(lines, policy());
  assertEquals(lines[0].amount, 0);
  assertEquals(adapted[0].amount, null);
  assertEquals(applyScenarioContainerTerminalLines(adapted, policy()), adapted);
});

for (const missing of ["pad", "value", "both"]) {
  Deno.test(`scenario DAP partial: missing ${missing} reserves only unpriced services and preserves replay`, async () => {
    await withTransport({ mutate: s => {
      dakarContainerScope(s);
      s.facts = s.facts.filter(f => !(missing !== "value" && f.fact_key.startsWith("cargo.pad_")) &&
        !(missing !== "pad" && f.fact_key === "cargo.value"));
    } }, async h => {
      await h.invoke();
      const result = h.rpcBodies[0].p_result as Json;
      assertEquals(result.blockers, []);
      assertEquals(result.status, "success");
      assertEquals(result.qualification, "partial");
      assertEquals(result.indicative_total_ht, 350);
      assertEquals(result.firm_total_ht, 0);
      const params = h.engineBodies[0].params as Json;
      assertEquals(params.scenarioPricingMode, "DAP_SERVICES_ONLY");
      if (missing !== "pad") assert(!("cargoValue" in params));
      const pad = (result.tariff_lines as Json[]).filter(l => l.category === "PAD_DROIT_PASSAGE");
      assertEquals(pad.length, 1);
      assertEquals(pad[0].amount, null);
      assertEquals((pad[0].source as Json).type, "TO_CONFIRM");
      assert((result.reservations as Json[]).some(r => r.code === "SCENARIO_DAP_SERVICES_ONLY"));
      if (missing !== "value") assert((result.reservations as Json[]).some(r => r.code === "SCENARIO_PAD_PENDING"));
      await h.invoke();
      assertEquals(h.rpcBodies[0].p_request_fingerprint, h.rpcBodies[1].p_request_fingerprint);
      const replay = h.rpcBodies[1].p_result as Json;
      for (const key of ["reservations", "tariff_lines", "indicative_total_ht", "engine_request", "facts_snapshot"])
        assertEquals(result[key], replay[key]);
    });
  });
}

for (const [name, options] of [
  ["AIR", { air: true }],
  ["incoterm DDP", { mutate: (s: ReturnType<typeof fixture>) => { s.facts.find(f => f.fact_key === "routing.incoterm")!.value_text = "DDP"; } }],
  ["package DDP prefix despite DAP", { mutate: (s: ReturnType<typeof fixture>) => { s.facts.find(f => f.fact_key === "service.package")!.value_text = "DDP_PROJECT_IMPORT"; } }],
  ["package DDP suffix despite DAP", { mutate: (s: ReturnType<typeof fixture>) => { s.facts.find(f => f.fact_key === "service.package")!.value_text = "AIR_IMPORT_DDP"; } }],
] as const) {
  Deno.test(`scenario services: ${name} still requires value and does not opt in`, async () => {
    await withTransport({ ...options, mutate: s => {
      if ("mutate" in options) options.mutate(s);
      s.facts = s.facts.filter(f => f.fact_key !== "cargo.value" && !f.fact_key.startsWith("cargo.pad_"));
    } }, async h => {
      await h.invoke();
      const result = h.rpcBodies[0].p_result as Json;
      assertEquals(result.status, "blocked");
      assert((result.blockers as string[]).includes("CARGO_VALUE_REQUIRED_FOR_SCENARIO_ENGINE"));
      if (name === "package DDP prefix despite DAP") assert((result.blockers as string[]).includes("PAD_CATEGORY_REQUIRED"));
      assertEquals(h.engineBodies, []);
    });
  });
}

Deno.test("scenario services: engine without mode acknowledgment never contributes amounts", async () => {
  await withTransport({ legacyEngine: true }, async h => {
    await h.invoke();
    const result = h.rpcBodies[0].p_result as Json;
    assertEquals(result.status, "failed");
    assertEquals(result.blockers, ["QUOTATION_ENGINE_MODE_NOT_ACKNOWLEDGED"]);
    assertEquals(result.tariff_lines, []);
    assertEquals(result.indicative_total_ht, null);
  });
});

Deno.test("scenario DAP services: transit retains the validated grouped path with no artificial valuation", async () => {
  await withTransport({ mutate: s => {
    s.snapshot.movement_direction = "TRANSIT";
    s.facts.find(f => f.fact_key === "service.package")!.value_text = "TRANSIT_REGIONAL_VIA_DAKAR";
    s.facts = s.facts.filter(f => f.fact_key !== "cargo.value");
  } }, async h => {
    await h.invoke();
    const result = h.rpcBodies[0].p_result as Json;
    assertEquals(result.status, "success");
    assertEquals(result.qualification, "partial");
    const params = h.engineBodies[0].params as Json;
    assertEquals(params.scenarioPricingMode, "DAP_SERVICES_ONLY");
    assert(!("cargoValue" in params));
  });
});
