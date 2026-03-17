// Phase EQ1 — Validate or reject a partner-proposed fact
// SECURITY: requireUser is mandatory because verify_jwt=false
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

// Mapping fact_key → fact_category for supersede_fact RPC
const FACT_KEY_CATEGORIES: Record<string, string> = {
  "cargo.": "cargo",
  "routing.": "routing",
  "customs.": "customs",
  "service.": "service",
  "client.": "client",
  "regulatory.": "regulatory",
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

    // 1. Load the proposed fact
    const { data: fact, error: factErr } = await userClient
      .from("external_quote_response_facts")
      .select("*")
      .eq("id", fact_id)
      .maybeSingle();

    if (factErr || !fact) return errorResponse("Proposed fact not found", 404);

    if (fact.validation_status !== "proposed") {
      return jsonResponse({
        ok: true,
        idempotent: true,
        message: `Fact already ${fact.validation_status}`,
      });
    }

    const userId = auth.user.id;

    if (action === "validate") {
      // 2. Call supersede_fact to inject into quote_facts
      const category = inferCategory(fact.fact_key);
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

      // 3. Update proposed fact
      await serviceClient
        .from("external_quote_response_facts")
        .update({
          validation_status: "validated",
          validated_by: userId,
          validated_at: new Date().toISOString(),
          injected_fact_id: newFactId,
        })
        .eq("id", fact_id);
    } else {
      // reject
      await serviceClient
        .from("external_quote_response_facts")
        .update({
          validation_status: "rejected",
          validated_by: userId,
          validated_at: new Date().toISOString(),
        })
        .eq("id", fact_id);
    }

    // 4. Compute request status
    const { data: allFacts } = await serviceClient
      .from("external_quote_response_facts")
      .select("validation_status")
      .eq("request_id", fact.request_id);

    const statuses = (allFacts ?? []).map((f) => f.validation_status);
    const proposedCount = statuses.filter((s) => s === "proposed").length;
    const validatedCount = statuses.filter((s) => s === "validated").length;

    let newRequestStatus: string;
    if (proposedCount === 0 && validatedCount > 0) {
      newRequestStatus = "facts_validated";
    } else if (proposedCount === 0 && validatedCount === 0) {
      newRequestStatus = "closed";
    } else {
      newRequestStatus = "partially_validated";
    }

    await serviceClient
      .from("external_quote_requests")
      .update({ status: newRequestStatus })
      .eq("id", fact.request_id);

    // 5. Timeline event (Fix 3: use manual_action + action_code, Fix 4: use newFactId)
    const actionCode = action === "validate" ? "PARTNER_FACT_VALIDATED" : "PARTNER_FACT_REJECTED";
    const dedupeKey = `partner_fact_${action}:${fact_id}`;
    await serviceClient.from("case_timeline_events").insert({
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
        injected_fact_id: action === "validate" ? newFactId : null,
      },
    });

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
