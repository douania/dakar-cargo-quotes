/**
 * CARGO-CANONICAL-TO-LEGACY-FACTS-SYNC-AUDIT-1
 * sync-canonical-cargo-to-legacy-facts — projection minimale, explicite et sûre
 * du cargo canonique (cargo_lines / cargo_equipment) vers les legacy quote_facts.
 *
 * DOCTRINE (mécanisme SÉPARÉ, ne remplace ni ne modifie l'adoption canonique) :
 *   1. Auth JWT obligatoire (requireUser).
 *   2. Ownership vérifié via client user-scoped (RLS décide) AVANT toute écriture.
 *   3. Lecture SEULE des cargo_lines / cargo_equipment COURANTS du case.
 *   4. Construction d'une preview déterministe de facts legacy candidats.
 *   5. mode "dry_run" : AUCUNE écriture (preview uniquement).
 *      mode "commit"  : écrit UNIQUEMENT quote_facts via la RPC supersede_fact.
 *
 * GARDE-FOUS (invariants vérifiés) :
 *   - N'écrit JAMAIS cargo_lines / cargo_equipment (lecture seule).
 *   - Ne résout JAMAIS quote_gaps ; ne touche JAMAIS quote_gaps.
 *   - N'appelle JAMAIS run-pricing / set-case-fact / saveGapAnswer /
 *     build-case-puzzle / ack-pricing-ready / sync-gap-client-actions.
 *   - Ne promeut JAMAIS client_gap_requests (pas de bloc CL1).
 *   - Ne modifie ni write-cargo-canonical ni canonicalize-cargo-from-case.
 *   - Aucune migration : source_type "canonical_cargo_sync" n'existe pas dans la
 *     contrainte quote_facts_source_type_check (dernière : 20260317141020), donc
 *     on RÉUTILISE le source_type existant et sûr "manual_input" (confirmation
 *     opérateur), tracé distinctement via source_excerpt. Aucune contrainte DB
 *     n'est requise par ce design.
 *   - Facts V1 STRICTEMENT limités à : cargo.containers, cargo.container_count,
 *     cargo.container_type, cargo.description, cargo.weight_kg, cargo.pieces_count.
 *     Aucun fact interdit ne peut être généré (liste blanche par construction).
 *   - En commit : seule la table quote_facts est écrite (pas de case_timeline_events).
 *     Le logging runtime_events (observabilité transverse) reste best-effort.
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

const FUNCTION_NAME = "sync-canonical-cargo-to-legacy-facts";

// Format UUID générique (8-4-4-4-12) : la validité réelle est garantie par la DB
// (FK quote_cases). On évite la sur-restriction version/variante v4.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** source_type existant et sûr (confirmation opérateur). PAS de source_type dédié
 *  car il nécessiterait une migration de la contrainte CHECK. */
const SYNC_SOURCE_TYPE = "manual_input";
const SYNC_SOURCE_EXCERPT = "[sync-canonical-cargo-to-legacy-facts] Projection cargo canonique confirmée par opérateur";

/** Liste blanche EXHAUSTIVE des facts V1. Tout autre key est impossible à émettre. */
export const ALLOWED_LEGACY_FACT_KEYS = [
  "cargo.containers",
  "cargo.container_count",
  "cargo.container_type",
  "cargo.description",
  "cargo.weight_kg",
  "cargo.pieces_count",
] as const;

// ── Types lus depuis la DB (lecture seule) ─────────────────────────────────
export interface CargoLineRow {
  id?: string;
  line_index?: number | null;
  status?: string | null;
  description?: string | null;
  weight_kg?: number | null;
  pieces_count?: number | null;
  is_current?: boolean | null;
}

export interface CargoEquipmentRow {
  id?: string;
  equipment_type?: string | null;
  quantity?: number | null;
  status?: string | null;
}

// ── Types de preview (purs) ────────────────────────────────────────────────
export interface LegacyFactCandidate {
  fact_key: string;
  fact_category: string;
  value_text: string | null;
  value_number: number | null;
  value_json: unknown;
  reason: string;
}

export interface SkippedFact {
  fact_key: string;
  reason: string;
}

export interface LegacyFactsPreview {
  facts: LegacyFactCandidate[];
  skipped: SkippedFact[];
}

