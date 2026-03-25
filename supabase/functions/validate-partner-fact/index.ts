// Phase EQ1.2 — Validate or reject a partner-proposed fact
// SECURITY: requireUser is mandatory because verify_jwt=false
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

// P2-1: Extended mapping fact_key → fact_category for supersede_fact RPC
const FACT_KEY_CATEGORIES: Record<string, string> = {
  "cargo.": "cargo",
  "routing.": "routing",
  "customs.": "customs",
  "service.": "service",
  "client.": "client",
  "regulatory.": "regulatory",
  "timing.": "timing",
  "pricing.": "pricing",
  "documents.": "documents",
  "contacts.": "contacts",
  "other.": "other",
};

function inferCategory(factKey: string): string {
  for (const [prefix, category] of Object.entries(FACT_KEY_CATEGORIES)) {
    if (factKey.startsWith(prefix)) return category;
  }
  return "cargo"; // safe default
}

serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  try {
    const { fact_id, action } = await req.json();
    if (!fact_id) return errorResponse("fact_id is required", 400);
    if (action !== "validate" && action !== "reject") {
      return errorResponse("action must be 'validate' or 'reject'", 400);
    }

    const authHeader = req.headers.get("Authorization")!;
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

    // 0. Guard: check if the parent request is already closed
    const { data: parentRequest } = await serviceClient
      .from("external_quote_requests")
      .select("status")
      .eq("id", (await (async () => {
        // We need request_id from the fact, load fact first
        const { data: f } = await userClient
          .from("external_quote_response_facts")
          .select("request_id")
          .eq("id", fact_id)
          .maybeSingle();
        return f?.request_id;
      })()))
      .maybeSingle();

    // 1. Load the proposed fact
    const { data: fact, error: factErr } = await userClient
      .from("external_quote_response_facts")
      .select("*")
      .eq("id", fact_id)
      .maybeSingle();

    if (factErr || !fact) return errorResponse("Proposed fact not found", 404);

    // M15b: Early return if request is already closed — prevent reopening
    if (parentRequest?.status === "closed") {
      return jsonResponse({
        ok: true,
        idempotent: true,
        message: "Request is already closed, no action taken",
      });
    }

    if (fact.validation_status !== "proposed") {
      return jsonResponse({
        ok: true,
        idempotent: true,
        message: `Fact already ${fact.validation_status}`,
      });
    }

    const userId = auth.user.id;
    let injectedFactId: string | null = null;

    if (action === "validate") {
      const category = inferCategory(fact.fact_key);

      // P0-3: Exact-match replay guard — check if identical fact already exists in quote_facts
      let replayQuery = serviceClient
        .from("quote_facts")
        .select("id")
        .eq("case_id", fact.case_id)
        .eq("fact_key", fact.fact_key)
        .eq("source_type", "partner_response")
        .eq("is_current", true);

      // IS NOT DISTINCT FROM semantics
      if (fact.proposed_value_text != null) {
        replayQuery = replayQuery.eq("value_text", fact.proposed_value_text);
      } else {
        replayQuery = replayQuery.is("value_text", null);
      }
      if (fact.proposed_value_number != null) {
        replayQuery = replayQuery.eq("value_number", fact.proposed_value_number);
      } else {
        replayQuery = replayQuery.is("value_number", null);
      }
      if (fact.source_excerpt != null) {
        replayQuery = replayQuery.eq("source_excerpt", fact.source_excerpt);
      } else {
        replayQuery = replayQuery.is("source_excerpt", null);
      }

      const { data: existingFact } = await replayQuery.maybeSingle();

      if (existingFact) {
        // Replay hit: reuse existing fact, skip supersede_fact
        console.log(`[validate-partner-fact] Replay guard hit: reusing quote_facts.id=${existingFact.id}`);
        injectedFactId = existingFact.id;
      } else {
        // No replay: call supersede_fact RPC
        const { data: newFactId, error: rpcErr } = await serviceClient.rpc("supersede_fact", {
          p_case_id: fact.case_id,
          p_fact_key: fact.fact_key,
          p_fact_category: category,
          p_value_text: fact.proposed_value_text,
          p_value_number: fact.proposed_value_number,
          p_source_type: "partner_response",
          p_source_excerpt: fact.source_excerpt,
          p_confidence: fact.confidence ?? 0.8,
        });

        if (rpcErr) {
          console.error("[validate-partner-fact] supersede_fact RPC failed:", rpcErr.message);
          return errorResponse("Failed to inject fact", 500);
        }

        injectedFactId = newFactId;
      }

      // 3. Update proposed fact — CRITICAL: must succeed
      // CTO micro-adjustment: always update validation_status even on replay guard hit
      const { error: factUpdateErr } = await serviceClient
        .from("external_quote_response_facts")
        .update({
          validation_status: "validated",
          validated_by: userId,
          validated_at: new Date().toISOString(),
          injected_fact_id: injectedFactId,
        })
        .eq("id", fact_id);

      if (factUpdateErr) {
        console.error("[validate-partner-fact] Fact update failed:", factUpdateErr.message);
        return errorResponse("Failed to update proposed fact status", 500);
      }
    } else {
      // reject — CRITICAL: must succeed
      const { error: rejectUpdateErr } = await serviceClient
        .from("external_quote_response_facts")
        .update({
          validation_status: "rejected",
          validated_by: userId,
          validated_at: new Date().toISOString(),
        })
        .eq("id", fact_id);

      if (rejectUpdateErr) {
        console.error("[validate-partner-fact] Reject update failed:", rejectUpdateErr.message);
        return errorResponse("Failed to update proposed fact status", 500);
      }
    }

    // 4. Compute request status
    const { data: allFacts } = await serviceClient
      .from("external_quote_response_facts")
      .select("validation_status")
      .eq("request_id", fact.request_id);

    const statuses = (allFacts ?? []).map((f: Record<string, unknown>) => f.validation_status);
    const proposedCount = statuses.filter((s: unknown) => s === "proposed").length;
    const validatedCount = statuses.filter((s: unknown) => s === "validated").length;

    let newRequestStatus: string;
    if (proposedCount === 0 && validatedCount > 0) {
      newRequestStatus = "facts_validated";
    } else if (proposedCount === 0 && validatedCount === 0) {
      newRequestStatus = "closed";
    } else {
      newRequestStatus = "partially_validated";
    }

    // P0-3: Request status update is CRITICAL — fail if error
    const { error: requestUpdateErr } = await serviceClient
      .from("external_quote_requests")
      .update({ status: newRequestStatus })
      .eq("id", fact.request_id);

    if (requestUpdateErr) {
      console.error("[validate-partner-fact] Request status update failed:", requestUpdateErr.message);
      return errorResponse("Failed to update request status", 500);
    }

    // 5. Timeline event — NON-CRITICAL: log only
    const actionCode = action === "validate" ? "PARTNER_FACT_VALIDATED" : "PARTNER_FACT_REJECTED";
    const dedupeKey = `partner_fact_${action}:${fact_id}`;
    const { error: timelineErr } = await serviceClient.from("case_timeline_events").insert({
      case_id: fact.case_id,
      event_type: "manual_action",
      actor_type: "operator",
      actor_user_id: userId,
      new_value: `${action === "validate" ? "Validé" : "Rejeté"}: ${fact.fact_key}`,
      event_data: {
        dedupe_key: dedupeKey,
        action_code: actionCode,
        status: "done",
        action,
        fact_id,
        fact_key: fact.fact_key,
        request_id: fact.request_id,
        new_request_status: newRequestStatus,
        injected_fact_id: injectedFactId,
      },
    });

    if (timelineErr) {
      console.warn("[validate-partner-fact] Timeline insert failed (non-critical):", timelineErr.message);
    }

    return jsonResponse({
      ok: true,
      action,
      fact_id,
      new_request_status: newRequestStatus,
    });
  } catch (err) {
    console.error("[validate-partner-fact] Unexpected error:", (err as Error).message);
    return errorResponse("Internal server error", 500);
  }
});
