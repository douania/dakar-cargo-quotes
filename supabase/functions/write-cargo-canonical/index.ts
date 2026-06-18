/**
 * MULTI-CARGO-LINES-ARCHITECTURE-1 — Phase 2-M
 * write-cargo-canonical — Edge Function d'écriture service-role dédiée.
 *
 * Écrit dans les tables canoniques cargo_lines / cargo_equipment EXCLUSIVEMENT
 * via les RPC service_role-only existantes (Phase 2-J) :
 *   - public.upsert_cargo_line
 *   - public.upsert_cargo_equipment
 *
 * Chaîne de sécurité (alignée sur set-case-fact) :
 *   1. CORS preflight (_shared/cors.ts)
 *   2. Auth JWT obligatoire (_shared/auth.ts → requireUser)
 *   3. Validation stricte du payload (validatePayload, pur & testable)
 *   4. Ownership du case vérifié via client user-scoped (ANON_KEY + Authorization
 *      header) → RLS décide ; 403 FORBIDDEN_OWNER si inaccessible
 *   5. Client service-role uniquement APRÈS le contrôle d'ownership
 *   6. Appel des RPC ; collecte des IDs créés/mis à jour
 *
 * PORTÉE : aucune mutation DB hors des deux RPC ci-dessus, aucune migration,
 * aucune modification RLS/Auth. Les RPC sont idempotentes (cf. Phase 2-J) :
 * chaque appel est atomique mais la fonction n'enveloppe PAS les appels dans
 * une transaction unique côté Edge (limite runtime documentée).
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import {
  getCorrelationId,
  respondOk,
  respondError,
  logRuntimeEvent,
} from "../_shared/runtime.ts";
// Phase 2-Q : contrat de validation extrait dans _shared pour supprimer toute
// dépendance d'import inter-Edge-Functions (bundling Lovable Edge). Comportement
// inchangé : même source unique de vérité que canonicalize-cargo-from-case.
import {
  validatePayload,
  type NormalizedPayload,
  type NormalizedCargoLine,
  type NormalizedEquipment,
} from "../_shared/cargo-payload-validation.ts";

// Re-export pour compatibilité ascendante des consommateurs/tests historiques
// qui importaient ces symboles depuis write-cargo-canonical.
export {
  validatePayload,
  type NormalizedPayload,
  type NormalizedCargoLine,
  type NormalizedEquipment,
  type NormalizedSource,
  type ValidationResult,
} from "../_shared/cargo-payload-validation.ts";

const FUNCTION_NAME = "write-cargo-canonical";

// ── Mapping payload → arguments RPC (purs, testables) ──────────────────────
export function buildCargoLineRpcArgs(
  payload: NormalizedPayload,
  line: NormalizedCargoLine,
): Record<string, unknown> {
  return {
    p_case_id: payload.case_id,
    p_line_index: line.line_index,
    p_status: line.status,
    p_description: line.description,
    p_hs_code: line.hs_code,
    p_value_number: line.value_number,
    p_value_currency: line.value_currency,
    p_weight_kg: line.weight_kg,
    p_volume_cbm: line.volume_cbm,
    p_pieces_count: line.pieces_count,
    p_source_quote_request_line_id: payload.source.source_quote_request_line_id,
    p_source_email_id: payload.source.source_email_id,
    p_source_excerpt: payload.source.source_excerpt,
    p_supersedes_cargo_line_id: line.supersedes_cargo_line_id,
  };
}

export function buildEquipmentRpcArgs(
  payload: NormalizedPayload,
  equipment: NormalizedEquipment,
  cargoLineId: string | null,
): Record<string, unknown> {
  return {
    p_case_id: payload.case_id,
    p_cargo_line_id: cargoLineId,
    p_equipment_type: equipment.equipment_type,
    p_quantity: equipment.quantity,
    p_status: equipment.status,
    p_source_quote_request_line_id: payload.source.source_quote_request_line_id,
    p_source_email_id: payload.source.source_email_id,
    p_source_excerpt: equipment.source_excerpt ?? payload.source.source_excerpt,
  };
}

// ── Handler HTTP ───────────────────────────────────────────────────────────
async function handler(req: Request): Promise<Response> {
  // 1. CORS preflight
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const correlationId = getCorrelationId(req);
  const startMs = Date.now();

  if (req.method !== "POST") {
    return respondError({
      code: "VALIDATION_FAILED",
      message: "Méthode non supportée (POST attendu)",
      correlationId,
    });
  }

  // 2. Auth obligatoire
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;

  // Client service-role pour le logging runtime (créé tôt, utilisé uniquement
  // pour observabilité jusqu'à la phase d'écriture).
  const svc = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // 3. Parse + validation stricte
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return respondError({
        code: "VALIDATION_FAILED",
        message: "Corps JSON invalide",
        correlationId,
      });
    }

    const validation = validatePayload(rawBody);
    if (!validation.ok) {
      const resp = respondError({
        code: "VALIDATION_FAILED",
        message: validation.message,
        correlationId,
      });
      await logRuntimeEvent(svc, {
        correlationId, functionName: FUNCTION_NAME, op: "validate",
        userId, status: "fatal_error", errorCode: "VALIDATION_FAILED",
        httpStatus: 400, durationMs: Date.now() - startMs,
      });
      return resp;
    }
    const payload = validation.value;

    // 4. Ownership via client user-scoped (RLS décide)
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );
    const { data: caseRow, error: caseErr } = await userClient
      .from("quote_cases")
      .select("id")
      .eq("id", payload.case_id)
      .single();

    if (caseErr || !caseRow) {
      const resp = respondError({
        code: "FORBIDDEN_OWNER",
        message: "Case introuvable ou accès refusé",
        correlationId,
      });
      await logRuntimeEvent(svc, {
        correlationId, functionName: FUNCTION_NAME, op: "ownership",
        userId, status: "fatal_error", errorCode: "FORBIDDEN_OWNER",
        httpStatus: 403, durationMs: Date.now() - startMs,
      });
      return resp;
    }

    // 5 & 6. Écriture via RPC service-role uniquement
    const resultLines: Array<{
      line_index: number;
      cargo_line_id: string;
      equipment_ids: string[];
    }> = [];

    for (const line of payload.cargo_lines) {
      const { data: lineId, error: lineErr } = await svc.rpc(
        "upsert_cargo_line",
        buildCargoLineRpcArgs(payload, line),
      );
      if (lineErr || !lineId) {
        const errMsg = lineErr ? JSON.stringify(lineErr) : "id manquant";
        const resp = respondError({
          code: "UPSTREAM_DB_ERROR",
          message: `upsert_cargo_line a échoué (line_index=${line.line_index}): ${errMsg}`,
          correlationId,
        });
        await logRuntimeEvent(svc, {
          correlationId, functionName: FUNCTION_NAME, op: "upsert_cargo_line",
          userId, status: "retryable_error", errorCode: "UPSTREAM_DB_ERROR",
          httpStatus: 500, durationMs: Date.now() - startMs,
          meta: { line_index: line.line_index },
        });
        return resp;
      }

      const equipmentIds: string[] = [];
      for (const eq of line.equipment) {
        const { data: eqId, error: eqErr } = await svc.rpc(
          "upsert_cargo_equipment",
          buildEquipmentRpcArgs(payload, eq, lineId as string),
        );
        if (eqErr || !eqId) {
          const errMsg = eqErr ? JSON.stringify(eqErr) : "id manquant";
          const resp = respondError({
            code: "UPSTREAM_DB_ERROR",
            message: `upsert_cargo_equipment (attaché) a échoué: ${errMsg}`,
            correlationId,
          });
          await logRuntimeEvent(svc, {
            correlationId, functionName: FUNCTION_NAME, op: "upsert_cargo_equipment",
            userId, status: "retryable_error", errorCode: "UPSTREAM_DB_ERROR",
            httpStatus: 500, durationMs: Date.now() - startMs,
            meta: { line_index: line.line_index, equipment_type: eq.equipment_type },
          });
          return resp;
        }
        equipmentIds.push(eqId as string);
      }

      resultLines.push({
        line_index: line.line_index,
        cargo_line_id: lineId as string,
        equipment_ids: equipmentIds,
      });
    }

    // Équipements non alloués (cargo_line_id = NULL)
    const unallocatedIds: string[] = [];
    for (const eq of payload.unallocated_equipment) {
      const { data: eqId, error: eqErr } = await svc.rpc(
        "upsert_cargo_equipment",
        buildEquipmentRpcArgs(payload, eq, null),
      );
      if (eqErr || !eqId) {
        const errMsg = eqErr ? JSON.stringify(eqErr) : "id manquant";
        const resp = respondError({
          code: "UPSTREAM_DB_ERROR",
          message: `upsert_cargo_equipment (non alloué) a échoué: ${errMsg}`,
          correlationId,
        });
        await logRuntimeEvent(svc, {
          correlationId, functionName: FUNCTION_NAME, op: "upsert_cargo_equipment_unallocated",
          userId, status: "retryable_error", errorCode: "UPSTREAM_DB_ERROR",
          httpStatus: 500, durationMs: Date.now() - startMs,
          meta: { equipment_type: eq.equipment_type },
        });
        return resp;
      }
      unallocatedIds.push(eqId as string);
    }

    // 9. IDs créés/mis à jour
    await logRuntimeEvent(svc, {
      correlationId, functionName: FUNCTION_NAME, op: "write",
      userId, status: "ok", httpStatus: 200, durationMs: Date.now() - startMs,
      meta: {
        cargo_lines: resultLines.length,
        unallocated_equipment: unallocatedIds.length,
      },
    });

    return respondOk(
      {
        case_id: payload.case_id,
        cargo_lines: resultLines,
        unallocated_equipment_ids: unallocatedIds,
      },
      correlationId,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const resp = respondError({
      code: "UNKNOWN",
      message: `Erreur inattendue: ${message}`,
      correlationId,
    });
    await logRuntimeEvent(svc, {
      correlationId, functionName: FUNCTION_NAME, op: "unhandled",
      userId, status: "fatal_error", errorCode: "UNKNOWN",
      httpStatus: 500, durationMs: Date.now() - startMs,
    });
    return resp;
  }
}

// Ne démarre le serveur que comme module d'entrée (Supabase Edge), pas à
// l'import (tests purs de validatePayload / build*RpcArgs).
if (import.meta.main) {
  Deno.serve(handler);
}

export { handler };