// ── Catégorie (aligné set-case-fact : tous nos keys → "cargo") ─────────────
export function detectCategory(factKey: string): string {
  const prefix = factKey.split(".")[0];
  switch (prefix) {
    case "client": return "contacts";
    case "cargo": return "cargo";
    case "routing": return "routing";
    case "timing": return "timing";
    case "service": return "service";
    case "customs": return "customs";
    case "regulatory": return "regulatory";
    default: return "other";
  }
}

function isCurrentLine(l: CargoLineRow): boolean {
  return l.is_current !== false && l.status !== "superseded";
}

function isCurrentEquipment(e: CargoEquipmentRow): boolean {
  return e.status !== "superseded";
}

/**
 * Construit la preview déterministe des facts legacy candidats.
 * PUR : aucune I/O. Émet UNIQUEMENT des keys de ALLOWED_LEGACY_FACT_KEYS.
 * Aucun fact interdit ne peut être généré.
 */
export function buildLegacyFactsPreview(
  cargoLines: CargoLineRow[],
  equipment: CargoEquipmentRow[],
): LegacyFactsPreview {
  const facts: LegacyFactCandidate[] = [];
  const skipped: SkippedFact[] = [];

  const lines = cargoLines.filter(isCurrentLine);
  const eq = equipment.filter(isCurrentEquipment);

  // ── Équipements → cargo.containers / container_count / container_type ──
  const byType = new Map<string, number>();
  for (const e of eq) {
    const type = (e.equipment_type ?? "").trim();
    const qty = e.quantity;
    if (!type || typeof qty !== "number" || !Number.isFinite(qty) || qty <= 0) {
      continue; // équipement invalide ignoré (non agrégé)
    }
    byType.set(type, (byType.get(type) ?? 0) + qty);
  }

  if (byType.size === 0) {
    const reason = eq.length === 0
      ? "Aucun équipement cargo courant"
      : "Aucun équipement courant valide (type/quantité)";
    skipped.push({ fact_key: "cargo.containers", reason });
    skipped.push({ fact_key: "cargo.container_count", reason });
    skipped.push({ fact_key: "cargo.container_type", reason });
  } else {
    const containers = [...byType.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([type, quantity]) => ({ type, quantity }));
    const totalCount = containers.reduce((s, c) => s + c.quantity, 0);

    facts.push({
      fact_key: "cargo.containers",
      fact_category: "cargo",
      value_text: null,
      value_number: null,
      value_json: containers,
      reason: `Agrégé depuis ${eq.length} équipement(s) courant(s)`,
    });
    facts.push({
      fact_key: "cargo.container_count",
      fact_category: "cargo",
      value_text: null,
      value_number: totalCount,
      value_json: null,
      reason: "Somme des quantités des équipements courants",
    });

    if (byType.size === 1) {
      facts.push({
        fact_key: "cargo.container_type",
        fact_category: "cargo",
        value_text: containers[0].type,
        value_number: null,
        value_json: null,
        reason: "Type d'équipement unique",
      });
    } else {
      skipped.push({
        fact_key: "cargo.container_type",
        reason: `Plusieurs types distincts (${byType.size}) : ambigu`,
      });
    }
  }

  // ── Lignes cargo → cargo.description ──
  const descs = lines
    .map((l) => (l.description ?? "").trim())
    .filter((d) => d.length > 0);
  const distinctDescs = [...new Set(descs)];
  if (distinctDescs.length === 1) {
    facts.push({
      fact_key: "cargo.description",
      fact_category: "cargo",
      value_text: distinctDescs[0],
      value_number: null,
      value_json: null,
      reason: "Désignation déterministe (confirmation opérateur requise)",
    });
  } else if (distinctDescs.length === 0) {
    skipped.push({
      fact_key: "cargo.description",
      reason: "Aucune désignation sur les lignes cargo courantes",
    });
  } else {
    skipped.push({
      fact_key: "cargo.description",
      reason: `Désignations multiples (${distinctDescs.length}) : ambigu`,
    });
  }

  // ── Lignes cargo → cargo.weight_kg (somme, seulement si toutes numériques) ──
  buildSummableLineFact(lines, "weight_kg", "cargo.weight_kg", facts, skipped);

  // ── Lignes cargo → cargo.pieces_count (somme, seulement si toutes numériques) ──
  buildSummableLineFact(lines, "pieces_count", "cargo.pieces_count", facts, skipped);

  return { facts, skipped };
}

