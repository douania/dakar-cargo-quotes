import { createClient } from "jsr:@supabase/supabase-js@2";
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";

const previousFlag = Deno.env.get("RUN_PRICING_DISABLE_SERVE");
Deno.env.set("RUN_PRICING_DISABLE_SERVE", "1");
const { getOpenCommunicationLoopsGuard, getSelectedPartnerOfferGuard } = await import("./index.ts");
if (previousFlag === undefined) Deno.env.delete("RUN_PRICING_DISABLE_SERVE");
else Deno.env.set("RUN_PRICING_DISABLE_SERVE", previousFlag);

type Row = Record<string, unknown>;
const caseId = "synthetic-guard-case";
const origin = "https://pricing-guard-fixture.invalid";

/** Real SDK query builders, with all HTTP replaced and no network permission. */
function fixture(rows: Record<string, Row[]> = {}, failTable?: string) {
  const calls: Array<{ table: string; method: string; query: URLSearchParams }> = [];
  const client = createClient(origin, "synthetic-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch(input, init) {
        const request = new Request(input, init);
        const url = new URL(request.url);
        assertEquals(url.origin, origin, "No real backend request is permitted");
        assertEquals(request.method, "GET", "Guards may only read");
        assert(url.pathname.startsWith("/rest/v1/"));
        const table = url.pathname.slice("/rest/v1/".length);
        calls.push({ table, method: request.method, query: url.searchParams });
        assertEquals(url.searchParams.get("case_id"), `eq.${caseId}`);
        assert(url.searchParams.get("select"));
        return Promise.resolve(table === failTable
          ? Response.json({ code: "SYNTHETIC", message: "synthetic guard read failed" }, { status: 400 })
          : Response.json(rows[table] ?? []));
      },
    },
  });
  return { client, calls };
}

Deno.test("SDK guard contract: both guards accept real table/select builders and allow clear reads", async () => {
  const { client, calls } = fixture();
  const open = await getOpenCommunicationLoopsGuard(client, caseId);
  const selected = await getSelectedPartnerOfferGuard(client, caseId);
  assertEquals(open.blocked, false);
  assertEquals(selected.blocked, false);
  assertEquals(calls.map((call) => call.table), [
    "external_quote_requests", "external_quote_response_facts", "client_gap_requests", "quote_gaps",
    "external_quote_requests", "external_quote_response_facts", "quote_facts",
  ]);
  assertEquals(calls[0].query.get("status"), "in.(draft,sent,response_received,response_analyzed,partially_validated)");
  assertEquals(calls[1].query.get("validation_status"), "eq.proposed");
  assertEquals(calls[2].query.get("status"), "in.(drafted,sent,answered)");
  assertEquals(calls[3].query.get("status"), "eq.open");
  assertEquals(calls[5].query.get("validation_status"), "eq.validated");
  assertEquals(calls[6].query.get("is_current"), "eq.true");
  assertEquals(calls[6].query.get("source_type"), "eq.partner_response");
});

Deno.test("SDK guard contract: open client/partner communication remains blocking", async () => {
  const { client, calls } = fixture({
    external_quote_requests: [{ id: "synthetic-request" }],
    external_quote_response_facts: [{ id: "synthetic-proposed-fact" }],
    client_gap_requests: [{ id: "synthetic-client-request", gap_key: "cargo.value" }],
    quote_gaps: [{ gap_key: "cargo.value" }],
  });
  assertEquals(await getOpenCommunicationLoopsGuard(client, caseId), {
    blocked: true, open_partner_requests_count: 1, pending_partner_facts_count: 1, open_client_gap_requests_count: 1,
  });
  assertEquals(calls.length, 4);
});

for (const matched of [true, false]) {
  Deno.test(`SDK guard contract: selected partner offer coherence remains enforced, matched=${matched}`, async () => {
    const { client, calls } = fixture({
      external_quote_requests: [{ id: "synthetic-chosen", is_selected: true }],
      external_quote_response_facts: [{
        request_id: "synthetic-chosen", fact_key: "cargo.freight_cost", validation_status: "validated",
        injected_fact_id: "synthetic-chosen-fact",
      }],
      quote_facts: [{
        id: matched ? "synthetic-chosen-fact" : "synthetic-other-fact",
        fact_key: "cargo.freight_cost", source_type: "partner_response",
      }],
    });
    const guard = await getSelectedPartnerOfferGuard(client, caseId);
    assertEquals(guard.blocked, !matched);
    assertEquals(guard.selected_partner_request_id, "synthetic-chosen");
    assertEquals(guard.reason, matched ? null : "selected_partner_offer_mismatch");
    assertEquals(guard.mismatched_fact_keys, matched ? [] : ["cargo.freight_cost"]);
    assertEquals(calls.length, 3);
  });
}

for (const table of ["external_quote_requests", "external_quote_response_facts", "client_gap_requests", "quote_gaps"]) {
  Deno.test(`SDK guard contract: open-loop read error stops the guard, table=${table}`, async () => {
    const { client, calls } = fixture({}, table);
    await assertRejects(() => getOpenCommunicationLoopsGuard(client, caseId), Error, "synthetic guard read failed");
    assertEquals(calls.length, 4);
  });
}

for (const table of ["external_quote_requests", "external_quote_response_facts", "quote_facts"]) {
  Deno.test(`SDK guard contract: selected-offer read error stops the guard, table=${table}`, async () => {
    const { client, calls } = fixture({}, table);
    await assertRejects(() => getSelectedPartnerOfferGuard(client, caseId), Error, "synthetic guard read failed");
    assertEquals(calls.length, 3);
  });
}
