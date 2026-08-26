/**
 * Phase 12 + Phase 17B: generate-quotation-version
 * Creates an immutable quotation version from a successful pricing run.
 *
 * Phase 17B compliance:
 * - Runtime contract (Phase 14-15): respondOk/respondError, logRuntimeEvent, correlationId
 * - FSM: PRICED_DRAFT|HUMAN_REVIEW → QUOTED_VERSIONED
 * - Idempotence: (case_id, pricing_run_id) → no-op if version exists
 * - Atomicity: Option 6A rollback (previousSelectedId)
 * - verify_jwt = false + requireUser (pattern projet S1)
 *
 * Ajustement CTO:
 * - A: idempotent hit returns real DB status (not hardcoded)
 * - B: Auth via requireUser helper — observability preserved via post-check logRuntimeEvent
 * - C: respondOk/respondError include CORS headers via runtime.ts
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
} from "../_shared/runtime.ts";

const FUNCTION_NAME = "generate-quotation-version";

// Lot 3D-1 — QQM source de vérité snapshot (helper pur testable)
import { resolveSnapshotQualification } from "./qqm-resolver.ts";

// P0-E — normalisation déterministe pricing_run → snapshot (helper pur testable)
import {
  normalizeLinePricing,
  resolveSnapshotClient,
  resolveSnapshotInputs,
} from "./snapshot-normalizer.ts";

// Snapshot structure for immutable storage
interface VersionSnapshotLot {
  lot_index: number;
  label: string;
  lines: Array<{
    service_code: string;
    description: string | null;
    quantity: number;
    unit_price: number;
    amount: number;
    currency: string;
    source?: unknown;
    canonical?: unknown;
    accounting?: unknown;
  }>;
  totals: {
    ht: number;
    ttc: number;
    currency: string;
    subtotal_before_sodatra_vat?: number;
    total_payable?: number;
    honoraires_tva?: number;
    local_transport_debours_ttc?: number;
    local_transport_commission?: number;
  };
  duty_breakdown?: any;
}

interface VersionSnapshot {
  meta: {
    version_id: string;
    version_number: number;
    created_at: string;
    pricing_run_id: string;
    pricing_run_number: number;
    quoteQualification: {
      level: "firm" | "provisional" | "partial";
      reasons: Array<{
        code: string;
        message: string;
        field?: string;
      }>;
      firmTotalPolicy: "all_included" | "excludes_reserved_items";
    };
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
    // Lot 4-A-ter: preserve TO_CONFIRM metadata for PDF rendering
    source?: unknown;
    type?: string | null;
    category?: string | null;
    label?: string | null;
    canonical?: unknown;
    accounting?: unknown;
  }>;
  totals: {
    total_ht: number;
    total_ttc: number;
    currency: string;
    subtotal_before_sodatra_vat?: number;
    total_payable?: number;
    honoraires_ht?: number;
    honoraires_tva?: number;
    honoraires_ttc?: number;
    debours_douaniers?: number;
    local_transport_debours_ttc?: number;
    local_transport_commission?: number;
    debours_total?: number;
  };
  sources: any[];
  is_multi_lot?: boolean;
  lots?: VersionSnapshotLot[];
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
    // ── Auth — requireUser (pattern projet S1) ───────────
    // Observability: map helper rejection to logRuntimeEvent for traceability
    const auth = await requireUser(req);
    if (auth instanceof Response) {
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: FUNCTION_NAME,
        status: "fatal_error",
        errorCode: "AUTH_INVALID_JWT",
        httpStatus: 401,
        durationMs: Date.now() - t0,
      });
      return auth;
    }
    userId = auth.user.id;

    // ── Parse body ───────────────────────────────────────
    const { case_id, pricing_run_id } = await req.json();
    if (!case_id) {
      return await fail(serviceClient, "VALIDATION_FAILED", "case_id is required", correlationId, t0, userId);
    }

    // ── Load case + ownership ────────────────────────────
    const { data: caseData, error: caseError } = await serviceClient
      .from("quote_cases")
      .select("id, status, created_by, assigned_to, thread_id")
      .eq("id", case_id)
      .single();

    if (caseError || !caseData) {
      return await fail(serviceClient, "VALIDATION_FAILED", "Quote case not found", correlationId, t0, userId, { case_id });
    }

    // S1: Access — shared authenticated operator workspace. Actor identity preserved for audit.

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
    const outputsJson = pricingRun.outputs_json as Record<string, any> | null;
    const outputTotals = outputsJson?.totals as Record<string, any> | undefined;

    const versionId = crypto.randomUUID();
    const now = new Date().toISOString();

    const snapshot: VersionSnapshot = {
      meta: {
        version_id: versionId,
        version_number: versionNumber,
        created_at: now,
        pricing_run_id: pricingRun.id,
        pricing_run_number: pricingRun.run_number,
        // Lot 3D-1: QQM source de vérité snapshot.
        // Empêche `firm` si tariff_lines contient TO_CONFIRM.
        // Préserve partial/provisional venant de run-pricing (DDP MISSING_CARGO_VALUE Lot 4).
        quoteQualification: resolveSnapshotQualification(
          pricingRun.outputs_json?.quoteQualification,
          tariffLines,
        ),
      },
      // P0-E: facts_snapshot est un TABLEAU {key, value_*} et inputs_json est
      // camelCase (originPort, cargoWeight, clientEmail, ...) — résolution
      // déterministe outputs_json > inputs camelCase > facts tableau > legacy
      // snake_case via helper pur (zéros valides préservés, pas de ||).
      inputs: resolveSnapshotInputs(inputs, factsSnapshot, outputsJson),
      client: resolveSnapshotClient(inputs, factsSnapshot, outputsJson),
      raw_lines: tariffLines,
      lines: tariffLines.map((line: any, idx: number) => {
        const serviceCode = line.service_code || line.charge_code || `LINE_${idx + 1}`;
        return {
          service_code: serviceCode,
          description: line.description || line.charge_name || line.label || line.category || serviceCode,
          // P0-E: unitPrice (camelCase) > unit_price > rate ; fallback
          // amount/quantity seulement sans prix explicite et quantity > 0.
          ...normalizeLinePricing(line),
          currency: line.currency || "XOF",
          // Lot 4-A-ter: preserve metadata so PDF drawLine() can detect TO_CONFIRM/reserve lines
          source: line.source ?? null,
          type: line.type ?? null,
          category: line.category ?? null,
          label: line.label ?? null,
          canonical: line.canonical ?? null,
          accounting: line.accounting ?? null,
        };
      }),
      totals: {
        total_ht: pricingRun.total_ht || 0,
        total_ttc: pricingRun.total_ttc || pricingRun.total_ht || 0,
        currency: pricingRun.currency || "XOF",
        ...(typeof outputTotals?.subtotal_before_sodatra_vat === "number"
          ? { subtotal_before_sodatra_vat: outputTotals.subtotal_before_sodatra_vat }
          : {}),
        ...(typeof outputTotals?.total_payable === "number"
          ? { total_payable: outputTotals.total_payable }
          : {}),
        ...(typeof outputTotals?.honoraires_ht === "number"
          ? { honoraires_ht: outputTotals.honoraires_ht }
          : {}),
        ...(typeof outputTotals?.honoraires_tva === "number"
          ? { honoraires_tva: outputTotals.honoraires_tva }
          : {}),
        ...(typeof outputTotals?.honoraires_ttc === "number"
          ? { honoraires_ttc: outputTotals.honoraires_ttc }
          : {}),
        ...(typeof outputTotals?.debours_douaniers === "number"
          ? { debours_douaniers: outputTotals.debours_douaniers }
          : {}),
        ...(typeof outputTotals?.local_transport_debours_ttc === "number"
          ? { local_transport_debours_ttc: outputTotals.local_transport_debours_ttc }
          : {}),
        ...(typeof outputTotals?.local_transport_commission === "number"
          ? { local_transport_commission: outputTotals.local_transport_commission }
          : {}),
        ...(typeof outputTotals?.debours_total === "number"
          ? { debours_total: outputTotals.debours_total }
          : {}),
      },
      sources: tariffSources,
    };

    // ── Multi-lot enrichment from outputs_json ───────────
    if (outputsJson?.multi_lot === true && Array.isArray(outputsJson.lots) && outputsJson.lots.length > 0) {
      snapshot.is_multi_lot = true;
      snapshot.lots = outputsJson.lots.map((lot: any) => ({
        lot_index: lot.lot_index ?? 0,
        label: lot.label ?? `Lot ${lot.lot_index ?? '?'}`,
        lines: Array.isArray(lot.lines) ? lot.lines.map((l: any) => ({
          service_code: l.service_code || l.charge_code || 'LINE',
          description: l.description || l.charge_name || null,
          // P0-E: même normalisation prix que les lignes mono-lot
          ...normalizeLinePricing(l),
          currency: l.currency || 'XOF',
          source: l.source ?? null,
          canonical: l.canonical ?? null,
          accounting: l.accounting ?? null,
        })) : [],
        totals: {
          ht: lot.totals?.ht ?? lot.totals?.total_ht ?? 0,
          ttc: lot.totals?.ttc ?? lot.totals?.total_ttc ?? 0,
          currency: lot.totals?.currency ?? 'XOF',
          ...(typeof lot.totals?.subtotal_before_sodatra_vat === 'number'
            ? { subtotal_before_sodatra_vat: lot.totals.subtotal_before_sodatra_vat }
            : {}),
          ...(typeof lot.totals?.total_payable === 'number'
            ? { total_payable: lot.totals.total_payable }
            : {}),
          ...(typeof lot.totals?.honoraires_tva === 'number'
            ? { honoraires_tva: lot.totals.honoraires_tva }
            : {}),
          ...(typeof lot.totals?.local_transport_debours_ttc === 'number'
            ? { local_transport_debours_ttc: lot.totals.local_transport_debours_ttc }
            : {}),
          ...(typeof lot.totals?.local_transport_commission === 'number'
            ? { local_transport_commission: lot.totals.local_transport_commission }
            : {}),
        },
        duty_breakdown: lot.duty_breakdown ?? null,
      }));
    }

    // ── Atomic insert (RPC deselects + inserts) ──────────
    const { error: insertError } = await serviceClient
      .rpc("insert_quotation_version_atomic", {
        p_id: versionId,
        p_case_id: case_id,
        p_pricing_run_id: pricingRun.id,
        p_version_number: versionNumber,
        p_snapshot: snapshot,
        p_created_by: userId,
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
      actor_user_id: userId,
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
