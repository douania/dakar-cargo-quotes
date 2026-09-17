import { assertEquals } from "jsr:@std/assert";
import { handleRequest } from "./index.ts";
import { proposeGroups } from "../_shared/scenario-proposal-domain.ts";
const sourceMail = { id: "22222222-2222-4222-8222-222222222222", from_address: "client@example.com", body_text: "1.1 transformers: 18t/unit, 20GP SOC" };
const body = { case_id: "11111111-1111-4111-8111-111111111111", unit_ref: "lot-1", equipment_code: "20GP", quantity: 1, ownership: "SOC" };
const req = (b: unknown = body) => new Request("https://test.invalid", { method: "POST", body: JSON.stringify(b) });
function fixture(options: { denied?: boolean; alias?: boolean; incomplete?: boolean; different?: boolean; gotrans?: boolean; version?: number; sourced?: boolean; sourceIncomplete?: boolean; weightBands?: boolean } = {}) {
  const tables: string[] = []; let aiCalls = 0;
  const deps = {
    authenticate: async () => ({ token: "test", userId: "u" }),
    client: (_url: string, key: string, config: { global: { headers: { Authorization: string } } }) => {
      assertEquals(key, "anon-test"); assertEquals(config.global.headers.Authorization, "Bearer test");
      return { from(table: string) {
        tables.push(table);
        let value: unknown;
        if (table === "quote_cases") value = options.denied ? null : { id: body.case_id, thread_id: options.sourced ? "thread" : null };
        if (table === "email_threads") value = { client_email: sourceMail.from_address };
        if (table === "emails") value = [sourceMail];
        if (table === "quote_facts") value = [];
        if (table === "quote_scenario_selections") value = { scenario_id: "s" };
        if (table === "quote_scenarios") value = { id: "s", scope_hash: "h", status: "draft", scope_snapshot: {
          schema_version: options.version ?? 2, transport_mode: "MARITIME", movement_direction: "IMPORT", cargo_units: [
            { ...body, quantity: options.different ? 2 : 1, unit_kind: "CONTAINER", scenario_basis: options.gotrans ? "storage cabinets" : "transformers",
              un_number: options.gotrans ? "UN3536" : null, gross_weight_kg: options.gotrans ? 55000 : 18000, weight_basis: "per_unit" },
            { unit_ref: "spares", scenario_basis: "spare parts", un_number: null, dangerous_goods: null }],
        } };
        if (table === "quote_scenarios" && options.sourced) (value as {scope_snapshot: {cargo_units: unknown}}).scope_snapshot.cargo_units = proposeGroups(sourceMail.from_address, [sourceMail]).groups.map(g => ({ ...body, unit_kind: "CONTAINER", scenario_basis: `e-mail ${sourceMail.id}; SHA256 test`, gross_weight_kg: g.weight_kg, weight_basis: g.weight_basis, un_number: g.un_number, imo_class: g.imo_class, dangerous_goods: g.dangerous }));
        if (table === "terminal_designations") value = [{ id: "d", designation_label: "Transformateurs", storage_code_p1: "414", unit_basis: "tonne_per_day" }];
        if (table === "terminal_designations" && options.weightBands) value = [
          { id: "d", designation_label: "TRANSFORMATEURS électriques plus de 1,500 à 3,000 kgs", storage_code_p1: "414", unit_basis: "tonne_per_day" },
          { id: "heavy", designation_label: "TRANSFORMATEURS électriques plus de 5,000 kgs", storage_code_p1: "414", unit_basis: "tonne_per_day" },
          { id: "excluded", designation_label: "APPAREILS ELECTRIQUES (sauf colis lourds)", storage_code_p1: "421", unit_basis: "tonne_per_day" },
        ];
        if (table === "terminal_designation_aliases") value = options.alias ? [{ terminal_designation_id: "d", normalized_term: "transformers", is_validated: true }] : [];
        const response = { data: value, error: null, count: options.incomplete || (options.sourceIncomplete && table === "emails") ? 1002 : Array.isArray(value) ? value.length : null };
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
Deno.test("server filters weight and exclusions before AI and rejects reintroduced IDs afterwards", async () => {
  const f = fixture({ weightBands: true, alias: true, sourced: true, version: 3 });
  f.deps.ai = async (messages) => {
    const payload = JSON.parse(String(messages[1].content));
    assertEquals(payload.catalog.map((r: {id: string}) => r.id), ["heavy"]);
    assertEquals(payload.lexical_candidates_to_verify, []);
    return new Response("{}");
  };
  f.deps.parse = async () => JSON.stringify({ candidates: [
    { designation_id: "d", justification: "plus proche malgré le poids" },
    { designation_id: "excluded", justification: "malgré exclusion" },
    { designation_id: "heavy", justification: "18 tonnes dépasse 5 tonnes" },
  ] });
  const res = await handleRequest(req(), f.deps); const data = await res.json();
  assertEquals(res.status, 200); assertEquals(data.candidates.map((r: {id: string}) => r.id), ["heavy"]);
  assertEquals(data.warning.includes("restriction non vérifiable"), true);
});
Deno.test("read-only caller-scoped proposal: alias requires contextual review and keeps catalogue code", async () => {
  const f = fixture({ alias: true }); const res = await handleRequest(req(), f.deps); const data = await res.json();
  assertEquals(res.status, 200); assertEquals(data.candidates[0].code, "414"); assertEquals(f.aiCalls(), 1);
});
Deno.test("AI unavailable never falls back to an unchecked exact alias", async () => {
  const f = fixture({ alias: true }); f.deps.ai = async () => new Response("", { status: 503 });
  const data = await (await handleRequest(req(), f.deps)).json();
  assertEquals(data.candidates, []);
});
Deno.test("versions 2 and 3 accepted, unknown future version rejected", async () => {
  for (const version of [2, 3, 4]) {
    const f = fixture({ version });
    assertEquals((await handleRequest(req(), f.deps)).status, version === 4 ? 422 : 200);
  }
});
Deno.test("v3 endpoint replaces email reference by sourced excerpt; incomplete email set fails before AI", async () => {
  const f = fixture({ version: 3, sourced: true });
  const res = await handleRequest(req(), f.deps); const data = await res.json();
  assertEquals(res.status, 200); assertEquals(data.description, sourceMail.body_text);
  assertEquals(data.source.includes(sourceMail.id), true); assertEquals(data.source_fingerprint.length, 64);
  const bad = fixture({ version: 3, sourced: true, sourceIncomplete: true });
  assertEquals((await handleRequest(req(), bad.deps)).status, 422); assertEquals(bad.aiCalls(), 0);
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
