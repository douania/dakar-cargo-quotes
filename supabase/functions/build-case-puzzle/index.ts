/**
 * Phase 7.0.3-fix: build-case-puzzle
 * Analyzes thread emails/attachments and populates facts/gaps
 * CTO Fix: Uses atomic supersede_fact RPC for fact updates
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

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
  AIR_IMPORT: [
    "routing.origin_airport",
    "routing.destination_city",
    "routing.incoterm",
    "cargo.description",
    "cargo.weight_kg",
    "cargo.pieces_count",
    "cargo.value",
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
  const servicePackage = factMap.get('service.package')?.value || '';
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

  // Rule 3: Breakbulk project
  const breakbulkKeywords = ['transformer', 'crane', 'heavy', 'breakbulk'];
  if (weightKg > 30000 || breakbulkKeywords.some(kw => cargoDesc.includes(kw))) {
    return 'BREAKBULK_PROJECT';
  }

  // Rule 4: Import project DAP (+ cargo.containers as project indicator)
  if (destCountry === 'SN' && !servicePackage) {
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
  emailIds: string[]
): Promise<{ added: number; skipped: number; flowType: string }> {
  const result = { added: 0, skipped: 0, flowType: 'UNKNOWN' };

  // Step 1: Load existing facts
  const { data: facts } = await serviceClient
    .from('quote_facts')
    .select('fact_key, value_text, value_number, source_type')
    .eq('case_id', caseId)
    .eq('is_current', true);

  const factMap = new Map<string, { value: string; source: string }>();
  if (facts) {
    for (const f of facts) {
      factMap.set(f.fact_key, {
        value: f.value_text || String(f.value_number || ''),
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
      p_fact_category: rule.key.split('.')[0], // e.g. 'service' from 'service.package'
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
    const extractedInfo = (attachment.extracted_data as any)?.extracted_info;
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

      if (mapping.valueType === 'number') {
        valueNumber = parseWeight(String(rawValue));
        if (valueNumber === null) {
          // CTO Adjustment #3: store raw text, no complex parsing
          valueText = String(rawValue);
        }
      } else {
        // CTO Adjustment #3: always store raw text for containers etc.
        valueText = String(rawValue);
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
        p_confidence: 0.95, // CTO Adjustment #2: 0.95 not 1.0
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

    const { data: userData, error: userError } = await userClient.auth.getUser();
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
      .select("*, email_threads!inner(id, subject_normalized)")
      .eq("id", case_id)
      .single();

    if (caseError || !caseData) {
      return new Response(
        JSON.stringify({ error: "Case not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (caseData.created_by !== userId && caseData.assigned_to !== userId) {
      return new Response(
        JSON.stringify({ error: "Access denied" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Phase C: Statuts figés qui ne doivent pas être modifiés automatiquement
    const FROZEN_STATUSES = ["PRICED_DRAFT", "HUMAN_REVIEW", "SENT", "ACCEPTED", "REJECTED", "ARCHIVED"];
    const isFrozenCase = FROZEN_STATUSES.includes(caseData.status);

    if (isFrozenCase && !force_refresh) {
      console.log(`[BuildPuzzle] Case ${case_id} is frozen (${caseData.status}), facts will be added but status unchanged`);
    }

    // 4. Load all emails from thread
    const { data: emails } = await serviceClient
      .from("emails")
      .select("id, from_address, to_addresses, subject, body_text, sent_at, is_quotation_request")
      .eq("thread_ref", caseData.thread_id)
      .order("sent_at", { ascending: true });

    if (!emails || emails.length === 0) {
      return new Response(
        JSON.stringify({ error: "No emails found in thread" }),
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
      .map((e) => `[${e.sent_at}] From: ${e.from_address}\nSubject: ${e.subject}\n\n${e.body_text || ""}`)
      .join("\n\n---\n\n");

    const attachmentContext = (attachments || [])
      .filter((a) => a.extracted_text || a.extracted_data)
      .map((a) => `[Attachment: ${a.filename}]\n${a.extracted_text || JSON.stringify(a.extracted_data)}`)
      .join("\n\n");

    // 7. Call AI for fact extraction
    const extractedFacts = await extractFactsWithAI(
      threadContext,
      attachmentContext,
      emails,
      attachments || [],
      lovableApiKey
    );

    // 8. Detect request type from content
    const detectedType = detectRequestType(threadContext, extractedFacts);

    // 9. Store facts using ATOMIC RPC supersede_fact
    // CTO FIX Phase 7.0.3: Fail fast + error tracking + skip identical values
    let factsAdded = 0;
    let factsUpdated = 0;
    let factsSkipped = 0;
    const factErrors: Array<{ key: string; error: string; isCritical: boolean }> = [];
    
    // Get mandatory facts for this request type to mark critical errors
    const mandatoryFactsForType = MANDATORY_FACTS[detectedType] || MANDATORY_FACTS.SEA_FCL_IMPORT;

    for (const fact of extractedFacts) {
      try {
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
          // CTO FIX: Skip if value is identical (avoid unnecessary writes)
          const existingValue = existingFact.value_text || existingFact.value_number || existingFact.value_json;
          if (JSON.stringify(existingValue) === JSON.stringify(factValue)) {
            factsSkipped++;
            continue; // No change, skip
          }

          // Values differ - supersede
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
            
            // CTO FIX: Log error to timeline for observability
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
          // Insert new fact via RPC
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
            
            // CTO FIX: Log error to timeline for observability
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

    // --- M3.5.1: Apply hypothesis engine (after M3.4, before gap detection) ---
    const assumptionResult = await applyAssumptionRules(case_id, serviceClient, emailIds);
    factsAdded += assumptionResult.added;

    // CTO FIX Phase 7.0.3: Block READY_TO_PRICE if any fact errors occurred
    if (factErrors.length > 0) {
      const criticalErrors = factErrors.filter(e => e.isCritical);
      console.error(`${factErrors.length} fact errors for case ${case_id} (${criticalErrors.length} critical):`, factErrors);
      
      // Force status to FACTS_PARTIAL - cannot proceed to pricing with failed facts
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
          error_summary: `${factErrors.length} facts failed to save (${criticalErrors.length} critical)`
        }),
        { status: 207, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 10. Identify gaps
    const mandatoryFacts = MANDATORY_FACTS[detectedType] || MANDATORY_FACTS.SEA_FCL_IMPORT;
    const extractedKeys = extractedFacts.map((f) => f.key);
    
    let gapsIdentified = 0;

    for (const requiredKey of mandatoryFacts) {
      const hasFact = extractedKeys.includes(requiredKey);
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

          // Contextual blocking: for SEA_FCL, only specific gaps are blocking
          let isBlocking: boolean;
          if (detectedType === "SEA_FCL_IMPORT") {
            isBlocking = SEA_FCL_BLOCKING_GAPS.has(requiredKey);
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
    
    // Re-use isFrozenCase from earlier check (line 189)
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
4. Extract exact source excerpts for traceability`;

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
      
      // Enrich with source email IDs
      return facts.map((f: any) => ({
        ...f,
        sourceType: f.isAssumption ? "ai_assumption" : "ai_extraction",
        sourceEmailId: emails[0]?.id,
      }));
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

    // Basic text extraction patterns
    const body = (firstEmail.body_text || "").toLowerCase();
    
    // Incoterm detection
    const incoterms = ["exw", "fob", "cfr", "cif", "dap", "ddp", "fca", "cpt", "cip", "dat", "dpu"];
    for (const term of incoterms) {
      if (body.includes(term)) {
        facts.push({
          key: "routing.incoterm",
          category: "routing",
          value: term.toUpperCase(),
          valueType: "text",
          sourceType: "email_body",
          sourceEmailId: firstEmail.id,
          confidence: 0.7,
        });
        break;
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
  }

  return facts;
}

function detectRequestType(context: string, facts: ExtractedFact[]): string {
  const lowerContext = context.toLowerCase();

  // MARITIME indicators checked FIRST (more specific patterns before generic ones)
  const maritimePatterns = [
    "container", "fcl",
    "40ft", "20ft", "40'", "20'", "40 ft", "20 ft",
    "40hc", "40dv", "20dv", "40fr", "40ot", "40rf", "20rf",
    "vessel", "shipping", "sea freight", "seafreight",
    "bill of lading", "b/l", "bl ",
  ];
  
  // Known maritime port names (common origins)
  const maritimePorts = [
    "jeddah", "shanghai", "ningbo", "shenzhen", "guangzhou",
    "istanbul", "mumbai", "chennai", "dubai", "jebel ali",
    "hamburg", "antwerp", "rotterdam", "le havre", "marseille",
    "genoa", "barcelona", "singapore", "busan", "yokohama",
  ];

  const hasMaritimePattern = maritimePatterns.some(p => lowerContext.includes(p));
  const hasMaritimePort = maritimePorts.some(p => lowerContext.includes(p));
  const hasContainerFact = facts.some(f => f.key === "cargo.containers");

  if (hasMaritimePattern || hasMaritimePort || hasContainerFact) {
    return "SEA_FCL_IMPORT";
  }

  // AIR indicators (checked after maritime)
  if (lowerContext.includes("air freight") || 
      lowerContext.includes("airfreight") ||
      lowerContext.includes("awb") ||
      lowerContext.includes("air waybill") ||
      facts.some(f => f.key === "routing.origin_airport")) {
    return "AIR_IMPORT";
  }

  // Breakbulk indicators
  if (lowerContext.includes("breakbulk") ||
      lowerContext.includes("project cargo") ||
      lowerContext.includes("heavy lift")) {
    return "SEA_BREAKBULK_IMPORT";
  }

  // Default
  return "SEA_FCL_IMPORT";
}

function getFactValue(fact: ExtractedFact): string | number | object {
  return fact.value;
}
