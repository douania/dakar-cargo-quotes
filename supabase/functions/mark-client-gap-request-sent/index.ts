/**
 * Phase CL1 — Mark client gap requests as sent
 * 
 * Allows the operator to confirm they have manually sent
 * the clarification email to the client.
 * 
 * Input: { case_id, gap_keys: string[] }
 * Effect: drafted → sent, sent_at = now()
 * Idempotence: no-op if already sent/answered/validated/cancelled
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { hasPadGapReference, PAD_REVIEW_GAP_KEY } from "../_shared/pad-gap-review.ts";

Deno.serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  try {
    const { case_id, gap_keys, expected_requests } = await req.json();

    if (!case_id || !Array.isArray(gap_keys) || gap_keys.length === 0) {
      return errorResponse("case_id and gap_keys (non-empty array) are required", 400);
    }

    // Verify case access via RLS
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
      auth: { persistSession: false },
    });

    const { data: caseRow, error: caseErr } = await userClient
      .from("quote_cases")
      .select("id")
      .eq("id", case_id)
      .maybeSingle();

    if (caseErr || !caseRow) {
      return errorResponse("Case not found or access denied", 404);
    }

    if (expected_requests !== undefined && (!Array.isArray(expected_requests) || expected_requests.some((item: unknown) => {
      const intent = item as Record<string, unknown> | null;
      return !intent || typeof intent.gap_key !== "string" || typeof intent.request_id !== "string" || typeof intent.source_timeline_event_id !== "string";
    }))) return errorResponse("Invalid expected_requests", 400);

    const serviceClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    let updated = 0;
    let skipped = 0;

    for (const gapKey of gap_keys) {
      if (typeof gapKey !== "string" || !gapKey.trim()) {
        skipped++;
        continue;
      }
      if (gapKey === PAD_REVIEW_GAP_KEY) {
        skipped++;
        continue;
      }

      // Find row with status = 'drafted'
      const { data: row, error: findErr } = await serviceClient
        .from("client_gap_requests")
        .select("id, status, source_timeline_event_id")
        .eq("case_id", case_id)
        .eq("gap_key", gapKey)
        .in("status", ["drafted", "sent", "answered"])
        .maybeSingle();

      if (findErr) {
        console.warn(`[mark-client-gap-request-sent] Find failed for ${gapKey}:`, findErr.message);
        skipped++;
        continue;
      }

      if (!row) {
        skipped++;
        continue;
      }

      // Only update if currently drafted
      if (row.status !== "drafted") {
        skipped++;
        continue;
      }

      // A mixed historical email may contain the retired PAD question even
      // when this row belongs to another gap. Fail closed on unavailable source.
      const { data: source, error: sourceErr } = await userClient.from("case_timeline_events")
        .select("event_data").eq("case_id", case_id).eq("id", row.source_timeline_event_id)
        .eq("event_type", "output_generated").maybeSingle();
      // This records an actual human send; it is not eligibility for a NEW send.
      // A clean historical body may be acknowledged after a policy upgrade.
      const sourceData = source?.event_data as Record<string, unknown> | null;
      if (sourceErr || !sourceData || sourceData.kind !== "reply_draft_v1" ||
          !Array.isArray(sourceData.requested_gap_keys) || !sourceData.requested_gap_keys.includes(gapKey) ||
          hasPadGapReference(sourceData.requested_gap_keys, sourceData.source_action_dedupe_key ?? sourceData.dedupe_key)) {
        skipped++;
        continue;
      }

      const intents = (expected_requests ?? []).filter((item: { gap_key: string }) => item.gap_key === gapKey);
      const intent = intents.length === 1 ? intents[0] : null;
      const protectedSource = sourceData.client_question_policy_version === 4 && sourceData.client_gap_fence_version === 1;
      if ((protectedSource || expected_requests !== undefined) && (!intent || intent.request_id !== row.id || intent.source_timeline_event_id !== row.source_timeline_event_id)) {
        return jsonResponse({ ok: false, error: "CLIENT_GAP_EXPECTED_SOURCE_REQUIRED", updated, skipped }, 409);
      }
      // Forward only the caller's checked intent. Never manufacture an intent
      // from the latest row found by gap key. The DB also checks these headers.
      const mutationClient = intent ? createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false },
        global: { headers: {
          "x-dcq-client-gap-request-id": intent.request_id,
          "x-dcq-client-gap-source-id": intent.source_timeline_event_id,
        } },
      }) : serviceClient;
      const { data: updatedRows, error: updateErr } = await mutationClient
        .from("client_gap_requests")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", row.id).eq("case_id", case_id).eq("status", "drafted")
        .eq("source_timeline_event_id", row.source_timeline_event_id).select("id");

      if (updateErr?.code === "PT409") {
        return jsonResponse({ ok: false, error: "CLIENT_GAP_SCOPE_CHANGED", updated, skipped }, 409);
      }
      if (updateErr) {
        console.warn(`[mark-client-gap-request-sent] Update failed for ${gapKey}:`, updateErr.message);
        skipped++;
      } else if (Array.isArray(updatedRows) && updatedRows.length === 1 && updatedRows[0].id === row.id) {
        updated++;
      } else {
        // A concurrent reconciliation may have consumed the CAS. No false receipt.
        skipped++;
      }
    }

    return jsonResponse({ ok: true, updated, skipped });
  } catch (err) {
    console.error("[mark-client-gap-request-sent] Error:", (err as Error).message);
    return errorResponse("Internal server error", 500);
  }
});
