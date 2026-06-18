/**
 * MULTI-CARGO-LINES-ARCHITECTURE-1 — Phase 2-O
 * derive-cargo-canonical-payload — Edge Function READ-ONLY.
 *
 * Lit les sources existantes (email_attachments.extracted_data), construit un
 * cargo_payload candidat, puis appelle canonicalize-cargo-from-case en mode
 * dry_run UNIQUEMENT (aucune écriture).
 *
 * Garde-fous (Phase 2-O) :
 *   - READ-ONLY : aucune écriture DB, aucun RPC, aucun service_role.
 *   - N'appelle JAMAIS write-cargo-canonical directement : passe par le
 *     canonicalizer (Phase 2-N) en dry_run, qui valide via le writer (Phase 2-M).
 *   - Lecture via client user-scoped (ANON_KEY + Authorization), RLS décide.
 *   - Réutilise le header Authorization ORIGINAL pour l'appel canonicalizer.
 *
 * Sources : email_attachments.extracted_data (+ extracted_text/subject pour un
 * source_excerpt court). Aucune dépendance à quote_facts en Phase 2-O.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { getCorrelationId, respondError } from "../_shared/runtime.ts";

const FUNCTION_NAME = "derive-cargo-canonical-payload";
const CANONICALIZER_FUNCTION = "canonicalize-cargo-from-case";

const MAX_SOURCE_EXCERPT_LEN = 2000;
const CURRENCY_WHITELIST = new Set(["XOF", "FCFA", "CFA", "EUR", "USD"]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Types ──────────────────────────────────────────────────────────────────
export interface AttachmentLike {
  id: string;
  email_id?: string | null;
  filename?: string | null;
  content_type?: string | null;
  is_analyzed?: boolean | null;
  extracted_data?: unknown;
}

export interface DerivedEquipment {
  equipment_type: string;
  quantity: number;
  status: string;
  source_excerpt: string | null;
}

export interface DerivedCargoLine {
  line_index: number;
  status: string;
  description: string | null;
  hs_code: string | null;
  value_number: number | null;
  value_currency: string | null;
  weight_kg: number | null;
  volume_cbm: number | null;
  pieces_count: number | null;
  equipment: DerivedEquipment[];
}

export interface DerivedPayload {
  cargo_lines: DerivedCargoLine[];
  unallocated_equipment: DerivedEquipment[];
  warnings: string[];
  sources_used: Array<{ id: string; filename: string | null }>;
}

export interface AttachmentAssessment {
  ok: boolean;
  blocking: Array<{ id: string; filename: string | null; reason: string }>;
}

// ── Helpers purs ───────────────────────────────────────────────────────────
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonNegNumberOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  return null;
}

function stringOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

/** Normalise une devise vers la whitelist writer ; sinon null. */
export function normalizeCurrency(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const up = v.trim().toUpperCase();
  return CURRENCY_WHITELIST.has(up) ? up : null;
}

// Tokens techniques (jamais décisifs) et signaux métier (images décisives).
const TECHNICAL_TOKENS = [
  "signature", "logo", "banner", "footer", "spacer", "social", "icon", "avatar",
];
const BUSINESS_TOKENS = [
  "quotation", "quote", "devis", "packing", "invoice", "facture",
  "bill of lading", "bill_of_lading", "billoflading", "rfq", "rate",
  "proforma", "shipment",
];
const IMAGE_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "tif", "tiff",
]);
const EXCEL_EXTENSIONS = new Set(["xls", "xlsx", "xlsm", "csv"]);

function fileExtension(filename: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(filename);
  return m ? m[1].toLowerCase() : "";
}

function hasBusinessSignal(filename: string): boolean {
  for (const tok of BUSINESS_TOKENS) {
    if (tok === "rfq" || tok === "bl") {
      if (new RegExp(`\\b${tok}\\b`).test(filename)) return true;
    } else if (filename.includes(tok)) {
      return true;
    }
  }
  // "bl" listé au contrat : exigé comme token isolé (évite table/blue/blanc...).
  if (/\bbl\b/.test(filename)) return true;
  return false;
}

/**
 * Helper PUR : un attachment est-il un candidat DÉCISIF pour la dérivation cargo ?
 *   - PDF / Excel → décisifs.
 *   - Images → décisives UNIQUEMENT si le filename porte un signal métier
 *     (quotation, devis, invoice, packing, bl, rfq, rate, proforma, shipment...)
 *     ET n'est pas un fichier technique (signature/logo/banner/footer/spacer/
 *     social/icon/avatar).
 *   - Tout le reste → non décisif.
 */
