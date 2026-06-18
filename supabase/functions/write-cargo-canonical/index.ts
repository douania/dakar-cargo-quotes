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

const FUNCTION_NAME = "write-cargo-canonical";

// ── Limites & whitelists de validation ─────────────────────────────────────
const MAX_CARGO_LINES = 200;
const MAX_EQUIPMENT_PER_LINE = 200;
const MAX_UNALLOCATED_EQUIPMENT = 200;
const MAX_SOURCE_EXCERPT_LEN = 2000; // au-delà : validation failed (champ documentaire)
const MAX_DESCRIPTION_LEN = 4000;
const MAX_HS_CODE_LEN = 64;
const MAX_EQUIPMENT_TYPE_LEN = 200;

// Statut d'entrée d'une ligne courante : 'superseded' interdit (cf. RPC).
const LINE_STATUS_WHITELIST = new Set(["to_confirm", "confirmed"]);
// Équipement : 'superseded' autorisé (cf. RPC upsert_cargo_equipment).
const EQUIPMENT_STATUS_WHITELIST = new Set([
  "to_confirm",
  "confirmed",
  "superseded",
]);
const CURRENCY_WHITELIST = new Set(["XOF", "FCFA", "CFA", "EUR", "USD"]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Types normalisés (sortie de validatePayload) ───────────────────────────
export interface NormalizedEquipment {
  equipment_type: string;
  quantity: number;
  status: string;
  source_excerpt: string | null;
}

export interface NormalizedCargoLine {
  line_index: number;
  status: string;
  description: string | null;
  hs_code: string | null;
  value_number: number | null;
  value_currency: string | null;
  weight_kg: number | null;
  volume_cbm: number | null;
  pieces_count: number | null;
  supersedes_cargo_line_id: string | null;
  equipment: NormalizedEquipment[];
}

export interface NormalizedSource {
  source_email_id: string | null;
  source_quote_request_line_id: string | null;
  source_excerpt: string | null;
}

export interface NormalizedPayload {
  case_id: string;
  source: NormalizedSource;
  cargo_lines: NormalizedCargoLine[];
  unallocated_equipment: NormalizedEquipment[];
}

export type ValidationResult =
  | { ok: true; value: NormalizedPayload }
  | { ok: false; message: string };

// ── Helpers de validation purs ─────────────────────────────────────────────
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** uuid|null ; rejette tout type/format invalide. */
function coerceUuidOrNull(
  v: unknown,
  field: string,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== "string" || !UUID_RE.test(v)) {
    return { ok: false, message: `${field} doit être un UUID valide ou null` };
  }
  return { ok: true, value: v };
}

/**
 * string|null ; rejette les types non-string et les dépassements de longueur.
 * onOverflow = "reject" → validation failed si v.length > maxLen (aucune
 * troncature silencieuse). "truncate" → tronque à maxLen.
 */
function coerceStringOrNull(
  v: unknown,
  field: string,
  maxLen: number,
  onOverflow: "reject" | "truncate" = "truncate",
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== "string") {
    return { ok: false, message: `${field} doit être une chaîne ou null` };
  }
  if (v.length > maxLen) {
    if (onOverflow === "reject") {
      return { ok: false, message: `${field} dépasse la longueur maximale (${maxLen})` };
    }
    return { ok: true, value: v.slice(0, maxLen) };
  }
  return { ok: true, value: v };
}

/** number|null fini & >= 0 ; rejette NaN, négatif, type invalide. */
function coerceNonNegativeNumberOrNull(
  v: unknown,
  field: string,
): { ok: true; value: number | null } | { ok: false; message: string } {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
    return {
      ok: false,
      message: `${field} doit être un nombre >= 0 ou null`,
    };
  }
  return { ok: true, value: v };
}

