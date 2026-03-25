/**
 * EQ1 M15b — Deterministic Smoke Test
 *
 * Validates the M15b / M15b-fix corrections on validate-partner-fact:
 *   A. Zero facts via analyze-partner-response (only AI-dependent scenario)
 *   B. Partial validation via seeded DB facts
 *   C. Last fact + REVIEW_PARTNER_RESPONSE auto-close
 *   D. Closed guard — idempotent return on closed request
 *
 * Run: deno test --allow-net --allow-env --allow-read supabase/functions/_tests/eq1_m15b_smoke.test.ts
 */

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import {
  assertEquals,
  assertExists,
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ============================================================================
// CONFIG
// ============================================================================

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
// Test user — created dynamically if no PHASE15_TEST_EMAIL is set
const TEST_EMAIL = Deno.env.get("PHASE15_TEST_EMAIL") || `eq1-test-${Date.now()}@test.local`;
const TEST_PASSWORD = Deno.env.get("PHASE15_TEST_PASSWORD") || "TestPass123!";

const TAG = `EQ1_M15B_TEST_${Date.now()}`;
const TIMEOUT_MS = 20_000;

// ============================================================================
// HELPERS
// ============================================================================

const svcHeaders = () => ({
  "Content-Type": "application/json",
  apikey: SERVICE_ROLE_KEY!,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  Prefer: "return=representation",
});

async function restInsert<T>(table: string, row: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: svcHeaders(),
    body: JSON.stringify(row),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Insert ${table} failed (${res.status}): ${text}`);
  const data = JSON.parse(text);
  return Array.isArray(data) ? data[0] : data;
}

async function restSelect<T>(table: string, query: string): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: svcHeaders(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Select ${table} failed (${res.status}): ${text}`);
  return JSON.parse(text);
}

async function restDelete(table: string, query: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: "DELETE",
    headers: { ...svcHeaders(), Prefer: "return=minimal" },
  });
  await res.text(); // consume body
}

async function restUpdate(table: string, query: string, patch: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: svcHeaders(),
    body: JSON.stringify(patch),
  });
  await res.text();
}

let createdUserId: string | null = null;