export function isDecisiveAttachmentCandidate(att: AttachmentLike): boolean {
  const filename = (att.filename ?? "").toLowerCase();
  const ct = (att.content_type ?? "").toLowerCase();
  const ext = fileExtension(filename);

  const isPdf = ct.includes("pdf") || ext === "pdf";
  const isExcel = ct.includes("spreadsheet") || ct.includes("excel") || EXCEL_EXTENSIONS.has(ext);
  if (isPdf || isExcel) return true;

  const isImage = ct.startsWith("image/") || IMAGE_EXTENSIONS.has(ext);
  if (isImage) {
    if (TECHNICAL_TOKENS.some((t) => filename.includes(t))) return false;
    return hasBusinessSignal(filename);
  }

  // Autres fichiers (inconnus / techniques inline) → non décisifs.
  return false;
}

/**
 * Gate "attachments décisifs". Ne bloque QUE les attachments DÉCISIFS
 * (isDecisiveAttachmentCandidate) qui ne sont pas analysés (is_analyzed faux ou
 * extracted_data absent) ou dont l'extraction est en erreur
 * (extracted_data.type === 'error'). Les pièces non décisives (logos,
 * signatures, images inline génériques…) ne bloquent jamais.
 */
export function assessAttachments(attachments: AttachmentLike[]): AttachmentAssessment {
  const blocking: AttachmentAssessment["blocking"] = [];
  for (const att of attachments) {
    if (!isDecisiveAttachmentCandidate(att)) continue;
    const filename = att.filename ?? null;
    const data = att.extracted_data;
    const analyzed = att.is_analyzed === true && data != null;
    if (!analyzed) {
      blocking.push({ id: att.id, filename, reason: "not_analyzed" });
      continue;
    }
    if (isPlainObject(data) && data.type === "error") {
      blocking.push({ id: att.id, filename, reason: "extraction_error" });
    }
  }
  return { ok: blocking.length === 0, blocking };
}

/**
 * Construit le cargo_payload candidat à partir des attachments analysés.
 * Pur (aucune I/O) → testable.
 *
 * Mapping :
 *   extracted_data.articles[] → cargo_lines[]
 *     description → description, hs_code → hs_code, quantity → pieces_count,
 *     total → value_number, currency → value_currency (whitelist).
 *   extracted_data.poids_brut_kg / volume_cbm → appliqués UNIQUEMENT s'il y a
 *     exactement une ligne cargo (pas de répartition multi-lignes).
 *   extracted_data.containers[] (globaux) → unallocated_equipment[].
 */