function validateEquipment(
  raw: unknown,
  ctx: string,
): { ok: true; value: NormalizedEquipment } | { ok: false; message: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, message: `${ctx} doit être un objet` };
  }

  const typeRaw = raw.equipment_type;
  if (typeof typeRaw !== "string" || typeRaw.trim().length === 0) {
    return { ok: false, message: `${ctx}.equipment_type est obligatoire et non vide` };
  }
  const equipment_type = typeRaw.trim().slice(0, MAX_EQUIPMENT_TYPE_LEN);

  const qty = raw.quantity;
  if (typeof qty !== "number" || !Number.isInteger(qty) || qty <= 0) {
    return { ok: false, message: `${ctx}.quantity doit être un entier > 0` };
  }

  const status = raw.status ?? "to_confirm";
  if (typeof status !== "string" || !EQUIPMENT_STATUS_WHITELIST.has(status)) {
    return {
      ok: false,
      message: `${ctx}.status invalide (attendu: to_confirm|confirmed|superseded)`,
    };
  }

  const excerpt = coerceStringOrNull(
    raw.source_excerpt,
    `${ctx}.source_excerpt`,
    MAX_SOURCE_EXCERPT_LEN,
    "reject",
  );
  if (!excerpt.ok) return excerpt;

  return {
    ok: true,
    value: {
      equipment_type,
      quantity: qty,
      status,
      source_excerpt: excerpt.value,
    },
  };
}

/**
 * Validation stricte & normalisation du payload.
 * Pur (aucune I/O) → testable hors réseau.
 */
