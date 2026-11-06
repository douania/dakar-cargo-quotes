import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { NO_FILES_RECIPE, RECIPE_POLICY_ENV, resolveRecipeMode, recipeCaseReadRefusal, recipeAttachmentReadRefusal, recipeGeneratedLinkRefusal } from "./recipe-mode.ts";
import { fixtureZones, fixtureRates } from "../quotation-engine/zone-fixture.ts";
const flags = ["GENERATE_RESPONSE_DISABLE_SERVE", "QUOTATION_ENGINE_DISABLE_SERVE"];
const saved = flags.map(key => Deno.env.get(key)); flags.forEach(key => Deno.env.set(key, "1"));
const { handleRequest: generate } = await import("./index.ts");
const { handleRequest: engine } = await import("../quotation-engine/index.ts");
flags.forEach((key, i) => saved[i] === undefined ? Deno.env.delete(key) : Deno.env.set(key, saved[i]!));
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const EMAIL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CASE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", THREAD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd", ATT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const NOW = Date.parse("2026-11-04T12:15:00.000Z");
const policy = { actor_user_id: A, email_id: EMAIL, case_id: CASE, starts_at: "2026-11-04T12:00:00.000Z", expires_at: "2026-11-04T12:30:00.000Z" };
const body = { recipe_email_id: EMAIL, recipe_mode: NO_FILES_RECIPE };
const admitted = resolveRecipeMode(body, A, JSON.stringify(policy), NOW);
assert(admitted.allowed && admitted.context.mode === NO_FILES_RECIPE);
const context = admitted.context;

