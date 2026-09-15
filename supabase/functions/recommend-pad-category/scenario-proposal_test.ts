import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { proposeGroups, proposalFingerprint, validatePadCandidates, type Row } from "./scenario-domain.ts";
const prior = Deno.env.get("RECOMMEND_PAD_DISABLE_SERVE");
Deno.env.set("RECOMMEND_PAD_DISABLE_SERVE", "1");
const { handleRequest } = await import("./index.ts");
if (prior === undefined) Deno.env.delete("RECOMMEND_PAD_DISABLE_SERVE"); else Deno.env.set("RECOMMEND_PAD_DISABLE_SERVE", prior);

const CASE = "11111111-1111-4111-8111-111111111111";
const MAIL = "22222222-2222-4222-8222-222222222222";
const CLIENT = "client@example.invalid";
const CARGO = "Please quote port charges and inland freight.\n1.39 storage cabinets: 55t/unit, 20HQ SOC, UN3536\n2.13 transformers: 18t/unit, 20HQ SOC\n3.3 x 40HQ COC (spare parts): 10-15t/container";
function mail(body = CARGO): Row { return { id: MAIL, from_address: CLIENT, body_text: body, sent_at: "2026-09-15" }; }
const aliases: Row[] = [{ normalized_term: "materiels electriques", pad_category: "T02", is_validated: true }];
const tariffs: Row[] = [{ id: "synthetic-rate", provider: "PAD", category: "DROIT_PASSAGE", operation_type: "IMPORT", cargo_type: "CONTENEUR",
  classification: "T02", amount: 100, unit: "tonne", source_document: "Synthetic validated catalog", evidence_level: "official",
  effective_date: "2025-01-01", expiry_date: null, is_active: true }];
const candidate = { unit_ref: "lot-1", category: "T02", justification: "Matériels dans un contexte industriel commun, à confirmer.", matching_aliases: ["materiels electriques"] };

Deno.test("proposals: numbered mixed cargo, allocation hypothesis, upper bound weight and scoped IMO", () => {
  const source = [mail()]; const before = JSON.stringify(source);
  const p = proposeGroups(CLIENT, source);
  assertEquals(p.status, "proposed");
  assertEquals(p.groups.map(g => g.quantity), [39, 13, 3]);
  assertEquals(p.groups.map(g => g.weight_kg), [55000, 18000, 15000]);
  assertEquals(p.groups.map(g => g.dangerous), [true, null, null]);
  assertEquals(p.groups.map(g => g.imo_class), ["9", null, null]);
  assert(p.groups[0].imo_source);
  assert(p.groups[0].assumptions.some(a => a.includes("Hypothèse")));
  assert(p.groups[2].assumptions.some(a => a.includes("fourchette")));
  assertEquals(JSON.stringify(source), before);
});

Deno.test("proposals: ordinary cargo does not require an ONU marker or a specific customer", () => {
  const p = proposeGroups(CLIENT, [mail("1) 7 x 20GP COC (rice): 12000kg/container\n2) 2 crates: 2t/unit, 40HQ SOC, non-dangerous")]);
  assertEquals(p.status, "proposed");
  assertEquals(p.groups.map(g => g.quantity), [7, 2]);
  assertEquals(p.groups.map(g => g.dangerous), [null, false]);
});

Deno.test("proposals: French article is not UN, compact lowercase code remains scoped, declared class is not unknown", () => {
  const p = proposeGroups(CLIENT, [mail("Nous avons un 20HQ disponible.\n" + CARGO.replace("UN3536", "un3536"))]);
  assertEquals(p.status, "proposed"); assertEquals(p.groups[0].imo_class, "9");
  const declared = proposeGroups(CLIENT, [mail("1.2 x 20DC COC, class 9")]);
  assertEquals(declared.status, "proposed"); assertEquals(declared.groups[0].dangerous, true);
  assert(!declared.groups[0].assumptions.some(a => a.includes("Danger inconnu")));
  assertEquals(declared.groups[0].quantity_basis, "explicit_containers");
});

