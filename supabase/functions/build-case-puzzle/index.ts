/**
 * Phase A1: build-case-puzzle
 * Analyzes thread emails/attachments and populates facts/gaps
 * CTO Fix: Uses atomic supersede_fact RPC for fact updates
 * A1: AIR detection priority, cargo extraction, chargeable weight, incoterm fix
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

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
  "contacts.client_email",
]);

// A1: AIR_IMPORT blocking gaps (CTO P0-3: reduced set)
const AIR_IMPORT_BLOCKING_GAPS = new Set([
  "routing.destination_city",
  "cargo.weight_kg",
  "cargo.pieces_count",
  "contacts.client_email",
]);

// SEA_LCL_IMPORT blocking gaps
const SEA_LCL_BLOCKING_GAPS = new Set([
  "routing.destination_city",
  "cargo.description",
  "cargo.weight_kg",
  "cargo.volume_cbm",
  "contacts.client_email",
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
    fr: "Veuillez confirmer le port de destination (Dakar ou autre)",
    en: "Please confirm the destination port (Dakar or other)",
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
  case_id: string;
  force_refresh?: boolean;
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
  'incoterm': { factKey: 'routing.incoterm', category: 'routing', valueType: 'text' },
  'fournisseur': { factKey: 'contacts.shipper', category: 'contacts', valueType: 'text' },
  'devise': { factKey: 'pricing.currency', category: 'pricing', valueType: 'text' },
};

// --- M3.5.1: Assumption rules by flow type ---
const ASSUMPTION_RULES: Record<string, Array<{ key: string; value: string; confidence: number }>> = {
  TRANSIT_GAMBIA: [
    { key: 'service.package', value: 'TRANSIT_GAMBIA_ALL_IN', confidence: 0.7 },
    { key: 'pricing.currency', value: 'USD', confidence: 0.7 },
    { key: 'border.fee_expected', value: 'true', confidence: 0.6 },
  ],
  EXPORT_SENEGAL: [
    { key: 'service.package', value: 'EXPORT_SENEGAL', confidence: 0.6 },
    { key: 'tax.vat_rate', value: '0.18', confidence: 0.6 },
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
};

// Sources that cannot be overwritten by assumptions
const ASSUMPTION_PROTECTED_SOURCES = new Set(['operator', 'attachment_extracted', 'ai_extraction']);

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
  'MUMBAI': 'IN', 'NHAVA SHEVA': 'IN',
  'DUBAI': 'AE', 'JEBEL ALI': 'AE',
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

function resolveCountry(
  factMap: Map<string, { value: string; source: string }>,
  countryKey: string,
  portKey: string,
  cityKey?: string
): string {
  // 1. Direct country fact
  const direct = factMap.get(countryKey)?.value?.toUpperCase() || '';
  if (direct) return direct;

  // 2. Resolve from port
  const port = factMap.get(portKey)?.value?.toUpperCase() || '';
  if (port) {
    const mapped = PORT_COUNTRY_MAP[port];
    if (mapped) return mapped;
    // Try partial match for multi-word ports
    for (const [portName, code] of Object.entries(PORT_COUNTRY_MAP)) {
      if (port.includes(portName)) return code;
    }
  }

  // 3. Resolve from city
  if (cityKey) {
    const city = factMap.get(cityKey)?.value?.toUpperCase() || '';
    if (city) {
      const mapped = PORT_COUNTRY_MAP[city];
      if (mapped) return mapped;
      for (const [name, code] of Object.entries(PORT_COUNTRY_MAP)) {
        if (city.includes(name)) return code;
      }
    }
  }

  return '';
}

function detectFlowType(factMap: Map<string, { value: string; source: string }>): string {
  const destCountry = resolveCountry(factMap, 'routing.destination_country', 'routing.destination_port', 'routing.destination_city');
  const originCountry = resolveCountry(factMap, 'routing.origin_country', 'routing.origin_port');
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
  let flowType = detectFlowType(factMap);

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

  // A1: If flowType is UNKNOWN but requestType is AIR_IMPORT, force AIR_IMPORT for assumptions
  if (flowType === 'UNKNOWN' && requestType === 'AIR_IMPORT') {
    flowType = 'AIR_IMPORT';
  }

  // A1 bis: If flowType is IMPORT_PROJECT_DAP but requestType is SEA_LCL_IMPORT, force LCL
  if (flowType === 'IMPORT_PROJECT_DAP' && requestType === 'SEA_LCL_IMPORT') {
    flowType = 'SEA_LCL_IMPORT';
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

      // Source priority: operator > attachment_extracted > ai
      const existingSource = factSourceMap.get(mapping.factKey);
      if (existingSource === 'operator') {
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

      // Handle array values (e.g., codes_hs: ["8525.50", "8507.20"])
      const resolvedValue = Array.isArray(rawValue) ? rawValue.join(', ') : rawValue;

      if (mapping.valueType === 'number') {
        valueNumber = parseRobustNumber(String(resolvedValue));
        if (valueNumber === null) {
          valueText = String(resolvedValue);
        }
      } else {
        valueText = String(resolvedValue);
      }

      // Call supersede_fact RPC
      const { error: rpcError } = await serviceClient.rpc('supersede_fact', {
        p_case_id: caseId,
        p_fact_key: mapping.factKey,
        p_fact_category: mapping.category,
        p_value_text: valueText,
        p_value_number: valueNumber,
        p_value_json: null,
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
          fact_key: mapping.factKey,
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

      injectedKeys.add(mapping.factKey);
      factSourceMap.set(mapping.factKey, 'attachment_extracted');
    }
  }

  // --- Inject cargo.articles_detail if multiple items with values exist ---
  try {
    for (const attachment of attachments) {
      const extractedInfo = (attachment.extracted_data as any)?.extracted_info || attachment.extracted_data;
      if (!extractedInfo) continue;

      const items = extractedInfo.items || extractedInfo.articles || extractedInfo.lignes;
      if (!Array.isArray(items) || items.length < 2) continue;

      // Build articles detail from items with values > 0
      const articlesDetail: Array<{ hs_code: string; value: number; currency: string; description?: string }> = [];
      for (const item of items) {
        const value = parseFloat(item.total ?? item.unit_price ?? item.value ?? item.montant ?? 0);
        const hsCode = item.hs_code || item.code_hs || item.codes_hs || '';
        if (value > 0 && hsCode) {
          articlesDetail.push({
            hs_code: String(hsCode),
            value,
            currency: item.currency || item.devise || extractedInfo.devise || 'EUR',
            description: item.description || item.designation || undefined,
          });
        }
      }

      if (articlesDetail.length >= 2 && !injectedKeys.has('cargo.articles_detail')) {
        const existingSource = factSourceMap.get('cargo.articles_detail');
        if (existingSource !== 'operator') {
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
    const { case_id, force_refresh = false }: BuildPuzzleRequest = await req.json();

    if (!case_id) {
      return new Response(
        JSON.stringify({ error: "case_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Load case and verify ownership
    const { data: caseData, error: caseError } = await serviceClient
      .from("quote_cases")
      .select("*, email_threads(id, subject_normalized)")
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
    const FROZEN_STATUSES = ["PRICED_DRAFT", "HUMAN_REVIEW", "SENT", "ACCEPTED", "REJECTED", "ARCHIVED"];
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

    // 6. Build context for AI extraction
    const threadContext = emails
      .map((e) => `[${e.sent_at}] From: ${e.from_address}\nSubject: ${e.subject}\n\n${extractPlainTextFromMime(e.body_text || "")}`)
      .join("\n\n---\n\n");

    const attachmentContext = (attachments || [])
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

    // 7. Call AI for fact extraction
    const extractedFacts = await extractFactsWithAI(
      threadContext,
      fullAttachmentContext,
      emails,
      attachments || [],
      lovableApiKey
    );

    // 8. Detect request type from content
    let detectedType = detectRequestType(threadContext, extractedFacts);

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
    const factErrors: Array<{ key: string; error: string; isCritical: boolean }> = [];
    
    // Get mandatory facts for this request type to mark critical errors
    const mandatoryFactsForType = MANDATORY_FACTS[detectedType] || MANDATORY_FACTS.SEA_FCL_IMPORT;

    for (const fact of extractedFacts) {
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
          .select("id, value_text, value_number, value_json")
          .eq("case_id", case_id)
          .eq("fact_key", fact.key)
          .eq("is_current", true)
          .single();

        const factValue = getFactValue(fact);

        if (existingFact) {
          const existingValue = existingFact.value_text || existingFact.value_number || existingFact.value_json;
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

      const hsDigitsDoc = (hsFactDoc?.value_text || "").replace(/\D/g, "");

      let skipHsDocRegex = false;
      if (hsDigitsDoc.length === 10) {
        const alreadyValid = await isExactHsMatch(serviceClient, hsDigitsDoc);
        if (alreadyValid) {
          console.log("[HS doc-regex] Existing HS already valid:", hsDigitsDoc);
          skipHsDocRegex = true;
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
          console.warn("[HS doc-regex] Multiple valid HS candidates found:", uniqueCodes.slice(0, 5));
        }
      }
    } catch (hsDocErr) {
      console.error("[HS doc-regex] Unexpected error:", hsDocErr);
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
        const rawHsValue = hsFactRow.value_text || "";
        const digitsOnly = rawHsValue.replace(/\D/g, "");

        // Only re-validate if not already a valid 10-digit code
        if (digitsOnly.length !== 10 || !(await isExactHsMatch(serviceClient, digitsOnly))) {
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
        }
      }
    } catch (hsErr) {
      console.error("[HS Post-Attach] Unexpected error:", hsErr);
    }

    // --- M3.5.1: Apply hypothesis engine (after M3.4, before gap detection) ---
    // A1: Pass requestType so AIR_IMPORT assumptions can be applied
    const assumptionResult = await applyAssumptionRules(case_id, serviceClient, emailIds, detectedType);
    factsAdded += assumptionResult.added;

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
              existingClientCode.source_type === "manual_input";

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
    const mandatoryFacts = MANDATORY_FACTS[detectedType] || MANDATORY_FACTS.UNKNOWN;
    const extractedKeys = extractedFacts.map((f) => f.key);
    
    let gapsIdentified = 0;

    // V4.2.1: Close orphan gaps not required for current request type
    const { data: allOpenGaps } = await serviceClient
      .from("quote_gaps")
      .select("id, gap_key")
      .eq("case_id", case_id)
      .eq("status", "open");

    if (allOpenGaps) {
      const mandatorySet = new Set(mandatoryFacts);
      // Also keep transport_mode gap if UNKNOWN
      if (detectedType === "UNKNOWN") mandatorySet.add("routing.transport_mode");
      const orphanGaps = allOpenGaps.filter(g => !mandatorySet.has(g.gap_key));

      for (const orphan of orphanGaps) {
        await serviceClient
          .from("quote_gaps")
          .update({ status: "resolved", resolved_at: new Date().toISOString() })
          .eq("id", orphan.id);

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

    // A1: For UNKNOWN request type, add a transport mode gap
    if (detectedType === "UNKNOWN") {
      const { data: existingModeGap } = await serviceClient
        .from("quote_gaps")
        .select("id")
        .eq("case_id", case_id)
        .eq("gap_key", "routing.transport_mode")
        .eq("status", "open")
        .single();

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

    // Load existing DB facts to also consider manually injected facts
    const { data: existingDbFacts } = await serviceClient
      .from("quote_facts")
      .select("fact_key")
      .eq("case_id", case_id)
      .eq("is_current", true);
    const existingDbKeys = (existingDbFacts || []).map((f: { fact_key: string }) => f.fact_key);

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
        .single();

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
          if (detectedType === "SEA_FCL_IMPORT") {
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

        await serviceClient.from("case_timeline_events").insert({
          case_id,
          event_type: "gap_resolved",
          event_data: { gap_key: requiredKey },
          related_gap_id: existingGap.id,
          actor_type: "ai",
        });
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
      if (blockingGapsCount === 0 && (currentFactsCount || 0) > 0) {
        newStatus = "READY_TO_PRICE";
      } else if ((openGapsCount || 0) > 0) {
        newStatus = "NEED_INFO";
      } else {
        newStatus = "FACTS_PARTIAL";
      }
    } else {
      console.log(`[BuildPuzzle] Case ${case_id} is frozen (${caseData.status}), status unchanged despite new facts`);
    }

    // 13. Update case
    await serviceClient
      .from("quote_cases")
      .update({
        status: newStatus,
        request_type: detectedType,
        facts_count: currentFactsCount || 0,
        gaps_count: openGapsCount || 0,
        puzzle_completeness: completeness,
        last_activity_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", case_id);

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
        ready_to_price: newStatus === "READY_TO_PRICE",
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
- routing.origin_airport, routing.destination_airport
- cargo.description, cargo.containers (as JSON array [{type, quantity, coc_soc}])
- cargo.weight_kg, cargo.volume_cbm, cargo.value, cargo.value_currency, cargo.pieces_count
- timing.loading_date, timing.delivery_deadline
- carrier.name
- contacts.client_email, contacts.client_company

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
   - 3-letter codes in signatures, reference numbers, or country names are NOT airport codes.`;

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
    const jsonMatch = content.match(/\{[\s\S]*"facts"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const facts = parsed.facts || [];
      
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
    }

    return extractFactsBasic(emails, attachments);
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
    const dimMatch = body.match(/(\d+)\s*[*x×]\s*(\d+)\s*[*x×]\s*(\d+)\s*(?:cm|mm)?/i);
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
function detectRequestType(context: string, facts: ExtractedFact[]): string {
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
    return "AIR_IMPORT";
  }

  // Step 1b: Airport fact — ONLY if no strong maritime signal (Action 1)
  if (facts.some(f => f.key === "routing.origin_airport") && !maritimeSignal) {
    console.log(`[Detection] AIR_IMPORT (airport fact, no maritime conflict)`);
    return "AIR_IMPORT";
  }
  if (facts.some(f => f.key === "routing.origin_airport") && maritimeSignal) {
    console.log(`[Detection] Airport fact IGNORED — strong maritime signals present`);
  }

  // Step 2: Maritime on strong indicators
  if (hasStrongMaritime) {
    // Step 2b: LCL detection (before FCL default)
    const lclPatterns = ["lcl", "less than container", "groupage", "consolidation"];
    if (lclPatterns.some(p => lowerContext.includes(p))) {
      console.log(`[Detection] SEA_LCL_IMPORT (LCL pattern within maritime context)`);
      return "SEA_LCL_IMPORT";
    }
    console.log(`[Detection] SEA_FCL_IMPORT (strong maritime pattern)`);
    return "SEA_FCL_IMPORT";
  }

  // Step 2c: LCL without strong maritime (standalone LCL mention)
  const lclStandalonePatterns = ["lcl", "less than container", "groupage", "consolidation"];
  if (lclStandalonePatterns.some(p => lowerContext.includes(p))) {
    console.log(`[Detection] SEA_LCL_IMPORT (standalone LCL pattern)`);
    return "SEA_LCL_IMPORT";
  }

  // Step 3: Breakbulk patterns (Action 3: expanded with crane, lifting, rigging)
  const breakbulkPatterns = [
    "breakbulk", "break bulk", "project cargo", "heavy lift",
    "crane", "lifting", "rigging", "heavy equipment",
  ];
  if (breakbulkPatterns.some(p => lowerContext.includes(p))) {
    console.log(`[Detection] SEA_BREAKBULK_IMPORT (breakbulk pattern)`);
    return "SEA_BREAKBULK_IMPORT";
  }

  // Step 4: Container fact (already checked in pre-scan, but handle edge cases)
  if (hasValidContainerFact) {
    console.log(`[Detection] SEA_FCL_IMPORT (container fact with valid items)`);
    return "SEA_FCL_IMPORT";
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
        return "AIR_IMPORT";
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
        return "AIR_IMPORT";
      }
    }
  } else {
    console.log(`[Detection] IATA check SKIPPED — maritime signals present`);
  }

  // Step 6: Default = UNKNOWN
  console.log(`[Detection] UNKNOWN (no explicit mode detected)`);
  return "UNKNOWN";
}

function getFactValue(fact: ExtractedFact): string | number | object {
  return fact.value;
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