const cases: Array<[string, Record<string, unknown>, string, string | undefined, number, boolean, string]> = [
  ["production absent policy", { emailId: EMAIL }, A, undefined, NOW, true, "production"],
  ["disabled", body, A, undefined, NOW, false, "RECIPE_DISABLED"],
  ["admitted exact scope", body, A, JSON.stringify(policy), NOW, true, NO_FILES_RECIPE],
  ["bound target cannot omit flag", { emailId: EMAIL }, A, JSON.stringify(policy), NOW, false, "RECIPE_MODE_REQUIRED"],
  ["other user stays production", { emailId: EMAIL }, B, JSON.stringify(policy), NOW, true, "production"],
  ["other email stays production", { emailId: OTHER }, A, JSON.stringify(policy), NOW, true, "production"],
  ["other direct production", { quotationData: {} }, A, JSON.stringify(policy), NOW, true, "production"],
  ["forged user body rejected", { ...body, userId: A, actor_user_id: A }, B, JSON.stringify(policy), NOW, false, "RECIPE_SCOPE_FORBIDDEN"],
  ["wrong email", { ...body, recipe_email_id: OTHER }, A, JSON.stringify(policy), NOW, false, "RECIPE_SCOPE_FORBIDDEN"],
  ["recipe selector without mode cannot fall through", { recipe_email_id: EMAIL }, A, JSON.stringify(policy), NOW, false, "RECIPE_MODE_INVALID"],
  ["missing email", { recipe_mode: NO_FILES_RECIPE }, A, JSON.stringify(policy), NOW, false, "RECIPE_EMAIL_REQUIRED"],
  ["mixed direct data", { ...body, quotationData: {} }, A, JSON.stringify(policy), NOW, false, "RECIPE_PAYLOAD_INVALID"],
  ["null direct data", { ...body, quotationData: null }, A, JSON.stringify(policy), NOW, false, "RECIPE_PAYLOAD_INVALID"],
  ["unknown mode", { ...body, recipe_mode: "no_files_v2" }, A, undefined, NOW, false, "RECIPE_MODE_INVALID"],
  ["null mode", { ...body, recipe_mode: null }, A, undefined, NOW, false, "RECIPE_MODE_INVALID"],
  ["before window", body, A, JSON.stringify(policy), NOW - 3600000, false, "RECIPE_WINDOW_CLOSED"],
  ["expiry boundary", body, A, JSON.stringify(policy), Date.parse(policy.expires_at), false, "RECIPE_WINDOW_CLOSED"],
  ["expired omitted flag stays closed", { emailId: EMAIL }, A, JSON.stringify(policy), NOW + 3600000, false, "RECIPE_WINDOW_CLOSED"],
  ["expired other user stays production", { emailId: EMAIL }, B, JSON.stringify(policy), NOW + 3600000, true, "production"],
  ["uppercase target omission cannot escape", { emailId: EMAIL.toUpperCase() }, A, JSON.stringify(policy), NOW, false, "RECIPE_MODE_REQUIRED"],
  ["noncanonical alias cannot escape", { emailId: "{" + EMAIL + "}" }, A, JSON.stringify(policy), NOW, false, "RECIPE_EMAIL_REQUIRED"],
  ["corrupt policy never falls through", { emailId: OTHER }, B, "{bad", NOW, false, "RECIPE_POLICY_INVALID"],
  ["explicit policy removal restores production", { emailId: EMAIL }, A, undefined, NOW, true, "production"],
  ["empty configured policy is corrupt", { emailId: EMAIL }, A, "", NOW, false, "RECIPE_POLICY_INVALID"],
  ["whitespace configured policy is corrupt", { emailId: EMAIL }, A, "  ", NOW, false, "RECIPE_POLICY_INVALID"],
];
for (const key of ["emailId", "quotationData"]) for (const value of [undefined, null, "", {}]) {
  cases.push([`legacy field forbidden by presence ${key}=${JSON.stringify(value)}`, { ...body, [key]: value }, A, JSON.stringify(policy), NOW, false, "RECIPE_PAYLOAD_INVALID"]);
}
for (const [name, request, actor, config, clock, allowed, result] of cases) {
  Deno.test(`recipe policy: ${name}`, () => {
    const decision = resolveRecipeMode(request, actor, config, clock);
    assertEquals(decision.allowed, allowed);
    assertEquals(decision.allowed ? decision.context.mode : decision.code, result);
  });
}
for (const invalid of [null, [], {}, { ...policy, enabled: true }, { ...policy, actor_user_id: "service-role" }, { ...policy, case_id: "missing" }, { ...policy, starts_at: "2026-02-30T12:00:00Z" }, { ...policy, expires_at: "2026-11-05T12:00:00Z" }, { ...policy, expires_at: policy.starts_at }]) {
  Deno.test(`recipe policy invalid shape ${JSON.stringify(invalid)}`, () => {
    const result = resolveRecipeMode(body, A, JSON.stringify(invalid), NOW);
    assert(!result.allowed); assertEquals(result.code, "RECIPE_POLICY_INVALID");
  });
}
Deno.test("recipe context is frozen and only binds validated identity", () => {
  assert(Object.isFrozen(context)); assertEquals(context.actorId, A); assertEquals(context.emailId, EMAIL); assertEquals(context.caseId, CASE);
});
for (const data of [null, [], [{ id: CASE, thread_id: THREAD }, { id: CASE, thread_id: THREAD }], [{ id: OTHER, thread_id: THREAD }], [{ id: CASE, thread_id: OTHER }]]) {
  Deno.test(`recipe canonical case rejects missing/ambiguous/mismatched ${JSON.stringify(data)}`, () => assert(recipeCaseReadRefusal(context, { id: EMAIL, thread_ref: THREAD }, { data, error: null })));
}
Deno.test("recipe canonical case errors and missing thread fail closed", () => {
  assert(recipeCaseReadRefusal(context, { id: EMAIL, thread_ref: THREAD }, { data: [], error: new Error("private") }));
  assert(recipeCaseReadRefusal(context, { id: EMAIL }, { data: [{ id: CASE, thread_id: THREAD }], error: null }));
  assertEquals(recipeCaseReadRefusal(context, { id: EMAIL, thread_ref: THREAD }, { data: [{ id: CASE, thread_id: THREAD }], error: null }), null);
});
const attachment = { id: ATT, email_id: EMAIL, is_analyzed: true };
for (const read of [
  { data: null, count: 0, error: null }, { data: [], count: null, error: null }, { data: [], count: 1, error: null },
  { data: [], count: 1001, error: null }, { data: [], count: 0, error: new Error("private") },
  { data: [attachment, attachment], count: 2, error: null }, { data: [{ ...attachment, email_id: OTHER }], count: 1, error: null },
  ...[false, null, 1, undefined].map(is_analyzed => ({ data: [{ ...attachment, is_analyzed }], count: 1, error: null })),
]) {
  Deno.test(`recipe attachment completeness rejects ${JSON.stringify(read)}`, () => assert(recipeAttachmentReadRefusal(context, read)));
}
Deno.test("recipe accepts only complete already analyzed attachment reads", () => {
  assertEquals(recipeAttachmentReadRefusal(context, { data: [], count: 0, error: null }), null);
  assertEquals(recipeAttachmentReadRefusal(context, { data: [attachment], count: 1, error: null }), null);
});
for (const link of ["https://generated.invalid/download", "DATA:text/html;base64,abc", "[download](/file)", "<a href='/file'>x</a>", "www.generated.invalid", "mailto:test@example.invalid"]) {
  Deno.test(`recipe retained model output refuses links ${link}`, () => assert(recipeGeneratedLinkRefusal({ body_short: link })));
}
Deno.test("recipe discarded attachment payload cannot leak or trigger links guard", () => {
  assertEquals(recipeGeneratedLinkRefusal({ body_short: "Plain receipt", attachment_needed: true, attachment_data: { filename: "https://generated.invalid/x", posts: ["file:data"] } }), null);
});