for (const [label, source, client] of [
  ["unverified sender", [mail()], "other@example.invalid"],
  ["unknown client", [mail()], null],
  ["quoted source only", [mail("From: client\n" + CARGO)], CLIENT],
  ["conflicting class", [mail(CARGO.replace("UN3536", "UN3536 class 3"))], CLIENT],
  ["multiple classes", [mail(CARGO.replace("UN3536", "UN3536 class 9 class 3"))], CLIENT],
  ["invalid class", [mail(CARGO.replace("UN3536", "class 0"))], CLIENT],
  ["ambiguous lowercase spaced ONU", [mail(CARGO.replace("UN3536", "un 3536"))], CLIENT],
  ["unsupported pricing equipment", [mail(CARGO.replace("40HQ", "45GP"))], CLIENT],
  ["conditional UN", [mail(CARGO.replace("UN3536", "maybe UN3536"))], CLIENT],
  ["negated UN", [mail(CARGO.replace("UN3536", "not UN3536"))], CLIENT],
  ["multi-source", [mail(), { ...mail(), id: "other" }], CLIENT],
  ["missing numbered group", [mail(CARGO.replace("2.13", "4.13"))], CLIENT],
  ["unknown equipment line", [mail(CARGO.replace("18t/unit, 20HQ SOC", "18t/unit, equipment unknown"))], CLIENT],
  ["ONU outside group", [mail(CARGO + "\nUN1234")], CLIENT],
  ["IMO outside group", [mail(CARGO + "\nOther IMO goods")], CLIENT],
  ["missing final quantity", [mail(CARGO.replace("3.3 x", "3.unknown quantity x"))], CLIENT],
  ["correction after list", [mail(), { ...mail("Please cancel the shipment"), id: "later" }], CLIENT],
  ["unreadable body", [mail(CARGO + "\uFFFD")], CLIENT],
] as const) {
  Deno.test(`proposals: ${label} cannot silently generate a usable scenario`, () => {
    const p = proposeGroups(client, [...source]);
    assertEquals(p.status, "needs_review"); assertEquals(p.groups, []);
  });
}

Deno.test("proposals: source fingerprint is order stable and detects changed source or scope", async () => {
  const a = mail(); const b = { ...mail("Thanks"), id: "other" };
  const hash = await proposalFingerprint(CLIENT, [a, b]);
  assertEquals(hash, await proposalFingerprint(CLIENT, [b, a]));
  assert(hash !== await proposalFingerprint(CLIENT, [a, { ...b, body_text: "cancel" }]));
});

Deno.test("PAD proposals: only actual validated aliases and unique applicable tariff sources survive", () => {
  const groups = proposeGroups(CLIENT, [mail()]).groups;
  const result = validatePadCandidates([{ ...candidate, rate: 999999, tariff_source: "invented" }], groups, aliases, tariffs, "2026-09-15");
  assertEquals(result[0].rate, 100); assertEquals(result[0].tariff_source?.id, "synthetic-rate");
  assertEquals(result[0].qualification, "PROPOSAL_ONLY");
  for (const r of [{ ...candidate, unit_ref: "wrong" }, { ...candidate, matching_aliases: ["invented"] }, { ...candidate, category: "T99" }])
    assertEquals(validatePadCandidates([r], groups, aliases, tariffs, "2026-09-15"), []);
  for (const badRates of [[], [...tariffs, ...tariffs], [{ ...tariffs[0], expiry_date: "2026-01-01" }],
    [{ ...tariffs[0], evidence_level: "assumed" }], [{ ...tariffs[0], amount: 0 }], [{ ...tariffs[0], unit: "EVP" }],
    [{ ...tariffs[0], effective_date: "2027-01-01" }], [{ ...tariffs[0], currency: "USD" }],
    [{ ...tariffs[0], currency: null }], [{ ...tariffs[0], effective_date: "" }]]) {
    const out = validatePadCandidates([candidate], groups, aliases, badRates, "2026-09-15");
    assertEquals(out[0].rate, null); assertEquals(out[0].tariff_source, null);
  }
  assertEquals(validatePadCandidates([candidate], groups, [{ ...aliases[0], is_validated: false }], tariffs, "2026-09-15"), []);
});

