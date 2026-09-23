import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractFullPlainText, extractPlainTextFromMime, resolvePricingGoodsEvidence, type PricingGoodsEmail } from "./imo-goods-preflight.ts";
import { imoGoodsSourceFingerprint, resolveImoGoodsPricing } from "../_shared/imo-goods-recognition.ts";

const client = "client@example.test";
const body = "1.8 x 20HQ SOC (batteries), UN3536\n2.2 x 40RF COC (equipment), non-dangerous";
const facts = [{ fact_key: "cargo.containers", value_json: [
  { type: "20HQ", quantity: 8, coc_soc: "SOC" },
  { type: "40RF", quantity: 2, coc_soc: "COC" },
] }];
const mail = (body_text: string | null = body, from_address = client): PricingGoodsEmail =>
  ({ id: "synthetic-email", from_address, body_text, sent_at: "2026-01-01T00:00:00Z", subject: "Quote" });
async function project(emails = [mail()], identity: string | null = client, currentFacts = facts) {
  const evidence = await resolvePricingGoodsEvidence(undefined, identity, emails);
  assert(evidence);
  return { evidence, plan: resolveImoGoodsPricing(evidence, currentFacts, await imoGoodsSourceFingerprint(identity, emails)) };
}

for (const [name, content] of [
  ["plain", body],
  ["raw base64", btoa(body)],
  ["base64 with image MIME tail", btoa("Please review this request for a freight quotation.\n".repeat(3) + body) + "\r\n--image-boundary\r\nimage data"],
  ["MIME base64", 'Content-Type: multipart/mixed; boundary="test"\r\n--test\r\nContent-Type: text/plain\r\nContent-Transfer-Encoding: base64\r\n\r\n' + btoa(body) + "\r\n--test--"],
  ["MIME quoted-printable", 'Content-Type: multipart/mixed; boundary="test"\n--test\nContent-Type: text/plain\nContent-Transfer-Encoding: quoted-printable\n\n' + body.replace("UN3536", "=55N3536") + "\n--test--"],
]) {
  Deno.test("IMO preflight: no prior event, complete " + name + " automatically projects per group", async () => {
    const emails = [mail(content)];
    const before = JSON.stringify({ emails, facts });
    const { plan } = await project(emails);
    assertEquals(plan.status, "READY");
    assertEquals(plan.rows.map(r => [r.dangerous, r.imoClass]), [[true, "9"], [false, null]]);
    assertEquals(JSON.stringify({ emails, facts }), before);
  });
}
Deno.test("IMO preflight: no prior event, goods counts and unknown groups stay blocked", async () => {
  const { evidence, plan } = await project([mail("1.8 cabinets: 55t/unit, 20HQ SOC, UN3536\n2.2 x 40RF COC (equipment)")]);
  assertEquals(evidence.groups[0].classification?.imdgClass, "9");
  assertEquals(plan.status, "BLOCKED");
  assert(plan.reasons.includes("CONTAINER_ALLOCATION_REQUIRED"));
  assert(plan.reasons.includes("GROUP_2_CLASSIFICATION_REQUIRED"));
});
for (const identity of [null, "", "other@example.test"]) {
  Deno.test("IMO preflight: does not infer missing or mismatched client identity " + identity, async () => {
    const { plan } = await project([mail()], identity);
    assertEquals(plan.status, "BLOCKED");
    assertEquals(plan.rows, []);
  });
}
Deno.test("IMO preflight: quoted ONU does not become a current declaration", async () => {
  const { plan } = await project([mail("Thanks\nFrom: old@example.test\n" + body)]);
  assertEquals(plan.status, "BLOCKED");
});
const utf8Base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const mime = (parts: string) => 'Content-Type: multipart/mixed; boundary="outer"\r\n\r\n' + parts + "--outer--";
for (const text of ["a".repeat(4000) + "\n" + body, "A".repeat(41),
  'Content-Type: multipart/mixed; boundary="bad"\nContent-Transfer-Encoding: base64\n%%%',
  "Content-Transfer-Encoding: base64\n\n" + btoa(body),
  mime("--outer\r\nContent-Type: image/png\r\nContent-Transfer-Encoding: base64\r\n\r\niVBORw0KGgo=\r\n"),
  mime("--outer\r\nContent-Type: text/plain\r\nContent-Transfer-Encoding: base64\r\n\r\n%%%not-base64%%%\r\n"),
  btoa("\u0000\u0001\u0002binary".repeat(20))]) {
  Deno.test("IMO preflight: undecodable or masked inbound cannot silently use legacy pricing " + JSON.stringify(text.slice(0, 28)), async () => {
    const { evidence, plan } = await project([mail(text)]);
    assert(evidence.reasons.includes("INCOMPLETE_EMAIL_SOURCE"));
    assertEquals(plan.status, "BLOCKED");
  });
}
// GO CTO 2026-09-23: false IMO blockers on ordinary e-mails.
const prose = "Bonjour, merci de nous transmettre votre meilleure offre pour un 20HQ et un 2ème conteneur " +
  "de marchandises générales, de Shanghai au port de Dakar, livraison à Thiès.\n";