export function deriveCargoPayload(attachments: AttachmentLike[]): DerivedPayload {
  const warnings: string[] = [];
  const sourcesUsed: Array<{ id: string; filename: string | null }> = [];
  const unallocated_equipment: DerivedEquipment[] = [];

  // Lignes en construction, avec référence vers l'attachment source (pour la
  // règle poids/volume mono-ligne).
  interface PendingLine {
    line: DerivedCargoLine;
    weight_kg: number | null;
    volume_cbm: number | null;
  }
  const pending: PendingLine[] = [];

  for (const att of attachments) {
    const data = att.extracted_data;
    if (!isPlainObject(data)) continue;
    const filename = att.filename ?? null;
    let contributed = false;

    // ── articles → cargo_lines ──
    const articles = data.articles;
    const attWeight = nonNegNumberOrNull(data.poids_brut_kg);
    const attVolume = nonNegNumberOrNull(data.volume_cbm);
    if (Array.isArray(articles)) {
      for (const art of articles) {
        if (!isPlainObject(art)) continue;
        const description = stringOrNull(art.description);
        const hs_code = stringOrNull(art.hs_code);
        const pieces_count = nonNegNumberOrNull(art.quantity);
        const value_number = nonNegNumberOrNull(art.total);
        const rawCurrency = art.currency;
        const value_currency = normalizeCurrency(rawCurrency);
        if (rawCurrency != null && value_currency === null) {
          warnings.push(
            `Devise non reconnue ignorée (${String(rawCurrency)}) sur "${description ?? "article"}"`,
          );
        }

        // Ignorer un article totalement vide.
        if (
          description === null && hs_code === null &&
          pieces_count === null && value_number === null
        ) {
          warnings.push(`Article vide ignoré dans ${filename ?? att.id}`);
          continue;
        }

        pending.push({
          line: {
            line_index: 0, // assigné après collecte globale
            status: "to_confirm",
            description,
            hs_code,
            value_number,
            value_currency,
            weight_kg: null,
            volume_cbm: null,
            pieces_count,
            equipment: [],
          },
          weight_kg: attWeight,
          volume_cbm: attVolume,
        });
        contributed = true;
      }
    }

    // ── containers globaux → unallocated_equipment ──
    const containers = data.containers;
    if (Array.isArray(containers)) {
      for (const c of containers) {
        if (!isPlainObject(c)) continue;
        const equipment_type = stringOrNull(c.type) ?? stringOrNull(c.equipment_type);
        if (equipment_type === null) continue;
        const quantity = nonNegNumberOrNull(c.quantity);
        unallocated_equipment.push({
          equipment_type,
          quantity: quantity && quantity > 0 ? quantity : 1,
          status: "to_confirm",
          source_excerpt: null,
        });
        contributed = true;
      }
    }

    if (contributed) sourcesUsed.push({ id: att.id, filename });
  }

  // Assignation des line_index séquentiels.
  const cargo_lines: DerivedCargoLine[] = pending.map((p, i) => ({
    ...p.line,
    line_index: i + 1,
  }));

  // Règle poids/volume : appliqués uniquement si UNE seule ligne cargo.
  if (cargo_lines.length === 1) {
    cargo_lines[0].weight_kg = pending[0].weight_kg;
    cargo_lines[0].volume_cbm = pending[0].volume_cbm;
  } else if (cargo_lines.length > 1) {
    const anyWeightVolume = pending.some((p) => p.weight_kg !== null || p.volume_cbm !== null);
    if (anyWeightVolume) {
      warnings.push(
        "poids_brut_kg / volume_cbm non répartis : plusieurs lignes cargo (aucune répartition automatique)",
      );
    }
  }

  return { cargo_lines, unallocated_equipment, warnings, sources_used: sourcesUsed };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Dépendances injectables (testabilité sans réseau/DB) ───────────────────
export interface DeriveDeps {
  verifyOwnership: (caseId: string, authHeader: string) => Promise<boolean>;
  loadAttachments: (caseId: string, authHeader: string) => Promise<AttachmentLike[]>;
  callCanonicalizer: (
    body: Record<string, unknown>,
    authHeader: string,
    correlationId: string,
  ) => Promise<Response>;
}

/**
 * Cœur d'orchestration, pur vis-à-vis du réseau (dépendances injectées).
 * Ne touche jamais service_role, ni les RPC, ni write-cargo-canonical.
 */
export async function deriveCore(
  rawBody: unknown,
  authHeader: string | null,
  correlationId: string,
  deps: DeriveDeps,
): Promise<Response> {
  // 1. Validation de l'entrée
  if (!isPlainObject(rawBody)) {
    return respondError({ code: "VALIDATION_FAILED", message: "Payload doit être un objet JSON", correlationId });
  }
  if (typeof rawBody.case_id !== "string" || !UUID_RE.test(rawBody.case_id)) {
    return respondError({ code: "VALIDATION_FAILED", message: "case_id est obligatoire et doit être un UUID", correlationId });
  }
  const case_id = rawBody.case_id;

  if (!authHeader) {
    return respondError({ code: "AUTH_MISSING_JWT", message: "Header Authorization manquant", correlationId });
  }

  // 2. Ownership (client user-scoped, RLS décide)
  const owned = await deps.verifyOwnership(case_id, authHeader);
  if (!owned) {
    return respondError({ code: "FORBIDDEN_OWNER", message: "Case introuvable ou accès refusé", correlationId });
  }

  // 3. Lecture des attachments du case via RLS
  const attachments = await deps.loadAttachments(case_id, authHeader);

  // 4. Gate : refuser si un attachment décisif n'est pas analysé / est en erreur
  const assessment = assessAttachments(attachments);
  if (!assessment.ok) {
    const detail = assessment.blocking
      .map((b) => `${b.filename ?? b.id} (${b.reason})`)
      .join("; ");
    return respondError({
      code: "VALIDATION_FAILED",
      message: `Attachments non exploitables (non analysés ou en erreur) : ${detail}`,
      correlationId,
    });
  }

  // 5. Construction du payload dérivé
  const derived = deriveCargoPayload(attachments);

  if (derived.cargo_lines.length === 0 && derived.unallocated_equipment.length === 0) {
    return respondError({
      code: "VALIDATION_FAILED",
      message: "Aucune donnée cargo dérivable depuis les sources analysées",
      correlationId,
    });
  }

  // 6. Source + appel canonicalizer en dry_run UNIQUEMENT
  const firstSource = derived.sources_used[0];
  const sourceLabel = derived.sources_used.map((s) => s.filename ?? s.id).join(", ");
  const source = {
    source_email_id: null as string | null,
    source_quote_request_line_id: null as string | null,
    source_excerpt: sourceLabel
      ? `[derive-cargo] ${sourceLabel}`.slice(0, MAX_SOURCE_EXCERPT_LEN)
      : null,
  };
  void firstSource;

  const cargo_payload = {
    cargo_lines: derived.cargo_lines,
    unallocated_equipment: derived.unallocated_equipment,
  };

  const canonicalizerBody = {
    case_id,
    mode: "dry_run", // FORCÉ : jamais commit en Phase 2-O
    source,
    cargo_payload,
  };

  let canonicalizeDryRun: unknown;
  let canonicalizeStatus: number;
  try {
    const resp = await deps.callCanonicalizer(canonicalizerBody, authHeader, correlationId);
    canonicalizeStatus = resp.status;
    const text = await resp.text();
    try {
      canonicalizeDryRun = text ? JSON.parse(text) : null;
    } catch {
      canonicalizeDryRun = { raw: text };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(
      {
        ok: false,
        error: { code: "UPSTREAM_CANONICALIZER_ERROR", message: `Appel canonicalizer en échec: ${message}`, retryable: true },
        correlation_id: correlationId,
      },
      502,
    );
  }

  // 7. Si le canonicalizer (dry_run) rejette le payload dérivé (status non-2xx),
  // ne JAMAIS retourner ok:true : remonter l'échec de validation tel quel.
  const is2xx = canonicalizeStatus >= 200 && canonicalizeStatus < 300;
  if (!is2xx) {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: "CANONICALIZER_VALIDATION_FAILED",
          message: "Le canonicalizer (dry_run) a rejeté le payload dérivé",
          retryable: false,
        },
        case_id,
        derived_payload: { case_id, source, cargo_payload },
        canonicalize_status: canonicalizeStatus,
        canonicalize_dry_run: canonicalizeDryRun,
        warnings: derived.warnings,
        sources_used: derived.sources_used,
        correlation_id: correlationId,
      },
      canonicalizeStatus,
    );
  }

  // 8. Réponse agrégée (succès)
  return jsonResponse(
    {
      ok: true,
      case_id,
      derived_payload: { case_id, source, cargo_payload },
      canonicalize_dry_run: canonicalizeDryRun,
      canonicalize_status: canonicalizeStatus,
      warnings: derived.warnings,
      sources_used: derived.sources_used,
      correlation_id: correlationId,
    },
    200,
  );
}

