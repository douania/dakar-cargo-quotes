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
// Phase 2-Q Patch C : extraction de texte lisible depuis un body_text MIME brut
// (multipart, parties base64/quoted-printable, HTML strippé). Pur, en mémoire.
import { extractPlainTextFromMime } from "../_shared/email-text-extraction.ts";

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

/**
 * Phase 2-Q — Source additionnelle READ-ONLY : dernier email entrant du thread.
 * Forme minimale (lecture seule, jamais d'écriture).
 */
export interface EmailLike {
  id: string;
  subject?: string | null;
  body_text?: string | null;
  sent_at?: string | null;
  from_address?: string | null;
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

// ── Phase 2-Q : dernier email entrant client comme source additionnelle ──────

// Convention projet (réplique locale ; AUCUN import de build-case-puzzle) :
// les emails SODATRA sont sortants/internes → jamais une source de révision client.
const SODATRA_DOMAINS = ["sodatra.sn", "sodatra.com"];
export function isSodatraEmail(email: string): boolean {
  const domain = (email || "").split("@")[1]?.toLowerCase();
  return SODATRA_DOMAINS.some((d) => domain?.includes(d));
}

// Termes de révision : n'autorisent l'ajout du cargo dérivé d'email que si le
// dernier email exprime une mise à jour explicite (et non une simple discussion).
const REVISION_TERMS = [
  "update", "increase", "additionally", "added", "now", "total bus count",
];
export function hasRevisionTerms(text: string): boolean {
  const t = (text || "").toLowerCase();
  return REVISION_TERMS.some((w) => t.includes(w));
}

// Vocabulaire véhicules / cargo roulant.
const VEHICLE_RE = "(?:buses|bus|vehicles|vehicle|trucks|truck|cars|car)";

function titleCase(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Helper PUR : détecte une révision « N véhicules + véhicules en 40FR ».
 * N'INFÈRE `N × 40FR` que si DEUX conditions sont réunies :
 *   - un compte véhicule/bus EXPLICITE (N),
 *   - une mention flat-rack/40FR liée aux véhicules/bus.
 * Sinon : aucune quantité inventée (au plus un warning).
 */
export function parseVehicleFlatRackRevision(text: string): {
  count: number | null;
  flatRackForVehicles: boolean;
  inferred: { equipment_type: string; quantity: number } | null;
  description: string | null;
  warnings: string[];
} {
  const warnings: string[] = [];
  const src = text || "";

  // flat-rack / 40FR tié aux véhicules : EXIGE un signal FR explicite —
  // "40FR", "40'FR", "40 FR", "FR" isolé, "flat rack", "flatrack".
  // IMPORTANT : "40'", "40 ft/feet/foot" SEULS ne sont PAS une preuve de flat
  // rack (un conteneur 40 pieds peut être GP/HC) → jamais d'inférence véhicule
  // sans signal FR explicite. Le comptage 20GP/40GP reste géré séparément.
  const flatRackPresent =
    /40\s*'?\s*fr\b|\bfr\b|\bflat\s*-?\s*racks?\b|\bflatracks?\b/i.test(src);
  const vehiclePresent = new RegExp(`\\b${VEHICLE_RE}\\b`, "i").test(src);
  const flatRackForVehicles = flatRackPresent && vehiclePresent;

  // Compte véhicule explicite (plusieurs formulations).
  let count: number | null = null;
  let vehicleWord: string | null = null;
  let m: RegExpMatchArray | null;

  // "total bus count is 15"
  m = src.match(new RegExp(`total\\s+(${VEHICLE_RE})\\s+count\\s*(?:is|:|=)?\\s*(\\d+)`, "i"));
  if (m) { vehicleWord = m[1]; count = parseInt(m[2], 10); }
  // "bus is increase to 15", "buses increased to 15", "bus has been increased to 15"
  if (count === null) {
    m = src.match(new RegExp(`(${VEHICLE_RE})\\s+(?:is\\s+|are\\s+|has\\s+been\\s+|have\\s+been\\s+)?(?:increased|increase)\\s+to\\s+(\\d+)`, "i"));
    if (m) { vehicleWord = m[1]; count = parseInt(m[2], 10); }
  }
  // "bus count is 15", "bus count: 15"
  if (count === null) {
    m = src.match(new RegExp(`(${VEHICLE_RE})\\s+count\\s*(?:is|:|=)?\\s*(\\d+)`, "i"));
    if (m) { vehicleWord = m[1]; count = parseInt(m[2], 10); }
  }
  // "15 buses"
  if (count === null) {
    m = src.match(new RegExp(`(\\d+)\\s+(${VEHICLE_RE})\\b`, "i"));
    if (m) { count = parseInt(m[1], 10); vehicleWord = m[2]; }
  }

  if (count !== null && (!Number.isFinite(count) || count <= 0)) count = null;

  let inferred: { equipment_type: string; quantity: number } | null = null;
  if (count !== null && flatRackForVehicles) {
    inferred = { equipment_type: "40FR", quantity: count };
    warnings.push(
      `${count} × 40FR inferred from latest client email: explicit bus count + buses in 40FR. Operator confirmation required.`,
    );
  } else if (flatRackForVehicles && count === null) {
    warnings.push(
      "Vehicles/buses mentioned in 40FR but no explicit count found in latest client email: no quantity inferred. Operator confirmation required.",
    );
  }

  const description = inferred ? titleCase(vehicleWord ?? "Vehicles") : null;
  return { count, flatRackForVehicles, inferred, description, warnings };
}

/**
 * Helper PUR : conteneurs additionnels (ex. équipement médical non-DGR).
 *   - "1x 20", "1 x 20", "1 × 20", "1x 20'", "one additional 20 ft" → 20GP
 *   - "1x 40", "1 x 40", "1 × 40", "1x 40'", "one 40 ft"           → 40GP
 * Statut to_confirm.
 *
 * Anti double-comptage : un même conteneur peut être exprimé à la fois en forme
 * compacte ("1x 20'") ET en forme texte ("one additional 20 ft") dans le même
 * email. On compte chaque FAMILLE de patterns séparément puis on fusionne par
 * taille via le MAXIMUM (fusion conservatrice), jamais la somme.
 * `medicalContext` vrai si « medical equipment » / « non DGR » est proche.
 */
export function parseAdditionalMedicalEquipmentContainers(text: string): {
  equipment: DerivedEquipment[];
  medicalContext: boolean;
} {
  const src = text || "";
  const medicalContext = /medical\s+equipment/i.test(src) || /non[\s-]*dgr/i.test(src);

  // Famille A : forme compacte "1x20", "1 x 40", "1 × 20", "1x 40'"
  const countsA: Record<string, number> = {};
  const reA = /(\d+)\s*(?:x|×)\s*(20|40)\b/gi;
  let mm: RegExpExecArray | null;
  while ((mm = reA.exec(src)) !== null) {
    const qty = parseInt(mm[1], 10);
    if (Number.isFinite(qty) && qty > 0) countsA[mm[2]] = (countsA[mm[2]] ?? 0) + qty;
  }

  // Famille B : forme texte "one additional 20 ft", "one 40 ft"
  const countsB: Record<string, number> = {};
  const wordNum: Record<string, number> = { one: 1, two: 2, three: 3 };
  const reB = /\b(one|two|three)\s+(?:additional\s+)?(20|40)\s*(?:ft|feet|foot|')/gi;
  while ((mm = reB.exec(src)) !== null) {
    const qty = wordNum[mm[1].toLowerCase()] ?? 0;
    if (qty > 0) countsB[mm[2]] = (countsB[mm[2]] ?? 0) + qty;
  }

  // Fusion conservatrice par taille : MAX(A, B) — évite le double comptage.
  const sizeMap: Record<string, string> = { "20": "20GP", "40": "40GP" };
  const equipment: DerivedEquipment[] = [];
  for (const size of ["20", "40"]) {
    const qty = Math.max(countsA[size] ?? 0, countsB[size] ?? 0);
    if (qty > 0) {
      equipment.push({
        equipment_type: sizeMap[size],
        quantity: qty,
        status: "to_confirm",
        source_excerpt: null,
      });
    }
  }
  return { equipment, medicalContext };
}

// ── Phase 2-Q Patch B : normalisation base64 du dernier email entrant ───────
// Le body_text du dernier email entrant peut arriver en payload MIME base64
// brut (non décodé en UTF-8 à l'ingestion). On le décode alors EN MÉMOIRE pour
// le preview de dérivation, sans JAMAIS réécrire la valeur décodée en base.

// Indicateurs « déjà lisible » : si présents dans le texte brut, on ne décode
// pas (texte cargo/email déjà exploitable).
const READABLE_INDICATORS = [
  "total bus count", "40fr", "40'fr", "flat rack", "flatrack",
  "medical equipment", "non dgr", "dear", "hello", "container",
];
// Indicateurs FORTS exigés dans le texte DÉCODÉ pour accepter le décodage.
const DECODED_STRONG_INDICATORS = [
  "dear", "hello", "total bus count", "40fr", "40'fr",
  "medical equipment", "non dgr", "container",
];

function hasAnyIndicator(text: string, indicators: string[]): boolean {
  const t = text.toLowerCase();
  return indicators.some((k) => t.includes(k));
}

/** Ratio de caractères imprimables (tab/LF/CR + >= 0x20, hors DEL). */
function printableRatio(s: string): number {
  const cps = [...s];
  if (cps.length === 0) return 0;
  let printable = 0;
  for (const ch of cps) {
    const code = ch.codePointAt(0)!;
    if (code === 9 || code === 10 || code === 13 || (code >= 0x20 && code !== 0x7f)) {
      printable++;
    }
  }
  return printable / cps.length;
}

/** Décodage base64 → UTF-8 sûr (Deno/atob, sans Buffer). Ne lève jamais. */
function decodeBase64Utf8(b64: string): string | null {
  try {
    if (typeof atob !== "function") return null;
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

/** Indices qu'un body est un payload MIME (et non un simple base64 « nu »). */
function looksLikeMime(body: string): boolean {
  return (
    /boundary\s*=/i.test(body) ||
    /content-transfer-encoding:/i.test(body) ||
    /content-type:\s*(?:multipart\/|text\/(?:plain|html))/i.test(body)
  );
}

/**
 * Patch D — Détecte un corps « encodé / artefact MIME » qui n'expose PAS de
 * marqueur MIME explicite (pas de boundary/Content-Type) mais reste un payload
 * base64-ish entrecoupé d'artefacts de séparateur ("--", "--___", "-", "_").
 * Sur ces corps, looksLikeMime échoue ET le fallback base64 « nu » échoue (le
 * charset strict rejette "-"/"_"), si bien que l'extraction n'était jamais
 * tentée. Conservateur : exige un corps long, quasi exclusivement composé de
 * caractères base64/artefacts/blancs, avec un long préfixe base64 OU un
 * séparateur "--". L'acceptation finale reste verrouillée par les gardes fortes
 * (différence matérielle + ratio imprimable + indicateur fort).
 */
function looksEncodedOrMimeArtifactBody(body: string): boolean {
  const b = body.trim();
  if (b.length <= 200) return false;

  // Un base64 « nu » PUR est géré par le fallback Patch B (warning base64-decoded)
  // → ne pas le détourner ici (préserve la distinction de warning).
  const compact = b.replace(/\s+/g, "");
  if (/^[A-Za-z0-9+/=]+$/.test(compact)) return false;

  // Sinon : exiger un corps quasi exclusivement base64 + artefacts MIME/base64url
  // (« - », « _ », blancs) — typiquement un payload encodé avec séparateurs.
  let b64ish = 0;
  for (const ch of b) {
    if (/[A-Za-z0-9+/=_\-\s]/.test(ch)) b64ish++;
  }
  const ratio = b64ish / b.length;
  if (ratio < 0.95) return false;

  const longB64Prefix = /^[A-Za-z0-9+/=]{80,}/.test(b.replace(/^\s+/, ""));
  const hasSeparator = b.includes("--");
  return longB64Prefix || hasSeparator;
}

/**
 * Helper PUR (Phase 2-Q Patch B + C) — normalise subject+body_text du dernier
 * email entrant pour le parsing EN MÉMOIRE uniquement (aucune écriture DB).
 *
 * Conservateur, dans l'ordre :
 *   - corps vide ou déjà lisible (indicateur cargo/email présent) → inchangé ;
 *   - Patch C : si le corps ressemble à du MIME, extraction texte lisible
 *     (multipart/base64/QP, HTML strippé) ; retenue UNIQUEMENT si le résultat
 *     diffère matériellement du brut ET contient un indicateur fort ;
 *   - Patch B : sinon, fallback base64 « nu » (charset base64, multiple de 4),
 *     retenu si majoritairement imprimable ET indicateur fort ;
 *   - ne lève JAMAIS : tout échec retombe sur le texte original.
 */
export function normalizeEmailTextForParsing(
  subject: string | null | undefined,
  bodyText: string | null | undefined,
): { text: string; decoded: boolean; warning: string | null } {
  const subjectPart = subject ?? "";
  const rawBody = bodyText ?? "";
  const rawText = `${subjectPart}\n${rawBody}`;

  const trimmedBody = rawBody.trim();
  if (!trimmedBody) return { text: rawText, decoded: false, warning: null };

  // Déjà lisible → ne pas décoder.
  if (hasAnyIndicator(rawText, READABLE_INDICATORS)) {
    return { text: rawText, decoded: false, warning: null };
  }

  // Patch C/D : extraction MIME (multipart / parties encodées / artefacts
  // base64-ish) AVANT le fallback base64 « nu ». Déclenchée si le corps ressemble
  // à du MIME (Patch C) OU à un payload encodé/artefact sans marqueur MIME
  // explicite (Patch D). Gardée UNIQUEMENT si elle produit un texte matériellement
  // différent ET contenant un indicateur email/cargo fort.
  if (looksLikeMime(rawBody) || looksEncodedOrMimeArtifactBody(rawBody)) {
    const extracted = extractPlainTextFromMime(rawBody);
    if (
      extracted &&
      extracted.trim() !== trimmedBody &&
      printableRatio(extracted) >= 0.8 &&
      hasAnyIndicator(extracted, DECODED_STRONG_INDICATORS)
    ) {
      return {
        text: `${subjectPart}\n${extracted}`,
        decoded: true,
        warning:
          "Latest inbound email body_text was MIME-decoded in memory for preview parsing. No database write performed.",
      };
    }
    // Échec/insuffisant → on poursuit avec le fallback base64 « nu » ci-dessous.
  }

  // Détection base64 conservatrice (corps sans blancs).
  const compact = trimmedBody.replace(/\s+/g, "");
  if (compact.length <= 80 || !/^[A-Za-z0-9+/=]+$/.test(compact)) {
    return { text: rawText, decoded: false, warning: null };
  }

  // Normalisation du padding : longueur cible multiple de 4.
  const unpadded = compact.replace(/=+$/, "");
  const mod = unpadded.length % 4;
  if (mod === 1) return { text: rawText, decoded: false, warning: null };
  const padded = mod === 0 ? unpadded : unpadded + "=".repeat(4 - mod);

  const decoded = decodeBase64Utf8(padded);
  if (decoded === null) return { text: rawText, decoded: false, warning: null };

  // Le décodé doit être lisible ET contenir un indicateur fort.
  if (
    printableRatio(decoded) < 0.8 ||
    !hasAnyIndicator(decoded, DECODED_STRONG_INDICATORS)
  ) {
    return { text: rawText, decoded: false, warning: null };
  }

  return {
    text: `${subjectPart}\n${decoded}`,
    decoded: true,
    warning:
      "Latest inbound email body_text was base64-decoded in memory for preview parsing. No database write performed.",
  };
}

/**
 * Helper PUR : dérive un cargo_payload candidat depuis le dernier email entrant.
 * Combine la révision véhicules/flat-rack et les conteneurs additionnels.
 * Ne renvoie une contribution que si du cargo a réellement été dérivé.
 */
export function deriveCargoPayloadFromLatestInboundEmail(
  email: EmailLike | null,
): DerivedPayload & { source_email_id: string | null } {
  const empty = {
    cargo_lines: [] as DerivedCargoLine[],
    unallocated_equipment: [] as DerivedEquipment[],
    warnings: [] as string[],
    sources_used: [] as Array<{ id: string; filename: string | null }>,
    source_email_id: null as string | null,
  };
  if (!email) return empty;

  // Phase 2-Q Patch B : normalisation base64 EN MÉMOIRE (aucune écriture DB).
  const normalized = normalizeEmailTextForParsing(email.subject, email.body_text);
  const text = normalized.text;
  if (!text.trim()) return empty;

  const cargo_lines: DerivedCargoLine[] = [];
  const unallocated_equipment: DerivedEquipment[] = [];
  const warnings: string[] = [];
  // Le warning de décodage est remonté dès qu'un décodage a eu lieu (preview),
  // indépendamment d'une contribution cargo effective.
  if (normalized.decoded && normalized.warning) {
    warnings.push(normalized.warning);
  }
  // source_excerpt : texte décodé si décodage (l'opérateur voit la source lisible).
  const excerpt = text.slice(0, MAX_SOURCE_EXCERPT_LEN);
  let lineIndex = 0;
  let contributed = false;

  // 1. Révision véhicules + 40FR
  const vfr = parseVehicleFlatRackRevision(text);
  warnings.push(...vfr.warnings);
  if (vfr.inferred) {
    cargo_lines.push({
      line_index: ++lineIndex,
      status: "to_confirm",
      description: vfr.description,
      hs_code: null,
      value_number: null,
      value_currency: null,
      weight_kg: null,
      volume_cbm: null,
      pieces_count: vfr.count,
      equipment: [{
        equipment_type: vfr.inferred.equipment_type,
        quantity: vfr.inferred.quantity,
        status: "to_confirm",
        source_excerpt: excerpt,
      }],
    });
    contributed = true;
  }

  // 2. Conteneurs additionnels (équipement médical non-DGR le cas échéant)
  const med = parseAdditionalMedicalEquipmentContainers(text);
  if (med.equipment.length > 0) {
    if (med.medicalContext) {
      cargo_lines.push({
        line_index: ++lineIndex,
        status: "to_confirm",
        description: "Medical equipment non-DGR",
        hs_code: null,
        value_number: null,
        value_currency: null,
        weight_kg: null,
        volume_cbm: null,
        pieces_count: null,
        equipment: med.equipment,
      });
    } else {
      // Conservateur : pas de contexte médical → équipement non alloué.
      unallocated_equipment.push(...med.equipment);
    }
    contributed = true;
  }

  const sources_used = contributed
    ? [{ id: email.id, filename: email.subject ?? null }]
    : [];

  return {
    cargo_lines,
    unallocated_equipment,
    warnings,
    sources_used,
    source_email_id: contributed ? email.id : null,
  };
}

// ── Phase 2-Q Patch E : enrichissement specs bus depuis le THREAD entrant ────
// Règle métier : le DERNIER email entrant pilote les quantités/équipements
// finaux (15 × 40FR + médical). Les emails ANTÉRIEURS ne fournissent QUE des
// spécifications stables (modèle / dimensions / poids unitaire). On ne lit
// JAMAIS la quantité antérieure (ex. 5) comme quantité finale.
//
// Schéma cargo canonique : seuls weight_kg et volume_cbm sont des champs
// supportés (cf. _shared/cargo-payload-validation.ts). Aucun champ "dimensions"
// structuré n'existe → les dimensions/modèle bruts ne sont JAMAIS inventés en
// champs de schéma ; ils ne sont remontés que dans un warning documentaire.

export interface BusSpecs {
  model: string | null;
  dimsM: { l: number; w: number; h: number } | null;
  unitWeightKg: number | null;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Parse "12,000" (séparateur milliers) / "12.5" / "2,5" (décimal) → nombre. */
function parseLooseNumber(raw: string): number | null {
  let s = raw.trim();
  // "12,000" (virgule suivie de groupes de 3 chiffres, sans point) → milliers.
  if (/^\d{1,3}(?:,\d{3})+$/.test(s)) s = s.replace(/,/g, "");
  else s = s.replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** Longueur → mètres selon l'unité (mm|cm|m). null si unité inconnue. */
function lengthToMeters(value: number, unit: string): number | null {
  const u = unit.toLowerCase();
  if (u === "mm") return value / 1000;
  if (u === "cm") return value / 100;
  if (u === "m") return value;
  return null;
}

/** Poids → kg selon l'unité (kg|t|ton(ne)s). null si unité inconnue. */
function weightToKg(value: number, unit: string): number | null {
  const u = unit.toLowerCase();
  if (u === "kg" || u === "kgs") return value;
  if (u === "t" || u === "ton" || u === "tons" || u === "tonne" || u === "tonnes") {
    return value * 1000;
  }
  return null;
}

/** Dimension étiquetée "Length: 12 m" / "Width = 2.5 m" / "Height 3.5 m". */
function matchLabeledLength(src: string, labelAlternation: string): number | null {
  const re = new RegExp(
    `\\b${labelAlternation}\\s*(?:[:=]|is)?\\s*(\\d[\\d.,]*)\\s*(mm|cm|m)\\b`,
    "i",
  );
  const m = src.match(re);
  if (!m) return null;
  const val = parseLooseNumber(m[1]);
  if (val === null || val <= 0) return null;
  return lengthToMeters(val, m[2]);
}

/**
 * Helper PUR : extrait les spécifications bus EXPLICITES d'un texte d'email.
 * Ne lit JAMAIS de quantité (la quantité finale reste pilotée par le dernier
 * email). N'INVENTE rien : uniquement des valeurs explicitement parsées ET
 * clairement liées aux bus (contexte véhicule exigé pour éviter de capter des
 * dimensions/poids de conteneurs).
 */
export function parseBusSpecsFromEmailText(text: string): BusSpecs {
  const src = text || "";
  const busContext = new RegExp(`\\b${VEHICLE_RE}\\b`, "i").test(src);
  // Sans contexte véhicule explicite : aucune spec liée (anti dims conteneur).
  if (!busContext) return { model: null, dimsM: null, unitWeightKg: null };

  // ── Modèle (best-effort, documentaire) : "<Marque ...> [passenger] bus" ──
  let model: string | null = null;
  const mModel = src.match(
    /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})\s+(?:[Pp]assenger\s+)?[Bb]us(?:es)?\b/,
  );
  if (mModel) model = `${mModel[1]} Bus`;

  // ── Dimensions L×W×H clairement liées au bus ──
  let dimsM: { l: number; w: number; h: number } | null = null;
  // Forme compacte "12000 x 2500 x 3500 mm" (unité au moins sur le dernier).
  const mCombined = src.match(
    /(\d[\d.,]*)\s*(mm|cm|m)?\s*[x×*]\s*(\d[\d.,]*)\s*(mm|cm|m)?\s*[x×*]\s*(\d[\d.,]*)\s*(mm|cm|m)\b/i,
  );
  if (mCombined) {
    const unit = mCombined[6];
    const u1 = mCombined[2] || unit;
    const u2 = mCombined[4] || unit;
    const l = parseLooseNumber(mCombined[1]);
    const w = parseLooseNumber(mCombined[3]);
    const h = parseLooseNumber(mCombined[5]);
    if (l !== null && w !== null && h !== null) {
      const lm = lengthToMeters(l, u1);
      const wm = lengthToMeters(w, u2);
      const hm = lengthToMeters(h, unit);
      if (
        lm !== null && wm !== null && hm !== null &&
        lm > 0 && wm > 0 && hm > 0
      ) {
        dimsM = { l: round3(lm), w: round3(wm), h: round3(hm) };
      }
    }
  }
  // Forme étiquetée Length/Width/Height (toutes trois exigées).
  if (dimsM === null) {
    const lm = matchLabeledLength(src, "(?:length|longueur|l)");
    const wm = matchLabeledLength(src, "(?:width|largeur|w)");
    const hm = matchLabeledLength(src, "(?:height|hauteur|h)");
    if (lm !== null && wm !== null && hm !== null) {
      dimsM = { l: round3(lm), w: round3(wm), h: round3(hm) };
    }
  }

  // ── Poids unitaire / GVW clairement lié au bus ──
  let unitWeightKg: number | null = null;
  const mWeight = src.match(
    /(?:gvw|gross\s+vehicle\s+weight|unit\s+weight|weight\s+per\s+unit|weight\s+each|curb\s+weight|kerb\s+weight)\b[^0-9]{0,20}(\d[\d.,]*)\s*(kg|kgs|tonnes?|tons?|t)\b/i,
  );
  if (mWeight) {
    const val = parseLooseNumber(mWeight[1]);
    if (val !== null) {
      const kg = weightToKg(val, mWeight[2]);
      if (kg !== null && kg > 0) unitWeightKg = round3(kg);
    }
  }

  return { model, dimsM, unitWeightKg };
}

function uniqueNumbers(arr: number[]): number[] {
  return [...new Set(arr)];
}
function uniqueStrings(arr: string[]): string[] {
  return [...new Set(arr)];
}

/**
 * Helper PUR : agrège les specs bus du thread (emails ANTÉRIEURS uniquement).
 * Politique conservatrice par champ :
 *   - poids unitaire : si une seule valeur distincte → retenue ; si plusieurs
 *     valeurs en conflit → NON propagé + warning ;
 *   - dimensions : idem (tuple L×W×H distinct).
 * Aucune préférence "silencieuse" en cas de conflit.
 */
export function findMostRelevantBusSpecsFromThread(emails: EmailLike[]): {
  spec: (BusSpecs & { sourceEmailId: string | null }) | null;
  warnings: string[];
} {
  const warnings: string[] = [];
  const found: Array<{ id: string; specs: BusSpecs }> = [];
  for (const e of emails ?? []) {
    if (!e) continue;
    const text = normalizeEmailTextForParsing(e.subject, e.body_text).text;
    const specs = parseBusSpecsFromEmailText(text);
    if (specs.dimsM !== null || specs.unitWeightKg !== null) {
      found.push({ id: e.id, specs });
    }
  }
  if (found.length === 0) return { spec: null, warnings };

  // Poids : valeurs distinctes. Conflit ⇒ non propagé (+warning).
  const weights = uniqueNumbers(
    found.map((f) => f.specs.unitWeightKg).filter((v): v is number => v !== null),
  );
  let unitWeightKg: number | null = null;
  if (weights.length === 1) unitWeightKg = weights[0];
  else if (weights.length > 1) {
    warnings.push(
      "Conflicting bus unit weight across earlier client emails: weight not propagated. Operator confirmation required.",
    );
  }

  // Dimensions : tuples distincts. Conflit ⇒ non propagé (+warning).
  const dimList = found
    .map((f) => f.specs.dimsM)
    .filter((v): v is { l: number; w: number; h: number } => v !== null);
  const dimKeys = uniqueStrings(dimList.map((d) => `${d.l}x${d.w}x${d.h}`));
  let dimsM: { l: number; w: number; h: number } | null = null;
  if (dimKeys.length === 1) dimsM = dimList[0];
  else if (dimKeys.length > 1) {
    warnings.push(
      "Conflicting bus dimensions across earlier client emails: dimensions not propagated. Operator confirmation required.",
    );
  }

  if (unitWeightKg === null && dimsM === null) return { spec: null, warnings };

  const model = found.map((f) => f.specs.model).find((m) => m !== null) ?? null;
  const sourceEmailId = found.find((f) =>
    (unitWeightKg !== null && f.specs.unitWeightKg === unitWeightKg) ||
    (dimsM !== null && f.specs.dimsM !== null &&
      f.specs.dimsM.l === dimsM.l && f.specs.dimsM.w === dimsM.w &&
      f.specs.dimsM.h === dimsM.h)
  )?.id ?? found[0].id;

  return { spec: { model, dimsM, unitWeightKg, sourceEmailId }, warnings };
}

/** Une ligne cargo correspond-elle au bus/véhicule (cible de l'enrichissement) ? */
function isBusCargoLine(line: DerivedCargoLine): boolean {
  if (line.equipment.some((e) => /fr$/i.test(e.equipment_type))) return true;
  return new RegExp(`\\b${VEHICLE_RE}\\b`, "i").test(line.description ?? "");
}

/**
 * Helper PUR : enrichit la ligne bus d'un payload de base (issu du DERNIER
 * email) avec les specs stables des emails ANTÉRIEURS. Préserve quantité,
 * équipement et statut du dernier email. N'écrase jamais une valeur existante.
 * Calcule, si supporté par le schéma :
 *   - weight_kg = poids unitaire × pieces_count (quantité FINALE),
 *   - volume_cbm = L × W × H × pieces_count (après conversion en mètres).
 * Les dimensions/modèle bruts ne vont QUE dans un warning (pas de champ schéma).
 */
export function enrichCargoPayloadFromInboundEmailThread(
  base: DerivedPayload & { source_email_id: string | null },
  earlierEmails: EmailLike[],
): DerivedPayload & { source_email_id: string | null } {
  // Clone défensif : ne jamais muter l'entrée.
  const cargo_lines = base.cargo_lines.map((l) => ({ ...l, equipment: [...l.equipment] }));
  const warnings = [...base.warnings];
  const result = {
    ...base,
    cargo_lines,
    unallocated_equipment: [...base.unallocated_equipment],
    sources_used: [...base.sources_used],
    warnings,
  };

  const busLine = cargo_lines.find(isBusCargoLine);
  if (!busLine) return result;

  const { spec, warnings: specWarnings } = findMostRelevantBusSpecsFromThread(earlierEmails);
  warnings.push(...specWarnings);
  if (!spec) return result;

  // Quantité FINALE issue du dernier email (jamais la quantité antérieure).
  const pieces = busLine.pieces_count;
  if (typeof pieces !== "number" || !Number.isFinite(pieces) || pieces <= 0) {
    return result;
  }

  const details: string[] = [];
  let enriched = false;

  if (spec.unitWeightKg !== null && busLine.weight_kg === null) {
    busLine.weight_kg = round3(spec.unitWeightKg * pieces);
    details.push(`unit weight ${spec.unitWeightKg} kg × ${pieces}`);
    enriched = true;
  }
  if (spec.dimsM !== null && busLine.volume_cbm === null) {
    const { l, w, h } = spec.dimsM;
    busLine.volume_cbm = round3(l * w * h * pieces);
    details.push(`dimensions ${l}×${w}×${h} m × ${pieces}`);
    enriched = true;
  }

  if (enriched) {
    const modelPart = spec.model ? ` Model: ${spec.model}.` : "";
    const sourcePart = spec.sourceEmailId
      ? ` Source earlier inbound email: ${spec.sourceEmailId}.`
      : "";
    warnings.push(
      `Bus dimensions/weight propagated from earlier client email to final ${pieces} buses. ` +
        `Operator confirmation required.${modelPart}${sourcePart}` +
        (details.length ? ` (${details.join("; ")})` : ""),
    );
  }

  return result;
}

function sentAtMs(e: EmailLike): number {
  const t = e.sent_at ? Date.parse(e.sent_at) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
}

/**
 * Helper PUR : dérive le cargo depuis le THREAD entrant complet.
 *   - DERNIER email entrant → quantités/équipement finaux (Patch B/C/D).
 *   - emails ANTÉRIEURS → enrichissement specs bus (dimensions/poids).
 * Renvoie aussi latestEmailText pour que deriveCore applique la garde des
 * termes de révision sur le DERNIER email (comportement inchangé).
 */
export function deriveCargoPayloadFromInboundEmailThread(
  emails: EmailLike[],
): DerivedPayload & { source_email_id: string | null; latestEmailText: string } {
  const inbound = (emails ?? []).filter(
    (e): e is EmailLike => !!e && !isSodatraEmail(e.from_address ?? ""),
  );
  if (inbound.length === 0) {
    return {
      cargo_lines: [],
      unallocated_equipment: [],
      warnings: [],
      sources_used: [],
      source_email_id: null,
      latestEmailText: "",
    };
  }
  // Chronologie : tri ascendant par sent_at (null = plus ancien, ordre stable).
  const sorted = [...inbound].sort((a, b) => sentAtMs(a) - sentAtMs(b));
  const latest = sorted[sorted.length - 1];
  const earlier = sorted.slice(0, -1);

  const base = deriveCargoPayloadFromLatestInboundEmail(latest);
  const enriched = enrichCargoPayloadFromInboundEmailThread(base, earlier);
  const latestEmailText = normalizeEmailTextForParsing(latest.subject, latest.body_text).text;

  return { ...enriched, latestEmailText };
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
  // Phase 2-Q : OPTIONNEL (rétro-compat tests existants). Dernier email entrant.
  loadLatestInboundEmail?: (caseId: string, authHeader: string) => Promise<EmailLike | null>;
  // Phase 2-Q Patch E : OPTIONNEL. Thread entrant complet (enrichissement specs
  // bus depuis les emails antérieurs). Prioritaire sur loadLatestInboundEmail.
  loadInboundEmails?: (caseId: string, authHeader: string) => Promise<EmailLike[]>;
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

  // 5. Construction du payload dérivé (attachments)
  const derived = deriveCargoPayload(attachments);

  // 5-bis (Phase 2-Q). Source additionnelle READ-ONLY : dernier email entrant.
  // Fusion CONSERVATRICE : on AJOUTE le cargo dérivé de l'email (sans jamais
  // supprimer les données issues des attachments). Les warnings sont toujours
  // remontés ; le cargo n'est ajouté que si l'email exprime une révision
  // explicite (update/increase/additionally/added/now/total bus count).
  // Patch E : si le thread entrant complet est disponible (loadInboundEmails),
  // on dérive le cargo final depuis le DERNIER email entrant ET on enrichit la
  // ligne bus avec les specs (dimensions/poids) des emails ANTÉRIEURS. À défaut,
  // comportement Patch B/C/D inchangé (dernier email seul).
  let source_email_id: string | null = null;
  let emailDerived: (DerivedPayload & { source_email_id: string | null }) | null = null;
  let emailText = "";

  if (deps.loadInboundEmails) {
    const emails = await deps.loadInboundEmails(case_id, authHeader);
    const threadDerived = deriveCargoPayloadFromInboundEmailThread(emails);
    emailText = threadDerived.latestEmailText;
    emailDerived = threadDerived;
  } else if (deps.loadLatestInboundEmail) {
    const latestEmail = await deps.loadLatestInboundEmail(case_id, authHeader);
    if (latestEmail) {
      // Phase 2-Q Patch B : texte normalisé (base64 décodé en mémoire si besoin)
      // afin que la détection de termes de révision opère sur le texte lisible.
      emailText = normalizeEmailTextForParsing(
        latestEmail.subject,
        latestEmail.body_text,
      ).text;
      emailDerived = deriveCargoPayloadFromLatestInboundEmail(latestEmail);
    }
  }

  if (emailDerived) {
    // Warnings toujours remontés (préférer le warning à toute suppression).
    derived.warnings.push(...emailDerived.warnings);
    const emailHasCargo = emailDerived.cargo_lines.length > 0 ||
      emailDerived.unallocated_equipment.length > 0;
    if (emailHasCargo && hasRevisionTerms(emailText)) {
      // Ré-indexation des line_index à la suite des lignes existantes.
      for (const line of emailDerived.cargo_lines) {
        derived.cargo_lines.push({ ...line, line_index: derived.cargo_lines.length + 1 });
      }
      derived.unallocated_equipment.push(...emailDerived.unallocated_equipment);
      derived.sources_used.push(...emailDerived.sources_used);
      source_email_id = emailDerived.source_email_id;
    }
  }

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
    source_email_id,
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

/**
 * Phase 2-Q — dernier email ENTRANT du thread (client), READ-ONLY, user-scoped.
 * Exclut les emails SODATRA sortants/internes. Tri sent_at décroissant.
 * Jamais de service_role, jamais d'écriture.
 */
async function realLoadLatestInboundEmail(
  caseId: string,
  authHeader: string,
): Promise<EmailLike | null> {
  const client = userClient(authHeader);

  const { data: caseRow } = await client
    .from("quote_cases")
    .select("thread_id")
    .eq("id", caseId)
    .single();
  const threadId = (caseRow as { thread_id?: string | null } | null)?.thread_id ?? null;
  if (!threadId) return null;

  const { data: emails } = await client
    .from("emails")
    .select("id, subject, body_text, sent_at, from_address")
    .eq("thread_ref", threadId)
    .order("sent_at", { ascending: false });

  for (const e of (emails ?? []) as EmailLike[]) {
    if (isSodatraEmail(e.from_address ?? "")) continue; // ignore les sortants SODATRA
    return e;
  }
  return null;
}

/**
 * Phase 2-Q Patch E — emails ENTRANTS du thread (client), READ-ONLY, user-scoped.
 * Exclut les emails SODATRA sortants/internes. Tri sent_at ascendant (chronologie),
 * plafonné à 50 emails. Jamais de service_role, jamais d'écriture, jamais de RPC.
 */
async function realLoadInboundEmails(
  caseId: string,
  authHeader: string,
): Promise<EmailLike[]> {
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
    .select("id, subject, body_text, sent_at, from_address")
    .eq("thread_ref", threadId)
    .order("sent_at", { ascending: true })
    .limit(50);

  return ((emails ?? []) as EmailLike[]).filter(
    (e) => !isSodatraEmail(e.from_address ?? ""),
  );
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
      // Patch E : thread complet prioritaire (enrichissement specs bus). Le
      // loader « dernier email seul » reste disponible comme fallback.
      loadInboundEmails: realLoadInboundEmails,
      loadLatestInboundEmail: realLoadLatestInboundEmail,
      callCanonicalizer: realCallCanonicalizer,
    },
  );
}

// Ne démarre le serveur que comme module d'entrée (Lovable Cloud / Edge compatible), pas à l'import.
if (import.meta.main) {
  Deno.serve(handler);
}

export { FUNCTION_NAME, handler, CANONICALIZER_FUNCTION };
