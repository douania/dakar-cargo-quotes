/**
 * Phase 12 + Phase 17B: generate-quotation-version
 * Creates an immutable quotation version from a successful pricing run.
 *
 * Phase 17B compliance:
 * - Runtime contract (Phase 14-15): respondOk/respondError, logRuntimeEvent, correlationId
 * - FSM: PRICED_DRAFT|HUMAN_REVIEW → QUOTED_VERSIONED
 * - Idempotence: (case_id, pricing_run_id) → no-op if version exists
 * - Atomicity: Option 6A rollback (previousSelectedId)
 * - verify_jwt = true (gateway-level 401 for missing JWT)
 *
 * Ajustement CTO:
 * - A: idempotent hit returns real DB status (not hardcoded)
 * - B: AUTH_MISSING_JWT unreachable (gateway), AUTH_INVALID_JWT kept for expired/invalid tokens
 * - C: respondOk/respondError include CORS headers via runtime.ts
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors } from "../_shared/cors.ts";
import {
  getCorrelationId,
  respondOk,
  respondError,
  logRuntimeEvent,
  getStatusFromErrorCode,
  type ErrorCode,
} from "../_shared/runtime.ts";

const FUNCTION_NAME = "generate-quotation-version";

// Snapshot structure for immutable storage
interface VersionSnapshot {
  meta: {
    version_id: string;
    version_number: number;
    created_at: string;
    pricing_run_id: string;
    pricing_run_number: number;
  };
  inputs: {
    origin: string | null;
    destination: string | null;
    incoterm: string | null;
    containers: any[];
    cargo_weight: number | null;
    cargo_volume: number | null;
  };
  client: {
    email: string | null;
    company: string | null;
  };
  raw_lines: any[];
  lines: Array<{
    service_code: string;
    description: string | null;
    quantity: number;
    unit_price: number;
    amount: number;
    currency: string;
  }>;
  totals: {
    total_ht: number;
    total_ttc: number;
    currency: string;
  };
  sources: any[];
}

// Helper: log + return error
async function fail(
  serviceClient: any,
  code: ErrorCode,
  message: string,
  correlationId: string,
  t0: number,
  userId?: string,
  meta?: Record<string, unknown>,
): Promise<Response> {
  const durationMs = Date.now() - t0;
  await logRuntimeEvent(serviceClient, {
    correlationId,
    functionName: FUNCTION_NAME,
    userId,
    status: getStatusFromErrorCode(code),
    errorCode: code,
    httpStatus: code === "AUTH_INVALID_JWT" ? 401 : code === "FORBIDDEN_OWNER" ? 403 : code === "VALIDATION_FAILED" ? 400 : code === "CONFLICT_INVALID_STATE" ? 409 : 500,
    durationMs,
    meta,
  });
  return respondError({ code, message, correlationId, meta });
}

Deno.serve(async (req) => {
  // CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const t0 = Date.now();
  const correlationId = getCorrelationId(req);

  // Service client (created early for logging even on auth failure)
  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let userId: string | undefined;

  try {
    // ── Auth ──────────────────────────────────────────────
    // With verify_jwt=true, missing JWT is rejected at gateway level.
    // This code handles invalid/expired tokens only (Ajustement B).
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      // Unreachable with verify_jwt=true, but kept as defensive guard
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

    // ── Parse body ───────────────────────────────────────
    const { case_id, pricing_run_id } = await req.json();
    if (!case_id) {
      return await fail(serviceClient, "VALIDATION_FAILED", "case_id is required", correlationId, t0, userId);
    }

    // ── Load case + ownership ────────────────────────────
    const { data: caseData, error: caseError } = await userClient
      .from("quote_cases")
      .select("id, status, created_by, assigned_to, thread_id")
      .eq("id", case_id)
      .single();

    if (caseError || !caseData) {
      return await fail(serviceClient, "VALIDATION_FAILED", "Quote case not found", correlationId, t0, userId, { case_id });
    }

    if (caseData.created_by !== user.id && caseData.assigned_to !== user.id) {
      return await fail(serviceClient, "FORBIDDEN_OWNER", "Access denied", correlationId, t0, userId, { case_id });
    }

    // ── FSM guard (accepts QUOTED_VERSIONED for idempotence) ─
    const creationStatuses = ["PRICED_DRAFT", "HUMAN_REVIEW"];
    const idempotentStatuses = ["QUOTED_VERSIONED"];
    const allAllowed = [...creationStatuses, ...idempotentStatuses];
    if (!allAllowed.includes(caseData.status)) {
      return await fail(
        serviceClient,
        "CONFLICT_INVALID_STATE",
        `Invalid case status. Expected: ${allAllowed.join(" or ")}, Got: ${caseData.status}`,
        correlationId, t0, userId, { case_id, current_status: caseData.status },
      );
    }

    // ── Load pricing run ─────────────────────────────────
    let pricingRunQuery = serviceClient
      .from("pricing_runs")
      .select("*")
      .eq("case_id", case_id)
      .eq("status", "success")
      .order("run_number", { ascending: false });

    if (pricing_run_id) {
      pricingRunQuery = serviceClient
        .from("pricing_runs")
        .select("*")
        .eq("id", pricing_run_id)
        .eq("case_id", case_id)
        .eq("status", "success");
    }

    const { data: pricingRun, error: runError } = await pricingRunQuery.limit(1).single();
    if (runError || !pricingRun) {
      return await fail(serviceClient, "VALIDATION_FAILED", "No successful pricing run found", correlationId, t0, userId, { case_id, pricing_run_id });
    }

    if (pricingRun.case_id !== case_id) {
      return await fail(serviceClient, "FORBIDDEN_OWNER", "Pricing run does not belong to this case", correlationId, t0, userId, { case_id, pricing_run_id: pricingRun.id });
    }

    // ── Idempotence guard (Ajustement CTO #3 corrigé) ───
    // Lookup ANY version for (case_id, pricing_run_id), selected or not
    const { data: existingVersion } = await serviceClient
      .from("quotation_versions")
      .select("id, version_number, snapshot, is_selected")
      .eq("case_id", case_id)
      .eq("pricing_run_id", pricingRun.id)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingVersion) {
      const snap = existingVersion.snapshot as VersionSnapshot | null;

      // Ajustement A: read real DB status, don't hardcode
      const { data: caseNow } = await serviceClient
        .from("quote_cases")
        .select("status")
        .eq("id", case_id)
        .maybeSingle();
      const statusAfter = (caseNow?.status as string) ?? caseData.status;

      const durationMs = Date.now() - t0;
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: FUNCTION_NAME,
        op: "idempotent_hit",
        userId,
        status: "ok",
        httpStatus: 200,
        durationMs,
        meta: { version_id: existingVersion.id, version_number: existingVersion.version_number },
      });

      return respondOk(
        {
          case_id,
          pricing_run_id: pricingRun.id,
          version_id: existingVersion.id,
          version_number: existingVersion.version_number,
          lines_count: snap?.lines?.length ?? 0,
          total_ht: snap?.totals?.total_ht ?? 0,
          total_ttc: snap?.totals?.total_ttc ?? 0,
          currency: snap?.totals?.currency ?? "XOF",
          status_after: statusAfter,
          idempotent: true,
        },
        correlationId,
      );
    }

    // ── Option 6A: capture previous selected for rollback ─
    const { data: prevSelected } = await serviceClient
      .from("quotation_versions")
      .select("id")
      .eq("case_id", case_id)
      .eq("is_selected", true)
      .limit(1)
      .maybeSingle();
    const previousSelectedId: string | null = prevSelected?.id ?? null;

    // ── Atomic version number ────────────────────────────
    const { data: versionNumber, error: rpcError } = await serviceClient
      .rpc("get_next_quotation_version_number", { p_case_id: case_id });

    if (rpcError || versionNumber === null) {
      return await fail(serviceClient, "UPSTREAM_DB_ERROR", "Failed to get version number", correlationId, t0, userId, { rpc_error: rpcError?.message });
    }

    // ── Build snapshot ───────────────────────────────────
    const inputs = pricingRun.inputs_json || {};
    const factsSnapshot = pricingRun.facts_snapshot || {};
    const tariffLines = pricingRun.tariff_lines || [];
    const tariffSources = pricingRun.tariff_sources || [];

    const versionId = crypto.randomUUID();
    const now = new Date().toISOString();

    const snapshot: VersionSnapshot = {
      meta: {
        version_id: versionId,
        version_number: versionNumber,
        created_at: now,
        pricing_run_id: pricingRun.id,
        pricing_run_number: pricingRun.run_number,
      },
      inputs: {
        origin: inputs.origin || factsSnapshot.origin || null,
        destination: inputs.destination || factsSnapshot.destination || null,
        incoterm: inputs.incoterm || factsSnapshot.incoterm || null,
        containers: inputs.containers || factsSnapshot.containers || [],
        cargo_weight: inputs.cargo_weight || factsSnapshot.cargo_weight || null,
        cargo_volume: inputs.cargo_volume || factsSnapshot.cargo_volume || null,
      },
      client: {
        email: factsSnapshot.client_email || inputs.client_email || null,
        company: factsSnapshot.client_company || inputs.client_company || null,
      },
      raw_lines: tariffLines,
      lines: tariffLines.map((line: any, idx: number) => ({
        service_code: line.service_code || line.charge_code || `LINE_${idx + 1}`,
        description: line.description || line.charge_name || null,
        quantity: line.quantity || 1,
        unit_price: line.unit_price || line.rate || 0,
        amount: line.amount || line.total || 0,
        currency: line.currency || "XOF",
      })),
      totals: {
        total_ht: pricingRun.total_ht || 0,
        total_ttc: pricingRun.total_ttc || pricingRun.total_ht || 0,
        currency: pricingRun.currency || "XOF",
      },
      sources: tariffSources,
    };

    // ── Atomic insert (RPC deselects + inserts) ──────────
    const { error: insertError } = await serviceClient
      .rpc("insert_quotation_version_atomic", {
        p_id: versionId,
        p_case_id: case_id,
        p_pricing_run_id: pricingRun.id,
        p_version_number: versionNumber,
        p_snapshot: snapshot,
        p_created_by: user.id,
      });

    if (insertError) {
      return await fail(serviceClient, "UPSTREAM_DB_ERROR", `Failed to create version: ${insertError.message}`, correlationId, t0, userId, { case_id });
    }

    // ── Insert version lines ─────────────────────────────
    const versionLines = snapshot.lines.map((line, idx) => ({
      quotation_version_id: versionId,
      line_order: idx,
      service_code: line.service_code,
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unit_price,
      amount: line.amount,
      currency: line.currency,
      breakdown: tariffLines[idx]?.breakdown || null,
    }));

    if (versionLines.length > 0) {
      const { error: linesError } = await serviceClient
        .from("quotation_version_lines")
        .insert(versionLines);

      if (linesError) {
        console.error(`[${FUNCTION_NAME}] Lines insert failed, rolling back version ${versionId}`);
        // Rollback: delete orphan version
        await serviceClient.from("quotation_versions").delete().eq("id", versionId);
        // Option 6A: restore exact previous selected
        if (previousSelectedId) {
          await serviceClient
            .from("quotation_versions")
            .update({ is_selected: true })
            .eq("id", previousSelectedId);
        }
        return await fail(serviceClient, "UPSTREAM_DB_ERROR", `Failed to create version lines: ${linesError.message}`, correlationId, t0, userId, { case_id, version_id: versionId });
      }
    }

    // ── FSM: transition to QUOTED_VERSIONED ──────────────
    await serviceClient
      .from("quote_cases")
      .update({ status: "QUOTED_VERSIONED", updated_at: now })
      .eq("id", case_id);

    // ── Timeline event (best-effort) ─────────────────────
    await serviceClient.from("case_timeline_events").insert({
      case_id,
      event_type: "quotation_version_created",
      event_data: {
        version_id: versionId,
        version_number: versionNumber,
        pricing_run_id: pricingRun.id,
        pricing_run_number: pricingRun.run_number,
        total_ht: snapshot.totals.total_ht,
        lines_count: snapshot.lines.length,
        has_raw_lines: snapshot.raw_lines.length > 0,
        status_after: "QUOTED_VERSIONED",
      },
      actor_type: "user",
      actor_user_id: user.id,
    });

    // ── Success ──────────────────────────────────────────
    const durationMs = Date.now() - t0;
    await logRuntimeEvent(serviceClient, {
      correlationId,
      functionName: FUNCTION_NAME,
      op: "create_version",
      userId,
      status: "ok",
      httpStatus: 200,
      durationMs,
      meta: { version_id: versionId, version_number: versionNumber, lines_count: snapshot.lines.length },
    });

    return respondOk(
      {
        case_id,
        pricing_run_id: pricingRun.id,
        version_id: versionId,
        version_number: versionNumber,
        lines_count: snapshot.lines.length,
        total_ht: snapshot.totals.total_ht,
        total_ttc: snapshot.totals.total_ttc,
        currency: snapshot.totals.currency,
        status_after: "QUOTED_VERSIONED",
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
