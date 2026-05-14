/**
 * MAP-6-EXEC-EF — Propagate accepted classification candidate to quote_facts
 *
 * Thin HTTP wrapper around the SECURITY DEFINER RPC
 * `public.propagate_classification_candidate_to_fact(p_candidate_id, p_idempotency_key)`.
 *
 * Auth model (MAP-4 / MAP-5B):
 *  - SUPABASE_ANON_KEY + caller Authorization header
 *  - supabase.auth.getUser(token) for identity
 *  - RPC executed via user-scoped client => auth.uid() inside the wrapper = real operator
 *
 * Hard rules (CTO):
 *  - No service_role anywhere
 *  - No direct call to public.supersede_fact (revoked GRANT)
 *  - No runtime_events writes; observability is console.log/error only
 *  - No seed, no UI, no src/ touched
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

// ── Validation ────────────────────────────────────────────────────────────────
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._:-]+$/;

function jsonError(
  status: number,
  code: string,
  message: string,
  correlationId: string,
  details?: unknown,
): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: { code, message, details: details ?? null },
      correlation_id: correlationId,
    }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

// Map RPC JSONB code → HTTP status + error code
const RPC_CODE_MAP: Record<string, { status: number; code: string }> = {
  invalid_input: { status: 400, code: "VALIDATION_FAILED" },
  candidate_not_found: { status: 404, code: "CANDIDATE_NOT_FOUND" },
  rls_write_denied: { status: 403, code: "FORBIDDEN_OWNER" },
  candidate_not_accepted: { status: 409, code: "CANDIDATE_NOT_ACCEPTED" },
  candidate_not_current: { status: 409, code: "CANDIDATE_NOT_CURRENT" },
  idempotency_conflict: { status: 409, code: "IDEMPOTENCY_CONFLICT" },
  pad_label_forbidden: { status: 422, code: "PAD_LABEL_FORBIDDEN" },
  candidate_kind_not_whitelisted: {
    status: 422,
    code: "KIND_NOT_WHITELISTED",
  },
};

Deno.serve(async (req) => {
  // 1. CORS preflight
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const correlationId =
    req.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const startMs = Date.now();
  const fn = "propagate-classification-candidate-to-facts";

  if (req.method !== "POST") {
    console.warn(
      JSON.stringify({
        fn,
        correlation_id: correlationId,
        status: "method_not_allowed",
        method: req.method,
      }),
    );
    return jsonError(
      405,
      "METHOD_NOT_ALLOWED",
      "Only POST is supported",
      correlationId,
    );
  }

  // 2. Auth (401 if missing / invalid)
  const auth = await requireUser(req);
  if (auth instanceof Response) {
    console.warn(
      JSON.stringify({
        fn,
        correlation_id: correlationId,
        status: "unauthenticated",
        http_status: auth.status,
        duration_ms: Date.now() - startMs,
      }),
    );
    return auth;
  }
  const userId = auth.user.id;

  // 3. Parse + validate body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    console.warn(
      JSON.stringify({
        fn,
        correlation_id: correlationId,
        user_id: userId,
        status: "validation_failed",
        reason: "invalid_json",
        duration_ms: Date.now() - startMs,
      }),
    );
    return jsonError(
      400,
      "VALIDATION_FAILED",
      "Body is not valid JSON",
      correlationId,
    );
  }

  const candidateId = body?.candidate_id;
  const idempotencyKey = body?.idempotency_key;

  if (typeof candidateId !== "string" || !UUID_RE.test(candidateId)) {
    console.warn(
      JSON.stringify({
        fn,
        correlation_id: correlationId,
        user_id: userId,
        status: "validation_failed",
        reason: "candidate_id_invalid_uuid",
        duration_ms: Date.now() - startMs,
      }),
    );
    return jsonError(
      400,
      "VALIDATION_FAILED",
      "candidate_id must be a valid UUID",
      correlationId,
      { field: "candidate_id" },
    );
  }

  if (
    typeof idempotencyKey !== "string" ||
    idempotencyKey.length < 8 ||
    idempotencyKey.length > 128 ||
    !IDEMPOTENCY_RE.test(idempotencyKey)
  ) {
    console.warn(
      JSON.stringify({
        fn,
        correlation_id: correlationId,
        user_id: userId,
        status: "validation_failed",
        reason: "idempotency_key_invalid",
        duration_ms: Date.now() - startMs,
      }),
    );
    return jsonError(
      400,
      "VALIDATION_FAILED",
      "idempotency_key must be 8..128 chars matching [A-Za-z0-9._:-]+",
      correlationId,
      { field: "idempotency_key" },
    );
  }

  // 4. Build user-scoped client (anon key + caller Authorization)
  //    => RPC sees auth.uid() = real operator. No service_role.
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${auth.token}` } },
    },
  );

  // 5. Call wrapper RPC (never supersede_fact directly)
  const { data: rpcData, error: rpcError } = await userClient.rpc(
    "propagate_classification_candidate_to_fact",
    {
      p_candidate_id: candidateId,
      p_idempotency_key: idempotencyKey,
    },
  );

  if (rpcError) {
    console.error(
      JSON.stringify({
        fn,
        correlation_id: correlationId,
        user_id: userId,
        candidate_id: candidateId,
        status: "rpc_exception",
        pg_message: rpcError.message,
        pg_code: (rpcError as unknown as { code?: string }).code ?? null,
        duration_ms: Date.now() - startMs,
      }),
    );
    return jsonError(
      500,
      "INTERNAL_ERROR",
      "RPC execution failed",
      correlationId,
    );
  }

  // RPC returns JSONB { ok: bool, code?, ...payload }
  const payload = (rpcData ?? {}) as Record<string, unknown>;

  if (payload.ok === true) {
    console.log(
      JSON.stringify({
        fn,
        correlation_id: correlationId,
        user_id: userId,
        candidate_id: candidateId,
        status: "ok",
        idempotent: payload.idempotent === true,
        replay_source: payload.replay_source ?? null,
        fact_key: payload.fact_key ?? null,
        duration_ms: Date.now() - startMs,
      }),
    );
    return new Response(
      JSON.stringify({ ...payload, correlation_id: correlationId }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // ok:false → map code
  const rpcCode = typeof payload.code === "string" ? payload.code : "unknown";
  const mapped = RPC_CODE_MAP[rpcCode] ?? {
    status: 500,
    code: "INTERNAL_ERROR",
  };

  console.warn(
    JSON.stringify({
      fn,
      correlation_id: correlationId,
      user_id: userId,
      candidate_id: candidateId,
      status: "rpc_business_error",
      rpc_code: rpcCode,
      http_status: mapped.status,
      duration_ms: Date.now() - startMs,
    }),
  );

  return jsonError(
    mapped.status,
    mapped.code,
    `Wrapper rejected: ${rpcCode}`,
    correlationId,
    payload.details ?? null,
  );
});