// ── Implémentations réelles (réseau / Supabase, user-scoped) ───────────────
function userClient(authHeader: string) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
}

async function realVerifyOwnership(caseId: string, authHeader: string): Promise<boolean> {
  const { data, error } = await userClient(authHeader)
    .from("quote_cases")
    .select("id")
    .eq("id", caseId)
    .single();
  return !error && !!data;
}

async function realLoadAttachments(caseId: string, authHeader: string): Promise<AttachmentLike[]> {
  const client = userClient(authHeader);

  const { data: caseRow } = await client
    .from("quote_cases")
    .select("thread_id")
    .eq("id", caseId)
    .single();
  const threadId = (caseRow as { thread_id?: string | null } | null)?.thread_id ?? null;
  if (!threadId) return [];

  const { data: emails } = await client
    .from("emails")
    .select("id")
    .eq("thread_ref", threadId);
  const emailIds = (emails ?? []).map((e: { id: string }) => e.id);
  if (emailIds.length === 0) return [];

  const { data: attachments } = await client
    .from("email_attachments")
    .select("id, email_id, filename, content_type, extracted_data, extracted_text, is_analyzed")
    .in("email_id", emailIds);

  return (attachments ?? []) as AttachmentLike[];
}

async function realCallCanonicalizer(
  body: Record<string, unknown>,
  authHeader: string,
  correlationId: string,
): Promise<Response> {
  const url = `${Deno.env.get("SUPABASE_URL")!}/functions/v1/${CANONICALIZER_FUNCTION}`;
  return await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader, // header ORIGINAL réutilisé (jamais service_role)
      apikey: Deno.env.get("SUPABASE_ANON_KEY")!,
      "Content-Type": "application/json",
      "x-correlation-id": correlationId,
    },
    body: JSON.stringify(body),
  });
}

// ── Handler HTTP ───────────────────────────────────────────────────────────
async function handler(req: Request): Promise<Response> {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const correlationId = getCorrelationId(req);

  if (req.method !== "POST") {
    return respondError({ code: "VALIDATION_FAILED", message: "Méthode non supportée (POST attendu)", correlationId });
  }

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return respondError({ code: "VALIDATION_FAILED", message: "Corps JSON invalide", correlationId });
  }

  return await deriveCore(
    rawBody,
    req.headers.get("Authorization"),
    correlationId,
    {
      verifyOwnership: realVerifyOwnership,
      loadAttachments: realLoadAttachments,
      callCanonicalizer: realCallCanonicalizer,
    },
  );
}

// Ne démarre le serveur que comme module d'entrée (Lovable Cloud / Edge compatible), pas à l'import.
if (import.meta.main) {
  Deno.serve(handler);
}

export { FUNCTION_NAME, handler, CANONICALIZER_FUNCTION };
