import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { requireAdmin, requireUser } from "./auth.ts";

type Handler = (req: Request) => Promise<Response>;
const entries: Array<[string, Handler, number]> = [];
const initialEnv = new Map<string, string | undefined>();
for (const [key, value] of Object.entries({
  MAIL_FUNCTION_DISABLE_SERVE: "1", SUPABASE_URL: "https://workspace-fixture.invalid",
  SUPABASE_ANON_KEY: "fixture-anon", SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
  ADMIN_EMAIL_ALLOWLIST: "operator@example.invalid",
})) {
  initialEnv.set(key, Deno.env.get(key)); Deno.env.set(key, value);
}
for (const [name, status] of [
  // Empty import UID list is now rejected after admission, before mailbox data.
  ["sync-emails", 500], ["search-emails", 500], ["import-thread", 409],
  ["hydrate-email-body", 404], ["force-download-attachment", 404], ["email-admin", 200],
] as const) {
  const module = await import(`../${name}/index.ts`);
  entries.push([name, module.handler, status]);
}
// Capture the real frozen entrypoints without opening any server or altering engines.
const savedServe = Deno.serve;
try {
  for (const [name, envKey] of [["run-pricing", "RUN_PRICING_DISABLE_SERVE"], ["build-case-puzzle", "BUILD_CASE_PUZZLE_DISABLE_SERVE"]]) {
    const old = Deno.env.get(envKey); Deno.env.set(envKey, "0");
    let captured: Handler | undefined;
    Deno.serve = ((handler: Handler) => { captured = handler; return {} as Deno.HttpServer; }) as typeof Deno.serve;
    await import(`../${name}/index.ts`);
    assert(captured, `${name}: real entrypoint captured`);
    entries.push([name, captured, 400]);
    if (old === undefined) Deno.env.delete(envKey); else Deno.env.set(envKey, old);
  }
} finally {
  Deno.serve = savedServe;
  for (const [key, value] of initialEnv) {
    if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
  }
}

function request(name = "fixture", token: string | null = "fixture-token", method = "POST") {
  return new Request(`https://workspace-fixture.invalid/${name}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : {},
    ...(method === "POST" ? { body: JSON.stringify({ configId: "fixture-config", uids: [], email_id: "fixture-email", attachmentId: "fixture-attachment", action: "get_all" }) } : {}),
  });
}

async function fixture(mode: "allowed" | "denied" | "invalid" | "unavailable" | "not-boolean", run: (calls: Request[]) => Promise<void>) {
  const oldFetch = globalThis.fetch;
  const env = { SUPABASE_URL: "https://workspace-fixture.invalid", SUPABASE_ANON_KEY: "fixture-anon",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service", ADMIN_EMAIL_ALLOWLIST: "operator@example.invalid" };
  const oldEnv = Object.keys(env).map(key => Deno.env.get(key));
  Object.entries(env).forEach(([key, value]) => Deno.env.set(key, value));
  const calls: Request[] = [];
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json", "Content-Range": "0-0/0" },
  });
  globalThis.fetch = (async (input, init) => {
    const req = new Request(input, init); const url = new URL(req.url);
    assertEquals(url.origin, env.SUPABASE_URL, "real network forbidden"); calls.push(req);
    if (url.pathname === "/auth/v1/user") return mode === "invalid"
      ? reply({ message: "invalid JWT" }, 401) : reply({ id: "a7000000-0000-4000-8000-000000000001", email: "operator@example.invalid", aud: "authenticated" });
    if (url.pathname === "/rest/v1/rpc/has_workspace_access") {
      assertEquals(req.headers.get("Authorization"), "Bearer fixture-token");
      assertEquals(req.headers.get("apikey"), env.SUPABASE_ANON_KEY, "admission never uses service role");
      return mode === "unavailable" ? reply({ message: "synthetic-private-detail" }, 503)
        : reply(mode === "not-boolean" ? "true" : mode === "allowed");
    }
    assertEquals(mode, "allowed", "no business request before admission");
    assertEquals(req.method === "GET" || req.method === "HEAD", true, "fixture cannot write");
    const data = /email_configs|emails|email_attachments/.test(url.pathname) && url.searchParams.get("id") ? null : [];
    return req.method === "HEAD" ? new Response(null, { headers: { "Content-Range": "0-0/0" } }) : reply(data);
  }) as typeof fetch;
  try { await run(calls); } finally {
    globalThis.fetch = oldFetch;
    Object.keys(env).forEach((key, i) => { if (oldEnv[i] === undefined) Deno.env.delete(key); else Deno.env.set(key, oldEnv[i]!); });
  }
}

for (const [name, handler, positiveStatus] of entries) {
  for (const [mode, expected] of [["denied", 403], ["invalid", 401], ["unavailable", 503], ["not-boolean", 403]] as const) {
    Deno.test(`${name}: ${mode} admission stops before business data/IMAP`, async () => {
      await fixture(mode, async calls => {
        const result = await handler(request(name));
        assertEquals(result.status, expected);
        assert(calls.every(req => /\/auth\/v1\/user$|\/rpc\/has_workspace_access$/.test(new URL(req.url).pathname)));
        assertEquals((await result.text()).includes("synthetic-private-detail"), false);
      });
    });
  }
  Deno.test(`${name}: missing JWT and OPTIONS do not access a mailbox`, async () => {
    await fixture("allowed", async calls => {
      assertEquals((await handler(request(name, null))).status, 401);
      assertEquals((await handler(request(name, null, "OPTIONS"))).status, 200);
      assertEquals(calls.length, 0);
    });
  });
  Deno.test(`${name}: admitted operator reaches the existing entrypoint`, async () => {
    await fixture("allowed", async calls => {
      const result = await handler(request(name));
      assertEquals(result.status, positiveStatus);
      assert(calls.some(req => new URL(req.url).pathname.endsWith("/has_workspace_access")));
      await result.text();
    });
  });
}

Deno.test("admin allowlist remains required after workspace admission", async () => {
  await fixture("allowed", async () => {
    Deno.env.set("ADMIN_EMAIL_ALLOWLIST", "other@example.invalid");
    assertEquals((await requireAdmin(request())) instanceof Response, true);
    const response = await requireAdmin(request());
    assert(response instanceof Response); assertEquals(response.status, 403);
  });
});

Deno.test("central requireUser preserves actor/token only after admission", async () => {
  await fixture("allowed", async () => {
    const auth = await requireUser(request());
    assert(!(auth instanceof Response));
    assertEquals(auth.token, "fixture-token"); assertEquals(auth.user.email, "operator@example.invalid");
  });
});
