/**
 * Phase A1: build-case-puzzle
 * Analyzes thread emails/attachments and populates facts/gaps
 * CTO Fix: Uses atomic supersede_fact RPC for fact updates
 * A1: AIR detection priority, cargo extraction, chargeable weight, incoterm fix
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { extractAndParseJSON } from "../_shared/json-parser.ts";

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

// Internal document types that should not be scanned for cargo facts
const INTERNAL_DOC_TYPES = new Set([
  'quotation_draft', 'quotation_sent', 'internal_note',
  'devis', 'proforma_sent',
]);

// --- MIME Pre-Processing: strip base64/image noise before AI extraction ---
function extractPlainTextFromMime(rawBody: string): string {
  if (!rawBody) return "";

  // 1. No MIME boundary → return truncated raw
  const boundaryMatch = rawBody.match(/boundary="?([^"\s;]+)"?/i);
  if (!boundaryMatch) {
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
function extractHsCodesFromText(text: string): string[] {
  const patterns = [
    /Code\s*SH\s*:?\s*(\d{4}[\.\s]?\d{2}[\.\s]?\d{2}[\.\s]?\d{2})/gi,
    /HS\s*(?:Code)?\s*:?\s*(\d{4}[\.\s]?\d{2}[\.\s]?\d{2}[\.\s]?\d{2})/gi,
    /(\d{4}\.\d{2}\.\d{2}\.\d{2})/g,
    // "Code Douanier" – standard French invoices/proformas
    /Code\s*Douanier\s*:?\s*(\d{6,10})/gi,
    // Standalone 10-digit HS codes (isolated block of exactly 10 digits)
    /(?<!\d)(\d{10})(?!\d)/g,
  ];

  const seen = new Set<string>();
  for (const regex of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const normalized = match[1].replace(/\D/g, "").substring(0, 10);
      if (normalized.length >= 6) {
        seen.add(normalized);
      }
    }
  }
  return [...seen];
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
    // Currency detection BEFORE numeric check (so lines like "Total TTC Hors Options EUR" are captured)
    if (!result.currency) {
      if (/\bEUR\b/i.test(line)) result.currency = 'EUR';
      else if (/\bUSD\b/i.test(line)) result.currency = 'USD';
      else if (/\bXOF\b|\bFCFA\b/i.test(line)) result.currency = 'XOF';
    }

    // Take the LAST numeric amount on the line to avoid quantities/references
    const matches = [...line.matchAll(/([0-9][0-9\s',.]*[0-9])/g)];
    if (matches.length === 0) continue;
    const lastMatch = matches[matches.length - 1][1];

    if (/Sous[- ]?total\s+HT/i.test(line)) {
      const v = parseAmount(lastMatch);
      if (v) { result.goodsValue = v; result.goodsSource = 'goods_from_sous_total'; }
    } else if (/Transport\s+(?:Export|International)/i.test(line)) {
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

function pickSourceEmailId(emails: any[]): string | null {
  if (!Array.isArray(emails) || emails.length === 0) return null;
  for (let i = emails.length - 1; i >= 0; i--) {
    if (emails[i]?.is_quotation_request) return emails[i].id;
  }
  return emails[emails.length - 1]?.id || null;
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

  const systemPrompt = `You are a freight quotation analyst. The email thread contains MULTIPLE distinct quotation requests (e.g., "Quote 1", "Option A", "Alternative 1").
Extract each distinct quotation request as a separate line.

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
      .filter(Boolean);

    return validLines.length > 0 ? validLines : null;
  } catch (err) {
    console.warn("[M3.5 multi-quote] extractQuoteLinesWithAI error:", err);
    return null;
  }
}

// --- P0 Fix: Parse container text into structured JSON ---
function parseContainersFromText(raw: string): Array<{ type: string; quantity: number }> {
  const s = (raw || "").toUpperCase();
  const cleaned = s
    .replace(/\s+/g, " ")
    .replace(/'/g, "'")
    .replace(/CONT(?:A)?INER(S)?/g, "")
    .replace(/CNTR(S)?/g, "")
    .trim();

  const re = /(\d+)\s*(?:X|\*|PCS|PC)?\s*(20|40|45)\s*(?:'|\s)?\s*(HC|HQ|DV|GP|STD)?/g;
  const out: Array<{ type: string; quantity: number }> = [];
  let m: RegExpExecArray | null;

  while ((m = re.exec(cleaned)) !== null) {
    const qty = Number(m[1]);
    const size = m[2];
    const suffix = (m[3] || "").trim();
    if (!Number.isFinite(qty) || qty <= 0) continue;
    let type = `${size}${suffix || "GP"}`;
    type = type.replace("DV", "GP").replace("STD", "GP");
    out.push({ type, quantity: qty });
  }

  // Fallback: if we see "40HC" or "20" without qty, assume 1
  if (out.length === 0) {
    const has40 = cleaned.includes("40");
    const has20 = cleaned.includes("20");
    const hasHC = cleaned.includes("HC") || cleaned.includes("HQ");
    if (has40) out.push({ type: hasHC ? "40HC" : "40GP", quantity: 1 });
    else if (has20) out.push({ type: "20GP", quantity: 1 });
  }

  // Merge same types
  const merged = new Map<string, number>();
  for (const c of out) merged.set(c.type, (merged.get(c.type) || 0) + c.quantity);
  return Array.from(merged.entries()).map(([type, quantity]) => ({ type, quantity }));
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
    const extractedFacts = await extractFactsWithAI(
      inboundThreadContext,
      fullAttachmentContext,
      emails,
      reloadedAttachments || [],
      lovableApiKey
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

    for (const fact of guardedFacts) {
      try {
        // --- HS Code guard: validate against hs_codes table before injection ---
        if (fact.key === "cargo.hs_code") {
          const rawHs = String(fact.value);
          const hsResult = await resolveSenegalHsCode(serviceClient, rawHs);
          if (hsResult.status === "unique") {
            // Replace with validated 10-digit code
            fact.value = hsResult.code10;
            fact.confidence = rawHs.replace(/\D/g, "").length >= 10 ? 1.0 : 0.98;
            console.log(`[HS Guard] Resolved ${rawHs} → ${hsResult.code10}`);
          } else {
            // ambiguous or not_found → skip injection, will be handled post-attachment
            console.warn(`[HS Guard] Skipping cargo.hs_code injection: ${hsResult.status} for raw=${rawHs}`);
            factsSkipped++;
            continue;
          }
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
      const docTokens = hsRawDocValue.split(/[;,]/).map((c) => c.trim()).filter(Boolean);
      const existingDocIsMultiCsv = docTokens.length > 1 && docTokens.every((c) => /^\d{10}$/.test(c));
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
        // 2. Extract HS candidates from all case_documents
        const resolvedCandidates: Array<{ code10: string; file: string; raw: string }> = [];

        for (const doc of caseDocuments) {
          if (!doc.extracted_text) continue;
          const rawCandidates = extractHsCodesFromText(doc.extracted_text);
          for (const raw of rawCandidates) {
            const hsResult = await resolveSenegalHsCode(serviceClient, raw);
            if (hsResult.status === "unique") {
              resolvedCandidates.push({ code10: hsResult.code10, file: doc.file_name, raw });
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
            }
          }
        } else if (uniqueCodes.length === 0) {
          console.log("[HS doc-regex] No HS found/resolved from case_documents");
        } else {
          // P1: Multi-HS — inject as sorted CSV (quotation-engine already supports comma-separated HS)
          const sortedCodes = [...uniqueCodes].sort();
          const csvValue = sortedCodes.join(",");
          const hsRawDoc = (hsFactDoc?.value_text || "").trim();
          const existingNormalized = normalizeHsCsv(hsRawDoc);
          if (csvValue === existingNormalized) {
            console.log("[HS doc-regex] Multi-HS CSV identical to existing, skip");
          } else if (MANUAL_PROTECTED_SOURCES.has(hsFactDoc?.source_type ?? '')) {
            console.log("[HS doc-regex] Existing HS is manual source, skip multi-HS supersede");
          } else {
            const firstMatch = resolvedCandidates.find(r => r.code10 === sortedCodes[0])!;
            const { error: hsMultiErr } = await serviceClient.rpc("supersede_fact", {
              p_case_id: case_id,
              p_fact_key: "cargo.hs_code",
              p_fact_category: "cargo",
              p_value_text: csvValue,
              p_value_number: null,
              p_value_json: null,
              p_value_date: null,
              p_source_type: "document_regex",
              p_source_email_id: null,
              p_source_attachment_id: null,
              p_source_excerpt: `[document_regex] Multi-HS from ${firstMatch.file}: ${sortedCodes.join(", ")}`,
              p_confidence: 0.90,
            });
            if (hsMultiErr) {
              console.error("[HS doc-regex] Multi-HS supersede_fact FAILED:", hsMultiErr.message);
            } else {
              factsAdded++;
              console.log("[HS doc-regex] Injected multi-HS CSV:", csvValue);
            }
          }
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
      const emailTokens = hsRawEmailValue.split(/[;,]/).map((c) => c.trim()).filter(Boolean);
      const existingEmailIsMultiCsv = emailTokens.length > 1 && emailTokens.every((c) => /^\d{10}$/.test(c));
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
        const resolvedEmailCandidates: Array<{ code10: string; emailId: string; subject: string; raw: string }> = [];

        for (const email of emails) {
          const emailText = [
            email.subject || "",
            extractPlainTextFromMime(email.body_text || ""),
          ].join(" ");

          const rawCandidates = extractHsCodesFromText(emailText);
          for (const raw of rawCandidates) {
            const hsResult = await resolveSenegalHsCode(serviceClient, raw);
            if (hsResult.status === "unique") {
              resolvedEmailCandidates.push({
                code10: hsResult.code10,
                emailId: email.id,
                subject: email.subject || "(no subject)",
                raw,
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
            }
          }
        } else if (uniqueEmailCodes.length === 0) {
          console.log("[HS email-regex] No HS found/resolved from emails");
        } else {
          // P1: Multi-HS email — inject as sorted CSV
          const sortedEmailCodes = [...uniqueEmailCodes].sort();
          const csvEmailValue = sortedEmailCodes.join(",");
          const hsRawEmail = (hsFactEmail?.value_text || "").trim();
          const existingEmailNormalized = normalizeHsCsv(hsRawEmail);
          if (csvEmailValue === existingEmailNormalized) {
            console.log("[HS email-regex] Multi-HS CSV identical to existing, skip");
          } else if (MANUAL_PROTECTED_SOURCES.has(hsFactEmail?.source_type ?? '')) {
            console.log("[HS email-regex] Existing HS is manual source, skip multi-HS supersede");
          } else {
            const firstEmailMatch = resolvedEmailCandidates.find(r => r.code10 === sortedEmailCodes[0])!;
            const { error: hsEmailMultiErr } = await serviceClient.rpc("supersede_fact", {
              p_case_id: case_id,
              p_fact_key: "cargo.hs_code",
              p_fact_category: "cargo",
              p_value_text: csvEmailValue,
              p_value_number: null,
              p_value_json: null,
              p_value_date: null,
              p_source_type: "email_body",
              p_source_email_id: firstEmailMatch.emailId,
              p_source_attachment_id: null,
              p_source_excerpt: `[email_regex] Multi-HS from ${firstEmailMatch.subject}: ${sortedEmailCodes.join(", ")}`,
              p_confidence: 0.88,
            });
            if (hsEmailMultiErr) {
              console.error("[HS email-regex] Multi-HS supersede_fact FAILED:", hsEmailMultiErr.message);
            } else {
              factsAdded++;
              console.log("[HS email-regex] Injected multi-HS CSV:", csvEmailValue);
            }
          }
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
      const gateText = threadContext || "";
      if (detectMultiQuoteMarkers(gateText)) {
        console.log("[M3.5 multi-quote] Markers detected, launching AI extraction...");
        const quoteLines = await extractQuoteLinesWithAI(
          threadContext, fullAttachmentContext, emails, lovableApiKey || ""
        );

        if (Array.isArray(quoteLines) && quoteLines.length > 0) {
          const sourceEmailId = pickSourceEmailId(emails);

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

          const validLinesPayload = linesPayload.filter(
            (l) => Array.isArray(l.extracted_facts_json) && l.extracted_facts_json.length >= 2
          );

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
          } else {
            console.log("[M3.5 multi-quote] No valid lines after validation (min 2 facts required)");
            multiQuoteResult = { detected: true, stored: 0, mode: "detected_no_valid_lines" };
          }
        } else {
          multiQuoteResult = { detected: true, stored: 0, mode: "ai_no_lines" };
        }
      } else {
        multiQuoteResult = { detected: false, stored: 0, mode: null };
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
          const hsResult = await resolveSenegalHsCode(serviceClient, rawHsValue);

          if (hsResult.status === "unique") {
            // Supersede with validated 10-digit code
            const confidence = digitsOnly.length >= 10 ? 1.0 : 0.98;
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
              p_confidence: confidence,
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
      ]);
      for (const k of policyKeysAll) mandatorySet.add(k);
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
   - When in doubt about a price source, do NOT extract it as a cargo fact`;

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
          sourceEmailId: emails[0]?.id,
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
          type: `${parts?.[2]}${(parts?.[3] || "DV").toUpperCase()}`,
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