/** Somme d'un champ numérique de ligne cargo : émis UNIQUEMENT si toutes les
 *  lignes courantes ont une valeur numérique finie (sinon ambigu → skip). */
function buildSummableLineFact(
  lines: CargoLineRow[],
  field: "weight_kg" | "pieces_count",
  factKey: string,
  facts: LegacyFactCandidate[],
  skipped: SkippedFact[],
): void {
  if (lines.length === 0) {
    skipped.push({ fact_key: factKey, reason: "Aucune ligne cargo courante" });
    return;
  }
  const values = lines.map((l) => l[field]);
  const allNumeric = values.every(
    (v) => typeof v === "number" && Number.isFinite(v),
  );
  if (!allNumeric) {
    skipped.push({
      fact_key: factKey,
      reason: "Valeur(s) manquante(s) ou non numérique(s) : ambigu",
    });
    return;
  }
  const sum = (values as number[]).reduce((s, v) => s + v, 0);
  facts.push({
    fact_key: factKey,
    fact_category: "cargo",
    value_text: null,
    value_number: sum,
    value_json: null,
    reason: lines.length === 1
      ? "Valeur de l'unique ligne cargo courante"
      : `Somme des ${lines.length} lignes cargo courantes`,
  });
}

// ── Parse + validation requête (pur, testable) ─────────────────────────────
export type SyncMode = "dry_run" | "commit";

export interface ParsedRequest {
  case_id: string;
  mode: SyncMode;
}

export function parseSyncRequest(
  raw: unknown,
): { ok: true; value: ParsedRequest } | { ok: false; message: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, message: "Corps JSON objet attendu" };
  }
  const body = raw as Record<string, unknown>;
  const caseId = body.case_id;
  if (typeof caseId !== "string" || !UUID_RE.test(caseId)) {
    return { ok: false, message: "case_id manquant ou non-UUID" };
  }
  const modeRaw = body.mode ?? "dry_run";
  if (modeRaw !== "dry_run" && modeRaw !== "commit") {
    return { ok: false, message: "mode doit être 'dry_run' ou 'commit'" };
  }
  return { ok: true, value: { case_id: caseId, mode: modeRaw } };
}

