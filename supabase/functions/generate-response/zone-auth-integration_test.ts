import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fixtureZones, fixtureRates } from "../quotation-engine/zone-fixture.ts";
const flags = ["GENERATE_RESPONSE_DISABLE_SERVE", "QUOTATION_ENGINE_DISABLE_SERVE"];
const savedFlags = flags.map(key => Deno.env.get(key));
flags.forEach(key => Deno.env.set(key, "1"));
const { handleRequest: generate } = await import("./index.ts");
const { handleRequest: engine } = await import("../quotation-engine/index.ts");
flags.forEach((key, i) => savedFlags[i] === undefined ? Deno.env.delete(key) : Deno.env.set(key, savedFlags[i]!));

type Row = Record<string, unknown>;
const USERS: Record<string, string> = {
  "synthetic-user-A": "11111111-1111-4111-8111-111111111111",
  "synthetic-user-B": "22222222-2222-4222-8222-222222222222",
};
const EMAILS: Record<string, string> = {
  "synthetic-user-A": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "synthetic-user-B": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};
async function chain(options: { tokens?: string[]; deniedWorkspace?: boolean; revokedAtEngine?: boolean; expiredAtEngine?: boolean; engineFailure?: boolean; destination?: string | null; modern?: boolean } = {}) {
  const previousFetch = globalThis.fetch;
  const env = { SUPABASE_URL: "https://auth-chain-fixture.invalid", SUPABASE_ANON_KEY: "synthetic-anon", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service", LOVABLE_API_KEY: "synthetic-ai" };
  const previousEnv = Object.keys(env).map(key => Deno.env.get(key));
  Object.entries(env).forEach(([key, value]) => Deno.env.set(key, value));
  const authChecks: string[] = [], workspaceChecks: string[] = [], engineHeaders: string[] = [], enginePayloads: string[] = [];
  const drafts: Row[] = [{ id: "existing-draft", body_text: "Original draft must stay byte-for-byte intact", original_email_id: EMAILS["synthetic-user-A"] }];
  const originalDraft = JSON.stringify(drafts[0]);
  let extraction = 0, finalAi = 0;
  const counts = new Map<string, number>();
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init), url = new URL(req.url);
    const token = req.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
    const json = (data: unknown, status = 200) => Response.json(data, { status });
    if (url.hostname === "ai.gateway.lovable.dev") {
      const body = await req.json();
      if (body.tool_choice) {
        extraction++;
        return json({ choices: [{ message: { tool_calls: [{ function: { name: "extract_quotation_data", arguments: JSON.stringify({
          detected_language: "FR", request_type: "QUOTATION_REQUEST", can_quote_now: true, transport_mode: "maritime",
          destination: options.destination === undefined ? "Dakar" : options.destination, origin: "Jebel Ali", incoterm: "DAP",
          cargo_description: "SYNTHETIC", weight_kg: 1000, value: 500000, currency: "XOF", services_requested: ["customs_clearance"],
          missing_info: [], questions_to_ask: [], has_pi: false,
        }) } }] } }] });
      }
      finalAi++;
      return json({ choices: [{ message: { content: JSON.stringify({ greeting: "Bonjour", body_short: "Synthetic reply", closing: "Fin", signature: "Test", attachment_needed: false }) } }] });
    }
    assertEquals(url.hostname, "auth-chain-fixture.invalid", "No external network permitted");
    if (url.pathname === "/auth/v1/user") {
      authChecks.push(token); const count = (counts.get(token) ?? 0) + 1; counts.set(token, count);
      if (!USERS[token] || (options.expiredAtEngine && count > 1)) return json({ message: "Invalid synthetic token" }, 401);
      return json({ id: USERS[token], email: `${token}@example.invalid` });
    }
    if (url.pathname.endsWith("/rpc/has_workspace_access")) {
      workspaceChecks.push(token);
      return json(Boolean(USERS[token]) && !options.deniedWorkspace && !(options.revokedAtEngine && (counts.get(token) ?? 0) > 1));
    }
    if (url.pathname.endsWith('/rpc/begin_generation_email_lease')) return json({kind:'started'});
    if (url.pathname.endsWith('/rpc/finish_generation_email_lease')) return json({kind:'retained'});
    if (url.pathname === "/functions/v1/quotation-engine") {
      engineHeaders.push(token);
      const text = await req.text(); enginePayloads.push(text);
      if (options.engineFailure) return json({ error: "Synthetic unavailable engine" }, 503);
      // Real downstream handler and its real requireUser/workspace guards.
      return await engine(new Request(req.url, { method: req.method, headers: req.headers, body: text }));
    }
    if (url.pathname.startsWith("/functions/v1/")) return json({ suggested_lines: [], based_on_quotations: 0 });
    assert(url.pathname.startsWith("/rest/v1/"));
    const table = url.pathname.split("/").pop()!;
    if (req.method !== "GET" && req.method !== "HEAD") {
      if (table === "runtime_events") return json([]);
      assertEquals(table, "email_drafts", "No business mutation other than the synthetic new-draft insert");
      assertEquals(req.method, "POST", "Existing drafts must not be updated or deleted");
      const row = { ...await req.json(), id: `synthetic-new-${drafts.length}` };
      drafts.push(row); return json(row);
    }
    const tables: Record<string, Row[]> = {
      delivery_zones: fixtureZones, local_transport_rates: fixtureRates,
      emails: Object.entries(EMAILS).map(([key, id]) => ({ id, subject: `Synthetic ${key}`, body_text: "Synthetic quote request", from_address: `${key}@example.invalid`, sent_at: "2026-11-04T12:00:00Z", thread_ref: null })),
      email_drafts: drafts,
    };
    let rows = [...(tables[table] ?? [])];
    for (const [key, value] of url.searchParams) {
      if (value.startsWith("eq.")) rows = rows.filter(row => String(row[key]) === value.slice(3));
      if (value.startsWith("in.(")) {
        const values = value.slice(4, -1).split(",").map(v => v.replace(/^"|"$/g, ""));
        rows = rows.filter(row => values.includes(String(row[key])));
      }
    }
    return json(req.headers.get("accept")?.includes("vnd.pgrst.object") ? rows[0] ?? null : rows);
  };
  try {
    const outputs = await Promise.all((options.tokens ?? ["synthetic-user-A"]).map(async token => {
      const response = await generate(new Request("https://auth-chain-fixture.invalid/generate-response", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ emailId: EMAILS[token] ?? EMAILS["synthetic-user-A"], userId: USERS["synthetic-user-B"],
          token: "synthetic-user-B", zone_reply_contract: options.modern === false ? undefined : "optional_factor_v1" }),
      }));
      return { token, status: response.status, body: await response.json() };
    }));
    assertEquals(JSON.stringify(drafts[0]), originalDraft);
    return { outputs, drafts, authChecks, workspaceChecks, engineHeaders, enginePayloads, extraction, finalAi };
  } finally {
    globalThis.fetch = previousFetch;
    Object.keys(env).forEach((key, i) => previousEnv[i] === undefined ? Deno.env.delete(key) : Deno.env.set(key, previousEnv[i]!));
  }
}