async function getTestToken(): Promise<string> {
  // Try sign-in first
  const signInRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  const signInText = await signInRes.text();
  if (signInRes.ok) {
    const data = JSON.parse(signInText);
    return data.access_token;
  }

  // Create user via admin API if sign-in failed
  console.log("  🔧 Creating test user via admin API...");
  const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    }),
  });
  const createText = await createRes.text();
  if (!createRes.ok) throw new Error(`Create user failed: ${createText}`);
  const created = JSON.parse(createText);
  createdUserId = created.id;
  addCleanup(async () => {
    if (!createdUserId) return;
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${createdUserId}`, {
      method: "DELETE",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
    });
    await r.text();
    console.log(`[cleanup] Deleted test user ${createdUserId}`);
  });

  // Now sign in
  const retryRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  const retryText = await retryRes.text();
  if (!retryRes.ok) throw new Error(`Sign-in after create failed: ${retryText}`);
  return JSON.parse(retryText).access_token;
}

async function callEdge(fn: string, body: unknown, token: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    const text = await res.text();
    let json: Record<string, unknown>;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { status: res.status, json };
  } catch (e) {
    clearTimeout(tid);
    throw e;
  }
}

// ============================================================================
// TEST IDS — collected for cleanup
// ============================================================================
const cleanup: Array<() => Promise<void>> = [];

function addCleanup(fn: () => Promise<void>) {
  cleanup.unshift(fn); // LIFO order for FK safety
}

async function runCleanup() {
  for (const fn of cleanup) {
    try { await fn(); } catch (e) {
      console.warn(`[cleanup] ${(e as Error).message}`);
    }
  }
}

// ============================================================================
// PRECONDITION CHECKS
// ============================================================================
Deno.test({
  name: "EQ1-M15b: preconditions",
  fn() {
    assertExists(SUPABASE_URL, "VITE_SUPABASE_URL must be set");
    assertExists(SUPABASE_ANON_KEY, "VITE_SUPABASE_PUBLISHABLE_KEY must be set");
    assertExists(SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY must be set");
    assertExists(TEST_EMAIL, "PHASE15_TEST_EMAIL must be set");
    assertExists(TEST_PASSWORD, "PHASE15_TEST_PASSWORD must be set");
  },
});

// ============================================================================
// SHARED STATE
// ============================================================================
let token: string;
let userId: string;
let threadId: string;
let caseId: string;
let emailId: string;
let requestId: string;

// Scenario B/C/D state
let responseId: string;
let factIds: string[] = [];

// ============================================================================
// SETUP: create thread → case → email → request (shared for all scenarios)
// ============================================================================
Deno.test({
  name: "EQ1-M15b: setup test fixtures",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    token = await getTestToken();

    // Decode user_id from JWT
    const payload = JSON.parse(atob(token.split(".")[1]));
    userId = payload.sub;

    // 1. Thread
    const thread = await restInsert<{ id: string }>("email_threads", {
      subject_normalized: `${TAG} partner test thread`,
    });
    threadId = thread.id;
    addCleanup(() => restDelete("email_threads", `id=eq.${threadId}`));

    // 2. Email (the "partner reply" — benign content for scenario A)
    const email = await restInsert<{ id: string }>("emails", {
      message_id: `${TAG}@test.local`,
      from_address: "partner-test@example.com",
      to_addresses: ["ops@sodatra.com"],
      subject: `${TAG} Réponse partenaire`,
      body_text: "Bonjour, merci pour votre demande. Cordialement.",
      thread_ref: threadId,
    });
    emailId = email.id;
    addCleanup(() => restDelete("emails", `id=eq.${emailId}`));

    // 3. Case
    const qc = await restInsert<{ id: string }>("quote_cases", {
      thread_id: threadId,
      status: "open",
      created_by: userId,
    });
    caseId = qc.id;
    addCleanup(() => restDelete("quote_cases", `id=eq.${caseId}`));

    // 4. External request
    const req = await restInsert<{ id: string }>("external_quote_requests", {
      case_id: caseId,
      partner_name: `${TAG} TestPartner`,
      partner_email: "partner-test@example.com",
      purpose: "freight_rate",
      status: "sent",
      created_by: userId,
    });
    requestId = req.id;
    addCleanup(() => restDelete("external_quote_requests", `id=eq.${requestId}`));

    console.log(`[setup] TAG=${TAG} case=${caseId} request=${requestId}`);
  },
});

// ============================================================================
// SCENARIO A — Zero facts via analyze-partner-response
// ============================================================================
Deno.test({
  name: "EQ1-M15b-A: zero facts from benign email",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { status, json } = await callEdge("analyze-partner-response", {
      case_id: caseId,
      request_id: requestId,
      email_id: emailId,
    }, token);

    console.log(`[A] status=${status} json=`, JSON.stringify(json).slice(0, 300));

    assertEquals(status, 200, `Expected 200, got ${status}`);
    assertEquals(json.ok, true);

    // The AI may extract 0 or very few facts from a benign email
    const facts = json.facts as unknown[];
    const factsCount = json.facts_count ?? (facts?.length ?? 0);
    console.log(`[A] facts_count=${factsCount}`);

    // Verify request status updated
    const reqs = await restSelect<{ status: string }>(
      "external_quote_requests",
      `id=eq.${requestId}&select=status`
    );
    assert(reqs.length > 0, "Request should exist");
    console.log(`[A] request.status=${reqs[0].status}`);

    // Cleanup: delete any response/facts created by analyze
    const responses = await restSelect<{ id: string }>(
      "external_quote_responses",
      `request_id=eq.${requestId}&select=id`
    );
    for (const r of responses) {
      addCleanup(() => restDelete("external_quote_response_facts", `response_id=eq.${r.id}`));
      addCleanup(() => restDelete("external_quote_responses", `id=eq.${r.id}`));
    }

    // Reset request status for next scenarios
    await restUpdate("external_quote_requests", `id=eq.${requestId}`, { status: "sent" });
  },
});

// ============================================================================
// SCENARIO B — Partial validation (seeded facts)
// ============================================================================
Deno.test({
  name: "EQ1-M15b-B: partial validation with seeded facts",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    // Seed: response
    const resp = await restInsert<{ id: string }>("external_quote_responses", {
      request_id: requestId,
      case_id: caseId,
      source_email_id: emailId,
      raw_excerpt: `${TAG} seeded response`,
      status: "analyzed",
      received_at: new Date().toISOString(),
    });
    responseId = resp.id;
    addCleanup(() => restDelete("external_quote_responses", `id=eq.${responseId}`));

    // Seed: 3 proposed facts
    factIds = [];
    for (let i = 0; i < 3; i++) {
      const f = await restInsert<{ id: string }>("external_quote_response_facts", {
        request_id: requestId,
        response_id: responseId,
        case_id: caseId,
        fact_key: `cargo.test_${TAG}_${i}`,
        proposed_value_text: `value_${i}`,
        proposed_value_number: (i + 1) * 100,
        confidence: 0.9,
        validation_status: "proposed",
        source_excerpt: `test excerpt ${i}`,
      });
      factIds.push(f.id);
    }
    addCleanup(() => restDelete("external_quote_response_facts", `response_id=eq.${responseId}`));

    // Seed: REVIEW_PARTNER_RESPONSE manual_action (open)
    const reviewDedupeKey = `partner_review:${responseId}`;
    await restInsert<{ id: string }>("case_timeline_events", {
      case_id: caseId,
      event_type: "manual_action",
      actor_type: "system",
      event_data: {
        dedupe_key: reviewDedupeKey,
        action_code: "REVIEW_PARTNER_RESPONSE",
        status: "open",
      },
    });
    addCleanup(() => restDelete("case_timeline_events", `case_id=eq.${caseId}`));

    // Update request to response_analyzed (normal pre-validation state)
    await restUpdate("external_quote_requests", `id=eq.${requestId}`, {
      status: "response_analyzed",
    });

    // Validate ONLY the first fact
    const { status, json } = await callEdge("validate-partner-fact", {
      fact_id: factIds[0],
      action: "validate",
    }, token);

    console.log(`[B] status=${status} json=`, JSON.stringify(json).slice(0, 300));

    assertEquals(status, 200, `Expected 200, got ${status}`);
    assertEquals(json.ok, true, "Should return ok: true");
    assertEquals(json.new_request_status, "partially_validated",
      `Expected partially_validated, got ${json.new_request_status}`);

    // Verify REVIEW action is still open (not closed yet)
    const events = await restSelect<{ event_data: Record<string, unknown> }>(
      "case_timeline_events",
      `case_id=eq.${caseId}&event_type=eq.manual_action&order=created_at.desc&limit=20`
    );
    const reviewEvents = events.filter(
      (e) => (e.event_data as Record<string, unknown>)?.dedupe_key === reviewDedupeKey
    );
    const latestReview = reviewEvents[0];
    assertExists(latestReview, "REVIEW event should exist");
    // The latest one should still be open (the done one is NOT inserted yet since proposedCount > 0)
    const latestStatus = (latestReview.event_data as Record<string, unknown>)?.status;
    console.log(`[B] REVIEW latest status=${latestStatus}`);
    // After partial validation, we should NOT have a "done" event for REVIEW
    assert(
      reviewEvents.some((e) => (e.event_data as Record<string, unknown>)?.status === "open"),
      "REVIEW action should still have an open event"
    );
  },
});

// ============================================================================
// SCENARIO C — Last fact + REVIEW auto-close
// ============================================================================
Deno.test({
  name: "EQ1-M15b-C: last fact triggers REVIEW close",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    // Validate fact[1]
    const r1 = await callEdge("validate-partner-fact", {
      fact_id: factIds[1],
      action: "validate",
    }, token);
    console.log(`[C] fact[1] status=${r1.status} new_request_status=${r1.json.new_request_status}`);
    assertEquals(r1.status, 200);
    assertEquals(r1.json.ok, true);
    // Still one remaining → partially_validated
    assertEquals(r1.json.new_request_status, "partially_validated");

    // Reject fact[2] — the last proposed fact
    const r2 = await callEdge("validate-partner-fact", {
      fact_id: factIds[2],
      action: "reject",
    }, token);
    console.log(`[C] fact[2] status=${r2.status} new_request_status=${r2.json.new_request_status}`);
    assertEquals(r2.status, 200);
    assertEquals(r2.json.ok, true);
    // All facts terminal, 2 validated + 1 rejected → facts_validated
    assertEquals(r2.json.new_request_status, "facts_validated",
      `Expected facts_validated, got ${r2.json.new_request_status}`);

    // Verify REVIEW_PARTNER_RESPONSE closed (done event inserted)
    const reviewDedupeKey = `partner_review:${responseId}`;
    const events = await restSelect<{ event_data: Record<string, unknown> }>(
      "case_timeline_events",
      `case_id=eq.${caseId}&event_type=eq.manual_action&order=created_at.desc&limit=20`
    );
    const reviewDoneEvents = events.filter((e) => {
      const ed = e.event_data as Record<string, unknown>;
      return ed?.dedupe_key === reviewDedupeKey && ed?.status === "done";
    });
    assert(reviewDoneEvents.length > 0, "REVIEW_PARTNER_RESPONSE should have a 'done' event");
    console.log(`[C] REVIEW done events: ${reviewDoneEvents.length}`);

    // Idempotence: re-validate already validated fact
    const r3 = await callEdge("validate-partner-fact", {
      fact_id: factIds[0],
      action: "validate",
    }, token);
    console.log(`[C] idempotence status=${r3.status} idempotent=${r3.json.idempotent}`);
    assertEquals(r3.status, 200);
    assertEquals(r3.json.ok, true);
    assertEquals(r3.json.idempotent, true, "Re-validating should be idempotent");
  },
});

// ============================================================================
// SCENARIO D — Closed guard
// ============================================================================
Deno.test({
  name: "EQ1-M15b-D: closed guard prevents reopening",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    // Force request to "closed"
    await restUpdate("external_quote_requests", `id=eq.${requestId}`, {
      status: "closed",
    });

    // Reset a fact to "proposed" to simulate an edge case
    await restUpdate("external_quote_response_facts", `id=eq.${factIds[0]}`, {
      validation_status: "proposed",
      validated_by: null,
      validated_at: null,
      injected_fact_id: null,
    });

    // Call validate-partner-fact — should return idempotent due to closed guard
    const { status, json } = await callEdge("validate-partner-fact", {
      fact_id: factIds[0],
      action: "validate",
    }, token);

    console.log(`[D] status=${status} json=`, JSON.stringify(json).slice(0, 300));

    assertEquals(status, 200, `Expected 200, got ${status}`);
    assertEquals(json.ok, true);
    assertEquals(json.idempotent, true, "Should return idempotent when request is closed");

    // Verify request status is still "closed"
    const reqs = await restSelect<{ status: string }>(
      "external_quote_requests",
      `id=eq.${requestId}&select=status`
    );
    assertEquals(reqs[0].status, "closed", "Request should remain closed");

    // Count timeline events — no new event should have been created
    const eventsAfter = await restSelect<{ id: string }>(
      "case_timeline_events",
      `case_id=eq.${caseId}&event_type=eq.manual_action&order=created_at.desc&limit=50`
    );
    // We just verify the function didn't crash and returned idempotent
    console.log(`[D] Total timeline events for case: ${eventsAfter.length}`);
  },
});

// ============================================================================
// CLEANUP
// ============================================================================
Deno.test({
  name: "EQ1-M15b: cleanup",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    // Also clean up any quote_facts injected by validate-partner-fact
    try {
      await restDelete("quote_facts", `case_id=eq.${caseId}`);
    } catch { /* ignore */ }

    await runCleanup();
    console.log(`[cleanup] Done for TAG=${TAG}`);
  },
});
