/**
 * MULTI-CARGO-LINES-ARCHITECTURE-1 — Phase 2-N
 * canonicalize-cargo-from-case — consommateur dédié de write-cargo-canonical.
 *
 * Rôle : préparer/valider un payload cargo canonique puis, UNIQUEMENT en mode
 * commit, le transmettre à l'Edge Function write-cargo-canonical (Phase 2-M).
 *
 * Garde-fous architecturaux (Phase 2-N) :
 *   - N'appelle JAMAIS les RPC upsert_cargo_line / upsert_cargo_equipment :
 *     toute écriture canonique passe exclusivement par le writer Phase 2-M.
 *   - N'utilise JAMAIS service_role : ownership via client user-scoped
 *     (ANON_KEY + Authorization), et l'appel writer réutilise le header
 *     Authorization ORIGINAL de l'appelant.
 *   - mode dry_run : aucune écriture, aucun appel writer (retourne le payload
 *     qui SERAIT envoyé).
 *
 * Chaîne : CORS → requireUser → validation → ownership (user-scoped) →
 *          build writer_payload → dry_run (echo) | commit (appel writer).
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { getCorrelationId, respondError } from "../_shared/runtime.ts";
// Réutilise la validation STRICTE partagée (Phase 2-Q) comme source unique de
// vérité : un payload accepté ici est garanti acceptable par write-cargo-canonical,
// qui consomme exactement le même contrat. Import via _shared pour éviter toute
// dépendance d'import inter-Edge-Functions (bundling Lovable Edge).
import { validatePayload as validateWriterPayload } from "../_shared/cargo-payload-validation.ts";

const FUNCTION_NAME = "canonicalize-cargo-from-case";
const WRITER_FUNCTION = "write-cargo-canonical";

const MAX_SOURCE_EXCERPT_LEN = 2000;
const MODE_WHITELIST = new Set(["dry_run", "commit"]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Types normalisés ───────────────────────────────────────────────────────
export type Mode = "dry_run" | "commit";

export interface NormalizedSource {
  source_email_id: string | null;
  source_quote_request_line_id: string | null;
  source_excerpt: string | null;
}

export interface ConsumerInput {
  case_id: string;
  mode: Mode;
  source: NormalizedSource;
  cargo_lines: unknown[];
  unallocated_equipment: unknown[];
}

/** Payload transmis tel quel au writer Phase 2-M (forme attendue par celui-ci). */
export interface WriterPayload {
  case_id: string;
  source: NormalizedSource;
  cargo_lines: unknown[];
  unallocated_equipment: unknown[];
}

export type ConsumerValidationResult =
  | { ok: true; value: ConsumerInput }
  | { ok: false; message: string };

// ── Helpers de validation purs ─────────────────────────────────────────────
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

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

/** string|null ; rejette tout dépassement (aucune troncature silencieuse). */
function coerceExcerptOrNull(
  v: unknown,
  field: string,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== "string") {
    return { ok: false, message: `${field} doit être une chaîne ou null` };
  }
  if (v.length > MAX_SOURCE_EXCERPT_LEN) {
    return { ok: false, message: `${field} dépasse la longueur maximale (${MAX_SOURCE_EXCERPT_LEN})` };
  }
  return { ok: true, value: v };
}

/**
 * Validation/normalisation du payload consommateur.
 * Pur (aucune I/O) → testable hors réseau. La validation FINE des cargo_lines /
 * équipements est déléguée au writer Phase 2-M ; ici on valide le contrat
 * d'orchestration (case_id, mode, présence cargo_payload, anti no-op, excerpt).
 */
export function validateConsumerInput(raw: unknown): ConsumerValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, message: "Payload doit être un objet JSON" };
  }

  if (typeof raw.case_id !== "string" || !UUID_RE.test(raw.case_id)) {
    return { ok: false, message: "case_id est obligatoire et doit être un UUID" };
  }
  const case_id = raw.case_id;

  if (typeof raw.mode !== "string" || !MODE_WHITELIST.has(raw.mode)) {
    return { ok: false, message: "mode invalide (attendu: dry_run|commit)" };
  }
  const mode = raw.mode as Mode;

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
    const sExcerpt = coerceExcerptOrNull(raw.source.source_excerpt, "source.source_excerpt");
    if (!sExcerpt.ok) return sExcerpt;
    source = {
      source_email_id: sEmail.value,
      source_quote_request_line_id: sQrl.value,
      source_excerpt: sExcerpt.value,
    };
  }

  // cargo_payload obligatoire
  if (!isPlainObject(raw.cargo_payload)) {
    return { ok: false, message: "cargo_payload est obligatoire (objet)" };
  }

  const clRaw = raw.cargo_payload.cargo_lines;
  if (clRaw !== undefined && clRaw !== null && !Array.isArray(clRaw)) {
    return { ok: false, message: "cargo_payload.cargo_lines doit être un tableau" };
  }
  const cargo_lines: unknown[] = Array.isArray(clRaw) ? clRaw : [];

  const ueRaw = raw.cargo_payload.unallocated_equipment;
  if (ueRaw !== undefined && ueRaw !== null && !Array.isArray(ueRaw)) {
    return { ok: false, message: "cargo_payload.unallocated_equipment doit être un tableau" };
  }
  const unallocated_equipment: unknown[] = Array.isArray(ueRaw) ? ueRaw : [];

  // Anti no-op : refuser un payload sans aucune écriture à effectuer.
  if (cargo_lines.length === 0 && unallocated_equipment.length === 0) {
    return {
      ok: false,
      message: "Aucune écriture demandée : cargo_lines et unallocated_equipment sont vides",
    };
  }

  return { ok: true, value: { case_id, mode, source, cargo_lines, unallocated_equipment } };
}

