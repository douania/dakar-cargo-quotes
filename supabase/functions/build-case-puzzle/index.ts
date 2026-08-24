/**
 * Phase A1: build-case-puzzle
 * Analyzes thread emails/attachments and populates facts/gaps
 * CTO Fix: Uses atomic supersede_fact RPC for fact updates
 * A1: AIR detection priority, cargo extraction, chargeable weight, incoterm fix
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { extractAndParseJSON } from "../_shared/json-parser.ts";
import {
  EXPORT_SEA_FREIGHT_PARTNER_GAP_KEY,
  EXPORT_SEA_FREIGHT_PARTNER_FACT_KEYS,
} from "../_shared/partner-gap-policy.ts";
// PAD-SCOPE-GAP: même décision pure et même résolution de périmètre que run-pricing.
import {
  type PadScopeFact,
  resolvePadScopeBlocker,
} from "../_shared/pad-scope-blocker.ts";
import {
  readOverridesFromFacts,
  resolveEffectiveServiceKeys,
} from "../_shared/service-scope.ts";

// --- SOURCE-GUARD-1: Identify outbound SODATRA emails ---
const SODATRA_DOMAINS = ['sodatra.sn', 'sodatra.com'];
function isSodatraEmail(email: string): boolean {
  const domain = (email || '').split('@')[1]?.toLowerCase();
  return SODATRA_DOMAINS.some(d => domain?.includes(d));
}

// --- SOURCE-GUARD-2: Provenance classification & monetary fact protection ---
type MessageProvenance = 'internal_sodatra' | 'partner' | 'client' | 'unknown';

function classifyEmailProvenance(
  fromAddress: string,
  clientEmail: string | null,
  partnerEmail: string | null
): MessageProvenance {
  if (isSodatraEmail(fromAddress)) return 'internal_sodatra';
  const from = fromAddress.toLowerCase();
  const fromDomain = from.split('@')[1];
  if (!fromDomain) return 'unknown';
  if (partnerEmail) {
    const partnerDomain = partnerEmail.split('@')[1]?.toLowerCase();
    if (partnerDomain && fromDomain === partnerDomain) return 'partner';
  }
  if (clientEmail) {
    const clientDomain = clientEmail.split('@')[1]?.toLowerCase();
    if (clientDomain && fromDomain === clientDomain) return 'client';
  }
  return 'unknown';
}

// Sensitive monetary facts: require proven client provenance
const SENSITIVE_MONETARY_FACTS = new Set([
  'cargo.freight_cost',
  'cargo.freight_currency',
  'cargo.value',
  'cargo.value_currency',
]);

// --- CLIENT-COMPANY-GUARD: Prevent SODATRA from being extracted as client ---
const SODATRA_CLIENT_COMPANY_BLOCKLIST = [
  "sodatra",
  "sodatra transit",
  "sodatra transit logistique",
  "sodatra transit logistique et immobilier",
  "sodatra shipping",
  "sodatra shipping & logistics",
  "sodatra shipping and logistics",
];

function normalizeCompanyName(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isSodatraCompanyName(value: unknown): boolean {
  const normalized = normalizeCompanyName(value);
  if (!normalized) return false;
  return SODATRA_CLIENT_COMPANY_BLOCKLIST.some((blocked) => {
    const b = normalizeCompanyName(blocked);
    return normalized === b || normalized.includes(b);
  });
}

// Internal document types that should not be scanned for cargo facts
const INTERNAL_DOC_TYPES = new Set([
  'quotation_draft', 'quotation_sent', 'internal_note',
  'devis', 'proforma_sent',
]);

// --- MIME Pre-Processing: strip base64/image noise before AI extraction ---
export function extractPlainTextFromMime(rawBody: string): string {
  if (!rawBody) return "";

  // 1. No MIME boundary → if the body is raw base64 (no MIME headers), decode it;
  //    otherwise return the truncated raw text unchanged. (EDGE-MIME-BASE64-FALLBACK-1:
  //    ported from src/lib/email/extractPlainTextFromMime.ts; Deno-native TextDecoder.)
  const boundaryMatch = rawBody.match(/boundary="?([^"\s;]+)"?/i);
  if (!boundaryMatch) {
    const stripped = rawBody.replace(/[\s\r\n]/g, "");
    const looksLikeBase64 = /^[A-Za-z0-9+/=]{40,}$/.test(stripped.slice(0, 200));

    if (looksLikeBase64) {
      try {
        // Keep only the leading valid base64 run (stop at first non-base64 char like - or _),
        // aligned to 4-char blocks so atob never fails on a mid-stream truncation.
        const b64Match = stripped.match(/^[A-Za-z0-9+/=]+/);
        const validB64 = b64Match ? b64Match[0] : stripped;
        const maxLen = Math.min(validB64.length, 8000);
        const safeChunk = validB64.slice(0, Math.floor(maxLen / 4) * 4);
        const bin = atob(safeChunk);
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        const decoded = new TextDecoder().decode(bytes);

        // If the decoded payload is HTML, strip tags and simple entities.
        if (decoded.includes("<html") || decoded.includes("<body") || decoded.includes("<div")) {
          return decoded
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'")
            .replace(/&nbsp;/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 4000);
        }
        return decoded.slice(0, 4000);
      } catch {
        // Not valid base64 → fall through to raw truncation (unchanged behaviour).
      }
    }

    return rawBody.slice(0, 4000);
  }

  const boundary = boundaryMatch[1];
  const parts = rawBody.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'));

  let plainText = "";
  let htmlText = "";

  for (const part of parts) {
    // Parse headers (first blank line separates headers from body)
    const headerEnd = part.indexOf("\r\n\r\n");
    const headerEnd2 = part.indexOf("\n\n");
    const splitIdx = headerEnd !== -1 ? headerEnd : headerEnd2;
    if (splitIdx === -1) continue;

    const headers = part.slice(0, splitIdx).toLowerCase();
    const content = part.slice(splitIdx).trim();

    // Skip image/* parts entirely
    if (headers.includes("content-type: image/") || headers.includes("content-type:image/")) {
      continue;
    }

    const isBase64 = headers.includes("content-transfer-encoding: base64") ||
                     headers.includes("content-transfer-encoding:base64");
    const isQP = headers.includes("content-transfer-encoding: quoted-printable") ||
                 headers.includes("content-transfer-encoding:quoted-printable");
    const isPlain = headers.includes("content-type: text/plain") || headers.includes("content-type:text/plain");
    const isHtml = headers.includes("content-type: text/html") || headers.includes("content-type:text/html");

    if (isPlain) {
      if (isBase64) {
        try {
          // Remove whitespace from base64 content before decoding
          const cleaned = content.replace(/\s/g, "");
          plainText = atob(cleaned);
        } catch {
          plainText = "";
        }
      } else if (isQP) {
        plainText = content
          .replace(/=\r?\n/g, "")
          .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      } else {
        plainText = content;
      }
    } else if (isHtml && !plainText) {
      let decoded = content;
      if (isBase64) {
        try {
          decoded = atob(content.replace(/\s/g, ""));
        } catch {
          decoded = "";
        }
      } else if (isQP) {
        decoded = content
          .replace(/=\r?\n/g, "")
          .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      }
      // Strip HTML tags and decode entities
      htmlText = decoded
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    // If we got good plainText, no need to continue
    if (plainText && plainText.length > 20) break;
  }

  // Priority: text/plain > stripped HTML > raw truncated
  const result = plainText || htmlText || rawBody.slice(0, 4000);
  return result.slice(0, 4000); // Global guard (CTO Correction 2)
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

// Mandatory facts by request type
const MANDATORY_FACTS: Record<string, string[]> = {
  SEA_FCL_IMPORT: [
    "routing.origin_port",
    "routing.destination_city",
    "cargo.description",
    "cargo.containers",
    "contacts.client_email",
  ],
  SEA_LCL_IMPORT: [
    "routing.origin_port",
    "routing.destination_city",
    "cargo.description",
    "cargo.weight_kg",
    "cargo.volume_cbm",
    "contacts.client_email",
  ],
  AIR_IMPORT: [
    "routing.destination_city",
    "cargo.weight_kg",
    "cargo.pieces_count",
    "contacts.client_email",
  ],
  // STRUCTURAL_PATCH_ALLOWED: Export Sénégal gap profile (2026-04-07)
  // Destination = port de déchargement, pas ville de livraison
  EXPORT_SENEGAL: [
    "routing.destination_port",
    "cargo.description",
    "cargo.containers",
    "contacts.client_email",
  ],
  // V4.2.2: Minimal universal facts for unknown transport mode
  UNKNOWN: [
    "routing.destination_city",
    "cargo.description",
    "contacts.client_email",
  ],
};

// For SEA_FCL_IMPORT, only these gaps are truly blocking (contextual blocking)
const SEA_FCL_BLOCKING_GAPS = new Set([
  "routing.destination_city",
  "cargo.description",
  "cargo.containers",
]);

// A1: AIR_IMPORT blocking gaps (CTO P0-3: reduced set)
const AIR_IMPORT_BLOCKING_GAPS = new Set([
  "routing.destination_city",
  "cargo.weight_kg",
  "cargo.pieces_count",
]);

// SEA_LCL_IMPORT blocking gaps
const SEA_LCL_BLOCKING_GAPS = new Set([
  "routing.destination_city",
  "cargo.description",
  "cargo.weight_kg",
  "cargo.volume_cbm",
]);

// STRUCTURAL_PATCH_ALLOWED: Export Sénégal blocking gaps (2026-04-07)
const EXPORT_SENEGAL_BLOCKING_GAPS = new Set([
  "routing.destination_port",
  "cargo.description",
]);

// EXPORT_SEA_FREIGHT_PARTNER_GAP_KEY and EXPORT_SEA_FREIGHT_PARTNER_FACT_KEYS are now
// centralized in ../_shared/partner-gap-policy.ts (imported above). Re-exported here to
// preserve existing imports/tests that read the gap key from build-case-puzzle.
export { EXPORT_SEA_FREIGHT_PARTNER_GAP_KEY };

// ── P0-3: DCQ-EMAIL-ATTACHMENT-GATE — qualification des PJ décisives ──
// Bloque le passage à READY_TO_PRICE si une PJ probablement décisive reste
// non analysée / vide / en erreur après le best-effort analyze-attachments.
// Helpers PURS (aucune dépendance DB), exportés pour tests ciblés.
const DECISIVE_ATTACHMENT_GAP_KEY = "documentation.unanalyzed_decisive_attachment";

interface DecisiveAttachmentInput {
  filename?: string | null;
  content_type?: string | null;
  extracted_text?: string | null;
  extracted_data?: unknown;
  is_analyzed?: boolean | null;
}

// Noms/extensions techniques à NE JAMAIS considérer comme décisifs
const NON_DECISIVE_FILENAME_PATTERN = /(^~\$)|(thumbs\.db$)|(\.ds_store$)|(\.tmp$)/i;
// Assets de signature / habillage email
const SIGNATURE_ASSET_PATTERN = /(logo|signature|banner|footer|spacer|facebook|instagram|linkedin|twitter|icon|avatar)/i;
// Images inline génériques (image001.png, image_12.jpg, …) sans signal documentaire
const GENERIC_INLINE_IMAGE_PATTERN = /^image[\s._-]?\d{2,}\.(png|jpe?g|gif|webp)$/i;

// Mots-clés métier décisifs (substring)
const DECISIVE_DOC_KEYWORDS = [
  'cotation', 'quotation', 'quote', 'devis', 'offer', 'offre',
  'proforma', 'pro forma', 'pro-forma',
  'packing', 'packing list', 'colisage',
  'invoice', 'facture', 'commercial invoice',
  'bill of lading', 'connaissement',
  'shipping instruction', 'shipment',
  'tariff', 'tarif',
];
// Tokens courts sujets aux faux positifs → match par frontière de mot
const DECISIVE_DOC_SHORT_TOKENS = ['rfq', 'pi', 'bl', 'rate'];

function filenameHasDecisiveKeyword(name: string): boolean {
  const lower = name.toLowerCase();
  if (DECISIVE_DOC_KEYWORDS.some((k) => lower.includes(k))) return true;
  return DECISIVE_DOC_SHORT_TOKENS.some((tok) =>
    new RegExp(`(^|[^a-z0-9])${tok}([^a-z0-9]|$)`, 'i').test(lower)
  );
}

function attExtension(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

// Une PJ est-elle probablement métier/décisive ?
function isDecisiveAttachmentCandidate(att: DecisiveAttachmentInput): boolean {
  const name = (att?.filename || '').trim();
  const ct = (att?.content_type || '').toLowerCase();
  if (!name && !ct) return false;

  // Exclusions dures : fichiers techniques + assets de signature/logo
  if (NON_DECISIVE_FILENAME_PATTERN.test(name)) return false;
  if (SIGNATURE_ASSET_PATTERN.test(name)) return false;

  const ext = attExtension(name);
  const isPdf = ext === 'pdf' || ct.includes('pdf');
  const isExcel =
    ext === 'xls' || ext === 'xlsx' || ct.includes('spreadsheet') || ct.includes('excel');
  const isImage = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) || ct.startsWith('image/');

  // PDF et Excel : décisifs par type
  if (isPdf || isExcel) return true;

  // Images documentaires : décisives uniquement si signal métier explicite
  if (isImage) {
    if (GENERIC_INLINE_IMAGE_PATTERN.test(name)) return false;
    return filenameHasDecisiveKeyword(name);
  }

  // Autres types (unsupported non métier) : non bloquants
  return false;
}

function attHasUsefulExtractedData(att: DecisiveAttachmentInput): boolean {
  const d = att?.extracted_data as any;
  if (!d || typeof d !== 'object') return false;
  if (d.type === 'error') return false;
  if (d.requires_reimport === true) return false;
  return Object.keys(d).length > 0;
}

function attHasUsefulText(att: DecisiveAttachmentInput): boolean {
  return typeof att?.extracted_text === 'string' && att.extracted_text.trim().length > 0;
}

// Une PJ décisive est-elle encore problématique (doit bloquer la tarification) ?
function isAttachmentAnalysisBlocking(att: DecisiveAttachmentInput): boolean {
  if (!isDecisiveAttachmentCandidate(att)) return false;
  const d = att?.extracted_data as any;
  if (!att?.is_analyzed) return true;
  if (d && typeof d === 'object' && d.type === 'error') return true;
  if (d && typeof d === 'object' && d.requires_reimport === true) return true;
  if (!attHasUsefulText(att) && !attHasUsefulExtractedData(att)) return true;
  return false;
}

// Décision PURE de réconciliation du gap (testable sans DB) :
//  - problème + pas de gap ouvert → créer
//  - problème + gap déjà ouvert   → no-op (idempotent, pas de doublon)
//  - plus de problème + gap ouvert → résoudre
//  - plus de problème + pas de gap → no-op
type DecisiveGapAction = "create" | "resolve" | "noop";
function decideDecisiveAttachmentGapAction(
  problematicCount: number,
  hasOpenGap: boolean
): DecisiveGapAction {
  if (problematicCount > 0) return hasOpenGap ? "noop" : "create";
  return hasOpenGap ? "resolve" : "noop";
}

export {
  isDecisiveAttachmentCandidate,
  isAttachmentAnalysisBlocking,
  decideDecisiveAttachmentGapAction,
  DECISIVE_ATTACHMENT_GAP_KEY,
};

// ── PAD-SCOPE-GAP : cohérence build-case-puzzle ↔ run-pricing ─────────────
// run-pricing refuse de chiffrer (PAD_CATEGORY_REQUIRED) quand le périmètre
// effectif contient un service portuaire PAD sans catégorie PAD et/ou sans
// tarif officiel strictement positif. build-case-puzzle annonçait pourtant
// READY_TO_PRICE dans cet état. On matérialise ici le même blocage, en
// réutilisant la MÊME décision pure (resolvePadScopeBlocker) et la MÊME
// résolution de périmètre (_shared/service-scope.ts) que run-pricing.
// Aucune auto-classification : le gap est opérateur/pricing, fail-closed.
const PAD_SCOPE_GAP_KEY = "pricing.pad_category";

// Questions alignées mot pour mot sur ../_shared/client-gap-policy.ts
// (GAP_QUESTION_MAP / GAP_QUESTION_MAP_EN, clé "pricing.pad_category").
const PAD_SCOPE_GAP_QUESTION_FR =
  "Pouvez-vous préciser la nature exacte de la marchandise ainsi que le poids brut total ? Ces informations sont nécessaires pour déterminer les droits de passage portuaires applicables.";
const PAD_SCOPE_GAP_QUESTION_EN =
  "Could you please specify the exact nature of the goods and the total gross weight? This information is required to determine the applicable port handling charges.";

/** Les mêmes clés que le SELECT de scope de run-pricing (index.ts §4). */
const PAD_SCOPE_FACT_KEYS = [
  "service.package",
  "service.overrides",
  "routing.incoterm",
  "cargo.hs_code",
  "cargo.pad_category",
  "pricing.pad_category",
  "cargo.pad_rate_fcfa_per_ton",
];

/**
 * Rejoue, à l'identique, ce que run-pricing calcule avant d'appeler
 * resolvePadScopeBlocker : servicePackage/incoterm depuis value_text, puis
 * effectiveServiceKeys = resolveEffectiveServiceKeys(pkg, readOverridesFromFacts(facts)).
 * Fonction PURE (aucune dépendance DB), exportée pour tests ciblés.
 */
function resolvePadScopeGapState(facts: PadScopeFact[]): {
  servicePackage: string;
  incoterm: string;
  effectiveServiceKeys: string[];
  blocker: ReturnType<typeof resolvePadScopeBlocker>;
} {
  const rows = facts || [];
  const servicePackageRaw = rows.find((fact) => fact?.fact_key === "service.package")?.value_text ?? "";
  const servicePackage = String(servicePackageRaw ?? "").trim().toUpperCase();
  const incotermRaw = rows.find((fact) => fact?.fact_key === "routing.incoterm")?.value_text ?? "";
  const incoterm = String(incotermRaw ?? "").trim().toUpperCase();

  const effectiveServiceKeys = resolveEffectiveServiceKeys(
    servicePackage,
    readOverridesFromFacts(rows),
  );
  const blocker = resolvePadScopeBlocker({
    facts: rows,
    servicePackage,
    effectiveServiceKeys,
    incoterm,
  });

  return { servicePackage, incoterm, effectiveServiceKeys, blocker };
}

export { resolvePadScopeGapState, PAD_SCOPE_GAP_KEY, PAD_SCOPE_FACT_KEYS };

// Gap questions
const GAP_QUESTIONS: Record<string, { fr: string; en: string; priority: string; category: string }> = {
  "routing.incoterm": {
    fr: "Quel Incoterm souhaitez-vous ? (FOB, CFR, CIF, DAP, DDP...)",
    en: "Which Incoterm do you prefer? (FOB, CFR, CIF, DAP, DDP...)",
    priority: "medium",
    category: "routing",
  },
  "routing.destination_city": {
    fr: "Quelle est la destination finale des marchandises ?",
    en: "What is the final destination of the goods?",
    priority: "critical",
    category: "routing",
  },
  "routing.destination_port": {
    fr: "Quel est le port de déchargement ?",
    en: "What is the port of discharge?",
    priority: "high",
    category: "routing",
  },
  "routing.origin_port": {
    fr: "Quel est le port d'origine ?",
    en: "What is the origin port?",
    priority: "critical",
    category: "routing",
  },
  "routing.origin_airport": {
    fr: "Quel est l'aéroport d'origine ?",
    en: "What is the origin airport?",
    priority: "critical",
    category: "routing",
  },
  "cargo.containers": {
    fr: "Merci de préciser type et nombre de conteneurs (ex: 2x40HC)",
    en: "Please specify container type and quantity (e.g., 2x40HC)",
    priority: "critical",
    category: "cargo",
  },
  "cargo.weight_kg": {
    fr: "Quel est le poids total en kg ?",
    en: "What is the total weight in kg?",
    priority: "high",
    category: "cargo",
  },
  "cargo.value": {
    fr: "Valeur déclarée des marchandises et devise ?",
    en: "Declared value of goods and currency?",
    priority: "medium",
    category: "cargo",
  },
  "cargo.description": {
    fr: "Pouvez-vous préciser la nature des marchandises ?",
    en: "Can you specify the nature of the goods?",
    priority: "medium",
    category: "cargo",
  },
  "cargo.pieces_count": {
    fr: "Combien de colis/pièces ?",
    en: "How many packages/pieces?",
    priority: "medium",
    category: "cargo",
  },
  "routing.transport_mode": {
    fr: "Quel mode de transport ? (Air / Maritime / Route)",
    en: "Which transport mode? (Air / Sea / Road)",
    priority: "critical",
    category: "routing",
  },
};

interface BuildPuzzleRequest {
  case_id?: string;
  force_refresh?: boolean;
  force_articles_detail?: boolean;
  mode?: "sync" | "start" | "poll" | "tick" | "cancel";
  job_id?: string;
}

interface ExtractedFact {
  key: string;
  category: string;
  value: string | number | object;
  valueType: "text" | "number" | "json" | "date";
  sourceType: string;
  sourceEmailId?: string;
  sourceAttachmentId?: string;
  sourceExcerpt?: string;
  confidence: number;
  isAssumption?: boolean;
}

type RoutingSide = "origin" | "destination";

interface SubjectGuardSignals {
  origin: string[];
  destination: string[];
}

interface SubjectGuardMatch {
  matched: boolean;
  reason?: string;
  matchedSubject?: string;
}

const SUBJECT_GUARD_AIRPORT_KEYS = new Set([
  "routing.origin_airport",
  "routing.destination_airport",
]);

const SUBJECT_GUARD_RELIABLE_ROUTING_KEYS = new Set([
  "routing.origin_port",
  "routing.origin_country",
  "routing.destination_city",
  "routing.destination_country",
]);

function truncateSubjectGuardText(value: string | null | undefined, max = 180): string {
  const text = (value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function routingSideForFactKey(key: string): RoutingSide | null {
  if (key.startsWith("routing.origin_")) return "origin";
  if (key.startsWith("routing.destination_")) return "destination";
  return null;
}

function stringifySubjectGuardValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function normalizeEmailSubjectForGuard(value: string | null | undefined): string {
  return (value || "")
    .replace(/^(?:\s*(?:subject|sujet|objet)\s*:\s*)+/i, "")
    .replace(/^(?:\s*(?:re|fw|fwd)\s*:\s*)+/i, "")
    .replace(/[\[\]()"']/g, " ")
    .replace(/[._/\\]+/g, " ")
    .replace(/\s*[-–—>]+\s*/g, " TO ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function getNormalizedEmailSubjectsForGuard(emails: any[]): string[] {
  const subjects = new Set<string>();
  for (const email of emails || []) {
    const normalized = normalizeEmailSubjectForGuard(email?.subject);
    if (normalized) subjects.add(normalized);
  }
  return Array.from(subjects);
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(left.split(/\s+/).filter(token => token.length > 1));
  const rightTokens = new Set(right.split(/\s+/).filter(token => token.length > 1));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection++;
  }
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

function looksLikeShortRouteSubject(excerpt: string): boolean {
  const compact = excerpt.replace(/\s+/g, " ").trim();
  if (!compact || compact.length > 100 || /[.!?]{1,}/.test(compact)) return false;

  const hasRouteSyntax =
    /\b[\p{L}][\p{L}' -]{2,}\s+(?:to|vers|->|>)\s+[\p{L}][\p{L}' -]{2,}\b/iu.test(compact) ||
    /\bfrom\s+[\p{L}][\p{L}' -]{2,}\s+to\s+[\p{L}][\p{L}' -]{2,}\b/iu.test(compact);
  const hasSubjectFreightTerm = /\b(?:air\s*freight|airfreight|sea\s*freight|seafreight|fcl|lcl)\b/i.test(compact);

  return hasRouteSyntax && (hasSubjectFreightTerm || compact.split(/\s+/).length <= 5);
}

function looksLikeSubjectOnlyExcerpt(sourceExcerpt: string | null | undefined): boolean {
  const excerpt = (sourceExcerpt || "").trim();
  if (!excerpt) return false;

  const lines = excerpt.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const compact = excerpt.replace(/\s+/g, " ").trim();
  const subjectMarker = /\b(?:subject|sujet|objet)\s*:/i.test(compact);
  const replyForwardOnly = /^(?:re|fw|fwd)\s*:/i.test(compact);

  if (!subjectMarker && !replyForwardOnly) return false;
  if (lines.length <= 2 && compact.length <= 240) return true;

  const nonSubjectLines = lines.filter(line =>
    !/^(?:subject|sujet|re|fw|fwd)\s*:/i.test(line)
  );
  return nonSubjectLines.length === 0;
}

function getStaleEmailSubjectMatch(
  sourceExcerpt: string | null | undefined,
  emails: any[]
): SubjectGuardMatch {
  const excerpt = (sourceExcerpt || "").trim();
  if (!excerpt) return { matched: false };

  if (looksLikeSubjectOnlyExcerpt(excerpt)) {
    return { matched: true, reason: "subject-marker" };
  }

  const lines = excerpt.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const compact = excerpt.replace(/\s+/g, " ").trim();
  const normalizedExcerpt = normalizeEmailSubjectForGuard(compact);
  const normalizedSubjects = getNormalizedEmailSubjectsForGuard(emails);

  for (const subject of normalizedSubjects) {
    if (!subject || !normalizedExcerpt) continue;
    const exactOrContained =
      normalizedExcerpt === subject ||
      normalizedExcerpt.includes(subject) ||
      (normalizedExcerpt.length >= 12 && subject.includes(normalizedExcerpt));
    if (exactOrContained || tokenSimilarity(normalizedExcerpt, subject) >= 0.8) {
      return { matched: true, reason: "email-subject-match", matchedSubject: subject };
    }
  }

  if (lines.length === 1 && looksLikeShortRouteSubject(compact)) {
    return { matched: true, reason: "short-route-subject" };
  }

  return { matched: false };
}

function looksLikeStaleEmailSubjectExcerpt(sourceExcerpt: string | null | undefined, emails: any[]): boolean {
  return getStaleEmailSubjectMatch(sourceExcerpt, emails).matched;
}

function collectSubjectGuardSignals(
  extractedFacts: ExtractedFact[],
  fullAttachmentContext: string,
  currentFacts: any[] = [],
  emails: any[] = []
): SubjectGuardSignals {
  const signals: SubjectGuardSignals = { origin: [], destination: [] };
  const addSignal = (side: RoutingSide, signal: string) => {
    const trimmed = signal.trim();
    if (trimmed && !signals[side].includes(trimmed)) signals[side].push(trimmed);
  };

  for (const fact of extractedFacts) {
    if (!SUBJECT_GUARD_RELIABLE_ROUTING_KEYS.has(fact.key)) continue;
    if (looksLikeStaleEmailSubjectExcerpt(fact.sourceExcerpt, emails)) continue;
    const side = routingSideForFactKey(fact.key);
    if (side) addSignal(side, `${fact.key}=${stringifySubjectGuardValue(fact.value)}`);
  }

  for (const fact of currentFacts || []) {
    if (fact?.source_type !== "attachment_extracted") continue;
    if (!SUBJECT_GUARD_RELIABLE_ROUTING_KEYS.has(fact.fact_key)) continue;
    const side = routingSideForFactKey(fact.fact_key);
    const value = fact.value_text ?? fact.value_number ?? fact.value_json;
    if (side) addSignal(side, `${fact.fact_key}=${stringifySubjectGuardValue(value)}`);
  }

  const context = (fullAttachmentContext || "").slice(0, 12000);
  if (/\b(?:pick\s*up address|pickup address|origin|origine|shipper|port of loading)\b/i.test(context)) {
    addSignal("origin", "attachment_context_origin_routing");
  }
  if (/\b(?:delivery address|destination|destinataire|consignee|port of discharge)\b/i.test(context)) {
    addSignal("destination", "attachment_context_destination_routing");
  }

  return signals;
}

function hasAirportCorroborationInAttachmentContext(value: unknown, fullAttachmentContext: string): boolean {
  const airportValue = stringifySubjectGuardValue(value).trim();
  if (!airportValue || !fullAttachmentContext) return false;

  const escaped = airportValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const airportNearValue = new RegExp(`\\b(?:airport|aeroport|aéroport)\\b.{0,80}\\b${escaped}\\b|\\b${escaped}\\b.{0,80}\\b(?:airport|aeroport|aéroport)\\b`, "i");
  return airportNearValue.test(fullAttachmentContext);
}

function shouldBlockSubjectAirportFact(
  fact: ExtractedFact | any,
  fullAttachmentContext: string,
  signals: SubjectGuardSignals,
  emails: any[] = []
): boolean {
  if (!SUBJECT_GUARD_AIRPORT_KEYS.has(fact.key || fact.fact_key)) return false;

  const sourceExcerpt = fact.sourceExcerpt ?? fact.source_excerpt;
  if (!looksLikeStaleEmailSubjectExcerpt(sourceExcerpt, emails)) return false;

  const side = routingSideForFactKey(fact.key || fact.fact_key);
  if (!side || signals[side].length === 0) return false;

  const value = fact.value ?? fact.value_text ?? fact.value_number ?? fact.value_json;
  return !hasAirportCorroborationInAttachmentContext(value, fullAttachmentContext);
}

function filterSubjectContaminatedRoutingFacts(
  extractedFacts: ExtractedFact[],
  fullAttachmentContext: string,
  currentFacts: any[] = [],
  emails: any[] = []
): ExtractedFact[] {
  const signals = collectSubjectGuardSignals(extractedFacts, fullAttachmentContext, currentFacts, emails);

  return extractedFacts.filter(fact => {
    if (!shouldBlockSubjectAirportFact(fact, fullAttachmentContext, signals, emails)) return true;

    const side = routingSideForFactKey(fact.key);
    const subjectMatch = getStaleEmailSubjectMatch(fact.sourceExcerpt, emails);
    console.log(`[SUBJECT-GUARD] blocked ${fact.key} from stale subject; source_excerpt="${truncateSubjectGuardText(fact.sourceExcerpt)}"; matched_subject="${subjectMatch.matchedSubject || subjectMatch.reason || "n/a"}"; signals=${JSON.stringify(side ? signals[side] : [])}`);
    return false;
  });
}

async function deactivateSubjectContaminatedCurrentAirportFacts(
  serviceClient: any,
  caseId: string,
  currentFacts: any[],
  fullAttachmentContext: string,
  extractedFacts: ExtractedFact[],
  emails: any[] = []
): Promise<number> {
  const signals = collectSubjectGuardSignals(extractedFacts, fullAttachmentContext, currentFacts, emails);
  let deactivated = 0;

  for (const fact of currentFacts || []) {
    if (!SUBJECT_GUARD_AIRPORT_KEYS.has(fact.fact_key)) continue;
    if (fact.source_type === "attachment_extracted" || MANUAL_PROTECTED_SOURCES.has(fact.source_type ?? "")) continue;

    if (!shouldBlockSubjectAirportFact(fact, fullAttachmentContext, signals, emails)) continue;

    const { error } = await serviceClient
      .from("quote_facts")
      .update({ is_current: false, updated_at: new Date().toISOString() })
      .eq("id", fact.id)
      .eq("case_id", caseId);

    if (error) {
      console.error(`[SUBJECT-GUARD] failed to deactivate stale current airport fact ${fact.fact_key}:`, error.message);
      continue;
    }

    const side = routingSideForFactKey(fact.fact_key);
    const subjectMatch = getStaleEmailSubjectMatch(fact.source_excerpt, emails);
    console.log(`[SUBJECT-GUARD] deactivated stale current airport fact ${fact.fact_key}; source_excerpt="${truncateSubjectGuardText(fact.source_excerpt)}"; matched_subject="${subjectMatch.matchedSubject || subjectMatch.reason || "n/a"}"; signals=${JSON.stringify(side ? signals[side] : [])}`);
    deactivated++;
  }

  return deactivated;
}

// --- M3.4: Attachment-to-fact deterministic mapping ---
const ATTACHMENT_FACT_MAPPING: Record<string, { factKey: string; category: string; valueType: 'text' | 'number' }> = {
  // Format 1: extracted_info keys (packing lists, B/L)
  'Port_of_Loading': { factKey: 'routing.origin_port', category: 'routing', valueType: 'text' },
  'Port_of_Discharge': { factKey: 'routing.destination_port', category: 'routing', valueType: 'text' },
  'Description_of_Goods': { factKey: 'cargo.description', category: 'cargo', valueType: 'text' },
  'Consignment_Description': { factKey: 'cargo.description', category: 'cargo', valueType: 'text' },
  'Gross_Weight': { factKey: 'cargo.weight_kg', category: 'cargo', valueType: 'number' },
  'HS_Code': { factKey: 'cargo.hs_code', category: 'cargo', valueType: 'text' },
  'Vessel': { factKey: 'transport.vessel', category: 'transport', valueType: 'text' },
  'B_L_No': { factKey: 'transport.bl_number', category: 'transport', valueType: 'text' },
  'Carrier': { factKey: 'transport.carrier', category: 'transport', valueType: 'text' },
  'Temperature_Setting': { factKey: 'cargo.temperature', category: 'cargo', valueType: 'text' },
  'Consignee': { factKey: 'contacts.consignee', category: 'contacts', valueType: 'text' },
  'Shipper': { factKey: 'contacts.shipper', category: 'contacts', valueType: 'text' },
  'Number_and_Kind_of_Packages': { factKey: 'cargo.containers', category: 'cargo', valueType: 'text' },
  'Container_Nos': { factKey: 'cargo.container_numbers', category: 'cargo', valueType: 'text' },
  // Format 2: flat keys from analyze-attachments (quotations, MSDS)
  'codes_hs': { factKey: 'cargo.hs_code', category: 'cargo', valueType: 'text' },
  'valeur_caf': { factKey: 'cargo.value', category: 'cargo', valueType: 'number' },
  'poids_brut_kg': { factKey: 'cargo.weight_kg', category: 'cargo', valueType: 'number' },
  'poids_net_kg': { factKey: 'cargo.weight_net_kg', category: 'cargo', valueType: 'number' },
  'volume_cbm': { factKey: 'cargo.volume_cbm', category: 'cargo', valueType: 'number' },
  'origine': { factKey: 'routing.origin_port', category: 'routing', valueType: 'text' },
  'destination': { factKey: 'routing.destination_city', category: 'routing', valueType: 'text' },
  'destination_city': { factKey: 'routing.destination_city', category: 'routing', valueType: 'text' },
  'destination_country': { factKey: 'routing.destination_country', category: 'routing', valueType: 'text' },
  'origine_country': { factKey: 'routing.origin_country', category: 'routing', valueType: 'text' },
  'incoterm': { factKey: 'routing.incoterm', category: 'routing', valueType: 'text' },
  'fournisseur': { factKey: 'contacts.shipper', category: 'contacts', valueType: 'text' },
  'devise': { factKey: 'cargo.value_currency', category: 'cargo', valueType: 'text' },
  // Variantes de clés produites par analyze-attachments (COMPOSITE-DOC-1 / patch build-case-puzzle)
  'total_weight_kg': { factKey: 'cargo.weight_kg', category: 'cargo', valueType: 'number' },
  'vessel_name': { factKey: 'transport.vessel', category: 'transport', valueType: 'text' },
  'bl_number': { factKey: 'transport.bl_number', category: 'transport', valueType: 'text' },
  'number_of_packages': { factKey: 'cargo.pieces_count', category: 'cargo', valueType: 'number' },
  'customer_name': { factKey: 'contacts.client_company', category: 'contacts', valueType: 'text' },
  'supplier_name': { factKey: 'contacts.shipper', category: 'contacts', valueType: 'text' },
};

// --- M3.5.1: Assumption rules by flow type ---
const ASSUMPTION_RULES: Record<string, Array<{ key: string; value: string; confidence: number }>> = {
  TRANSIT_GAMBIA: [
    { key: 'service.package', value: 'TRANSIT_GAMBIA_ALL_IN', confidence: 0.7 },
    { key: 'pricing.currency', value: 'USD', confidence: 0.7 },
    { key: 'other.border_fee_expected', value: 'true', confidence: 0.6 },
  ],
  EXPORT_SENEGAL: [
    { key: 'service.package', value: 'EXPORT_SENEGAL', confidence: 0.6 },
    { key: 'pricing.vat_rate', value: '0.18', confidence: 0.6 },
  ],
  BREAKBULK_PROJECT: [
    { key: 'service.package', value: 'BREAKBULK_PROJECT', confidence: 0.7 },
    { key: 'survey.required', value: 'true', confidence: 0.6 },
  ],
  IMPORT_PROJECT_DAP: [
    { key: 'service.package', value: 'DAP_PROJECT_IMPORT', confidence: 0.7 },
    { key: 'regulatory.dpi_expected', value: 'true', confidence: 0.6 },
  ],
  // A1: AIR_IMPORT assumptions
  AIR_IMPORT: [
    { key: 'service.package', value: 'AIR_IMPORT_DAP', confidence: 0.7 },
    { key: 'regulatory.dpi_expected', value: 'true', confidence: 0.6 },
  ],
  // LCL import assumptions
  SEA_LCL_IMPORT: [
    { key: 'service.package', value: 'LCL_IMPORT_DAP', confidence: 0.7 },
    { key: 'regulatory.dpi_expected', value: 'true', confidence: 0.6 },
  ],
  // STRUCTURAL_PATCH: Transit régional via Dakar vers pays enclavés
  TRANSIT_REGIONAL_VIA_DAKAR: [
    { key: 'service.package', value: 'TRANSIT_REGIONAL_VIA_DAKAR', confidence: 0.7 },
    { key: 'border.fee_expected', value: 'true', confidence: 0.6 },
  ],
  // P3a: EXW/FCA/FAS incoterm-aware variants
  IMPORT_PROJECT_DAP_EXW: [
    { key: 'service.package', value: 'DAP_PROJECT_IMPORT_EXW', confidence: 0.7 },
    { key: 'regulatory.dpi_expected', value: 'true', confidence: 0.6 },
  ],
  AIR_IMPORT_EXW: [
    { key: 'service.package', value: 'AIR_IMPORT_EXW', confidence: 0.7 },
    { key: 'regulatory.dpi_expected', value: 'true', confidence: 0.6 },
  ],
  SEA_LCL_IMPORT_EXW: [
    { key: 'service.package', value: 'LCL_IMPORT_EXW', confidence: 0.7 },
    { key: 'regulatory.dpi_expected', value: 'true', confidence: 0.6 },
  ],
  // Package-DDP micro-lot: variantes DDP (alias service-identiques des DAP).
  // La différence DAP/DDP reste portée par routing.incoterm + blockers DDP + logique customs.
  IMPORT_PROJECT_DAP_DDP: [
    { key: 'service.package', value: 'DDP_PROJECT_IMPORT', confidence: 0.7 },
    { key: 'regulatory.dpi_expected', value: 'true', confidence: 0.6 },
  ],
  AIR_IMPORT_DDP: [
    { key: 'service.package', value: 'AIR_IMPORT_DDP', confidence: 0.7 },
    { key: 'regulatory.dpi_expected', value: 'true', confidence: 0.6 },
  ],
  SEA_LCL_IMPORT_DDP: [
    { key: 'service.package', value: 'LCL_IMPORT_DDP', confidence: 0.7 },
    { key: 'regulatory.dpi_expected', value: 'true', confidence: 0.6 },
  ],
};

export { ASSUMPTION_RULES };

// --- COMPOSITE-DOC-2: Document-type priority table for documents[] pre-pass ---
const DOC_TYPE_PRIORITY: Record<string, string[]> = {
  'transport.vessel':          ['bill_of_lading', 'transit_order'],
  'transport.bl_number':       ['bill_of_lading', 'transit_order'],
  'cargo.weight_kg':           ['packing_list', 'bill_of_lading', 'transit_order'],
  'cargo.pieces_count':        ['packing_list', 'bill_of_lading', 'transit_order'],
  'contacts.shipper':          ['bill_of_lading', 'commercial_invoice'],
  'contacts.client_company':   ['commercial_invoice', 'transit_order'],
  'cargo.value':               ['commercial_invoice', 'customs_financial_statement'],
  'cargo.value_currency':      ['commercial_invoice', 'customs_financial_statement'],
  'cargo.freight_cost':        ['commercial_invoice', 'customs_financial_statement'],
  'cargo.freight_currency':    ['commercial_invoice', 'customs_financial_statement'],
};

// S4: Canonical set for human-entered sources (legacy + current)
const MANUAL_PROTECTED_SOURCES = new Set(['operator', 'manual_input']);

// Sources that cannot be overwritten by assumptions
const ASSUMPTION_PROTECTED_SOURCES = new Set([
  ...MANUAL_PROTECTED_SOURCES,
  'attachment_extracted',
  'ai_extraction',
]);

// --- M3.5.1 Fix: PORT_COUNTRY_MAP for country resolution from ports/cities ---
const PORT_COUNTRY_MAP: Record<string, string> = {
  'DAKAR': 'SN', 'DKR': 'SN',
  'BANJUL': 'GM', 'BJL': 'GM',
  'ABIDJAN': 'CI', 'ABJ': 'CI',
  'CONAKRY': 'GN', 'CKY': 'GN',
  'BAMAKO': 'ML', 'BKO': 'ML',
  'TEMA': 'GH', 'LOME': 'TG', 'LFW': 'TG',
  'COTONOU': 'BJ', 'LAGOS': 'NG', 'APAPA': 'NG',
  'NOUAKCHOTT': 'MR', 'OUAGADOUGOU': 'BF', 'NIAMEY': 'NE',
  'DAMMAM': 'SA', 'JEDDAH': 'SA', 'JED': 'SA', 'RIYADH': 'SA',
  'SHANGHAI': 'CN', 'NINGBO': 'CN', 'SHENZHEN': 'CN', 'QINGDAO': 'CN',
  'LE HAVRE': 'FR', 'MARSEILLE': 'FR', 'FOS': 'FR',
  'ANVERS': 'BE', 'ANTWERP': 'BE',
  'ISTANBUL': 'TR', 'MERSIN': 'TR',
  'MUMBAI': 'IN', 'NHAVA SHEVA': 'IN', 'MUNDRA': 'IN', 'CHENNAI': 'IN', 'KOLKATA': 'IN',
  'CHITTAGONG': 'BD', 'COLOMBO': 'LK',
  'DUBAI': 'AE', 'JEBEL ALI': 'AE', 'KHALIFA': 'AE', 'KHORFAKKAN': 'AE', 'KHOR FAKKAN': 'AE', 'FUJAIRAH': 'AE', 'ABU DHABI': 'AE',
  'HAMBURG': 'DE', 'ROTTERDAM': 'NL',
};

// =============================================================================
// HS10-AUTO-INJECTION-GUARD Phase 2 (Option C v3) — helpers
// Doctrine : DEFERRED_BACKLOG.md L35-36 + memory HS Code Governance.
// Auto-write cargo.hs_code autorisé uniquement si TOUS les critères passent :
//   1. sourceLen === 10
//   2. resolveSenegalHsCode === "unique"
//   3. cohérence cross-source (uniqueCodes.length === 1)
//   4. SH6 : 1 seul couple DD/TVA, dd!=null, tva!=null
//   5. source labellisée HS (hs_label, code_douanier, parenthesized w/ contexte)
// Sinon : suggestion HS10_CLASSIFICATION_SUGGESTION + GAP cargo.hs_code
// (criticité respectée : DDP / customs.regime_code → blocking, sinon non-blocking).
// =============================================================================

type HsAutoInjectionContext = "parenthesized" | "hs_label" | "code_douanier" | "iso_10digit" | "cargo_line";

function isLabeledHsContext(ctx: HsAutoInjectionContext, excerpt?: string): boolean {
  if (ctx === "hs_label" || ctx === "code_douanier") return true;
  if (ctx === "parenthesized") {
    if (!excerpt) return false;
    return /\b(cargo|description|marchandise|goods|commodity|hs|hscode)\b/i.test(excerpt);
  }
  // iso_10digit, cargo_line → jamais auto-write (interdit doctrine v3)
  return false;
}

async function checkSh6RateDivergence(
  serviceClient: any,
  sh6: string,
): Promise<{
  divergent: boolean;
  distinctRates: Array<{ dd: number | null; tva: number | null }>;
  candidatesCount: number;
  hasNullRate: boolean;
}> {
  const { data: rows } = await serviceClient
    .from("hs_codes")
    .select("code_normalized, dd, tva")
    .like("code_normalized", `${sh6}%`)
    .limit(200);
  if (!rows || rows.length === 0) {
    return { divergent: false, distinctRates: [], candidatesCount: 0, hasNullRate: false };
  }
  const seen = new Map<string, { dd: number | null; tva: number | null }>();
  let hasNullRate = false;
  for (const r of rows) {
    if (r.dd === null || r.tva === null) hasNullRate = true;
    const key = `${r.dd ?? "null"}|${r.tva ?? "null"}`;
    if (!seen.has(key)) seen.set(key, { dd: r.dd ?? null, tva: r.tva ?? null });
  }
  const distinctRates = [...seen.values()];
  return {
    divergent: distinctRates.length > 1,
    distinctRates,
    candidatesCount: rows.length,
    hasNullRate,
  };
}

async function hs10AutoInjectionGuardAllows(
  serviceClient: any,
  args: {
    code10: string;
    source_context: HsAutoInjectionContext;
    source_excerpt?: string;
  },
): Promise<{
  allowed: boolean;
  sh6: string;
  reason: string;
  distinctRatesCount: number;
}> {
  const sh6 = args.code10.substring(0, 6);

  // Critère 5 : labellisation
  if (!isLabeledHsContext(args.source_context, args.source_excerpt)) {
    return {
      allowed: false, sh6,
      reason: `unlabeled_source_context (ctx=${args.source_context})`,
      distinctRatesCount: 0,
    };
  }

  // Critère 4 : taux DD/TVA SH6
  const div = await checkSh6RateDivergence(serviceClient, sh6);
  if (div.candidatesCount === 0) {
    return { allowed: false, sh6, reason: "no_sh6_candidates", distinctRatesCount: 0 };
  }
  if (div.divergent) {
    return {
      allowed: false, sh6,
      reason: `dd_tva_divergence_within_sh6 (distinct_rates=${div.distinctRates.length})`,
      distinctRatesCount: div.distinctRates.length,
    };
  }
  if (div.distinctRates.length !== 1
      || div.distinctRates[0].dd === null
      || div.distinctRates[0].tva === null) {
    return {
      allowed: false, sh6,
      reason: "missing_dd_tva_for_sh6",
      distinctRatesCount: div.distinctRates.length,
    };
  }

  return { allowed: true, sh6, reason: "all_criteria_passed", distinctRatesCount: 1 };
}

async function emitHs10AutoInjectionTrace(
  serviceClient: any,
  args: {
    case_id: string;
    code10: string;
    sh6: string;
    origin: "document_regex" | "email_regex";
    source_label: string;
    source_context: HsAutoInjectionContext;
    confidence: number;
    distinct_rates_count: number;
  },
): Promise<void> {
  try {
    await serviceClient.from("case_timeline_events").insert({
      case_id: args.case_id,
      event_type: "manual_action",
      actor_type: "system",
      event_data: {
        action_code: "HS10_AUTO_INJECTION",
        status: "trace",
        code10: args.code10,
        sh6: args.sh6,
        origin: args.origin,
        source_label: args.source_label,
        source_context: args.source_context,
        confidence: args.confidence,
        distinct_rates_count: args.distinct_rates_count,
        criteria_passed: ["sourceLen10", "resolveUnique", "crossSourceCoherent",
                          "noDdTvaDivergenceAndComplete", "labeledSource"],
        doctrine: "HS10-AUTO-INJECTION-GUARD Option C v3",
      },
    });
  } catch (err) {
    console.warn(`[hs10-guard] emitHs10AutoInjectionTrace failed (non-blocking): ${err}`);
  }
}

// v3 : criticité gap respectée (DDP / régime douanier → blocking).
// Fact keys vérifiées dans ce projet : routing.incoterm, customs.regime_code.
async function assessHsCodeGapBlocking(
  serviceClient: any,
  case_id: string,
): Promise<{ is_blocking: boolean; reason: string }> {
  try {
    const { data: facts } = await serviceClient
      .from("quote_facts")
      .select("fact_key, value_text")
      .eq("case_id", case_id)
      .eq("is_current", true)
      .in("fact_key", ["routing.incoterm", "customs.regime_code"]);

    const factMap = new Map<string, string | null>();
    for (const f of facts ?? []) factMap.set(f.fact_key, (f.value_text ?? null) as string | null);

    const incoterm = (factMap.get("routing.incoterm") ?? "").toUpperCase();
    const regime = (factMap.get("customs.regime_code") ?? "").toUpperCase();

    if (incoterm === "DDP") {
      return { is_blocking: true, reason: "incoterm=DDP" };
    }
    if (regime && regime !== "NONE") {
      return { is_blocking: true, reason: `customs_regime=${regime}` };
    }
    return { is_blocking: false, reason: "no_criticality_signal" };
  } catch (err) {
    console.warn(`[hs10-guard] assessHsCodeGapBlocking failed, defaulting non-blocking: ${err}`);
    return { is_blocking: false, reason: "fallback_safe_default" };
  }
}

// --- HS Code Resolution: SH6 → 10 digits Sénégal (UEMOA) ---
async function resolveSenegalHsCode(
  serviceClient: any,
  rawDigits: string
): Promise<
  | { status: "unique"; code10: string; description: string | null }
  | { status: "ambiguous"; candidates: Array<{ code10: string; description: string | null }> }
  | { status: "not_found" }
> {
  const digitsOnly = rawDigits.replace(/\D/g, "");
  if (digitsOnly.length < 6) return { status: "not_found" };

  // 1. Try exact 10-digit match
  if (digitsOnly.length >= 10) {
    const code10 = digitsOnly.substring(0, 10);
    const { data } = await serviceClient
      .from("hs_codes")
      .select("code_normalized, description")
      .eq("code_normalized", code10)
      .limit(1)
      .maybeSingle();
    if (data) {
      return { status: "unique", code10: data.code_normalized, description: data.description };
    }
    // Fall through to SH6 lookup
  }

  // 2. SH6 prefix lookup
  const sh6 = digitsOnly.substring(0, 6);
  const { data: rows } = await serviceClient
    .from("hs_codes")
    .select("code_normalized, description")
    .like("code_normalized", `${sh6}%`)
    .order("code_normalized")
    .limit(20);

  if (!rows || rows.length === 0) return { status: "not_found" };
  if (rows.length === 1) {
    return { status: "unique", code10: rows[0].code_normalized, description: rows[0].description };
  }
  return {
    status: "ambiguous",
    candidates: rows.map((r: any) => ({ code10: r.code_normalized, description: r.description })),
  };
}

// --- Deterministic HS code extraction from free text (regex) ---
//
// DCQ-P0-HS10-SAFE-SUGGESTION-AND-EXEMPTION (v3):
//  - Patterns restreints au CONTEXTE explicite (parenthèses, label HS/SH/Code Douanier, ligne cargo).
//  - Le pattern global "8 chiffres isolés" est REJETÉ (capterait dates/références).
//  - Retourne maintenant aussi sourceLen pour permettre aux callers de refuser la promotion HS6/HS8 → HS10.
//
export interface HsExtractionMatch {
  digits: string;          // normalisé (sourceLen chiffres exactement, jamais tronqué)
  sourceLen: 6 | 8 | 10;
  context: "parenthesized" | "hs_label" | "code_douanier" | "iso_10digit" | "cargo_line";
  // HS10-RANKING-CONTEXT-ENRICHMENT v2 : extrait ±80 chars autour du match
  // (utilisé uniquement par le prompt IA de ranking ; jamais persisté en DB,
  // jamais utilisé pour la résolution/promotion HS10).
  excerpt?: string;
}

type HsTokenMatch = {
  raw: string;
  digits: string;
  index: number;
  length: number;
};

const HS_TOKEN_REGEX = /(?<!\d)(\d{4}\.\d{2}(?:\.\d{2})?(?:\.\d{2})?|\d{4}\s+\d{2}(?:\s+\d{2})?(?:\s+\d{2})?|\d{10}|\d{8}|\d{6})(?!\d)/g;

function extractHsTokenMatches(value: string): HsTokenMatch[] {
  const out: HsTokenMatch[] = [];
  const seen = new Set<string>();
  for (const m of String(value || "").matchAll(HS_TOKEN_REGEX)) {
    const raw = m[1];
    const digits = raw.replace(/\D/g, "");
    if (digits.length !== 6 && digits.length !== 8 && digits.length !== 10) continue;
    if (seen.has(digits)) continue;
    seen.add(digits);
    out.push({
      raw,
      digits,
      index: m.index ?? 0,
      length: m[0].length,
    });
  }
  return out;
}

export function extractHsCodesFromTextDetailed(text: string): HsExtractionMatch[] {
  const out: HsExtractionMatch[] = [];
  const seen = new Set<string>();

  // Helper : extrait ±80 chars autour d'un index dans une source donnée
  function makeExcerpt(source: string, idx: number, matchLen: number): string {
    const start = Math.max(0, idx - 80);
    const end = Math.min(source.length, idx + matchLen + 80);
    return source.slice(start, end).replace(/\s+/g, " ").trim();
  }

  function push(digitsRaw: string, ctx: HsExtractionMatch["context"], excerpt?: string) {
    const d = digitsRaw.replace(/\D/g, "");
    if (d.length !== 6 && d.length !== 8 && d.length !== 10) return;
    const key = `${d}|${ctx}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      digits: d,
      sourceLen: d.length as 6 | 8 | 10,
      context: ctx,
      excerpt: excerpt ? excerpt.slice(0, 240) : undefined,
    });
  }

  // 1. Codes parenthésés 6/8/10 chiffres — ex "(73089000)"
  for (const m of text.matchAll(/\(\s*(\d{6}|\d{8}|\d{10})\s*\)/g)) {
    push(m[1], "parenthesized", makeExcerpt(text, m.index ?? 0, m[0].length));
  }
  // 2. Labels HS/SH (avec ou sans dots, 6/8/10 chiffres), y compris plusieurs codes sur la ligne.
  for (const lineMatch of text.matchAll(/[^\r\n]+/g)) {
    const line = lineMatch[0];
    const label = /\b(?:HS|SH)\s*(?:codes?)?\s*:?/i.exec(line);
    if (!label) continue;
    const afterLabel = line.slice(label.index + label[0].length);
    const lineExcerpt = makeExcerpt(text, lineMatch.index ?? 0, line.length);
    for (const token of extractHsTokenMatches(afterLabel)) {
      push(token.raw, "hs_label", lineExcerpt);
    }
  }
  // 3. "Code Douanier" — fournisseurs FR
  for (const m of text.matchAll(/Code\s*Douanier\s*:?\s*(\d{6,10})/gi)) {
    push(m[1], "code_douanier", makeExcerpt(text, m.index ?? 0, m[0].length));
  }
  // 4. Code 10 chiffres formaté "4.2.2.2"
  for (const m of text.matchAll(/(\d{4}\.\d{2}\.\d{2}\.\d{2})/g)) {
    push(m[1], "iso_10digit", makeExcerpt(text, m.index ?? 0, m[0].length));
  }
  // 5. Bloc isolé de 10 chiffres
  for (const m of text.matchAll(/(?<!\d)(\d{10})(?!\d)/g)) {
    push(m[1], "iso_10digit", makeExcerpt(text, m.index ?? 0, m[0].length));
  }
  // 6. Contexte "cargo line" — 6/8 chiffres dans une ligne mentionnant cargo/description/marchandise/goods/commodity/product
  const lines = text.split(/\r?\n/);
  for (const ln of lines) {
    if (!/cargo|description|marchandise|goods|commodity|product/i.test(ln)) continue;
    for (const m of ln.matchAll(/(?<!\d)(\d{6}|\d{8})(?!\d)/g)) {
      // Pour cargo_line, l'extrait est la ligne entière (déjà sémantiquement riche)
      push(m[1], "cargo_line", ln.replace(/\s+/g, " ").trim().slice(0, 240));
    }
  }
  // ⚠️ PAS de pattern "8 chiffres isolés global" — interdit (capturerait dates/refs)
  return out;
}

// Wrapper rétrocompatible — renvoie uniquement les codes 10 chiffres validables sans contexte sensible.
// (Conservé pour compat avec d'éventuels appelants externes ; non utilisé dans le pipeline.)
function extractHsCodesFromText(text: string): string[] {
  const detailed = extractHsCodesFromTextDetailed(text);
  return [...new Set(detailed.map((m) => m.digits))];
}

// --- DCQ-P0-HS10-SAFE-SUGGESTION-AND-EXEMPTION (v3) ---
// Helper: charger les détails tarifaires (DD/TVA + description) d'un set de codes HS10
async function loadHsCandidatesDetails(
  serviceClient: any,
  codes10: string[],
): Promise<Array<{ code10: string; description: string | null; dd: number | null; tva: number | null }>> {
  if (!codes10.length) return [];
  const { data } = await serviceClient
    .from("hs_codes")
    .select("code_normalized, description, dd, tva")
    .in("code_normalized", codes10);
  const byCode = new Map<string, any>((data || []).map((r: any) => [r.code_normalized, r]));
  return codes10.map((c) => {
    const r = byCode.get(c);
    return {
      code10: c,
      description: r?.description ?? null,
      dd: r?.dd != null ? Number(r.dd) : null,
      tva: r?.tva != null ? Number(r.tva) : null,
    };
  });
}

// Helper: classement IA (best-effort, jamais bloquant)
// HS10-RANKING-CONTEXT-ENRICHMENT v2 :
// Le prompt reçoit maintenant explicitement cargoDescription, sourceExcerpt,
// clientName et documentSource. Aucun changement de modèle ni de timeout.
// Aucune écriture cargo.hs_code, aucun impact sur la résolution/promotion HS10.
async function rankHsCandidatesWithAI(args: {
  cargoDescription: string;
  candidates: Array<{ code10: string; description: string | null; dd: number | null; tva: number | null }>;
  sourceExcerpt?: string;
  clientName?: string;
  documentSource?: string;
  timeoutMs?: number;
}): Promise<Array<{ code10: string; confidence: number; reason: string }> | null> {
  const { cargoDescription, candidates } = args;
  const timeoutMs = args.timeoutMs ?? 8000;
  if (!candidates.length) return null;
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return null;

  const cargoDesc = (cargoDescription || "").trim();
  const sourceExcerpt = (args.sourceExcerpt || "").trim();
  const clientName = (args.clientName || "").trim();
  const documentSource = (args.documentSource || "").trim();

  // Log sanitisé (ne jamais logger le prompt complet — peut contenir données client/OCR sensibles)
  console.log(
    `[HS-AI] ranking_context ` +
      JSON.stringify({
        hasCargoDescription: cargoDesc.length > 0,
        cargoDescriptionPreview: cargoDesc.slice(0, 80),
        hasSourceExcerpt: sourceExcerpt.length > 0,
        sourceExcerptPreview: sourceExcerpt.slice(0, 120),
        clientNamePreview: clientName.slice(0, 80),
        documentSource: documentSource.slice(0, 120),
        candidateCount: candidates.length,
      }),
  );

  const userPrompt = [
    "=== DOSSIER CONTEXT ===",
    `Client: ${clientName || "N/A"}`,
    `Cargo description: ${cargoDesc || "N/A"}`,
    `Source excerpt (text around the detected HS code): ${sourceExcerpt || "N/A"}`,
    `Document source: ${documentSource || "N/A"}`,
    "",
    "=== CANDIDATE HS10 CODES ===",
    candidates
      .map((c) => `- ${c.code10} | DD=${c.dd ?? "?"}% TVA=${c.tva ?? "?"}% | ${c.description ?? "(no description)"}`)
      .join("\n"),
    "",
    "Task: Given ALL the context above, rank the HS10 candidates by likelihood for this cargo.",
    'Cite explicitly which context elements support your ranking in each "reason".',
    "If the context is insufficient to differentiate, return prudent confidences and explain why.",
    "",
    'Reply with STRICT JSON only: {"ranked":[{"code10":"...","confidence":0.0-1.0,"reason":"..."}]}',
  ].join("\n");

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You are a customs classification assistant for CEDEAO/UEMOA tariffs. Use the dossier context (client, cargo description, source excerpt, document source) AND the candidate HS10 codes (with DD/TVA and official description) to rank them by likelihood. Reply with STRICT JSON only.",
          },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    clearTimeout(t);
    if (!resp.ok) {
      console.warn(`[HS-AI] ranking_failed reason=http_${resp.status}`);
      return null;
    }
    const json = await resp.json();
    const content = json?.choices?.[0]?.message?.content || "";
    const cleaned = content.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed?.ranked)) return null;
    const codeSet = new Set(candidates.map((c) => c.code10));
    return parsed.ranked
      .filter((r: any) => r && typeof r.code10 === "string" && codeSet.has(r.code10))
      .map((r: any) => ({
        code10: r.code10,
        confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0)),
        reason: String(r.reason || "").slice(0, 240),
      }));
  } catch (e) {
    console.warn(`[HS-AI] ranking_failed reason=${(e as Error).message || "unknown"}`);
    return null;
  }
}

// Helper: insérer un événement de suggestion HS10 dans la chronologie (visible OperatorJournal,
// invisible pour ReadyActionsPanel car event_type dédié et action_code distinct).
async function emitHs10SuggestionEvent(
  serviceClient: any,
  args: {
    case_id: string;
    source_digits: string;
    source_context: HsExtractionMatch["context"];
    sh6: string;
    candidates: Array<{ code10: string; description: string | null; dd: number | null; tva: number | null }>;
    ai_ranking: Array<{ code10: string; confidence: number; reason: string }> | null;
    origin: "ai_extraction" | "document_regex" | "email_regex" | "post_attach";
    source_label?: string;
  },
): Promise<void> {
  const dds = args.candidates.map((c) => c.dd).filter((v): v is number => v != null);
  const rate_divergence = dds.length > 1 && Math.max(...dds) - Math.min(...dds) > 0.0001;
  const rates_available = dds.length > 0;
  const aiOk = args.ai_ranking != null;
  const operator_message = aiOk
    ? `Code source ${args.source_digits} (${args.source_context}) → ${args.candidates.length} HS10 candidat(s) en SH6=${args.sh6}.${rate_divergence ? " Attention : taux DD divergents, validation douane requise." : ""}`
    : `Code source ${args.source_digits} (${args.source_context}) → ${args.candidates.length} HS10 candidat(s). Classement IA indisponible — sélection manuelle requise.`;

  // ===== Idempotence guard (DCQ-P0-HS10-SUGGESTION-IDEMPOTENCE) =====
  // Évite d'empiler des doublons HS10_CLASSIFICATION_SUGGESTION pour le même tuple
  // (case_id, source_digits, sh6, origin, source_label) à chaque relance build-case-puzzle.
  // source_label comparé côté JS pour matcher anciens events (null) ET nouveaux ("").
  try {
    const { data: existingCandidates, error: lookupErr } = await serviceClient
      .from("case_timeline_events")
      .select("id, event_data")
      .eq("case_id", args.case_id)
      .eq("event_type", "manual_action")
      .eq("event_data->>action_code", "HS10_CLASSIFICATION_SUGGESTION")
      .eq("event_data->>status", "trace")
      .eq("event_data->>source_digits", args.source_digits)
      .eq("event_data->>sh6", args.sh6)
      .eq("event_data->>origin", args.origin)
      .limit(20);

    if (lookupErr) {
      console.warn(`[HS Suggestion] idempotence lookup failed: ${lookupErr.message} — proceeding with insert`);
    } else if (Array.isArray(existingCandidates) && existingCandidates.length > 0) {
      const wantedLabel = args.source_label ?? "";
      const duplicate = existingCandidates.find((row: any) => {
        const existingLabel = row?.event_data?.source_label ?? "";
        return existingLabel === wantedLabel;
      });
      if (duplicate) {
        console.log(`[HS Suggestion] Skip insert (idempotent) source=${args.source_digits} sh6=${args.sh6} origin=${args.origin} existing_event=${duplicate.id}`);
        return;
      }
    }
  } catch (e) {
    console.warn(`[HS Suggestion] idempotence pre-check threw: ${(e as Error).message} — proceeding with insert`);
  }

  try {
    await serviceClient.from("case_timeline_events").insert({
      case_id: args.case_id,
      event_type: "manual_action", // CHECK constraint n'autorise pas un type dédié — discriminant porté par action_code/status ci-dessous
      actor_type: "system",
      event_data: {
        action_code: "HS10_CLASSIFICATION_SUGGESTION",
        status: "trace", // ⚠️ pas "open" — n'apparaît pas comme action opérateur à traiter
        action_type: "hs10_suggestion_pending",
        origin: args.origin,
        source_digits: args.source_digits,
        source_context: args.source_context,
        source_label: args.source_label ?? "", // normalisé pour matcher futurs lookups
        sh6: args.sh6,
        candidates: args.candidates,
        ai_ranking: args.ai_ranking,
        rate_divergence,
        rates_available,
        operator_message,
      },
    });
    console.log(`[HS Suggestion] Emitted timeline event for source=${args.source_digits} (${args.candidates.length} candidates)`);
  } catch (e) {
    console.warn(`[HS Suggestion] insert failed: ${(e as Error).message}`);
  }
}

// Helper: créer un GAP cargo.hs_code (idempotent par case_id + status='open')
async function ensureHsCodeGap(
  serviceClient: any,
  args: {
    case_id: string;
    is_blocking: boolean;
    question_fr: string;
    question_en: string;
  },
): Promise<boolean> {
  const { data: existing } = await serviceClient
    .from("quote_gaps")
    .select("id")
    .eq("case_id", args.case_id)
    .eq("gap_key", "cargo.hs_code")
    .eq("status", "open")
    .maybeSingle();
  if (existing?.id) return false;
  await serviceClient.from("quote_gaps").insert({
    case_id: args.case_id,
    gap_key: "cargo.hs_code",
    gap_category: "cargo",
    question_fr: args.question_fr,
    question_en: args.question_en,
    priority: "high",
    is_blocking: args.is_blocking,
  });
  return true;
}

// Orchestrateur : pour un code source <10 chiffres, créer suggestion + GAP (jamais d'écriture cargo.hs_code)
//
// NOTE Phase 2 HS10-AUTO-INJECTION-GUARD v3 : ce helper est aussi réutilisé comme mécanisme
// générique de suggestion HS10 trace quand l'auto-write est bloqué par la garde Option C,
// même si source_digits contient déjà 10 chiffres. Il ne doit JAMAIS écrire cargo.hs_code
// (cf. corps : seulement event HS10_CLASSIFICATION_SUGGESTION + GAP).
// Renommage différé pour éviter un refactor inutile.
async function handleSubTenHsSuggestion(
  serviceClient: any,
  args: {
    case_id: string;
    source_digits: string;       // 6 ou 8 chiffres
    source_context: HsExtractionMatch["context"];
    origin: "ai_extraction" | "document_regex" | "email_regex" | "post_attach";
    source_label?: string;
    cargoDescription?: string;
    // HS10-RANKING-CONTEXT-ENRICHMENT v2 — contexte transmis UNIQUEMENT au ranker IA
    // (jamais persisté en DB, jamais utilisé pour la résolution/promotion HS10,
    // jamais inclus dans le tuple d'idempotence d'emitHs10SuggestionEvent).
    sourceExcerpt?: string;
    clientName?: string;
    documentSource?: string;
  },
): Promise<{ blocking: boolean; status: "unique" | "ambiguous" | "not_found" }> {
  const sh6 = args.source_digits.substring(0, 6);
  const result = await resolveSenegalHsCode(serviceClient, args.source_digits);

  if (result.status === "not_found") {
    await ensureHsCodeGap(serviceClient, {
      case_id: args.case_id,
      is_blocking: true,
      question_fr: `Code HS source "${args.source_digits}" non résolu en HS10 dans la nomenclature CEDEAO/UEMOA. Veuillez fournir le code HS 10 chiffres.`,
      question_en: `Source HS code "${args.source_digits}" not resolved to HS10 in CEDEAO/UEMOA nomenclature. Please provide the 10-digit HS code.`,
    });
    return { blocking: true, status: "not_found" };
  }

  // unique ou ambiguous → constituer la liste des candidats, charger DD/TVA, ranker IA, émettre suggestion
  const codes10 =
    result.status === "unique" ? [result.code10] : result.candidates.map((c) => c.code10);
  const candidates = await loadHsCandidatesDetails(serviceClient, codes10);
  const ranking = await rankHsCandidatesWithAI({
    cargoDescription: args.cargoDescription || "",
    candidates,
    sourceExcerpt: args.sourceExcerpt,
    clientName: args.clientName,
    documentSource: args.documentSource,
  });

  await emitHs10SuggestionEvent(serviceClient, {
    case_id: args.case_id,
    source_digits: args.source_digits,
    source_context: args.source_context,
    sh6,
    candidates,
    ai_ranking: ranking,
    origin: args.origin,
    source_label: args.source_label,
  });

  const isBlocking = result.status === "ambiguous";
  await ensureHsCodeGap(serviceClient, {
    case_id: args.case_id,
    is_blocking: isBlocking,
    question_fr: isBlocking
      ? `Plusieurs HS10 possibles pour le code source "${args.source_digits}" (SH6=${sh6}). Classification douane requise — voir suggestions dans la chronologie.`
      : `Code HS10 suggéré pour le code source "${args.source_digits}" (SH6=${sh6}). Confirmation opérateur requise — voir suggestions dans la chronologie.`,
    question_en: isBlocking
      ? `Multiple HS10 candidates for source code "${args.source_digits}" (SH6=${sh6}). Customs classification required — see timeline suggestions.`
      : `HS10 suggestion for source code "${args.source_digits}" (SH6=${sh6}). Operator confirmation required — see timeline suggestions.`,
  });

  return { blocking: isBlocking, status: result.status };
}

export async function guardAiCargoHsCodeFact(
  serviceClient: any,
  args: {
    case_id: string;
    rawHs: string;
    cargoDescription?: string;
    clientName?: string;
    sourceExcerpt?: string;
  },
): Promise<
  | { shouldWrite: true; code10: string; confidence: number; routedSourceDigits: string[] }
  | { shouldWrite: false; routedSourceDigits: string[] }
> {
  const rawHs = String(args.rawHs || "");
  const rawDigits = rawHs.replace(/\D/g, "");

  if (rawDigits.length > 10) {
    const tokens = extractHsTokenMatches(rawHs);
    console.warn(`[HS Guard] Refused combined HS value (raw=${rawHs}, digits=${rawDigits.length}) — emitting suggestions`);
    for (const token of tokens) {
      await handleSubTenHsSuggestion(serviceClient, {
        case_id: args.case_id,
        source_digits: token.digits,
        source_context: "hs_label",
        origin: "ai_extraction",
        cargoDescription: args.cargoDescription,
        clientName: args.clientName,
        sourceExcerpt: args.sourceExcerpt || rawHs,
      });
    }
    if (!tokens.length) {
      await ensureHsCodeGap(serviceClient, {
        case_id: args.case_id,
        is_blocking: true,
        question_fr: `Valeur HS combinée "${rawHs}" non exploitable automatiquement. Veuillez confirmer le ou les codes HS 10 chiffres.`,
        question_en: `Combined HS value "${rawHs}" cannot be used automatically. Please confirm the 10-digit HS code(s).`,
      });
    }
    return { shouldWrite: false, routedSourceDigits: tokens.map((t) => t.digits) };
  }

  if (rawDigits.length < 10) {
    // Source <10 chiffres → JAMAIS d'écriture cargo.hs_code. Suggestion + GAP.
    console.warn(`[HS Guard] Refused sub-10 promotion (raw=${rawHs}, digits=${rawDigits.length}) — emitting suggestion`);
    await handleSubTenHsSuggestion(serviceClient, {
      case_id: args.case_id,
      source_digits: rawDigits,
      source_context: "hs_label",
      origin: "ai_extraction",
      cargoDescription: args.cargoDescription,
      clientName: args.clientName,
      sourceExcerpt: args.sourceExcerpt,
    });
    return { shouldWrite: false, routedSourceDigits: rawDigits ? [rawDigits] : [] };
  }

  const hsResult = await resolveSenegalHsCode(serviceClient, rawHs);
  if (hsResult.status === "unique") {
    console.log(`[HS Guard] Resolved ${rawHs} → ${hsResult.code10}`);
    return { shouldWrite: true, code10: hsResult.code10, confidence: 1.0, routedSourceDigits: [] };
  }

  console.warn(`[HS Guard] Skipping cargo.hs_code injection: ${hsResult.status} for raw=${rawHs}`);
  return { shouldWrite: false, routedSourceDigits: [] };
}

// --- Deterministic cargo value extraction from free text (regex) ---
interface CargoValueExtraction {
  goodsValue?: number;
  freightValue?: number;
  totalValue?: number;
  currency?: string;
  goodsSource?: string;
}

function extractCargoValueFromText(text: string): CargoValueExtraction {
  const result: CargoValueExtraction = {};

  // Robust number parser for French/English formats
  const parseAmount = (raw: string): number | null => {
    const trimmed = raw.trim();
    let cleaned = trimmed.replace(/[\s']/g, '');
    const lastDot = cleaned.lastIndexOf('.');
    const lastComma = cleaned.lastIndexOf(',');
    if (lastComma > lastDot) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else if (lastDot > lastComma) {
      cleaned = cleaned.replace(/,/g, '');
    }
    const n = parseFloat(cleaned);
    return isNaN(n) || n <= 0 ? null : n;
  };

  const lines = text.split(/\n/);
  for (const line of lines) {
    // Currency detection BEFORE numeric check (so lines like "Total TTC Hors Options EUR" are captured).
    // No currency-specific priority: a line's currency is adopted ONLY when that
    // line is unambiguous (exactly one explicit currency). A line carrying several
    // explicit currencies (e.g. both EUR and QAR) is skipped so a later,
    // unambiguous line can set it -- never an arbitrary pick.
    if (!result.currency) {
      const seen: string[] = [];
      if (/\bQAR\b|\bQR\b|QATARI?\s*RIYALS?/i.test(line)) seen.push('QAR');
      if (/\bEUR\b|\u20AC/i.test(line)) seen.push('EUR');
      if (/\bUSD\b/i.test(line)) seen.push('USD');
      if (/\bXOF\b|\bFCFA\b/i.test(line)) seen.push('XOF');
      if (seen.length === 1) result.currency = seen[0];
    }

    // Take the LAST numeric amount on the line to avoid quantities/references
    const matches = [...line.matchAll(/([0-9][0-9\s',.]*[0-9])/g)];
    if (matches.length === 0) continue;
    const lastMatch = matches[matches.length - 1][1];

    if (/Sous[- ]?total\s+HT/i.test(line)) {
      const v = parseAmount(lastMatch);
      if (v) { result.goodsValue = v; result.goodsSource = 'goods_from_sous_total'; }
    } else if (/\b(?:CFR|CAF|CIF)\b/i.test(line) && !result.goodsValue) {
      const v = parseAmount(lastMatch);
      if (v) { result.goodsValue = v; result.goodsSource = 'goods_from_incoterm_value'; }
    } else if (/Transport\s+(?:Export|International)/i.test(line)) {
      const v = parseAmount(lastMatch);
      if (v) result.freightValue = v;
    } else if (/\b(?:FRET|FREIGHT)\b/i.test(line) && !result.freightValue) {
      const v = parseAmount(lastMatch);
      if (v) result.freightValue = v;
    } else if (/(?:Montant|Total)\s+HT/i.test(line) && !result.totalValue) {
      const v = parseAmount(lastMatch);
      if (v) result.totalValue = v;
    }
  }

  console.log(`[cargo-value doc-regex] First pass results: goods=${result.goodsValue}, freight=${result.freightValue}, total=${result.totalValue}, currency=${result.currency}`);

  // --- Fallback: "stacked labels" format (labels on separate lines from amounts) ---
  if (!result.goodsValue && !result.freightValue && !result.totalValue) {
    const labelPatterns: Array<{ key: keyof Pick<CargoValueExtraction, 'goodsValue' | 'freightValue' | 'totalValue'>; regex: RegExp }> = [
      { key: 'goodsValue', regex: /Sous[- ]?total\s+HT/i },
      { key: 'freightValue', regex: /Transport\s+(?:Export|International)/i },
      { key: 'totalValue', regex: /(?:Montant|Total)\s+HT(?!\s*Hors)/i },
    ];

    // Helper: detect tabulated table header lines (3+ tab-separated columns)
    const isTabulated = (l: string) => l.includes('\t') && l.split('\t').length >= 3;

    // Find the anchor: PRIORITY 1 = "Sous-total HT" (most specific), PRIORITY 2 = any label pattern
    let anchorIdx = -1;
    // Priority pass: Sous-total HT (skip tabulated lines)
    for (let i = 0; i < lines.length; i++) {
      if (isTabulated(lines[i])) continue;
      if (/Sous[- ]?total\s+HT/i.test(lines[i])) {
        anchorIdx = i;
        break;
      }
    }
    // Fallback pass: any label pattern (skip tabulated lines)
    if (anchorIdx < 0) {
      for (let i = 0; i < lines.length; i++) {
        if (isTabulated(lines[i])) continue;
        if (labelPatterns.some(lp => lp.regex.test(lines[i]))) {
          anchorIdx = i;
          break;
        }
      }
    }

    if (anchorIdx >= 0) {
      console.log(`[cargo-value doc-regex] Stacked anchor at line ${anchorIdx}: "${lines[anchorIdx]?.trim()}"`);
      // Count ALL non-numeric lines from anchor onwards (the label block)
      const labelBlock: Array<{ lineIdx: number; matchedKey?: string }> = [];
      let blockEnd = anchorIdx;
      for (let i = anchorIdx; i < lines.length; i++) {
        const trimLine = lines[i].trim();
        if (!trimLine) continue; // skip blank lines
        if (isTabulated(lines[i])) continue; // skip tabulated table rows
        // Check if line is purely numeric (amount line)
        const isNumericLine = /^[\s]*[0-9][0-9\s',.]*[0-9][\s]*$/.test(trimLine) || /^[\s]*[0-9]+[\s]*$/.test(trimLine);
        if (isNumericLine) {
          blockEnd = i;
          break;
        }
        // It's a label line — check if it matches one of our patterns
        let matchedKey: string | undefined;
        for (const lp of labelPatterns) {
          if (lp.regex.test(trimLine)) { matchedKey = lp.key; break; }
        }
        labelBlock.push({ lineIdx: i, matchedKey });
      }

      // Now collect the numeric block starting at blockEnd
      const amounts: number[] = [];
      for (let i = blockEnd; i < lines.length && amounts.length < labelBlock.length + 2; i++) {
        const trimLine = lines[i].trim();
        if (!trimLine) continue;
        const numMatch = trimLine.match(/^([0-9][0-9\s',.]*[0-9])$/);
        if (numMatch) {
          const v = parseAmount(numMatch[1]);
          if (v) amounts.push(v);
        } else if (amounts.length > 0) {
          break; // end of numeric block
        }
      }

      console.log(`[cargo-value doc-regex] Label block: ${labelBlock.length} labels, amounts: ${amounts.length}`, JSON.stringify({ labels: labelBlock.map(l => l.matchedKey || '?'), amounts }));
      // Map amounts to label positions
      for (let i = 0; i < labelBlock.length && i < amounts.length; i++) {
        const mk = labelBlock[i].matchedKey;
        if (mk === 'goodsValue') {
          result.goodsValue = amounts[i];
          result.goodsSource = 'goods_from_sous_total_stacked';
        } else if (mk === 'freightValue') {
          result.freightValue = amounts[i];
        } else if (mk === 'totalValue') {
          result.totalValue = amounts[i];
        }
        // Non-matched labels (e.g. "Total TTC Hors Options EUR") are skipped but preserve position alignment
      }
    }
  }

  // Fallback derivation: goods = total - freight
  if (!result.goodsValue && result.totalValue && result.freightValue) {
    const derived = result.totalValue - result.freightValue;
    if (derived > 0) {
      result.goodsValue = derived;
      result.goodsSource = 'goods_derived_total_minus_freight';
    }
  }

  return result;
}

// --- C3.2-A: Multi-quote line detection helpers ---

const MULTI_QUOTE_MARKERS = [
  /\bquote\s*[1-9]/i,
  /\boption\s*[a-d1-4]/i,
  /\balternative\s*[1-4]/i,
  /\bshipment\s*[1-4]/i,
  /\bscenario\s*[1-4]/i,
  /\bdevis\s*[1-4]/i,
  /\bcotation\s*[1-4]/i,
  /\benvoi\s*[1-4]/i,
  // P0: French lot patterns
  /\blot\s*[1-9]/i,
  /\blot\s*n[°o]?\s*[1-9]/i,
  /\bpartie\s*[1-4]/i,
  /\btranche\s*[1-4]/i,
];

function detectMultiQuoteMarkers(text: string): boolean {
  if (!text || text.length < 20) return false;

  // P0: Count distinct lot references — 2+ lot numbers = multi-quote
  const lotMatches = text.match(/\blot\s*(?:n[°o]?\s*)?[1-9]\b/gi) || [];
  if (lotMatches.length >= 2) return true;

  // P0: Both air AND sea mentioned = inherently multi-quote
  const hasAirKeyword = /\b(?:a[ée]rien|by air|air cargo|airfreight|air freight)\b/i.test(text);
  const hasSeaKeyword = /\b(?:maritime|sea freight|seafreight|by sea|conteneur|container|fcl|lcl)\b/i.test(text);
  if (hasAirKeyword && hasSeaKeyword) return true;

  let distinctCount = 0;
  for (const re of MULTI_QUOTE_MARKERS) {
    if (re.test(text)) distinctCount++;
    if (distinctCount >= 2) return true;
  }
  // Also check numbered lists: "1) ... 2) ..." or "1. ... 2. ..." with quote-like context
  const numberedPattern = /(?:^|\n)\s*[1-4][.)]\s*.{10,}/g;
  const numberedMatches = text.match(numberedPattern);
  if (numberedMatches && numberedMatches.length >= 2 && distinctCount >= 1) return true;
  return false;
}

const MULTI_QUOTE_SUBJECT_LINE_RE = /^\s*(?:Subject|Sujet|Objet|Re|Fwd|FW)\s*:/i;
const QUOTED_EMAIL_HISTORY_START_RE =
  /^\s*(?:From|De|Sent|Envoy[ée]|Subject|Sujet|Objet)\s*:|^\s*-{2,}\s*Original Message\s*-{2,}|^\s*Message d['’]origine|^\s*On .+ wrote:\s*$|^\s*Le .+ a [ée]crit\s*:/i;

function stripSubjectLinesForMultiQuoteGate(text: string): string {
  if (!text) return "";
  return text
    .split(/\r?\n/)
    .filter((line) => !MULTI_QUOTE_SUBJECT_LINE_RE.test(line))
    .join("\n");
}

function stripQuotedEmailHistory(text: string): string {
  if (!text) return "";
  const kept: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^>/.test(line)) continue;
    if (QUOTED_EMAIL_HISTORY_START_RE.test(line)) break;
    kept.push(rawLine);
  }
  return kept.join("\n").trim();
}

function buildActiveMultiQuoteContext(emails: any[], fullAttachmentContext: string): string {
  const inboundEmails = Array.isArray(emails)
    ? emails.filter((email) => !isSodatraEmail(email?.from_address || ""))
    : [];
  const latestInboundEmail = inboundEmails[inboundEmails.length - 1];
  const latestBody = extractPlainTextFromMime(latestInboundEmail?.body_text || "");
  const strippedBody = stripQuotedEmailHistory(latestBody);
  const parts: string[] = [];

  if (latestInboundEmail && strippedBody !== latestBody.trim()) {
    console.log("[M3.5 multi-quote] quoted history stripped");
  }

  if (latestInboundEmail && strippedBody) {
    parts.push(`[Latest inbound email: ${latestInboundEmail.sent_at || "unknown date"}]\n${strippedBody}`);
  }
  if (fullAttachmentContext) {
    parts.push(fullAttachmentContext);
  }

  return parts.join("\n\n");
}

const MULTI_QUOTE_BUSINESS_CONTENT_RE =
  /\b(?:airfreight|air freight|sea freight|seafreight|shipment|cargo|freight|container|conteneur|fcl|lcl|from|to|origin|destination|port|airport|incoterm|exw|fob|cif|dap|ddp|pickup|delivery|clearance|customs|kg|kgs|cbm|m3|tons?|tonnes?|pcs|pieces?|cartons?|packages?|pallets?|colis|palette|poids|volume|dimensions?)\b/i;

function normalizeMultiQuoteEvidence(text: string): string {
  return stripSubjectLinesForMultiQuoteGate(text)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasBusinessContentBeyondSubject(text: string): boolean {
  return MULTI_QUOTE_BUSINESS_CONTENT_RE.test(stripSubjectLinesForMultiQuoteGate(text || ""));
}

function looksLikeSubjectOnlyQuoteText(text: string): boolean {
  const trimmed = (text || "").trim();
  if (!trimmed) return true;
  if (MULTI_QUOTE_SUBJECT_LINE_RE.test(trimmed)) return true;

  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return true;
  if (lines.every((line) => MULTI_QUOTE_SUBJECT_LINE_RE.test(line))) return true;

  return lines.length === 1
    && trimmed.length <= 160
    && /^(?:airfreight|air freight|sea freight|seafreight|quotation|quote|cotation|devis|shipment)\b/i.test(trimmed)
    && /\b(?:from|to|de)\b/i.test(trimmed);
}

function hasActiveEvidenceBeyondSubject(
  segmentText: string,
  sourceExcerpt: string,
  activeEvidenceText: string
): boolean {
  const activeEvidence = normalizeMultiQuoteEvidence(activeEvidenceText);
  if (!activeEvidence) return false;

  return [segmentText, sourceExcerpt]
    .map((text) => normalizeMultiQuoteEvidence(text || ""))
    .filter((text) => text.length >= 12 && hasBusinessContentBeyondSubject(text))
    .some((text) => activeEvidence.includes(text.slice(0, Math.min(text.length, 180))));
}

function isDefensibleMultiQuoteLine(
  segmentText: string | null,
  sourceExcerpt: string | null,
  activeEvidenceText: string
): boolean {
  const segment = (segmentText || "").trim();
  const excerpt = (sourceExcerpt || "").trim();
  if (!segment) return false;
  if (MULTI_QUOTE_SUBJECT_LINE_RE.test(segment)) return false;
  if (looksLikeSubjectOnlyQuoteText(segment)) return false;

  const combined = `${segment}\n${excerpt}`;
  if (!hasBusinessContentBeyondSubject(combined)) return false;

  const subjectLike = excerpt ? looksLikeSubjectOnlyQuoteText(excerpt) : false;
  if (subjectLike && !hasActiveEvidenceBeyondSubject(segment, excerpt, activeEvidenceText)) {
    return false;
  }

  return true;
}

function pickSourceEmailId(emails: any[]): string | null {
  if (!Array.isArray(emails) || emails.length === 0) return null;
  for (let i = emails.length - 1; i >= 0; i--) {
    if (emails[i]?.is_quotation_request) return emails[i].id;
  }
  return emails[emails.length - 1]?.id || null;
}

/**
 * THREAD-TEMPORAL-PROVENANCE-1 -- provenance email id for AI-extracted facts.
 * The AI extraction context is built from INBOUND client emails only
 * (SOURCE-GUARD-1), so a fact is attributed to the LATEST inbound client email
 * by chronological order (sent_at asc) -- NOT to emails[0] (the oldest), and
 * with NO is_quotation_request priority: a later client email supersedes an
 * older one even if the older one carries the quotation-request flag. Returns
 * null when there is no inbound email, so a fact is never falsely attributed to
 * the first/oldest email. Generic, no commodity assumptions. Falls back to input
 * order when sent_at is absent (callers pass emails sorted ascending).
 */
export function pickInboundProvenanceEmailId(emails: any[]): string | null {
  const inbound = (emails || []).filter((e: any) => !isSodatraEmail(e?.from_address));
  if (inbound.length === 0) return null;
  const sorted = [...inbound].sort((a: any, b: any) => {
    const ta = Date.parse(a?.sent_at ?? "") || 0;
    const tb = Date.parse(b?.sent_at ?? "") || 0;
    return ta - tb;
  });
  return sorted[sorted.length - 1]?.id ?? null;
}

const MULTI_QUOTE_ALLOWED_KEYS = new Set([
  "cargo.weight_kg", "cargo.volume_cbm", "cargo.description",
  "cargo.pieces_count", "cargo.hs_code", "cargo.dimensions",
  "cargo.containers", "routing.origin_port", "routing.origin_airport",
  "routing.destination_port", "routing.destination_airport",
  "routing.incoterm", "timing.loading_date", "timing.delivery_deadline",
]);

async function extractQuoteLinesWithAI(
  threadContext: string,
  attachmentContext: string,
  _emails: any[],
  apiKey: string
): Promise<Array<{
  line_index: number;
  line_label: string;
  segment_text: string;
  extracted_facts: Array<{ key: string; value: string; valueType?: string; confidence?: number }>;
  confidence: number;
  request_type_hint?: string;
  source_excerpt?: string;
  meta_json?: Record<string, unknown>;
}> | null> {
  const truncatedAttach = (attachmentContext || "").slice(0, 8000);

  const systemPrompt = `You are a freight quotation analyst.
Detect whether the active email body or recent attachments contain multiple distinct quotation requests.
Email subjects may be stale or reused from older quotations.
Do not create a quote line from the email subject alone.
Prefer the latest inbound email body and recent attachments.
If subject and body conflict, treat subject as weak metadata.
Return { "lines": [] } if multiple active requests are not clearly present in body or attachments.

Return ONLY a valid JSON object with this structure:
{
  "lines": [
    {
      "line_index": 1,
      "line_label": "Quote 1 - Dry cargo from Shanghai",
      "segment_text": "relevant text segment for this quote",
      "request_type_hint": "SEA_FCL_IMPORT",
      "extracted_facts": [
        { "key": "cargo.weight_kg", "value": "22000", "valueType": "number", "confidence": 0.9 },
        { "key": "routing.origin_port", "value": "Shanghai", "valueType": "text", "confidence": 0.95 }
      ],
      "confidence": 0.9
    }
  ]
}

Allowed fact keys: cargo.weight_kg, cargo.volume_cbm, cargo.description, cargo.pieces_count, cargo.hs_code, cargo.dimensions, cargo.containers, routing.origin_port, routing.origin_airport, routing.destination_port, routing.destination_airport, routing.incoterm, timing.loading_date, timing.delivery_deadline.

Rules:
- Maximum 8 lines
- Each line must have at least 2 extracted facts with allowed keys
- line_index must be 1-based sequential
- Be precise about which facts belong to which quote option`;

  const userPrompt = `THREAD:\n${threadContext}\n\nATTACHMENTS:\n${truncatedAttach}`;

  try {
    const response = await fetch(LOVABLE_AI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      console.warn("[M3.5 multi-quote] AI response error:", response.status);
      return null;
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || "";

    // Parse JSON from response
    let parsed: any;
    try {
      parsed = extractAndParseJSON<any>(rawContent, {
        label: "build-case-puzzle:M3.5",
        expectRoot: "object",
        maxLogChars: 500,
      });
    } catch {
      console.warn("[M3.5 multi-quote] Failed to parse AI JSON response");
      return null;
    }

    const lines = parsed?.lines;
    if (!Array.isArray(lines)) return null;

    // Validate and filter
    const validLines = lines
      .slice(0, 8)
      .map((line: any, idx: number) => {
        if (!line || typeof line !== "object") return null;
        const facts = Array.isArray(line.extracted_facts)
          ? line.extracted_facts.filter((f: any) =>
              f && typeof f.key === "string" && MULTI_QUOTE_ALLOWED_KEYS.has(f.key) && f.value != null
            )
          : [];
        if (facts.length < 2) {
          console.warn(`[M3.5 multi-quote] Line ${idx + 1} rejected: only ${facts.length} valid facts`);
          return null;
        }
        // Parse JSON values when valueType=json
        const parsedFacts = facts.map((f: any) => {
          if (f.valueType === "json" && typeof f.value === "string") {
            try { return { ...f, value: JSON.parse(f.value) }; } catch { return f; }
          }
          return f;
        });
        return {
          line_index: idx + 1, // Always 1-based sequential (B5)
          line_label: typeof line.line_label === "string" ? line.line_label.slice(0, 200) : `Quote ${idx + 1}`,
          segment_text: typeof line.segment_text === "string" ? line.segment_text.slice(0, 5000) : "",
          extracted_facts: parsedFacts,
          confidence: typeof line.confidence === "number" ? Math.min(1, Math.max(0, line.confidence)) : 0.8,
          request_type_hint: typeof line.request_type_hint === "string" ? line.request_type_hint : undefined,
          source_excerpt: typeof line.source_excerpt === "string" ? line.source_excerpt.slice(0, 500) : undefined,
          meta_json: line.meta_json && typeof line.meta_json === "object" && !Array.isArray(line.meta_json) ? line.meta_json : {},
        };
      })
      .filter((line): line is NonNullable<typeof line> => line !== null);

    return validLines.length > 0 ? validLines : null;
  } catch (err) {
    console.warn("[M3.5 multi-quote] extractQuoteLinesWithAI error:", err);
    return null;
  }
}

// --- P0 Fix: Parse container text into structured JSON ---
/**
 * Normalize a raw container-type suffix token into a canonical type code.
 * Preserves existing behavior for GP/HC/HQ/DV/STD and adds special equipment:
 * FR/FLAT RACK/FLATRACK -> FR, OT/OPEN TOP -> OT, RF/REEFER -> RF.
 * Never collapses a special type (FR/OT/RF) into GP.
 */
function normalizeContainerSuffix(suffixRaw: string): string {
  const x = (suffixRaw || "").toUpperCase().replace(/[\s.'-]+/g, "");
  if (!x) return "GP";
  if (x === "FR" || x === "FLATRACK") return "FR";
  if (x === "OT" || x === "OPENTOP") return "OT";
  if (x === "RF" || x === "REEFER" || x === "RH") return "RF";
  if (x === "HC" || x === "HQ") return x; // preserved as-is (legacy behavior)
  if (x === "DV" || x === "STD" || x === "GP") return "GP";
  return "GP";
}

export function parseContainersFromText(raw: string): Array<{ type: string; quantity: number }> {
  const s = (raw || "").toUpperCase();
  const cleaned = s
    .replace(/\s+/g, " ")
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/CONT(?:A)?INER(S)?/g, "")
    .replace(/CNTR(S)?/g, "")
    .trim();

  // quantity x size [unit] [type]. Multi-word special types come first in the
  // alternation so "FLAT RACK"/"OPEN TOP" win over the bare FR/OT tokens.
  const re =
    /(\d+)\s*(?:X|\*|PCS|PC)?\s*(20|40|45)\s*(?:'|FT\.?|FEET|FOOT)?\s*[-]?\s*(FLAT\s*RACK|FLATRACK|OPEN\s*TOP|REEFER|HC|HQ|DV|GP|STD|FR|OT|RF)?/g;
  const out: Array<{ type: string; quantity: number }> = [];
  let m: RegExpExecArray | null;

  while ((m = re.exec(cleaned)) !== null) {
    const qty = Number(m[1]);
    const size = m[2];
    if (!Number.isFinite(qty) || qty <= 0) continue;
    out.push({ type: `${size}${normalizeContainerSuffix(m[3] || "")}`, quantity: qty });
  }

  // Fallback: a size mentioned without an explicit quantity (e.g. "40'FR",
  // "40HC", "40 flat rack", "20"). The type may be directly attached to the
  // size, so the pattern is anchored on the size rather than relying on a word
  // boundary before the type - this keeps "40'FR" from degrading to "40GP".
  if (out.length === 0) {
    const adjacent = cleaned.match(
      /\b(20|40|45)\s*(?:'|FT\.?|FEET|FOOT)?\s*[-]?\s*(FLAT\s*RACK|FLATRACK|OPEN\s*TOP|REEFER|HC|HQ|DV|GP|STD|FR|OT|RF)\b/,
    );
    if (adjacent) {
      out.push({ type: `${adjacent[1]}${normalizeContainerSuffix(adjacent[2])}`, quantity: 1 });
    } else {
      const has40 = cleaned.includes("40");
      const has20 = cleaned.includes("20");
      const has45 = cleaned.includes("45");
      if (has40) out.push({ type: "40GP", quantity: 1 });
      else if (has20) out.push({ type: "20GP", quantity: 1 });
      else if (has45) out.push({ type: "45GP", quantity: 1 });
    }
  }

  // Merge same types
  const merged = new Map<string, number>();
  for (const c of out) merged.set(c.type, (merged.get(c.type) || 0) + c.quantity);
  return Array.from(merged.entries()).map(([type, quantity]) => ({ type, quantity }));
}

interface PerContainerWeightParse {
  weightPerContainerKg: number;
  sourceExcerpt: string;
  confidence: number;
}

interface ContainerCountResult {
  count: number | null;
  ambiguous: boolean;
}

interface TotalWeightDerivation {
  weightPerContainerKg: number;
  totalWeightKg: number | null;
  sourceExcerpt: string;
  confidence: number;
  needsTotalWeightConfirmation: boolean;
}

interface DestinationFreeTimeParse {
  days: number;
  sourceExcerpt: string;
  confidence: number;
}

interface FinalDestinationTransitParse {
  finalDestination: string | null;
  transitViaPort: string | null;
  sourceExcerpt: string;
  confidence: number;
}

function cleanSingleLine(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function excerptAroundMatch(text: string, index: number, length: number, max = 180): string {
  const raw = String(text || "");
  const start = Math.max(0, index - 60);
  const end = Math.min(raw.length, index + length + 80);
  return cleanSingleLine(raw.slice(start, end)).slice(0, max);
}

function parseWeightUnitToKg(value: number, unit: string): number {
  const normalized = unit.toLowerCase().replace(/\./g, "").trim();
  if (normalized === "kg" || normalized === "kgs") return Math.round(value);
  return Math.round(value * 1000);
}

export function parsePerContainerWeight(text: string): PerContainerWeightParse | null {
  const source = String(text || "");
  const re = /\b(\d+(?:[\s.,]\d+)?)\s*(m\.?\s*t\.?|mt|metric\s*tons?|tons?|tonnes?|t|kg|kgs)\s*(?:\/|\bper\b|\beach\b|\bpar\b)\s*(?:container|containers|cntr|ctr|conteneurs?|ctnrs?)\b/i;
  const match = re.exec(source);
  if (!match?.[1] || !match[2]) return null;

  const parsed = parseRobustNumber(match[1]);
  if (parsed == null || parsed <= 0) return null;

  return {
    weightPerContainerKg: parseWeightUnitToKg(parsed, match[2]),
    sourceExcerpt: excerptAroundMatch(source, match.index, match[0].length),
    confidence: 0.95,
  };
}

export function countContainers(containersFact: unknown): ContainerCountResult {
  const rawValue = containersFact && typeof containersFact === "object" && "value_json" in containersFact
    ? (containersFact as any).value_json
    : containersFact && typeof containersFact === "object" && "value" in containersFact
      ? (containersFact as any).value
      : containersFact;

  let containers: Array<{ type?: unknown; quantity?: unknown }> = [];
  if (Array.isArray(rawValue)) {
    containers = rawValue as Array<{ type?: unknown; quantity?: unknown }>;
  } else if (typeof rawValue === "string" && rawValue.trim()) {
    containers = parseContainersFromText(rawValue);
  } else {
    return { count: null, ambiguous: true };
  }

  if (containers.length === 0) return { count: null, ambiguous: true };

  let total = 0;
  for (const c of containers) {
    const qty = Number((c as any)?.quantity);
    if (!Number.isFinite(qty) || qty <= 0) return { count: null, ambiguous: true };
    total += qty;
  }

  return total > 0 ? { count: total, ambiguous: false } : { count: null, ambiguous: true };
}

export function deriveTotalWeightIfSafe(
  perContainerWeight: PerContainerWeightParse | null,
  containers: ContainerCountResult,
): TotalWeightDerivation | null {
  if (!perContainerWeight) return null;

  const canCalculate = !containers.ambiguous && typeof containers.count === "number" && containers.count > 0;
  return {
    weightPerContainerKg: perContainerWeight.weightPerContainerKg,
    totalWeightKg: canCalculate ? perContainerWeight.weightPerContainerKg * containers.count! : null,
    sourceExcerpt: perContainerWeight.sourceExcerpt,
    confidence: canCalculate ? 0.95 : 0.85,
    needsTotalWeightConfirmation: !canCalculate,
  };
}

export function parseDestinationFreeTime(text: string): DestinationFreeTimeParse | null {
  const source = String(text || "");
  const patterns = [
    /\b(\d{1,3})\s*(?:days?|jours?)\s*(?:of\s*)?(?:free[-\s]?time|freetime)\b(?:[^.\n]{0,80}\b(?:destination|dest\.?|pod|discharge)\b)?/i,
    /\b(?:free[-\s]?time|freetime)\b[^.\n]{0,80}\b(\d{1,3})\s*(?:days?|jours?)\b[^.\n]{0,80}\b(?:destination|dest\.?|pod|discharge)\b/i,
  ];

  for (const re of patterns) {
    const match = re.exec(source);
    if (!match?.[1]) continue;
    const days = Number(match[1]);
    if (!Number.isInteger(days) || days <= 0 || days > 180) continue;
    const excerpt = excerptAroundMatch(source, match.index, match[0].length);
    const confidence = /\b(?:destination|dest\.?|pod|discharge)\b/i.test(excerpt) ? 0.95 : 0.85;
    return { days, sourceExcerpt: excerpt, confidence };
  }

  return null;
}

function hasDestinationFreeTimeSignal(text: string): boolean {
  return /\b(?:free[-\s]?time|freetime)\b/i.test(text || "");
}

function normalizeTransitDestination(value: string): string | null {
  const cleaned = cleanSingleLine(value)
    .replace(/\b(?:as|because|since|cargo|is|are|will|be|intransit|in\s+transit)\b.*$/i, "")
    .replace(/\b(?:via|through)\b.*$/i, "")
    .replace(/[^A-Za-z\s.'-]+$/g, "")
    .trim();
  if (!cleaned || cleaned.length < 2 || cleaned.length > 80) return null;
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseStructuredDestinationPort(text: string): string | null {
  const source = String(text || "");
  const match = /\bDestination\s+Port\s*:\s*([^\n,.;]+(?:\s+Port)?)\b/i.exec(source)
    || /\bPOD\s*:\s*([^\n,.;]+(?:\s+Port)?)\b/i.exec(source);
  const port = cleanSingleLine(match?.[1] || "");
  if (!port || !/\bport\b/i.test(port)) return null;
  return port.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function parseFinalDestinationTransit(text: string): FinalDestinationTransitParse | null {
  const source = String(text || "");
  const patterns = [
    /\b(?:cargo\s+is\s+)?(?:in\s*transit|intransit)\s+(?:to|for|towards)\s+([^\n.;,]+)/i,
    /\btransit\s+(?:to|for|towards)\s+([^\n.;,]+)/i,
  ];

  for (const re of patterns) {
    const match = re.exec(source);
    const finalDestination = normalizeTransitDestination(match?.[1] || "");
    if (!match || !finalDestination) continue;
    return {
      finalDestination,
      transitViaPort: parseStructuredDestinationPort(source),
      sourceExcerpt: excerptAroundMatch(source, match.index, match[0].length),
      confidence: 0.85,
    };
  }

  return null;
}

function hasTransitFinalDestinationSignal(text: string): boolean {
  return /\b(?:in\s*transit|intransit|transit\s+(?:to|for|towards))\b/i.test(text || "");
}

function hasStoredFactValue(row: any): boolean {
  if (!row) return false;
  if (row.value_number !== null && row.value_number !== undefined && Number.isFinite(Number(row.value_number))) return true;
  if (row.value_text !== null && row.value_text !== undefined && String(row.value_text).trim().length > 0) return true;
  if (row.value_json !== null && row.value_json !== undefined) {
    if (Array.isArray(row.value_json)) return row.value_json.length > 0;
    return true;
  }
  return false;
}

const FCL_DETERMINISTIC_FACT_SOURCE_TYPE = "ai_extraction";

function fclDeterministicSourceExcerpt(sourceExcerpt: string): string {
  const raw = cleanSingleLine(sourceExcerpt);
  const prefixed = raw.startsWith("[deterministic_calc]")
    ? raw
    : `[deterministic_calc] ${raw}`;
  return prefixed.slice(0, 500);
}

async function upsertDeterministicFact(
  serviceClient: any,
  args: {
    case_id: string;
    fact_key: string;
    fact_category: string;
    value_text?: string | null;
    value_number?: number | null;
    value_json?: unknown | null;
    source_email_id?: string | null;
    source_excerpt: string;
    confidence: number;
  },
): Promise<"added" | "updated" | "skipped"> {
  const { data: existingFact } = await serviceClient
    .from("quote_facts")
    .select("id, value_text, value_number, value_json, source_type")
    .eq("case_id", args.case_id)
    .eq("fact_key", args.fact_key)
    .eq("is_current", true)
    .maybeSingle();

  if (existingFact && hasStoredFactValue(existingFact) && MANUAL_PROTECTED_SOURCES.has(existingFact.source_type ?? "")) {
    console.log(`[FCL constraints] Skipping ${args.fact_key}: protected source (${existingFact.source_type})`);
    return "skipped";
  }

  const nextValue = args.value_json ?? args.value_number ?? args.value_text ?? null;
  const existingValue = existingFact?.value_json ?? existingFact?.value_number ?? existingFact?.value_text ?? null;
  if (existingFact && JSON.stringify(existingValue) === JSON.stringify(nextValue)) {
    return "skipped";
  }

  const { error } = await serviceClient.rpc("supersede_fact", {
    p_case_id: args.case_id,
    p_fact_key: args.fact_key,
    p_fact_category: args.fact_category,
    p_value_text: args.value_text ?? null,
    p_value_number: args.value_number ?? null,
    p_value_json: args.value_json ?? null,
    p_value_date: null,
    p_source_type: FCL_DETERMINISTIC_FACT_SOURCE_TYPE,
    p_source_email_id: args.source_email_id ?? null,
    p_source_attachment_id: null,
    p_source_excerpt: fclDeterministicSourceExcerpt(args.source_excerpt),
    p_confidence: args.confidence,
  });

  if (error) {
    console.warn(`[FCL constraints] Failed to upsert ${args.fact_key}: ${error.message}`);
    return "skipped";
  }

  return existingFact ? "updated" : "added";
}

async function ensureDeterministicBlockingGap(
  serviceClient: any,
  args: {
    case_id: string;
    gap_key: string;
    gap_category: string;
    question_fr: string;
    question_en: string;
  },
): Promise<boolean> {
  const { data: existingGap } = await serviceClient
    .from("quote_gaps")
    .select("id, is_blocking")
    .eq("case_id", args.case_id)
    .eq("gap_key", args.gap_key)
    .eq("status", "open")
    .maybeSingle();

  if (!existingGap?.id) {
    await serviceClient.from("quote_gaps").insert({
      case_id: args.case_id,
      gap_key: args.gap_key,
      gap_category: args.gap_category,
      question_fr: args.question_fr,
      question_en: args.question_en,
      priority: "critical",
      is_blocking: true,
    });
    return true;
  }

  if (existingGap.is_blocking === false) {
    await serviceClient
      .from("quote_gaps")
      .update({ is_blocking: true, priority: "critical" })
      .eq("id", existingGap.id);
  }

  return false;
}

async function clearUnsafePerContainerTotalIfNeeded(
  serviceClient: any,
  case_id: string,
  perContainerWeightKg: number,
): Promise<boolean> {
  const { data: existingFact } = await serviceClient
    .from("quote_facts")
    .select("id, value_number, source_type, source_excerpt")
    .eq("case_id", case_id)
    .eq("fact_key", "cargo.weight_kg")
    .eq("is_current", true)
    .maybeSingle();

  if (!existingFact || MANUAL_PROTECTED_SOURCES.has(existingFact.source_type ?? "")) return false;
  const currentWeight = Number(existingFact.value_number);
  const excerpt = String(existingFact.source_excerpt || "");
  if (Number.isFinite(currentWeight) && currentWeight === perContainerWeightKg && /\bper\s*(?:container|cntr|ctr)\b/i.test(excerpt)) {
    await serviceClient
      .from("quote_facts")
      .update({ is_current: false, updated_at: new Date().toISOString() })
      .eq("id", existingFact.id);
    console.log("[FCL constraints] Deactivated unsafe cargo.weight_kg copied from per-container weight");
    return true;
  }

  return false;
}

export async function applyFclConstraintPostProcessing(args: {
  case_id: string;
  serviceClient: any;
  text: string;
  sourceEmailId?: string | null;
}): Promise<{ added: number; updated: number; skipped: number; gapsIdentified: number; protectedGapKeys: Set<string> }> {
  const result = { added: 0, updated: 0, skipped: 0, gapsIdentified: 0, protectedGapKeys: new Set<string>() };
  const text = String(args.text || "");
  if (!text.trim()) return result;

  const { data: currentFacts } = await args.serviceClient
    .from("quote_facts")
    .select("fact_key, value_text, value_number, value_json, source_type, source_excerpt")
    .eq("case_id", args.case_id)
    .eq("is_current", true)
    .in("fact_key", [
      "cargo.containers",
      "cargo.weight_kg",
      "cargo.weight_per_container_kg",
      "pricing.destination_free_time_days",
      "routing.final_destination",
      "routing.transit_via_port",
    ]);

  const factMap = new Map<string, any>();
  for (const row of currentFacts || []) factMap.set(row.fact_key, row);

  const perContainer = parsePerContainerWeight(text);
  if (perContainer) {
    const containers = countContainers(factMap.get("cargo.containers"));
    const derivation = deriveTotalWeightIfSafe(perContainer, containers);
    if (derivation) {
      const perContainerWrite = await upsertDeterministicFact(args.serviceClient, {
        case_id: args.case_id,
        fact_key: "cargo.weight_per_container_kg",
        fact_category: "cargo",
        value_number: derivation.weightPerContainerKg,
        source_email_id: args.sourceEmailId ?? null,
        source_excerpt: derivation.sourceExcerpt,
        confidence: derivation.confidence,
      });
      if (perContainerWrite === "added") result.added++;
      else if (perContainerWrite === "updated") result.updated++;
      else result.skipped++;

      if (derivation.totalWeightKg !== null) {
        const totalExcerpt = `${derivation.sourceExcerpt}; containers=${containers.count}; total=${derivation.totalWeightKg} kg`;
        const totalWrite = await upsertDeterministicFact(args.serviceClient, {
          case_id: args.case_id,
          fact_key: "cargo.weight_kg",
          fact_category: "cargo",
          value_number: derivation.totalWeightKg,
          source_email_id: args.sourceEmailId ?? null,
          source_excerpt: totalExcerpt.slice(0, 500),
          confidence: 0.95,
        });
        if (totalWrite === "added") result.added++;
        else if (totalWrite === "updated") result.updated++;
        else result.skipped++;
        console.log(`[FCL constraints] Derived total weight from per-container weight (${containers.count} containers)`);
      } else {
        const cleared = await clearUnsafePerContainerTotalIfNeeded(args.serviceClient, args.case_id, derivation.weightPerContainerKg);
        if (cleared) result.updated++;
        result.protectedGapKeys.add("cargo.weight_kg");
        const created = await ensureDeterministicBlockingGap(args.serviceClient, {
          case_id: args.case_id,
          gap_key: "cargo.weight_kg",
          gap_category: "cargo",
          question_fr: "Le poids est indique par conteneur, mais le nombre de conteneurs est absent ou ambigu. Veuillez confirmer le poids total ou le calcul a appliquer.",
          question_en: "Weight is stated per container, but the number of containers is missing or ambiguous. Please confirm the total weight or the calculation to apply.",
        });
        if (created) result.gapsIdentified++;
      }
    }
  }

  const freeTime = parseDestinationFreeTime(text);
  if (freeTime) {
    const write = await upsertDeterministicFact(args.serviceClient, {
      case_id: args.case_id,
      fact_key: "pricing.destination_free_time_days",
      fact_category: "pricing",
      value_number: freeTime.days,
      source_email_id: args.sourceEmailId ?? null,
      source_excerpt: freeTime.sourceExcerpt,
      confidence: freeTime.confidence,
    });
    if (write === "added") result.added++;
    else if (write === "updated") result.updated++;
    else result.skipped++;
  } else if (hasDestinationFreeTimeSignal(text)) {
    result.protectedGapKeys.add("pricing.destination_free_time_days");
    const created = await ensureDeterministicBlockingGap(args.serviceClient, {
      case_id: args.case_id,
      gap_key: "pricing.destination_free_time_days",
      gap_category: "pricing",
      question_fr: "Une demande de free time destination est detectee, mais le nombre de jours n'est pas exploitable. Veuillez confirmer le nombre de jours.",
      question_en: "Destination free time is mentioned, but the number of days could not be extracted. Please confirm the number of days.",
    });
    if (created) result.gapsIdentified++;
  }

  const transit = parseFinalDestinationTransit(text);
  if (transit?.finalDestination) {
    const finalWrite = await upsertDeterministicFact(args.serviceClient, {
      case_id: args.case_id,
      fact_key: "routing.final_destination",
      fact_category: "routing",
      value_text: transit.finalDestination,
      source_email_id: args.sourceEmailId ?? null,
      source_excerpt: transit.sourceExcerpt,
      confidence: transit.confidence,
    });
    if (finalWrite === "added") result.added++;
    else if (finalWrite === "updated") result.updated++;
    else result.skipped++;

    if (transit.transitViaPort) {
      const viaWrite = await upsertDeterministicFact(args.serviceClient, {
        case_id: args.case_id,
        fact_key: "routing.transit_via_port",
        fact_category: "routing",
        value_text: transit.transitViaPort,
        source_email_id: args.sourceEmailId ?? null,
        source_excerpt: transit.sourceExcerpt,
        confidence: transit.confidence,
      });
      if (viaWrite === "added") result.added++;
      else if (viaWrite === "updated") result.updated++;
      else result.skipped++;
    }
  } else if (hasTransitFinalDestinationSignal(text)) {
    result.protectedGapKeys.add("routing.final_destination");
    const created = await ensureDeterministicBlockingGap(args.serviceClient, {
      case_id: args.case_id,
      gap_key: "routing.final_destination",
      gap_category: "routing",
      question_fr: "Un transit vers une destination finale est detecte, mais la destination finale n'est pas exploitable. Veuillez confirmer la destination finale.",
      question_en: "Transit to a final destination is mentioned, but the final destination could not be extracted. Please confirm the final destination.",
    });
    if (created) result.gapsIdentified++;
  }

  if (result.added + result.updated + result.gapsIdentified > 0) {
    console.log(`[FCL constraints] post-process applied: added=${result.added}, updated=${result.updated}, gaps=${result.gapsIdentified}`);
  }

  return result;
}

// =====================================================================
// CARGO-CONFLICT-GUARD-GWC-1
// Deterministic, idempotent guards that block a case when the latest
// inbound client email body contradicts AI/attachment cargo facts, or
// when a weight/value was extracted from a non-usable context (per-unit
// weight treated as total, duty/tax amount treated as goods value).
//
// All detection logic lives in pure helpers below (no DB dependency) so
// they are unit-testable. The async orchestrator only wires the pure
// decision into idempotent gap creation + conservative fact cleanup.
// =====================================================================

interface CargoGuardFact {
  key: string;
  value?: string | number | null;
  sourceExcerpt?: string | null;
  sourceType?: string | null;
}

interface CargoConflictGuard {
  gap_key: string;
  gap_category: "cargo";
  priority: "critical";
  is_blocking: true;
  question_fr: string;
  question_en: string;
  reason: string;
}

interface DetectCargoConflictGuardsInput {
  latestInboundBody: string;
  extractedFacts?: CargoGuardFact[];
  currentFacts?: CargoGuardFact[];
  existingOpenGapKeys?: string[];
}

const CARGO_GUARD_QUESTIONS: Record<string, { fr: string; en: string }> = {
  "cargo.pieces_count_conflict": {
    fr: "Le dernier email client indique 15 bus, mais une autre source a produit 5 pieces. Confirmer le nombre total de bus a coter.",
    en: "The latest client email states 15 buses, but another source produced 5 pieces. Please confirm the total number of buses to quote.",
  },
  "cargo.weight_total_confirmation": {
    fr: "Le poids detecte semble etre un poids unitaire ('per unit'). Confirmer le poids total cargo ou le poids unitaire et le nombre d'unites.",
    en: "The detected weight looks like a per-unit weight ('per unit'). Please confirm the total cargo weight, or the unit weight and the number of units.",
  },
  "cargo.value_conflict": {
    fr: "Un montant a ete detecte dans un contexte droits/taxes ('Duty and tax'). Confirmer la valeur marchandise declaree/CIF a utiliser.",
    en: "An amount was detected in a duty/tax context ('Duty and tax'). Please confirm the declared/CIF goods value to use.",
  },
  "cargo.mixed_scope_confirmation": {
    fr: "Le dernier email mentionne des bus et des conteneurs additionnels de materiel medical non-DGR. Separer ou confirmer les lignes cargo a coter.",
    en: "The latest email mentions buses and additional containers of non-DGR medical equipment. Please separate or confirm the cargo lines to quote.",
  },
};

/**
 * Extract an explicit *total* bus count from the latest inbound client body.
 * Returns null when no explicit number is associated with buses, or when the
 * mention is ambiguous (several distinct un-qualified bus numbers).
 * Subjects must not be passed here — only the email body.
 */
export function extractExplicitBusTotalFromLatestInboundBody(text: string): number | null {
  const body = String(text || "");
  if (!body.trim()) return null;

  const strongPatterns: RegExp[] = [
    /total\s+bus(?:es)?\s+count\s+(?:is|of|:|=|stands\s+at)?\s*(\d{1,4})/i,
    /total\s+(?:of\s+)?(\d{1,4})\s+bus(?:es)?\b/i,
    /bus(?:es)?\s+(?:count\s+)?(?:is|are|has\s+been|have\s+been)\s+(?:increase[d]?|increasing|updated|revised|changed|now)\s+to\s+(\d{1,4})/i,
    /(?:increase[d]?|updated|revised|changed|now)\s+to\s+(\d{1,4})\s+bus(?:es)?\b/i,
  ];
  for (const re of strongPatterns) {
    const m = body.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }

  // Fallback: a single un-qualified "<n> bus(es)" mention.
  const generic = [...body.matchAll(/(\d{1,4})\s*bus(?:es)?\b/gi)]
    .map((m) => parseInt(m[1], 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  const distinct = [...new Set(generic)];
  if (distinct.length === 1) return distinct[0];
  return null;
}

/**
 * True when a weight excerpt is clearly a per-unit / per-vehicle measure
 * (e.g. "12,320 kg per unit", "GVW each"), which must not be treated as a
 * total cargo weight.
 */
export function looksLikePerUnitWeightExcerpt(excerpt: string): boolean {
  const s = String(excerpt || "");
  if (!s.trim()) return false;
  return /\bper\s*(?:unit|bus|vehicle|piece|pc|set|pax)\b|\beach\b|\/\s*(?:unit|bus|vehicle|piece|pc)\b/i.test(s);
}

/**
 * True when a value excerpt comes from a duty/tax computation context
 * (e.g. "Duty and tax 8702090 (48.89% on CIF) = 146619") and therefore must
 * not be treated as the declared goods value. A CIF mention alone does NOT
 * trigger this — both "duty" and "tax" must be present.
 */
export function looksLikeDutyTaxValueExcerpt(excerpt: string): boolean {
  const s = String(excerpt || "");
  if (!s.trim()) return false;
  const hasDuty = /\bdut(?:y|ies)\b/i.test(s);
  const hasTax = /\btax(?:es)?\b/i.test(s);
  return hasDuty && hasTax;
}

/**
 * True when the latest inbound body clearly describes a mixed cargo scope:
 * buses + additional container(s) + (non-DGR) medical equipment. Requires all
 * three signals to avoid false positives.
 */
export function detectMixedCargoScopeFromBody(text: string): boolean {
  const t = String(text || "");
  if (!t.trim()) return false;
  const hasBus = /\bbus(?:es)?\b/i.test(t);
  const hasMedical = /\bmedical\s+equipment\b/i.test(t);
  const hasAdditionalContainer =
    /\badditional[^.\n]{0,40}\bcontainers?\b/i.test(t) ||
    /\bcontainers?\b[^.\n]{0,40}\b(?:added|additional)\b/i.test(t) ||
    /\bone\s+additional\b[^.\n]{0,40}\bcontainer\b/i.test(t);
  return hasBus && hasMedical && hasAdditionalContainer;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Pure decision helper. Given the latest inbound client body and the cargo
 * facts (extracted during this run and/or current in DB), returns the set of
 * blocking guards to raise. Guards whose key is already in
 * `existingOpenGapKeys` are filtered out so the helper is a no-op when the gap
 * already exists. Never returns a corrected value — only the guards.
 */
export function detectCargoConflictGuards(input: DetectCargoConflictGuardsInput): CargoConflictGuard[] {
  const body = String(input.latestInboundBody || "");
  const extracted = input.extractedFacts || [];
  const current = input.currentFacts || [];
  const alreadyOpen = new Set(input.existingOpenGapKeys || []);

  const getFact = (key: string): CargoGuardFact | undefined =>
    extracted.find((f) => f.key === key) || current.find((f) => f.key === key);

  const guards: CargoConflictGuard[] = [];
  const push = (gap_key: string, reason: string) => {
    const q = CARGO_GUARD_QUESTIONS[gap_key];
    if (!q) return;
    guards.push({
      gap_key,
      gap_category: "cargo",
      priority: "critical",
      is_blocking: true,
      question_fr: q.fr,
      question_en: q.en,
      reason,
    });
  };

  const busTotal = extractExplicitBusTotalFromLatestInboundBody(body);
  const piecesFact = getFact("cargo.pieces_count");
  const piecesVal = toFiniteNumber(piecesFact?.value);

  // Guard 1: explicit client bus total contradicts extracted pieces_count.
  if (busTotal !== null && piecesFact && piecesVal !== null && piecesVal !== busTotal) {
    push("cargo.pieces_count_conflict", `body_bus_total=${busTotal} != pieces_count=${piecesVal}`);
  }

  // Guard 2: per-unit weight cannot be a total when several units are mentioned.
  const weightFact = getFact("cargo.weight_kg");
  const multipleUnits = (busTotal !== null && busTotal > 1) || (piecesVal !== null && piecesVal > 1);
  if (weightFact && looksLikePerUnitWeightExcerpt(weightFact.sourceExcerpt ?? "") && multipleUnits) {
    push("cargo.weight_total_confirmation", "per_unit_weight_with_multiple_units");
  }

  // Guard 3: amount taken from a duty/tax context is not the goods value.
  const valueFact = getFact("cargo.value");
  if (valueFact && looksLikeDutyTaxValueExcerpt(valueFact.sourceExcerpt ?? "")) {
    push("cargo.value_conflict", "duty_tax_context_value");
  }

  // Guard 4: clearly mixed cargo scope in the latest inbound body.
  if (detectMixedCargoScopeFromBody(body)) {
    push("cargo.mixed_scope_confirmation", "bus_plus_additional_containers_plus_medical");
  }

  return guards.filter((g) => !alreadyOpen.has(g.gap_key));
}

const CARGO_GUARD_NON_PROTECTED_SOURCES = new Set(["ai_extraction", "attachment_extracted"]);

/**
 * Deactivate a single current cargo fact only when (a) the guard is certain,
 * (b) the current fact comes from a non-protected source (ai_extraction /
 * attachment_extracted), and (c) the current fact's own excerpt re-confirms
 * the conflict. Never touches operator/manual_input. Never writes a value.
 */
async function deactivateConflictingCargoFact(
  serviceClient: any,
  case_id: string,
  fact_key: string,
  predicate: (fact: { value_number: number | null; value_text: string | null; source_excerpt: string | null }) => boolean,
): Promise<boolean> {
  const { data: existingFact } = await serviceClient
    .from("quote_facts")
    .select("id, value_number, value_text, source_type, source_excerpt")
    .eq("case_id", case_id)
    .eq("fact_key", fact_key)
    .eq("is_current", true)
    .maybeSingle();

  if (!existingFact?.id) return false;
  const source = existingFact.source_type ?? "";
  if (MANUAL_PROTECTED_SOURCES.has(source)) return false;
  if (!CARGO_GUARD_NON_PROTECTED_SOURCES.has(source)) return false;
  if (!predicate({
    value_number: existingFact.value_number ?? null,
    value_text: existingFact.value_text ?? null,
    source_excerpt: existingFact.source_excerpt ?? null,
  })) {
    return false;
  }

  await serviceClient
    .from("quote_facts")
    .update({ is_current: false, updated_at: new Date().toISOString() })
    .eq("id", existingFact.id);
  console.log(`[CARGO-CONFLICT-GUARD] Deactivated conflicting current fact ${fact_key} (source=${source})`);
  return true;
}

/**
 * Async orchestrator: runs the deterministic cargo-conflict guards against the
 * latest inbound client body, creates idempotent blocking gaps, and
 * conservatively deactivates clearly-conflicting non-protected facts. Never
 * launches pricing, never writes a corrected value, never touches
 * quote_request_lines.
 */
export async function applyCargoConflictGuards(args: {
  case_id: string;
  serviceClient: any;
  latestInboundBody: string;
}): Promise<{ gapsIdentified: number; factsDeactivated: number; guardKeys: string[] }> {
  const result = { gapsIdentified: 0, factsDeactivated: 0, guardKeys: [] as string[] };
  const body = String(args.latestInboundBody || "");
  if (!body.trim()) return result;

  const { data: currentFactRows } = await args.serviceClient
    .from("quote_facts")
    .select("fact_key, value_text, value_number, source_type, source_excerpt")
    .eq("case_id", args.case_id)
    .eq("is_current", true)
    .in("fact_key", ["cargo.pieces_count", "cargo.weight_kg", "cargo.value", "cargo.containers"]);

  const currentFacts: CargoGuardFact[] = (currentFactRows || []).map((row: any) => ({
    key: row.fact_key,
    value: row.value_number ?? row.value_text ?? null,
    sourceExcerpt: row.source_excerpt ?? null,
    sourceType: row.source_type ?? null,
  }));

  // Gap creation is deduplicated by ensureDeterministicBlockingGap, so no need
  // to pre-filter by existing open gaps here.
  const guards = detectCargoConflictGuards({ latestInboundBody: body, currentFacts });
  if (guards.length === 0) return result;

  for (const guard of guards) {
    const created = await ensureDeterministicBlockingGap(args.serviceClient, {
      case_id: args.case_id,
      gap_key: guard.gap_key,
      gap_category: guard.gap_category,
      question_fr: guard.question_fr,
      question_en: guard.question_en,
    });
    if (created) result.gapsIdentified++;
    result.guardKeys.push(guard.gap_key);
  }

  // Conservative cleanup of clearly-wrong non-protected current facts. Runs
  // independently of gap existence so re-extracted conflicting facts do not
  // resurface as current truth. Idempotent: only touches is_current=true rows.
  const guardKeySet = new Set(guards.map((g) => g.gap_key));
  const busTotal = extractExplicitBusTotalFromLatestInboundBody(body);

  if (guardKeySet.has("cargo.pieces_count_conflict")) {
    const deactivated = await deactivateConflictingCargoFact(
      args.serviceClient,
      args.case_id,
      "cargo.pieces_count",
      (f) => busTotal !== null && toFiniteNumber(f.value_number) !== null && toFiniteNumber(f.value_number) !== busTotal,
    );
    if (deactivated) result.factsDeactivated++;
  }
  if (guardKeySet.has("cargo.weight_total_confirmation")) {
    const deactivated = await deactivateConflictingCargoFact(
      args.serviceClient,
      args.case_id,
      "cargo.weight_kg",
      (f) => looksLikePerUnitWeightExcerpt(f.source_excerpt ?? ""),
    );
    if (deactivated) result.factsDeactivated++;
  }
  if (guardKeySet.has("cargo.value_conflict")) {
    const deactivated = await deactivateConflictingCargoFact(
      args.serviceClient,
      args.case_id,
      "cargo.value",
      (f) => looksLikeDutyTaxValueExcerpt(f.source_excerpt ?? ""),
    );
    if (deactivated) result.factsDeactivated++;
  }

  console.log(`[CARGO-CONFLICT-GUARD] applied: gaps=${result.gapsIdentified}, deactivated=${result.factsDeactivated}, guards=[${result.guardKeys.join(", ")}]`);
  return result;
}

// =====================================================================
// EMAIL-DOC-PROVENANCE-GUARD-1
// Prevent an OLD SODATRA quotation/PDF — attached to an internal/outbound
// SODATRA email — from acting as an ACTIVE cargo source when the latest
// inbound client email explicitly states a newer version of the request.
//
// Conservative by construction: a document is only treated as "historical
// SODATRA quotation" when its owning email is SODATRA AND a quotation/offer/
// proforma/duty-tax signal is present (a SODATRA email merely forwarding a
// client document is NOT flagged). A cargo fact is only declassed when its
// own source excerpt is traceable to such a document AND the latest client
// body does NOT re-confirm that excerpt. Never writes a corrected value,
// never touches operator/manual_input, never blocks routing/contact facts,
// never blocks all SODATRA attachments. Pure helpers are unit-testable.
// =====================================================================

const DOC_PROVENANCE_GAP_KEY = "cargo.document_provenance_conflict";

const DOC_PROVENANCE_GUARDED_CARGO_KEYS_ALWAYS = new Set([
  "cargo.pieces_count",
  "cargo.weight_kg",
  "cargo.value",
]);

const DOC_PROVENANCE_GAP_QUESTION = {
  fr: "Une ancienne cotation/PDF SODATRA a ete detectee comme source cargo alors que le dernier email client indique une demande mise a jour. Confirmer les donnees cargo (nombre, poids, valeur, conteneurs) a partir de la derniere demande client.",
  en: "An old SODATRA quotation/PDF was detected as a cargo source while the latest client email states an updated request. Please confirm the cargo data (count, weight, value, containers) from the latest client request.",
};

// Explicit "the request has changed" signals in the latest inbound client body.
const CLIENT_UPDATE_SIGNAL_PATTERNS: RegExp[] = [
  /\bupdate[ds]?\b/i,
  /\bincrease[d]?\s+to\b/i,
  /\btotal\s+bus(?:es)?\s+count\b/i,
  /\badditionally\b/i,
  /\b(?:has|have)\s+been\s+added\b/i,
  /\brevised\b/i,
  /\bchanged\b/i,
  /\binstead\b/i,
  /\bignore\s+(?:the\s+)?previous\b/i,
  /\bnow\b/i,
];

export function hasRecentClientUpdateSignal(text: string): boolean {
  const t = String(text || "");
  if (!t.trim()) return false;
  return CLIENT_UPDATE_SIGNAL_PATTERNS.some((re) => re.test(t));
}

const QUOTATION_DOC_FILENAME_RE = /(quotation|cotation|devis|offer|offre|proforma|pro[\s_-]?forma|quote)/i;
const QUOTATION_DOC_TEXT_RE =
  /(quotation|cotation|devis|proforma|pro[\s_-]?forma|\boffer\b|\boffre\b|duty\s+and\s+tax|droits?\s+et\s+taxes?)/i;

/**
 * An attachment is a likely-historical SODATRA quotation ONLY when its owning
 * email is SODATRA (internal/outbound) AND at least one quotation/offer/
 * proforma/duty-tax signal appears in the filename or extracted text. SODATRA
 * simply forwarding a client document (no quotation signal) is NOT flagged.
 */
export function looksLikeHistoricalSodatraQuotationDoc(input: {
  ownerIsSodatra: boolean;
  filename?: string | null;
  extractedText?: string | null;
}): boolean {
  if (!input.ownerIsSodatra) return false;
  const filename = String(input.filename || "");
  const text = String(input.extractedText || "");
  if (QUOTATION_DOC_FILENAME_RE.test(filename)) return true;
  if (QUOTATION_DOC_TEXT_RE.test(text)) return true;
  return false;
}

export function normalizeProvenanceText(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DOC_PROVENANCE_MIN_EXCERPT_LEN = 8;

/**
 * True when a fact's source excerpt is found (normalized substring) inside one
 * of the historical SODATRA quotation documents. Requires a minimum length to
 * avoid trivial matches.
 */
export function excerptComesFromHistoricalDoc(
  excerpt: string | null | undefined,
  historicalDocTexts: string[],
): boolean {
  const normExcerpt = normalizeProvenanceText(excerpt || "");
  if (normExcerpt.length < DOC_PROVENANCE_MIN_EXCERPT_LEN) return false;
  return (historicalDocTexts || []).some((doc) => {
    const normDoc = normalizeProvenanceText(doc);
    return normDoc.length > 0 && normDoc.includes(normExcerpt);
  });
}

/**
 * cargo.pieces_count / weight_kg / value are always guarded. cargo.containers
 * is guarded only when the latest client body shows an addition / distinct
 * goods (so a client that merely re-confirms the same containers is not blocked).
 */
export function isDocProvenanceGuardedCargoKey(key: string, latestInboundBody: string): boolean {
  if (DOC_PROVENANCE_GUARDED_CARGO_KEYS_ALWAYS.has(key)) return true;
  if (key === "cargo.containers") {
    const body = String(latestInboundBody || "");
    return (
      detectMixedCargoScopeFromBody(body) ||
      /\b(?:additional|additionally|one\s+additional|extra)\b/i.test(body) ||
      /\b(?:has|have)\s+been\s+added\b/i.test(body)
    );
  }
  return false;
}

interface DocProvenanceCandidateFact {
  key: string;
  sourceExcerpt?: string | null;
}

interface DocProvenancePredicateCtx {
  latestInboundBody: string;
  historicalDocTexts: string[];
  normBody: string;
}

/**
 * Per-fact decision used by both the pre-write partition and the post-write
 * orchestrator. A cargo fact is "historical-doc sourced" when its key is
 * guarded, its excerpt is traceable to a historical SODATRA quotation doc, and
 * the same excerpt is NOT echoed by the latest client body (client did not
 * re-confirm it). Gating on update-signal / docs-present is the caller's job.
 */
function isHistoricalDocCargoFact(
  fact: DocProvenanceCandidateFact,
  ctx: DocProvenancePredicateCtx,
): boolean {
  if (!isDocProvenanceGuardedCargoKey(fact.key, ctx.latestInboundBody)) return false;
  const excerpt = fact.sourceExcerpt || "";
  if (!excerptComesFromHistoricalDoc(excerpt, ctx.historicalDocTexts)) return false;
  const normExcerpt = normalizeProvenanceText(excerpt);
  if (normExcerpt.length >= DOC_PROVENANCE_MIN_EXCERPT_LEN && ctx.normBody.includes(normExcerpt)) {
    return false; // client re-confirmed this excerpt → keep it
  }
  return true;
}

/**
 * Pure decision: returns the cargo fact keys that must NOT become active because
 * they originate from a historical SODATRA quotation document while the latest
 * client body explicitly signals an updated request. Returns [] unless BOTH an
 * update signal and at least one historical doc are present.
 */
export function detectHistoricalDocCargoFacts(input: {
  latestInboundBody: string;
  historicalDocTexts: string[];
  candidateFacts: DocProvenanceCandidateFact[];
}): string[] {
  const body = String(input.latestInboundBody || "");
  if (!hasRecentClientUpdateSignal(body)) return [];
  if (!input.historicalDocTexts || input.historicalDocTexts.length === 0) return [];
  const ctx: DocProvenancePredicateCtx = {
    latestInboundBody: body,
    historicalDocTexts: input.historicalDocTexts,
    normBody: normalizeProvenanceText(body),
  };
  const flagged = (input.candidateFacts || [])
    .filter((f) => isHistoricalDocCargoFact(f, ctx))
    .map((f) => f.key);
  return [...new Set(flagged)];
}

/**
 * Runtime helper: collect the extracted text of attachments that are likely a
 * historical SODATRA quotation (owning email is SODATRA + quotation signal).
 */
function collectHistoricalSodatraQuotationDocTexts(
  emails: any[],
  attachments: any[],
): string[] {
  const emailById = new Map<string, any>();
  for (const e of emails || []) emailById.set(e.id, e);
  const texts: string[] = [];
  for (const att of attachments || []) {
    const owner = emailById.get(att.email_id);
    const ownerIsSodatra = isSodatraEmail(owner?.from_address || "");
    if (!ownerIsSodatra) continue;
    const extractedText =
      att.extracted_text || (att.extracted_data ? JSON.stringify(att.extracted_data) : "");
    if (
      looksLikeHistoricalSodatraQuotationDoc({
        ownerIsSodatra,
        filename: att.filename,
        extractedText,
      })
    ) {
      if (extractedText && String(extractedText).trim()) texts.push(String(extractedText));
    }
  }
  return texts;
}

/**
 * Pre-write partition: split AI-extracted facts into the ones to write (kept)
 * and the cargo facts to drop because they come from a historical SODATRA
 * quotation document while the client signalled an update. No-op (everything
 * kept) unless gated by update-signal + historical docs present.
 */
function partitionCargoFactsByHistoricalDocProvenance(
  facts: ExtractedFact[],
  ctx: { latestInboundBody: string; historicalDocTexts: string[] },
): { kept: ExtractedFact[]; dropped: ExtractedFact[] } {
  const body = String(ctx.latestInboundBody || "");
  if (!hasRecentClientUpdateSignal(body)) return { kept: facts, dropped: [] };
  if (!ctx.historicalDocTexts || ctx.historicalDocTexts.length === 0) {
    return { kept: facts, dropped: [] };
  }
  const pctx: DocProvenancePredicateCtx = {
    latestInboundBody: body,
    historicalDocTexts: ctx.historicalDocTexts,
    normBody: normalizeProvenanceText(body),
  };
  const kept: ExtractedFact[] = [];
  const dropped: ExtractedFact[] = [];
  for (const f of facts) {
    if (isHistoricalDocCargoFact({ key: f.key, sourceExcerpt: f.sourceExcerpt }, pctx)) {
      dropped.push(f);
    } else {
      kept.push(f);
    }
  }
  return { kept, dropped };
}

/**
 * Post-write orchestrator: deactivates currently-active cargo facts that are
 * traceable to a historical SODATRA quotation document (e.g. written by a prior
 * build run) and raises an idempotent blocking gap. Reuses
 * deactivateConflictingCargoFact (operator/manual_input always protected) and
 * ensureDeterministicBlockingGap (idempotent gap). Never writes a value.
 */
export async function applyEmailDocProvenanceGuard(args: {
  case_id: string;
  serviceClient: any;
  latestInboundBody: string;
  historicalDocTexts: string[];
  preWriteDroppedFactKeys?: string[];
}): Promise<{ gapsIdentified: number; factsDeactivated: number; declassedKeys: string[] }> {
  const result = { gapsIdentified: 0, factsDeactivated: 0, declassedKeys: [] as string[] };
  const body = String(args.latestInboundBody || "");
  const historicalDocTexts = args.historicalDocTexts || [];
  const preDropped = args.preWriteDroppedFactKeys || [];

  // Gate: explicit client update signal AND at least one historical SODATRA quotation doc.
  if (!hasRecentClientUpdateSignal(body)) return result;
  if (historicalDocTexts.length === 0) return result;

  const { data: currentFactRows } = await args.serviceClient
    .from("quote_facts")
    .select("fact_key, value_text, value_number, source_type, source_excerpt")
    .eq("case_id", args.case_id)
    .eq("is_current", true)
    .in("fact_key", ["cargo.pieces_count", "cargo.weight_kg", "cargo.value", "cargo.containers"]);

  const pctx: DocProvenancePredicateCtx = {
    latestInboundBody: body,
    historicalDocTexts,
    normBody: normalizeProvenanceText(body),
  };

  for (const row of currentFactRows || []) {
    if (!isHistoricalDocCargoFact({ key: row.fact_key, sourceExcerpt: row.source_excerpt }, pctx)) {
      continue;
    }
    const deactivated = await deactivateConflictingCargoFact(
      args.serviceClient,
      args.case_id,
      row.fact_key,
      (f) => isHistoricalDocCargoFact({ key: row.fact_key, sourceExcerpt: f.source_excerpt }, pctx),
    );
    if (deactivated) {
      result.factsDeactivated++;
      result.declassedKeys.push(row.fact_key);
    }
  }

  const declassedSomething = result.factsDeactivated > 0 || preDropped.length > 0;
  if (declassedSomething) {
    const created = await ensureDeterministicBlockingGap(args.serviceClient, {
      case_id: args.case_id,
      gap_key: DOC_PROVENANCE_GAP_KEY,
      gap_category: "cargo",
      question_fr: DOC_PROVENANCE_GAP_QUESTION.fr,
      question_en: DOC_PROVENANCE_GAP_QUESTION.en,
    });
    if (created) result.gapsIdentified++;
    if (result.declassedKeys.length === 0) result.declassedKeys.push(...preDropped);
  }

  console.log(
    `[DOC-PROVENANCE-GUARD] applied: gaps=${result.gapsIdentified}, deactivated=${result.factsDeactivated}, declassed=[${result.declassedKeys.join(", ")}], preDropped=[${preDropped.join(", ")}]`,
  );
  return result;
}

// =====================================================================
// PIECES-COUNT-LATEST-CLIENT-GUARD-1
// The latest explicit client bus total wins over any non-protected
// cargo.pieces_count (e.g. a "5" extracted by ai_extraction/attachment from an
// old PDF). Standalone safety net wired after the cargo-conflict and doc-
// provenance guards.
//
// Why a dedicated guard: CARGO-CONFLICT-GUARD-GWC-1 DETECTS the conflict using
// (value_number ?? value_text) but its DEACTIVATION predicate inspects
// value_number only — so a pieces_count stored as value_text (value_number
// null) survived as current while weight/value (excerpt-driven deactivation)
// were declassed. This guard deactivates on value_number OR value_text, and is
// independent of the fact's excerpt and of historical-document detection.
//
// Conservative: no-op when no explicit client total, when the value already
// matches, when nothing is current, or when the source is operator/manual_input.
// Never writes a corrected value. Never touches quote_request_lines, never
// launches pricing.
// =====================================================================

const PIECES_COUNT_CONFLICT_GAP_KEY = "cargo.pieces_count_conflict";

function buildPiecesCountConflictQuestion(
  clientBusTotal: number,
  currentVal: number,
): { fr: string; en: string } {
  return {
    fr: `Le dernier email client indique un total explicite de ${clientBusTotal} bus, mais une autre source a produit ${currentVal} piece(s). Confirmer la quantite finale a coter.`,
    en: `The latest client email states an explicit total of ${clientBusTotal} buses, but another source produced ${currentVal} piece(s). Please confirm the final quantity to quote.`,
  };
}

export async function applyLatestClientPiecesCountGuard(args: {
  case_id: string;
  serviceClient: any;
  latestInboundBody: string;
}): Promise<{
  gapsIdentified: number;
  factsDeactivated: number;
  clientBusTotal: number | null;
  currentPiecesCount: number | null;
}> {
  const result = {
    gapsIdentified: 0,
    factsDeactivated: 0,
    clientBusTotal: null as number | null,
    currentPiecesCount: null as number | null,
  };
  const body = String(args.latestInboundBody || "");
  if (!body.trim()) return result;

  // Explicit total from the latest inbound client body (reuses existing patterns).
  const clientBusTotal = extractExplicitBusTotalFromLatestInboundBody(body);
  result.clientBusTotal = clientBusTotal;
  if (clientBusTotal === null || clientBusTotal <= 0) return result; // no explicit total → no-op

  const { data: existingFact } = await args.serviceClient
    .from("quote_facts")
    .select("id, value_number, value_text, source_type, source_excerpt")
    .eq("case_id", args.case_id)
    .eq("fact_key", "cargo.pieces_count")
    .eq("is_current", true)
    .maybeSingle();

  if (!existingFact?.id) return result; // nothing current to guard

  // Parse the current value from number OR text (this is the storage-agnostic fix).
  const currentVal = toFiniteNumber(existingFact.value_number ?? existingFact.value_text);
  result.currentPiecesCount = currentVal;

  // Already matches the explicit client total, or unparseable → no-op (never invent).
  if (currentVal === null || currentVal === clientBusTotal) return result;

  // Conflict detected → maintain an idempotent blocking gap with dynamic wording.
  const q = buildPiecesCountConflictQuestion(clientBusTotal, currentVal);
  const created = await ensureDeterministicBlockingGap(args.serviceClient, {
    case_id: args.case_id,
    gap_key: PIECES_COUNT_CONFLICT_GAP_KEY,
    gap_category: "cargo",
    question_fr: q.fr,
    question_en: q.en,
  });
  if (created) result.gapsIdentified++;

  // Deactivate only a non-protected current value. deactivateConflictingCargoFact
  // protects operator/manual_input and restricts to non-protected auto-extraction
  // sources (ai_extraction / attachment_extracted) — which covers the PDF-sourced fact.
  const source = existingFact.source_type ?? "";
  if (MANUAL_PROTECTED_SOURCES.has(source)) {
    console.log(
      `[PIECES-COUNT-GUARD] client total=${clientBusTotal} != current pieces_count=${currentVal} from protected source '${source}' — gap raised, fact left untouched`,
    );
  } else {
    const deactivated = await deactivateConflictingCargoFact(
      args.serviceClient,
      args.case_id,
      "cargo.pieces_count",
      (f) => {
        const v = toFiniteNumber(f.value_number ?? f.value_text);
        return v !== null && v !== clientBusTotal;
      },
    );
    if (deactivated) result.factsDeactivated++;
  }

  console.log(
    `[PIECES-COUNT-GUARD] applied: clientTotal=${clientBusTotal}, currentPiecesCount=${currentVal}, gaps=${result.gapsIdentified}, deactivated=${result.factsDeactivated}`,
  );
  return result;
}

// =====================================================================
// THREAD-TEMPORAL-PROVENANCE-1 (generic, commodity-agnostic)
// A later inbound client email can amend or replace facts stated in an earlier
// one. These helpers reconcile the *value currency* in that situation: when the
// client thread states exactly one explicit currency, a DIFFERENT stored
// currency from a non-manual source must not silently stand. Pure helpers are
// unit-testable; the orchestrator only raises a blocking gap and removes the
// clearly-superseded non-manual fact. Never converts, never invents a value.
// No commodity-specific (bus/medical/etc.) or currency-specific rule.
// =====================================================================

// ISO-4217 currency tokens recognised in free client text (extensible vocabulary).
const CLIENT_CURRENCY_TOKENS: Array<{ code: string; re: RegExp }> = [
  { code: "QAR", re: /\bQAR\b|\bQR\b|QATARI?\s*RIYALS?/i },
  { code: "EUR", re: /\bEUR\b|\u20AC|\bEUROS?\b/i },
  { code: "USD", re: /\bUSD\b|\bUS\$|\$US\b/i },
  { code: "XOF", re: /\bXOF\b|\bFCFA\b|\bCFA\b/i },
  { code: "GBP", re: /\bGBP\b|\u00A3/i },
  { code: "AED", re: /\bAED\b|\bDIRHAMS?\b/i },
  { code: "SAR", re: /\bSAR\b|SAUDI\s*RIYALS?/i },
  { code: "CNY", re: /\bCNY\b|\bRMB\b|\bYUAN\b/i },
];

/** Distinct explicit client currency codes present in the text (order-stable). */
export function detectExplicitClientCurrencies(text: string): string[] {
  const t = String(text || "");
  if (!t.trim()) return [];
  const out: string[] = [];
  for (const { code, re } of CLIENT_CURRENCY_TOKENS) {
    if (re.test(t) && !out.includes(code)) out.push(code);
  }
  return out;
}

/**
 * Normalise a stored currency value (code or symbol) to an ISO-4217 code so it
 * can be compared with a detected client currency. Returns null when unknown.
 */
export function normalizeCurrencyCode(raw: string): string | null {
  const v = String(raw || "").toUpperCase().trim();
  if (!v) return null;
  if (v === "\u20AC") return "EUR";
  if (v === "$") return "USD";
  if (v === "\u00A3") return "GBP";
  for (const { code, re } of CLIENT_CURRENCY_TOKENS) {
    if (re.test(v)) return code;
  }
  return /^[A-Z]{3}$/.test(v) ? v : null;
}

/**
 * Generic decision: the client thread states exactly ONE explicit currency and
 * the stored value currency resolves to a DIFFERENT code -> the stored one is
 * superseded by the client's explicit currency. Returns the client currency in
 * that case, otherwise null (ambiguous / matching / unknown -> no-op). Currency
 * agnostic: works for any ISO code, not just QAR<->EUR.
 */
export function resolveClientCurrencyOverride(
  clientText: string,
  storedCurrencyRaw: string | null | undefined,
): string | null {
  const clientCurrencies = detectExplicitClientCurrencies(clientText);
  if (clientCurrencies.length !== 1) return null; // none or ambiguous -> no-op
  const stored = normalizeCurrencyCode(storedCurrencyRaw ?? "");
  if (!stored) return null;
  return stored !== clientCurrencies[0] ? clientCurrencies[0] : null;
}

/**
 * Decide which currency the client thread expresses, giving the latest inbound
 * email precedence (a later email amends earlier ones):
 *  - if the LATEST inbound text states exactly one explicit currency, it wins;
 *  - else fall back to the whole thread only if IT has exactly one explicit
 *    currency;
 *  - otherwise (none, or ambiguous at both levels) return null -> conservative
 *    no-op. Pure and currency-agnostic.
 */
export function resolveThreadClientCurrency(
  latestInboundText: string,
  fullThreadText: string,
): string | null {
  const latest = detectExplicitClientCurrencies(latestInboundText);
  if (latest.length === 1) return latest[0];
  const all = detectExplicitClientCurrencies(fullThreadText);
  return all.length === 1 ? all[0] : null;
}

const VALUE_CURRENCY_CONFLICT_GAP_KEY = "cargo.value_currency_conflict";

function buildValueCurrencyConflictQuestion(clientCurrency: string, storedCurrency: string): { fr: string; en: string } {
  return {
    fr: `Le dernier email client indique la valeur en ${clientCurrency}, mais la devise enregistree est ${storedCurrency}. Confirmer la devise et la valeur marchandise a coter (aucune conversion automatique).`,
    en: `The latest client email states the value in ${clientCurrency}, but the stored currency is ${storedCurrency}. Please confirm the currency and the goods value to quote (no automatic conversion).`,
  };
}

/**
 * Generic value-currency reconciliation. The client currency is resolved with
 * the LATEST inbound email taking precedence (resolveThreadClientCurrency): if
 * it differs from the stored cargo.value_currency, the stored value must not
 * silently stand -> raise a blocking confirmation gap and deactivate the stored
 * currency when it comes from a non-manual source. If the latest inbound is
 * ambiguous, fall back to the whole thread only when IT has a single explicit
 * currency; otherwise no-op. Never overwrites operator/manual_input; never
 * converts; never invents a value.
 */
export async function applyClientValueCurrencyGuard(args: {
  case_id: string;
  serviceClient: any;
  latestInboundText: string;
  fullThreadText: string;
}): Promise<{ gapsIdentified: number; factsDeactivated: number; clientCurrencies: string[] }> {
  const result = { gapsIdentified: 0, factsDeactivated: 0, clientCurrencies: [] as string[] };
  const latestInboundText = String(args.latestInboundText || "");
  const fullThreadText = String(args.fullThreadText || "");

  // Latest inbound primes; else whole thread only if single; else no-op.
  const clientCurrency = resolveThreadClientCurrency(latestInboundText, fullThreadText);
  if (!clientCurrency) return result; // none or ambiguous at both levels -> no-op
  result.clientCurrencies = [clientCurrency];

  const { data: existingFact } = await args.serviceClient
    .from("quote_facts")
    .select("id, value_text, source_type")
    .eq("case_id", args.case_id)
    .eq("fact_key", "cargo.value_currency")
    .eq("is_current", true)
    .maybeSingle();

  if (!existingFact?.id) return result; // nothing stored -> never invent a currency

  const storedRaw = String(existingFact.value_text || "").trim();
  const storedCode = normalizeCurrencyCode(storedRaw);
  if (!storedCode || storedCode === clientCurrency) return result; // unknown / matching -> no-op

  const source = existingFact.source_type ?? "";

  const q = buildValueCurrencyConflictQuestion(clientCurrency, storedCode);
  const created = await ensureDeterministicBlockingGap(args.serviceClient, {
    case_id: args.case_id,
    gap_key: VALUE_CURRENCY_CONFLICT_GAP_KEY,
    gap_category: "cargo",
    question_fr: q.fr,
    question_en: q.en,
  });
  if (created) result.gapsIdentified++;

  if (!MANUAL_PROTECTED_SOURCES.has(source)) {
    await args.serviceClient
      .from("quote_facts")
      .update({ is_current: false, updated_at: new Date().toISOString() })
      .eq("id", existingFact.id);
    result.factsDeactivated++;
    console.log(`[CURRENCY-GUARD] Deactivated stored value_currency=${storedCode} (source=${source}); client states ${clientCurrency}`);
  } else {
    console.log(`[CURRENCY-GUARD] value_currency=${storedCode} from protected source '${source}' - gap raised, fact left untouched`);
  }

  console.log(
    `[CURRENCY-GUARD] applied: clientCurrencies=[${result.clientCurrencies.join(",")}], gaps=${result.gapsIdentified}, deactivated=${result.factsDeactivated}`,
  );
  return result;
}

type ExportSeaFreightOrchestrationResult = {
  gapCreated: boolean;
  gapMaintained: boolean;
  gapResolved: boolean;
  requestCreated: boolean;
  requestAlreadyExists: boolean;
  coveredByPartnerFact: boolean;
};

function readFactText(facts: Array<Record<string, any>>, key: string): string {
  const fact = facts.find((f) => f.fact_key === key);
  if (!fact) return "";
  if (fact.value_text != null && String(fact.value_text).trim()) return String(fact.value_text).trim();
  if (fact.value_number != null) return String(fact.value_number).trim();
  if (fact.value_json != null) return JSON.stringify(fact.value_json);
  return "";
}

function formatContainerSummary(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  return raw
    .map((c: any) => {
      const quantity = Number(c?.quantity ?? c?.count ?? 1);
      const type = String(c?.type ?? c?.container_type ?? "").trim();
      if (!type) return "";
      return `${Number.isFinite(quantity) && quantity > 0 ? quantity : 1}x${type}`;
    })
    .filter(Boolean)
    .join(" + ");
}

function buildExportSeaFreightPurposeDetail(facts: Array<Record<string, any>>): string {
  const containersFact = facts.find((f) => f.fact_key === "cargo.containers");
  const containerSummary =
    formatContainerSummary(containersFact?.value_json) ||
    [
      readFactText(facts, "cargo.container_count"),
      readFactText(facts, "cargo.container_type"),
    ].filter(Boolean).join("x");
  const weight = readFactText(facts, "cargo.weight_kg");
  const freeTime =
    readFactText(facts, "pricing.destination_free_time_days") ||
    readFactText(facts, "timing.destination_free_time_days");

  const lines = [
    ["Origine", readFactText(facts, "routing.origin_port")],
    ["Destination", readFactText(facts, "routing.destination_port")],
    ["Destination finale", readFactText(facts, "routing.final_destination")],
    ["Incoterm", readFactText(facts, "routing.incoterm")],
    ["Conteneurs", containerSummary],
    ["Poids", weight ? `${weight} kg` : ""],
    ["Free time destination", freeTime ? `${freeTime} jours` : ""],
    ["Package", "EXPORT_SENEGAL"],
    ["Service requis", "SEA_FREIGHT"],
  ];

  return lines
    .filter(([, value]) => String(value ?? "").trim().length > 0)
    .map(([label, value]) => `${label} : ${value}`)
    .join("\n");
}

export async function ensureExportSeaFreightPartnerOrchestration(args: {
  case_id: string;
  serviceClient: any;
  facts?: Array<Record<string, any>> | null;
}): Promise<ExportSeaFreightOrchestrationResult> {
  const result: ExportSeaFreightOrchestrationResult = {
    gapCreated: false,
    gapMaintained: false,
    gapResolved: false,
    requestCreated: false,
    requestAlreadyExists: false,
    coveredByPartnerFact: false,
  };

  const factKeys = [
    "service.package",
    "routing.origin_port",
    "routing.destination_port",
    "routing.final_destination",
    "routing.incoterm",
    "cargo.containers",
    "cargo.container_count",
    "cargo.container_type",
    "cargo.weight_kg",
    "pricing.destination_free_time_days",
    "timing.destination_free_time_days",
  ];

  let facts = args.facts ?? null;
  if (!facts) {
    const { data, error } = await args.serviceClient
      .from("quote_facts")
      .select("fact_key, value_text, value_number, value_json")
      .eq("case_id", args.case_id)
      .eq("is_current", true)
      .in("fact_key", factKeys);
    if (error) {
      console.warn("[EXPORT-SEA-FREIGHT] Failed to read facts:", error.message);
      return result;
    }
    facts = (data as Record<string, any>[] | null) || [];
  }

  const servicePackage = readFactText(facts, "service.package").toUpperCase();
  if (servicePackage !== "EXPORT_SENEGAL") return result;

  const { data: freightRequests, error: reqErr } = await args.serviceClient
    .from("external_quote_requests")
    .select("id, status, purpose")
    .eq("case_id", args.case_id)
    .eq("purpose", "freight_rate");

  if (reqErr) {
    console.warn("[EXPORT-SEA-FREIGHT] Failed to read freight partner requests:", reqErr.message);
    return result;
  }

  const requestRows = freightRequests || [];
  const openFreightRequests = requestRows.filter((r: any) => r.status !== "closed");
  const freightRequestIds = new Set(requestRows.map((r: any) => String(r.id)));

  const { data: partnerFacts, error: factsErr } = await args.serviceClient
    .from("external_quote_response_facts")
    .select("id, request_id, fact_key, validation_status")
    .eq("case_id", args.case_id);

  if (factsErr) {
    console.warn("[EXPORT-SEA-FREIGHT] Failed to read partner response facts:", factsErr.message);
    return result;
  }

  const hasFreightFact = (partnerFacts || []).some((f: any) => {
    const factKey = String(f.fact_key || "").trim();
    const status = String(f.validation_status || "").trim();
    if (status !== "validated") return false;
    if (!EXPORT_SEA_FREIGHT_PARTNER_FACT_KEYS.has(factKey)) return false;
    const requestId = String(f.request_id || "");
    return freightRequestIds.size === 0 || freightRequestIds.has(requestId);
  });

  const covered = hasFreightFact;
  result.coveredByPartnerFact = covered;

  const { data: existingGap } = await args.serviceClient
    .from("quote_gaps")
    .select("id")
    .eq("case_id", args.case_id)
    .eq("gap_key", EXPORT_SEA_FREIGHT_PARTNER_GAP_KEY)
    .eq("status", "open")
    .maybeSingle();

  if (covered) {
    if (existingGap?.id) {
      await args.serviceClient
        .from("quote_gaps")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("id", existingGap.id);
      result.gapResolved = true;
    }
    return result;
  }

  if (existingGap?.id) {
    result.gapMaintained = true;
  } else {
    await args.serviceClient.from("quote_gaps").insert({
      case_id: args.case_id,
      gap_key: EXPORT_SEA_FREIGHT_PARTNER_GAP_KEY,
      gap_category: "pricing",
      question_fr: "Une offre maritime partenaire est requise pour chiffrer le fret SEA_FREIGHT export.",
      question_en: "A partner ocean freight quote is required before pricing export SEA_FREIGHT.",
      priority: "critical",
      is_blocking: true,
    });
    result.gapCreated = true;
  }

  if (openFreightRequests.length > 0) {
    result.requestAlreadyExists = true;
    return result;
  }

  const { data: inserted, error: insertErr } = await args.serviceClient
    .from("external_quote_requests")
    .insert({
      case_id: args.case_id,
      partner_name: "À définir",
      partner_email: null,
      purpose: "freight_rate",
      purpose_detail: buildExportSeaFreightPurposeDetail(facts),
      related_lot_index: null,
      created_by: null,
      status: "draft",
    })
    .select("id")
    .single();

  if (insertErr) {
    console.warn("[EXPORT-SEA-FREIGHT] Failed to create freight_rate partner request:", insertErr.message);
    return result;
  }

  result.requestCreated = true;
  await args.serviceClient.from("case_timeline_events").insert({
    case_id: args.case_id,
    event_type: "external_request_created",
    actor_type: "system",
    new_value: "Demande partenaire auto: freight_rate (SEA_FREIGHT export)",
    event_data: {
      auto: true,
      request_id: inserted?.id,
      purpose: "freight_rate",
      service_key: "SEA_FREIGHT",
      gap_key: EXPORT_SEA_FREIGHT_PARTNER_GAP_KEY,
    },
  });

  return result;
}

function normalizeLocationKey(value: string): string {
  return String(value || '').toUpperCase().trim().replace(/\s+/g, ' ');
}

// FLOW-FIX-1: Normalize country names to ISO 2-letter codes
const COUNTRY_NAME_TO_ISO: Record<string, string> = {
  'SENEGAL': 'SN', 'SÉNÉGAL': 'SN',
  'INDIA': 'IN', 'INDE': 'IN',
  'FRANCE': 'FR',
  'CHINA': 'CN', 'CHINE': 'CN',
  'TURKEY': 'TR', 'TURQUIE': 'TR', 'TÜRKIYE': 'TR',
  'GAMBIA': 'GM', 'GAMBIE': 'GM',
  'MALI': 'ML',
  'GUINEA': 'GN', 'GUINÉE': 'GN', 'GUINEE': 'GN',
  'IVORY COAST': 'CI', "CÔTE D'IVOIRE": 'CI', 'COTE D\'IVOIRE': 'CI',
  'GHANA': 'GH',
  'NIGERIA': 'NG', 'NIGÉRIA': 'NG',
  'EGYPT': 'EG', 'EGYPTE': 'EG', 'ÉGYPTE': 'EG',
  'BURKINA FASO': 'BF',
  'NIGER': 'NE',
  'MAURITANIA': 'MR', 'MAURITANIE': 'MR',
  'GERMANY': 'DE', 'ALLEMAGNE': 'DE',
  'NETHERLANDS': 'NL', 'PAYS-BAS': 'NL',
  'BELGIUM': 'BE', 'BELGIQUE': 'BE',
  'UNITED ARAB EMIRATES': 'AE', 'UAE': 'AE',
  'SAUDI ARABIA': 'SA', 'ARABIE SAOUDITE': 'SA',
  'BANGLADESH': 'BD',
  'SRI LANKA': 'LK',
  'GUINEA-BISSAU': 'GW', 'GUINÉE-BISSAU': 'GW',
  'TOGO': 'TG',
  'BENIN': 'BJ', 'BÉNIN': 'BJ',
  'UNITED KINGDOM': 'GB', 'ROYAUME-UNI': 'GB', 'UK': 'GB',
  'UNITED STATES': 'US', 'USA': 'US', 'ÉTATS-UNIS': 'US',
  'SPAIN': 'ES', 'ESPAGNE': 'ES',
  'ITALY': 'IT', 'ITALIE': 'IT',
  'PORTUGAL': 'PT',
  'MOROCCO': 'MA', 'MAROC': 'MA',
  'SOUTH KOREA': 'KR', 'CORÉE DU SUD': 'KR',
  'JAPAN': 'JP', 'JAPON': 'JP',
  'BRAZIL': 'BR', 'BRÉSIL': 'BR',
  'PAKISTAN': 'PK',
  'THAILAND': 'TH', 'THAÏLANDE': 'TH',
  'VIETNAM': 'VN', 'VIÊT NAM': 'VN',
  'INDONESIA': 'ID', 'INDONÉSIE': 'ID',
  'MALAYSIA': 'MY', 'MALAISIE': 'MY',
  'SINGAPORE': 'SG', 'SINGAPOUR': 'SG',
  'CAMEROON': 'CM', 'CAMEROUN': 'CM',
  'CONGO': 'CG',
  'SIERRA LEONE': 'SL',
  'LIBERIA': 'LR', 'LIBÉRIA': 'LR',
};

function normalizeCountryToISO(raw: string): string {
  if (!raw) return '';
  const upper = raw.toUpperCase().trim();
  // Already ISO 2-letter code
  if (upper.length === 2) return upper;
  return COUNTRY_NAME_TO_ISO[upper] || upper;
}

async function resolveCountry(
  serviceClient: any,
  factMap: Map<string, { value: string; source: string }>,
  countryKey: string,
  portKey: string,
  cityKey?: string
): Promise<string> {
  // 1. Direct country fact — normalize to ISO
  const direct = factMap.get(countryKey)?.value?.toUpperCase()?.trim() || '';
  if (direct) return normalizeCountryToISO(direct);

  // 2. Collect candidates for DB + fallback lookup
  const rawPort = factMap.get(portKey)?.value || '';
  const rawCity = cityKey ? (factMap.get(cityKey)?.value || '') : '';
  const candidates: string[] = [];
  if (rawPort) candidates.push(normalizeLocationKey(rawPort));
  if (rawCity) candidates.push(normalizeLocationKey(rawCity));

  // 3. DB lookup on location_aliases → locations_reference
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const { data, error } = await serviceClient
        .from('location_aliases')
        .select('locations_reference!inner(country_code)')
        .eq('normalized_alias', candidate)
        .eq('locations_reference.is_active', true)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error(`[LocationResolution] DB lookup failed for "${candidate}":`, error);
        // continue to fallback — no throw, no break
      } else if (data?.locations_reference?.country_code) {
        console.log(`[LocationResolution] DB hit: "${candidate}" → ${data.locations_reference.country_code}`);
        return data.locations_reference.country_code;
      }
    } catch (err) {
      console.error(`[LocationResolution] Unexpected error for "${candidate}":`, err);
      // continue to fallback
    }
  }

  // 4. Fallback PORT_COUNTRY_MAP — exact match
  for (const candidate of candidates) {
    if (!candidate) continue;
    const mapped = PORT_COUNTRY_MAP[candidate];
    if (mapped) return mapped;
  }

  // 5. Fallback PORT_COUNTRY_MAP — partial match
  for (const candidate of candidates) {
    if (!candidate) continue;
    for (const [portName, code] of Object.entries(PORT_COUNTRY_MAP)) {
      if (candidate.includes(portName)) return code;
    }
  }

  // 6. Log unknown locations for production monitoring
  if (rawPort || rawCity) {
    console.warn(
      `[LocationResolution] Unknown location — port="${String(rawPort || '')}", city="${String(rawCity || '')}", countryKey="${String(countryKey || '')}"`
    );
  }

  return '';
}

async function detectFlowType(serviceClient: any, factMap: Map<string, { value: string; source: string }>): Promise<string> {
  const destCountry = await resolveCountry(serviceClient, factMap, 'routing.destination_country', 'routing.destination_port', 'routing.destination_city');
  const originCountry = await resolveCountry(serviceClient, factMap, 'routing.origin_country', 'routing.origin_port');
  const finalDest = factMap.get('routing.final_destination')?.value?.toUpperCase() || '';
  const originPort = factMap.get('routing.origin_port')?.value?.toUpperCase() || '';
  const weightKg = parseFloat(factMap.get('cargo.weight_kg')?.value || '0') || 0;
  const cargoDesc = factMap.get('cargo.description')?.value?.toLowerCase() || '';
  // service.package is an OUTPUT of detectFlowType, not an INPUT — never read it here
  const hasContainers = !!factMap.get('cargo.containers')?.value;

  console.log(`[M3.5.1] detectFlowType: destCountry=${destCountry}, originCountry=${originCountry}, finalDest=${finalDest}, weightKg=${weightKg}, hasContainers=${hasContainers}`);

  // Rule 1: Transit Gambia
  if (destCountry === 'GM' || finalDest.includes('BANJUL')) {
    return 'TRANSIT_GAMBIA';
  }

  // Rule 1b: Transit régional via Dakar (pays enclavés ML/BF/NE)
  const INLAND_TRANSIT_COUNTRIES = new Set(['ML', 'BF', 'NE']);
  const INLAND_TRANSIT_CITIES = ['BAMAKO', 'OUAGADOUGOU', 'NIAMEY'];
  const destPort = factMap.get('routing.destination_port')?.value?.toUpperCase() || '';
  const destCity = factMap.get('routing.destination_city')?.value?.toUpperCase() || '';
  const isGatewayDakar =
    destPort.includes('DAKAR') ||
    destPort.includes('DKR') ||
    destCity.includes('DAKAR');
  const inlandCountry = PORT_COUNTRY_MAP[finalDest] || PORT_COUNTRY_MAP[destCity] || '';
  const isInlandTransit =
    INLAND_TRANSIT_COUNTRIES.has(inlandCountry) ||
    INLAND_TRANSIT_CITIES.some(c => finalDest.includes(c) || destCity.includes(c));
  if (isGatewayDakar && isInlandTransit && originCountry !== 'SN') {
    return 'TRANSIT_REGIONAL_VIA_DAKAR';
  }

  // Rule 2: Export Senegal
  const isOriginSN = originCountry === 'SN' || originPort.includes('DKR') || originPort.includes('DAKAR');
  if (isOriginSN && destCountry && destCountry !== 'SN') {
    return 'EXPORT_SENEGAL';
  }

  // Rule 3: Breakbulk project (only if NO containers detected — FCL with heavy cargo is NOT breakbulk)
  const breakbulkKeywords = ['transformer', 'crane', 'heavy', 'breakbulk', 'lifting', 'rigging', 'heavy equipment'];
  if (!hasContainers && (weightKg > 30000 || breakbulkKeywords.some(kw => cargoDesc.includes(kw)))) {
    return 'BREAKBULK_PROJECT';
  }

  // Rule 4: Import project DAP (+ cargo.containers as project indicator)
  if (destCountry === 'SN') {
    const hasWeight = weightKg > 5000;
    if (hasWeight || hasContainers) {
      return 'IMPORT_PROJECT_DAP';
    }
    return 'IMPORT_PROJECT_DAP_PENDING';
  }

  return 'UNKNOWN';
}

async function applyAssumptionRules(
  caseId: string,
  serviceClient: any,
  emailIds: string[],
  requestType?: string
): Promise<{ added: number; skipped: number; flowType: string }> {
  const result = { added: 0, skipped: 0, flowType: 'UNKNOWN' };

  // Step 1: Load existing facts
  const { data: facts } = await serviceClient
    .from('quote_facts')
    .select('fact_key, value_text, value_number, value_json, source_type')
    .eq('case_id', caseId)
    .eq('is_current', true);

  const factMap = new Map<string, { value: string; source: string }>();
  if (facts) {
    for (const f of facts) {
      factMap.set(f.fact_key, {
        value: f.value_text || (f.value_json ? JSON.stringify(f.value_json) : '') || String(f.value_number || ''),
        source: f.source_type,
      });
    }
  }

  // Step 2: Detect flow type
  let flowType = await detectFlowType(serviceClient, factMap);

  // CTO Adjustment #2: For IMPORT_PROJECT_DAP_PENDING, check attachments
  if (flowType === 'IMPORT_PROJECT_DAP_PENDING') {
    const { count } = await serviceClient
      .from('email_attachments')
      .select('id', { count: 'exact', head: true })
      .in('email_id', emailIds)
      .not('extracted_data', 'is', null);

    if (count && count > 0) {
      flowType = 'IMPORT_PROJECT_DAP';
    } else {
      flowType = 'UNKNOWN';
    }
  }

  // A1 + C3.1-A: If requestType is AIR_IMPORT, force AIR_IMPORT regardless of detectFlowType result
  if (requestType === 'AIR_IMPORT' && flowType !== 'AIR_IMPORT') {
    console.log(`[M3.5.1] Flow override: ${flowType} -> AIR_IMPORT (requestType is AIR_IMPORT)`);
    flowType = 'AIR_IMPORT';
  }

  // A1 bis: If flowType is IMPORT_PROJECT_DAP but requestType is SEA_LCL_IMPORT, force LCL
  if (flowType === 'IMPORT_PROJECT_DAP' && requestType === 'SEA_LCL_IMPORT') {
    flowType = 'SEA_LCL_IMPORT';
  }

  // P3a: Incoterm-aware package selection
  const ORIGIN_INCOTERMS_P3 = new Set(['EXW', 'FCA', 'FAS']);
  const p3aIncoterm = String(factMap.get('routing.incoterm')?.value || '').toUpperCase();
  if (ORIGIN_INCOTERMS_P3.has(p3aIncoterm) && ASSUMPTION_RULES[`${flowType}_EXW`]) {
    console.log(`[P3a] Incoterm ${p3aIncoterm} detected — switching ${flowType} → ${flowType}_EXW`);
    flowType = `${flowType}_EXW`;
  } else if (p3aIncoterm === 'DDP' && ASSUMPTION_RULES[`${flowType}_DDP`]) {
    console.log(`[Package-DDP] Incoterm DDP detected — switching ${flowType} → ${flowType}_DDP`);
    flowType = `${flowType}_DDP`;
  }

  // FLOW-FIX-1: Port inference for maritime imports to Senegal
  // Only infer destination_port=Dakar for SEA imports to SN (not air/road/ambiguous)
  const MARITIME_IMPORT_FLOWS = new Set([
    'IMPORT_PROJECT_DAP', 'IMPORT_PROJECT_DAP_EXW',
    'SEA_LCL_IMPORT', 'TRANSIT_REGIONAL_VIA_DAKAR',
  ]);
  const destCountryForPort = await resolveCountry(serviceClient, factMap, 'routing.destination_country', 'routing.destination_port', 'routing.destination_city');
  const existingDestPort = factMap.get('routing.destination_port')?.value;
  if (
    MARITIME_IMPORT_FLOWS.has(flowType) &&
    destCountryForPort === 'SN' &&
    !existingDestPort
  ) {
    console.log(`[FLOW-FIX-1] Inferring routing.destination_port=Dakar for maritime import to SN (flow: ${flowType})`);
    const { error: portErr } = await serviceClient.rpc('supersede_fact', {
      p_case_id: caseId,
      p_fact_key: 'routing.destination_port',
      p_fact_category: 'routing',
      p_value_text: 'Dakar',
      p_value_number: null,
      p_value_json: null,
      p_value_date: null,
      p_source_type: 'port_inference',
      p_source_email_id: null,
      p_source_attachment_id: null,
      p_source_excerpt: '[FLOW-FIX-1] Senegal has one main commercial port: Dakar (PAD)',
      p_confidence: 0.85,
    });
    if (!portErr) {
      factMap.set('routing.destination_port', { value: 'Dakar', source: 'port_inference' });
      await serviceClient.from('case_timeline_events').insert({
        case_id: caseId,
        event_type: 'assumption_applied',
        event_data: {
          flow_type: flowType,
          fact_key: 'routing.destination_port',
          value: 'Dakar',
          confidence: 0.85,
          inference_rule: 'FLOW-FIX-1_SN_MONO_PORT',
        },
        actor_type: 'system',
      });
    } else {
      console.error('[FLOW-FIX-1] Failed to inject destination_port:', portErr);
    }
  }

  result.flowType = flowType;

  if (flowType === 'UNKNOWN' || !ASSUMPTION_RULES[flowType]) {
    console.log(`[M3.5.1] Flow type: ${flowType} — no assumptions to apply`);
    return result;
  }

  console.log(`[M3.5.1] Detected flow type: ${flowType}`);

  // Step 3: Apply rules
  const rules = ASSUMPTION_RULES[flowType];

  for (const rule of rules) {
    const existing = factMap.get(rule.key);

    // Hierarchy check: never overwrite protected sources
    if (existing && ASSUMPTION_PROTECTED_SOURCES.has(existing.source)) {
      result.skipped++;
      continue;
    }

    // Don't re-inject if already an ai_assumption with same value
    if (existing?.source === 'ai_assumption' && existing.value === rule.value) {
      result.skipped++;
      continue;
    }

    // Inject via supersede_fact RPC
    const { error: rpcError } = await serviceClient.rpc('supersede_fact', {
      p_case_id: caseId,
      p_fact_key: rule.key,
      p_fact_category: rule.key.split('.')[0],
      p_value_text: rule.value,
      p_value_number: null,
      p_value_json: null,
      p_value_date: null,
      p_source_type: 'ai_assumption',
      p_source_email_id: null,
      p_source_attachment_id: null,
      p_source_excerpt: `[M3.5.1] Auto-assumption for flow ${flowType}: ${rule.key} = ${rule.value}`,
      p_confidence: rule.confidence,
    });

    if (rpcError) {
      console.error(`[M3.5.1] Failed to inject assumption ${rule.key}:`, rpcError);
      continue;
    }

    // Timeline event
    await serviceClient.from('case_timeline_events').insert({
      case_id: caseId,
      event_type: 'assumption_applied',
      event_data: {
        flow_type: flowType,
        fact_key: rule.key,
        value: rule.value,
        confidence: rule.confidence,
      },
      actor_type: 'system',
    });

    result.added++;
    // Update local map to prevent duplicate injection in same pass
    factMap.set(rule.key, { value: rule.value, source: 'ai_assumption' });
  }

  console.log(`[M3.5.1] Assumptions: ${result.added} added, ${result.skipped} skipped (flow: ${flowType})`);
  return result;
}

function normalizeExtractedKey(key: string): string {
  // Remove _Page_N suffix and _BL_ infix variants
  return key.replace(/_Page_\d+$/, '').replace(/_BL_/, '_').replace(/_Page$/, '');
}

function parseWeight(raw: string): number | null {
  // "5,000 KG" -> 5000, "12.5 T" -> 12500
  const cleaned = raw.replace(/,/g, '').trim();
  const match = cleaned.match(/([\d.]+)\s*(kg|kgs|t|tons|tonnes)?/i);
  if (!match) return null;
  let value = parseFloat(match[1]);
  if (isNaN(value)) return null;
  const unit = (match[2] || 'kg').toLowerCase();
  if (unit === 't' || unit === 'tons' || unit === 'tonnes') value *= 1000;
  return value;
}

// A1: Robust number parser for cargo extraction
function parseRobustNumber(raw: string): number | null {
  // Remove spaces: "3 234" -> "3234"
  let cleaned = raw.replace(/\s/g, '');
  // Handle European format: "3.234,5" -> "3234.5"
  if (cleaned.includes(',') && cleaned.includes('.')) {
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      // European: 3.234,5
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // US: 3,234.5
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.includes(',')) {
    // Could be "3,234" (thousands) or "3,5" (decimal)
    const parts = cleaned.split(',');
    if (parts.length === 2 && parts[1].length === 3) {
      // Thousands separator: "3,234"
      cleaned = cleaned.replace(/,/g, '');
    } else {
      // Decimal: "3,5"
      cleaned = cleaned.replace(',', '.');
    }
  }
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

async function injectAttachmentFacts(
  caseId: string,
  serviceClient: any,
  emailIds: string[]
): Promise<{ added: number; updated: number; skipped: number }> {
  const result = { added: 0, updated: 0, skipped: 0 };

  if (!emailIds || emailIds.length === 0) return result;

  // 1. Load attachments with extracted_data
  const { data: attachments } = await serviceClient
    .from('email_attachments')
    .select('id, email_id, filename, extracted_data')
    .in('email_id', emailIds)
    .not('extracted_data', 'is', null);

  if (!attachments || attachments.length === 0) return result;

  // 2. CTO Adjustment #1: Read existing facts from DB (not from LLM output)
  const { data: existingFacts } = await serviceClient
    .from('quote_facts')
    .select('fact_key, source_type')
    .eq('case_id', caseId)
    .eq('is_current', true);

  const factSourceMap = new Map<string, string>();
  if (existingFacts) {
    for (const f of existingFacts) {
      factSourceMap.set(f.fact_key, f.source_type);
    }
  }

  // Track which fact_keys we've already injected in this pass (first occurrence wins)
  const injectedKeys = new Set<string>();

  // --- COMPOSITE-DOC-2: Pre-pass on documents[] for prioritized fact extraction ---
  for (const attachment of attachments) {
    const documents = (attachment.extracted_data as any)?.documents;
    if (!Array.isArray(documents) || documents.length === 0) continue;

    for (const [targetFactKey, priorityList] of Object.entries(DOC_TYPE_PRIORITY)) {
      if (injectedKeys.has(targetFactKey)) continue;
      const existingSource = factSourceMap.get(targetFactKey);
      if (MANUAL_PROTECTED_SOURCES.has(existingSource ?? '')) continue;
      if (existingSource === 'attachment_extracted') continue;

      // Walk priority list: first doc_type with a valid value wins
      let bestValue: string | number | null = null;
      let bestDocType: string | null = null;

      for (const preferredDocType of priorityList) {
        const doc = documents.find((d: any) => d?.doc_type === preferredDocType);
        if (!doc) continue;

        // Financial facts: scan tariff_lines inside the sub-document
        if (['cargo.value', 'cargo.value_currency', 'cargo.freight_cost', 'cargo.freight_currency'].includes(targetFactKey)) {
          const tls = Array.isArray(doc.tariff_lines) ? doc.tariff_lines : [];
          for (const tl of tls) {
            if (!tl || typeof tl !== 'object') continue;
            const svc = String(tl.service ?? tl.designation ?? '');
            const rawAmt = tl.amount ?? tl.montant;
            const amt = rawAmt == null ? null : (typeof rawAmt === 'number' ? rawAmt : parseRobustNumber(String(rawAmt)));
            const cur = String(tl.currency ?? tl.devise ?? '').trim() || null;

            if (targetFactKey === 'cargo.value' && /\b(?:CFR|CAF|CIF)\b/i.test(svc) && amt != null && amt > 0) {
              bestValue = amt; bestDocType = preferredDocType; break;
            }
            if (targetFactKey === 'cargo.value_currency' && /\b(?:CFR|CAF|CIF)\b/i.test(svc) && cur) {
              bestValue = cur; bestDocType = preferredDocType; break;
            }
            if (targetFactKey === 'cargo.freight_cost' && /\b(?:FRET|FREIGHT)\b/i.test(svc) && amt != null && amt > 0) {
              bestValue = amt; bestDocType = preferredDocType; break;
            }
            if (targetFactKey === 'cargo.freight_currency' && /\b(?:FRET|FREIGHT)\b/i.test(svc) && cur) {
              bestValue = cur; bestDocType = preferredDocType; break;
            }
          }
          if (bestValue != null) break;
          continue;
        }

        // Non-financial facts: scan extracted_info via ATTACHMENT_FACT_MAPPING
        const info = doc.extracted_info;
        if (!info || typeof info !== 'object') continue;

        for (const [rawKey, rawVal] of Object.entries(info)) {
          if (rawVal == null || rawVal === '') continue;
          const normKey = normalizeExtractedKey(rawKey);
          const mapping = ATTACHMENT_FACT_MAPPING[normKey];
          if (!mapping || mapping.factKey !== targetFactKey) continue;

          if (mapping.valueType === 'number') {
            const num = typeof rawVal === 'number' ? rawVal : parseRobustNumber(String(rawVal));
            if (num != null && num > 0) { bestValue = num; bestDocType = preferredDocType; break; }
          } else {
            const txt = String(Array.isArray(rawVal) ? (rawVal as any[]).join(', ') : rawVal).trim();
            if (txt) { bestValue = txt; bestDocType = preferredDocType; break; }
          }
        }
        if (bestValue != null) break;
      }

      // --- CLIENT-COMPANY-GUARD: reject SODATRA in composite-doc flow ---
      if (targetFactKey === "contacts.client_company" && bestValue != null && isSodatraCompanyName(bestValue)) {
        console.log(`[client-company-guard] rejected composite-doc value "${bestValue}" as contacts.client_company`);
        continue;
      }

      // Inject if we found a valid value
      if (bestValue == null || bestDocType == null) continue;

      const mapping = Object.values(ATTACHMENT_FACT_MAPPING).find(m => m.factKey === targetFactKey);
      const category = mapping?.category ?? targetFactKey.split('.')[0];
      const isNum = typeof bestValue === 'number';

      const { error: rpcErr } = await serviceClient.rpc('supersede_fact', {
        p_case_id: caseId,
        p_fact_key: targetFactKey,
        p_fact_category: category,
        p_value_text: isNum ? null : String(bestValue),
        p_value_number: isNum ? bestValue : null,
        p_value_json: null,
        p_value_date: null,
        p_source_type: 'attachment_extracted',
        p_source_email_id: attachment.email_id || null,
        p_source_attachment_id: attachment.id,
        p_source_excerpt: `[COMPOSITE-DOC-2][${bestDocType}][${attachment.filename}] ${targetFactKey}`,
        p_confidence: 0.95,
      });

      if (!rpcErr) {
        injectedKeys.add(targetFactKey);
        factSourceMap.set(targetFactKey, 'attachment_extracted');
        result.added++;
        console.log(`[COMPOSITE-DOC-2] Injected ${targetFactKey} from ${bestDocType} in ${attachment.filename}`);
      } else {
        console.error(`[COMPOSITE-DOC-2] Failed ${targetFactKey} from ${bestDocType}:`, rpcErr);
      }
    }
  }
  // --- END COMPOSITE-DOC-2 pre-pass ---

  for (const attachment of attachments) {
    // Try both formats:
    // Format 1: extracted_data.extracted_info.* (packing lists, B/L)
    // Format 2: extracted_data.* (analyze-attachments quotations/MSDS)
    const extractedInfo = (attachment.extracted_data as any)?.extracted_info || attachment.extracted_data;
    if (!extractedInfo || typeof extractedInfo !== 'object') continue;

    for (const [rawKey, rawValue] of Object.entries(extractedInfo)) {
      if (rawValue == null || rawValue === '') continue;

      const normalizedKey = normalizeExtractedKey(rawKey);
      const mapping = ATTACHMENT_FACT_MAPPING[normalizedKey];
      if (!mapping) continue;

      // --- CLIENT-COMPANY-GUARD: reject SODATRA in attachment flow ---
      if (mapping.factKey === "contacts.client_company" && isSodatraCompanyName(rawValue)) {
        console.log(`[client-company-guard] rejected attachment value "${rawValue}" as contacts.client_company`);
        result.skipped++;
        continue;
      }

      // First occurrence wins for same fact_key
      if (injectedKeys.has(mapping.factKey)) continue;

      // Source priority: manual (operator|manual_input) > attachment_extracted > ai
      const existingSource = factSourceMap.get(mapping.factKey);
      if (MANUAL_PROTECTED_SOURCES.has(existingSource ?? '')) {
        result.skipped++;
        injectedKeys.add(mapping.factKey);
        continue;
      }
      if (existingSource === 'attachment_extracted') {
        result.skipped++;
        injectedKeys.add(mapping.factKey);
        continue;
      }

      // Prepare value
      let valueText: string | null = null;
      let valueNumber: number | null = null;
      let valueJson: any = null;

      const resolvedValue = Array.isArray(rawValue) ? rawValue : rawValue;

      if (mapping.factKey === "cargo.containers") {
        // P0 Fix: inject containers as structured JSON for run-pricing
        if (Array.isArray(resolvedValue) && resolvedValue.length > 0 && typeof resolvedValue[0] === "object") {
          valueJson = resolvedValue;
        } else {
          const asText = Array.isArray(resolvedValue) ? resolvedValue.join(", ") : String(resolvedValue);
          const parsed = parseContainersFromText(asText);
          if (parsed.length > 0) {
            valueJson = parsed;
          } else {
            // Fallback legacy: keep as text if parsing fails
            valueText = asText;
          }
        }
      } else {
        // Legacy behavior for all other facts
        const scalar = Array.isArray(resolvedValue) ? resolvedValue.join(", ") : resolvedValue;
        if (mapping.valueType === 'number') {
          valueNumber = parseRobustNumber(String(scalar));
          if (valueNumber === null) {
            valueText = String(scalar);
          }
        } else {
          valueText = String(scalar);
        }
      }

      // --- P0-F Patch C: Country validation guard ---
      const KNOWN_COUNTRIES = new Set([
        'MALI','SENEGAL','SÉNÉGAL','GUINEE','GUINÉE','GAMBIE','GAMBIA',
        'MAURITANIE','BURKINA','BURKINA FASO','NIGER',
        "COTE D'IVOIRE","CÔTE D'IVOIRE",'GHANA','TOGO',
        'BENIN','BÉNIN','NIGERIA','CAMEROUN','CAMEROON',
        // STRUCTURAL_PATCH_ALLOWED: pays commerciaux hors Afrique Ouest (2026-04-07)
        'INDIA','INDE','CHINA','CHINE','TURKEY','TURQUIE',
        'BRAZIL','BRÉSIL','USA','ÉTATS-UNIS','UNITED STATES',
        'BANGLADESH','SRI LANKA','THAILAND','THAÏLANDE',
      ]);

      let effectiveFactKey = mapping.factKey;
      let effectiveCategory = mapping.category;

      if (mapping.factKey === 'routing.destination_city') {
        const upper = valueText?.toUpperCase().trim();
        if (upper && KNOWN_COUNTRIES.has(upper)) {
          console.log(`[VALIDATION] "${valueText}" is a country name, redirecting to routing.destination_country`);
          if (!injectedKeys.has('routing.destination_country')) {
            effectiveFactKey = 'routing.destination_country';
            effectiveCategory = 'routing';
          } else {
            result.skipped++;
            continue; // don't block a real city later in the same loop
          }
        }
      }

      // Call supersede_fact RPC
      const { error: rpcError } = await serviceClient.rpc('supersede_fact', {
        p_case_id: caseId,
        p_fact_key: effectiveFactKey,
        p_fact_category: effectiveCategory,
        p_value_text: valueText,
        p_value_number: valueNumber,
        p_value_json: valueJson,
        p_value_date: null,
        p_source_type: 'attachment_extracted',
        p_source_email_id: attachment.email_id || null,
        p_source_attachment_id: attachment.id,
        p_source_excerpt: `[${attachment.filename}] ${rawKey}: ${String(rawValue).substring(0, 200)}`,
        p_confidence: 0.95,
      });

      if (rpcError) {
        console.error(`[M3.4] Failed to inject fact ${mapping.factKey} from ${attachment.filename}:`, rpcError);
        continue;
      }

      // Timeline logging
      await serviceClient.from('case_timeline_events').insert({
        case_id: caseId,
        event_type: 'fact_injected_from_attachment',
        event_data: {
          fact_key: effectiveFactKey,
          attachment_id: attachment.id,
          filename: attachment.filename,
          source_field: rawKey,
        },
        actor_type: 'system',
      });

      if (existingSource) {
        result.updated++;
      } else {
        result.added++;
      }

      injectedKeys.add(effectiveFactKey);
      factSourceMap.set(effectiveFactKey, 'attachment_extracted');
    }
  }

  // --- Patch B: Exploit attachment tariff_lines for cargo.value / cargo.freight_cost ---
  for (const attachment of attachments) {
    const tariffLines = (attachment.extracted_data as any)?.tariff_lines;
    if (!Array.isArray(tariffLines) || tariffLines.length === 0) continue;

    for (const tl of tariffLines) {
      if (!tl || typeof tl !== 'object') continue;
      const service = String(tl.service ?? tl.designation ?? '');
      const rawAmount = tl.amount ?? tl.montant;
      if (rawAmount == null) continue;

      const amount = typeof rawAmount === 'number' ? rawAmount : parseRobustNumber(String(rawAmount));
      if (amount == null || amount <= 0) continue;

      const currency = String(tl.currency ?? tl.devise ?? '').trim() || null;

      // CFR / CAF / CIF → cargo.value + cargo.value_currency
      if (/\b(?:CFR|CAF|CIF)\b/i.test(service)) {
        if (!injectedKeys.has('cargo.value')) {
          const existingSource = factSourceMap.get('cargo.value');
          if (!MANUAL_PROTECTED_SOURCES.has(existingSource ?? '') && existingSource !== 'attachment_extracted') {
            const { error: rpcErr } = await serviceClient.rpc('supersede_fact', {
              p_case_id: caseId,
              p_fact_key: 'cargo.value',
              p_fact_category: 'cargo',
              p_value_text: null,
              p_value_number: amount,
              p_value_json: null,
              p_value_date: null,
              p_source_type: 'attachment_extracted',
              p_source_email_id: attachment.email_id || null,
              p_source_attachment_id: attachment.id,
              p_source_excerpt: `[${attachment.filename}] tariff_line: ${service} = ${amount}`,
              p_confidence: 0.90,
            });
            if (!rpcErr) {
              injectedKeys.add('cargo.value');
              factSourceMap.set('cargo.value', 'attachment_extracted');
              result.added++;
              await serviceClient.from('case_timeline_events').insert({
                case_id: caseId, event_type: 'fact_injected_from_attachment',
                event_data: { fact_key: 'cargo.value', attachment_id: attachment.id, filename: attachment.filename, source_field: `tariff_line:${service}` },
                actor_type: 'system',
              });
              // Inject currency only if amount was successfully injected
              if (currency && !injectedKeys.has('cargo.value_currency')) {
                const existCurr = factSourceMap.get('cargo.value_currency');
                if (!MANUAL_PROTECTED_SOURCES.has(existCurr ?? '') && existCurr !== 'attachment_extracted') {
                  await serviceClient.rpc('supersede_fact', {
                    p_case_id: caseId, p_fact_key: 'cargo.value_currency', p_fact_category: 'cargo',
                    p_value_text: currency, p_value_number: null, p_value_json: null, p_value_date: null,
                    p_source_type: 'attachment_extracted', p_source_email_id: attachment.email_id || null,
                    p_source_attachment_id: attachment.id,
                    p_source_excerpt: `[${attachment.filename}] tariff_line currency: ${currency}`,
                    p_confidence: 0.90,
                  });
                  injectedKeys.add('cargo.value_currency');
                  factSourceMap.set('cargo.value_currency', 'attachment_extracted');
                  result.added++;
                }
              }
            } else {
              console.error(`[tariff_lines] Failed to inject cargo.value from ${attachment.filename}:`, rpcErr);
            }
          }
        }
      }

      // Fret / Freight → cargo.freight_cost + cargo.freight_currency
      if (/\b(?:FRET|FREIGHT)\b/i.test(service)) {
        if (!injectedKeys.has('cargo.freight_cost')) {
          const existingSource = factSourceMap.get('cargo.freight_cost');
          if (!MANUAL_PROTECTED_SOURCES.has(existingSource ?? '') && existingSource !== 'attachment_extracted') {
            const { error: rpcErr } = await serviceClient.rpc('supersede_fact', {
              p_case_id: caseId,
              p_fact_key: 'cargo.freight_cost',
              p_fact_category: 'cargo',
              p_value_text: null,
              p_value_number: amount,
              p_value_json: null,
              p_value_date: null,
              p_source_type: 'attachment_extracted',
              p_source_email_id: attachment.email_id || null,
              p_source_attachment_id: attachment.id,
              p_source_excerpt: `[${attachment.filename}] tariff_line: ${service} = ${amount}`,
              p_confidence: 0.90,
            });
            if (!rpcErr) {
              injectedKeys.add('cargo.freight_cost');
              factSourceMap.set('cargo.freight_cost', 'attachment_extracted');
              result.added++;
              await serviceClient.from('case_timeline_events').insert({
                case_id: caseId, event_type: 'fact_injected_from_attachment',
                event_data: { fact_key: 'cargo.freight_cost', attachment_id: attachment.id, filename: attachment.filename, source_field: `tariff_line:${service}` },
                actor_type: 'system',
              });
              // Inject freight currency only if freight cost was successfully injected
              if (currency && !injectedKeys.has('cargo.freight_currency')) {
                const existCurr = factSourceMap.get('cargo.freight_currency');
                if (!MANUAL_PROTECTED_SOURCES.has(existCurr ?? '') && existCurr !== 'attachment_extracted') {
                  await serviceClient.rpc('supersede_fact', {
                    p_case_id: caseId, p_fact_key: 'cargo.freight_currency', p_fact_category: 'cargo',
                    p_value_text: currency, p_value_number: null, p_value_json: null, p_value_date: null,
                    p_source_type: 'attachment_extracted', p_source_email_id: attachment.email_id || null,
                    p_source_attachment_id: attachment.id,
                    p_source_excerpt: `[${attachment.filename}] tariff_line currency: ${currency}`,
                    p_confidence: 0.90,
                  });
                  injectedKeys.add('cargo.freight_currency');
                  factSourceMap.set('cargo.freight_currency', 'attachment_extracted');
                  result.added++;
                }
              }
            } else {
              console.error(`[tariff_lines] Failed to inject cargo.freight_cost from ${attachment.filename}:`, rpcErr);
            }
          }
        }
      }
    }
  }


  try {
    for (const attachment of attachments) {
      const extractedInfo = (attachment.extracted_data as any)?.extracted_info || attachment.extracted_data;
      if (!extractedInfo) continue;

      const items = Array.isArray(extractedInfo.items) ? extractedInfo.items
        : Array.isArray((extractedInfo as any).articles) ? (extractedInfo as any).articles
        : Array.isArray((extractedInfo as any).lignes) ? (extractedInfo as any).lignes
        : [];
      if (!Array.isArray(items) || items.length === 0) continue;

      // Build enriched articles detail (P2-A: schema riche + P2-B: calcul qty*unitPrice)
      const articlesDetail: Array<{
        hs_code: string; value: number; currency: string;
        description?: string; quantity?: number; unit_price?: number; line_total?: number;
      }> = [];
      for (const item of items) {
        const qty = parseRobustNumber(String(item.quantity ?? item.qty ?? '')) ?? 0;
        const unitPrice = parseRobustNumber(String(item.unit_price ?? item.prix_unitaire ?? '')) ?? 0;
        const lineTotal = parseRobustNumber(String(item.total ?? item.montant ?? '')) ?? 0;
        const itemValue = parseRobustNumber(String(item.value ?? '')) ?? 0;
        // Priority: lineTotal > qty*unitPrice > itemValue > unitPrice
        const value = lineTotal > 0 ? lineTotal
          : (qty > 0 && unitPrice > 0) ? qty * unitPrice
          : itemValue > 0 ? itemValue
          : unitPrice > 0 ? unitPrice : 0;

        // Normalize HS BEFORE truthy check (avoid "N/A" → "")
        const rawHs = String(item.hs_code || item.code_hs || item.codes_hs || '');
        const normalizedHs = rawHs.replace(/\D/g, '').slice(0, 10);

        if (value > 0 && normalizedHs) {
          articlesDetail.push({
            hs_code: normalizedHs,
            value,
            currency: String(item.currency || item.devise || extractedInfo.devise || 'EUR').toUpperCase(),
            description: typeof (item.description || item.designation) === 'string'
              ? String(item.description || item.designation).slice(0, 200) : undefined,
            quantity: qty > 0 ? qty : undefined,
            unit_price: unitPrice > 0 ? unitPrice : undefined,
            line_total: lineTotal > 0 ? lineTotal : undefined,
          });
        }
      }

      if (articlesDetail.length >= 1 && !injectedKeys.has('cargo.articles_detail')) {
        const existingSource = factSourceMap.get('cargo.articles_detail');
        if (!MANUAL_PROTECTED_SOURCES.has(existingSource ?? '')) {
          const { error: rpcError } = await serviceClient.rpc('supersede_fact', {
            p_case_id: caseId,
            p_fact_key: 'cargo.articles_detail',
            p_fact_category: 'cargo',
            p_value_text: null,
            p_value_number: null,
            p_value_json: articlesDetail,
            p_value_date: null,
            p_source_type: 'attachment_extracted',
            p_source_email_id: attachment.email_id || null,
            p_source_attachment_id: attachment.id,
            p_source_excerpt: `[${attachment.filename}] ${articlesDetail.length} articles with EXW values`,
            p_confidence: 0.95,
          });

          if (!rpcError) {
            result.added++;
            injectedKeys.add('cargo.articles_detail');
            factSourceMap.set('cargo.articles_detail', 'attachment_extracted');
            console.log(`[M3.4] Injected cargo.articles_detail: ${articlesDetail.length} articles`);

            await serviceClient.from('case_timeline_events').insert({
              case_id: caseId,
              event_type: 'fact_injected_from_attachment',
              event_data: {
                fact_key: 'cargo.articles_detail',
                attachment_id: attachment.id,
                filename: attachment.filename,
                articles_count: articlesDetail.length,
              },
              actor_type: 'system',
            });
          } else {
            console.error(`[M3.4] Failed to inject cargo.articles_detail:`, rpcError);
          }
        }
        break; // First attachment with valid articles wins
      }
    }
  } catch (e) {
    console.error('[M3.4] Error injecting cargo.articles_detail:', e);
  }

  console.log(`[M3.4] Attachment facts: ${result.added} added, ${result.updated} updated, ${result.skipped} skipped`);
  return result;
}

if (Deno.env.get("BUILD_CASE_PUZZLE_DISABLE_SERVE") !== "1") {
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Validate JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = userData.user.id;
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Parse request
    const body = await req.json();
    const { case_id, force_refresh = false, force_articles_detail = false, mode = "sync", job_id }: BuildPuzzleRequest = body;

    // ── Phase 15.8.2: Async job modes (poll/tick/cancel) — no case_id needed ──
    if (mode === "poll" && job_id) {
      const { data: jobData, error: jobErr } = await serviceClient
        .from("case_puzzle_jobs")
        .select("*")
        .eq("id", job_id)
        .eq("created_by", userId)
        .maybeSingle();
      if (jobErr || !jobData) {
        return new Response(JSON.stringify({ error: "Job not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const isStale = jobData.status === "running" &&
        (Date.now() - new Date(jobData.last_heartbeat).getTime() > 120_000);
      return new Response(JSON.stringify({
        ...jobData,
        is_stale: isStale,
        can_resume: isStale && jobData.attempt < 3,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (mode === "cancel" && job_id) {
      await serviceClient.from("case_puzzle_jobs")
        .update({ status: "cancelled", completed_at: new Date().toISOString() })
        .eq("id", job_id)
        .eq("created_by", userId);
      return new Response(JSON.stringify({ status: "cancelled", job_id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (mode === "tick" && job_id) {
      const { data: tickJob } = await serviceClient.from("case_puzzle_jobs")
        .select("*").eq("id", job_id).eq("created_by", userId).maybeSingle();
      if (!tickJob) {
        return new Response(JSON.stringify({ error: "Job not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const tickStale = tickJob.status === "running" &&
        (Date.now() - new Date(tickJob.last_heartbeat).getTime() > 120_000);
      if (!tickStale || tickJob.attempt >= 3) {
        return new Response(JSON.stringify({ job_id, status: tickJob.status, message: "Not stale or max attempts" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const newAttempt = tickJob.attempt + 1;
      await serviceClient.from("case_puzzle_jobs")
        .update({ attempt: newAttempt, last_heartbeat: new Date().toISOString() })
        .eq("id", job_id);

      // Re-launch self-fetch with stored request_params
      const params = (tickJob.request_params as Record<string, unknown>) || {};
      const tickWork = (async () => {
        const startMs = Date.now();
        const controller = new AbortController();
        let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => controller.abort(), 290_000);
        let hbInterval: ReturnType<typeof setInterval> | undefined;
        try {
          // Start heartbeat only after job is confirmed running (attempt update succeeded above)
          hbInterval = setInterval(() => {
            void serviceClient
              .from("case_puzzle_jobs")
              .update({ last_heartbeat: new Date().toISOString() })
              .eq("id", job_id)
              .eq("status", "running")
              .then(({ error }) => {
                if (error) console.warn("[tickWork] heartbeat failed:", error);
              });
          }, 30_000);

          const resp = await fetch(`${supabaseUrl}/functions/v1/build-case-puzzle`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": authHeader },
            body: JSON.stringify({
              case_id: tickJob.case_id,
              force_refresh: params.force_refresh || false,
              force_articles_detail: params.force_articles_detail || false,
            }),
            signal: controller.signal,
          });
          if (!resp.ok) {
            const errText = await resp.text().catch(() => "unknown");
            throw new Error(`Self-fetch ${resp.status}: ${errText.substring(0, 500)}`);
          }
          let result: Record<string, unknown> = {};
          try { result = await resp.json(); } catch { result = { raw: "JSON parse failed" }; }
          const durationMs = Date.now() - startMs;
          await serviceClient.from("case_puzzle_jobs").update({
            status: "completed", final_result: result,
            completed_at: new Date().toISOString(), duration_ms: durationMs,
            last_heartbeat: new Date().toISOString(),
          }).eq("id", job_id).eq("status", "running");
        } catch (e: unknown) {
          const durationMs = Date.now() - startMs;
          const msg = e instanceof Error ? e.message : "unknown";
          await serviceClient.from("case_puzzle_jobs").update({
            status: "failed", error_message: (msg.includes("abort") ? "timeout (290s)" : msg).substring(0, 500),
            completed_at: new Date().toISOString(), duration_ms: durationMs,
            last_heartbeat: new Date().toISOString(),
          }).eq("id", job_id).eq("status", "running");
        } finally {
          if (hbInterval) clearInterval(hbInterval);
          if (timeoutId) clearTimeout(timeoutId);
        }
      })();
      (globalThis as any).EdgeRuntime?.waitUntil?.(tickWork);
      return new Response(JSON.stringify({ job_id, status: "restarted", attempt: newAttempt }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (mode === "start") {
      if (!case_id) {
        return new Response(JSON.stringify({ error: "case_id is required for mode start" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // Check existing active job
      const { data: existingJob } = await serviceClient.from("case_puzzle_jobs")
        .select("id, status")
        .eq("created_by", userId)
        .eq("case_id", case_id)
        .in("status", ["pending", "running"])
        .maybeSingle();
      if (existingJob) {
        return new Response(JSON.stringify({ job_id: existingJob.id, status: "already_running" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // Insert new job
      const requestParams = { force_refresh, force_articles_detail };
      const { data: newJob, error: insertErr } = await serviceClient.from("case_puzzle_jobs")
        .insert({
          case_id, created_by: userId, status: "pending",
          request_params: requestParams,
        })
        .select("id")
        .single();
      if (insertErr || !newJob) {
        return new Response(JSON.stringify({ error: "Failed to create job: " + (insertErr?.message || "unknown") }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const newJobId = newJob.id;

      // Launch background worker
      const bgWork = (async () => {
        const startMs = Date.now();
        const { error: runErr } = await serviceClient.from("case_puzzle_jobs").update({
          status: "running", started_at: new Date().toISOString(),
          last_heartbeat: new Date().toISOString(),
        }).eq("id", newJobId);

        if (runErr) {
          console.error("[bgWork] failed to set running:", runErr);
          return; // Don't start heartbeat or self-fetch if job couldn't be set to running
        }

        const controller = new AbortController();
        let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => controller.abort(), 290_000);
        let hbInterval: ReturnType<typeof setInterval> | undefined = setInterval(() => {
          void serviceClient
            .from("case_puzzle_jobs")
            .update({ last_heartbeat: new Date().toISOString() })
            .eq("id", newJobId)
            .eq("status", "running")
            .then(({ error }) => {
              if (error) console.warn("[bgWork] heartbeat failed:", error);
            });
        }, 30_000);

        try {
          const resp = await fetch(`${supabaseUrl}/functions/v1/build-case-puzzle`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": authHeader },
            body: JSON.stringify({ case_id, force_refresh, force_articles_detail }),
            signal: controller.signal,
          });
          if (!resp.ok) {
            const errText = await resp.text().catch(() => "unknown");
            throw new Error(`Self-fetch ${resp.status}: ${errText.substring(0, 500)}`);
          }
          let result: Record<string, unknown> = {};
          try { result = await resp.json(); } catch { result = { raw: "JSON parse failed" }; }
          const durationMs = Date.now() - startMs;
          await serviceClient.from("case_puzzle_jobs").update({
            status: "completed", final_result: result,
            completed_at: new Date().toISOString(), duration_ms: durationMs,
            last_heartbeat: new Date().toISOString(),
          }).eq("id", newJobId).eq("status", "running");
        } catch (e: unknown) {
          const durationMs = Date.now() - startMs;
          const msg = e instanceof Error ? e.message : "unknown";
          await serviceClient.from("case_puzzle_jobs").update({
            status: "failed", error_message: (msg.includes("abort") ? "timeout (290s)" : msg).substring(0, 500),
            completed_at: new Date().toISOString(), duration_ms: durationMs,
            last_heartbeat: new Date().toISOString(),
          }).eq("id", newJobId).eq("status", "running");
        } finally {
          if (hbInterval) clearInterval(hbInterval);
          if (timeoutId) clearTimeout(timeoutId);
        }
      })();
      (globalThis as any).EdgeRuntime?.waitUntil?.(bgWork);

      return new Response(JSON.stringify({ job_id: newJobId, status: "started" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── mode "sync" (default) — original logic continues below ──
    if (!case_id) {
      return new Response(
        JSON.stringify({ error: "case_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Phase 15.4: Admin guard for force_articles_detail
    if (force_articles_detail) {
      const allowlistRaw = Deno.env.get("ADMIN_EMAIL_ALLOWLIST") || "";
      const allowed = allowlistRaw.split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
      const userEmail = (userData.user.email || "").toLowerCase();
      if (allowed.length === 0 || !allowed.includes(userEmail)) {
        return new Response(
          JSON.stringify({ error: "Forbidden: admin access required" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      console.log(`[Admin] force_articles_detail requested by ${userEmail}`);
    }

    // 3. Load case and verify ownership
    const { data: caseData, error: caseError } = await serviceClient
      .from("quote_cases")
      .select("*, email_threads(id, subject_normalized, client_email, partner_email)")
      .eq("id", case_id)
      .single();

    if (caseError || !caseData) {
      return new Response(
        JSON.stringify({ error: "Case not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mono-tenant app: all authenticated users can access all cases
    // Ownership check removed — JWT auth is sufficient

    // HS10-RANKING-CONTEXT-ENRICHMENT v2 : charger une seule fois client_company
    // et cargo.description depuis quote_facts pour enrichir le prompt IA de ranking HS10.
    // Aucun impact métier — utilisé uniquement par rankHsCandidatesWithAI.
    const { data: hsRankingFacts } = await serviceClient
      .from("quote_facts")
      .select("fact_key, value_text")
      .eq("case_id", case_id)
      .in("fact_key", ["contacts.client_company", "cargo.description"])
      .eq("is_current", true);
    const hsRankingClientName: string =
      (hsRankingFacts || []).find((r: any) => r.fact_key === "contacts.client_company")?.value_text || "";
    const hsRankingCargoDescription: string =
      (hsRankingFacts || []).find((r: any) => r.fact_key === "cargo.description")?.value_text || "";

    // Phase C: Statuts figés qui ne doivent pas être modifiés automatiquement
    const FROZEN_STATUSES = ["DECISIONS_PENDING", "DECISIONS_COMPLETE", "ACK_READY_FOR_PRICING", "PRICED_DRAFT", "HUMAN_REVIEW", "SENT", "ACCEPTED", "REJECTED", "ARCHIVED"];
    const isFrozenCase = FROZEN_STATUSES.includes(caseData.status);

    if (isFrozenCase && !force_refresh) {
      console.log(`[BuildPuzzle] Case ${case_id} is frozen (${caseData.status}), facts will be added but status unchanged`);
    }

    // 4. Load all emails from thread (guard: skip if no thread_id)
    let emails: any[] = [];
    if (caseData.thread_id) {
      const { data: threadEmails } = await serviceClient
        .from("emails")
        .select("id, from_address, to_addresses, subject, body_text, sent_at, is_quotation_request")
        .eq("thread_ref", caseData.thread_id)
        .order("sent_at", { ascending: true });
      emails = threadEmails || [];
    }

    // 4b. Count ALL case_documents (for guard check — includes docs without extracted_text)
    const { count: totalCaseDocsCount } = await serviceClient
      .from("case_documents")
      .select("id", { count: "exact", head: true })
      .eq("case_id", case_id);

    // 4c. Load case_documents with pre-extracted text (Intake flow)
    const { data: caseDocuments } = await serviceClient
      .from("case_documents")
      .select("file_name, document_type, extracted_text")
      .eq("case_id", case_id)
      .not("extracted_text", "is", null);

    // Guard: need either emails or case_documents
    if (caseData.thread_id && emails.length === 0) {
      return new Response(
        JSON.stringify({ error: "No emails found in thread" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!caseData.thread_id && (!totalCaseDocsCount || totalCaseDocsCount === 0)) {
      return new Response(
        JSON.stringify({ error: "No emails or documents found for this case" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Load attachments
    const emailIds = emails.map((e) => e.id);
    const { data: attachments } = await serviceClient
      .from("email_attachments")
      .select("id, email_id, filename, content_type, extracted_data, extracted_text, is_analyzed")
      .in("email_id", emailIds);

    // ── STRUCTURAL_PATCH_ALLOWED: PJ-ANALYSIS-ON-PUZZLE ──
    // Best-effort analysis of unanalyzed attachments before AI context build.
    // Non-fatal: failures are logged, never block puzzle generation.
    const unanalyzedAtts = (attachments || []).filter(a => !a.is_analyzed);
    let reloadedAttachments = attachments;

    if (unanalyzedAtts.length > 0) {
      const MAX_INLINE_ANALYSIS = 5;
      const toAnalyze = unanalyzedAtts.slice(0, MAX_INLINE_ANALYSIS);
      console.log(`[PJ-ANALYSIS] ${unanalyzedAtts.length} PJ non analysée(s), traitement best-effort de ${toAnalyze.length}`);

      for (const att of toAnalyze) {
        try {
          const analyzeResp = await fetch(
            `${supabaseUrl}/functions/v1/analyze-attachments`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': authHeader,
              },
              body: JSON.stringify({ attachmentId: att.id, background: false }),
            }
          );
          const result = await analyzeResp.json();
          console.log(`[PJ-ANALYSIS] ${att.filename}: ${analyzeResp.ok ? 'ok' : 'failed'}`,
            result?.analyzed ?? result?.error ?? '');
        } catch (err) {
          console.warn(`[PJ-ANALYSIS] ${att.filename}: erreur non fatale`, String(err));
        }
      }

      // Reload attachments after analysis
      const { data: refreshedAtts } = await serviceClient
        .from("email_attachments")
        .select("id, email_id, filename, content_type, extracted_data, extracted_text, is_analyzed")
        .in("email_id", emailIds);
      if (refreshedAtts) reloadedAttachments = refreshedAtts;
    }
    // ── END PJ-ANALYSIS-ON-PUZZLE ──

    // 6. Build context for AI extraction
    const threadContext = emails
      .map((e) => `[${e.sent_at}] From: ${e.from_address}\nSubject: ${e.subject}\n\n${extractPlainTextFromMime(e.body_text || "")}`)
      .join("\n\n---\n\n");

    // SOURCE-GUARD-1: Build filtered context excluding outbound SODATRA emails
    const inboundEmails = emails.filter(e => !isSodatraEmail(e.from_address));
    const filteredOutCount = emails.length - inboundEmails.length;
    if (filteredOutCount > 0) {
      console.log(`[SOURCE-GUARD] Filtered ${filteredOutCount} outbound SODATRA email(s) from fact extraction context (kept ${inboundEmails.length}/${emails.length})`);
    }
    const inboundThreadContext = inboundEmails
      .map((e) => `[${e.sent_at}] From: ${e.from_address}\nSubject: ${e.subject}\n\n${extractPlainTextFromMime(e.body_text || "")}`)
      .join("\n\n---\n\n");

    const attachmentContext = (reloadedAttachments || [])
      .filter((a) => a.extracted_text || a.extracted_data)
      .map((a) => `[Attachment: ${a.filename}]\n${a.extracted_text || JSON.stringify(a.extracted_data)}`)
      .join("\n\n");

    // 6b. Build case_documents context (Intake documents)
    let caseDocContext = "";
    for (const doc of caseDocuments || []) {
      const truncated = (doc.extracted_text || "").slice(0, 3000);
      caseDocContext += `\n[Document: ${doc.file_name} (${doc.document_type})]\n${truncated}\n`;
    }

    const fullAttachmentContext = [attachmentContext, caseDocContext]
      .filter(Boolean)
      .join("\n\n");

    // 7. Call AI for fact extraction (uses INBOUND context only — SOURCE-GUARD-1)
    let extractedFacts = await extractFactsWithAI(
      inboundThreadContext,
      fullAttachmentContext,
      emails,
      reloadedAttachments || [],
      lovableApiKey
    );

    const { data: subjectGuardCurrentFacts } = await serviceClient
      .from("quote_facts")
      .select("id, fact_key, value_text, value_number, value_json, source_type, source_excerpt")
      .eq("case_id", case_id)
      .eq("is_current", true)
      .in("fact_key", [
        "routing.origin_airport",
        "routing.destination_airport",
        "routing.origin_port",
        "routing.origin_country",
        "routing.destination_city",
        "routing.destination_country",
      ]);

    extractedFacts = filterSubjectContaminatedRoutingFacts(
      extractedFacts,
      fullAttachmentContext,
      subjectGuardCurrentFacts || [],
      emails
    );

    const subjectGuardDeactivatedFacts = await deactivateSubjectContaminatedCurrentAirportFacts(
      serviceClient,
      case_id,
      subjectGuardCurrentFacts || [],
      fullAttachmentContext,
      extractedFacts,
      emails
    );

    // 8. Detect request type from content (include attachment text for Intake cases)
    const fullDetectionContext = [threadContext, fullAttachmentContext].filter(Boolean).join("\n\n");
    const detectionResult = detectRequestType(fullDetectionContext, extractedFacts);
    let detectedType = detectionResult.type;
    const isAmbiguousLclFcl = detectionResult.ambiguous_lcl_fcl;

    // Action 4: Post-detection coherence guard
    // If AIR_IMPORT but extracted facts contain valid containers → force SEA_FCL_IMPORT
    if (detectedType === "AIR_IMPORT") {
      const containerFact = extractedFacts.find(f => f.key === "cargo.containers");
      const hasContainers = containerFact && Array.isArray(containerFact.value)
        && (containerFact.value as any[]).some((c: any) => c && (c.quantity || 0) > 0);
      if (hasContainers) {
        console.log(`[Detection] COHERENCE OVERRIDE: AIR_IMPORT → SEA_FCL_IMPORT (containers present in facts)`);
        detectedType = "SEA_FCL_IMPORT";

        await serviceClient.from("case_timeline_events").insert({
          case_id,
          event_type: "detection_corrected",
          event_data: {
            original_type: "AIR_IMPORT",
            corrected_type: "SEA_FCL_IMPORT",
            reason: "Containers detected in extracted facts override AIR classification",
          },
          actor_type: "system",
        });
      }
    }

    // 9. Store facts using ATOMIC RPC supersede_fact
    let factsAdded = 0;
    let factsUpdated = 0;
    let factsSkipped = 0;
    let gapsIdentified = 0; // Declared early: used by doc-regex, HS Post-Attach, and Identify gaps
    let multiQuoteResult: { detected: boolean; stored: number; mode: string | null } | null = null;
    const factErrors: Array<{ key: string; error: string; isCritical: boolean }> = [];
    factsUpdated += subjectGuardDeactivatedFacts;
    
    // Get mandatory facts for this request type to mark critical errors
    const mandatoryFactsForType = MANDATORY_FACTS[detectedType] || MANDATORY_FACTS.SEA_FCL_IMPORT;

    // P2: Remove destination_city extracted from EXW/FCA/FAS origin location
    const ORIGIN_INCOTERMS = new Set(["EXW", "FCA", "FAS"]);
    const p2IncotermFact = extractedFacts.find(f => f.key === "routing.incoterm");
    const p2IncotermValue = String(p2IncotermFact?.value || "").toUpperCase();

    if (ORIGIN_INCOTERMS.has(p2IncotermValue)) {
      const destCityIdx = extractedFacts.findIndex(f => f.key === "routing.destination_city");
      if (destCityIdx >= 0) {
        const excerpt = String(extractedFacts[destCityIdx]?.sourceExcerpt || "").toUpperCase();
        const looksIncotermBound =
          excerpt.includes("EXW") || excerpt.includes("FCA") || excerpt.includes("FAS");

        if (looksIncotermBound) {
          console.log(`[P2] Removing destination_city "${extractedFacts[destCityIdx].value}" extracted from ${p2IncotermValue} origin location (excerpt: ${excerpt})`);
          extractedFacts.splice(destCityIdx, 1);
        }
      }
    }

    // SOURCE-GUARD-2: Post-extraction provenance filter for sensitive monetary facts
    const threadClientEmail = (caseData as any)?.email_threads?.client_email || null;
    const threadPartnerEmail = (caseData as any)?.email_threads?.partner_email || null;
    let sg2Blocked = 0;

    const guardedFacts = extractedFacts.filter(fact => {
      if (!SENSITIVE_MONETARY_FACTS.has(fact.key)) return true;

      // Check provenance via sourceEmailId
      if (fact.sourceEmailId) {
        const sourceEmail = emails.find(e => e.id === fact.sourceEmailId);
        if (sourceEmail) {
          const prov = classifyEmailProvenance(
            sourceEmail.from_address, threadClientEmail, threadPartnerEmail
          );
          if (prov === 'client') return true; // Allowed
          // internal_sodatra, partner, unknown → block
          console.log(`[SOURCE-GUARD-2] BLOCKED ${fact.key} (provenance=${prov}, from=${sourceEmail.from_address})`);
          sg2Blocked++;
          return false;
        }
      }

      // No sourceEmailId or email not found → block sensitive monetary facts (prudent)
      console.log(`[SOURCE-GUARD-2] BLOCKED ${fact.key} (no provable client provenance, sourceEmailId=${fact.sourceEmailId || 'none'})`);
      sg2Blocked++;
      return false;
    });

    if (sg2Blocked > 0) {
      console.log(`[SOURCE-GUARD-2] Total blocked: ${sg2Blocked} sensitive monetary fact(s)`);
    }

    // EMAIL-DOC-PROVENANCE-GUARD-1: identify likely-historical SODATRA quotation
    // attachments and the latest inbound client body. Used to (a) drop cargo
    // facts about to be written that come from such documents (pre-write) and
    // (b) deactivate already-active ones + raise a blocking gap (post-write).
    const docProvenanceHistoricalDocTexts = collectHistoricalSodatraQuotationDocTexts(
      emails,
      reloadedAttachments || [],
    );
    const docProvenanceLatestClientBody = extractPlainTextFromMime(
      inboundEmails[inboundEmails.length - 1]?.body_text || "",
    );
    const docProvenanceDrop = partitionCargoFactsByHistoricalDocProvenance(guardedFacts, {
      latestInboundBody: docProvenanceLatestClientBody,
      historicalDocTexts: docProvenanceHistoricalDocTexts,
    });
    if (docProvenanceDrop.dropped.length > 0) {
      console.log(
        `[DOC-PROVENANCE-GUARD] Dropping ${docProvenanceDrop.dropped.length} cargo fact(s) sourced from historical SODATRA quotation attachment(s): ${docProvenanceDrop.dropped
          .map((f) => f.key)
          .join(", ")}`,
      );
      factsSkipped += docProvenanceDrop.dropped.length;
    }
    const factsToWrite = docProvenanceDrop.kept;

    for (const fact of factsToWrite) {
      try {
        // --- CLIENT-COMPANY-GUARD: reject SODATRA as contacts.client_company ---
        if (fact.key === "contacts.client_company" && isSodatraCompanyName(fact.value)) {
          console.log(`[client-company-guard] rejected "${fact.value}" as contacts.client_company`);
          factsSkipped++;
          continue;
        }

        // --- HS Code guard: validate against hs_codes table before injection ---
        // DCQ-P0-HS10-SAFE: refuser toute promotion HS6/HS8 → HS10 (suggestion only).
        if (fact.key === "cargo.hs_code") {
          const hsGuard = await guardAiCargoHsCodeFact(serviceClient, {
            case_id,
            rawHs: String(fact.value),
            cargoDescription: hsRankingCargoDescription,
            clientName: hsRankingClientName,
            sourceExcerpt: (fact as any)?.sourceExcerpt || undefined,
          });
          if (!hsGuard.shouldWrite) {
            factsSkipped++;
            continue;
          }
          fact.value = hsGuard.code10;
          fact.confidence = hsGuard.confidence;
        }


        // Check if fact already exists
        const { data: existingFact } = await serviceClient
          .from("quote_facts")
          .select("id, value_text, value_number, value_json, source_type")
          .eq("case_id", case_id)
          .eq("fact_key", fact.key)
          .eq("is_current", true)
          .single();

        const factValue = getFactValue(fact);

        if (existingFact) {
          // S5: protect manual sources from AI extraction overwrite
          // Per protected-source-override-rules: only protect if existing value is non-empty
          const existingValue = existingFact.value_text ?? existingFact.value_number ?? existingFact.value_json;
          const hasRealValue = existingValue !== null && existingValue !== undefined &&
            (typeof existingValue === 'number' ? Number.isFinite(existingValue) : String(existingValue).trim().length > 0);
          if (hasRealValue && MANUAL_PROTECTED_SOURCES.has(existingFact.source_type ?? '')) {
            console.log(`[AI extract] Skipping ${fact.key}: protected manual source (${existingFact.source_type})`);
            factsSkipped++;
            continue;
          }
          if (JSON.stringify(existingValue) === JSON.stringify(factValue)) {
            factsSkipped++;
            continue;
          }

          const { data: newFactId, error: supersedeError } = await serviceClient.rpc('supersede_fact', {
            p_case_id: case_id,
            p_fact_key: fact.key,
            p_fact_category: fact.category,
            p_value_text: fact.valueType === 'text' ? String(fact.value) : null,
            p_value_number: fact.valueType === 'number' ? Number(fact.value) : null,
            p_value_json: fact.valueType === 'json' ? fact.value : null,
            p_value_date: fact.valueType === 'date' ? String(fact.value) : null,
            p_source_type: fact.isAssumption ? 'ai_assumption' : fact.sourceType,
            p_source_email_id: fact.sourceEmailId || null,
            p_source_attachment_id: fact.sourceAttachmentId || null,
            p_source_excerpt: fact.sourceExcerpt || null,
            p_confidence: fact.confidence,
          });

          if (supersedeError) {
            const isCritical = mandatoryFactsForType.includes(fact.key);
            factErrors.push({ key: fact.key, error: supersedeError.message, isCritical });
            
            await serviceClient.from("case_timeline_events").insert({
              case_id,
              event_type: "fact_insert_failed",
              event_data: { 
                fact_key: fact.key, 
                error: supersedeError.message,
                is_critical: isCritical,
                operation: "supersede"
              },
              actor_type: "system",
            });
            
            console.error(`Failed to supersede fact ${fact.key}:`, supersedeError);
            continue;
          }

          factsUpdated++;

          await serviceClient.from("case_timeline_events").insert({
            case_id,
            event_type: "fact_superseded",
            event_data: { fact_key: fact.key, old_value: existingValue, new_value: factValue },
            related_fact_id: existingFact.id,
            actor_type: "ai",
          });
        } else {
          const { data: newFactId, error: insertError } = await serviceClient.rpc('supersede_fact', {
            p_case_id: case_id,
            p_fact_key: fact.key,
            p_fact_category: fact.category,
            p_value_text: fact.valueType === 'text' ? String(fact.value) : null,
            p_value_number: fact.valueType === 'number' ? Number(fact.value) : null,
            p_value_json: fact.valueType === 'json' ? fact.value : null,
            p_value_date: fact.valueType === 'date' ? String(fact.value) : null,
            p_source_type: fact.isAssumption ? 'ai_assumption' : fact.sourceType,
            p_source_email_id: fact.sourceEmailId || null,
            p_source_attachment_id: fact.sourceAttachmentId || null,
            p_source_excerpt: fact.sourceExcerpt || null,
            p_confidence: fact.confidence,
          });

          if (insertError) {
            const isCritical = mandatoryFactsForType.includes(fact.key);
            factErrors.push({ key: fact.key, error: insertError.message, isCritical });
            
            await serviceClient.from("case_timeline_events").insert({
              case_id,
              event_type: "fact_insert_failed",
              event_data: { 
                fact_key: fact.key, 
                error: insertError.message,
                is_critical: isCritical,
                operation: "insert"
              },
              actor_type: "system",
            });
            
            console.error(`Failed to insert fact ${fact.key}:`, insertError);
            continue;
          }

          factsAdded++;

          await serviceClient.from("case_timeline_events").insert({
            case_id,
            event_type: "fact_added",
            event_data: { fact_key: fact.key, value: factValue },
            related_fact_id: newFactId,
            actor_type: "ai",
          });
        }
      } catch (factError: any) {
        const isCritical = mandatoryFactsForType.includes(fact.key);
        factErrors.push({ key: fact.key, error: String(factError), isCritical });
        console.error(`Unexpected error processing fact ${fact.key}:`, factError);
    }
    }

    // --- M3.4: Inject deterministic facts from attachments ---
    const attachmentFactsResult = await injectAttachmentFacts(
      case_id, serviceClient, emailIds
    );
    factsAdded += attachmentFactsResult.added;
    factsUpdated += attachmentFactsResult.updated;

    // --- M3.4c: Deterministic cargo.articles_detail from case_documents (manual dossiers) ---
    try {
      // Guard: only proceed if cargo.articles_detail not already injected (email or operator)
      const { data: existingArtFact } = await serviceClient
        .from("quote_facts")
        .select("id, source_type")
        .eq("case_id", case_id)
        .eq("fact_key", "cargo.articles_detail")
        .eq("is_current", true)
        .limit(1);

      const hasExisting = existingArtFact && existingArtFact.length > 0;
      let proceedWithExtraction = false;

      if (!hasExisting) {
        proceedWithExtraction = true;
      } else if (force_articles_detail) {
        const existingSourceType = existingArtFact[0]?.source_type;
        if (MANUAL_PROTECTED_SOURCES.has(existingSourceType ?? '')) {
          console.log(`[M3.4c] force requested but current fact is protected manual source (${existingSourceType}); skipping`);
        } else {
          console.log(`[M3.4c] force overwrite enabled (source_type=${existingSourceType})`);
          proceedWithExtraction = true;
        }
      } else {
        console.log(`[M3.4c] cargo.articles_detail already exists, skipping document extraction`);
      }

      if (proceedWithExtraction) {
        // Load cargo.hs_code for HS alignment (prevents equal-distribution fallback)
        const { data: hsFact } = await serviceClient
          .from("quote_facts")
          .select("value_text")
          .eq("case_id", case_id)
          .eq("fact_key", "cargo.hs_code")
          .eq("is_current", true)
          .limit(1);

        const hsSet = new Set(
          (hsFact?.[0]?.value_text || "")
            .split(/[,;]/)
            .map((s: string) => s.trim().replace(/\D/g, ""))
            .filter(Boolean)
        );

        // Scan case_documents extracted_text
        const docTexts = (caseDocuments || [])
          .map((d: any) => d.extracted_text)
          .filter((t: any): t is string => typeof t === "string" && t.length > 50);

        // Pre-enrich hsSet with SH6+0000 derived from document HS codes (order-independent)
        // IMPORTANT: add only hs6pad to avoid preferring 10-digit hs10 in alignment
        for (const text of docTexts) {
          const hsMatches = text.matchAll(/Code\s*Douanier\s*:\s*(\d{6,10})/gi);
          for (const m of hsMatches) {
            const raw = (m[1] || "").replace(/\D/g, "").slice(0, 10);
            if (raw.length >= 6) {
              hsSet.add(raw.slice(0, 6).padEnd(10, "0"));
            }
          }
        }

        // M3.4c: Reverse-scan from "Code Douanier:" lines for multi-line invoice format (Taleb)
        const codeDouanierRegex = /Code\s*Douanier\s*:\s*(\d{6,10})/i;
        const qtyLineRegex = /^\s*([\d\s.,]+)\s*$/;

        const extracted: Array<{
          hs_code: string; value: number; currency: string;
          description?: string; quantity?: number; unit_price?: number; line_total?: number;
        }> = [];

        const seen = new Set<string>();

        // Helper: check if a line is mostly numeric (no letters/symbols that indicate description)
        const isMostlyNumeric = (s: string) =>
          s.replace(/[\d\s.,\t]/g, "").trim().length === 0;

        // Helper: extract numeric tokens from a line — split on tabs/multiple-spaces first
        const extractNumericTokens = (s: string): number[] => {
          // Split on tabs or 2+ spaces to separate columns, then extract numbers from each segment
          const segments = s.split(/\t|  +/).filter(seg => seg.trim().length > 0);
          const nums: number[] = [];
          for (const seg of segments) {
            const n = parseRobustNumber(seg.trim());
            if (n !== null && Number.isFinite(n) && n >= 0) {
              nums.push(n);
            }
          }
          return nums;
        };

        for (const text of docTexts) {
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            const hsMatch = lines[i].match(codeDouanierRegex);
            if (!hsMatch) continue;
            const hsRawDigits = (hsMatch[1] || "").replace(/\D/g, "").slice(0, 10);
            if (!hsRawDigits || hsRawDigits.length < 6) continue;

            let lineTotal = 0, unitPrice = 0, qty = 0;
            let description = "";
            let priceLineIdx = -1;

            // Look backwards for a mostly-numeric "price line" with >= 2 numeric tokens (within 12 lines)
            for (let j = i - 1; j >= Math.max(0, i - 12); j--) {
              const ln = lines[j];
              if (!ln || !ln.trim()) continue;
              if (!isMostlyNumeric(ln)) continue; // skip lines with letters (anti false-positive)
              const nums = extractNumericTokens(ln);
              if (nums.length >= 2) {
                unitPrice = nums[0] ?? 0;
                lineTotal = nums[nums.length - 1] ?? 0;
                priceLineIdx = j;
                break;
              }
            }
            if (priceLineIdx < 0) continue;

            // Look backwards from price line for standalone quantity (within 12 lines)
            for (let j = priceLineIdx - 1; j >= Math.max(0, priceLineIdx - 12); j--) {
              const qm = lines[j].match(qtyLineRegex);
              if (!qm) continue;
              const candidate = parseRobustNumber(qm[1]);
              if (candidate && candidate > 0) {
                qty = candidate;
                // Description: look up to 10 lines for non-numeric text
                for (let k = j - 1; k >= Math.max(0, j - 10); k--) {
                  const t = (lines[k] || "").trim();
                  if (!t) continue;
                  if (/^[\d\s.,]+$/.test(t)) continue;
                  if (/Code\s*Douanier/i.test(t)) continue;
                  description = t;
                  // Prefer a shorter line above (often the product code/name)
                  for (let n = k - 1; n >= Math.max(0, k - 8); n--) {
                    const cand = (lines[n] || "").trim();
                    if (!cand) continue;
                    if (/^[\d\s.,]+$/.test(cand)) continue;
                    if (/Code\s*Douanier/i.test(cand)) continue;
                    if (cand.length < 60) description = cand;
                    else break;
                  }
                  break;
                }
                break;
              }
            }

            // value priority: total > qty*unit > unit
            const value = lineTotal > 0 ? lineTotal
              : (qty > 0 && unitPrice > 0) ? qty * unitPrice
              : unitPrice > 0 ? unitPrice : 0;
            if (!(value > 0)) continue;

            // HS alignment: match against cargo.hs_code to ensure coverage guard passes
            const hs10 = hsRawDigits.padEnd(10, "0");
            const hs6pad = hsRawDigits.slice(0, 6).padEnd(10, "0");
            const hsAligned = hsSet.has(hs10) ? hs10
              : hsSet.has(hs6pad) ? hs6pad : hs10;

            // Dedup with stabilized value key
            const valueKey = Number.isFinite(value) ? value.toFixed(2) : String(value);
            const dedupKey = `${hsAligned}|${valueKey}|${(description || "").trim()}`;
            if (seen.has(dedupKey)) continue;
            seen.add(dedupKey);

            extracted.push({
              hs_code: hsAligned,
              value,
              currency: "EUR",
              description: description ? description.slice(0, 200) : undefined,
              quantity: qty > 0 ? qty : undefined,
              unit_price: unitPrice > 0 ? unitPrice : undefined,
              line_total: lineTotal > 0 ? lineTotal : undefined,
            });
          }
        }

        // Fallback: try pipe-separated format if reverse-scan found nothing
        if (extracted.length === 0) {
          const pipeRegex =
            /^\s*([^|]+?)\s*\|\s*([\d\s.,]+)\s*\|\s*([\d\s.,]+)\s*\|\s*([\d\s.,]+)\s*([A-Z]{3})?\s*\|\s*Code\s*Douanier\s*:\s*(\d{8,10})\s*$/i;
          for (const text of docTexts) {
            for (const line of text.split(/\r?\n/)) {
              const m = line.match(pipeRegex);
              if (!m) continue;
              const desc = m[1]?.trim();
              const q = parseRobustNumber(m[2]) ?? 0;
              const up = parseRobustNumber(m[3]) ?? 0;
              const lt = parseRobustNumber(m[4]) ?? 0;
              const hsRaw = (m[6] || "").replace(/\D/g, "").slice(0, 10);
              if (!hsRaw) continue;
              const val = lt > 0 ? lt : (q > 0 && up > 0) ? q * up : up > 0 ? up : 0;
              if (!(val > 0)) continue;
              const h10 = hsRaw.padEnd(10, "0");
              const h6 = hsRaw.slice(0, 6).padEnd(10, "0");
              const ha = hsSet.has(h10) ? h10 : hsSet.has(h6) ? h6 : h10;
              const dk = `${ha}|${val.toFixed(2)}|${(desc || "").trim()}`;
              if (seen.has(dk)) continue;
              seen.add(dk);
              extracted.push({
                hs_code: ha, value: val, currency: (m[5] || "EUR").toUpperCase(),
                description: desc ? desc.slice(0, 200) : undefined,
                quantity: q > 0 ? q : undefined,
                unit_price: up > 0 ? up : undefined,
                line_total: lt > 0 ? lt : undefined,
              });
            }
          }
        }

        // Hardening B: cap 50 articles
        if (extracted.length > 50) extracted.length = 50;

        if (extracted.length >= 1) {
          const { error: rpcErr } = await serviceClient.rpc("supersede_fact", {
            p_case_id: case_id,
            p_fact_key: "cargo.articles_detail",
            p_fact_category: "cargo",
            p_value_text: null,
            p_value_number: null,
            p_value_json: extracted,
            p_value_date: null,
            p_source_type: "document_regex",
            p_source_email_id: null,
            p_source_attachment_id: null,
            p_source_excerpt: `[case_documents] ${extracted.length} articles extracted via regex`,
            p_confidence: 0.95,
          });

          if (!rpcErr) {
            factsAdded++;
            console.log(`[M3.4c] Injected cargo.articles_detail from case_documents: ${extracted.length} articles, HS aligned to: ${Array.from(new Set(extracted.map(a => a.hs_code))).join(",")}`);

            await serviceClient.from("case_timeline_events").insert({
              case_id: case_id,
              event_type: "fact_updated",
              event_data: {
                fact_key: "cargo.articles_detail",
                source_type: "document_regex",
                articles_count: extracted.length,
                hs_distinct: Array.from(new Set(extracted.map(a => a.hs_code))).length,
                forced: !!force_articles_detail,
              },
              actor_type: "system",
            });
          } else {
            console.warn(`[M3.4c] Failed to inject cargo.articles_detail:`, rpcErr);
          }
        } else {
          console.log(`[M3.4c] No articles extracted from case_documents (${docTexts.length} texts scanned)`);
        }
      }
    } catch (m34cErr) {
      console.warn("[M3.4c] Error during document articles extraction:", m34cErr);
    }

    // --- M3.4b: Deterministic HS extraction from case_documents (regex) ---
    try {
      // 1. Check if cargo.hs_code already exists and is valid 10-digit in DB
      const { data: hsFactDoc } = await serviceClient
        .from("quote_facts")
        .select("id, value_text, source_type")
        .eq("case_id", case_id)
        .eq("fact_key", "cargo.hs_code")
        .eq("is_current", true)
        .maybeSingle();

      const hsRawDocValue = (hsFactDoc?.value_text || "").trim();
      const hsDigitsDoc = hsRawDocValue.replace(/\D/g, "");

      // P1 fix: detect if existing value is already a multi-HS CSV
      const docTokens = hsRawDocValue.split(/[;,]/).map((c: string) => c.trim()).filter(Boolean);
      const existingDocIsMultiCsv = docTokens.length > 1 && docTokens.every((c: string) => /^\d{10}$/.test(c));
      const hasDocsToScan = Array.isArray(caseDocuments) && caseDocuments.length > 0;

      let skipHsDocRegex = false;
      if (existingDocIsMultiCsv) {
        console.log("[HS doc-regex] Existing HS is already multi-HS CSV, skip:", hsRawDocValue);
        skipHsDocRegex = true;
      } else if (hsDigitsDoc.length === 10) {
        const alreadyValid = await isExactHsMatch(serviceClient, hsDigitsDoc);
        if (alreadyValid && !hasDocsToScan) {
          console.log("[HS doc-regex] Existing HS valid and no documents to scan:", hsDigitsDoc);
          skipHsDocRegex = true;
        } else if (alreadyValid) {
          console.log("[HS doc-regex] Existing HS valid but documents available to re-scan for multi-HS:", hsDigitsDoc);
        }
      }

      if (!skipHsDocRegex && caseDocuments && caseDocuments.length > 0) {
        // Charger description cargo une fois (pour AI ranking sub-10)
        const { data: descFactDoc } = await serviceClient
          .from("quote_facts")
          .select("value_text")
          .eq("case_id", case_id)
          .eq("fact_key", "cargo.description")
          .eq("is_current", true)
          .maybeSingle();
        const cargoDescDoc = descFactDoc?.value_text || "";

        // 2. Extract HS candidates from all case_documents (detailed: capture sourceLen)
        // HS10-AUTO-INJECTION-GUARD v3 : on porte source_context + source_excerpt pour la garde Option C.
        const resolvedCandidates: Array<{
          code10: string;
          file: string;
          raw: string;
          source_context: HsAutoInjectionContext;
          source_excerpt?: string;
        }> = [];
        const subTenSeen = new Set<string>();

        for (const doc of caseDocuments) {
          if (!doc.extracted_text) continue;
          const detailedMatches = extractHsCodesFromTextDetailed(doc.extracted_text);
          for (const m of detailedMatches) {
            if (m.sourceLen === 10) {
              const hsResult = await resolveSenegalHsCode(serviceClient, m.digits);
              if (hsResult.status === "unique") {
                resolvedCandidates.push({
                  code10: hsResult.code10,
                  file: doc.file_name,
                  raw: m.digits,
                  source_context: m.context,
                  source_excerpt: m.excerpt,
                });
              }
            } else {
              // Source <10 chiffres → suggestion only, JAMAIS d'écriture cargo.hs_code
              const dedupeKey = `${m.digits}|${m.context}`;
              if (subTenSeen.has(dedupeKey)) continue;
              subTenSeen.add(dedupeKey);
              await handleSubTenHsSuggestion(serviceClient, {
                case_id,
                source_digits: m.digits,
                source_context: m.context,
                origin: "document_regex",
                source_label: doc.file_name,
                cargoDescription: cargoDescDoc,
                sourceExcerpt: m.excerpt,
                clientName: hsRankingClientName,
                documentSource: doc.file_name,
              });
            }
          }
        }


        // 3. Deduplicate by resolved code10
        const uniqueCodes = [...new Set(resolvedCandidates.map(r => r.code10))];

        if (uniqueCodes.length === 1) {
          // 4. Idempotency: skip if existing HS is identical
          if (hsDigitsDoc === uniqueCodes[0]) {
            console.log("[HS doc-regex] HS identical to existing, skip supersede");
          } else if (MANUAL_PROTECTED_SOURCES.has(hsFactDoc?.source_type ?? '')) {
            console.log("[HS doc-regex] Existing HS is manual source, skip supersede");
          } else {
            const match = resolvedCandidates.find(r => r.code10 === uniqueCodes[0])!;
            // HS10-AUTO-INJECTION-GUARD v3 : garde Option C (5 critères cumulatifs).
            const guard = await hs10AutoInjectionGuardAllows(serviceClient, {
              code10: match.code10,
              source_context: match.source_context,
              source_excerpt: match.source_excerpt,
            });
            if (!guard.allowed) {
              console.warn(`[HS doc-regex] Auto-injection BLOCKED Option C: ${guard.reason} (sh6=${guard.sh6})`);
              await handleSubTenHsSuggestion(serviceClient, {
                case_id,
                source_digits: match.code10,
                source_context: match.source_context,
                origin: "document_regex",
                source_label: match.file,
                cargoDescription: cargoDescDoc,
                sourceExcerpt: match.source_excerpt,
                clientName: hsRankingClientName,
                documentSource: match.file,
              });
              const gapCriticality = await assessHsCodeGapBlocking(serviceClient, case_id);
              await ensureHsCodeGap(serviceClient, {
                case_id,
                is_blocking: gapCriticality.is_blocking,
                question_fr: `HS10 ${match.code10} détecté (${match.file}) mais garde Option C : ${guard.reason}. Validation opérateur requise (criticité: ${gapCriticality.reason}).`,
                question_en: `HS10 ${match.code10} detected (${match.file}) but Option C guard: ${guard.reason}. Operator validation required (criticality: ${gapCriticality.reason}).`,
              });
              gapsIdentified++;
            } else {
              const { error: hsRpcErr } = await serviceClient.rpc("supersede_fact", {
                p_case_id: case_id,
                p_fact_key: "cargo.hs_code",
                p_fact_category: "cargo",
                p_value_text: match.code10,
                p_value_number: null,
                p_value_json: null,
                p_value_date: null,
                p_source_type: "document_regex",
                p_source_email_id: null,
                p_source_attachment_id: null,
                p_source_excerpt: `[document_regex] ${match.file}: ${match.raw} → ${match.code10}`,
                p_confidence: 0.95,
              });
              if (hsRpcErr) {
                console.error("[HS doc-regex] supersede_fact FAILED:", hsRpcErr.message);
              } else {
                factsAdded++;
                console.log("[HS doc-regex] Injected", match.code10, "from", match.file);
                await emitHs10AutoInjectionTrace(serviceClient, {
                  case_id, code10: match.code10, sh6: guard.sh6,
                  origin: "document_regex", source_label: match.file,
                  source_context: match.source_context,
                  confidence: 0.95, distinct_rates_count: guard.distinctRatesCount,
                });
              }
            }
          }
        } else if (uniqueCodes.length === 0) {
          console.log("[HS doc-regex] No HS found/resolved from case_documents");
        } else {
          // HS10-AUTO-INJECTION-GUARD v3 : multi-CSV supprimé (incompatible critère 3 cohérence cross-source).
          // → N suggestions HS10_CLASSIFICATION_SUGGESTION + GAP cargo.hs_code (criticité respectée).
          console.warn(`[HS doc-regex] Multi-HS detected (${uniqueCodes.length} distinct) — Option C : suggestions only, no auto-write`);
          const seenAutoBlocked = new Set<string>();
          for (const code10 of uniqueCodes) {
            if (seenAutoBlocked.has(code10)) continue;
            seenAutoBlocked.add(code10);
            const m = resolvedCandidates.find(r => r.code10 === code10)!;
            await handleSubTenHsSuggestion(serviceClient, {
              case_id,
              source_digits: m.code10,
              source_context: m.source_context,
              origin: "document_regex",
              source_label: m.file,
              cargoDescription: cargoDescDoc,
              sourceExcerpt: m.source_excerpt,
              clientName: hsRankingClientName,
              documentSource: m.file,
            });
          }
          const gapCriticality = await assessHsCodeGapBlocking(serviceClient, case_id);
          await ensureHsCodeGap(serviceClient, {
            case_id,
            is_blocking: gapCriticality.is_blocking,
            question_fr: `Plusieurs HS10 distincts détectés (${uniqueCodes.join(", ")}) dans les documents. Sélection opérateur requise (criticité: ${gapCriticality.reason}).`,
            question_en: `Multiple distinct HS10 detected (${uniqueCodes.join(", ")}) in documents. Operator selection required (criticality: ${gapCriticality.reason}).`,
          });
          gapsIdentified++;
        }
      }
    } catch (hsDocErr) {
      console.error("[HS doc-regex] Unexpected error:", hsDocErr);
    }

    // --- M3.4c: Deterministic HS extraction from emails (regex) --- C3.1-C
    try {
      // 1. Reload current cargo.hs_code (may have been updated by M3.4b)
      const { data: hsFactEmail } = await serviceClient
        .from("quote_facts")
        .select("id, value_text, source_type")
        .eq("case_id", case_id)
        .eq("fact_key", "cargo.hs_code")
        .eq("is_current", true)
        .maybeSingle();

      const hsRawEmailValue = (hsFactEmail?.value_text || "").trim();
      const hsDigitsEmail = hsRawEmailValue.replace(/\D/g, "");

      // P1 fix: detect if existing value is already a multi-HS CSV
      const emailTokens = hsRawEmailValue.split(/[;,]/).map((c: string) => c.trim()).filter(Boolean);
      const existingEmailIsMultiCsv = emailTokens.length > 1 && emailTokens.every((c: string) => /^\d{10}$/.test(c));
      const hasEmailsToScan = Array.isArray(emails) && emails.length > 0;

      let skipHsEmailRegex = false;
      if (existingEmailIsMultiCsv) {
        console.log("[HS email-regex] Existing HS is already multi-HS CSV, skip:", hsRawEmailValue);
        skipHsEmailRegex = true;
      } else if (hsDigitsEmail.length === 10) {
        const alreadyValid = await isExactHsMatch(serviceClient, hsDigitsEmail);
        if (alreadyValid && !hasEmailsToScan) {
          console.log("[HS email-regex] Existing HS valid and no emails to scan:", hsDigitsEmail);
          skipHsEmailRegex = true;
        } else if (alreadyValid) {
          console.log("[HS email-regex] Existing HS valid but emails available to re-scan for multi-HS:", hsDigitsEmail);
        }
      }

      if (!skipHsEmailRegex && emails && emails.length > 0) {
        const { data: descFactEmail } = await serviceClient
          .from("quote_facts")
          .select("value_text")
          .eq("case_id", case_id)
          .eq("fact_key", "cargo.description")
          .eq("is_current", true)
          .maybeSingle();
        const cargoDescEmail = descFactEmail?.value_text || "";

        // HS10-AUTO-INJECTION-GUARD v3 : porter source_context + source_excerpt pour la garde Option C.
        const resolvedEmailCandidates: Array<{
          code10: string;
          emailId: string;
          subject: string;
          raw: string;
          source_context: HsAutoInjectionContext;
          source_excerpt?: string;
        }> = [];
        const subTenSeenEmail = new Set<string>();

        for (const email of emails) {
          const emailText = [
            email.subject || "",
            extractPlainTextFromMime(email.body_text || ""),
          ].join(" ");

          const detailedMatches = extractHsCodesFromTextDetailed(emailText);
          for (const m of detailedMatches) {
            if (m.sourceLen === 10) {
              const hsResult = await resolveSenegalHsCode(serviceClient, m.digits);
              if (hsResult.status === "unique") {
                resolvedEmailCandidates.push({
                  code10: hsResult.code10,
                  emailId: email.id,
                  subject: email.subject || "(no subject)",
                  raw: m.digits,
                  source_context: m.context,
                  source_excerpt: m.excerpt,
                });
              }
            } else {
              // DCQ-P0-HS10-SAFE: source <10 chiffres → suggestion only
              const dedupeKey = `${m.digits}|${m.context}`;
              if (subTenSeenEmail.has(dedupeKey)) continue;
              subTenSeenEmail.add(dedupeKey);
              await handleSubTenHsSuggestion(serviceClient, {
                case_id,
                source_digits: m.digits,
                source_context: m.context,
                origin: "email_regex",
                source_label: email.subject || "(no subject)",
                cargoDescription: cargoDescEmail,
                sourceExcerpt: m.excerpt,
                clientName: hsRankingClientName,
                documentSource: email.subject || "(no subject)",
              });
            }
          }
        }


        // Deduplicate by resolved code10
        const uniqueEmailCodes = [...new Set(resolvedEmailCandidates.map(r => r.code10))];

        if (uniqueEmailCodes.length === 1) {
          // Idempotency: skip if existing HS is identical
          if (hsDigitsEmail === uniqueEmailCodes[0]) {
            console.log("[HS email-regex] HS identical to existing, skip supersede");
          } else if (MANUAL_PROTECTED_SOURCES.has(hsFactEmail?.source_type ?? '')) {
            console.log("[HS email-regex] Existing HS is manual source, skip supersede");
          } else {
            const match = resolvedEmailCandidates.find(r => r.code10 === uniqueEmailCodes[0])!;
            // HS10-AUTO-INJECTION-GUARD v3 : garde Option C.
            const guard = await hs10AutoInjectionGuardAllows(serviceClient, {
              code10: match.code10,
              source_context: match.source_context,
              source_excerpt: match.source_excerpt,
            });
            if (!guard.allowed) {
              console.warn(`[HS email-regex] Auto-injection BLOCKED Option C: ${guard.reason} (sh6=${guard.sh6})`);
              await handleSubTenHsSuggestion(serviceClient, {
                case_id,
                source_digits: match.code10,
                source_context: match.source_context,
                origin: "email_regex",
                source_label: match.subject,
                cargoDescription: cargoDescEmail,
                sourceExcerpt: match.source_excerpt,
                clientName: hsRankingClientName,
                documentSource: match.subject,
              });
              const gapCriticality = await assessHsCodeGapBlocking(serviceClient, case_id);
              await ensureHsCodeGap(serviceClient, {
                case_id,
                is_blocking: gapCriticality.is_blocking,
                question_fr: `HS10 ${match.code10} détecté (email: ${match.subject}) mais garde Option C : ${guard.reason}. Validation opérateur requise (criticité: ${gapCriticality.reason}).`,
                question_en: `HS10 ${match.code10} detected (email: ${match.subject}) but Option C guard: ${guard.reason}. Operator validation required (criticality: ${gapCriticality.reason}).`,
              });
              gapsIdentified++;
            } else {
              const { error: hsEmailRpcErr } = await serviceClient.rpc("supersede_fact", {
                p_case_id: case_id,
                p_fact_key: "cargo.hs_code",
                p_fact_category: "cargo",
                p_value_text: match.code10,
                p_value_number: null,
                p_value_json: null,
                p_value_date: null,
                p_source_type: "email_body",
                p_source_email_id: match.emailId,
                p_source_attachment_id: null,
                p_source_excerpt: `[email_regex] ${match.subject}: ${match.raw} → ${match.code10}`,
                p_confidence: 0.92,
              });
              if (hsEmailRpcErr) {
                console.error("[HS email-regex] supersede_fact FAILED:", hsEmailRpcErr.message);
              } else {
                factsAdded++;
                console.log("[HS email-regex] Injected", match.code10, "from email:", match.subject);
                await emitHs10AutoInjectionTrace(serviceClient, {
                  case_id, code10: match.code10, sh6: guard.sh6,
                  origin: "email_regex", source_label: match.subject,
                  source_context: match.source_context,
                  confidence: 0.92, distinct_rates_count: guard.distinctRatesCount,
                });
              }
            }
          }
        } else if (uniqueEmailCodes.length === 0) {
          console.log("[HS email-regex] No HS found/resolved from emails");
        } else {
          // HS10-AUTO-INJECTION-GUARD v3 : multi-CSV supprimé (incompatible critère 3).
          // → N suggestions + GAP cargo.hs_code (criticité respectée).
          console.warn(`[HS email-regex] Multi-HS detected (${uniqueEmailCodes.length} distinct) — Option C : suggestions only`);
          const seenAutoBlockedEmail = new Set<string>();
          for (const code10 of uniqueEmailCodes) {
            if (seenAutoBlockedEmail.has(code10)) continue;
            seenAutoBlockedEmail.add(code10);
            const m = resolvedEmailCandidates.find(r => r.code10 === code10)!;
            await handleSubTenHsSuggestion(serviceClient, {
              case_id,
              source_digits: m.code10,
              source_context: m.source_context,
              origin: "email_regex",
              source_label: m.subject,
              cargoDescription: cargoDescEmail,
              sourceExcerpt: m.source_excerpt,
              clientName: hsRankingClientName,
              documentSource: m.subject,
            });
          }
          const gapCriticality = await assessHsCodeGapBlocking(serviceClient, case_id);
          await ensureHsCodeGap(serviceClient, {
            case_id,
            is_blocking: gapCriticality.is_blocking,
            question_fr: `Plusieurs HS10 distincts détectés (${uniqueEmailCodes.join(", ")}) dans les emails. Sélection opérateur requise (criticité: ${gapCriticality.reason}).`,
            question_en: `Multiple distinct HS10 detected (${uniqueEmailCodes.join(", ")}) in emails. Operator selection required (criticality: ${gapCriticality.reason}).`,
          });
          gapsIdentified++;
        }
      }
    } catch (hsEmailErr) {
      console.error("[HS email-regex] Unexpected error:", hsEmailErr);
    }

    // --- Cargo value doc-regex: deterministic extraction from case_documents ---
    try {
      console.log(`[cargo-value doc-regex] Scanning ${(caseDocuments || []).filter(d => d.extracted_text).length} documents with extracted_text`);
      let bestCandidate: CargoValueExtraction | null = null;
      let bestDocName = '';
      for (const doc of (caseDocuments || [])) {
        if (!doc.extracted_text) continue;
        // SOURCE-GUARD-2: Skip internal/quotation documents from cargo value extraction
        if (doc.document_type && INTERNAL_DOC_TYPES.has(doc.document_type)) {
          console.log(`[SOURCE-GUARD-2] Skipping doc-regex on internal document "${doc.file_name}" (type: ${doc.document_type})`);
          continue;
        }
        console.log(`[cargo-value doc-regex] Text preview from "${doc.file_name || 'unknown'}":`, (doc.extracted_text || "").slice(0, 400));
        const candidate = extractCargoValueFromText(doc.extracted_text);
        console.log(`[cargo-value doc-regex] Candidate from "${doc.file_name || 'unknown'}":`, JSON.stringify(candidate));
        if (candidate.goodsValue && (!bestCandidate?.goodsValue || candidate.goodsValue > bestCandidate.goodsValue)) {
          bestCandidate = candidate;
          bestDocName = doc.file_name || 'unknown';
        }
      }

      if (!bestCandidate) {
        console.log("[cargo-value doc-regex] No candidate found in any document");
      }

      if (bestCandidate && (bestCandidate.goodsValue || bestCandidate.freightValue)) {
        console.log(`[cargo-value doc-regex] Best candidate from "${bestDocName}":`, JSON.stringify(bestCandidate));

        // Read existing facts from DB independently
        const cargoFactKeys = ['cargo.value', 'cargo.value_currency', 'cargo.freight_cost', 'cargo.freight_currency'];
        const { data: cargoExistingRows } = await serviceClient
          .from("quote_facts")
          .select("fact_key, value_text, value_number, source_type")
          .eq("case_id", case_id)
          .eq("is_current", true)
          .in("fact_key", cargoFactKeys);

        const existingFacts: Record<string, { value_number: number | null; value_text: string | null; source_type: string | null }> = {};
        for (const fk of cargoFactKeys) {
          const existing = (cargoExistingRows || []).find((f: any) => f.fact_key === fk);
          existingFacts[fk] = {
            value_number: existing?.value_number ?? null,
            value_text: existing?.value_text ?? null,
            source_type: existing?.source_type ?? null,
          };
        }

        const PROTECTED_SOURCES = new Set(['operator', 'manual_input', 'attachment_extracted']);
        const floatClose = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) < 0.01;

        // Helper to inject a single fact with guards
        const tryInjectFact = async (
          factKey: string, category: string,
          valueText: string | null, valueNumber: number | null,
          sourceExcerpt: string
        ) => {
          const ex = existingFacts[factKey];
          const hasRealValue = (ex.value_number !== null && Number.isFinite(ex.value_number))
            || (typeof ex.value_text === 'string' && ex.value_text.trim() !== '');
          if (ex.source_type && PROTECTED_SOURCES.has(ex.source_type) && hasRealValue) {
            console.log(`[cargo-value doc-regex] SKIP ${factKey}: protected source '${ex.source_type}' with real value`);
            return false;
          }
          // Idempotence: skip if same value
          if (valueNumber !== null && floatClose(ex.value_number, valueNumber)) {
            console.log(`[cargo-value doc-regex] SKIP ${factKey}: same value ${valueNumber}`);
            return false;
          }
          if (valueText !== null && valueNumber === null && ex.value_text === valueText) {
            console.log(`[cargo-value doc-regex] SKIP ${factKey}: same text "${valueText}"`);
            return false;
          }

          const { error } = await serviceClient.rpc("supersede_fact", {
            p_case_id: case_id,
            p_fact_key: factKey,
            p_fact_category: category,
            p_value_text: valueText,
            p_value_number: valueNumber,
            p_value_json: null,
            p_value_date: null,
            p_source_type: "document_regex",
            p_source_email_id: null,
            p_source_attachment_id: null,
            p_source_excerpt: `[doc-regex] ${sourceExcerpt} from "${bestDocName}"`,
            p_confidence: 0.88,
          });
          if (error) {
            console.error(`[cargo-value doc-regex] supersede_fact ${factKey} FAILED:`, error.message);
            return false;
          }
          factsAdded++;
          console.log(`[cargo-value doc-regex] Injected ${factKey} = ${valueNumber ?? valueText}`);
          return true;
        };

        // Inject cargo.value (goods value, never totalValue directly)
        if (bestCandidate.goodsValue) {
          await tryInjectFact('cargo.value', 'cargo', null, bestCandidate.goodsValue,
            bestCandidate.goodsSource || 'goods_from_sous_total');
        }

        // Inject cargo.value_currency
        if (bestCandidate.currency) {
          await tryInjectFact('cargo.value_currency', 'cargo', bestCandidate.currency, null,
            `currency_${bestCandidate.currency}`);
        }

        // Inject cargo.freight_cost
        if (bestCandidate.freightValue) {
          await tryInjectFact('cargo.freight_cost', 'cargo', null, bestCandidate.freightValue,
            'freight_from_transport_export');
        }

        // Inject cargo.freight_currency (same as goods currency)
        if (bestCandidate.freightValue && bestCandidate.currency) {
          await tryInjectFact('cargo.freight_currency', 'cargo', bestCandidate.currency, null,
            `freight_currency_${bestCandidate.currency}`);
        }
      }
    } catch (cargoValErr) {
      console.error("[cargo-value doc-regex] Unexpected error:", cargoValErr);
    }

    // --- M3.5: Multi-quote line detection (C3.2-A) ---
    try {
      console.log("[M3.5 multi-quote] using active latest inbound context");
      const activeMultiQuoteContext = buildActiveMultiQuoteContext(emails, fullAttachmentContext);
      const clearQuoteRequestLines = async (mode: string) => {
        console.log("[M3.5 multi-quote] no defensible active multi-quote lines, clearing quote_request_lines");
        const { data: clearedCount, error: clearErr } = await serviceClient.rpc(
          "replace_quote_request_lines",
          { p_case_id: case_id, p_lines: [] }
        );
        if (clearErr) {
          console.warn("[M3.5 multi-quote] Clear RPC error (non-blocking):", clearErr.message);
          multiQuoteResult = { detected: false, stored: 0, mode: "clear_error" };
        } else {
          multiQuoteResult = { detected: false, stored: clearedCount ?? 0, mode };
        }
      };

      const rawGateText = activeMultiQuoteContext || "";
      const gateText = stripSubjectLinesForMultiQuoteGate(rawGateText);
      const rawMarkersDetected = detectMultiQuoteMarkers(rawGateText);
      const gateMarkersDetected = detectMultiQuoteMarkers(gateText);

      if (rawMarkersDetected && !gateMarkersDetected) {
        console.log("[M3.5 multi-quote] subject-only markers ignored");
        await clearQuoteRequestLines("subject_only_ignored");
      } else if (gateMarkersDetected) {
        console.log("[M3.5 multi-quote] Markers detected, launching AI extraction...");
        const quoteLines = await extractQuoteLinesWithAI(
          activeMultiQuoteContext, fullAttachmentContext, emails, lovableApiKey || ""
        );

        if (Array.isArray(quoteLines) && quoteLines.length > 0) {
          const sourceEmailId = pickSourceEmailId(inboundEmails);

          const linesPayload = quoteLines.map((line, idx) => ({
            line_index: idx + 1,
            line_label: line.line_label || `Quote ${idx + 1}`,
            request_type_hint: line.request_type_hint || null,
            confidence: typeof line.confidence === "number" ? line.confidence : 0.8,
            source_email_id: sourceEmailId,
            source_excerpt: line.source_excerpt || `[multi-quote] ${line.line_label || `Quote ${idx + 1}`}`,
            segment_text: line.segment_text || null,
            extracted_facts_json: Array.isArray(line.extracted_facts) ? line.extracted_facts : [],
            meta_json: line.meta_json && typeof line.meta_json === "object" && !Array.isArray(line.meta_json) ? line.meta_json : {},
          }));

          const minFactLinesPayload = linesPayload.filter(
            (l) => Array.isArray(l.extracted_facts_json) && l.extracted_facts_json.length >= 2
          );
          const activeEvidenceText = `${activeMultiQuoteContext}\n${fullAttachmentContext || ""}`;
          const validLinesPayload = minFactLinesPayload.filter((line) => {
            const keep = isDefensibleMultiQuoteLine(
              line.segment_text,
              line.source_excerpt,
              activeEvidenceText
            );
            if (!keep) {
              console.log(`[M3.5 multi-quote] Line ${line.line_index} rejected: subject-only or insufficient active body/attachment evidence`);
            }
            return keep;
          });

          if (validLinesPayload.length > 0) {
            const { data: storedCount, error: rpcErr } = await serviceClient.rpc(
              "replace_quote_request_lines",
              { p_case_id: case_id, p_lines: validLinesPayload }
            );

            if (rpcErr) {
              console.warn("[M3.5 multi-quote] RPC error (non-blocking):", rpcErr.message);
              multiQuoteResult = { detected: true, stored: 0, mode: "rpc_error" };
            } else {
              console.log(`[M3.5 multi-quote] Stored ${storedCount} quote request lines`);
              multiQuoteResult = { detected: true, stored: storedCount ?? 0, mode: "ai_extraction" };
            }
          } else if (minFactLinesPayload.length > 0) {
            console.log("[M3.5 multi-quote] All candidate lines rejected as subject-only or lacking active body/attachment evidence");
            await clearQuoteRequestLines("subject_only_ignored");
          } else {
            console.log("[M3.5 multi-quote] No valid lines after validation (min 2 facts required)");
            await clearQuoteRequestLines("no_defensible_active_lines");
          }
        } else {
          await clearQuoteRequestLines("ai_no_lines");
        }
      } else {
        await clearQuoteRequestLines("no_active_multi_quote");
      }
    } catch (mqErr) {
      console.warn("[M3.5 multi-quote] Non-blocking error:", mqErr);
      multiQuoteResult = { detected: true, stored: 0, mode: "exception" };
    }

    // --- Regime evidence-based detection from case_documents ---
    try {
      // Helper: extract regime codes and exemption titles from text
      function extractRegimeCandidatesFromText(text: string): { regimeCodes: string[], titles: string[] } {
        const regimeCodes: string[] = [];
        const titles: string[] = [];

        const codePatterns = [
          /R[ée]gime\s*:?\s*\n?\s*(C[\s\-\/]?\d{3,4}|S[\s\-\/]?\d{3,4}|\d{4})/gi,
          /Code\s*r[ée]gime\s*:?\s*\n?\s*(C[\s\-\/]?\d{3,4}|S[\s\-\/]?\d{3,4}|\d{4})/gi,
        ];
        for (const p of codePatterns) {
          let m;
          while ((m = p.exec(text)) !== null) {
            // Normalize: remove spaces/dashes/slashes, uppercase
            regimeCodes.push(m[1].replace(/[\s\-\/]/g, "").toUpperCase());
          }
        }

        const titlePattern = /(Titre\s*d[''\u2019]exon[ée]ration\s*:?\s*)([^\r\n]{5,120})/i;
        const tm = text.match(titlePattern);
        if (tm) {
          let titleValue = tm[2].trim();
          // Si la valeur capturée est juste un label (ex: "Numero:"), chercher la vraie valeur sur la ligne suivante
          if (/^Num[ée]ro\s*:?\s*$/i.test(titleValue)) {
            const numMatch = text.match(/Num[ée]ro\s*:?\s*\n?\s*([A-Z0-9][\w\-\/\s]*\d)/i);
            if (numMatch) {
              titleValue = numMatch[1].trim();
            }
          }
          if (titleValue.length > 3 && !/^(Num[ée]ro|R[ée]gime)\s*:?\s*$/i.test(titleValue)) {
            titles.push(titleValue);
          }
        }

        // DCQ-P0-HS10-SAFE-EXEMPTION (v3): patterns EN d'exonération.
        // Règle stricte : un titre n'est créé QUE si un signal explicite d'exonération est présent.
        // SENELEC/SONATEL/SENEAU/SAR seuls (sans signal) ≠ preuve d'exonération.
        const EXEMPTION_PATTERNS: RegExp[] = [
          /exempted?\s+from\s+(?:duties\s*(?:and\s*taxes)?|customs\s+duties|tax(?:es)?)/i,
          /duty[\s\-]?free/i,
          /tax[\s\-]?exempt(?:ed|ion)?/i,
          /march[ée]\s+public/i,
          /public\s+market/i,
          /government\s+contract/i,
          /titre\s+d[''\u2019]?exon[ée]ration/i,
        ];
        const PUBLIC_CLIENT_PATTERNS: RegExp[] = [
          /\b(SENELEC|SONATEL|SENEAU|SAR|SONACOS|ONAS|PETROSEN)\b/i,
        ];
        const exemptionMatch = EXEMPTION_PATTERNS.map((p) => text.match(p)).find((m) => m);
        if (exemptionMatch) {
          const clientMatch = PUBLIC_CLIENT_PATTERNS.map((p) => text.match(p)).find((m) => m);
          const signal = exemptionMatch[0].trim();
          const clientLabel = clientMatch ? ` (client: ${clientMatch[1].toUpperCase()})` : "";
          const composedTitle = `Indice exonération: ${signal}${clientLabel}`.slice(0, 200);
          titles.push(composedTitle);
        }

        return {
          regimeCodes: [...new Set(regimeCodes)],
          titles: [...new Set(titles)],
        };
      }

      const allRegimeCodes: string[] = [];
      const allTitles: string[] = [];
      const excerpts: string[] = [];

      // Scan case_documents
      if (caseDocuments && caseDocuments.length > 0) {
        for (const doc of caseDocuments) {
          if (!doc.extracted_text) continue;
          const { regimeCodes, titles } = extractRegimeCandidatesFromText(doc.extracted_text);
          for (const code of regimeCodes) {
            allRegimeCodes.push(code);
            excerpts.push(`[document_regex] ${doc.file_name}: régime ${code}`);
          }
          for (const title of titles) {
            allTitles.push(title);
          }
        }
      }

      // Scan email bodies
      if (emails && emails.length > 0) {
        for (const email of emails) {
          const emailText = (email.body_text || email.subject || "");
          if (!emailText) continue;
          const { regimeCodes, titles } = extractRegimeCandidatesFromText(emailText);
          for (const code of regimeCodes) {
            allRegimeCodes.push(code);
            excerpts.push(`[email] ${email.from_address}: régime ${code}`);
          }
          for (const title of titles) {
            allTitles.push(title);
          }
        }
      }

      const uniqueRegimeCodes = [...new Set(allRegimeCodes)];
      const uniqueTitles = [...new Set(allTitles)];

      // Check existing regime fact (skip if manual_input)
      const { data: existingRegimeFact } = await serviceClient
        .from("quote_facts")
        .select("id, source_type")
        .eq("case_id", case_id)
        .eq("fact_key", "customs.regime_code")
        .eq("is_current", true)
        .maybeSingle();

      const isRegimeManual = MANUAL_PROTECTED_SOURCES.has(existingRegimeFact?.source_type ?? '');

      // 1. If exactly one regime code found and no manual override exists
      if (uniqueRegimeCodes.length === 1 && !isRegimeManual) {
        const candidateCode = uniqueRegimeCodes[0];
        const { data: regimeRow } = await serviceClient
          .from("customs_regimes")
          .select("code, name, is_active")
          .eq("code", candidateCode)
          .eq("is_active", true)
          .maybeSingle();

        if (regimeRow) {
          const { error: regimeRpcErr } = await serviceClient.rpc("supersede_fact", {
            p_case_id: case_id,
            p_fact_key: "customs.regime_code",
            p_fact_category: "customs",
            p_value_text: candidateCode,
            p_value_number: null,
            p_value_json: null,
            p_value_date: null,
            p_source_type: "document_regex",
            p_source_email_id: null,
            p_source_attachment_id: null,
            p_source_excerpt: excerpts[0] || `[document_regex] ${candidateCode}`,
            p_confidence: 0.95,
          });
          if (regimeRpcErr) {
            console.error("[Regime doc-regex] supersede_fact FAILED:", regimeRpcErr.message);
          } else {
            factsAdded++;
            console.log(`[Regime doc-regex] Injected customs.regime_code=${candidateCode}`);
          }
        } else {
          // Unknown regime code — create non-blocking GAP
          const { data: existingRegimeGap } = await serviceClient
            .from("quote_gaps")
            .select("id")
            .eq("case_id", case_id)
            .eq("gap_key", "customs.regime_code")
            .eq("status", "open")
            .maybeSingle();

          if (!existingRegimeGap?.id) {
            await serviceClient.from("quote_gaps").insert({
              case_id,
              gap_key: "customs.regime_code",
              gap_category: "customs",
              question_fr: `Le code régime "${candidateCode}" détecté dans les documents n'a pas été trouvé dans la nomenclature active. Veuillez préciser le code régime douanier.`,
              question_en: `Regime code "${candidateCode}" detected in documents was not found in active nomenclature. Please specify the customs regime code.`,
              priority: "high",
              is_blocking: false,
            });
            gapsIdentified++;
            console.log(`[Regime doc-regex] Created GAP for unknown regime ${candidateCode}`);
          }
        }
      } else if (uniqueRegimeCodes.length > 1) {
        console.warn(`[Regime doc-regex] Multiple regime candidates: ${uniqueRegimeCodes.join(", ")} — skipping injection`);
      }

      // 2. Exemption title injection
      if (uniqueTitles.length > 0 && !isRegimeManual) {
        const { data: existingTitleFact } = await serviceClient
          .from("quote_facts")
          .select("id, source_type")
          .eq("case_id", case_id)
          .eq("fact_key", "regulatory.exemption_title")
          .eq("is_current", true)
          .maybeSingle();

        if (!existingTitleFact || !MANUAL_PROTECTED_SOURCES.has(existingTitleFact.source_type ?? '')) {
          const { error: titleRpcErr } = await serviceClient.rpc("supersede_fact", {
            p_case_id: case_id,
            p_fact_key: "regulatory.exemption_title",
            p_fact_category: "regulatory",
            p_value_text: uniqueTitles[0],
            p_value_number: null,
            p_value_json: null,
            p_value_date: null,
            p_source_type: "document_regex",
            p_source_email_id: null,
            p_source_attachment_id: null,
            p_source_excerpt: `[document_regex] Titre d'exonération: ${uniqueTitles[0]}`,
            p_confidence: 0.90,
          });
          if (titleRpcErr) {
            console.error("[Regime doc-regex] exemption_title supersede_fact FAILED:", titleRpcErr.message);
          } else {
            factsAdded++;
            console.log(`[Regime doc-regex] Injected regulatory.exemption_title`);
          }

          // If no regime code was injected → GAP
          if (uniqueRegimeCodes.length === 0 && !existingRegimeFact) {
            const { data: existingRegimeGap2 } = await serviceClient
              .from("quote_gaps")
              .select("id")
              .eq("case_id", case_id)
              .eq("gap_key", "customs.regime_code")
              .eq("status", "open")
              .maybeSingle();

            if (!existingRegimeGap2?.id) {
              await serviceClient.from("quote_gaps").insert({
                case_id,
                gap_key: "customs.regime_code",
                gap_category: "customs",
                question_fr: `Un titre d'exonération a été détecté mais aucun code régime. Renseignez le régime douanier pour appliquer l'exonération.`,
                question_en: `An exemption title was detected but no regime code. Please specify the customs regime code to apply the exemption.`,
                priority: "high",
                is_blocking: false,
              });
              gapsIdentified++;
              console.log(`[Regime doc-regex] Created GAP: exemption title without regime code`);
            }
          }
        }
      }

      // 3. If regulatory.dpi_expected=true and no regime → suggest via GAP
      const { data: dpiFact } = await serviceClient
        .from("quote_facts")
        .select("value_text")
        .eq("case_id", case_id)
        .eq("fact_key", "regulatory.dpi_expected")
        .eq("is_current", true)
        .maybeSingle();

      if (dpiFact?.value_text === "true" && !existingRegimeFact) {
        const { data: existingDpiGap } = await serviceClient
          .from("quote_gaps")
          .select("id")
          .eq("case_id", case_id)
          .eq("gap_key", "customs.regime_code")
          .eq("status", "open")
          .maybeSingle();

        if (!existingDpiGap?.id) {
          await serviceClient.from("quote_gaps").insert({
            case_id,
            gap_key: "customs.regime_code",
            gap_category: "customs",
            question_fr: `DPI attendu — veuillez préciser le régime douanier applicable (ex: C134 Code investissements, C131 ZES/APIX, C111 Droit commun). Ne pas injecter automatiquement.`,
            question_en: `DPI expected — please specify applicable customs regime (e.g. C134, C131, C111). Do not auto-inject.`,
            priority: "high",
            is_blocking: false,
          });
          gapsIdentified++;
          console.log(`[Regime dpi_expected] Created GAP with suggestions (no auto-inject)`);
        }
      }
    } catch (regimeDocErr) {
      console.error("[Regime doc-regex] Unexpected error:", regimeDocErr);
    }

    // --- HS Code post-attachment validation ---
    // Re-check cargo.hs_code after attachment injection: validate/resolve to 10 digits
    try {
      const { data: hsFactRow } = await serviceClient
        .from("quote_facts")
        .select("id, value_text, source_type")
        .eq("case_id", case_id)
        .eq("fact_key", "cargo.hs_code")
        .eq("is_current", true)
        .maybeSingle();

      if (hsFactRow) {
        const rawHsValue = (hsFactRow.value_text || "").trim();

        // C3.1-D: Guard against empty HS code — skip validation, deactivate fact
        if (!rawHsValue) {
          console.warn("[HS Post-Attach] Empty cargo.hs_code — skipping validation, deactivating fact");
          await serviceClient.from("quote_facts")
            .update({ is_current: false, updated_at: new Date().toISOString() })
            .eq("id", hsFactRow.id);
          factsUpdated++;
        } else {
        // P1 Guard: skip post-attach validation for multi-HS CSV values
        const hsTokens = rawHsValue.split(/[;,]/).map((c: string) => c.trim()).filter(Boolean);
        const isMultiHsCsv = hsTokens.length > 1 && hsTokens.every((c: string) => /^\d{10}$/.test(c));

        if (isMultiHsCsv) {
          console.log("[HS Post-Attach] Multi-HS CSV detected, skipping re-validation:", rawHsValue);
        } else {
        const digitsOnly = rawHsValue.replace(/\D/g, "");

        // Only re-validate if not already a valid 10-digit code
        if (digitsOnly.length !== 10 || !(await isExactHsMatch(serviceClient, digitsOnly))) {
          // S5: protect manual HS from automated re-validation/deactivation
          if (MANUAL_PROTECTED_SOURCES.has(hsFactRow.source_type ?? '')) {
            console.log(`[HS Post-Attach] Manual HS preserved, skipping re-validation (source=${hsFactRow.source_type})`);
          } else {
          // DCQ-P0-HS10-SAFE: refuser toute promotion sub-10. Si la valeur courante a moins de 10 chiffres,
          // l'invalider et basculer en suggestion (jamais d'écriture cargo.hs_code par inférence SH6→unique).
          if (digitsOnly.length < 10) {
            console.warn(`[HS Post-Attach] Refused sub-10 promotion for existing fact (digits=${digitsOnly.length}, raw=${rawHsValue})`);
            await serviceClient
              .from("quote_facts")
              .update({ is_current: false, updated_at: new Date().toISOString() })
              .eq("id", hsFactRow.id);
            factsUpdated++;
            const { data: descFactPA } = await serviceClient
              .from("quote_facts").select("value_text").eq("case_id", case_id)
              .eq("fact_key", "cargo.description").eq("is_current", true).maybeSingle();
            await handleSubTenHsSuggestion(serviceClient, {
              case_id,
              source_digits: digitsOnly,
              source_context: "hs_label",
              origin: "post_attach",
              cargoDescription: descFactPA?.value_text || "",
              clientName: hsRankingClientName,
            });
            gapsIdentified++;
          } else {
          const hsResult = await resolveSenegalHsCode(serviceClient, rawHsValue);

          if (hsResult.status === "unique") {
            // Source est 10 chiffres et résout en HS10 unique → écriture autorisée.
            // HS10-AUTO-INJECTION-GUARD v3 : Path C inchangé.
            // Re-validation d'un cargo.hs_code DÉJÀ présent (manuel ou écrit par M3.4b/c sous garde Option C).
            // La garde Option C s'applique uniquement aux paths d'écriture initiale (M3.4b/c),
            // pas à la re-validation Post-Attach qui ne crée pas de nouveau fact d'origine externe.
            await serviceClient.rpc("supersede_fact", {
              p_case_id: case_id,
              p_fact_key: "cargo.hs_code",
              p_fact_category: "cargo",
              p_value_text: hsResult.code10,
              p_value_number: null,
              p_value_json: null,
              p_value_date: null,
              p_source_type: "hs_resolution",
              p_source_email_id: null,
              p_source_attachment_id: null,
              p_source_excerpt: `[HS Resolution] ${rawHsValue} → ${hsResult.code10} (${hsResult.description || "N/A"})`,
              p_confidence: 1.0,
            });
            console.log(`[HS Post-Attach] Resolved ${rawHsValue} → ${hsResult.code10}`);

          } else {
            // ambiguous or not_found → invalidate the fact + create GAP
            // Deactivate the invalid fact
            await serviceClient
              .from("quote_facts")
              .update({ is_current: false, updated_at: new Date().toISOString() })
              .eq("id", hsFactRow.id);
            factsUpdated++;

            console.warn(`[HS Post-Attach] Invalidated cargo.hs_code=${rawHsValue} (${hsResult.status})`);

            // Create blocking GAP for cargo.hs_code
            const { data: existingHsGap } = await serviceClient
              .from("quote_gaps")
              .select("id")
              .eq("case_id", case_id)
              .eq("gap_key", "cargo.hs_code")
              .eq("status", "open")
              .maybeSingle();

            if (!existingHsGap?.id) {
              const candidatesHint = hsResult.status === "ambiguous"
                ? ` Candidats possibles: ${hsResult.candidates.slice(0, 5).map((c: any) => c.code10).join(", ")}`
                : "";

              await serviceClient.from("quote_gaps").insert({
                case_id,
                gap_key: "cargo.hs_code",
                gap_category: "cargo",
                question_fr: `Le code HS "${rawHsValue}" n'a pas pu être validé dans la nomenclature UEMOA (${hsResult.status}).${candidatesHint} Veuillez préciser le code HS 10 chiffres exact.`,
                question_en: `HS code "${rawHsValue}" could not be validated in UEMOA nomenclature (${hsResult.status}).${candidatesHint} Please provide the exact 10-digit HS code.`,
                priority: "high",
                is_blocking: true,
              });
              gapsIdentified++;
              console.log(`[HS Post-Attach] Created blocking GAP for cargo.hs_code (${hsResult.status})`);
            }
        }
        } // end else (digits===10 branch — DCQ-P0-HS10-SAFE)
        } // end else (S5 manual source guard)
        }
        } // end else (multi-HS guard)
        } // end else (non-empty rawHsValue)
      }
    } catch (hsErr) {
      console.error("[HS Post-Attach] Unexpected error:", hsErr);
    }

    // --- M3.5.1: Apply hypothesis engine (after M3.4, before gap detection) ---
    // A1: Pass requestType so AIR_IMPORT assumptions can be applied
    const assumptionResult = await applyAssumptionRules(case_id, serviceClient, emailIds, detectedType);
    factsAdded += assumptionResult.added;

    // STRUCTURAL_PATCH_ALLOWED: Export gap profile — use flowType for gap analysis when EXPORT_SENEGAL (2026-04-07)
    const gapProfileType = assumptionResult.flowType === "EXPORT_SENEGAL" && MANDATORY_FACTS.EXPORT_SENEGAL
      ? "EXPORT_SENEGAL"
      : detectedType;

    // P0 FCL constraints: deterministic post-processing after AI/fallback/doc extraction, before gap analysis.
    const deterministicConstraintContext = [inboundThreadContext, fullAttachmentContext].filter(Boolean).join("\n\n");
    const fclConstraintResult = await applyFclConstraintPostProcessing({
      case_id,
      serviceClient,
      text: deterministicConstraintContext,
      sourceEmailId: pickSourceEmailId(inboundEmails),
    });
    factsAdded += fclConstraintResult.added;
    factsUpdated += fclConstraintResult.updated;
    factsSkipped += fclConstraintResult.skipped;
    gapsIdentified += fclConstraintResult.gapsIdentified;

    // CARGO-CONFLICT-GUARD-GWC-1: deterministic guards driven by the latest
    // inbound (non-SODATRA) client email body. Subjects are excluded — body only.
    const latestInboundEmailForGuard = inboundEmails[inboundEmails.length - 1];
    const latestInboundBodyForGuard = extractPlainTextFromMime(latestInboundEmailForGuard?.body_text || "");
    const cargoConflictResult = await applyCargoConflictGuards({
      case_id,
      serviceClient,
      latestInboundBody: latestInboundBodyForGuard,
    });
    factsUpdated += cargoConflictResult.factsDeactivated;
    gapsIdentified += cargoConflictResult.gapsIdentified;

    // EMAIL-DOC-PROVENANCE-GUARD-1: deactivate already-active cargo facts traceable
    // to a historical SODATRA quotation document and raise an idempotent blocking
    // gap. Complements the pre-write drop above (covers facts written by prior runs).
    const docProvenanceGuardResult = await applyEmailDocProvenanceGuard({
      case_id,
      serviceClient,
      latestInboundBody: docProvenanceLatestClientBody,
      historicalDocTexts: docProvenanceHistoricalDocTexts,
      preWriteDroppedFactKeys: docProvenanceDrop.dropped.map((f) => f.key),
    });
    factsUpdated += docProvenanceGuardResult.factsDeactivated;
    gapsIdentified += docProvenanceGuardResult.gapsIdentified;

    // PIECES-COUNT-LATEST-CLIENT-GUARD-1: latest explicit client bus total wins
    // over any non-protected cargo.pieces_count (storage-agnostic deactivation).
    const piecesCountGuardResult = await applyLatestClientPiecesCountGuard({
      case_id,
      serviceClient,
      latestInboundBody: latestInboundBodyForGuard,
    });
    factsUpdated += piecesCountGuardResult.factsDeactivated;
    gapsIdentified += piecesCountGuardResult.gapsIdentified;

    // THREAD-TEMPORAL-PROVENANCE-1: generic value-currency reconciliation. The
    // LATEST inbound body takes precedence for the client currency; if it is
    // ambiguous, the whole inbound thread is used only when it carries a single
    // explicit currency. When that client currency differs from a non-manual
    // stored cargo.value_currency, deactivate the stored one and raise a blocking
    // confirmation gap. Currency agnostic; never converts, never invents.
    const currencyGuardResult = await applyClientValueCurrencyGuard({
      case_id,
      serviceClient,
      latestInboundText: latestInboundBodyForGuard,
      fullThreadText: inboundThreadContext,
    });
    factsUpdated += currencyGuardResult.factsDeactivated;
    gapsIdentified += currencyGuardResult.gapsIdentified;

    // --- Phase client.code: Auto-inject client.code from known_business_contacts ---
    try {
      const { data: knownContacts } = await serviceClient
        .from("known_business_contacts")
        .select("domain_pattern, client_code, default_role")
        .eq("is_active", true)
        .not("client_code", "is", null);

      if (knownContacts && knownContacts.length > 0) {
        const requestEmail = emails.find((e: any) => e.is_quotation_request) || emails[0];
        const senderDomain = requestEmail.from_address?.split("@")[1]?.toLowerCase();

        if (senderDomain) {
          // CTO Correction 2: suffix matching for subdomains
          const matchedContact = knownContacts.find(
            (c: any) => senderDomain.endsWith(c.domain_pattern.toLowerCase())
          );

          if (matchedContact?.client_code) {
            // CTO Correction 1: maybeSingle() + manual override protection
            const { data: existingClientCode } = await serviceClient
              .from("quote_facts")
              .select("id, source_type")
              .eq("case_id", case_id)
              .eq("fact_key", "client.code")
              .eq("is_current", true)
              .maybeSingle();

            const isManual =
              existingClientCode &&
              MANUAL_PROTECTED_SOURCES.has(existingClientCode.source_type ?? '');

            if (!isManual) {
              const { error: clientCodeError } = await serviceClient.rpc("supersede_fact", {
                p_case_id: case_id,
                p_fact_key: "client.code",
                p_fact_category: "contacts",
                p_value_text: matchedContact.client_code,
                p_value_number: null,
                p_value_json: null,
                p_value_date: null,
                p_source_type: "known_contact_match",
                p_source_email_id: requestEmail.id,
                p_source_attachment_id: null,
                p_source_excerpt: `Auto-matched domain ${senderDomain} -> ${matchedContact.client_code}`,
                p_confidence: 0.95,
              });

              if (clientCodeError) {
                console.error(`[client.code] Failed to inject:`, clientCodeError);
              } else {
                factsAdded++;
                console.log(`[client.code] Injected: ${matchedContact.client_code} (domain: ${senderDomain})`);

                await serviceClient.from("case_timeline_events").insert({
                  case_id,
                  event_type: "fact_added",
                  event_data: {
                    fact_key: "client.code",
                    value: matchedContact.client_code,
                    matched_domain: senderDomain,
                    source: "known_contact_match",
                  },
                  actor_type: "system",
                });
              }
            } else {
              console.log(`[client.code] Skipped: manual override exists (source_type=manual_input)`);
            }
          }
        }
      }
    } catch (clientCodeErr) {
      console.error(`[client.code] Unexpected error:`, clientCodeErr);
    }

    // Phase V4.1.3: Only block on CRITICAL fact errors, not all errors
    if (factErrors.length > 0) {
      const criticalErrors = factErrors.filter(e => e.isCritical);
      console.error(`${factErrors.length} fact errors for case ${case_id} (${criticalErrors.length} critical):`, factErrors);
      
      // Only block progression for critical errors
      if (criticalErrors.length > 0) {
        await serviceClient
          .from("quote_cases")
          .update({
            status: "FACTS_PARTIAL",
            last_activity_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", case_id);

        return new Response(
          JSON.stringify({
            case_id,
            new_status: "FACTS_PARTIAL",
            facts_added: factsAdded,
            facts_updated: factsUpdated,
            facts_skipped: factsSkipped,
            fact_errors: factErrors,
            critical_errors_count: criticalErrors.length,
            ready_to_price: false,
            error_summary: `${criticalErrors.length} critical facts failed to save`
          }),
          { status: 207, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      // Non-critical errors: log warning and continue to gap analysis
      console.warn(`[V4.1.3] ${factErrors.length} non-critical fact errors ignored, continuing to gap analysis`);
    }

    // 10. Identify gaps
    const mandatoryFacts = MANDATORY_FACTS[gapProfileType] || MANDATORY_FACTS.UNKNOWN;
    const extractedKeys = extractedFacts.map((f) => f.key);
    
    // gapsIdentified already initialized above (before doc-regex block)

    // Load existing DB facts BEFORE any gap logic (mandatory/orphan/A1)
    const { data: existingDbFacts } = await serviceClient
      .from("quote_facts")
      .select("fact_key, value_text, value_number")
      .eq("case_id", case_id)
      .eq("is_current", true);

    const existingDbKeys = (existingDbFacts || []).map((f: { fact_key: string }) => f.fact_key);

    const exportSeaFreightOrchestration = await ensureExportSeaFreightPartnerOrchestration({
      case_id,
      serviceClient,
    });
    if (exportSeaFreightOrchestration.gapCreated) gapsIdentified++;

    // Phase 15.6: helpers for policy required keys
    const getText156 = (k: string) =>
      String((existingDbFacts || []).find((f: any) => f.fact_key === k)?.value_text ?? "").trim();
    const getNumber156 = (k: string) => {
      const row = (existingDbFacts || []).find((f: any) => f.fact_key === k);
      if (row && Number.isFinite(row.value_number)) return Number(row.value_number);
      const raw = String(row?.value_text ?? "").trim();
      if (!raw) return NaN;
      const n = Number(raw.replace(/\s/g, "").replace(/,/g, "."));
      return Number.isFinite(n) ? n : NaN;
    };

    const pkg156 = getText156("service.package").toUpperCase();
    const incotermPolicy = getText156("routing.incoterm").toUpperCase();
    const scopeWantsDuties = pkg156.endsWith("_DDP") || pkg156 === "DDP" || incotermPolicy === "DDP";

    const hsRaw156 = getText156("cargo.hs_code");
    const hsHasValid10 = hsRaw156.split(/[;,]/)
      .map((t: string) => t.trim().replace(/\D/g, ""))
      .some((d: string) => d.length === 10);

    const hasExemptionTitle156 = getText156("regulatory.exemption_title").length > 0;
    const hasRegimeCode156 = getText156("customs.regime_code").length > 0;

    const isFobType156 = ["FOB", "FCA", "FAS", "EXW"].includes(incotermPolicy);
    const freightCost156 = getNumber156("cargo.freight_cost");
    const hasFreightCost156 = Number.isFinite(freightCost156) && freightCost156 > 0;
    const freightCurrency156 = getText156("cargo.freight_currency").toUpperCase();
    // Phase 16: cargo.freight_exchange_rate removed — exchange_rates table is source of truth

    const cargoValue156 = getNumber156("cargo.value");
    const hasCargoValue156 = Number.isFinite(cargoValue156) && cargoValue156 > 0;

    const policyRequiredKeys = new Set<string>();
    if (scopeWantsDuties) {
      if (!hsHasValid10) policyRequiredKeys.add("cargo.hs_code");
      if (hasExemptionTitle156 && !hasRegimeCode156) policyRequiredKeys.add("customs.regime_code");
      if (isFobType156 && !hasFreightCost156) policyRequiredKeys.add("cargo.freight_cost");
      if (!hasCargoValue156) policyRequiredKeys.add("cargo.value");
      // Phase 16: cargo.freight_exchange_rate removed from policy keys
    }

    const transportModeRaw = (existingDbFacts || [])
      .find((f: { fact_key: string; value_text?: string | null }) => f.fact_key === "routing.transport_mode")
      ?.value_text ?? null;

    const transportModeNormalized =
      typeof transportModeRaw === "string" ? transportModeRaw.trim().toUpperCase() : "";

    const hasResolvedTransportMode =
      transportModeNormalized === "AIR" ||
      transportModeNormalized === "MARITIME" ||
      transportModeNormalized === "ROUTE";

    // V4.2.1: Close orphan gaps not required for current request type
    const { data: allOpenGaps } = await serviceClient
      .from("quote_gaps")
      .select("id, gap_key")
      .eq("case_id", case_id)
      .eq("status", "open");

    if (allOpenGaps) {
      const mandatorySet = new Set(mandatoryFacts);
      // Also keep transport_mode gap if UNKNOWN AND no manual fact exists
      if (detectedType === "UNKNOWN" && !hasResolvedTransportMode) {
        mandatorySet.add("routing.transport_mode");
      }
      // Phase 15.6: ALWAYS protect policy gap keys from orphan closure
      // (2D/2E manage blocking vs non-blocking state)
      const policyKeysAll = new Set([
        "cargo.hs_code", "customs.regime_code",
        "cargo.freight_cost", "cargo.value",
        "pricing.pad_category", // Structural gap from run-pricing — must survive orphan cleanup
        EXPORT_SEA_FREIGHT_PARTNER_GAP_KEY,
        DECISIVE_ATTACHMENT_GAP_KEY, // P0-3: géré par son propre bloc, exclu de la fermeture orpheline
        // COMPOSITE-CARGO-GAP-AUTO-RESOLUTION-1 — gaps émis par
        // detectCargoConflictGuards. Ils doivent survivre à la fermeture orpheline
        // jusqu'à confirmation client/opérateur de l'ambiguïté composite.
        "cargo.pieces_count_conflict",
        "cargo.weight_total_confirmation",
        "cargo.value_conflict",
        "cargo.mixed_scope_confirmation",
      ]);
      for (const k of policyKeysAll) mandatorySet.add(k);
      for (const k of fclConstraintResult.protectedGapKeys) mandatorySet.add(k);
      // P1: Protect clarification gap from orphan closure when ambiguity is active
      if (isAmbiguousLclFcl) mandatorySet.add("routing.shipment_mode_clarification");

      const orphanGaps = allOpenGaps.filter(g => !mandatorySet.has(g.gap_key));

      for (const orphan of orphanGaps) {
        await serviceClient
          .from("quote_gaps")
          .update({ status: "resolved", resolved_at: new Date().toISOString() })
          .eq("id", orphan.id);

        // P1-CGR-SYNC: Cancel drafted client_gap_requests when gap resolved
        await serviceClient
          .from("client_gap_requests")
          .update({ status: "cancelled" })
          .eq("case_id", case_id)
          .eq("gap_key", orphan.gap_key)
          .eq("status", "drafted");

        await serviceClient.from("case_timeline_events").insert({
          case_id,
          event_type: "gap_resolved",
          event_data: { gap_key: orphan.gap_key, reason: `Not required for ${detectedType}` },
          actor_type: "system",
        });
      }

      if (orphanGaps.length > 0) {
        console.log(`[V4.2.1] Closed ${orphanGaps.length} orphan gaps: ${orphanGaps.map(g => g.gap_key).join(', ')}`);
      }
    }

    // A1: For UNKNOWN request type, add transport mode gap ONLY if no manual fact exists
    if (detectedType === "UNKNOWN") {
      const hasManualTransportMode = hasResolvedTransportMode;

      if (hasManualTransportMode) {
        // Resolve existing gap if operator already answered
        const { data: openModeGap } = await serviceClient
          .from("quote_gaps")
          .select("id")
          .eq("case_id", case_id)
          .eq("gap_key", "routing.transport_mode")
          .eq("status", "open")
          .maybeSingle();

        if (openModeGap) {
          await serviceClient.from("quote_gaps")
            .update({ status: "resolved", resolved_at: new Date().toISOString() })
            .eq("id", openModeGap.id);
          console.log("[A1] Closed routing.transport_mode gap: manual fact exists");
        }
      } else {
        // No fact → ensure gap exists
        const { data: existingModeGap } = await serviceClient
          .from("quote_gaps")
          .select("id")
          .eq("case_id", case_id)
          .eq("gap_key", "routing.transport_mode")
          .eq("status", "open")
          .maybeSingle();

        if (!existingModeGap) {
          const modeGapInfo = GAP_QUESTIONS["routing.transport_mode"];
          await serviceClient.from("quote_gaps").insert({
            case_id,
            gap_key: "routing.transport_mode",
            gap_category: "routing",
            question_fr: modeGapInfo.fr,
            question_en: modeGapInfo.en,
            priority: "critical",
            is_blocking: true,
          });
          gapsIdentified++;
        }
      }
    }

    // Phase 15.6 — Patch 2D: Create/upgrade blocking gaps for policy-required keys
    async function ensureBlockingGap156(gap_key: string, fr: string, en: string, category: string) {
      const { data: g } = await serviceClient
        .from("quote_gaps")
        .select("id, is_blocking")
        .eq("case_id", case_id)
        .eq("gap_key", gap_key)
        .eq("status", "open")
        .maybeSingle();

      if (!g?.id) {
        await serviceClient.from("quote_gaps").insert({
          case_id, gap_key, gap_category: category,
          question_fr: fr, question_en: en,
          priority: "high", is_blocking: true,
        });
        gapsIdentified++;
        await serviceClient.from("case_timeline_events").insert({
          case_id, event_type: "gap_identified",
          event_data: { gap_key, reason: "Phase 15.6 policy" },
          actor_type: "system",
        });
      } else if (g.is_blocking === false) {
        await serviceClient.from("quote_gaps")
          .update({ is_blocking: true, priority: "high" })
          .eq("id", g.id);
        await serviceClient.from("case_timeline_events").insert({
          case_id, event_type: "gap_identified",
          event_data: { gap_key, reason: "Phase 15.6 policy — upgraded to blocking" },
          actor_type: "system",
        });
      }
      // else: already open + blocking → no-op (idempotent)
    }

    // Phase 15.6 — Patch P0: Resolve stale policy gaps when condition is now satisfied
    async function resolveStalePolicyGap156(gap_key: string, reason: string) {
      const { data: g } = await serviceClient
        .from("quote_gaps")
        .select("id")
        .eq("case_id", case_id)
        .eq("gap_key", gap_key)
        .eq("status", "open")
        .maybeSingle();

      if (!g?.id) return;

      await serviceClient
        .from("quote_gaps")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("id", g.id);

      // P1-CGR-SYNC: Cancel drafted client_gap_requests when gap resolved
      await serviceClient
        .from("client_gap_requests")
        .update({ status: "cancelled" })
        .eq("case_id", case_id)
        .eq("gap_key", gap_key)
        .eq("status", "drafted");

      await serviceClient.from("case_timeline_events").insert({
        case_id,
        event_type: "gap_resolved",
        event_data: { gap_key, reason, phase: "15.6" },
        actor_type: "system",
      });
      console.log(`[Phase 15.6] Resolved stale gap ${gap_key}: ${reason}`);
    }

    if (scopeWantsDuties) {
      if (policyRequiredKeys.has("cargo.hs_code")) {
        await ensureBlockingGap156("cargo.hs_code",
          "DDP : Code HS 10 chiffres UEMOA requis pour chiffrer droits & taxes.",
          "DDP: 10-digit UEMOA HS code required to compute duties & taxes.",
          "cargo");
      } else if (hsHasValid10) {
        await resolveStalePolicyGap156("cargo.hs_code", "Phase 15.6 — HS valid 10-digit found");
      }

      if (policyRequiredKeys.has("customs.regime_code")) {
        await ensureBlockingGap156("customs.regime_code",
          "DDP : Un titre d'exonération est détecté — renseignez le régime douanier.",
          "DDP: Exemption title detected — please provide the customs regime.",
          "customs");
      } else if (hasExemptionTitle156 && hasRegimeCode156) {
        await resolveStalePolicyGap156("customs.regime_code", "Phase 15.6 — regime code provided");
      }

      if (policyRequiredKeys.has("cargo.freight_cost")) {
        await ensureBlockingGap156("cargo.freight_cost",
          "FOB/FCA/FAS/EXW (DDP) : le fret international réel est requis pour calculer la valeur CAF douanière.",
          "FOB/FCA/FAS/EXW (DDP): actual international freight amount is required to compute CAF customs value.",
          "cargo");
      } else if (isFobType156 && hasFreightCost156) {
        await resolveStalePolicyGap156("cargo.freight_cost", "Phase 15.6 — freight cost provided");
      }
      // Phase 16: cargo.freight_exchange_rate block removed

      if (policyRequiredKeys.has("cargo.value")) {
        await ensureBlockingGap156("cargo.value",
          "DDP : Quelle est la valeur marchandise (EXW/FOB) ? Indispensable pour le calcul des droits et taxes.",
          "DDP: What is the merchandise value (EXW/FOB)? Required for duties & taxes calculation.",
          "cargo");
      } else if (hasCargoValue156) {
        await resolveStalePolicyGap156("cargo.value", "Phase 15.6 — cargo value provided");
      }
    }

    // Phase 15.6 — Patch 2E: Downgrade policy gaps when scope is NOT DDP
    if (!scopeWantsDuties) {
      const policyDowngradeKeys = ["cargo.hs_code", "customs.regime_code", "cargo.freight_cost", "cargo.value"];
      for (const k of policyDowngradeKeys) {
        // Only downgrade if key is NOT in mandatoryFacts (guard against future mandatory additions)
        if (!mandatoryFacts.includes(k)) {
          const { data: pGap } = await serviceClient
            .from("quote_gaps")
            .select("id, is_blocking")
            .eq("case_id", case_id)
            .eq("gap_key", k)
            .eq("status", "open")
            .eq("is_blocking", true)
            .maybeSingle();

          if (pGap?.id) {
            await serviceClient.from("quote_gaps")
              .update({ is_blocking: false })
              .eq("id", pGap.id);
            console.log(`[Phase 15.6] Downgraded gap ${k} to non-blocking (scope non-DDP)`);
          }
        }
      }
    }

    for (const requiredKey of mandatoryFacts) {
      const hasFact = extractedKeys.includes(requiredKey) || existingDbKeys.includes(requiredKey);
      const hasAssumption = extractedFacts.find((f) => f.key === requiredKey && f.isAssumption);

      // Check if gap already exists
      const { data: existingGap } = await serviceClient
        .from("quote_gaps")
        .select("id, status")
        .eq("case_id", case_id)
        .eq("gap_key", requiredKey)
        .eq("status", "open")
        .maybeSingle();

      if (!hasFact || hasAssumption) {
        if (!existingGap) {
          const gapInfo = GAP_QUESTIONS[requiredKey] || {
            fr: `Information manquante: ${requiredKey}`,
            en: `Missing information: ${requiredKey}`,
            priority: "medium",
            category: requiredKey.split(".")[0],
          };

          // A1: Contextual blocking per request type
          let isBlocking: boolean;
          if (gapProfileType === "EXPORT_SENEGAL") {
            isBlocking = EXPORT_SENEGAL_BLOCKING_GAPS.has(requiredKey);
          } else if (detectedType === "SEA_FCL_IMPORT") {
            isBlocking = SEA_FCL_BLOCKING_GAPS.has(requiredKey);
          } else if (detectedType === "SEA_LCL_IMPORT") {
            isBlocking = SEA_LCL_BLOCKING_GAPS.has(requiredKey);
          } else if (detectedType === "AIR_IMPORT") {
            isBlocking = AIR_IMPORT_BLOCKING_GAPS.has(requiredKey);
          } else {
            isBlocking = gapInfo.priority === "critical" || gapInfo.priority === "high";
          }

          await serviceClient.from("quote_gaps").insert({
            case_id,
            gap_key: requiredKey,
            gap_category: gapInfo.category,
            question_fr: gapInfo.fr,
            question_en: gapInfo.en,
            priority: gapInfo.priority,
            is_blocking: isBlocking,
          });

          gapsIdentified++;

          await serviceClient.from("case_timeline_events").insert({
            case_id,
            event_type: "gap_identified",
            event_data: { gap_key: requiredKey, priority: gapInfo.priority },
            actor_type: "ai",
          });
        }
      } else if (hasFact && !hasAssumption && existingGap) {
        // Resolve gap
        const { data: factRecord } = await serviceClient
          .from("quote_facts")
          .select("id")
          .eq("case_id", case_id)
          .eq("fact_key", requiredKey)
          .eq("is_current", true)
          .single();

        await serviceClient
          .from("quote_gaps")
          .update({
            status: "resolved",
            resolved_by_fact_id: factRecord?.id,
            resolved_at: new Date().toISOString(),
          })
          .eq("id", existingGap.id);

        // P1-CGR-SYNC: Cancel drafted client_gap_requests when gap resolved
        await serviceClient
          .from("client_gap_requests")
          .update({ status: "cancelled" })
          .eq("case_id", case_id)
          .eq("gap_key", requiredKey)
          .eq("status", "drafted");

        await serviceClient.from("case_timeline_events").insert({
          case_id,
          event_type: "gap_resolved",
          event_data: { gap_key: requiredKey },
          related_gap_id: existingGap.id,
          actor_type: "ai",
        });
      }
    }

    // P1: Inject non-blocking clarification gap when LCL + explicit container signals are contradictory
    if (isAmbiguousLclFcl) {
      const clarificationGapKey = "routing.shipment_mode_clarification";
      const { data: existingClarGap } = await serviceClient
        .from("quote_gaps")
        .select("id")
        .eq("case_id", case_id)
        .eq("gap_key", clarificationGapKey)
        .eq("status", "open")
        .maybeSingle();

      if (!existingClarGap?.id) {
        await serviceClient.from("quote_gaps").insert({
          case_id,
          gap_key: clarificationGapKey,
          gap_category: "routing",
          question_fr: "Le dossier mentionne à la fois un mode LCL (groupage) et un conteneur complet (20ft/40ft). Pouvez-vous confirmer si l'expédition est en LCL (groupage) ou en FCL (conteneur complet) ?",
          question_en: "The request mentions both LCL (consolidation) and a full container (20ft/40ft). Can you confirm whether the shipment is LCL (consolidation) or FCL (full container)?",
          priority: "high",
          is_blocking: false,
        });
        gapsIdentified++;

        await serviceClient.from("case_timeline_events").insert({
          case_id,
          event_type: "gap_identified",
          event_data: {
            gap_key: clarificationGapKey,
            reason: "Contradictory LCL + explicit container signals detected",
            detected_type: detectedType,
          },
          actor_type: "system",
        });
        console.log(`[P1] Created non-blocking clarification gap: ${clarificationGapKey}`);
      }
    }

    // 10b. Final sync — close phantom gaps where a valid fact exists
    {
      const { data: openGapsForSync } = await serviceClient
        .from("quote_gaps")
        .select("id, gap_key, status")
        .eq("case_id", case_id)
        .eq("status", "open");

      const factsMapForSync = new Map(
        (existingDbFacts || []).map((f: any) => [f["fact_key"], f])
      );
      let gapsSyncResolved = 0;

      for (const gap of (openGapsForSync || [])) {
        const fact = factsMapForSync.get(gap["gap_key"]);
        if (!fact) continue;

        let isValid = false;
        const gapKey = String(gap["gap_key"]);
        // PAD-SCOPE-GAP: la présence du seul fait pricing.pad_category ne suffit
        // pas à lever ce gap — run-pricing exige AUSSI un tarif PAD officiel
        // strictement positif. La résolution est donc réservée au bloc
        // PAD-SCOPE-GAP ci-dessous, qui applique le garde complet.
        if (gapKey === PAD_SCOPE_GAP_KEY) continue;
        if (gapKey === "cargo.hs_code") {
          isValid = /^\d{10}$/.test(String(fact["value_text"] ?? "").trim());
        } else if (gapKey === "cargo.freight_cost") {
          isValid = fact["value_number"] != null && Number(fact["value_number"]) > 0;
        } else if (gapKey === "cargo.value") {
          isValid = fact["value_number"] != null && Number(fact["value_number"]) > 0;
        } else {
          isValid = (String(fact["value_text"] ?? "").trim().length > 0) || (fact["value_number"] != null);
        }

        if (isValid) {
          const { error: syncUpdateErr } = await serviceClient
            .from("quote_gaps")
            .update({ status: "resolved", resolved_at: new Date().toISOString() })
            .eq("id", gap["id"]);
          if (syncUpdateErr) {
            console.error(`[FinalSync] Failed to resolve gap ${gap["id"]}:`, syncUpdateErr.message);
            continue;
          }

          // P1-CGR-SYNC: Cancel drafted client_gap_requests when gap resolved
          await serviceClient
            .from("client_gap_requests")
            .update({ status: "cancelled" })
            .eq("case_id", case_id)
            .eq("gap_key", gapKey)
            .eq("status", "drafted");

          await serviceClient.from("case_timeline_events").insert({
            case_id,
            event_type: "gap_resolved",
            event_data: { gap_key: gapKey, reason: "final_sync", phase: "final" },
            related_gap_id: gap["id"],
            actor_type: "system",
          });
          gapsSyncResolved++;
        }
      }
      if (gapsSyncResolved > 0) {
        console.log(`[FinalSync] Resolved ${gapsSyncResolved} phantom gaps for case ${case_id}`);
      }
    }

    // P0: Create blocking gap for unresolved multi-lot BEFORE counter calculation
    if (multiQuoteResult?.detected === true && (multiQuoteResult?.stored ?? 0) === 0) {
      const multiLotGapKey = "request.multi_lot_unresolved";
      const { data: existingMlGap } = await serviceClient
        .from("quote_gaps")
        .select("id")
        .eq("case_id", case_id)
        .eq("gap_key", multiLotGapKey)
        .eq("status", "open")
        .maybeSingle();

      if (!existingMlGap?.id) {
        const { error: mlGapErr } = await serviceClient.from("quote_gaps").insert({
          case_id,
          gap_key: multiLotGapKey,
          gap_category: "request",
          question_fr: "Plusieurs lots ou modes de transport détectés dans la demande. La structure multi-ligne n'a pas pu être établie automatiquement. Veuillez clarifier les lots distincts.",
          question_en: "Multiple lots or transport modes detected in the request. The multi-line structure could not be established automatically. Please clarify the distinct lots.",
          priority: "critical",
          is_blocking: true,
        });
        if (mlGapErr) {
          console.error("[P0] Failed to insert multi-lot blocking gap:", mlGapErr.message);
        } else {
          gapsIdentified++;
          console.log("[P0] Created blocking gap: request.multi_lot_unresolved");
        }
      }
    }

    // P0-3: Create blocking gap if a decisive attachment stays unanalyzed/empty/errored
    // AFTER best-effort analyze + reload, BEFORE blockingGapsCount → bloque READY_TO_PRICE.
    {
      const problematicAtts = (reloadedAttachments || []).filter((a) =>
        isAttachmentAnalysisBlocking(a)
      );
      const problematicNames = problematicAtts
        .map((a) => a.filename)
        .filter((n): n is string => typeof n === "string" && n.length > 0);

      const { data: existingDocGap } = await serviceClient
        .from("quote_gaps")
        .select("id")
        .eq("case_id", case_id)
        .eq("gap_key", DECISIVE_ATTACHMENT_GAP_KEY)
        .eq("status", "open")
        .maybeSingle();

      const gapAction = decideDecisiveAttachmentGapAction(
        problematicNames.length,
        !!existingDocGap?.id
      );

      if (gapAction === "create") {
        {
          const sample = problematicNames.slice(0, 5);
          const more =
            problematicNames.length > sample.length
              ? ` (+${problematicNames.length - sample.length})`
              : "";
          const listed = sample.join(", ");
          const { error: docGapErr } = await serviceClient.from("quote_gaps").insert({
            case_id,
            gap_key: DECISIVE_ATTACHMENT_GAP_KEY,
            gap_category: "documentation",
            question_fr: `Pièce(s) jointe(s) probablement décisive(s) non analysée(s) ou illisible(s) : ${listed}${more}. Merci de réimporter ou fournir un format lisible avant tarification.`,
            question_en: `Likely decisive attachment(s) unanalyzed or unreadable: ${listed}${more}. Please re-import or provide a readable format before pricing.`,
            priority: "critical",
            is_blocking: true,
            status: "open",
          });
          if (docGapErr) {
            console.error("[P0-3] Failed to insert decisive-attachment blocking gap:", docGapErr.message);
          } else {
            gapsIdentified++;
            console.log(`[P0-3] Created blocking gap: ${DECISIVE_ATTACHMENT_GAP_KEY} (${problematicNames.length} file(s))`);
            await serviceClient.from("case_timeline_events").insert({
              case_id,
              event_type: "gap_identified",
              event_data: {
                gap_key: DECISIVE_ATTACHMENT_GAP_KEY,
                filenames: sample,
                reason: "decisive_attachment_unanalyzed",
              },
              actor_type: "system",
            });
          }
        }
      } else if (gapAction === "resolve" && existingDocGap?.id) {
        // Plus aucune PJ décisive problématique → résoudre le gap obsolète
        await serviceClient
          .from("quote_gaps")
          .update({ status: "resolved", resolved_at: new Date().toISOString() })
          .eq("id", existingDocGap.id);
        console.log(`[P0-3] Resolved stale gap: ${DECISIVE_ATTACHMENT_GAP_KEY}`);
        await serviceClient.from("case_timeline_events").insert({
          case_id,
          event_type: "gap_resolved",
          event_data: {
            gap_key: DECISIVE_ATTACHMENT_GAP_KEY,
            reason: "decisive_attachments_now_analyzed",
          },
          actor_type: "system",
        });
      }
    }

    // PAD-SCOPE-GAP: matérialise le blocage PAD_CATEGORY_REQUIRED de run-pricing.
    // Placé APRÈS le final sync (10b) — qui résoudrait le gap sur la seule présence
    // d'un fait pricing.pad_category, sans exiger le tarif officiel — et AVANT le
    // calcul de blockingGapsCount, donc avant toute décision READY_TO_PRICE.
    let padScopeGuardFailed = false;
    {
      const { data: padScopeFacts, error: padScopeFactsError } = await serviceClient
        .from("quote_facts")
        .select("fact_key, value_text, value_number, value_json")
        .eq("case_id", case_id)
        .eq("is_current", true)
        .in("fact_key", PAD_SCOPE_FACT_KEYS);

      if (padScopeFactsError) {
        // Fail-closed: sans lecture fiable des faits de scope, l'absence de blocage
        // PAD n'est pas démontrable → on ne laisse pas passer READY_TO_PRICE.
        padScopeGuardFailed = true;
        console.error(
          `[PAD-SCOPE-GAP] Failed to read scope facts for case ${case_id}: ${padScopeFactsError.message}`
        );
      } else {
        const padScopeState = resolvePadScopeGapState((padScopeFacts || []) as PadScopeFact[]);

        const { data: existingPadGap, error: existingPadGapError } = await serviceClient
          .from("quote_gaps")
          .select("id, is_blocking")
          .eq("case_id", case_id)
          .eq("gap_key", PAD_SCOPE_GAP_KEY)
          .eq("status", "open")
          .maybeSingle();

        if (existingPadGapError) {
          padScopeGuardFailed = true;
          console.error(
            `[PAD-SCOPE-GAP] Failed to read existing gap for case ${case_id}: ${existingPadGapError.message}`
          );
        } else if (padScopeState.blocker) {
          if (!existingPadGap?.id) {
            const { error: padGapInsertErr } = await serviceClient.from("quote_gaps").insert({
              case_id,
              gap_key: PAD_SCOPE_GAP_KEY,
              gap_category: "pricing",
              question_fr: PAD_SCOPE_GAP_QUESTION_FR,
              question_en: PAD_SCOPE_GAP_QUESTION_EN,
              // Même forme que le writer PAD-GAP-1 de run-pricing (gap_category
              // "pricing", bloquant, priorité "high" — défaut de quote_gaps).
              priority: "high",
              is_blocking: true,
              status: "open",
            });
            if (padGapInsertErr) {
              // Fail-closed: le gap n'existe pas → il ne comptera pas dans
              // blockingGapsCount, donc on bloque READY_TO_PRICE autrement.
              padScopeGuardFailed = true;
              console.error(
                `[PAD-SCOPE-GAP] Failed to insert blocking gap for case ${case_id}: ${padGapInsertErr.message}`
              );
            } else {
              gapsIdentified++;
              console.log(
                `[PAD-SCOPE-GAP] Created blocking gap ${PAD_SCOPE_GAP_KEY} (package=${padScopeState.servicePackage}, keys=${padScopeState.effectiveServiceKeys.join("|")})`
              );
              await serviceClient.from("case_timeline_events").insert({
                case_id,
                event_type: "gap_identified",
                event_data: {
                  gap_key: PAD_SCOPE_GAP_KEY,
                  reason: "PAD_CATEGORY_REQUIRED",
                  service_package: padScopeState.servicePackage,
                  incoterm: padScopeState.incoterm,
                  effective_service_keys: padScopeState.effectiveServiceKeys,
                },
                actor_type: "system",
              });
            }
          } else if (existingPadGap.is_blocking === false) {
            const { error: padGapUpgradeErr } = await serviceClient
              .from("quote_gaps")
              .update({ is_blocking: true, priority: "high" })
              .eq("id", existingPadGap.id);
            if (padGapUpgradeErr) {
              padScopeGuardFailed = true;
              console.error(
                `[PAD-SCOPE-GAP] Failed to upgrade gap to blocking for case ${case_id}: ${padGapUpgradeErr.message}`
              );
            } else {
              await serviceClient.from("case_timeline_events").insert({
                case_id,
                event_type: "gap_identified",
                event_data: {
                  gap_key: PAD_SCOPE_GAP_KEY,
                  reason: "PAD_CATEGORY_REQUIRED — upgraded to blocking",
                },
                actor_type: "system",
              });
            }
          }
          // else: déjà ouvert + bloquant → no-op (idempotent)
        } else if (existingPadGap?.id) {
          // Catégorie PAD + tarif officiel strictement positif présents, ou scope
          // hors PAD → le gap est obsolète, on le résout de façon idempotente.
          await serviceClient
            .from("quote_gaps")
            .update({ status: "resolved", resolved_at: new Date().toISOString() })
            .eq("id", existingPadGap.id);

          await serviceClient
            .from("client_gap_requests")
            .update({ status: "cancelled" })
            .eq("case_id", case_id)
            .eq("gap_key", PAD_SCOPE_GAP_KEY)
            .eq("status", "drafted");

          await serviceClient.from("case_timeline_events").insert({
            case_id,
            event_type: "gap_resolved",
            event_data: {
              gap_key: PAD_SCOPE_GAP_KEY,
              reason: "pad_scope_satisfied",
              service_package: padScopeState.servicePackage,
              effective_service_keys: padScopeState.effectiveServiceKeys,
            },
            actor_type: "system",
          });
          console.log(`[PAD-SCOPE-GAP] Resolved stale gap ${PAD_SCOPE_GAP_KEY}`);
        }
      }
    }

    // 11. Calculate completeness
    const { count: currentFactsCount } = await serviceClient
      .from("quote_facts")
      .select("*", { count: "exact", head: true })
      .eq("case_id", case_id)
      .eq("is_current", true);

    const { count: openGapsCount } = await serviceClient
      .from("quote_gaps")
      .select("*", { count: "exact", head: true })
      .eq("case_id", case_id)
      .eq("status", "open");

    const { count: blockingGapsCount } = await serviceClient
      .from("quote_gaps")
      .select("*", { count: "exact", head: true })
      .eq("case_id", case_id)
      .eq("status", "open")
      .eq("is_blocking", true);

    const completeness = mandatoryFacts.length > 0
      ? Math.round((Math.max(0, mandatoryFacts.length - (openGapsCount || 0)) / mandatoryFacts.length) * 100)
      : 0;

    // 12. Determine new status (only if not frozen - Phase C protection)
    let newStatus = caseData.status;
    
    if (!isFrozenCase) {
      // P0: Belt-and-suspenders guard for unresolved multi-lot
      const hasUnresolvedMultiLot = multiQuoteResult?.detected === true && (multiQuoteResult?.stored ?? 0) === 0;
      if (hasUnresolvedMultiLot) {
        newStatus = "NEED_INFO";
        console.log(`[P0] Multi-lot/multi-mode detected but 0 structured lines. Forcing NEED_INFO.`);
      } else if (blockingGapsCount === 0 && (currentFactsCount || 0) > 0) {
        // P4: Ambiguity detection — only route to DECISIONS_PENDING when genuinely ambiguous
        const ambiguitySignals: string[] = [];
        if (detectedType === "UNKNOWN") ambiguitySignals.push("UNKNOWN_FLOW_TYPE");
        if (isAmbiguousLclFcl) ambiguitySignals.push("AMBIGUOUS_LCL_FCL");
        // PAD-SCOPE-GAP fail-closed: garde PAD non concluante (lecture ou écriture
        // du gap en échec) → jamais READY_TO_PRICE.
        if (padScopeGuardFailed) ambiguitySignals.push("PAD_SCOPE_GUARD_ERROR");

        // Check critical fact exists in DB
        const { data: criticalFacts, error: criticalFactsError } = await serviceClient
          .from("quote_facts")
          .select("fact_key")
          .eq("case_id", case_id)
          .eq("is_current", true)
          .in("fact_key", ["service.package"]);

        if (criticalFactsError) {
          console.error(`[P4] Failed to read critical facts for case ${case_id}: ${criticalFactsError.message}`);
          ambiguitySignals.push("CRITICAL_FACT_READ_ERROR");
        }

        const criticalFactKeys = new Set((criticalFacts || []).map((f: any) => f.fact_key));
        if (!criticalFactKeys.has("service.package")) ambiguitySignals.push("NO_SERVICE_PACKAGE");

        if (ambiguitySignals.length > 0) {
          newStatus = "DECISIONS_PENDING";
          console.log(`[P4] Ambiguity detected: [${ambiguitySignals.join(", ")}] → DECISIONS_PENDING`);
        } else {
          newStatus = "READY_TO_PRICE";
          console.log("[P4] No ambiguity → READY_TO_PRICE");
        }
      } else if ((openGapsCount || 0) > 0) {
        newStatus = "NEED_INFO";
      } else {
        newStatus = "FACTS_PARTIAL";
      }
    } else {
      console.log(`[BuildPuzzle] Case ${case_id} is frozen (${caseData.status}), status unchanged despite new facts`);
    }

    // 13. Update case
    const { error: updateError } = await serviceClient
      .from("quote_cases")
      .update({
        status: newStatus,
        request_type: detectedType === "UNKNOWN" ? null : detectedType,
        facts_count: currentFactsCount || 0,
        gaps_count: openGapsCount || 0,
        puzzle_completeness: completeness,
        last_activity_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", case_id);

    if (updateError) {
      console.error(`[BuildPuzzle] Failed to update case ${case_id}: ${updateError.message}`);
    }

    if (newStatus !== caseData.status) {
      await serviceClient.from("case_timeline_events").insert({
        case_id,
        event_type: "status_changed",
        previous_value: caseData.status,
        new_value: newStatus,
        actor_type: "system",
      });
    }

    console.log(`Built puzzle for case ${case_id}: ${factsAdded} added (incl. attachment), ${factsUpdated} updated, ${factsSkipped} skipped, ${gapsIdentified} gaps`);

    // ── P1 Auto-EQ: Auto-create partner requests from blocking freight gaps ──
    // STRUCTURAL_PATCH_ALLOWED — see docs/MASTER_CONTEXT.md "Exception contrôlée — P1 Auto-EQ"
    // Non-blocking: errors logged, never fatal to build-case-puzzle
    try {
      const { data: freightGaps, error: freightGapsErr } = await serviceClient
        .from("quote_gaps")
        .select("id, gap_key")
        .eq("case_id", case_id)
        .eq("gap_key", "cargo.freight_cost")
        .eq("status", "open")
        .eq("is_blocking", true);

      if (freightGapsErr) {
        console.warn("[P1-AutoEQ] Failed to read freight gaps:", freightGapsErr.message);
      } else if (freightGaps && freightGaps.length > 0) {
        // Build targets: from quote_request_lines if available, else mono-lot fallback
        const { data: requestLines, error: requestLinesErr } = await serviceClient
          .from("quote_request_lines")
          .select("line_index, request_type_hint")
          .eq("case_id", case_id);

        if (requestLinesErr) {
          console.warn("[P1-AutoEQ] Failed to read request lines:", requestLinesErr.message);
          // abort P1 — do NOT fall through to mono-lot fallback
        } else {
          type AutoEqTarget = { lot_index: number | null; mode: string };
          let targets: AutoEqTarget[];

          if (requestLines && requestLines.length > 0) {
            targets = requestLines.map((l) => ({
              lot_index: l.line_index,
              mode: l.request_type_hint || detectedType || "UNKNOWN",
            }));
          } else {
            // Mono-lot fallback
            targets = [{ lot_index: null, mode: detectedType || "UNKNOWN" }];
          }

          // Gather facts for purpose_detail text
          const factKeys = [
            "routing.origin_country", "routing.destination_port", "routing.transport_mode",
            "routing.incoterm", "cargo.weight_kg", "cargo.volume_cbm",
          ];
          const { data: relevantFacts, error: relevantFactsErr } = await serviceClient
            .from("quote_facts")
            .select("fact_key, value_text, value_number")
            .eq("case_id", case_id)
            .eq("is_current", true)
            .in("fact_key", factKeys);

          if (relevantFactsErr) {
            console.warn("[P1-AutoEQ] Failed to read facts:", relevantFactsErr.message);
          }

          const factMap: Record<string, string> = {};
          for (const f of relevantFacts || []) {
            factMap[f.fact_key] = f.value_text || (f.value_number != null ? String(f.value_number) : "");
          }

          for (const target of targets) {
            const computedPurpose = target.mode.toUpperCase().includes("AIR") ? "air_tariff" : "freight_rate";

            // Idempotence guard (applicative — IS NOT DISTINCT FROM for null safety)
            let alreadyExists = false;
            if (target.lot_index === null) {
              const { data: existNull, error: existNullErr } = await serviceClient
                .from("external_quote_requests")
                .select("id")
                .eq("case_id", case_id)
                .eq("purpose", computedPurpose)
                .neq("status", "closed")
                .is("related_lot_index", null)
                .limit(1);
              if (existNullErr) {
                console.warn("[P1-AutoEQ] Existence check failed (null lot):", existNullErr.message);
                continue;
              }
              alreadyExists = !!(existNull && existNull.length > 0);
            } else {
              const { data: existLot, error: existLotErr } = await serviceClient
                .from("external_quote_requests")
                .select("id")
                .eq("case_id", case_id)
                .eq("purpose", computedPurpose)
                .neq("status", "closed")
                .eq("related_lot_index", target.lot_index)
                .limit(1);
              if (existLotErr) {
                console.warn("[P1-AutoEQ] Existence check failed (lot):", existLotErr.message);
                continue;
              }
              alreadyExists = !!(existLot && existLot.length > 0);
            }

            if (alreadyExists) {
              console.log(`[P1-AutoEQ] Request already exists for lot=${target.lot_index}, purpose=${computedPurpose} — skipped`);
              continue;
            }

            const lotLabel = target.lot_index != null ? String(target.lot_index) : "unique";
            const purposeDetail = [
              `Origine: ${factMap["routing.origin_country"] || "—"}`,
              `Destination: ${factMap["routing.destination_port"] || "—"}`,
              `Mode: ${factMap["routing.transport_mode"] || target.mode}`,
              `Incoterm: ${factMap["routing.incoterm"] || "—"}`,
              `Poids: ${factMap["cargo.weight_kg"] ? factMap["cargo.weight_kg"] + " kg" : "—"}`,
              `Volume: ${factMap["cargo.volume_cbm"] ? factMap["cargo.volume_cbm"] + " cbm" : "—"}`,
              `Lot: ${lotLabel}`,
            ].join("\n");

            const { data: inserted, error: insertErr } = await serviceClient
              .from("external_quote_requests")
              .insert({
                case_id,
                partner_name: "À définir",
                partner_email: null,
                purpose: computedPurpose,
                purpose_detail: purposeDetail,
                related_lot_index: target.lot_index,
                created_by: null,
                status: "draft",
              })
              .select("id")
              .single();

            if (insertErr) {
              console.warn(`[P1-AutoEQ] Insert failed for lot=${target.lot_index}:`, insertErr.message);
              continue;
            }

            // Timeline event
            const { error: timelineErr } = await serviceClient.from("case_timeline_events").insert({
              case_id,
              event_type: "external_request_created",
              actor_type: "system",
              new_value: `Demande partenaire auto: ${computedPurpose} (lot ${lotLabel})`,
              event_data: {
                auto: true,
                request_id: inserted?.id,
                purpose: computedPurpose,
                lot_index: target.lot_index,
              },
            });
            if (timelineErr) {
              console.warn("[P1-AutoEQ] Timeline insert failed:", timelineErr.message);
            }

            console.log(`[P1-AutoEQ] Created auto request ${inserted?.id} for lot=${lotLabel}, purpose=${computedPurpose}`);
          }
        }
      }
    } catch (autoEqError) {
      console.warn("[P1-AutoEQ] Non-fatal error:", String(autoEqError));
    }
    // ── End P1 Auto-EQ ──


    return new Response(
      JSON.stringify({
        case_id,
        new_status: newStatus,
        request_type: detectedType,
        facts_added: factsAdded,
        facts_updated: factsUpdated,
        attachment_facts: attachmentFactsResult,
        assumption_result: assumptionResult,
        gaps_identified: gapsIdentified,
        puzzle_completeness: completeness,
        ready_to_price: newStatus === "DECISIONS_PENDING" || newStatus === "READY_TO_PRICE" || newStatus === "ACK_READY_FOR_PRICING",
        quote_request_lines_detected: multiQuoteResult?.detected || false,
        quote_request_lines_stored: multiQuoteResult?.stored || 0,
        quote_request_lines_mode: multiQuoteResult?.mode || null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in build-case-puzzle:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
}

async function extractFactsWithAI(
  threadContext: string,
  attachmentContext: string,
  emails: any[],
  attachments: any[],
  apiKey?: string
): Promise<ExtractedFact[]> {
  if (!apiKey) {
    console.warn("No LOVABLE_API_KEY, using basic extraction");
    return extractFactsBasic(emails, attachments);
  }

  const systemPrompt = `You are an expert freight forwarding analyst. Extract structured facts from email threads about quotation requests.

Return a JSON array of facts with this structure:
{
  "facts": [
    {
      "key": "routing.origin_port", 
      "category": "routing",
      "value": "Shanghai",
      "valueType": "text",
      "confidence": 0.95,
      "sourceExcerpt": "...from Shanghai to Dakar...",
      "isAssumption": false
    }
  ]
}

Fact keys to extract:
- routing.origin_port, routing.destination_port, routing.destination_city, routing.incoterm
- routing.origin_country, routing.destination_country
- routing.origin_airport, routing.destination_airport
- cargo.description, cargo.containers (as JSON array [{type, quantity, coc_soc}])
- cargo.weight_kg, cargo.volume_cbm, cargo.value, cargo.value_currency, cargo.pieces_count
- cargo.hs_code (Harmonized System code, extract exact digits as stated e.g. 3002.12.00.10)
- timing.loading_date, timing.delivery_deadline
- carrier.name
- contacts.client_email, contacts.client_company
- cargo.freight_cost (montant du transport international principal uniquement - base freight. Ne PAS inclure THC, BAF, handling, documentation, surestaries ou frais locaux)
- cargo.freight_currency (devise du fret : XOF, EUR, USD)

CRITICAL RULES:
1. Set isAssumption=true and confidence=0.4 for assumed values (e.g., destination_port=Dakar if not explicit)
2. Only extract what is explicitly stated unless making a documented assumption
3. For containers, always try to extract as JSON array
4. Extract exact source excerpts for traceability
5. For routing.destination_city: extract the CITY name, not the full address.
   - If the address contains a Google Plus Code (e.g., "PGQH+J2 Dakar"), extract the city ("Dakar").
   - If the address says "Door delivery: [Company], [City] [PostCode], [Country]", extract the city.
   - Never use hotel names, beach resort names, or street addresses as destination_city.
   - destination_city must be a recognized city or commune name (e.g., "Dakar", "Kaolack", "Mbour").
6. TRANSPORT MODE DISAMBIGUATION (CRITICAL):
   - If the context mentions containers (20ft, 40ft, FCL, container), this is MARITIME transport.
     Do NOT extract routing.origin_airport. Extract routing.origin_port instead.
   - routing.origin_airport must ONLY be extracted if the context explicitly mentions air transport
     (keywords: "air", "AWB", "airfreight", "by air", "air cargo").
   - Port cities (e.g., Jeddah, Shanghai, Mumbai) are NOT airports unless "airport" is explicitly stated.
    - 3-letter codes in signatures, reference numbers, or country names are NOT airport codes.
7. INCOTERM LOCATION SEMANTICS (CRITICAL):
   - EXW, FCA, FAS: the location next to the incoterm is the PICKUP / ORIGIN, NOT the destination.
     - If clearly a port → routing.origin_port
     - If clearly an airport → routing.origin_airport
     - If neither (city, warehouse, industrial zone) → do NOT force it into origin_port or origin_airport.
       Simply do not extract a destination from this location.
   - DAP, DDP, CIF, CFR, CPT: the location next to the incoterm is the DESTINATION.
    - Never map an EXW/FCA/FAS location to routing.destination_city or routing.destination_port.
8. COUNTRY EXTRACTION: If the email mentions a country name explicitly (e.g., "to India", "from Senegal", "destination: Nhava Sheva, India"), extract routing.origin_country and/or routing.destination_country as separate facts. Do not conflate country with city.
9. SOURCE PROVENANCE (CRITICAL):
   - cargo.freight_cost and cargo.freight_currency must ONLY be extracted from:
     a) Client request emails (inbound from the requesting party)
     b) Supplier/carrier quotes addressed TO the freight forwarder
   - NEVER extract these from outbound quotation emails sent BY the freight forwarder (SODATRA, @sodatra.sn, @sodatra.com)
   - If a monetary amount appears in an email FROM the freight forwarder, it is a PROPOSED PRICE, not a cargo fact
   - This rule applies to all monetary facts in the cargo.* namespace (cargo.value, cargo.freight_cost, etc.)
    - When in doubt about a price source, do NOT extract it as a cargo fact
10. OPERATOR IDENTITY (CRITICAL):
   - SODATRA, SODATRA Transit, SODATRA Shipping & Logistics and variants are the operator/freight forwarder, not the client.
   - Never extract them as contacts.client_company.
   - If SODATRA appears in the subject, recipient, signature, or body, treat it as operator/recipient context.
   - The external sender company is usually the client only if identifiable from signature, email domain, or explicit company name.
   - If the true client company is not explicit, leave contacts.client_company empty rather than guessing.`;

  const userPrompt = `Extract facts from this email thread:

${threadContext}

${attachmentContext ? `\n\nAttachment content:\n${attachmentContext}` : ""}`;

  try {
    const response = await fetch(LOVABLE_AI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      console.error("AI extraction failed:", await response.text());
      return extractFactsBasic(emails, attachments);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Parse JSON from response
    try {
      const parsed = extractAndParseJSON<any>(content, {
        label: "build-case-puzzle:facts",
        expectRoot: "object",
        maxLogChars: 500,
      });
      const facts = Array.isArray(parsed?.facts) ? parsed.facts : [];

      // THREAD-TEMPORAL-PROVENANCE-1: attribute AI facts to the latest relevant
      // inbound client email (not emails[0], the oldest), so later emails that
      // amend the request are credited correctly and SOURCE-GUARD-2 client
      // checks stay valid. null when no inbound email exists (prudent).
      const provenanceEmailId = pickInboundProvenanceEmailId(emails);

      // Enrich with source email IDs + V4.1.5: ensure JSON values are objects not strings
      return facts.map((f: any) => {
        let value = f.value;
        // V4.1.5: If valueType is 'json' but value is a string, parse it
        if (f.valueType === 'json' && typeof value === 'string') {
          try { value = JSON.parse(value); } catch { /* keep as-is */ }
        }
        return {
          ...f,
          value,
          sourceType: f.isAssumption ? "ai_assumption" : "ai_extraction",
          sourceEmailId: provenanceEmailId,
        };
      });
    } catch {
      return extractFactsBasic(emails, attachments);
    }
  } catch (error) {
    console.error("AI extraction error:", error);
    return extractFactsBasic(emails, attachments);
  }
}

function extractFactsBasic(emails: any[], attachments: any[]): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const firstEmail = emails[0];

  if (firstEmail) {
    // Always extract client email
    facts.push({
      key: "contacts.client_email",
      category: "contacts",
      value: firstEmail.from_address,
      valueType: "text",
      sourceType: "email_body",
      sourceEmailId: firstEmail.id,
      confidence: 1.0,
    });

    const body = extractPlainTextFromMime(firstEmail.body_text || "");
    const bodyLower = body.toLowerCase();
    
    // A1: Incoterm detection - priority TERM:/Incoterm: then last free match
    const incoterms = ["EXW", "FOB", "CFR", "CIF", "DAP", "DDP", "FCA", "CPT", "CIP", "DAT", "DPU"];
    
    // Priority 1: Structured patterns (TERM: DAP, Incoterm: DAP)
    const structuredIncotermMatch = body.match(/(?:TERM|Incoterm)\s*[:=]\s*(EXW|FOB|CFR|CIF|DAP|DDP|FCA|CPT|CIP|DAT|DPU)/i);
    if (structuredIncotermMatch) {
      facts.push({
        key: "routing.incoterm",
        category: "routing",
        value: structuredIncotermMatch[1].toUpperCase(),
        valueType: "text",
        sourceType: "email_body",
        sourceEmailId: firstEmail.id,
        sourceExcerpt: structuredIncotermMatch[0],
        confidence: 0.9,
      });
    } else {
      // Priority 2: Last free match in body (not first!)
      let lastMatch: string | null = null;
      for (const term of incoterms) {
        // Use word boundary to avoid false matches
        const regex = new RegExp(`\\b${term}\\b`, 'gi');
        let m;
        while ((m = regex.exec(body)) !== null) {
          lastMatch = term;
        }
      }
      if (lastMatch) {
        facts.push({
          key: "routing.incoterm",
          category: "routing",
          value: lastMatch.toUpperCase(),
          valueType: "text",
          sourceType: "email_body",
          sourceEmailId: firstEmail.id,
          confidence: 0.6,
        });
      }
    }

    // Container detection
    const containerMatch = body.match(/(\d+)\s*x?\s*(20|40)\s*'?\s*(hc|dv|rf|gp|ot|fr)?/gi);
    if (containerMatch) {
      const containers = containerMatch.map((m: string) => {
        const parts = m.match(/(\d+)\s*x?\s*(20|40)\s*'?\s*(hc|dv|rf|gp|ot|fr)?/i);
        return {
          quantity: parseInt(parts?.[1] || "1"),
          type: `${parts?.[2]}${(parts?.[3] || "GP").toUpperCase()}`.replace("DV", "GP"),
        };
      });
      facts.push({
        key: "cargo.containers",
        category: "cargo",
        value: containers,
        valueType: "json",
        sourceType: "email_body",
        sourceEmailId: firstEmail.id,
        confidence: 0.8,
      });
    }

    // A1: Extract cargo.weight_kg
    const weightMatch = body.match(/(\d[\d\s,.']*)\s*kg\b/i);
    if (weightMatch) {
      const weight = parseRobustNumber(weightMatch[1]);
      if (weight && weight > 0) {
        facts.push({
          key: "cargo.weight_kg",
          category: "cargo",
          value: weight,
          valueType: "number",
          sourceType: "email_body",
          sourceEmailId: firstEmail.id,
          sourceExcerpt: weightMatch[0],
          confidence: 0.85,
        });
      }
    }

    // A1: Extract cargo.volume_cbm
    const volumeMatch = body.match(/(\d[\d,.]*)\s*cbm\b/i);
    if (volumeMatch) {
      const volume = parseRobustNumber(volumeMatch[1]);
      if (volume && volume > 0) {
        facts.push({
          key: "cargo.volume_cbm",
          category: "cargo",
          value: volume,
          valueType: "number",
          sourceType: "email_body",
          sourceEmailId: firstEmail.id,
          sourceExcerpt: volumeMatch[0],
          confidence: 0.85,
        });
      }
    }

    // A1: Extract cargo.pieces_count
    const piecesMatch = body.match(/(\d+)\s*(?:crates?|pieces?|pcs|colis|cartons?|pkgs?|packages?)\b/i);
    if (piecesMatch) {
      const pieces = parseInt(piecesMatch[1], 10);
      if (pieces > 0) {
        facts.push({
          key: "cargo.pieces_count",
          category: "cargo",
          value: pieces,
          valueType: "number",
          sourceType: "email_body",
          sourceEmailId: firstEmail.id,
          sourceExcerpt: piecesMatch[0],
          confidence: 0.85,
        });
      }
    }

    // A1: Extract cargo.dimensions (value_text)
    const dimMatch = body.match(/(\d+(?:[.,]\d+)?)\s*[*x×]\s*(\d+(?:[.,]\d+)?)\s*[*x×]\s*(\d+(?:[.,]\d+)?)(?:\s*(mm|cm|m)\b)?/i);
    if (dimMatch) {
      facts.push({
        key: "cargo.dimensions",
        category: "cargo",
        value: dimMatch[0],
        valueType: "text",
        sourceType: "email_body",
        sourceEmailId: firstEmail.id,
        sourceExcerpt: dimMatch[0],
        confidence: 0.8,
      });

      // P0: Auto-calc cargo.volume_cbm from cargo.dimensions if unit is explicit
      if (!facts.some(f => f.key === "cargo.volume_cbm")) {
        const dL = parseFloat(dimMatch[1].replace(",", "."));
        const dW = parseFloat(dimMatch[2].replace(",", "."));
        const dH = parseFloat(dimMatch[3].replace(",", "."));
        const unitStr = dimMatch[4]?.toLowerCase();

        let divisor: number | null = null;
        if (unitStr === "mm") divisor = 1000;
        else if (unitStr === "cm") divisor = 100;
        else if (unitStr === "m") divisor = 1;

        if (divisor !== null) {
          const volM3 = Math.round((dL / divisor) * (dW / divisor) * (dH / divisor) * 100) / 100;

          if (volM3 > 0 && volM3 < 10000) {
            facts.push({
              key: "cargo.volume_cbm",
              category: "cargo",
              value: volM3,
              valueType: "number",
              sourceType: "deterministic_calc",
              sourceEmailId: firstEmail.id,
              sourceExcerpt: `${dimMatch[0]} → ${dL}/${divisor} × ${dW}/${divisor} × ${dH}/${divisor} = ${volM3} m³`,
              confidence: 0.90,
            });
            console.log(`[P0] Auto-calc volume from dimensions: ${volM3} m³`);
          }
        }
      }
    }

    // A1: Extract cargo.description
    const descMatch = body.match(/(?:commodity|nature|goods|marchandise)\s*[:=]\s*(.+)/i);
    if (descMatch) {
      const desc = descMatch[1].trim().substring(0, 200);
      if (desc.length > 2) {
        facts.push({
          key: "cargo.description",
          category: "cargo",
          value: desc,
          valueType: "text",
          sourceType: "email_body",
          sourceEmailId: firstEmail.id,
          sourceExcerpt: descMatch[0].substring(0, 200),
          confidence: 0.75,
        });
      }
    }

    // A1: Calculate cargo.chargeable_weight_kg deterministically
    const weightFact = facts.find(f => f.key === "cargo.weight_kg");
    const volumeFact = facts.find(f => f.key === "cargo.volume_cbm");
    if (weightFact || volumeFact) {
      const grossKg = typeof weightFact?.value === 'number' ? weightFact.value : 0;
      const volCbm = typeof volumeFact?.value === 'number' ? volumeFact.value : 0;
      const volWeight = Math.round(volCbm * 167);
      const chargeableKg = Math.max(grossKg, volWeight);
      
      if (chargeableKg > 0) {
        facts.push({
          key: "cargo.chargeable_weight_kg",
          category: "cargo",
          value: chargeableKg,
          valueType: "number",
          sourceType: "deterministic_calc",
          sourceEmailId: firstEmail.id,
          sourceExcerpt: `gross=${grossKg}; vol=${volCbm}; volWeight=${volWeight}; rule=IATA_167; chargeable=${chargeableKg}`,
          confidence: 0.95,
        });

        // A1: Audit fact for chargeable weight rule
        facts.push({
          key: "cargo.chargeable_weight_rule",
          category: "cargo",
          value: "IATA_167",
          valueType: "text",
          sourceType: "deterministic_calc",
          sourceEmailId: firstEmail.id,
          sourceExcerpt: `Chargeable weight = max(gross_kg, cbm*167) = max(${grossKg}, ${volWeight}) = ${chargeableKg}`,
          confidence: 0.95,
        });
      }
    }
  }

  return facts;
}

// Sprint "Stabiliser la Comprehension": Refactored detectRequestType
// Action 1: Maritime explicit > Air implicit hierarchy
// Action 2: IATA whitelist + incoterm exclusion
// Action 3: Breakbulk patterns expanded
// Action 4: Post-detection coherence guard
// P1: Returns { type, ambiguous_lcl_fcl } to flag contradictory LCL+container signals
function detectRequestType(context: string, facts: ExtractedFact[]): { type: string; ambiguous_lcl_fcl: boolean } {
  const lowerContext = context.toLowerCase();

  // === PRE-SCAN: Strong maritime indicators (Action 1) ===
  const strongMaritimePatterns = [
    "container", "fcl",
    "40ft", "20ft", "40'", "20'", "40 ft", "20 ft",
    "40hc", "40dv", "20dv", "40fr", "40ot", "40rf", "20rf",
    "vessel", "sea freight", "seafreight",
    "bill of lading", "b/l",
  ];
  const strongMaritimeRegex = [/\bpol\b/, /\bpod\b/, /\bbl\b/];
  const hasStrongMaritime = strongMaritimePatterns.some(p => lowerContext.includes(p))
    || strongMaritimeRegex.some(r => r.test(lowerContext));

  // Also check container facts
  const containerFact = facts.find(f => f.key === "cargo.containers");
  const hasValidContainerFact = containerFact && Array.isArray(containerFact.value)
    && (containerFact.value as any[]).some((c: any) => c && (c.quantity || 0) > 0);

  const maritimeSignal = hasStrongMaritime || hasValidContainerFact;

  // Step 1: Explicit AIR mode (absolute priority — "by air", "awb" etc.)
  const airPatterns = [
    "by air", "via air", "par avion", "air cargo", "air shipment",
    "awb", "air waybill", "airfreight", "air freight",
  ];
  if (airPatterns.some(p => lowerContext.includes(p))) {
    // Action 4: Even with explicit air, if containers present, flag but still allow AIR
    // (rare case: ULD air containers — respect explicit air keyword)
    if (maritimeSignal) {
      console.log(`[Detection] WARNING: Explicit AIR pattern found WITH maritime signals. Respecting explicit AIR.`);
    }
    console.log(`[Detection] AIR_IMPORT (explicit air pattern)`);
    return { type: "AIR_IMPORT", ambiguous_lcl_fcl: false };
  }

  // Step 1b: Airport fact — ONLY if no strong maritime signal (Action 1)
  if (facts.some(f => f.key === "routing.origin_airport") && !maritimeSignal) {
    console.log(`[Detection] AIR_IMPORT (airport fact, no maritime conflict)`);
    return { type: "AIR_IMPORT", ambiguous_lcl_fcl: false };
  }
  if (facts.some(f => f.key === "routing.origin_airport") && maritimeSignal) {
    console.log(`[Detection] Airport fact IGNORED — strong maritime signals present`);
  }

  // Step 2: Maritime on strong indicators
  if (hasStrongMaritime) {
    // Step 2a: Separate LCL and explicit container signals
    const lclPatterns = ["lcl", "less than container", "groupage", "consolidation"];
    const isLclByPartOf = lowerContext.includes("part of") &&
      (lowerContext.includes("container") || /\btc\b/.test(lowerContext));
    const hasLclSignal = lclPatterns.some(p => lowerContext.includes(p)) || isLclByPartOf;

    // P1: Explicit container patterns (20ft, 40HC, etc.)
    const explicitContainerPatterns = [
      /\b(?:\d+\s*x?\s*)?(?:20|40|45)\s*(?:ft|'|hc|dv|gp|rf|ot|fr)\b/i,
      /\b(?:20|40|45)\s*(?:ft|')\s*container/i,
      /\bcontainer\s+(?:20|40|45)/i,
      /\b(?:20gp|40gp|20dv|40dv|40hc|40hq|20rf|40rf|40ot|40fr)\b/i,
    ];
    const hasExplicitContainer = explicitContainerPatterns.some(r => r.test(lowerContext))
      || hasValidContainerFact;

    // P1: Ambiguity detection
    if (hasLclSignal && hasExplicitContainer) {
      console.log(`[Detection] SEA_LCL_IMPORT (ambiguous: both LCL signal and explicit container — pending client clarification)`);
      return { type: "SEA_LCL_IMPORT", ambiguous_lcl_fcl: true };
    }

    // Step 2b: LCL detection (no container contradiction)
    if (hasLclSignal) {
      console.log(`[Detection] SEA_LCL_IMPORT (LCL pattern within maritime context)`);
      return { type: "SEA_LCL_IMPORT", ambiguous_lcl_fcl: false };
    }

    console.log(`[Detection] SEA_FCL_IMPORT (strong maritime pattern)`);
    return { type: "SEA_FCL_IMPORT", ambiguous_lcl_fcl: false };
  }

  // Step 2c: LCL without strong maritime (standalone LCL mention)
  const lclStandalonePatterns = ["lcl", "less than container", "groupage", "consolidation"];
  const isStandaloneLclByPartOf = lowerContext.includes("part of") &&
    (lowerContext.includes("container") || /\btc\b/.test(lowerContext));
  if (lclStandalonePatterns.some(p => lowerContext.includes(p)) || isStandaloneLclByPartOf) {
    console.log(`[Detection] SEA_LCL_IMPORT (standalone LCL pattern)`);
    return { type: "SEA_LCL_IMPORT", ambiguous_lcl_fcl: false };
  }

  // Step 3: Breakbulk patterns (Action 3: expanded with crane, lifting, rigging)
  const breakbulkPatterns = [
    "breakbulk", "break bulk", "project cargo", "heavy lift",
    "crane", "lifting", "rigging", "heavy equipment",
  ];
  if (breakbulkPatterns.some(p => lowerContext.includes(p))) {
    console.log(`[Detection] SEA_BREAKBULK_IMPORT (breakbulk pattern)`);
    return { type: "SEA_BREAKBULK_IMPORT", ambiguous_lcl_fcl: false };
  }

  // Step 4: Container fact (already checked in pre-scan, but handle edge cases)
  if (hasValidContainerFact) {
    console.log(`[Detection] SEA_FCL_IMPORT (container fact with valid items)`);
    return { type: "SEA_FCL_IMPORT", ambiguous_lcl_fcl: false };
  }

  // Step 5: IATA codes — ONLY if no maritime signal (Action 1 + Action 2)
  if (!maritimeSignal) {
    // Action 2: Whitelist of known airports for SODATRA routes
    const KNOWN_AIRPORTS = new Set([
      "PVG", "CDG", "IST", "DXB", "JFK", "BOM", "NBO", "DSS", "DKR",
      "ADD", "NKC", "ABJ", "ACC", "LOS", "CMN", "ORY", "LHR", "FRA",
      "AMS", "BRU", "MXP", "JNB", "DOH", "SIN", "HKG", "ICN", "NRT",
      "PEK", "CAN", "SZX", "BKK", "KUL", "DEL", "BLR", "MAA", "CGK",
    ]);
    // Incoterms to exclude from IATA matching
    const INCOTERM_CODES = new Set([
      "FOB", "CIF", "CFR", "DAP", "DDP", "EXW", "FCA", "CPT", "CIP", "DAT", "DPU",
    ]);

    const iataContextRegex = /\b([A-Z]{3})\s*(?:TO|-|>)\s*([A-Z]{3})\b/g;
    let iataMatch;
    while ((iataMatch = iataContextRegex.exec(context)) !== null) {
      const code1 = iataMatch[1];
      const code2 = iataMatch[2];
      // Skip if either code is an incoterm
      if (INCOTERM_CODES.has(code1) || INCOTERM_CODES.has(code2)) continue;
      // At least one must be a known airport
      if (KNOWN_AIRPORTS.has(code1) || KNOWN_AIRPORTS.has(code2)) {
        console.log(`[Detection] AIR_IMPORT (IATA codes: ${code1}-${code2})`);
        return { type: "AIR_IMPORT", ambiguous_lcl_fcl: false };
      }
    }

    // Also check "from XXX to YYY" pattern
    const iataFromToRegex = /from\s+([A-Z]{3})\s+to\s+([A-Z]{3})/gi;
    while ((iataMatch = iataFromToRegex.exec(context)) !== null) {
      const code1 = iataMatch[1].toUpperCase();
      const code2 = iataMatch[2].toUpperCase();
      if (INCOTERM_CODES.has(code1) || INCOTERM_CODES.has(code2)) continue;
      if (KNOWN_AIRPORTS.has(code1) || KNOWN_AIRPORTS.has(code2)) {
        console.log(`[Detection] AIR_IMPORT (IATA from-to: ${code1}-${code2})`);
        return { type: "AIR_IMPORT", ambiguous_lcl_fcl: false };
      }
    }
  } else {
    console.log(`[Detection] IATA check SKIPPED — maritime signals present`);
  }

  // Step 6: Default = UNKNOWN
  console.log(`[Detection] UNKNOWN (no explicit mode detected)`);
  return { type: "UNKNOWN", ambiguous_lcl_fcl: false };
}

function getFactValue(fact: ExtractedFact): string | number | object {
  return fact.value;
}

// P1 Helper: normalize a multi-HS CSV value for idempotent comparison
function normalizeHsCsv(value: string | null | undefined): string {
  return (value || "")
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter((s) => /^\d{10}$/.test(s))
    .sort()
    .join(",");
}

// Helper: check if a 10-digit code exists exactly in hs_codes
async function isExactHsMatch(serviceClient: any, code10: string): Promise<boolean> {
  const { data } = await serviceClient
    .from("hs_codes")
    .select("code_normalized")
    .eq("code_normalized", code10)
    .limit(1)
    .maybeSingle();
  return !!data;
}
