import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolvePricingGoodsEvidence, type PricingGoodsEmail } from "./imo-goods-preflight.ts";
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
for (const text of [null, "", "a".repeat(4000) + "\n" + body, "A".repeat(41),
  btoa(body) + "\n--short-prefix-mime-tail",
  'Content-Type: multipart/mixed; boundary="bad"\nContent-Transfer-Encoding: base64\n%%%']) {
  Deno.test("IMO preflight: unreadable/truncated inbound cannot silently use legacy pricing " + String(text).slice(0, 28), async () => {
    const { evidence, plan } = await project([mail(text)]);
    assert(evidence.reasons.includes("INCOMPLETE_EMAIL_SOURCE"));
    assertEquals(plan.status, "BLOCKED");
  });
}
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
  { name: "partial email collection fails closed", identity: client, text: body, partial: true, status: 500, error: "Internal server error" },
  { name: "email read error fails closed", identity: client, text: body, readError: true, status: 500, error: "Internal server error" },
  { name: "provisional cannot bypass IMO scope", identity: client, text: body, provisional: true, status: 400, error: "IMO goods scope requires clarification" },
  { name: "air remains outside group pricing scope", identity: client, text: body, requestType: "AIR_IMPORT", status: 400, error: "IMO goods scope requires clarification" },
  { name: "multi-quote remains outside group pricing scope", identity: client, text: body, requestLines: 2, status: 400, error: "IMO goods scope requires clarification" },
]) {
  Deno.test("IMO preflight actual handler: " + scenario.name, async () => {
    const originalFetch = globalThis.fetch;
    const envKeys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
    const savedEnv = envKeys.map(key => Deno.env.get(key));
    const requests: string[] = [];
    const writes: string[] = [];
    try {
      Deno.env.set("SUPABASE_URL", "https://unit-test.invalid");
      Deno.env.set("SUPABASE_ANON_KEY", "synthetic-anon-key");
      Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
      globalThis.fetch = (async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const method = init?.method ?? (input instanceof Request ? input.method : "GET");
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
          if (scenario.readError) return new Response(JSON.stringify({ message: "synthetic read failure" }), {
            status: 503, headers: { "Content-Type": "application/json" },
          });
          data = [mail(scenario.text)]; count = scenario.partial ? 2 : 1;
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