/** Construit le payload cible attendu par write-cargo-canonical (Phase 2-M). */
export function buildWriterPayload(input: ConsumerInput): WriterPayload {
  return {
    case_id: input.case_id,
    source: input.source,
    cargo_lines: input.cargo_lines,
    unallocated_equipment: input.unallocated_equipment,
  };
}

// ── Dépendances injectables (testabilité sans réseau) ──────────────────────
export interface CanonicalizeDeps {
  /** Vérifie l'accessibilité du case via RLS (client user-scoped). */
  verifyOwnership: (caseId: string, authHeader: string) => Promise<boolean>;
  /** Appelle le writer Phase 2-M avec le header Authorization ORIGINAL. */
  callWriter: (
    payload: WriterPayload,
    authHeader: string,
    correlationId: string,
  ) => Promise<Response>;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Cœur d'orchestration, pur vis-à-vis du réseau (dépendances injectées).
 * Ne touche jamais service_role ni les RPC directement.
 */
export async function canonicalizeCore(
  rawBody: unknown,
  authHeader: string | null,
  correlationId: string,
  deps: CanonicalizeDeps,
): Promise<Response> {
  // 3. Validation
  const validation = validateConsumerInput(rawBody);
  if (!validation.ok) {
    return respondError({
      code: "VALIDATION_FAILED",
      message: validation.message,
      correlationId,
    });
  }
  const input = validation.value;

  if (!authHeader) {
    return respondError({
      code: "AUTH_MISSING_JWT",
      message: "Header Authorization manquant",
      correlationId,
    });
  }

  // 4. Ownership (client user-scoped, RLS décide)
  const owned = await deps.verifyOwnership(input.case_id, authHeader);
  if (!owned) {
    return respondError({
      code: "FORBIDDEN_OWNER",
      message: "Case introuvable ou accès refusé",
      correlationId,
    });
  }

  // 5. Construction du payload writer
  const writer_payload = buildWriterPayload(input);

  // 5b. Validation STRICTE via la logique du writer Phase 2-M (source unique de
  // vérité). Appliquée AVANT dry_run ET commit : un dry_run reflète exactement
  // ce que le writer accepterait/refuserait, sans aucune écriture.
  const writerValidation = validateWriterPayload(writer_payload);
  if (!writerValidation.ok) {
    return respondError({
      code: "VALIDATION_FAILED",
      message: writerValidation.message,
      correlationId,
    });
  }

  // 6. dry_run : echo, aucun appel writer, aucune écriture
  if (input.mode === "dry_run") {
    return jsonResponse(
      { ok: true, mode: "dry_run", writer_payload, correlation_id: correlationId },
      200,
    );
  }

  // 7. commit : appel writer avec Authorization ORIGINAL, réponse renvoyée telle
  // quelle. try/catch : une défaillance réseau/exception du writer est convertie
  // en erreur contrôlée UPSTREAM_WRITER_ERROR (502) plutôt qu'une 500 brute.
  try {
    return await deps.callWriter(writer_payload, authHeader, correlationId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(
      {
        ok: false,
        error: {
          code: "UPSTREAM_WRITER_ERROR",
          message: `Appel writer en échec: ${message}`,
          retryable: true,
        },
        correlation_id: correlationId,
      },
      502,
    );
  }
}

// ── Implémentations réelles (réseau / Supabase) ────────────────────────────
async function realVerifyOwnership(caseId: string, authHeader: string): Promise<boolean> {
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data, error } = await userClient
    .from("quote_cases")
    .select("id")
    .eq("id", caseId)
    .single();
  return !error && !!data;
}

async function realCallWriter(
  payload: WriterPayload,
  authHeader: string,
  correlationId: string,
): Promise<Response> {
  const writerUrl = `${Deno.env.get("SUPABASE_URL")!}/functions/v1/${WRITER_FUNCTION}`;
  const upstream = await fetch(writerUrl, {
    method: "POST",
    headers: {
      // Header Authorization ORIGINAL réutilisé (jamais service_role).
      Authorization: authHeader,
      apikey: Deno.env.get("SUPABASE_ANON_KEY")!,
      "Content-Type": "application/json",
      "x-correlation-id": correlationId,
    },
    body: JSON.stringify(payload),
  });

  // Passthrough : statut + corps du writer, ré-enveloppés avec les CORS headers.
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Handler HTTP ───────────────────────────────────────────────────────────
async function handler(req: Request): Promise<Response> {
  // 1. CORS preflight
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const correlationId = getCorrelationId(req);

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

  return await canonicalizeCore(
    rawBody,
    req.headers.get("Authorization"),
    correlationId,
    { verifyOwnership: realVerifyOwnership, callWriter: realCallWriter },
  );
}

// Ne démarre le serveur que comme module d'entrée (Supabase Edge), pas à
// l'import (tests purs).
if (import.meta.main) {
  Deno.serve(handler);
}

export { FUNCTION_NAME, handler, WRITER_FUNCTION };