interface Options { invisible?: boolean; invalidAuth?: boolean; incomplete?: boolean; aiFail?: boolean; catalogFail?: boolean; scope?: unknown; scopeKey?: string; changed?: boolean; threadClient?: string | null; contact?: string; encoded?: boolean }
async function withTransport(options: Options, check: (invoke: (body: Row, auth?: boolean) => Promise<Response>, calls: string[], aiBodies: Row[]) => Promise<void>) {
  const fetchBefore = globalThis.fetch; const names = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "LOVABLE_API_KEY"];
  const envBefore = names.map(k => Deno.env.get(k)); const calls: string[] = []; const aiBodies: Row[] = []; const unexpected: string[] = [];
  const origin = "https://proposal-synthetic.invalid";
  const reply = (body: unknown, status = 200, count?: number) => new Response(JSON.stringify(body), { status,
    headers: { "Content-Type": "application/json", ...(count !== undefined ? { "Content-Range": `0-${Math.max(count - 1, 0)}/${count}` } : {}) } });
  try {
    Deno.env.set(names[0], origin); Deno.env.set(names[1], "synthetic-anon"); Deno.env.set(names[2], "synthetic-ai");
    globalThis.fetch = (async (input, init) => {
      const req = new Request(input, init); const url = new URL(req.url); calls.push(`${req.method} ${url.pathname}`);
      if (url.origin === "https://ai.gateway.lovable.dev" && url.pathname === "/v1/chat/completions" && req.method === "POST") {
        aiBodies.push(await req.json()); return options.aiFail ? reply({}, 503) : reply({ choices: [{ message: { content: JSON.stringify({ candidates: [candidate] }) } }] });
      }
      if (url.origin === origin && req.method === "GET") {
        assertEquals(req.headers.get("Authorization"), "Bearer synthetic-user");
        assertEquals(req.headers.get("apikey"), "synthetic-anon");
        if (url.pathname === "/auth/v1/user") return options.invalidAuth ? reply({}, 401) : reply({ id: CASE, aud: "authenticated" });
        if (url.pathname === "/rest/v1/quote_cases") { assertEquals(url.searchParams.get("id"), `eq.${CASE}`); return reply(options.invisible ? null : { id: CASE, thread_id: "thread", request_type: "IMPORT" }); }
        if (url.pathname === "/rest/v1/email_threads") { assertEquals(url.searchParams.get("id"), "eq.thread"); return reply({ client_email: "threadClient" in options ? options.threadClient : CLIENT }); }
        if (url.pathname === "/rest/v1/emails") { assertEquals(url.searchParams.get("thread_ref"), "eq.thread"); return reply([mail(options.encoded ? `Content-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: base64\n\n${btoa(CARGO)}` : options.changed ? CARGO + "\nchanged" : CARGO)], 200, options.incomplete ? 2 : 1); }
        if (url.pathname === "/rest/v1/quote_facts") { assertEquals(url.searchParams.get("is_current"), "eq.true"); assertEquals(url.searchParams.get("case_id"), `eq.${CASE}`); return reply([...(options.scope ? [{ fact_key: options.scopeKey ?? "service.package", value_text: options.scope }] : []), ...(options.contact ? [{ fact_key: "contacts.client_email", value_text: options.contact }] : [])]); }
        if (url.pathname === "/rest/v1/pad_designation_aliases") return reply(aliases, 200, aliases.length);
        if (url.pathname === "/rest/v1/port_tariffs") {
          assert(!String(url.searchParams.get("select")).split(",").map(s => s.trim()).includes("currency"), "port_tariffs has no currency column");
          return options.catalogFail ? reply([], 200, 2) : reply(tariffs, 200, tariffs.length);
        }
      }
      unexpected.push(`${req.method} ${url}`); throw new Error("Unexpected operation refused");
    }) as typeof fetch;
    const invoke = (body: Row, auth = true) => handleRequest(new Request(origin, { method: "POST", headers: {
      "Content-Type": "application/json", ...(auth ? { Authorization: "Bearer synthetic-user" } : {}) }, body: JSON.stringify(body) }));
    await check(invoke, calls, aiBodies); assertEquals(unexpected, []);
  } finally {
    globalThis.fetch = fetchBefore;
    names.forEach((name, i) => envBefore[i] === undefined ? Deno.env.delete(name) : Deno.env.set(name, envBefore[i]!));
  }
}

