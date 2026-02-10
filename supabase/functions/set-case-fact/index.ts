/**
 * Phase SET-CASE-FACT — Manual fact injection for operators
 * 
 * Wraps the existing `supersede_fact` RPC with a strict whitelist
 * of allowed fact_keys. Used for E2E testing and operator overrides.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { getCorrelationId, respondOk, respondError, logRuntimeEvent } from "../_shared/runtime.ts";

// ── Strict whitelist ──
const ALLOWED_FACT_KEYS = new Set([
  "client.code",
  "cargo.caf_value",
  "cargo.weight_kg",
  "cargo.chargeable_weight_kg",
]);

// ── Category detection from prefix ──
function detectCategory(factKey: string): string {
  const prefix = factKey.split(".")[0];
  switch (prefix) {
    case "client": return "contacts";
    case "cargo": return "cargo";
    case "routing": return "routing";
    case "timing": return "timing";
    default: return "other";
  }
}

Deno.serve(async (req) => {
  // 1. CORS preflight
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const correlationId = getCorrelationId(req);
  const startMs = Date.now();

  // 2. Auth
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const userId = auth.user.id;

  try {
    // 3. Parse & validate body
    const body = await req.json();
    const { case_id, fact_key, value_text, value_number, value_json } = body;

    if (!case_id || !fact_key) {
      const resp = respondError({
        code: "VALIDATION_FAILED",
        message: "case_id and fact_key are required",
        correlationId,
      });
      await logRuntimeEvent(getServiceClient(), {
        correlationId, functionName: "set-case-fact", op: "validate",
        userId, status: "fatal_error", errorCode: "VALIDATION_FAILED",
        httpStatus: 400, durationMs: Date.now() - startMs,
      });
      return resp;
    }

    // 4. Whitelist check
    if (!ALLOWED_FACT_KEYS.has(fact_key)) {
      const resp = respondError({
        code: "VALIDATION_FAILED",
        message: `fact_key '${fact_key}' is not allowed. Allowed: ${[...ALLOWED_FACT_KEYS].join(", ")}`,
        correlationId,
      });
      await logRuntimeEvent(getServiceClient(), {
        correlationId, functionName: "set-case-fact", op: "whitelist",
        userId, status: "fatal_error", errorCode: "VALIDATION_FAILED",
        httpStatus: 400, durationMs: Date.now() - startMs,
      });
      return resp;
    }

    // 5. Category detection
    const factCategory = detectCategory(fact_key);

    // 6. Ownership check via user-scoped client (RLS)
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const { data: caseRow, error: caseErr } = await userClient
      .from("quote_cases")
      .select("id")
      .eq("id", case_id)
      .single();

    if (caseErr || !caseRow) {
      const resp = respondError({
        code: "FORBIDDEN_OWNER",
        message: "Case not found or access denied",
        correlationId,
      });
      await logRuntimeEvent(getServiceClient(), {
        correlationId, functionName: "set-case-fact", op: "ownership",
        userId, status: "fatal_error", errorCode: "FORBIDDEN_OWNER",
        httpStatus: 403, durationMs: Date.now() - startMs,
      });
      return resp;
    }

    // 7. Call supersede_fact RPC (service role)
    const svc = getServiceClient();
    const { data: factId, error: rpcErr } = await svc.rpc("supersede_fact", {
      p_case_id: case_id,
      p_fact_key: fact_key,
      p_fact_category: factCategory,
      p_value_text: value_text ?? null,
      p_value_number: value_number ?? null,
      p_value_json: value_json ?? null,
      p_source_type: "manual_input",
      p_confidence: 1.0,
      p_source_excerpt: "[set-case-fact] Manual injection by operator",
    });

    if (rpcErr) {
      const errMsg = typeof rpcErr === "object" ? JSON.stringify(rpcErr) : String(rpcErr);
      const resp = respondError({
        code: "UPSTREAM_DB_ERROR",
        message: `supersede_fact failed: ${errMsg}`,
        correlationId,
      });
      await logRuntimeEvent(svc, {
        correlationId, functionName: "set-case-fact", op: "rpc",
        userId, status: "retryable_error", errorCode: "UPSTREAM_DB_ERROR",
        httpStatus: 500, durationMs: Date.now() - startMs,
      });
      return resp;
    }

    // 8. Log timeline event
    await svc.from("case_timeline_events").insert({
      case_id,
      event_type: "fact_injected_manual",
      actor_type: "operator",
      actor_user_id: userId,
      related_fact_id: factId,
      event_data: { fact_key, value_text, value_number, source: "set-case-fact" },
    });

    // 9. Success
    await logRuntimeEvent(svc, {
      correlationId, functionName: "set-case-fact", op: "inject",
      userId, status: "ok", httpStatus: 200,
      durationMs: Date.now() - startMs,
      meta: { fact_key, fact_id: factId },
    });

    return respondOk({ fact_id: factId }, correlationId);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : JSON.stringify(err);
    const resp = respondError({
      code: "UNKNOWN",
      message: errMsg,
      correlationId,
    });
    try {
      await logRuntimeEvent(getServiceClient(), {
        correlationId, functionName: "set-case-fact", op: "catch",
        userId, status: "fatal_error", errorCode: "UNKNOWN",
        httpStatus: 500, durationMs: Date.now() - startMs,
      });
    } catch (_) { /* best effort */ }
    return resp;
  }
});

// ── Helper: service role client ──
function getServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}
