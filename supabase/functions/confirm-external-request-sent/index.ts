/**
 * confirm-external-request-sent
 * 
 * P0-C — Confirms that an external partner quote request has actually been sent.
 * Sets email_sent_at = now() on external_quote_requests where status = "sent"
 * and email_sent_at is still NULL.
 * 
 * Auth: requireUser (verify_jwt = false in config.toml)
 * Preconditions:
 *   - request exists with matching case_id
 *   - status === "sent"
 *   - email_draft_id is present (integrity check)
 *   - email_sent_at is NULL (idempotent if already set)
 * 
 * Timeline: manual_action with action_code PARTNER_REQUEST_SEND_CONFIRMED
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  // Auth
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

    // Fetch request
    const { data: request, error: fetchError } = await serviceClient
      .from("external_quote_requests")
      .select("id, case_id, status, email_sent_at, email_draft_id, partner_name")
      .eq("id", request_id)
      .eq("case_id", case_id)
      .single();

    if (fetchError || !request) {
      return errorResponse("Request not found or case_id mismatch", 404);
    }

    // Idempotence: already confirmed
    if (request.email_sent_at) {
      return jsonResponse({ ok: true, idempotent: true });
    }

    // Precondition: status must be "sent"
    if (request.status !== "sent") {
      return errorResponse(
        `Invalid status: expected "sent", got "${request.status}"`,
        409
      );
    }

    // Precondition: email_draft_id must be present (integrity)
    if (!request.email_draft_id) {
      return errorResponse(
        "Integrity error: email_draft_id is missing on a sent request",
        422
      );
    }

    // Update: set email_sent_at
    const { error: updateError } = await serviceClient
      .from("external_quote_requests")
      .update({ email_sent_at: new Date().toISOString() })
      .eq("id", request_id);

    if (updateError) {
      console.error("[P0-C] Update failed:", updateError.message);
      return errorResponse("Failed to confirm send: " + updateError.message, 500);
    }

    // Timeline event
    const { error: timelineError } = await serviceClient
      .from("case_timeline_events")
      .insert({
        case_id,
        event_type: "manual_action",
        actor_type: "operator",
        actor_user_id: auth.user.id,
        new_value: `Envoi confirmé: ${request.partner_name || request_id}`,
        event_data: {
          dedupe_key: `partner_request_send_confirmed:${request_id}`,
          action_code: "PARTNER_REQUEST_SEND_CONFIRMED",
          status: "done",
          request_id,
          partner_name: request.partner_name || null,
        },
      });

    if (timelineError) {
      console.warn("[P0-C] Timeline insert failed:", timelineError.message);
      // Non-fatal: the confirmation itself succeeded
    }

    return jsonResponse({ ok: true, idempotent: false });
  } catch (err) {
    console.error("[P0-C] Unexpected error:", err);
    return errorResponse("Internal error", 500);
  }
});