export function validatePayload(raw: unknown): ValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, message: "Payload doit être un objet JSON" };
  }

  // case_id obligatoire
  if (typeof raw.case_id !== "string" || !UUID_RE.test(raw.case_id)) {
    return { ok: false, message: "case_id est obligatoire et doit être un UUID" };
  }
  const case_id = raw.case_id;

  // source (optionnelle)
  let source: NormalizedSource = {
    source_email_id: null,
    source_quote_request_line_id: null,
    source_excerpt: null,
  };
  if (raw.source !== undefined && raw.source !== null) {
    if (!isPlainObject(raw.source)) {
      return { ok: false, message: "source doit être un objet ou null" };
    }
    const sEmail = coerceUuidOrNull(raw.source.source_email_id, "source.source_email_id");
    if (!sEmail.ok) return sEmail;
    const sQrl = coerceUuidOrNull(
      raw.source.source_quote_request_line_id,
      "source.source_quote_request_line_id",
    );
    if (!sQrl.ok) return sQrl;
    const sExcerpt = coerceStringOrNull(
      raw.source.source_excerpt,
      "source.source_excerpt",
      MAX_SOURCE_EXCERPT_LEN,
      "reject",
    );
    if (!sExcerpt.ok) return sExcerpt;
    source = {
      source_email_id: sEmail.value,
      source_quote_request_line_id: sQrl.value,
      source_excerpt: sExcerpt.value,
    };
  }

  // cargo_lines (tableau, peut être vide)
  if (!Array.isArray(raw.cargo_lines)) {
    return { ok: false, message: "cargo_lines doit être un tableau" };
  }
  if (raw.cargo_lines.length > MAX_CARGO_LINES) {
    return { ok: false, message: `cargo_lines dépasse la limite (${MAX_CARGO_LINES})` };
  }

  const cargo_lines: NormalizedCargoLine[] = [];
  for (let i = 0; i < raw.cargo_lines.length; i++) {
    const lineRaw = raw.cargo_lines[i];
    const ctx = `cargo_lines[${i}]`;
    if (!isPlainObject(lineRaw)) {
      return { ok: false, message: `${ctx} doit être un objet` };
    }

    const li = lineRaw.line_index;
    if (typeof li !== "number" || !Number.isInteger(li) || li < 1) {
      return { ok: false, message: `${ctx}.line_index doit être un entier >= 1` };
    }

    const status = lineRaw.status ?? "to_confirm";
    if (typeof status !== "string" || !LINE_STATUS_WHITELIST.has(status)) {
      return {
        ok: false,
        message: `${ctx}.status invalide (attendu: to_confirm|confirmed)`,
      };
    }

    const description = coerceStringOrNull(lineRaw.description, `${ctx}.description`, MAX_DESCRIPTION_LEN);
    if (!description.ok) return description;
    const hs_code = coerceStringOrNull(lineRaw.hs_code, `${ctx}.hs_code`, MAX_HS_CODE_LEN);
    if (!hs_code.ok) return hs_code;

    const value_number = coerceNonNegativeNumberOrNull(lineRaw.value_number, `${ctx}.value_number`);
    if (!value_number.ok) return value_number;

    let value_currency: string | null = null;
    if (lineRaw.value_currency !== undefined && lineRaw.value_currency !== null) {
      if (typeof lineRaw.value_currency !== "string" || !CURRENCY_WHITELIST.has(lineRaw.value_currency)) {
        return {
          ok: false,
          message: `${ctx}.value_currency invalide (attendu: XOF|FCFA|CFA|EUR|USD)`,
        };
      }
      value_currency = lineRaw.value_currency;
    }

    const weight_kg = coerceNonNegativeNumberOrNull(lineRaw.weight_kg, `${ctx}.weight_kg`);
    if (!weight_kg.ok) return weight_kg;
    const volume_cbm = coerceNonNegativeNumberOrNull(lineRaw.volume_cbm, `${ctx}.volume_cbm`);
    if (!volume_cbm.ok) return volume_cbm;
    const pieces_count = coerceNonNegativeNumberOrNull(lineRaw.pieces_count, `${ctx}.pieces_count`);
    if (!pieces_count.ok) return pieces_count;

    const supersedes = coerceUuidOrNull(lineRaw.supersedes_cargo_line_id, `${ctx}.supersedes_cargo_line_id`);
    if (!supersedes.ok) return supersedes;

    // equipment attaché (optionnel)
    const equipment: NormalizedEquipment[] = [];
    if (lineRaw.equipment !== undefined && lineRaw.equipment !== null) {
      if (!Array.isArray(lineRaw.equipment)) {
        return { ok: false, message: `${ctx}.equipment doit être un tableau` };
      }
      if (lineRaw.equipment.length > MAX_EQUIPMENT_PER_LINE) {
        return { ok: false, message: `${ctx}.equipment dépasse la limite (${MAX_EQUIPMENT_PER_LINE})` };
      }
      for (let j = 0; j < lineRaw.equipment.length; j++) {
        const eq = validateEquipment(lineRaw.equipment[j], `${ctx}.equipment[${j}]`);
        if (!eq.ok) return eq;
        equipment.push(eq.value);
      }
    }

    cargo_lines.push({
      line_index: li,
      status,
      description: description.value,
      hs_code: hs_code.value,
      value_number: value_number.value,
      value_currency,
      weight_kg: weight_kg.value,
      volume_cbm: volume_cbm.value,
      pieces_count: pieces_count.value,
      supersedes_cargo_line_id: supersedes.value,
      equipment,
    });
  }

  // unallocated_equipment (optionnel)
  const unallocated_equipment: NormalizedEquipment[] = [];
  if (raw.unallocated_equipment !== undefined && raw.unallocated_equipment !== null) {
    if (!Array.isArray(raw.unallocated_equipment)) {
      return { ok: false, message: "unallocated_equipment doit être un tableau" };
    }
    if (raw.unallocated_equipment.length > MAX_UNALLOCATED_EQUIPMENT) {
      return { ok: false, message: `unallocated_equipment dépasse la limite (${MAX_UNALLOCATED_EQUIPMENT})` };
    }
    for (let i = 0; i < raw.unallocated_equipment.length; i++) {
      const eq = validateEquipment(raw.unallocated_equipment[i], `unallocated_equipment[${i}]`);
      if (!eq.ok) return eq;
      unallocated_equipment.push(eq.value);
    }
  }

  // Anti no-op : refuser un payload sans aucune écriture à effectuer.
  if (cargo_lines.length === 0 && unallocated_equipment.length === 0) {
    return {
      ok: false,
      message: "Aucune écriture demandée : cargo_lines et unallocated_equipment sont vides",
    };
  }

  return {
    ok: true,
    value: { case_id, source, cargo_lines, unallocated_equipment },
  };
}

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