type Row = Record<string, unknown>;
interface Options { draftAckId?: unknown; emailBody?: string | null; destination?: string; extractionFault?: "http" | "network"; finalFault?: "http" | "network" | "parse"; engineFault?: boolean; draftRejectCode?: string; draftMalformedAck?: boolean; request?: Record<string, unknown>; policyText?: string | null; token?: string; cases?: Row[] | null; caseError?: boolean; attachments?: Row[] | null; attachmentCount?: number | null; attachmentError?: boolean; attachmentOutput?: boolean; linkOutput?: boolean; changePolicy?: boolean; historical?: boolean; draftAckLost?: boolean; fileAckLost?: boolean; attachmentUpdateAckLost?: boolean; revokeAtEngine?: boolean; handler?: typeof generate; now?: number; ledgerPolicyText?: string | null; ledgerReady?: string | null; blockedEmails?: string | null; ledgerRpc?: (name: string, args: Record<string, unknown>) => Promise<{data:unknown;error:unknown}> }
export async function runRecipeFixture(options: Options = {}) {
  const originalFetch = globalThis.fetch, NativeDate = Date;
  let clock = options.now ?? NOW;
  globalThis.Date = new Proxy(NativeDate, { construct(target, args) { return Reflect.construct(target, args.length ? args : [clock]); }, get(target, name, receiver) { return name === "now" ? () => clock : Reflect.get(target, name, receiver); } });
  const env: Record<string, string | null> = { SUPABASE_URL: "https://recipe-fixture.invalid", SUPABASE_ANON_KEY: "synthetic-anon", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service", LOVABLE_API_KEY: "synthetic-ai", [RECIPE_POLICY_ENV]: options.policyText === undefined ? JSON.stringify(policy) : options.policyText, GENERATE_RESPONSE_RECIPE_V2_POLICY: options.ledgerPolicyText ?? null, GENERATE_RESPONSE_RECIPE_V2_READY: options.ledgerReady ?? null, GENERATE_RESPONSE_RECIPE_BLOCKED_EMAILS: options.blockedEmails ?? null };
  const previous = Object.keys(env).map(key => Deno.env.get(key));
  Object.entries(env).forEach(([key, value]) => value === null ? Deno.env.delete(key) : Deno.env.set(key, value));
  const drafts: Row[] = [{ id: "old-draft", original_email_id: EMAIL, body_text: "Preserve old draft exactly" }], originalDraft = JSON.stringify(drafts[0]);
  const attachments = options.attachments === undefined ? [{ ...attachment, filename: "synthetic.png", content_type: "image/png", size: 2, storage_path: "synthetic/input.png", extracted_text: "logo", extracted_data: { type: "logo" } }] : options.attachments;
  const requests: string[] = [], authTokens: string[] = [], engineTokens: string[] = [];
  let extraction = 0, finalAi = 0, generatedFiles = 0, storage = 0, attachmentUpdates = 0, usageUpdates = 0, runtimeEvents = 0;
  const json = (value: unknown, status = 200, headers?: Record<string, string>) => Response.json(value, { status, headers });
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init), url = new URL(req.url), token = req.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
    requests.push(`${req.method} ${url.pathname}${url.search}`);
    if (url.hostname === "ai.gateway.lovable.dev") {
      const content = await req.json();
      if (content.tool_choice) {
        extraction++;
        if(options.extractionFault === "network") throw new TypeError("Synthetic provider transport lost");
        if(options.extractionFault === "http") return json({error:"Synthetic provider refusal"},429);
        if (options.changePolicy) { clock += 7200000; Deno.env.delete(RECIPE_POLICY_ENV); }
        return json({ choices: [{ message: { tool_calls: [{ function: { name: "extract_quotation_data", arguments: JSON.stringify({ detected_language: "FR", request_type: "QUOTATION_REQUEST", can_quote_now: true, transport_mode: "maritime", destination: options.destination ?? "Dakar", origin: "Jebel Ali", incoterm: "DAP", cargo_description: "SYNTHETIC", containers: [{ type: "20GP", quantity: 1 }], weight_kg: 28000, value: 500000, currency: "XOF", services_requested: ["customs_clearance", "local_delivery"], missing_info: [], questions_to_ask: [], has_pi: false }) } }] } }] });
      }
      finalAi++;
      if(options.finalFault === "network") throw new TypeError("Synthetic provider transport lost");
      if(options.finalFault === "http") return json({error:"Synthetic provider refusal"},503);
      if(options.finalFault === "parse") return json({choices:[{message:{content:"NOT JSON"}}]});
      return json({ choices: [{ message: { content: JSON.stringify({ greeting: "Bonjour", body_short: options.linkOutput ? "Visit https://generated.invalid/file" : "Synthetic reply", closing: "Fin", signature: "Test", attachment_needed: options.attachmentOutput !== false, attachment_data: { filename: "overwrite-existing.html", posts: [{ description: "Synthetic", montant: 1, devise: "XOF" }], public_url: "https://generated.invalid/forged-signed" } }) } }] });
    }
    assertEquals(url.hostname, "recipe-fixture.invalid", "No external network allowed");
    if (url.pathname === "/auth/v1/user") { authTokens.push(token); return token === "synthetic-A" || token === "synthetic-B" ? json({ id: token === "synthetic-A" ? A : B, email: "test@example.invalid" }) : json({ message: "Invalid user" }, 401); }
    if (url.pathname.endsWith("/rpc/has_workspace_access")) return json(!(options.revokeAtEngine && authTokens.length > 1));
    if (url.pathname.includes('/rpc/') && /generation_recipe|generation_email_lease/.test(url.pathname)) {
      assertEquals(token, 'synthetic-service', 'Ledger RPCs use only the service client after requireUser');
      const name = url.pathname.split('/').pop()!, args = await req.json();
      const result = options.ledgerRpc ? await options.ledgerRpc(name,args)
        : {data:{kind:name==='begin_generation_email_lease'?'started':'retained'},error:null};
      return result.error ? json(result.error,400) : json(result.data);
    }

    if (url.pathname === "/functions/v1/quotation-engine") { engineTokens.push(token); if(options.engineFault) return json({error:"Synthetic engine unavailable"},503); return await engine(new Request(req.url, { method: req.method, headers: req.headers, body: await req.text() })); }
    if (url.pathname === "/functions/v1/generate-quotation-attachment") { generatedFiles++; if(options.fileAckLost) return json({message:"Synthetic unconfirmed file mutation"},500); return json({ attachment: { filename: "synthetic.html", public_url: "https://synthetic.invalid/signed" } }); }
    if (url.pathname.startsWith("/storage/")) { storage++; return new Response(new Uint8Array([1, 2])); }
    if (url.pathname.startsWith("/functions/v1/")) return json({ suggested_lines: [] });
    assert(url.pathname.startsWith("/rest/v1/")); const table = url.pathname.split("/").pop()!;
    if (req.method !== "GET" && req.method !== "HEAD") {
      if (table === "runtime_events") { runtimeEvents++; return json([]); }
      if (table === "learned_knowledge") { usageUpdates++; assertEquals(req.method, "PATCH"); return json([]); }
      if (table === "email_attachments") { attachmentUpdates++; return options.attachmentUpdateAckLost ? json({message:"Synthetic unconfirmed attachment mutation"},500) : json([]); }
      assertEquals(table, "email_drafts", "No other business writes allowed"); assertEquals(req.method, "POST");
      if(options.draftRejectCode) return json({code:options.draftRejectCode,message:"Synthetic database refusal"},400);
      const row = { ...await req.json(), id: Object.hasOwn(options,"draftAckId") ? options.draftAckId : "55555555-5555-4555-8555-555555555555" }; drafts.push(row); if(options.draftMalformedAck) return json({}); return options.draftAckLost ? json({message:"Synthetic lost draft ACK"},500) : json(row);
    }
    if (table === "quote_cases" && options.caseError) return json({ message: "Synthetic case read failure" }, 500);
    if (table === "email_attachments" && options.attachmentError) return json({ message: "Synthetic attachment read failure" }, 500);
    const tables: Record<string, Row[] | null> = {
      emails: [{ id: EMAIL, subject: "Synthetic request", body_text: options.emailBody === undefined ? "Synthetic body" : options.emailBody, from_address: "sender@example.invalid", sent_at: "2026-11-04T10:00:00Z", thread_ref: THREAD }],
      quote_cases: options.cases === undefined ? [{ id: CASE, thread_id: THREAD }] : options.cases,
      email_attachments: attachments, delivery_zones: fixtureZones, local_transport_rates: options.historical ? [] : fixtureRates,
      learned_knowledge: options.historical ? [{ id: "synthetic-tariff", name: "transport", category: "tarif", is_validated: true, confidence: 1, created_at: "2026-11-04T10:00:00Z", usage_count: 3, data: { service: "transport", destination: "Dakar", cargo_type: "SYNTHETIC", transport_mode: "routier", montant: 1 } }] : [],
    };
    let rows = tables[table] === undefined ? [] : tables[table];
    if (Array.isArray(rows)) for (const [key, value] of url.searchParams) {
      if (value.startsWith("eq.")) rows = rows.filter(row => String(row[key]) === value.slice(3));
      if (value.startsWith("in.(")) { const values = value.slice(4, -1).split(",").map(v => v.replace(/^"|"$/g, "")); rows = rows.filter(row => values.includes(String(row[key]))); }
    }
    const count = table === "email_attachments" && options.attachmentCount !== undefined ? options.attachmentCount : rows?.length ?? null;
    const headers: Record<string, string> = count === null ? {} : { "Content-Range": `0-${Math.max(0, (rows?.length ?? 0) - 1)}/${count}` };
    return json(req.headers.get("accept")?.includes("vnd.pgrst.object") ? rows?.[0] ?? null : rows, 200, headers);
  };
  try {
    const requestBody = { ...body, zone_reply_contract: "optional_factor_v1", ...options.request };
    const response = await (options.handler ?? generate)(new Request("https://recipe-fixture.invalid/generate-response", { method: "POST", headers: { Authorization: `Bearer ${options.token ?? "synthetic-A"}`, "Content-Type": "application/json", "x-correlation-id": CASE }, body: JSON.stringify(requestBody) }));
    const output = await response.json(); assertEquals(JSON.stringify(drafts[0]), originalDraft);
    return { status: response.status, output, drafts, requests, requestBody, authTokens, engineTokens, extraction, finalAi, generatedFiles, storage, attachmentUpdates, usageUpdates, runtimeEvents };
  } finally {
    globalThis.fetch = originalFetch; globalThis.Date = NativeDate;
    Object.keys(env).forEach((key, i) => previous[i] === undefined ? Deno.env.delete(key) : Deno.env.set(key, previous[i]!));
  }
}
const run = runRecipeFixture;

