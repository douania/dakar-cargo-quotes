import { assertEquals } from "jsr:@std/assert";
import { handleRequest } from "./index.ts";
const body = { case_id: "11111111-1111-4111-8111-111111111111", unit_ref: "lot-1", equipment_code: "20GP", quantity: 1, ownership: "SOC" };
const req = (b: unknown = body) => new Request("https://test.invalid", { method: "POST", body: JSON.stringify(b) });
function fixture(options: { denied?: boolean; alias?: boolean; incomplete?: boolean; different?: boolean; gotrans?: boolean } = {}) {
  const tables: string[] = []; let aiCalls = 0;
  const deps = {
    authenticate: async () => ({ token: "test", userId: "u" }),
    client: (_url: string, key: string, config: { global: { headers: { Authorization: string } } }) => {
      assertEquals(key, "anon-test"); assertEquals(config.global.headers.Authorization, "Bearer test");
      return { from(table: string) {
        tables.push(table);
        let value: unknown;
        if (table === "quote_cases") value = options.denied ? null : { id: body.case_id };
        if (table === "quote_scenario_selections") value = { scenario_id: "s" };
        if (table === "quote_scenarios") value = { id: "s", scope_hash: "h", status: "draft", scope_snapshot: {
          schema_version: 2, transport_mode: "MARITIME", movement_direction: "IMPORT", cargo_units: [
            { ...body, quantity: options.different ? 2 : 1, unit_kind: "CONTAINER", scenario_basis: options.gotrans ? "storage cabinets" : "transformers",
              un_number: options.gotrans ? "UN3536" : null, gross_weight_kg: options.gotrans ? 55000 : 18000, weight_basis: "per_unit" },
            { unit_ref: "spares", scenario_basis: "spare parts", un_number: null, dangerous_goods: null }],
        } };
        if (table === "terminal_designations") value = [{ id: "d", designation_label: "Transformateurs", storage_code_p1: "414", unit_basis: "tonne_per_day" }];
        if (table === "terminal_designation_aliases") value = options.alias ? [{ terminal_designation_id: "d", normalized_term: "transformers", is_validated: true }] : [];
        const response = { data: value, error: null, count: options.incomplete ? 1002 : Array.isArray(value) ? value.length : null };
        const chain = { select: () => chain, eq: () => chain, is: () => chain, order: () => chain, limit: () => chain,
          maybeSingle: () => Promise.resolve(response), then: (resolve: (v: unknown) => unknown) => Promise.resolve(response).then(resolve) };
        return chain;
      } };
    },
    ai: async () => { aiCalls++; return new Response("{}"); },
    parse: async () => JSON.stringify({ candidates: [{ designation_id: "d", justification: "Nature électrique" }, { designation_id: "fake", justification: "Faux" }] }),
  };
  return { deps: deps as unknown as NonNullable<Parameters<typeof handleRequest>[1]>, tables, aiCalls: () => aiCalls };
}
Deno.env.set("SUPABASE_URL", "https://test.invalid"); Deno.env.set("SUPABASE_ANON_KEY", "anon-test");
Deno.test("read-only caller-scoped proposal: alias requires contextual review and keeps catalogue code", async () => {
  const f = fixture({ alias: true }); const res = await handleRequest(req(), f.deps); const data = await res.json();
  assertEquals(res.status, 200); assertEquals(data.candidates[0].code, "414"); assertEquals(f.aiCalls(), 1);
});
Deno.test("AI unavailable never falls back to an unchecked exact alias", async () => {
  const f = fixture({ alias: true }); f.deps.ai = async () => new Response("", { status: 503 });
  const data = await (await handleRequest(req(), f.deps)).json();
  assertEquals(data.candidates, []);
});
Deno.test("context payload includes target UN and weight but never assigns them to spare parts", async () => {
  const f = fixture({ gotrans: true });
  f.deps.ai = async (messages) => {
    const payload = JSON.parse(String(messages[1].content));
    assertEquals(payload.target.scenario_basis, "storage cabinets");
    assertEquals(payload.target.un_number, "UN3536");
    assertEquals(payload.target.gross_weight_kg, 55000);
    assertEquals(payload.context[1].un_number, null);
    assertEquals(payload.context[1].dangerous_goods, null);
    return new Response("{}");
  };
  assertEquals((await handleRequest(req(), f.deps)).status, 200);
});
Deno.test("AI uses catalogue IDs; fabricated ID discarded", async () => {
  const f = fixture(); const res = await handleRequest(req(), f.deps); const data = await res.json();
  assertEquals(res.status, 200); assertEquals(data.candidates.length, 1); assertEquals(f.aiCalls(), 1);
});
Deno.test("denied case, changed lot and truncated catalogue fail before AI", async () => {
  for (const [options, status] of [[{ denied: true }, 403], [{ different: true }, 409], [{ incomplete: true }, 503]] as const) {
    const f = fixture(options); assertEquals((await handleRequest(req(), f.deps)).status, status); assertEquals(f.aiCalls(), 0);
  }
});
Deno.test("authentication and request shape fail before reads", async () => {
  const f = fixture(); f.deps.authenticate = async () => new Response("Unauthorized", { status: 401 });
  assertEquals((await handleRequest(req(), f.deps)).status, 401); assertEquals(f.tables.length, 0);
  const other = fixture(); assertEquals((await handleRequest(req({ ...body, amount: 99 }), other.deps)).status, 400); assertEquals(other.tables.length, 0);
});
