/**
 * A1 — Close Commercial Outcome
 *
 * Transitions a quote case from SENT → ACCEPTED or SENT → REJECTED.
 * Operator-driven, irréversible, idempotent.
 *
 * Guards:
 * - Auth: requireUser
 * - FSM: current status must be SENT (or already target outcome for idempotence)
 * - Cross-transition forbidden: ACCEPTED → REJECTED or vice versa
 *
 * Traceability: inserts status_changed event in case_timeline_events.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import {
  getCorrelationId,
  respondOk,
  respondError,
  logRuntimeEvent,
  getStatusFromErrorCode,
  type ErrorCode,
  type JsonObject,
} from "../_shared/runtime.ts";

const FUNCTION_NAME = "close-commercial-outcome";
const VALID_OUTCOMES = ["ACCEPTED", "REJECTED"] as const;
type Outcome = typeof VALID_OUTCOMES[number];

// ── Helper: log + return error ───────────────────────────
async function fail(
  serviceClient: any,
  code: ErrorCode,
  message: string,
  correlationId: string,
  t0: number,
  userId?: string,
  meta?: JsonObject,
): Promise<Response> {
  const durationMs = Date.now() - t0;
  await logRuntimeEvent(serviceClient, {
    correlationId,
    functionName: FUNCTION_NAME,
    userId,
    status: getStatusFromErrorCode(code),
    errorCode: code,
    httpStatus: code === "VALIDATION_FAILED" ? 400
      : code === "FORBIDDEN_OWNER" ? 403
      : code === "CONFLICT_INVALID_STATE" ? 409
      : 500,
    durationMs,
    meta,
  });
  return respondError({ code, message, correlationId, meta });
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const correlationId = getCorrelationId(req);
  const t0 = Date.now();

  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let userId: string | undefined;

  try {
    // 1. Auth
    const authResult = await requireUser(req);
    if (authResult instanceof Response) {
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: FUNCTION_NAME,
        status: "fatal_error",
        errorCode: "AUTH_INVALID_JWT",
        httpStatus: 401,
        durationMs: Date.now() - t0,
      });
      return authResult;
    }
    userId = authResult.user.id;

    // 2. Parse & validate input
    const body = await req.json();
    const { case_id, outcome, reason } = body;

    if (!case_id || typeof case_id !== "string") {
      return await fail(serviceClient, "VALIDATION_FAILED", "case_id is required", correlationId, t0, userId);
    }

    if (!outcome || !VALID_OUTCOMES.includes(outcome as Outcome)) {
      return await fail(serviceClient, "VALIDATION_FAILED", `outcome must be one of: ${VALID_OUTCOMES.join(", ")}`, correlationId, t0, userId);
    }

    const targetOutcome = outcome as Outcome;

    // 3. Fetch current case status
    const { data: caseData, error: caseError } = await serviceClient
      .from("quote_cases")
      .select("id, status")
      .eq("id", case_id)
      .maybeSingle();

    if (caseError || !caseData) {
      return await fail(serviceClient, "VALIDATION_FAILED", "Case not found", correlationId, t0, userId, { case_id });
    }

    const currentStatus = caseData.status as string;

    // 4. Idempotence: already in target outcome
    if (currentStatus === targetOutcome) {
      const durationMs = Date.now() - t0;
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: FUNCTION_NAME,
        op: "close_commercial_outcome",
        userId,
        status: "ok",
        httpStatus: 200,
        durationMs,
        meta: { case_id, idempotent: true, outcome: targetOutcome },
      });
      return respondOk({ case_id, outcome: targetOutcome, idempotent: true }, correlationId);
    }

    // 5. Cross-transition guard: ACCEPTED → REJECTED or REJECTED → ACCEPTED
    const otherOutcome = targetOutcome === "ACCEPTED" ? "REJECTED" : "ACCEPTED";
    if (currentStatus === otherOutcome) {
      return await fail(
        serviceClient,
        "CONFLICT_INVALID_STATE",
        `Cannot transition from ${currentStatus} to ${targetOutcome}. Cross-transition is forbidden.`,
        correlationId,
        t0,
        userId,
        { case_id, current_status: currentStatus, requested: targetOutcome },
      );
    }

    // 6. FSM guard: must be SENT
    if (currentStatus !== "SENT") {
      return await fail(
        serviceClient,
        "CONFLICT_INVALID_STATE",
        `Cannot transition from ${currentStatus} to ${targetOutcome}. Only SENT → ${targetOutcome} is allowed.`,
        correlationId,
        t0,
        userId,
        { case_id, current_status: currentStatus, requested: targetOutcome },
      );
    }

    // 7. Update case status (atomic: WHERE status = 'SENT')
    const now = new Date().toISOString();
    const { data: updateData, error: updateError } = await serviceClient
      .from("quote_cases")
      .update({ status: targetOutcome, updated_at: now })
      .eq("id", case_id)
      .eq("status", "SENT")
      .select("id");

    if (updateError) {
      return await fail(serviceClient, "UPSTREAM_DB_ERROR", "Failed to update case status", correlationId, t0, userId, { case_id });
    }

    if (!updateData || updateData.length === 0) {
      return await fail(
        serviceClient,
        "CONFLICT_INVALID_STATE",
        "Status changed concurrently — transition rejected",
        correlationId, t0, userId,
        { case_id, expected: "SENT", requested: targetOutcome },
      );
    }

    // 8. Timeline event (best-effort, but observed)
    try {
      const { error: timelineError } = await serviceClient.from("case_timeline_events").insert({
        case_id,
        event_type: "status_changed",
        previous_value: "SENT",
        new_value: targetOutcome,
        actor_type: "user",
        actor_user_id: userId,
        event_data: {
          ...(reason ? { reason } : {}),
          transition: `SENT→${targetOutcome}`,
          function: FUNCTION_NAME,
        },
      });
      if (timelineError) {
        console.warn(`[${FUNCTION_NAME}] Timeline insert failed (best-effort):`, timelineError.message);
      }
    } catch (e) {
      console.warn(`[${FUNCTION_NAME}] Timeline insert exception (best-effort):`, e);
    }

    // 9. Success
    const durationMs = Date.now() - t0;
    await logRuntimeEvent(serviceClient, {
      correlationId,
      functionName: FUNCTION_NAME,
      op: "close_commercial_outcome",
      userId,
      status: "ok",
      httpStatus: 200,
      durationMs,
      meta: { case_id, outcome: targetOutcome },
    });

    return respondOk(
      {
        case_id,
        outcome: targetOutcome,
        idempotent: false,
        previous_status: "SENT",
      },
      correlationId,
    );
  } catch (error) {
    const durationMs = Date.now() - t0;
    const message = error instanceof Error ? error.message : "Internal error";
    console.error(`[${FUNCTION_NAME}] Unhandled:`, error);
    await logRuntimeEvent(serviceClient, {
      correlationId,
      functionName: FUNCTION_NAME,
      userId,
      status: "fatal_error",
      errorCode: "UNKNOWN",
      httpStatus: 500,
      durationMs,
    });
    return respondError({ code: "UNKNOWN", message, correlationId });
  }
});
