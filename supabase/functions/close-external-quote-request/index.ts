/**
 * close-external-quote-request
 * 
 * P1-B — Backendise la clôture d'une demande partenaire.
 * 
 * Auth: requireUser (verify_jwt = false in config.toml)
 * 
 * Préconditions:
 *   - request exists with matching case_id
 *   - status !== "closed" (idempotent if already closed)
 *   - no external_quote_response_facts with validation_status = "proposed" for this request_id
 * 
 * Timeline: manual_action with action_code PARTNER_REQUEST_CLOSED
 * Timeline policy: NON-SILENT — timeline insert failure causes a 500 response.
 *   The update is already committed, but the caller gets an explicit error
 *   so the operator knows the trace is incomplete.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  try {
    const body = await req.json();
    const { case_id, request_id } = body;

    if (!case_id || !request_id) {
      return errorResponse("case_id and request_id are required", 400);
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    // 1. Fetch request
    const { data: request, error: fetchError } = await serviceClient
      .from("external_quote_requests")
      .select("id, case_id, status, partner_name")
      .eq("id", request_id)
      .eq("case_id", case_id)
      .single();

    if (fetchError || !request) {
      return errorResponse("Request not found or case_id mismatch", 404);
    }

    // 2. Idempotence: already closed
    if (request.status === "closed") {
      return jsonResponse({ ok: true, idempotent: true });
    }

    // 3. Check for pending proposed facts
    const { count: proposedCount, error: countError } = await serviceClient
      .from("external_quote_response_facts")
      .select("*", { count: "exact", head: true })
      .eq("request_id", request_id)
      .eq("validation_status", "proposed");

    if (countError) {
      console.error("[P1-B] Failed to count proposed facts:", countError.message);
      return errorResponse("Failed to check pending facts: " + countError.message, 500);
    }

    if ((proposedCount ?? 0) > 0) {
      return jsonResponse(
        {
          error: "pending_facts_remain",
          message: `${proposedCount} fait(s) proposé(s) restant(s) à traiter avant clôture`,
          proposed_count: proposedCount,
        },
        409
      );
    }

    // 4. Update status to closed
    const { error: updateError } = await serviceClient
      .from("external_quote_requests")
      .update({ status: "closed" })
      .eq("id", request_id);

    if (updateError) {
      console.error("[P1-B] Update failed:", updateError.message);
      return errorResponse("Failed to close request: " + updateError.message, 500);
    }

    // 5. Timeline event — NON-SILENT: failure → 500
    const { error: timelineError } = await serviceClient
      .from("case_timeline_events")
      .insert({
        case_id,
        event_type: "manual_action",
        actor_type: "operator",
        actor_user_id: auth.user.id,
        new_value: `Demande partenaire clôturée: ${request.partner_name || request_id}`,
        event_data: {
          dedupe_key: `external_request_closed:${request_id}`,
          action_code: "PARTNER_REQUEST_CLOSED",
          status: "done",
          request_id,
          partner_name: request.partner_name || null,
        },
      });

    if (timelineError) {
      // NON-SILENT: the update succeeded but timeline failed.
      // We return 500 so the operator knows the trace is incomplete.
      console.error("[P1-B] Timeline insert failed:", timelineError.message);
      return jsonResponse(
        {
          ok: false,
          error: "timeline_insert_failed",
          message: "Request closed but timeline event failed — trace incomplete",
          detail: timelineError.message,
        },
        500
      );
    }

    return jsonResponse({ ok: true, idempotent: false });
  } catch (err) {
    console.error("[P1-B] Unexpected error:", err);
    return errorResponse("Internal error", 500);
  }
});
