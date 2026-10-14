import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
const savedDisable = Deno.env.get("MAIL_FUNCTION_DISABLE_SERVE");
Deno.env.set("MAIL_FUNCTION_DISABLE_SERVE", "1");
const { handler } = await import("./index.ts");
if (savedDisable === undefined) Deno.env.delete("MAIL_FUNCTION_DISABLE_SERVE"); else Deno.env.set("MAIL_FUNCTION_DISABLE_SERVE", savedDisable);

const id = "11111111-1111-4111-8111-111111111111";
const password = ' synthetic "password\\ ';
type Mode = "ok" | "missing" | "invalid" | "unadmitted" | "admission-down" | "not-admin" | "rpc-error";
async function fixture(mode: Mode, data: unknown = { configId: id, password }) {
  const env = { SUPABASE_URL: "https://recovery-fixture.invalid", SUPABASE_ANON_KEY: "fake-anon",
    SUPABASE_SERVICE_ROLE_KEY: "fake-service", ADMIN_EMAIL_ALLOWLIST: mode === "not-admin" ? "other@example.invalid" : "operator@example.invalid" };
  const oldEnv = Object.keys(env).map(key => Deno.env.get(key));
  Object.entries(env).forEach(([key, value]) => Deno.env.set(key, value));
  const oldFetch = globalThis.fetch, oldLog = console.log, oldError = console.error;
  const calls: Request[] = [], logs: unknown[][] = [];
  console.log = (...args) => logs.push(args); console.error = (...args) => logs.push(args);
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = (async (input, init) => {
    const req = new Request(input, init), url = new URL(req.url); calls.push(req);
    assertEquals(url.origin, env.SUPABASE_URL, "real network forbidden");
    if (url.pathname === "/auth/v1/user") return mode === "invalid" ? reply({ message: "bad JWT" }, 401)
      : reply({ id, email: "operator@example.invalid", aud: "authenticated" });
    if (url.pathname === "/rest/v1/rpc/has_workspace_access") {
      assertEquals(req.headers.get("apikey"), env.SUPABASE_ANON_KEY);
      return mode === "admission-down" ? reply({ message: "synthetic-private-detail" }, 503) : reply(mode !== "unadmitted");
    }
    assertEquals(url.pathname, "/rest/v1/rpc/replace_mailbox_secret", "no old secret or business row read");
    assertEquals(req.method, "POST"); assertEquals(req.headers.get("apikey"), env.SUPABASE_SERVICE_ROLE_KEY);
    assertEquals(await req.json(), { p_config_id: id, p_password: password });
    return mode === "rpc-error" ? reply({ message: password, details: "private-vault-detail" }, 400) : reply(null);
  }) as typeof fetch;
  try {
    const response = await handler(new Request("https://recovery-fixture.invalid/email-admin", { method: "POST",
      headers: { "Content-Type": "application/json", ...(mode === "missing" ? {} : { Authorization: "Bearer fake-jwt" }) },
      body: JSON.stringify({ action: "replace_password", data }) }));
    const text = await response.text();
    assertEquals(text.includes(password), false); assertEquals(text.includes("private-vault-detail"), false);
    assertEquals(JSON.stringify(logs).includes(password), false); assertEquals(JSON.stringify(logs).includes("private-vault-detail"), false);
    return { status: response.status, body: JSON.parse(text), calls };
  } finally {
    globalThis.fetch = oldFetch; console.log = oldLog; console.error = oldError;
    Object.keys(env).forEach((key, i) => { if (oldEnv[i] === undefined) Deno.env.delete(key); else Deno.env.set(key, oldEnv[i]!); });
  }
}
for (const [mode, status] of [["missing", 401], ["invalid", 401], ["unadmitted", 403], ["admission-down", 503], ["not-admin", 403]] as const) {
  Deno.test(`Recovery: ${mode} stops before any credential write`, async () => {
    const result = await fixture(mode); assertEquals(result.status, status);
    assert(result.calls.every(req => /\/auth\/v1\/user$|\/rpc\/has_workspace_access$/.test(new URL(req.url).pathname)));
  });
}
Deno.test("Recovery: admitted allowlisted admin reaches only atomic replacement RPC", async () => {
  const result = await fixture("ok"); assertEquals(result.status, 200); assertEquals(result.body, { success: true });
  assertEquals(result.calls.length, 3);
});
Deno.test("Recovery: RPC failure is scrubbed from response and logs", async () => {
  const result = await fixture("rpc-error"); assertEquals(result.status, 400); assertEquals(result.body.success, false);
});
Deno.test("Recovery: malformed body never reaches Vault", async () => {
  for (const data of [null, {}, { configId: "bad", password }, { configId: id, password: {} }]) {
    const result = await fixture("ok", data); assertEquals(result.status, 400); assertEquals(result.calls.length, 2);
  }
});