const longProse = prose.repeat(40).slice(0, 5180);
for (const [name, text] of [
  ["null body", null], ["empty body", ""], ["blank body", " \r\n "],
  ["5 180-character ordinary e-mail", longProse],
  ["short e-mail opening with a long unpunctuated sentence", "Dear Sir we would like to get your best rate for two containers to Dakar."],
  ["long raw base64 ordinary e-mail", utf8Base64(longProse)],
  ["long MIME base64 ordinary e-mail", mime("--outer\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" +
    utf8Base64(longProse).replace(/(.{76})/g, "$1\r\n") + "\r\n")],
  ["long ISO-8859-1 quoted-printable e-mail", mime("--outer\r\nContent-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n" +
    longProse.replace(/è/g, "=E8").replace(/à/g, "=E0").replace(/é/g, "=E9") + "\r\n")],
] as const) {
  Deno.test("IMO preflight: no IMO mention, no false blocker — " + name, async () => {
    assertEquals(await resolvePricingGoodsEvidence(undefined, client, [mail(text)]), undefined);
    // A genuine IMO e-mail in the same thread is still recognized.
    const { plan } = await project([mail(), { ...mail(text), id: "synthetic-followup" }]);
    assertEquals(plan.status, "READY");
  });
}
for (const [name, text] of [
  ["plain text", longProse + "\n" + body],
  ["raw base64 above the 8 000-character decoder cap", utf8Base64(longProse + longProse + "\n" + body)],
  ["nested MIME base64", mime('--outer\r\nContent-Type: multipart/alternative; boundary="inner"\r\n\r\n--inner\r\n' +
    "Content-Type: text/plain\r\nContent-Transfer-Encoding: base64\r\n\r\n" +
    utf8Base64(longProse + "\n" + body) + "\r\n--inner--\r\n")],
] as const) {
  Deno.test("IMO preflight: cargo rows after the first 4 000 characters are not ignored — " + name, async () => {
    const { evidence, plan } = await project([mail(text)]);
    assertEquals(evidence.groups.map(g => g.ordinal), [1, 2]);
    assertEquals(plan.status, "READY");
    assertEquals(plan.rows.map(r => [r.dangerous, r.imoClass]), [[true, "9"], [false, null]]);
  });
}
Deno.test("IMO preflight: late unstructured ONU mention in a long e-mail stays blocked", async () => {
  const { evidence, plan } = await project([mail(longProse + "\nAttention : une partie contient UN3480.")]);
  assert(evidence.reasons.includes("UN_WITHOUT_PROVEN_GROUP"));
  assertEquals(plan.status, "BLOCKED");
});
Deno.test("IMO preflight: raw base64 with a short MIME tail is decoded completely", async () => {
  const { plan } = await project([mail(btoa(body) + "\n--short-prefix-mime-tail")]);
  assertEquals(plan.status, "READY");
});
// Counter-review findings: truncation at ingestion, narrow base64 lines, tails,
// undeclared outer boundaries.
const lateDanger = "\nNB : une partie contient des batteries UN3480.";
const bodyText = (text: string) => "\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" +
  utf8Base64(text).replace(/(.{76})/g, "$1\r\n") + "\r\n";
