// MULTI-LOT-TERMINAL-1 — LOCAL handler harness (GO CTO 2026-09-25). Not a production path.
// Loads the REAL Edge handlers (build-case-puzzle, run-pricing, quotation-engine,
// price-service-lines, manage-lot-confirmation, manage-pad-group-confirmation) with
// `jsr:@supabase/supabase-js@2` mapped to ./supabase-psql.ts (offline Docker PostgreSQL).
// Function-to-function calls are routed to the captured handlers; the Lovable AI gateway is
// replaced by deterministic synthetic answers (multi-quote lines; every other prompt → HTTP 503,
// i.e. the handlers' own non-AI fallbacks). Nothing leaves the machine.
import { runSql, SYNTHETIC_TOKEN, failingRpcs } from "./supabase-psql.ts";
export { runSql, SYNTHETIC_TOKEN, failingRpcs };

export const SUPABASE_URL = "http://dcq-local.invalid";
for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_ANON_KEY: "synthetic-anon", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
  LOVABLE_API_KEY: "synthetic-ai-key" })) Deno.env.set(k, v);
for (const k of ["RUN_PRICING_DISABLE_SERVE", "QUOTATION_ENGINE_DISABLE_SERVE"]) Deno.env.delete(k);

type Handler = (req: Request) => Response | Promise<Response>;
const handlers = new Map<string, Handler>();
let capturing = "";
Object.defineProperty(Deno, "serve", { configurable: true, writable: true, value: (a: unknown, b?: unknown) => {
  const h = (typeof a === "function" ? a : b) as Handler;
  if (!capturing || typeof h !== "function") throw new Error("HARNESS: unexpected Deno.serve");
  handlers.set(capturing, h);
  return { finished: Promise.resolve(), shutdown: () => Promise.resolve(), ref() {}, unref() {}, addr: { hostname: "local", port: 0 } };
} });

/** Synthetic multi-quote answer returned for the next builds (null → HTTP 503). */
export const ai: { multiQuoteLines: unknown[] | null; calls: string[] } = { multiQuoteLines: null, calls: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url.startsWith(`${SUPABASE_URL}/functions/v1/`)) {
    const name = url.slice(`${SUPABASE_URL}/functions/v1/`.length).split(/[/?]/)[0];
    const h = handlers.get(name);
    if (!h) throw new Error(`HARNESS: no local handler for ${name}`);
    return await h(input instanceof Request ? input : new Request(url, init));
  }
  if (url.startsWith("https://ai.gateway.lovable.dev/")) {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const system = String(body?.messages?.[0]?.content ?? "");
    if (system.includes("freight quotation analyst")) {
      ai.calls.push("multi-quote");
      if (!ai.multiQuoteLines) return new Response("synthetic unavailable", { status: 503 });
      return Response.json({ choices: [{ message: { content: JSON.stringify({ lines: ai.multiQuoteLines }) } }] });
    }
    ai.calls.push("other-ai");
    return new Response("synthetic unavailable", { status: 503 });
  }
  void realFetch;
  throw new Error(`HARNESS: network call refused (${url})`);
}) as typeof fetch;

const root = new URL("../../supabase/functions/", import.meta.url);
async function load(name: string, dir: URL = root) {
  capturing = name;
  try { await import(new URL(`${name}/index.ts`, dir).href); } finally { capturing = ""; }
  if (!handlers.has(name)) throw new Error(`HARNESS: ${name} did not register a handler`);
}
export async function loadHandlers(dir: URL = root) {
  for (const n of ["quotation-engine", "price-service-lines", "build-case-puzzle", "run-pricing"]) await load(n, dir);
  // Absent from the base commit (baseline run): only loaded when present.
  const lotUrl = new URL("manage-lot-confirmation/index.ts", dir);
  if (await Deno.stat(lotUrl).then(() => true, () => false)) {
    const lot = await import(lotUrl.href);
    handlers.set("manage-lot-confirmation", (r) => lot.handleRequest(r));
  }
  const pad = await import(new URL("manage-pad-group-confirmation/index.ts", dir).href);
  handlers.set("manage-pad-group-confirmation", (r) => pad.handleRequest(r));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- handler responses are untyped JSON inspected by the path assertions
export async function call(name: string, body: unknown): Promise<{ status: number; json: any }> {
  const h = handlers.get(name);
  if (!h) throw new Error(`HARNESS: ${name} not loaded`);
  const res = await h(new Request(`${SUPABASE_URL}/functions/v1/${name}`, { method: "POST",
    headers: { Authorization: `Bearer ${SYNTHETIC_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  const text = await res.text();
  let json: unknown = text; try { json = JSON.parse(text); } catch { /* raw text kept */ }
  return { status: res.status, json };
}

export async function sql(text: string): Promise<string> {
  const r = await runSql(text);
  if (r.error) throw new Error(`${r.error.code} ${r.error.message}`);
  return r.out;
}
export const q = (v: unknown) => v === null || v === undefined ? "NULL" : `'${(typeof v === "string" ? v : JSON.stringify(v)).replaceAll("'", "''")}'`;
