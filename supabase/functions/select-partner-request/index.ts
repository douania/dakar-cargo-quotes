/**
 * COCKPIT-9 Phase 2 — Select a partner request as the retained commercial offer.
 * Atomic: only one request per case can be selected.
 * Preconditions: request must be exploitable (response phase + 0 proposed facts).
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

const RESPONSE_PHASE_STATUSES = new Set([
  "response_received",
  "response_analyzed",
  "partially_validated",
  "facts_validated",
  "closed",
]);

serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return errorResponse("Missing Authorization header", 401);

  try {
    const { case_id, request_id } = await req.json();
    if (!case_id || !request_id) {
      return errorResponse("case_id and request_id are required", 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // 1. Verify case access via RLS
    const { data: qc, error: qcErr } = await userClient
      .from("quote_cases")
      .select("id")
      .eq("id", case_id)
      .maybeSingle();

    if (qcErr || !qc) return errorResponse("Case not found", 404);

    // 2. Load the target request
    const { data: request, error: reqErr } = await serviceClient
      .from("external_quote_requests")
      .select("id, case_id, partner_name, status, is_selected")
      .eq("id", request_id)
      .maybeSingle();

    if (reqErr || !request) return errorResponse("Request not found", 404);
    if (request.case_id !== case_id) return errorResponse("Request does not belong to this case", 400);

    // 3. Idempotence: already selected
    if (request.is_selected) {
      return jsonResponse({ ok: true, idempotent: true, request_id, partner_name: request.partner_name });
    }

    // 4. Precondition: status must be in response phase
    if (!RESPONSE_PHASE_STATUSES.has(request.status)) {
      return errorResponse(
        `Request status "${request.status}" is not exploitable. Must be in response phase or closed.`,
        422
      );
    }

    // 5. Precondition: no proposed facts pending on this request
    const { count: pendingFacts } = await serviceClient
      .from("external_quote_response_facts")
      .select("id", { count: "exact", head: true })
      .eq("request_id", request_id)
      .eq("validation_status", "proposed");

    if ((pendingFacts ?? 0) > 0) {
      return errorResponse(
        `${pendingFacts} proposed fact(s) still pending validation on this request. Validate them first.`,
        422
      );
    }

    // 6. Atomic selection: deselect all, then select target
    const { error: deselectErr } = await serviceClient
      .from("external_quote_requests")
      .update({ is_selected: false, selected_at: null })
      .eq("case_id", case_id)
      .eq("is_selected", true);

    if (deselectErr) {
      console.error("[select-partner-request] Deselect failed:", deselectErr.message);
      return errorResponse("Failed to deselect previous request", 500);
    }

    const { error: selectErr } = await serviceClient
      .from("external_quote_requests")
      .update({ is_selected: true, selected_at: new Date().toISOString() })
      .eq("id", request_id);

    if (selectErr) {
      // Handle unique constraint violation (concurrent selection)
      if (selectErr.message?.includes("idx_eqr_one_selected_per_case") || selectErr.code === "23505") {
        return errorResponse("Another request was selected concurrently. Please retry.", 409);
      }
      console.error("[select-partner-request] Select failed:", selectErr.message);
      return errorResponse("Failed to select request", 500);
    }

    // 7. Timeline event
    await serviceClient.from("case_timeline_events").insert({
      case_id,
      event_type: "manual_action",
      actor_type: "operator",
      actor_user_id: auth.user.id,
      event_data: {
        action_code: "PARTNER_REQUEST_SELECTED",
        request_id,
        partner_name: request.partner_name,
        selected_at: new Date().toISOString(),
      },
    });

    return jsonResponse({ ok: true, idempotent: false, request_id, partner_name: request.partner_name });
  } catch (err) {
    console.error("[select-partner-request] Unexpected error:", (err as Error).message);
    return errorResponse("Internal server error", 500);
  }
});