Deno.test("recipe real handlers block all generated files and links despite AI attachment demand", async () => {
  const r = await run(); assertEquals(r.status, 200, JSON.stringify(r.output));
  assertEquals(r.generatedFiles, 0); assertEquals(r.storage, 0); assertEquals(r.attachmentUpdates, 0);
  assertEquals(r.extraction, 1); assertEquals(r.finalAi, 1); assertEquals(r.drafts.length, 2);
  assertEquals(r.engineTokens, ["synthetic-A"]); assertEquals(r.authTokens, ["synthetic-A", "synthetic-A"]);
  assertEquals(r.output.data.attachment_needed, false); assertEquals(r.output.data.attachment_data, null); assertEquals(r.output.data.generated_attachment, null);
  assertEquals(r.output.data.recipe_mode, NO_FILES_RECIPE); assert(!JSON.stringify(r.output).includes("forged-signed"));
  assert(!Object.hasOwn(r.requestBody, "emailId")); assert(!Object.hasOwn(r.requestBody, "quotationData"));
  assert(String(r.drafts[1].subject).startsWith("[RECETTE AUTH]")); assert(r.runtimeEvents > 0);
});
for (const options of [
  { cases: [] }, { cases: null }, { cases: [{ id: CASE, thread_id: OTHER }] }, { cases: [{ id: CASE, thread_id: THREAD }, { id: CASE, thread_id: THREAD }] }, { caseError: true },
  { attachments: null }, { attachmentCount: null }, { attachmentCount: 2 }, { attachmentCount: 1001 }, { attachmentError: true },
  { attachments: [{ ...attachment, is_analyzed: false }] }, { attachments: [{ ...attachment, is_analyzed: 1 }] },
]) {
  Deno.test(`recipe real handlers refuse unsafe case or attachment read before AI ${JSON.stringify(options)}`, async () => {
    const r = await run(options); assert(r.status === 403 || r.status === 409 || r.status === 503, JSON.stringify(r.output));
    assertEquals(r.extraction, 0); assertEquals(r.finalAi, 0); assertEquals(r.generatedFiles, 0); assertEquals(r.storage, 0); assertEquals(r.attachmentUpdates, 0); assertEquals(r.drafts.length, 1);
  });
}
Deno.test("recipe real handlers keep restriction after expiry and config removal during AI", async () => {
  const r = await run({ changePolicy: true }); assertEquals(r.status, 200); assertEquals(r.generatedFiles, 0); assertEquals(r.output.data.recipe_mode, NO_FILES_RECIPE);
});
Deno.test("recipe real handlers reject AI-authored retained links before draft insert", async () => {
  const r = await run({ linkOutput: true }); assertEquals(r.status, 409); assertEquals(r.output.error.code, "RECIPE_LINK_OUTPUT_BLOCKED"); assertEquals(r.drafts.length, 1); assertEquals(r.generatedFiles, 0);
});
Deno.test("recipe real handlers still reject invalid identities and revoked workspace", async () => {
  const invalid = await run({ token: "synthetic-service" }); assertEquals(invalid.status, 401); assertEquals(invalid.extraction, 0);
  const other = await run({ token: "synthetic-B", request: { userId: A, token: "synthetic-A" } }); assertEquals(other.status, 403); assertEquals(other.extraction, 0);
  const revoked = await run({ revokeAtEngine: true }); assertEquals(revoked.status, 503); assertEquals(revoked.drafts.length, 1); assertEquals(revoked.generatedFiles, 0);
});
Deno.test("recipe real handlers retain historical usage counter side effects", async () => {
  const r = await run({ historical: true }); assertEquals(r.status, 200, JSON.stringify(r.output)); assert(r.usageUpdates > 0, "Recipe is not an all-write dry run"); assertEquals(r.generatedFiles, 0);
});
Deno.test("normal production with no policy retains full reply and attachment behavior", async () => {
  const r = await run({ policyText: null, request: { recipe_mode: undefined, recipe_email_id: undefined, emailId: EMAIL } }); assertEquals(r.status, 200); assertEquals(r.generatedFiles, 1); assertEquals(r.output.data.attachment_needed, true); assert(!("recipe_mode" in r.output.data));
  console.log("NORMAL_RECIPE_PARITY=" + JSON.stringify({ output: r.output, requests: r.requests, drafts: r.drafts }));
});
for (const request of [{ recipe_mode: undefined }, { emailId: EMAIL }, { emailId: null }, { quotationData: {} }, { quotationData: null }]) {
  Deno.test(`recipe real handlers reject selector downgrade or mixed wire ${JSON.stringify(request)}`, async () => {
    const r = await run({ request }); assertEquals(r.status, 400); assertEquals(r.extraction, 0); assertEquals(r.generatedFiles, 0); assertEquals(r.storage, 0); assertEquals(r.drafts.length, 1);
  });
}
Deno.test("normal other user stays unchanged while recipe policy is active", async () => {
  const r = await run({ token: "synthetic-B", request: { recipe_mode: undefined, recipe_email_id: undefined, emailId: EMAIL } });
  assertEquals(r.status, 200); assertEquals(r.generatedFiles, 1); assertEquals(r.output.data.draft.created_by, B); assert(!("recipe_mode" in r.output.data));
});