// ── Handler HTTP ───────────────────────────────────────────────────────────
async function handler(req: Request): Promise<Response> {
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

  // Auth obligatoire
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;

  const svc = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // Parse + validation
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

    const parsed = parseSyncRequest(rawBody);
    if (!parsed.ok) {
      await logRuntimeEvent(svc, {
        correlationId, functionName: FUNCTION_NAME, op: "validate",
        userId, status: "fatal_error", errorCode: "VALIDATION_FAILED",
        httpStatus: 400, durationMs: Date.now() - startMs,
      });
      return respondError({
        code: "VALIDATION_FAILED",
        message: parsed.message,
        correlationId,
      });
    }
    const { case_id, mode } = parsed.value;

    // Ownership via client user-scoped (RLS décide)
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );
    const { data: caseRow, error: caseErr } = await userClient
      .from("quote_cases")
      .select("id")
      .eq("id", case_id)
      .single();

    if (caseErr || !caseRow) {
      await logRuntimeEvent(svc, {
        correlationId, functionName: FUNCTION_NAME, op: "ownership",
        userId, status: "fatal_error", errorCode: "FORBIDDEN_OWNER",
        httpStatus: 403, durationMs: Date.now() - startMs,
      });
      return respondError({
        code: "FORBIDDEN_OWNER",
        message: "Case introuvable ou accès refusé",
        correlationId,
      });
    }

    // Lecture SEULE des cargo_lines / cargo_equipment courants
    const { data: cargoLines, error: linesErr } = await svc
      .from("cargo_lines")
      .select("id, line_index, status, description, weight_kg, pieces_count, is_current")
      .eq("case_id", case_id)
      .eq("is_current", true);

    if (linesErr) {
      await logRuntimeEvent(svc, {
        correlationId, functionName: FUNCTION_NAME, op: "read_cargo_lines",
        userId, status: "retryable_error", errorCode: "UPSTREAM_DB_ERROR",
        httpStatus: 500, durationMs: Date.now() - startMs,
      });
      return respondError({
        code: "UPSTREAM_DB_ERROR",
        message: `Lecture cargo_lines a échoué: ${JSON.stringify(linesErr)}`,
        correlationId,
      });
    }

    const { data: equipment, error: eqErr } = await svc
      .from("cargo_equipment")
      .select("id, equipment_type, quantity, status")
      .eq("case_id", case_id)
      .neq("status", "superseded");

    if (eqErr) {
      await logRuntimeEvent(svc, {
        correlationId, functionName: FUNCTION_NAME, op: "read_cargo_equipment",
        userId, status: "retryable_error", errorCode: "UPSTREAM_DB_ERROR",
        httpStatus: 500, durationMs: Date.now() - startMs,
      });
      return respondError({
        code: "UPSTREAM_DB_ERROR",
        message: `Lecture cargo_equipment a échoué: ${JSON.stringify(eqErr)}`,
        correlationId,
      });
    }

    // Construction preview (pure)
    const preview = buildLegacyFactsPreview(
      (cargoLines ?? []) as CargoLineRow[],
      (equipment ?? []) as CargoEquipmentRow[],
    );

    // ── dry_run : AUCUNE écriture ──
    if (mode === "dry_run") {
      await logRuntimeEvent(svc, {
        correlationId, functionName: FUNCTION_NAME, op: "dry_run",
        userId, status: "ok", httpStatus: 200, durationMs: Date.now() - startMs,
        meta: { facts: preview.facts.length, skipped: preview.skipped.length },
      });
      return respondOk(
        {
          mode,
          case_id,
          facts: preview.facts,
          skipped: preview.skipped,
          source_type: SYNC_SOURCE_TYPE,
        },
        correlationId,
      );
    }

    // ── commit : écrit UNIQUEMENT quote_facts via supersede_fact ──
    if (preview.facts.length === 0) {
      await logRuntimeEvent(svc, {
        correlationId, functionName: FUNCTION_NAME, op: "commit_noop",
        userId, status: "ok", httpStatus: 200, durationMs: Date.now() - startMs,
        meta: { facts: 0, skipped: preview.skipped.length },
      });
      return respondOk(
        { mode, case_id, written: [], skipped: preview.skipped },
        correlationId,
      );
    }

    const written: Array<{ fact_key: string; fact_id: string }> = [];
    for (const fact of preview.facts) {
      const { data: factId, error: rpcErr } = await svc.rpc("supersede_fact", {
        p_case_id: case_id,
        p_fact_key: fact.fact_key,
        p_fact_category: detectCategory(fact.fact_key),
        p_value_text: fact.value_text ?? null,
        p_value_number: fact.value_number ?? null,
        p_value_json: fact.value_json ?? null,
        p_source_type: SYNC_SOURCE_TYPE,
        p_confidence: 1.0,
        p_source_excerpt: SYNC_SOURCE_EXCERPT,
      });

      if (rpcErr) {
        await logRuntimeEvent(svc, {
          correlationId, functionName: FUNCTION_NAME, op: "supersede_fact",
          userId, status: "retryable_error", errorCode: "UPSTREAM_DB_ERROR",
          httpStatus: 500, durationMs: Date.now() - startMs,
          meta: { fact_key: fact.fact_key },
        });
        return respondError({
          code: "UPSTREAM_DB_ERROR",
          message: `supersede_fact a échoué (${fact.fact_key}): ${JSON.stringify(rpcErr)}`,
          correlationId,
        });
      }
      written.push({ fact_key: fact.fact_key, fact_id: factId as string });
    }

    await logRuntimeEvent(svc, {
      correlationId, functionName: FUNCTION_NAME, op: "commit",
      userId, status: "ok", httpStatus: 200, durationMs: Date.now() - startMs,
      meta: { written: written.length, skipped: preview.skipped.length },
    });

    return respondOk(
      { mode, case_id, written, skipped: preview.skipped },
      correlationId,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logRuntimeEvent(svc, {
      correlationId, functionName: FUNCTION_NAME, op: "unhandled",
      userId, status: "fatal_error", errorCode: "UNKNOWN",
      httpStatus: 500, durationMs: Date.now() - startMs,
    });
    return respondError({
      code: "UNKNOWN",
      message: `Erreur inattendue: ${message}`,
      correlationId,
    });
  }
}

// Ne démarre le serveur que comme module d'entrée (pas à l'import pour les tests purs).
if (import.meta.main) {
  Deno.serve(handler);
}

export { handler };