for (const [name, text] of [
  ["plain text stored at the 50 000-character ingestion cap", (prose.repeat(400) + lateDanger).slice(0, 50_000)],
  ["plain text beyond the 500 000-character ingestion cap", prose.repeat(4000)],
  ["MIME without its closing delimiter", mime("--outer" + bodyText(longProse + lateDanger)).replace("--outer--", "").slice(0, -300)],
  ["MIME base64 part cut to a non-multiple of four", mime("--outer" + bodyText(longProse).replace(/\r\n$/, "AB\r\n"))],
  ["raw base64 cut to a non-multiple of four", utf8Base64(longProse + lateDanger).slice(0, -3)],
  ["second raw base64 block in the tail", utf8Base64(longProse) + "\n--x\n" + utf8Base64("Attention" + lateDanger)],
  ["second raw base64 block in the tail wrapped at 36 columns", utf8Base64(longProse) + "\n--x\n" +
    utf8Base64("Attention" + lateDanger).replace(/(.{36})/g, "$1\n")],
  ["two raw base64 blocks separated by a blank line", utf8Base64(longProse + "!") + "\n\n" + utf8Base64("Attention" + lateDanger)],
] as const) {
  Deno.test("IMO preflight: possibly truncated or corrupt body stays blocked — " + name, async () => {
    const { evidence, plan } = await project([mail(text)]);
    assert(evidence.reasons.includes("INCOMPLETE_EMAIL_SOURCE"));
    assertEquals(plan.status, "BLOCKED");
  });
}
for (const [name, text] of [
  ["raw base64 wrapped at 36 columns", utf8Base64(longProse + lateDanger).replace(/(.{36})/g, "$1\n")],
  ["mention after a raw base64 run and a -- tail", utf8Base64(longProse) + "\n--" + lateDanger],
  ["mention after a raw base64 run and a plain tail", utf8Base64(longProse) + "\nThanks," + lateDanger],
  ["second text part behind an undeclared outer boundary", '--outer\r\nContent-Type: multipart/alternative; boundary="inner"\r\n\r\n' +
    "--inner" + bodyText(longProse) + "--inner--\r\n--outer" + bodyText("Complément." + lateDanger) + "--outer--\r\n"],
  ["short first part behind an undeclared outer boundary", '--outer\r\nContent-Type: multipart/alternative; boundary="inner"\r\n\r\n' +
    "--inner\r\nContent-Type: text/plain\r\n\r\nBonjour, merci pour votre offre.\r\n--inner--\r\n--outer" +
    bodyText("Complément." + lateDanger) + "--outer--\r\n"],
  ["raw HTML body", "<html><body><p>" + longProse + "</p><table><tr><td>UN</td><td>3480</td></tr></table>" +
    "<p>UN&#160;3481</p></body></html>"],
] as const) {
  Deno.test("IMO preflight: dangerous mention in a long or encoded body is not ignored — " + name, async () => {
    const { evidence, plan } = await project([mail(text)]);
    assert(evidence.reasons.includes("UN_WITHOUT_PROVEN_GROUP"));
    assert(!evidence.reasons.includes("INCOMPLETE_EMAIL_SOURCE"));
    assertEquals(plan.status, "BLOCKED");
  });
}
Deno.test("IMO preflight: whole-body HTML scan stays linear on unclosed tags", async () => {
  const text = mime("--outer\r\nContent-Type: text/html\r\n\r\n" + "<div><style>".repeat(15_000) + "\r\n");
  const frozen = performance.now();
  extractPlainTextFromMime(text); // frozen decoder cost (quadratic, pre-existing), the reference
  const reference = performance.now() - frozen;
  const started = performance.now();
  extractFullPlainText(text);
  const whole = performance.now() - started;
  assert(whole < reference / 4 + 50, `whole-body scan ${whole} ms vs frozen decoder ${reference} ms`);
});
// GO CTO 2026-09-23 (suite): body_text derived from HTML truncated at ingestion
// (sync-emails MAX_BODY_HTML 100 000, hydrate-email-body MAX_FULL_BODY_HTML 1 000 000).
const html = (length: number) => "<p>" + "x".repeat(length - 7) + "</p>";
const withHtml = (text: string | null, body_html: string | null | undefined) => ({ ...mail(text), body_html });
const shortOrdinary = "Bonjour, merci pour votre offre.";
for (const [name, length] of [["under the sync cap", 99_999], ["between caps", 500_000], ["under the hydration cap", 999_999]] as const) {
  Deno.test("IMO preflight: complete HTML " + name + " keeps alerts 1 and 2 fixed", async () => {
    assertEquals(await resolvePricingGoodsEvidence(undefined, client, [withHtml(shortOrdinary, html(length))]), undefined);
    assertEquals(await resolvePricingGoodsEvidence(undefined, client, [withHtml(longProse, html(length))]), undefined);
    const { plan } = await project([withHtml(body, html(length))]);
    assertEquals(plan.status, "READY");
  });
}
for (const [name, length] of [["at the sync cap", 100_000], ["at the hydration cap", 1_000_000], ["beyond the hydration cap", 1_000_001]] as const) {
  Deno.test("IMO preflight: text derived from HTML " + name + " is never complete", async () => {
    const { evidence, plan } = await project([withHtml(shortOrdinary, html(length))]);
    assert(evidence.reasons.includes("INCOMPLETE_EMAIL_SOURCE"));
    assertEquals(plan.status, "BLOCKED");
    // Even a cargo list that looks complete cannot be bound from a truncated source.
    const cargo = await project([withHtml(body, html(length))]);
    assertEquals(cargo.plan.status, "BLOCKED");
    assert(cargo.evidence.reasons.includes("TRUNCATED_SOURCE"));
  });
}
Deno.test("IMO preflight: ONU after 4 000 characters of a truncated-HTML text is surfaced, not only blocked", async () => {
  const { evidence } = await project([withHtml(longProse + lateDanger, html(100_000))]);
  assert(evidence.reasons.includes("INCOMPLETE_EMAIL_SOURCE"));
  assert(evidence.reasons.includes("UN_WITHOUT_PROVEN_GROUP"));
});
Deno.test("IMO preflight: older rows without body_html keep text-based behavior", async () => {
  for (const missing of [undefined, null]) {
    assertEquals(await resolvePricingGoodsEvidence(undefined, client, [withHtml(longProse, missing)]), undefined);
    assertEquals((await project([withHtml(body, missing)])).plan.status, "READY");
  }
});
Deno.test("IMO preflight: internal sender with truncated HTML is still excluded", async () => {
  assertEquals(await resolvePricingGoodsEvidence(undefined, client, [{ ...withHtml(shortOrdinary, html(100_000)), from_address: "ops@sodatra.sn" }]), undefined);
});
Deno.test("IMO preflight: body_html is a signal only, the source fingerprint is unchanged", async () => {
  assertEquals(await imoGoodsSourceFingerprint(client, [withHtml(body, html(100_000))]), await imoGoodsSourceFingerprint(client, [mail()]));
  const evidence = await resolvePricingGoodsEvidence(undefined, client, [withHtml(body, html(99_999))]);
  assertEquals(evidence, await resolvePricingGoodsEvidence(undefined, client, [mail()]));
});
Deno.test("IMO preflight: stored proof is kept, truncated HTML can only make it stricter", async () => {
  const { evidence } = await project();
  const snapshot = JSON.stringify(evidence);
  assertEquals(await resolvePricingGoodsEvidence(evidence, client, [withHtml(body, html(99_999))]), evidence);
  const stricter = await resolvePricingGoodsEvidence(evidence, client, [withHtml(body, html(100_000))]);
  assertEquals(stricter?.status, "REVIEW");
  assert(stricter?.reasons.includes("INCOMPLETE_EMAIL_SOURCE"));
  assertEquals(stricter?.sourceFingerprint, evidence.sourceFingerprint);
  assertEquals(stricter?.groups, evidence.groups);
  assertEquals(JSON.stringify(evidence), snapshot);
  assertEquals(resolveImoGoodsPricing(stricter!, facts, evidence.sourceFingerprint!).status, "BLOCKED");
});
Deno.test("IMO preflight: MIME stored without top-level headers and without danger is not blocked", async () => {
  const text = '--outer\r\nContent-Type: multipart/alternative; boundary="inner"\r\n\r\n' +
    "--inner" + bodyText(longProse) + "--inner--\r\n--outer--\r\n";
  assertEquals(await resolvePricingGoodsEvidence(undefined, client, [mail(text)]), undefined);
});
Deno.test("IMO preflight: readable non-IMO email and document-only cases retain legacy behavior", async () => {
  assertEquals(await resolvePricingGoodsEvidence(undefined, null, []), undefined);
  assertEquals(await resolvePricingGoodsEvidence(undefined, null, [mail("Please quote two ordinary containers.")]), undefined);
});
Deno.test("IMO preflight: exact internal sender is excluded, lookalike domain is not", async () => {
  assertEquals(await resolvePricingGoodsEvidence(undefined, null, [mail(body, "ops@sodatra.sn")]), undefined);
  const { plan } = await project([mail(body, "ops@sodatra.sn.example.test")], null);
  assertEquals(plan.status, "BLOCKED");
});
Deno.test("IMO preflight: global manual conflict remains blocked without mutation", async () => {
  const conflictingFacts = [...facts, { fact_key: "cargo.imo_class", value_text: "3" }];
  const emails = [mail()];
  const evidence = await resolvePricingGoodsEvidence(undefined, client, emails);
  assert(evidence);
  const plan = resolveImoGoodsPricing(evidence, conflictingFacts, await imoGoodsSourceFingerprint(client, emails));
  assert(plan.reasons.includes("GLOBAL_IMO_CONFLICT"));
  assertEquals(conflictingFacts[1], { fact_key: "cargo.imo_class", value_text: "3" });
});
Deno.test("IMO preflight: repeated read-only recognition yields identical evidence", async () => {
  assertEquals(await resolvePricingGoodsEvidence(undefined, client, [mail()]),
    await resolvePricingGoodsEvidence(undefined, client, [mail()]));
});
Deno.test("IMO preflight: stored stale proof is not silently refreshed", async () => {
  const { evidence } = await project();
  const changed = [mail(body + "\nCargo revision pending")];
  const actual = await resolvePricingGoodsEvidence(evidence, client, changed);
  assertEquals(actual, evidence);
  const plan = resolveImoGoodsPricing(actual!, facts, await imoGoodsSourceFingerprint(client, changed));
  assert(plan.reasons.includes("SOURCE_CHANGED_REANALYZE"));
});
for (const invalid of [null, {}, { version: 2, groups: [], reasons: [] }]) {
  Deno.test("IMO preflight: malformed stored proof blocks instead of fallback " + JSON.stringify(invalid), async () => {
    await assertRejects(() => resolvePricingGoodsEvidence(invalid, client, [mail()]), Error, "IMO goods evidence invalid");
  });
}
Deno.test("IMO preflight: decoder remains byte-identical to frozen puzzle decoder", () => {
  const puzzle = Deno.readTextFileSync(new URL("../build-case-puzzle/index.ts", import.meta.url)).replace(/\r\n/g, "\n");
  const local = Deno.readTextFileSync(new URL("./imo-goods-preflight.ts", import.meta.url)).replace(/\r\n/g, "\n");
  const start = "export function extractPlainTextFromMime";
  assertEquals(local.slice(local.indexOf(start)).trim(),
    puzzle.slice(puzzle.indexOf(start), puzzle.indexOf("const corsHeaders")).trim());
});
Deno.test("IMO preflight: actual run-pricing invokes fallback before gaps/status and rechecks evidence before engine", () => {
  const source = Deno.readTextFileSync(new URL("./index.ts", import.meta.url));
  const preflight = source.indexOf("const goodsAssessment = await resolvePricingGoodsEvidence(");
  assert(preflight > 0);
  assert(preflight < source.indexOf("const { data: blockingGapsRows }"));
  const guard = source.slice(source.indexOf("const goodsSourceResults"), source.indexOf("// 4a. Hard guard"));
  assert(!guard.includes("if (goodsEvent)"));
  assert(guard.includes("goodsSourceResults[1].count !== goodsSourceResults[1].data?.length"));
  assert(guard.includes('order("sent_at", { ascending: true })'));
  assert(guard.includes("if (goodsAssessment)"));
  assert(!/\.insert\(|\.update\(|\.upsert\(|\.rpc\(/.test(guard));
  assert(source.includes("eventNow.data?.id !== goodsEvent?.id"));
  assert(source.includes("inputs.imoGoodsPlan = goodsPlan"));
});

// Exercise the actual Edge handler with an in-memory HTTP transport. No socket,
// real JWT, database or cloud function is used.
type Handler = (request: Request) => Promise<Response>;
let handler: Handler;
const originalServe = Deno.serve;
const originalDisableServe = Deno.env.get("RUN_PRICING_DISABLE_SERVE");
try {
  Deno.env.set("RUN_PRICING_DISABLE_SERVE", "0");
  Deno.serve = ((callback: unknown) => {
    handler = callback as Handler;
    return {} as Deno.HttpServer;
  }) as typeof Deno.serve;
  await import("./index.ts");
} finally {
  Deno.serve = originalServe;
  if (originalDisableServe === undefined) Deno.env.delete("RUN_PRICING_DISABLE_SERVE");
  else Deno.env.set("RUN_PRICING_DISABLE_SERVE", originalDisableServe);
}

for (const scenario of [
  { name: "no event, unknown client", identity: null, text: body, status: 400, error: "IMO goods scope requires clarification" },
  { name: "no event, ambiguous allocation", identity: client, text: body.replace("8 x 20HQ", "8 units: 20HQ"), status: 400, error: "IMO goods scope requires clarification" },
  { name: "no event, ready IMO plan still respects PAD gap", identity: client, text: body, status: 400, error: "Blocking gaps still open" },
  { name: "no event, non-IMO retains other guards", identity: null, text: "Please quote ordinary containers.", status: 400, error: "Blocking gaps still open" },
  { name: "no event, long ordinary French e-mail is not an IMO blocker", identity: client, text: longProse, status: 400, error: "Blocking gaps still open" },
  { name: "no event, empty inbound body is not an IMO blocker", identity: client, text: "", status: 400, error: "Blocking gaps still open" },
  { name: "partial email collection fails closed", identity: client, text: body, partial: true, status: 500, error: "Internal server error" },
  { name: "email read error fails closed", identity: client, text: body, readError: true, status: 500, error: "Internal server error" },
  { name: "provisional cannot bypass IMO scope", identity: client, text: body, provisional: true, status: 400, error: "IMO goods scope requires clarification" },
  { name: "air remains outside group pricing scope", identity: client, text: body, requestType: "AIR_IMPORT", status: 400, error: "IMO goods scope requires clarification" },
  { name: "multi-quote remains outside group pricing scope", identity: client, text: body, requestLines: 2, status: 400, error: "IMO goods scope requires clarification" },
  { name: "ordinary text derived from HTML truncated at ingestion stays blocked", identity: client, text: "Bonjour, merci pour votre offre.",
    html: "<p>" + "x".repeat(99_993) + "</p>", status: 400, error: "IMO goods scope requires clarification", reason: "SOURCE_REVIEW_REQUIRED" },
  { name: "ordinary text with complete HTML under the cap is not an IMO blocker", identity: client, text: "Bonjour, merci pour votre offre.",
    html: "<p>" + "x".repeat(99_992) + "</p>", status: 400, error: "Blocking gaps still open" },
]) {
  Deno.test("IMO preflight actual handler: " + scenario.name, async () => {
    const originalFetch = globalThis.fetch;
    const envKeys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
    const savedEnv = envKeys.map(key => Deno.env.get(key));
    const requests: string[] = [];
    const writes: string[] = [];
    const emailSelects: string[] = [];
    try {
      Deno.env.set("SUPABASE_URL", "https://unit-test.invalid");
      Deno.env.set("SUPABASE_ANON_KEY", "synthetic-anon-key");
      Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
      globalThis.fetch = (async (input, init) => {
        // Normalize fetch inputs without depending on RequestInit's ambient members.
        const request = new Request(input, init);
        const url = new URL(request.url);
        const method = request.method;
        assertEquals(url.origin, "https://unit-test.invalid");
        requests.push(url.pathname);
        if (method !== "GET" && method !== "HEAD") {
          writes.push(method + " " + url.pathname);
          throw new Error("Unexpected write or engine invocation in read-only preflight test");
        }
        let data: unknown = [];
        let count = 0;
        if (url.pathname === "/auth/v1/user") data = { id: "synthetic-user", aud: "authenticated" };
        else if (url.pathname === "/rest/v1/quote_cases") data = {
          id: "synthetic-case", thread_id: "synthetic-thread", status: "PRICED_DRAFT", request_type: scenario.requestType ?? "SEA_FCL_IMPORT",
        };
        else if (url.pathname === "/rest/v1/email_threads") data = [{ client_email: scenario.identity }];
        else if (url.pathname === "/rest/v1/emails") {
          emailSelects.push(url.searchParams.get("select") ?? "");
          if (scenario.readError) return new Response(JSON.stringify({ message: "synthetic read failure" }), {
            status: 503, headers: { "Content-Type": "application/json" },
          });
          data = [{ ...mail(scenario.text), ...("html" in scenario ? { body_html: scenario.html } : {}) }];
          count = scenario.partial ? 2 : 1;
        } else if (url.pathname === "/rest/v1/quote_facts") data = [
          ...facts, { fact_key: "service.package", value_text: "DAP_PROJECT_IMPORT" },
        ];
        else if (url.pathname === "/rest/v1/quote_gaps") data = [{ gap_key: "pricing.pad_category" }];
        else if (url.pathname === "/rest/v1/quote_request_lines") count = scenario.requestLines ?? 0;
        else assert(["/rest/v1/fee_lines", "/rest/v1/case_timeline_events", "/rest/v1/quote_request_lines"].includes(url.pathname));
        return new Response(method === "HEAD" ? null : JSON.stringify(data), {
          headers: { "Content-Type": "application/json", "Content-Range": "0-0/" + count },
        });
      }) as typeof fetch;
      const result = await handler(new Request("https://unit-test.invalid/run-pricing", {
        method: "POST", headers: { Authorization: "Bearer synthetic-token", "Content-Type": "application/json" },
        body: JSON.stringify({ case_id: "synthetic-case", allow_provisional: scenario.provisional ?? false }),
      }));
      const response = await result.json();
      assertEquals(result.status, scenario.status);
      assertEquals(response.error, scenario.error);
      assert(requests.includes("/auth/v1/user"));
      assert(requests.includes("/rest/v1/emails"));
      assertEquals(writes, []);
      // Real wiring: the preflight read carries body_html to the truncation check.
      assert(emailSelects[0].split(",").includes("body_html"));
      if ("reason" in scenario) assert(response.pricing_blockers.includes(scenario.reason));
      assert(!requests.includes("/rest/v1/pricing_runs"));
      if (scenario.error === "IMO goods scope requires clarification") {
        assertEquals(response.imo_goods_plan.status, "BLOCKED");
        assert(!requests.includes("/rest/v1/quote_gaps"));
      }
    } finally {
      globalThis.fetch = originalFetch;
      envKeys.forEach((key, i) => {
        if (savedEnv[i] === undefined) Deno.env.delete(key);
        else Deno.env.set(key, savedEnv[i]!);
      });
    }
  });
}
Deno.test("IMO preflight actual handler: missing authentication still returns 401", async () => {
  const response = await handler(new Request("https://unit-test.invalid/run-pricing", {
    method: "POST", body: JSON.stringify({ case_id: "synthetic-case" }),
  }));
  assertEquals(response.status, 401);
});
