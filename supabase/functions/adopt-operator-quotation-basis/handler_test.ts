import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";
const id = "11111111-1111-4111-8111-111111111111";
const payload = { case_id: id, scenario_id: id, scenario_pricing_run_id: id, expected_scope_hash: "a".repeat(64), idempotency_key: "synthetic-key" };
Deno.test("adoption endpoint: authenticated identity, RLS proof, freshness, closed request; no external I/O", async () => {
  const saved = new Map(["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].map(k => [k, Deno.env.get(k)]));
  Deno.env.set("SUPABASE_URL", "https://synthetic.invalid"); Deno.env.set("SUPABASE_ANON_KEY", "synthetic-anon"); Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service");
  const realFetch = globalThis.fetch;
  let mode = "ok";
  const calls: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init); const url = new URL(req.url);
    assertEquals(url.hostname, "synthetic.invalid");
    const body = req.method === "POST" ? await req.json() : {};
    calls.push({ url: url.pathname, body, auth: req.headers.get("Authorization") });
    const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/auth/v1/user") return mode === "invalid" ? response({ message: "invalid" }, 401) : response({ id, email: "test@example.invalid" });
    if (url.pathname.includes("quote_scenarios")) return response(mode === "forbidden" ? [] : [{ id, case_id: id, scope_hash: mode === "stale" ? "b".repeat(64) : payload.expected_scope_hash }]);
    if (url.pathname.includes("quote_scenario_pricing_runs")) return response([{ id, case_id: id, scenario_id: id, status: "success", qualification: "partial", scenario_scope_hash: payload.expected_scope_hash }]);
    if (url.pathname.endsWith("/rpc/adopt_operator_quotation_basis")) return response({ pricing_run_id: id, run_number: 2, idempotent_replay: false });
    if (url.pathname.includes("runtime_events")) return response(null, 201);
    throw new Error(`Unexpected I/O ${url.pathname}`);
  };
  const request = (value = payload, token = true) => new Request("https://synthetic.invalid/adopt", { method: "POST", headers: token ? { Authorization: "Bearer synthetic-user" } : {}, body: JSON.stringify(value) });
  try {
    assertEquals((await handler(request(payload, false))).status, 401);
    for (const [state, status] of [["invalid", 401], ["forbidden", 403], ["stale", 409]] as const) {
      mode = state; calls.length = 0; assertEquals((await handler(request())).status, status);
      assert(!calls.some(c => c.url.includes("/rpc/")));
    }
    mode = "ok"; calls.length = 0;
    assertEquals((await handler(request({ ...payload, amount: 1 } as typeof payload))).status, 400);
    assert(!calls.some(c => c.url.includes("/rpc/")));
    calls.length = 0; assertEquals((await handler(request())).status, 200);
    assert(calls.filter(c => c.url.includes("/rest/v1/quote_")).every(c => c.auth === "Bearer synthetic-user"));
    const rpc = calls.find(c => c.url.includes("/rpc/"))!;
    assertEquals(rpc.body.p_actor_user_id, id); assertEquals(rpc.body.p_scenario_pricing_run_id, id);
    assertEquals(Object.keys(rpc.body).sort(), ["p_actor_user_id", "p_case_id", "p_expected_scope_hash", "p_idempotency_key", "p_scenario_id", "p_scenario_pricing_run_id"]);
  } finally {
    globalThis.fetch = realFetch;
    for (const [key, value] of saved) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
