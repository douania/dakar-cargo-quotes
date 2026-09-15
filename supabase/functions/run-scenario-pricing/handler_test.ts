/** Actual HTTP orchestration, with a fail-closed in-memory transport.
 * No socket, real JWT, database, tariff lookup or Cloud operation.
 * SQL atomicity/concurrency remains covered by the separate PostgreSQL tests.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleRequest } from "./index.ts";
import { validateScopeSnapshot } from "../manage-quote-scenario/domain.ts";

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
  const facts: Json[] = [
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
        return reply({ success: true, lines: [
          { id: "alpha-fee", unit_ref: "alpha", category: "DTHC", amount: 100, source: { type: "OFFICIAL" } },
          { id: "beta-fee", unit_ref: "beta", category: "TRUCKING", amount: 200, source: { type: "OFFICIAL" } },
          { id: "common-fee", category: "AGENCY", amount: 50, source: { type: "OFFICIAL" } },
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
