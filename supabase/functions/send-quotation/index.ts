/**
 * Phase 18C P0 Hardening: send-quotation (manual marking)
 *
 * Marks a quotation draft as manually sent after human validation.
 * This function does NOT dispatch any email.
 * It requires a selected version, a linked draft, and an exported PDF trace.
 *
 * CTO corrections applied:
 * - P1: Draft update via userClient (RLS ownership guarantee)
 * - P2: Explicit ownership guard on quote_cases
 * - P3: FSM guard accepts QUOTED_VERSIONED + SENT (idempotence)
 * - P0: Strict version match (rejects null quotation_version_id)
 * - P0: Mandatory PDF validation via serviceClient
 * - P0: Content validations (to_addresses, subject, body)
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

const FUNCTION_NAME = "send-quotation";

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
  const httpMap: Record<string, number> = {
    AUTH_INVALID_JWT: 401,
    FORBIDDEN_OWNER: 403,
    VALIDATION_FAILED: 400,
    CONFLICT_INVALID_STATE: 409,
  };
  await logRuntimeEvent(serviceClient, {
    correlationId,
    functionName: FUNCTION_NAME,
    userId,
    status: getStatusFromErrorCode(code),
    errorCode: code,
    httpStatus: httpMap[code] ?? 500,
    durationMs,
    meta,
  });
  return respondError({ code, message, correlationId, meta });
}

// ── UUID format check ────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  // 1. CORS
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const t0 = Date.now();
  const correlationId = getCorrelationId(req);

  // 2. Service client (logging + FSM transition + PDF check)
  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let userId: string | undefined;

  try {
    // 3. Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return await fail(serviceClient, "AUTH_INVALID_JWT", "Unauthorized", correlationId, t0);
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await userClient.auth.getUser(token);
    if (authError || !user) {
      return await fail(serviceClient, "AUTH_INVALID_JWT", "Invalid or expired token", correlationId, t0);
    }
    userId = user.id;

    // 4. Parse body — validate UUIDs
    const body = await req.json();
    const { case_id, version_id, draft_id } = body;

    if (!case_id || !UUID_RE.test(case_id)) {
      return await fail(serviceClient, "VALIDATION_FAILED", "case_id is required (UUID)", correlationId, t0, userId);
    }
    if (!version_id || !UUID_RE.test(version_id)) {
      return await fail(serviceClient, "VALIDATION_FAILED", "version_id is required (UUID)", correlationId, t0, userId);
    }
    if (!draft_id || !UUID_RE.test(draft_id)) {
      return await fail(serviceClient, "VALIDATION_FAILED", "draft_id is required (UUID)", correlationId, t0, userId);
    }

    // 5. Load case via userClient (RLS)
    const { data: caseData, error: caseError } = await userClient
      .from("quote_cases")
      .select("id, status, created_by, assigned_to")
      .eq("id", case_id)
      .single();

    if (caseError || !caseData) {
      return await fail(serviceClient, "VALIDATION_FAILED", "Quote case not found", correlationId, t0, userId, { case_id });
    }

    // 7. P3 — FSM guard (idempotent: accept SENT too)
    const allowedStatuses = ["QUOTED_VERSIONED", "SENT"];
    if (!allowedStatuses.includes(caseData.status)) {
      return await fail(
        serviceClient,
        "CONFLICT_INVALID_STATE",
        `Invalid case status. Expected: ${allowedStatuses.join(" or ")}, Got: ${caseData.status}`,
        correlationId, t0, userId, { case_id, current_status: caseData.status },
      );
    }

    // 8. Load version via serviceClient
    const { data: versionData, error: versionError } = await serviceClient
      .from("quotation_versions")
      .select("id, case_id, is_selected")
      .eq("id", version_id)
      .single();

    if (versionError || !versionData) {
      return await fail(serviceClient, "VALIDATION_FAILED", "Quotation version not found", correlationId, t0, userId, { version_id });
    }
    if (versionData.case_id !== case_id) {
      return await fail(serviceClient, "VALIDATION_FAILED", "Version does not belong to this case", correlationId, t0, userId, { version_id, case_id });
    }
    if (!versionData.is_selected) {
      return await fail(serviceClient, "VALIDATION_FAILED", "Version is not the selected one", correlationId, t0, userId, { version_id });
    }

    // 9. Load draft via userClient (RLS ownership)
    const { data: draftData, error: draftError } = await userClient
      .from("email_drafts")
      .select("id, sent_at, status, quotation_version_id, to_addresses, subject, body_text, body_html")
      .eq("id", draft_id)
      .single();

    if (draftError || !draftData) {
      return await fail(serviceClient, "VALIDATION_FAILED", "Email draft not found", correlationId, t0, userId, { draft_id });
    }

    // 9b. P0 — Strict version match (rejects null and mismatched)
    if (draftData.quotation_version_id !== version_id) {
      return await fail(
        serviceClient,
        "VALIDATION_FAILED",
        "Draft does not match the target version",
        correlationId, t0, userId,
        { draft_id, expected_version: version_id, actual_version: draftData.quotation_version_id },
      );
    }

    // 9c. Reject unexpected draft status
    const allowedDraftStatuses = ["draft", "sent"];
    if (draftData.status && !allowedDraftStatuses.includes(draftData.status)) {
      return await fail(
        serviceClient,
        "VALIDATION_FAILED",
        `Invalid draft status: ${draftData.status}. Expected: draft or sent`,
        correlationId, t0, userId,
        { draft_id, draft_status: draftData.status },
      );
    }

    // 9d. Idempotence — BEFORE content/PDF validations
    // Historical drafts already marked sent must return idempotent
    // without being re-qualified by newer validation rules.
    if (draftData.sent_at !== null) {
      const durationMs = Date.now() - t0;
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: FUNCTION_NAME,
        op: "idempotent_hit",
        userId,
        status: "ok",
        httpStatus: 200,
        durationMs,
        meta: { draft_id, case_id, version_id },
      });
      return respondOk(
        { idempotent: true, draft_id, case_id, version_id, sent_at: draftData.sent_at },
        correlationId,
      );
    }

    // 9e. P0 — Content validations
    const toAddresses = draftData.to_addresses as string[] | null;
    if (!toAddresses || toAddresses.length === 0 || !toAddresses[0]?.trim()) {
      return await fail(
        serviceClient,
        "VALIDATION_FAILED",
        "At least one recipient is required",
        correlationId, t0, userId, { draft_id },
      );
    }

    const subject = draftData.subject as string | null;
    if (!subject?.trim()) {
      return await fail(
        serviceClient,
        "VALIDATION_FAILED",
        "Subject is required",
        correlationId, t0, userId, { draft_id },
      );
    }

    const bodyText = draftData.body_text as string | null;
    const bodyHtml = draftData.body_html as string | null;
    if (!bodyText?.trim() && !bodyHtml?.trim()) {
      return await fail(
        serviceClient,
        "VALIDATION_FAILED",
        "Email body is required (text or HTML)",
        correlationId, t0, userId, { draft_id },
      );
    }

    // 9e. P0 — Mandatory PDF validation via serviceClient (bypasses RLS)
    const { data: pdfDoc } = await serviceClient
      .from("quotation_documents")
      .select("id, file_path")
      .eq("quotation_version_id", version_id)
      .eq("document_type", "pdf")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!pdfDoc) {
      return await fail(
        serviceClient,
        "VALIDATION_FAILED",
        "A generated PDF is required before marking quotation as sent",
        correlationId, t0, userId, { version_id },
      );
    }

    // 10. Update draft (idempotence already handled above in 9d)
    const sentAt = new Date().toISOString();
    const { data: updatedDraft, error: updateError } = await userClient
      .from("email_drafts")
      .update({
        status: "sent",
        sent_at: sentAt,
        quotation_version_id: version_id,
      })
      .eq("id", draft_id)
      .select("id")
      .single();

    if (updateError || !updatedDraft) {
      return await fail(serviceClient, "UPSTREAM_DB_ERROR", "Failed to update email draft", correlationId, t0, userId, { draft_id });
    }

    // 12. FSM transition (only if not already SENT)
    if (caseData.status === "QUOTED_VERSIONED") {
      await serviceClient
        .from("quote_cases")
        .update({ status: "SENT", updated_at: sentAt })
        .eq("id", case_id);
    }

    // 13. Timeline event (best-effort) with manual_confirmed tracing
    try {
      await serviceClient.from("case_timeline_events").insert({
        case_id,
        event_type: "sent",
        new_value: "SENT",
        actor_type: "user",
        actor_user_id: user.id,
        event_data: {
          draft_id,
          version_id,
          sent_at: sentAt,
          delivery_mode: "manual_confirmed",
          transport: "external_to_app",
          pdf_document_id: pdfDoc.id,
        },
      });
    } catch (_) {
      // best-effort: do not fail the request
    }

    // 14. Success
    const durationMs = Date.now() - t0;
    await logRuntimeEvent(serviceClient, {
      correlationId,
      functionName: FUNCTION_NAME,
      op: "send_quotation",
      userId,
      status: "ok",
      httpStatus: 200,
      durationMs,
      meta: { case_id, version_id, draft_id },
    });

    return respondOk(
      {
        case_id,
        version_id,
        draft_id,
        sent_at: sentAt,
        status_after: "SENT",
        delivery_mode: "manual_confirmed",
        email_dispatched: false,
        pdf_document_id: pdfDoc.id,
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