Deno.test("real generation→engine chain forwards each validated user, never the service key or body identity", async () => {
  const result = await chain({ tokens: ["synthetic-user-A", "synthetic-user-B"] });
  assertEquals(result.outputs.map(r => r.status), [200, 200], JSON.stringify(result.outputs));
  assertEquals([...result.engineHeaders].sort(), ["synthetic-user-A", "synthetic-user-B"]);
  for (const token of Object.keys(USERS)) {
    assertEquals(result.authChecks.filter(t => t === token).length, 2);
    assertEquals(result.workspaceChecks.filter(t => t === token).length, 2);
    const output = result.outputs.find(r => r.token === token)!;
    assertEquals(output.body.data.draft.created_by, USERS[token]);
    assertEquals(output.body.data.draft.original_email_id, EMAILS[token]);
    assertEquals(output.body.data.quotation_metadata.zone_resolution.status, "matched");
  }
  assert(result.enginePayloads.every(p => !p.includes("synthetic-user-") && !p.includes("synthetic-service")));
  assertEquals(result.drafts.length, 3);
});
for (const token of ["synthetic-service", "synthetic-expired", "synthetic-tampered"]) {
  Deno.test(`entry rejects non-user or invalid identity ${token} before any AI/engine/draft`, async () => {
    const result = await chain({ tokens: [token] });
    assertEquals(result.outputs[0].status, 401);
    assertEquals(result.extraction, 0); assertEquals(result.finalAi, 0);
    assertEquals(result.engineHeaders, []); assertEquals(result.drafts.length, 1);
  });
}
Deno.test("workspace denial is not bypassed by a valid user or client capability", async () => {
  const result = await chain({ deniedWorkspace: true });
  assertEquals(result.outputs[0].status, 403);
  assertEquals(result.extraction, 0); assertEquals(result.engineHeaders, []); assertEquals(result.drafts.length, 1);
});
for (const options of [{ revokedAtEngine: true }, { expiredAtEngine: true }, { engineFailure: true }]) {
  Deno.test(`downstream refusal remains fail-closed and preserves existing draft ${JSON.stringify(options)}`, async () => {
    const result = await chain(options);
    assertEquals(result.outputs[0].status, 503);
    assertEquals(result.outputs[0].body.error.code, "ZONE_ENGINE_CONTRACT_NOT_READY");
    assertEquals(result.finalAi, 0); assertEquals(result.drafts.length, 1);
    assertEquals(result.engineHeaders, ["synthetic-user-A"]);
  });
}
for (const modern of [false, true]) {
  Deno.test(`unknown zone remains explicit with real engine; modern=${modern}`, async () => {
    const result = await chain({ destination: "Ville non documentée", modern });
    assertEquals(result.outputs[0].status, modern ? 200 : 409, JSON.stringify(result.outputs));
    if (modern) {
      assertEquals(result.outputs[0].body.data.quotation_metadata.zone_resolution.status, "unknown");
      assertEquals("complexity_factor" in result.outputs[0].body.data.sodatra_fees, false);
    } else assertEquals(result.drafts.length, 1);
  });
}
Deno.test("missing destination still refuses before downstream pricing or new draft", async () => {
  const result = await chain({ destination: null });
  assertEquals(result.outputs[0].status, 409);
  assertEquals(result.outputs[0].body.error.code, "ZONE_CONFIRMATION_REQUIRED");
  assertEquals(result.engineHeaders, []); assertEquals(result.finalAi, 0); assertEquals(result.drafts.length, 1);
});