Deno.test("proposal HTTP: actual authenticated route reads only case-bound data and sends common cargo context, not addresses", async () => {
  await withTransport({}, async (invoke, calls, ai) => {
    const response = await invoke({ action: "propose_scenario", case_id: CASE }); const body = await response.json();
    assertEquals(response.status, 200); assertEquals(body.groups.length, 3); assertEquals(body.pad_candidates[0].rate, 100);
    assertEquals(calls.filter(c => c.startsWith("POST")), ["POST /v1/chat/completions"]);
    assertEquals(ai.length, 1); assert(!JSON.stringify(ai).includes(CLIENT)); assert(!JSON.stringify(ai).includes(MAIL));
    const messages = ai[0].messages as Row[]; const context = JSON.parse(String(messages[1].content)); assertEquals(context.groups.length, 3);
    const verified = await invoke({ action: "verify_scenario_source", case_id: CASE, source_fingerprint: body.source_fingerprint });
    assertEquals(await verified.json(), { verified: true }); assertEquals(ai.length, 1);
  });
});

Deno.test("proposal HTTP: missing thread identity uses existing case contact and complete MIME, no writes; changed contact invalidates draft", async () => {
  const options: Options={threadClient:null,contact:CLIENT,encoded:true};
  await withTransport(options,async(invoke,calls,ai)=>{
    const response=await invoke({action:"propose_scenario",case_id:CASE});const body=await response.json();
    assertEquals(body.status,"proposed");assertEquals(body.client_source,"case_contact_fact");assertEquals(body.groups.length,3);
    assertEquals(calls.filter(c=>c.startsWith("POST")),["POST /v1/chat/completions"]);
    options.contact="changed@example.invalid";
    assertEquals((await invoke({action:"verify_scenario_source",case_id:CASE,source_fingerprint:body.source_fingerprint})).status,409);
    assertEquals(ai.length,1);
  });
});
Deno.test("proposal HTTP: client identity conflict refuses before AI and never invents another sender",async()=>{
  await withTransport({contact:"other@example.invalid"},async(invoke,_calls,ai)=>{
    const response=await invoke({action:"propose_scenario",case_id:CASE});const body=await response.json();
    assertEquals(body.status,"needs_review");assertEquals(body.reasons,["CLIENT_IDENTITY_CONFLICT"]);assertEquals(ai,[]);
  });
});

for (const [label, options, status] of [
  ["invisible", { invisible: true }, 403], ["invalid auth", { invalidAuth: true }, 401],
  ["incomplete source", { incomplete: true }, 422], ["air scope", { scope: "AIR_IMPORT_DAP" }, 422],
  ["transit scope", { scope: "TRANSIT_REGIONAL_VIA_DAKAR" }, 422], ["export scope", { scope: "EXPORT_SENEGAL" }, 422],
  ["road scope", { scope: "ROUTE", scopeKey: "routing.transport_mode" }, 422],
  ["multimodal scope", { scope: "MULTIMODAL", scopeKey: "routing.transport_mode" }, 422],
  ["cross trade scope", { scope: "CROSS_TRADE", scopeKey: "routing.movement_direction" }, 422],
  ["nontext scope object", { scope: { value: "AIR_IMPORT_DAP" } }, 422],
  ["nontext scope number", { scope: 123, scopeKey: "routing.transport_mode" }, 422],
] as const) Deno.test(`proposal HTTP: ${label} fails before AI`, async () => {
  await withTransport(options, async (invoke, calls, ai) => {
    assertEquals((await invoke({ action: "propose_scenario", case_id: CASE })).status, status); assertEquals(ai, []);
    if (options.invisible || options.invalidAuth) assert(!calls.some(c => c.includes("/emails")));
  });
});

Deno.test("proposal HTTP: missing auth, injected data and changed fingerprint never fill a draft", async () => {
  await withTransport({}, async (invoke, calls, ai) => {
    assertEquals((await invoke({ action: "propose_scenario", case_id: CASE }, false)).status, 401); assertEquals(calls, []);
    assertEquals((await invoke({ action: "propose_scenario", case_id: CASE, emails: [mail()] })).status, 400);
    assertEquals((await invoke({ action: "verify_scenario_source", case_id: CASE, source_fingerprint: "a".repeat(64) })).status, 409);
    assertEquals(ai, []);
  });
});

for (const options of [{ aiFail: true }, { catalogFail: true }]) Deno.test("proposal HTTP: PAD failure preserves cargo proposal without inventing tariff", async () => {
  await withTransport(options, async (invoke) => {
    const response = await invoke({ action: "propose_scenario", case_id: CASE }); const body = await response.json();
    assertEquals(response.status, 200); assertEquals(body.status, "proposed"); assertEquals(body.groups.length, 3); assertEquals(body.pad_candidates, []);
  });
});
