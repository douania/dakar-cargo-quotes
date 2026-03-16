/**
 * Phase 11: run-pricing
 * Executes deterministic pricing via quotation-engine
 * CTO Update: Now requires ACK_READY_FOR_PRICING status (Phase 10 gate)
 * CTO Fixes: Atomic run_number, Status rollback compensation, Blocking gaps guard
 * Phase 16: Hard guard unifié + coherence checks (no gap upsert, audit trail preserved)
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface RunPricingRequest {
  case_id: string;
}

interface PricingInputs {
  originPort?: string;
  originAirport?: string;
  destinationPort?: string;
  destinationAirport?: string;
  finalDestination?: string;
  incoterm?: string;
  servicePackage?: string;
  containers?: Array<{ type: string; quantity: number; coc_soc?: string }>;
  cargoWeight?: number;
  cargoVolume?: number;
  cargoValue?: number;
  cargoValueCurrency?: string;
  cargoDescription?: string;
  carrier?: string;
  clientEmail?: string;
  clientCompany?: string;
  hsCode?: string;
  articlesDetail?: Array<{ hs_code: string; value: number; currency: string; description?: string }>;
  regimeCode?: string;
  exemptionTitle?: string;
  // P0 CAF strict: fret réel obligatoire pour FOB/FCA/FAS/EXW
  freightCost?: number;
  freightCurrency?: string;
}

// ═══ P5: SERVICE_PACKAGES mapping (mirror of src/features/quotation/constants.ts) ═══
const SERVICE_PACKAGES: Record<string, string[]> = {
  DAP_PROJECT_IMPORT: ['PORT_DAKAR_HANDLING', 'DTHC', 'TRUCKING', 'EMPTY_RETURN', 'CUSTOMS_DAKAR'],
  TRANSIT_GAMBIA_ALL_IN: ['PORT_DAKAR_HANDLING', 'DTHC', 'TRUCKING', 'BORDER_FEES', 'AGENCY'],
  EXPORT_SENEGAL: ['PORT_CHARGES', 'CUSTOMS_EXPORT', 'AGENCY'],
  BREAKBULK_PROJECT: ['DISCHARGE', 'PORT_DAKAR_HANDLING', 'TRUCKING', 'SURVEY', 'CUSTOMS_DAKAR'],
  AIR_IMPORT_DAP: ['AIR_HANDLING', 'CUSTOMS_DAKAR', 'TRUCKING', 'AGENCY'],
  LCL_IMPORT_DAP: ['PORT_DAKAR_HANDLING', 'CUSTOMS_DAKAR', 'TRUCKING', 'AGENCY'],
  TRANSIT_REGIONAL_VIA_DAKAR: ['PORT_DAKAR_HANDLING', 'DTHC', 'TRUCKING', 'BORDER_FEES', 'CUSTOMS_DAKAR', 'AGENCY'],
  DAP_PROJECT_IMPORT_EXW: ['PICKUP_ORIGIN', 'PRE_CARRIAGE', 'SEA_FREIGHT', 'PORT_DAKAR_HANDLING', 'DTHC', 'TRUCKING', 'EMPTY_RETURN', 'CUSTOMS_DAKAR'],
  AIR_IMPORT_EXW: ['PICKUP_ORIGIN', 'PRE_CARRIAGE', 'AIR_FREIGHT', 'AIR_HANDLING', 'CUSTOMS_DAKAR', 'TRUCKING', 'AGENCY'],
  LCL_IMPORT_EXW: ['PICKUP_ORIGIN', 'PRE_CARRIAGE', 'SEA_FREIGHT', 'PORT_DAKAR_HANDLING', 'CUSTOMS_DAKAR', 'TRUCKING', 'AGENCY'],
};

// P5: Default units per service_key (aligned with service_quantity_rules)
const PACKAGE_SERVICE_DEFAULT_UNITS: Record<string, string> = {
  PICKUP_ORIGIN: 'forfait',
  PRE_CARRIAGE: 'voyage',
  SEA_FREIGHT: 'EVP',
  AIR_FREIGHT: 'kg',
  AIR_HANDLING: 'forfait',
  CUSTOMS_DAKAR: 'forfait',
  TRUCKING: 'voyage',
  AGENCY: 'forfait',
  DTHC: 'forfait',
  EMPTY_RETURN: 'forfait',
  PORT_DAKAR_HANDLING: 'forfait',
  PORT_CHARGES: 'forfait',
  CUSTOMS_EXPORT: 'forfait',
  DISCHARGE: 'forfait',
  SURVEY: 'forfait',
  BORDER_FEES: 'forfait',
  CUSTOMS_BAMAKO: 'forfait',
  ON_CARRIAGE: 'voyage',
};

// P5.1: Human-readable labels for service keys (static, no DB call)
const SERVICE_KEY_LABELS: Record<string, string> = {
  PICKUP_ORIGIN: "Enlèvement à l'origine",
  PRE_CARRIAGE: 'Pré-acheminement',
  SEA_FREIGHT: 'Fret maritime',
  AIR_FREIGHT: 'Fret aérien',
  AIR_HANDLING: 'Handling aéroportuaire',
  CUSTOMS_DAKAR: 'Dédouanement Dakar',
  TRUCKING: 'Transport local',
  AGENCY: "Frais d'agence",
  DTHC: 'DTHC',
  EMPTY_RETURN: 'Retour conteneur vide',
  PORT_DAKAR_HANDLING: 'Manutention port Dakar',
  PORT_CHARGES: 'Frais portuaires',
  CUSTOMS_EXPORT: 'Dédouanement export',
  DISCHARGE: 'Déchargement',
  SURVEY: 'Inspection / Survey',
  BORDER_FEES: 'Frais frontière',
  CUSTOMS_BAMAKO: 'Dédouanement Bamako',
  ON_CARRIAGE: 'Post-acheminement',
};

// P5: Conservative engine-line-to-service-key deduplication
const ENGINE_CATEGORY_TO_SERVICE_KEY: Record<string, string> = {
  'DTHC': 'DTHC',
  'Retour conteneur vide': 'EMPTY_RETURN',
};

/**
 * P5: Read service.overrides from a facts array.
 * Handles double-encoding (string JSON in value_json).
 */
function readOverridesFromFacts(facts: any[]): { add?: string[]; remove?: string[] } | undefined {
  const overrideFact = facts.find((f: any) => f.fact_key === 'service.overrides' && f.is_current !== false);
  if (!overrideFact) return undefined;
  let raw = overrideFact.value_json;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return undefined; }
  }
  if (!raw || typeof raw !== 'object') return undefined;
  return {
    add: Array.isArray(raw.add) ? raw.add : undefined,
    remove: Array.isArray(raw.remove) ? raw.remove : undefined,
  };
}

/**
 * P5: Apply add/remove overrides to base service package.
 */
function resolveEffectiveServiceKeys(
  packageKey: string,
  overrides?: { add?: string[]; remove?: string[] }
): string[] {
  const base = SERVICE_PACKAGES[packageKey];
  if (!base) return [];
  const removeSet = new Set(overrides?.remove ?? []);
  const keys = base.filter(k => !removeSet.has(k));
  for (const k of (overrides?.add ?? [])) {
    if (!keys.includes(k)) keys.push(k);
  }
  return keys;
}

/**
 * P5: Infer which service_keys are already covered by engine lines.
 * Conservative: only maps categories we are 100% sure about.
 */
function inferCoveredServiceKeys(engineLines: any[]): Set<string> {
  const covered = new Set<string>();
  for (const line of engineLines) {
    const cat = line.category || '';
    if (ENGINE_CATEGORY_TO_SERVICE_KEY[cat]) {
      covered.add(ENGINE_CATEGORY_TO_SERVICE_KEY[cat]);
    }
  }
  return covered;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

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
    const { case_id }: RunPricingRequest = await req.json();

    if (!case_id) {
      return new Response(
        JSON.stringify({ error: "case_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Load case and verify ownership + status
    const { data: caseData, error: caseError } = await serviceClient
      .from("quote_cases")
      .select("*")
      .eq("id", case_id)
      .single();

    if (caseError || !caseData) {
      return new Response(
        JSON.stringify({ error: "Case not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Phase 16: Intent gate — check latest thread_intent_v1
    const { data: latestIntent } = await serviceClient
      .from("case_timeline_events")
      .select("event_data")
      .eq("case_id", case_id)
      .eq("event_type", "thread_intent_v1")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestIntent) {
      const ed = latestIntent.event_data as Record<string, unknown> | null;
      const intentObj = (ed?.["intent"] as Record<string, unknown>) ?? null;
      const intentType = (intentObj?.["intent_type"] as string) ?? (ed?.["intent_type"] as string) ?? null;
      const pricingGate = intentObj?.["pricing_gate"] ?? ed?.["pricing_gate"] ?? null;

      // Block if pricing_gate is explicitly false OR intent is a blocking type
      const BLOCKING_INTENTS = new Set(["opportunity_check", "general_inquiry", "send_document"]);
      if (pricingGate === false || (intentType && BLOCKING_INTENTS.has(intentType))) {
        console.log(`[Phase16] Pricing blocked by intent: ${intentType}, pricing_gate: ${pricingGate}`);
        return new Response(
          JSON.stringify({
            error: "Pricing blocked by intent",
            blocked_by_intent: true,
            blocking_reason: intentType || "non_pricing_intent",
            hint: "This case requires clarification before pricing",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    // If no intent event exists → continue normally (no block)

    // Mono-tenant app: all authenticated users can access all cases
    // Ownership check removed — JWT auth is sufficient

    // Allow re-pricing from PRICED_DRAFT (corrections) and HUMAN_REVIEW
    const pricingAllowedStatuses = [
      "READY_TO_PRICE",           // legacy — dossiers pré-ACK
      "ACK_READY_FOR_PRICING",
      "PRICED_DRAFT",
      "HUMAN_REVIEW",
      "QUOTED_VERSIONED",
      "SENT",
    ];
    if (!pricingAllowedStatuses.includes(caseData.status)) {
      return new Response(
        JSON.stringify({ 
          error: "Case not ready for pricing",
          current_status: caseData.status,
          allowed_statuses: pricingAllowedStatuses
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const previousStatus = caseData.status;
    const isFinalized = ["SENT", "QUOTED_VERSIONED"].includes(previousStatus);

    // 4. Phase 15.6: Scope query — determine scopeWantsDuties BEFORE hard guard
    const { data: scopeFacts } = await serviceClient
      .from("quote_facts")
      .select("fact_key, value_text")
      .eq("case_id", case_id)
      .eq("is_current", true)
      .in("fact_key", ["service.package", "routing.incoterm", "cargo.hs_code"]);

    const servicePackageRaw = (scopeFacts || []).find((f: any) => f.fact_key === "service.package")?.value_text ?? "";
    const pkg = String(servicePackageRaw ?? "").trim().toUpperCase();
    const incotermEarlyRaw = (scopeFacts || []).find((f: any) => f.fact_key === "routing.incoterm")?.value_text ?? "";
    const incotermEarly = String(incotermEarlyRaw ?? "").trim().toUpperCase();
    const scopeWantsDuties = pkg.endsWith("_DDP") || pkg === "DDP" || incotermEarly === "DDP";

    // 4a. Hard guard — ALL blocking gaps must be resolved (unified, no exclusions)
    const { count: blockingGapsCount } = await serviceClient
      .from("quote_gaps")
      .select("*", { count: "exact", head: true })
      .eq("case_id", case_id)
      .eq("is_blocking", true)
      .eq("status", "open");

    if (blockingGapsCount && blockingGapsCount > 0) {
      return new Response(
        JSON.stringify({ 
          error: "Blocking gaps still open",
          blocking_gaps_count: blockingGapsCount,
          hint: "Resolve blocking gaps before pricing"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4a-bis. P3b.1: Multi-lot orchestrator — per-lot pricing when structured lines exist
    const { count: mlCount } = await serviceClient
      .from("quote_request_lines")
      .select("*", { count: "exact", head: true })
      .eq("case_id", case_id);

    if ((mlCount ?? 0) >= 2) {
      console.log(`[P3b.1] Multi-lot detected: ${mlCount} quote_request_lines. Entering per-lot orchestration.`);

      // Load all request lines
      const { data: requestLines, error: rlError } = await serviceClient
        .from("quote_request_lines")
        .select("id, line_index, line_label, request_type_hint, extracted_facts_json")
        .eq("case_id", case_id)
        .order("line_index", { ascending: true });

      if (rlError || !requestLines || requestLines.length < 2) {
        console.error("[P3b.1] Failed to load request lines:", rlError);
        return new Response(
          JSON.stringify({ error: "Failed to load multi-lot request lines" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Guard: check all lots have request_type_hint
      const missingHintLots = requestLines
        .filter((rl: any) => !rl.request_type_hint || String(rl.request_type_hint).trim() === "")
        .map((rl: any) => ({
          lot_index: rl.line_index,
          lot_label: rl.line_label || `Lot ${rl.line_index}`,
          blockers: ["LOT_REQUEST_TYPE_REQUIRED"],
          message: `Le lot ${rl.line_index} ne contient pas de request_type_hint exploitable.`,
        }));

      if (missingHintLots.length > 0) {
        const { data: mlGuardRunNumber } = await serviceClient
          .rpc("get_next_pricing_run_number", { p_case_id: case_id });

        const mlGuardMessage = `Pricing multi-lot bloqué : ${missingHintLots.length} lot(s) sans request_type_hint.`;

        await serviceClient.from("pricing_runs").insert({
          case_id,
          run_number: mlGuardRunNumber || 1,
          inputs_json: { mode: "multi_lot", lot_count: requestLines.length },
          facts_snapshot: [],
          status: "blocked",
          error_message: mlGuardMessage,
          outputs_json: {
            pricing_blockers: ["MULTI_LOT_BLOCKED"],
            multi_lot: true,
            blocked_lots: missingHintLots,
            message: mlGuardMessage,
          },
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          created_by: userId,
        });

        return new Response(
          JSON.stringify({
            pricing_blockers: ["MULTI_LOT_BLOCKED"],
            message: mlGuardMessage,
            blocked_lots: missingHintLots,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Load global facts
      const { data: globalFacts, error: gfError } = await serviceClient
        .from("quote_facts")
        .select("*")
        .eq("case_id", case_id)
        .eq("is_current", true);

      if (gfError) {
        return new Response(
          JSON.stringify({ error: "Failed to load global facts" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const globalFactsSnapshot = (globalFacts || []).map((f: any) => ({
        id: f.id, key: f.fact_key, category: f.fact_category,
        value_text: f.value_text, value_number: f.value_number,
        value_json: f.value_json, value_date: f.value_date,
        source_type: f.source_type, confidence: f.confidence,
      }));

      // Per-lot coherence checks
      const lotChecks: Array<{
        lot_index: number; lot_label: string; request_type_hint: string;
        mergedFacts: any[]; inputs: PricingInputs; servicePackage: string | undefined;
        transportMode: string; scopeWantsDuties: boolean; blockers: string[];
      }> = [];

      for (const rl of requestLines) {
        const lotIndex = rl.line_index;
        const lotLabel = rl.line_label || `Lot ${lotIndex}`;
        const requestTypeHint = String(rl.request_type_hint || "").trim();
        const extractedFacts = Array.isArray(rl.extracted_facts_json) ? rl.extracted_facts_json : [];

        // Merge facts: lot-specific overrides global
        const mergedFacts = mergeFactsForLot(globalFacts || [], extractedFacts);
        const lotInputs = buildPricingInputs(mergedFacts);

        // Resolve per-lot service package and transport mode
        const lotIncoterm = String(lotInputs.incoterm ?? "").trim().toUpperCase();
        const lotServicePackage = resolveServicePackageForLot(requestTypeHint, lotIncoterm);
        const lotTransportMode = resolveTransportModeForLot(requestTypeHint);


        if (lotServicePackage) {
          lotInputs.servicePackage = lotServicePackage;
        }

        // Per-lot scope analysis
        const lotPkg = String(lotInputs.servicePackage ?? "").toUpperCase();
        const lotScopeWantsDuties = lotPkg.endsWith("_DDP") || lotPkg === "DDP" || lotIncoterm === "DDP";

        const lotBlockers: string[] = [];

        // HS code check
        if (lotScopeWantsDuties) {
          const rawHs = String(lotInputs.hsCode ?? "");
          const hsCandidates = rawHs.split(/[;,]/).map((c: string) => c.trim().replace(/\D/g, "")).filter(Boolean);
          const firstValidHs10 = hsCandidates.find((c: string) => c.length === 10);
          const hsDigits = firstValidHs10 || rawHs.replace(/\D/g, "");
          if (!hsDigits || hsDigits.length !== 10) {
            lotBlockers.push("HS_CODE_REQUIRED");
          }
        }

        // Freight check for FOB-type incoterms
        if (lotScopeWantsDuties && ["FOB", "FCA", "FAS", "EXW"].includes(lotIncoterm)) {
          if (!lotInputs.freightCost || lotInputs.freightCost <= 0) {
            lotBlockers.push("FREIGHT_REQUIRED_FOR_FOB");
          }
        }

        // Cargo value check
        if (lotScopeWantsDuties && (!lotInputs.cargoValue || lotInputs.cargoValue <= 0)) {
          lotBlockers.push("CARGO_VALUE_REQUIRED");
        }

        // Fix 1: Service package guard — block if hint present but unresolved
        if (requestTypeHint && !lotServicePackage) {
          lotBlockers.push("LOT_SERVICE_PACKAGE_UNRESOLVED");
        }

        // Fix 2: Regime coherence check per lot (mirrors mono-lot check)
        if (lotScopeWantsDuties) {
          const lotFactMap = new Map(mergedFacts.map((f: any) => [f.fact_key, f]));
          const hasExemptionTitle = !!lotFactMap.get("regulatory.exemption_title")?.value_text;
          const hasRegimeCode = !!lotFactMap.get("customs.regime_code")?.value_text;
          if (hasExemptionTitle && !hasRegimeCode) {
            lotBlockers.push("REGIME_REQUIRED_FOR_EXEMPTION");
          }
        }

        lotChecks.push({
          lot_index: lotIndex,
          lot_label: lotLabel,
          request_type_hint: requestTypeHint,
          mergedFacts,
          inputs: lotInputs,
          servicePackage: lotServicePackage,
          transportMode: lotTransportMode,
          scopeWantsDuties: lotScopeWantsDuties,
          blockers: lotBlockers,
        });
      }

      // If ANY lot has blockers → block entire run
      const blockedLots = lotChecks.filter(lc => lc.blockers.length > 0);
      if (blockedLots.length > 0) {
        const { data: mlBlockedRunNumber } = await serviceClient
          .rpc("get_next_pricing_run_number", { p_case_id: case_id });

        const mlBlockedMessage = `Le pricing multi-lot est bloqué : ${blockedLots.length} lot(s) incomplet(s).`;

        await serviceClient.from("pricing_runs").insert({
          case_id,
          run_number: mlBlockedRunNumber || 1,
          inputs_json: {
            mode: "multi_lot",
            lot_count: lotChecks.length,
            lots: lotChecks.map(lc => ({
              lot_index: lc.lot_index, request_type_hint: lc.request_type_hint,
              service_package: lc.servicePackage, transport_mode: lc.transportMode,
            })),
          },
          facts_snapshot: globalFactsSnapshot,
          status: "blocked",
          error_message: mlBlockedMessage,
          outputs_json: {
            pricing_blockers: ["MULTI_LOT_BLOCKED"],
            multi_lot: true,
            blocked_lots: blockedLots.map(bl => ({
              lot_index: bl.lot_index, lot_label: bl.lot_label,
              blockers: bl.blockers,
              message: `Lot ${bl.lot_index} (${bl.lot_label}) : ${bl.blockers.join(", ")}`,
            })),
            message: mlBlockedMessage,
          },
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          created_by: userId,
        });

        return new Response(
          JSON.stringify({
            pricing_blockers: ["MULTI_LOT_BLOCKED"],
            message: mlBlockedMessage,
            blocked_lots: blockedLots.map(bl => ({
              lot_index: bl.lot_index, lot_label: bl.lot_label, blockers: bl.blockers,
            })),
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ALL lots pass — transition to PRICING_RUNNING
      if (!isFinalized) {
        await serviceClient.from("quote_cases").update({
          status: "PRICING_RUNNING",
          last_activity_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", case_id);

        await serviceClient.from("case_timeline_events").insert({
          case_id, event_type: "status_changed",
          previous_value: previousStatus, new_value: "PRICING_RUNNING",
          actor_type: "system",
        });
      }

      // Get run number
      const { data: mlRunNumber, error: mlRpcError } = await serviceClient
        .rpc("get_next_pricing_run_number", { p_case_id: case_id });

      if (mlRpcError || mlRunNumber === null) {
        await rollbackToPreviousStatus(serviceClient, case_id, previousStatus, "ml_run_number_failed");
        throw new Error(`Failed to get multi-lot run number: ${mlRpcError?.message || "null"}`);
      }

      // Create pricing_run record
      const mlInputsJson = {
        mode: "multi_lot",
        lot_count: lotChecks.length,
        lots: lotChecks.map(lc => ({
          lot_index: lc.lot_index, request_type_hint: lc.request_type_hint,
          service_package: lc.servicePackage, transport_mode: lc.transportMode,
        })),
      };

      const { data: mlRunData, error: mlRunInsertError } = await serviceClient
        .from("pricing_runs")
        .insert({
          case_id,
          run_number: mlRunNumber,
          inputs_json: mlInputsJson,
          facts_snapshot: globalFactsSnapshot,
          status: "running",
          started_at: new Date().toISOString(),
          created_by: userId,
        })
        .select("id")
        .single();

      if (mlRunInsertError || !mlRunData) {
        await rollbackToPreviousStatus(serviceClient, case_id, previousStatus, "ml_run_insert_failed");
        throw new Error(`Multi-lot run insert failed: ${mlRunInsertError?.message}`);
      }

      await serviceClient.from("case_timeline_events").insert({
        case_id, event_type: "pricing_started",
        event_data: { run_number: mlRunNumber, mode: "multi_lot", lot_count: lotChecks.length },
        related_pricing_run_id: mlRunData.id,
        actor_type: "system",
      });

      // Execute quotation-engine for each lot
      const engineUrl = `${supabaseUrl}/functions/v1/quotation-engine`;
      const lotResults: Array<{
        lot_index: number; lot_label: string; lines: any[]; sources: any[];
        totals: { ht: number; ttc: number; currency: string };
        engine_request: any; engine_response: any;
      }> = [];

      for (const lc of lotChecks) {
        try {
          const engineParams = {
            finalDestination: lc.inputs.finalDestination,
            originPort: lc.inputs.originPort,
            originAirport: lc.inputs.originAirport,
            incoterm: lc.inputs.incoterm,
            containers: lc.inputs.containers,
            cargoWeight: lc.inputs.cargoWeight,
            cargoVolume: lc.inputs.cargoVolume,
            cargoValue: lc.inputs.cargoValue,
            cargoCurrency: lc.inputs.cargoValueCurrency,
            carrier: lc.inputs.carrier,
            transportMode: lc.transportMode,
            cargoDescription: lc.inputs.cargoDescription,
            clientCompany: lc.inputs.clientCompany,
            hsCode: lc.inputs.hsCode,
            articlesDetail: lc.inputs.articlesDetail,
            regimeCode: lc.inputs.regimeCode || undefined,
            freightAmount: lc.inputs.freightCost,
            freightCurrency: lc.inputs.freightCurrency,
          };

          const engineRes = await fetch(engineUrl, {
            method: "POST",
            headers: { Authorization: authHeader, "Content-Type": "application/json" },
            body: JSON.stringify({ action: "generate", params: engineParams }),
          });

          if (!engineRes.ok) {
            const errorText = await engineRes.text();
            throw new Error(`Lot ${lc.lot_index}: quotation-engine error: ${engineRes.status} - ${errorText}`);
          }

          const lotEngineResponse = await engineRes.json();
          const lotLines = lotEngineResponse.lines || lotEngineResponse.quotationLines || [];

          // Build tariff sources for this lot
          const lotSourceMap = new Map<string, any>();
          for (const line of lotLines) {
            if (line.source?.reference && line.source?.type !== "TO_CONFIRM") {
              const key = `${line.source.type}_${line.source.reference}`;
              lotSourceMap.set(key, {
                type: line.source.type, reference: line.source.reference,
                table: line.source.table || line.source.type,
                confidence: line.source.confidence,
              });
            }
          }

          // Compute per-lot totals (same logic as mono-lot)
          const lotEngineTotals = lotEngineResponse.totals;
          const lotHonorairesHt = lotEngineTotals?.honoraires ?? 0;
          const lotDebours = lotEngineTotals?.debours ?? 0;
          const lotHonorairesTva = Math.round(lotHonorairesHt * 0.18);
          const lotHonorairesTtc = lotHonorairesHt + lotHonorairesTva;
          const lotTotalHt = lotHonorairesHt;
          const lotTotalTtc = lotDebours + lotHonorairesTtc;
          const lotCurrency = lotEngineResponse.currency || "XOF";

          // Tag each line with lot_index and lot_label
          const taggedLines = lotLines.map((line: any) => ({
            ...line,
            lot_index: lc.lot_index,
            lot_label: lc.lot_label,
          }));

          // ═══ P5: Package service lines enrichment (multi-lot) ═══
          const lotPackageKey = (lc.servicePackage || '').trim().toUpperCase();
          if (lotPackageKey && SERVICE_PACKAGES[lotPackageKey]) {
            try {
              const lotOverrides = readOverridesFromFacts(lc.mergedFacts);
              const lotEffectiveKeys = resolveEffectiveServiceKeys(lotPackageKey, lotOverrides);
              const lotCoveredKeys = inferCoveredServiceKeys(lotLines);
              const lotMissingKeys = lotEffectiveKeys.filter(k => !lotCoveredKeys.has(k));

              if (lotMissingKeys.length > 0) {
                console.log(`[P5] Lot ${lc.lot_index}: ${lotMissingKeys.length} package services to enrich: ${lotMissingKeys.join(', ')}`);

                const lotServiceInputs = lotMissingKeys.map(sk => ({
                  id: crypto.randomUUID(),
                  service: sk,
                  unit: PACKAGE_SERVICE_DEFAULT_UNITS[sk] || 'forfait',
                  quantity: 1,
                  currency: 'XOF',
                }));

                // Build pricing_context_override from lot inputs
                const pricingCtxOverride: Record<string, unknown> = {
                  scope: 'import',
                  containers: Array.isArray(lc.inputs.containers) ? lc.inputs.containers : [],
                  container_type: lc.inputs.containers?.[0]?.type || null,
                  container_count: Array.isArray(lc.inputs.containers)
                    ? lc.inputs.containers.reduce((s: number, c: any) => s + Number(c?.quantity ?? 1), 0)
                    : null,
                  weight_kg: lc.inputs.cargoWeight || null,
                  caf_value: null,
                  destination_city: lc.inputs.finalDestination || null,
                  destination_country: null,
                  origin_country: null,
                  origin_port: lc.inputs.originPort || null,
                  client_code: null,
                  corridor: null,
                };

                const pslUrl = `${supabaseUrl}/functions/v1/price-service-lines`;
                const pslRes = await fetch(pslUrl, {
                  method: 'POST',
                  headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    case_id,
                    service_lines: lotServiceInputs,
                    pricing_context_override: pricingCtxOverride,
                  }),
                });

                // P5.1: Build UUID→service_key lookup before consuming response
                const idToServiceKey = new Map(lotServiceInputs.map(sl => [sl.id, sl.service]));

                if (pslRes.ok) {
                  const pslData = await pslRes.json();
                  const pricedLines = pslData?.data?.priced_lines || [];
                  for (const pl of pricedLines) {
                    const serviceKey = idToServiceKey.get(pl.id) || pl.id;
                    const label = SERVICE_KEY_LABELS[serviceKey] || serviceKey;
                    taggedLines.push({
                      category: serviceKey,
                      label: label,
                      amount: pl.rate ?? 0,
                      currency: pl.currency || 'XOF',
                      type: 'service_package',
                      source: { type: pl.source || 'price-service-lines', reference: 'P5', confidence: pl.confidence ?? 0 },
                      quantity: pl.quantity_used ?? 1,
                      unit: pl.unit_used ?? PACKAGE_SERVICE_DEFAULT_UNITS[serviceKey] ?? 'forfait',
                      explanation: pl.explanation || '',
                      lot_index: lc.lot_index,
                      lot_label: lc.lot_label,
                    });
                  }
                  console.log(`[P5] Lot ${lc.lot_index}: merged ${pricedLines.length} priced service lines`);
                } else {
                  console.warn(`[P5] Lot ${lc.lot_index}: price-service-lines failed (${pslRes.status}), continuing`);
                }
              }
            } catch (p5LotError) {
              console.warn(`[P5] Lot ${lc.lot_index}: package enrichment failed, continuing:`, p5LotError);
            }
          }

          lotResults.push({
            lot_index: lc.lot_index,
            lot_label: lc.lot_label,
            lines: taggedLines,
            sources: Array.from(lotSourceMap.values()),
            totals: { ht: lotTotalHt, ttc: lotTotalTtc, currency: lotCurrency },
            engine_request: engineParams,
            engine_response: lotEngineResponse,
          });
        } catch (lotEngineError: any) {
          console.error(`[P3b.1] Engine failed for lot ${lc.lot_index}:`, lotEngineError);

          // ANY lot failure → block entire run
          await serviceClient.from("pricing_runs").update({
            status: "failed",
            error_message: `Lot ${lc.lot_index} engine failure: ${lotEngineError.message}`,
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - startTime,
          }).eq("id", mlRunData.id);

          await rollbackToPreviousStatus(serviceClient, case_id, previousStatus, `ml_lot_${lc.lot_index}_engine_failed`);

          await serviceClient.from("case_timeline_events").insert({
            case_id, event_type: "pricing_failed",
            event_data: { error: lotEngineError.message, run_number: mlRunNumber, failed_lot: lc.lot_index },
            related_pricing_run_id: mlRunData.id,
            actor_type: "system",
          });

          return new Response(
            JSON.stringify({
              error: "Multi-lot pricing failed",
              failed_lot: lc.lot_index,
              details: lotEngineError.message,
              pricing_run_id: mlRunData.id,
            }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // ALL lots succeeded — aggregate results
      const allTaggedLines = lotResults.flatMap(lr => lr.lines);
      const allSources: any[] = [];
      const sourceDedup = new Set<string>();
      for (const lr of lotResults) {
        for (const src of lr.sources) {
          const key = `${src.type}_${src.reference}`;
          if (!sourceDedup.has(key)) {
            sourceDedup.add(key);
            allSources.push(src);
          }
        }
      }

      const aggregatedHt = lotResults.reduce((sum, lr) => sum + lr.totals.ht, 0);
      const aggregatedTtc = lotResults.reduce((sum, lr) => sum + lr.totals.ttc, 0);
      const aggregatedCurrency = lotResults[0]?.totals.currency || "XOF";

      const mlDurationMs = Date.now() - startTime;

      // Dual storage: structured detail in outputs_json + root-level columns
      const mlOutputsJson = {
        multi_lot: true,
        lots: lotResults.map(lr => ({
          lot_index: lr.lot_index,
          label: lr.lot_label,
          lines: lr.lines,
          totals: lr.totals,
          duty_breakdown: lr.engine_response.duty_breakdown || [],
        })),
        totals: { ht: aggregatedHt, ttc: aggregatedTtc, currency: aggregatedCurrency },
        lines: allTaggedLines,
        metadata: {
          engine_version: lotResults[0]?.engine_response?.version || "v4",
          computed_at: new Date().toISOString(),
          mode: "multi_lot",
          lot_count: lotResults.length,
        },
      };

      await serviceClient.from("pricing_runs").update({
        status: "success",
        engine_request: {
          mode: "multi_lot",
          lot_count: lotResults.length,
          lots: lotResults.map(lr => ({ lot_index: lr.lot_index, params: lr.engine_request })),
        },
        engine_response: {
          mode: "multi_lot",
          lot_count: lotResults.length,
          lots: lotResults.map(lr => ({ lot_index: lr.lot_index, response: lr.engine_response })),
        },
        outputs_json: mlOutputsJson,
        tariff_lines: allTaggedLines,
        total_ht: aggregatedHt,
        total_ttc: aggregatedTtc,
        currency: aggregatedCurrency,
        tariff_sources: allSources,
        completed_at: new Date().toISOString(),
        duration_ms: mlDurationMs,
      }).eq("id", mlRunData.id);

      // Status transition
      if (!isFinalized) {
        await serviceClient.from("quote_cases").update({
          status: "PRICED_DRAFT",
          pricing_runs_count: mlRunNumber,
          last_activity_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", case_id);
      } else {
        await serviceClient.from("quote_cases").update({
          pricing_runs_count: mlRunNumber,
          last_activity_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", case_id);
      }

      await serviceClient.from("case_timeline_events").insert({
        case_id, event_type: "pricing_completed",
        event_data: {
          run_number: mlRunNumber, mode: "multi_lot", lot_count: lotResults.length,
          total_ht: aggregatedHt, lines_count: allTaggedLines.length, duration_ms: mlDurationMs,
        },
        related_pricing_run_id: mlRunData.id,
        actor_type: "system",
      });

      if (!isFinalized) {
        await serviceClient.from("case_timeline_events").insert({
          case_id, event_type: "status_changed",
          previous_value: "PRICING_RUNNING", new_value: "PRICED_DRAFT",
          actor_type: "system",
        });
      }

      console.log(`[P3b.1] Multi-lot pricing run ${mlRunNumber} for case ${case_id} completed in ${mlDurationMs}ms — ${lotResults.length} lots, ${allTaggedLines.length} lines`);

      return new Response(
        JSON.stringify({
          pricing_run_id: mlRunData.id,
          run_number: mlRunNumber,
          mode: "multi_lot",
          lot_count: lotResults.length,
          total_ht: aggregatedHt,
          total_ttc: aggregatedTtc,
          currency: aggregatedCurrency,
          lines_count: allTaggedLines.length,
          duration_ms: mlDurationMs,
          tariff_sources_count: allSources.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4b. Coherence check — HS Code (last-resort drift detection, NO gap upsert)
    if (scopeWantsDuties) {
      const rawHs = String((scopeFacts || []).find((f: any) => f.fact_key === "cargo.hs_code")?.value_text ?? "");
      const hsCandidates = rawHs.split(/[;,]/).map((c: string) => c.trim().replace(/\D/g, "")).filter(Boolean);
      const firstValidHs10 = hsCandidates.find((c: string) => c.length === 10);
      const hsDigits = firstValidHs10 || rawHs.replace(/\D/g, "");
      let hsBlocker: string | null = null;

      if (!hsDigits || hsDigits.length !== 10) {
        hsBlocker = "HS_CODE_REQUIRED";
      } else {
        const { data: hsRow } = await serviceClient
          .from("hs_codes")
          .select("code_normalized")
          .eq("code_normalized", hsDigits)
          .limit(1)
          .maybeSingle();
        if (!hsRow) hsBlocker = "HS_CODE_UNKNOWN";
      }

      if (hsBlocker) {
        console.error("[COHERENCE] puzzle/pricing drift", { case_id, missing: "cargo.hs_code", blocker: hsBlocker, scopeWantsDuties, incoterm: incotermEarly, pkg });

        const { data: blockerRunNumber } = await serviceClient
          .rpc('get_next_pricing_run_number', { p_case_id: case_id });

        const blockerOutputs = {
          pricing_blockers: [hsBlocker],
          message: hsBlocker === "HS_CODE_REQUIRED"
            ? "DDP : Code HS 10 chiffres UEMOA requis pour chiffrer droits & taxes. Renseignez cargo.hs_code."
            : `DDP : Code HS "${rawHs}" (${hsDigits}) introuvable dans la nomenclature UEMOA.`,
          current_hs_code: rawHs || null,
          scope: { servicePackage: pkg, incoterm: incotermEarly },
          coherence_drift: true,
        };

        await serviceClient
          .from("pricing_runs")
          .insert({
            case_id,
            run_number: blockerRunNumber || 1,
            inputs_json: { servicePackage: pkg, incoterm: incotermEarly, hsCode: rawHs || null },
            facts_snapshot: [],
            status: "blocked",
            error_message: blockerOutputs.message,
            outputs_json: blockerOutputs,
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - startTime,
            created_by: userId,
          });

        return new Response(
          JSON.stringify({
            pricing_blockers: blockerOutputs.pricing_blockers,
            message: blockerOutputs.message,
            run_number: blockerRunNumber || 1,
            scope_debug: { servicePackage: pkg, incoterm: incotermEarly, scopeWantsDuties },
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    // If !scopeWantsDuties → skip HS coherence check

    // 4c. Coherence check — Regime (last-resort drift detection, NO gap upsert)
    if (scopeWantsDuties) {
      const { data: regimeCheckFacts } = await serviceClient
        .from("quote_facts")
        .select("fact_key, value_text")
        .eq("case_id", case_id)
        .eq("is_current", true)
        .in("fact_key", ["customs.regime_code", "regulatory.exemption_title"]);

      const regimeCheckMap = new Map((regimeCheckFacts || []).map((f: any) => [f.fact_key, f.value_text]));
      const hasExemptionTitle = !!regimeCheckMap.get("regulatory.exemption_title");
      const hasRegimeCode = !!regimeCheckMap.get("customs.regime_code");

      if (hasExemptionTitle && !hasRegimeCode) {
        console.error("[COHERENCE] puzzle/pricing drift", { case_id, missing: "customs.regime_code", scopeWantsDuties, incoterm: incotermEarly, pkg });

        const { data: regimeBlockerRunNumber } = await serviceClient
          .rpc('get_next_pricing_run_number', { p_case_id: case_id });

        const regimeBlockerOutputs = {
          pricing_blockers: ["REGIME_REQUIRED_FOR_EXEMPTION"],
          message: "DDP : Titre d'exonération détecté — renseignez le régime douanier pour calculer les exonérations.",
          exemption_title: regimeCheckMap.get("regulatory.exemption_title"),
          scope: { servicePackage: pkg, incoterm: incotermEarly },
          coherence_drift: true,
        };

        await serviceClient
          .from("pricing_runs")
          .insert({
            case_id,
            run_number: regimeBlockerRunNumber || 1,
            inputs_json: { exemptionTitle: regimeCheckMap.get("regulatory.exemption_title") },
            facts_snapshot: [],
            status: "blocked",
            error_message: regimeBlockerOutputs.message,
            outputs_json: regimeBlockerOutputs,
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - startTime,
            created_by: userId,
          });

        return new Response(
          JSON.stringify({
            pricing_blockers: regimeBlockerOutputs.pricing_blockers,
            message: regimeBlockerOutputs.message,
            run_number: regimeBlockerRunNumber || 1,
            scope_debug: { servicePackage: pkg, incoterm: incotermEarly, scopeWantsDuties },
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    // If !scopeWantsDuties → skip regime coherence check

    // 5. Transition to PRICING_RUNNING (skip for finalized cases)
    if (!isFinalized) {
      await serviceClient
        .from("quote_cases")
        .update({ 
          status: "PRICING_RUNNING",
          last_activity_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", case_id);

      await serviceClient.from("case_timeline_events").insert({
        case_id,
        event_type: "status_changed",
        previous_value: previousStatus,
        new_value: "PRICING_RUNNING",
        actor_type: "system",
      });
    }

    // 6. Load all current facts
    const { data: facts, error: factsError } = await serviceClient
      .from("quote_facts")
      .select("*")
      .eq("case_id", case_id)
      .eq("is_current", true);

    if (factsError) {
      // CTO FIX: Rollback status on error
      await rollbackToPreviousStatus(serviceClient, case_id, previousStatus, "facts_load_failed");
      throw new Error(`Failed to load facts: ${factsError.message}`);
    }

    // 7. Build facts snapshot (frozen copy)
    const factsSnapshot = (facts || []).map((f) => ({
      id: f.id,
      key: f.fact_key,
      category: f.fact_category,
      value_text: f.value_text,
      value_number: f.value_number,
      value_json: f.value_json,
      value_date: f.value_date,
      source_type: f.source_type,
      confidence: f.confidence,
    }));

    // 8. Build inputs_json from facts
    const inputs = buildPricingInputs(facts || []);

    // 8b. Coherence check — FOB freight (last-resort drift detection, NO gap upsert)
    const incoterm = String(inputs.incoterm ?? '').trim().toUpperCase();
    const isFobType = ['FOB', 'FCA', 'FAS', 'EXW'].includes(incoterm);

    if (scopeWantsDuties && isFobType) {
      if (!inputs.freightCost || inputs.freightCost <= 0) {
        console.error("[COHERENCE] puzzle/pricing drift", { case_id, missing: "cargo.freight_cost", scopeWantsDuties, incoterm, pkg });

        const { data: fobBlockerRunNumber } = await serviceClient
          .rpc('get_next_pricing_run_number', { p_case_id: case_id });

        const fobBlockerMessage = "DDP + FOB/FCA/FAS/EXW : le montant du fret réel est obligatoire pour le calcul CAF douanier.";

        await serviceClient
          .from("pricing_runs")
          .insert({
            case_id,
            run_number: fobBlockerRunNumber || 1,
            inputs_json: { incoterm, freightCost: inputs.freightCost, freightCurrency: inputs.freightCurrency, scope: { servicePackage: pkg } },
            facts_snapshot: factsSnapshot,
            status: "blocked",
            error_message: fobBlockerMessage,
            outputs_json: { pricing_blockers: ["FREIGHT_REQUIRED_FOR_FOB"], message: fobBlockerMessage, scope: { servicePackage: pkg, incoterm: incotermEarly }, coherence_drift: true },
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - startTime,
            created_by: userId,
          });

        if (!isFinalized) {
          await rollbackToPreviousStatus(serviceClient, case_id, previousStatus, "fob_freight_blocker");
        }

        return new Response(
          JSON.stringify({
            pricing_blockers: ["FREIGHT_REQUIRED_FOR_FOB"],
            message: fobBlockerMessage,
            run_number: fobBlockerRunNumber || 1,
            scope_debug: { servicePackage: pkg, incoterm: incotermEarly, scopeWantsDuties },
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    // If !scopeWantsDuties or !isFobType → skip FOB freight coherence check

    // 8c. Coherence check — Cargo Value for DDP (last-resort drift detection, NO gap upsert)
    if (scopeWantsDuties) {
      if (!inputs.cargoValue || inputs.cargoValue <= 0) {
        console.error("[COHERENCE] puzzle/pricing drift", { case_id, missing: "cargo.value", scopeWantsDuties, incoterm, pkg });

        const { data: cvBlockerRunNumber } = await serviceClient
          .rpc('get_next_pricing_run_number', { p_case_id: case_id });

        const cvBlockerMessage = "DDP : Valeur marchandise (cargo.value) requise pour calculer droits et taxes.";

        await serviceClient
          .from("pricing_runs")
          .insert({
            case_id,
            run_number: cvBlockerRunNumber || 1,
            inputs_json: { cargoValue: inputs.cargoValue, scope: { servicePackage: pkg, incoterm: incotermEarly } },
            facts_snapshot: factsSnapshot,
            status: "blocked",
            error_message: cvBlockerMessage,
            outputs_json: { pricing_blockers: ["CARGO_VALUE_REQUIRED"], message: cvBlockerMessage, scope: { servicePackage: pkg, incoterm: incotermEarly, scopeWantsDuties }, coherence_drift: true },
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - startTime,
            created_by: userId,
          });

        if (!isFinalized) {
          await rollbackToPreviousStatus(serviceClient, case_id, previousStatus, "cargo_value_blocker");
        }

        return new Response(
          JSON.stringify({
            pricing_blockers: ["CARGO_VALUE_REQUIRED"],
            message: cvBlockerMessage,
            run_number: cvBlockerRunNumber || 1,
            scope_debug: { servicePackage: pkg, incoterm: incotermEarly, scopeWantsDuties },
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    // If !scopeWantsDuties → skip cargo value coherence check

    // 9. CTO FIX: Get next run number via ATOMIC RPC (prevents race conditions)
    const { data: runNumber, error: rpcError } = await serviceClient
      .rpc('get_next_pricing_run_number', { p_case_id: case_id });

    if (rpcError || runNumber === null) {
      // CTO FIX: Rollback status on error
      await rollbackToPreviousStatus(serviceClient, case_id, previousStatus, "run_number_failed");
      throw new Error(`Failed to get run number: ${rpcError?.message || "null result"}`);
    }

    // 10. Create pricing_run record with compensation on failure
    let pricingRun: { id: string } | null = null;
    
    try {
      const { data: runData, error: runInsertError } = await serviceClient
        .from("pricing_runs")
        .insert({
          case_id,
          run_number: runNumber,
          inputs_json: inputs,
          facts_snapshot: factsSnapshot,
          status: "running",
          started_at: new Date().toISOString(),
          created_by: userId,
        })
        .select("id")
        .single();

      if (runInsertError || !runData) {
        throw new Error(`Insert failed: ${runInsertError?.message}`);
      }
      
      pricingRun = runData;
    } catch (insertError: any) {
      // CTO FIX: Rollback status if run creation fails
      await rollbackToPreviousStatus(serviceClient, case_id, previousStatus, "run_insert_failed");
      
      await serviceClient.from("case_timeline_events").insert({
        case_id,
        event_type: "pricing_failed",
        event_data: { error: String(insertError), reason: "run_creation_failed" },
        actor_type: "system",
      });
      
      throw insertError;
    }

    await serviceClient.from("case_timeline_events").insert({
      case_id,
      event_type: "pricing_started",
      event_data: { run_number: runNumber, inputs_summary: summarizeInputs(inputs) },
      related_pricing_run_id: pricingRun.id,
      actor_type: "system",
    });

    // 11. Call quotation-engine
    let engineResponse: any;
    let tariffSources: any[] = [];

    try {
      const engineParams = {
        finalDestination: inputs.finalDestination,
        originPort: inputs.originPort,
        originAirport: inputs.originAirport,
        incoterm: inputs.incoterm,
        containers: inputs.containers,
        cargoWeight: inputs.cargoWeight,
        cargoVolume: inputs.cargoVolume,
        cargoValue: inputs.cargoValue,
        cargoCurrency: inputs.cargoValueCurrency,
        carrier: inputs.carrier,
        transportMode: caseData.request_type?.includes("AIR") ? "aerien" : "maritime",
        cargoDescription: inputs.cargoDescription,
        clientCompany: inputs.clientCompany,
        hsCode: inputs.hsCode,
        articlesDetail: inputs.articlesDetail,
        regimeCode: inputs.regimeCode || undefined,
        freightAmount: inputs.freightCost,
        freightCurrency: inputs.freightCurrency,
        
      };

      const engineUrl = `${supabaseUrl}/functions/v1/quotation-engine`;
      const engineRes = await fetch(engineUrl, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "generate", params: engineParams }),
      });

      if (!engineRes.ok) {
        const errorText = await engineRes.text();
        throw new Error(`quotation-engine error: ${engineRes.status} - ${errorText}`);
      }

      engineResponse = await engineRes.json();
      // Fix CTO: construire tariffSources depuis les lignes (le moteur ne renvoie pas de champ global)
      const rawLines = engineResponse.lines || engineResponse.quotationLines || [];
      const sourceMap = new Map<string, any>();
      for (const line of rawLines) {
        if (line.source?.reference && line.source?.type !== 'TO_CONFIRM') {
          const key = `${line.source.type}_${line.source.reference}`;
          sourceMap.set(key, {
            type: line.source.type,
            reference: line.source.reference,
            table: line.source.table || line.source.type,
            confidence: line.source.confidence,
          });
        }
      }
      tariffSources = Array.from(sourceMap.values());

      // ═══ P5: Package service lines enrichment (mono-lot) ═══
      const packageKey = (inputs.servicePackage || '').trim().toUpperCase();
      if (packageKey && SERVICE_PACKAGES[packageKey]) {
        try {
          const overrides = readOverridesFromFacts(facts || []);
          const effectiveKeys = resolveEffectiveServiceKeys(packageKey, overrides);
          const coveredKeys = inferCoveredServiceKeys(engineResponse.lines || engineResponse.quotationLines || []);
          const missingKeys = effectiveKeys.filter(k => !coveredKeys.has(k));

          if (missingKeys.length > 0) {
            console.log(`[P5] Mono-lot: ${missingKeys.length} package services to enrich: ${missingKeys.join(', ')}`);

            // Build ServiceLineInput — exact same shape as QuotationSheet sends
            const serviceLineInputs = missingKeys.map(sk => ({
              id: crypto.randomUUID(),
              service: sk,
              unit: PACKAGE_SERVICE_DEFAULT_UNITS[sk] || 'forfait',
              quantity: 1,
              currency: 'XOF',
            }));

            const pslUrl = `${supabaseUrl}/functions/v1/price-service-lines`;
            const pslRes = await fetch(pslUrl, {
              method: 'POST',
              headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
              body: JSON.stringify({ case_id, service_lines: serviceLineInputs }),
            });

            if (pslRes.ok) {
              const pslData = await pslRes.json();
              const pricedLines = pslData?.data?.priced_lines || [];
              // Inject into engineResponse.lines so tariffLines picks them up
              const engineLines = engineResponse.lines || engineResponse.quotationLines || [];
              for (const pl of pricedLines) {
                engineLines.push({
                  category: pl.service || pl.id,
                  label: pl.label || pl.service || pl.id,
                  amount: pl.rate ?? 0,
                  currency: pl.currency || 'XOF',
                  type: 'service_package',
                  source: { type: pl.source || 'price-service-lines', reference: 'P5', confidence: pl.confidence ?? 0 },
                  quantity: pl.quantity_used ?? 1,
                  unit: pl.unit_used ?? PACKAGE_SERVICE_DEFAULT_UNITS[pl.service] ?? 'forfait',
                  explanation: pl.explanation || '',
                });
              }
              // Update engineResponse.lines so downstream tariffLines = engineResponse.lines picks them up
              engineResponse.lines = engineLines;
              console.log(`[P5] Mono-lot: merged ${pricedLines.length} priced service lines`);
            } else {
              console.warn(`[P5] price-service-lines failed (${pslRes.status}), continuing with engine lines only`);
            }
          }
        } catch (p5Error) {
          console.warn('[P5] Package enrichment failed, continuing:', p5Error);
        }
      }

    } catch (engineError: any) {
      console.error("Pricing engine error:", engineError);

      // Update run as failed
      await serviceClient
        .from("pricing_runs")
        .update({
          status: "failed",
          error_message: engineError.message,
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
        })
        .eq("id", pricingRun.id);

      // Rollback case to previous status (engine failed, allow retry)
      await rollbackToPreviousStatus(serviceClient, case_id, previousStatus, "engine_failed");

      await serviceClient.from("case_timeline_events").insert({
        case_id,
        event_type: "pricing_failed",
        event_data: { error: engineError.message, run_number: runNumber },
        related_pricing_run_id: pricingRun.id,
        actor_type: "system",
      });

      return new Response(
        JSON.stringify({ 
          error: "Pricing failed", 
          details: engineError.message,
          pricing_run_id: pricingRun.id,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 12. Parse and store results
    const tariffLines = engineResponse.lines || engineResponse.quotationLines || [];
    const engineTotals = engineResponse.totals;
    const incotermUpper = (inputs.incoterm || "").toUpperCase();

    // --- P0 FIX: Agregation correcte HT / TTC ---
    const honoraires_ht  = engineTotals?.honoraires ?? 0;
    const debours        = engineTotals?.debours ?? 0;
    const TVA_RATE       = 0.18;
    const honoraires_tva = Math.round(honoraires_ht * TVA_RATE);
    const honoraires_ttc = honoraires_ht + honoraires_tva;

    const totalHt  = honoraires_ht;
    const totalTtc = debours + honoraires_ttc;
    const currency = engineResponse.currency || "XOF";

    const outputsJson = {
      lines: tariffLines,
      totals: { ht: totalHt, ttc: totalTtc, honoraires_tva: honoraires_tva, currency, dap: engineTotals?.dap, ddp: engineTotals?.ddp, debours: engineTotals?.debours, incoterm_applied: incotermUpper || "N/A" },
      duty_breakdown: engineResponse.duty_breakdown || [],
      metadata: {
        engine_version: engineResponse.version || "v4",
        computed_at: new Date().toISOString(),
        request_type: caseData.request_type,
        duties_regime_code: inputs.regimeCode || null,
      },
      client: {
        email: inputs.clientEmail,
        company: inputs.clientCompany,
      },
      routing: {
        origin: inputs.originPort || inputs.originAirport,
        destination: inputs.finalDestination,
        incoterm: inputs.incoterm,
      },
    };

    const durationMs = Date.now() - startTime;

    // 13. Update pricing_run with results
    await serviceClient
      .from("pricing_runs")
      .update({
        status: "success",
        engine_request: {
          finalDestination: inputs.finalDestination,
          originPort: inputs.originPort,
          containers: inputs.containers,
        },
        engine_response: engineResponse,
        outputs_json: outputsJson,
        tariff_lines: tariffLines,
        total_ht: totalHt,
        total_ttc: totalTtc,
        currency,
        tariff_sources: tariffSources,
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
      })
      .eq("id", pricingRun.id);

    // 14. Transition case to PRICED_DRAFT (skip for finalized cases)
    if (!isFinalized) {
      await serviceClient
        .from("quote_cases")
        .update({ 
          status: "PRICED_DRAFT",
          pricing_runs_count: runNumber,
          last_activity_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", case_id);
    } else {
      // Finalized case: only update pricing_runs_count, no status change
      await serviceClient
        .from("quote_cases")
        .update({ 
          pricing_runs_count: runNumber,
          last_activity_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", case_id);
    }

    await serviceClient.from("case_timeline_events").insert({
      case_id,
      event_type: "pricing_completed",
      event_data: { 
        run_number: runNumber, 
        total_ht: totalHt,
        lines_count: tariffLines.length,
        duration_ms: durationMs,
      },
      related_pricing_run_id: pricingRun.id,
      actor_type: "system",
    });

    if (!isFinalized) {
      await serviceClient.from("case_timeline_events").insert({
        case_id,
        event_type: "status_changed",
        previous_value: "PRICING_RUNNING",
        new_value: "PRICED_DRAFT",
        actor_type: "system",
      });
    }

    console.log(`Pricing run ${runNumber} for case ${case_id} completed in ${durationMs}ms`);

    return new Response(
      JSON.stringify({
        pricing_run_id: pricingRun.id,
        run_number: runNumber,
        total_ht: totalHt,
        total_ttc: totalTtc,
        currency,
        lines_count: tariffLines.length,
        duration_ms: durationMs,
        tariff_sources_count: tariffSources.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in run-pricing:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * CTO FIX: Rollback case status on pricing initialization failure
 * Prevents cases from being stuck in PRICING_RUNNING
 */
async function rollbackToPreviousStatus(
  client: any,
  caseId: string,
  targetStatus: string,
  reason: string
): Promise<void> {
  try {
    await client
      .from("quote_cases")
      .update({ 
        status: targetStatus, 
        updated_at: new Date().toISOString() 
      })
      .eq("id", caseId);

    await client.from("case_timeline_events").insert({
      case_id: caseId,
      event_type: "status_rollback",
      event_data: { reason, target_status: targetStatus },
      actor_type: "system",
    });

    console.log(`Rolled back case ${caseId} to ${targetStatus} due to: ${reason}`);
  } catch (rollbackError) {
    console.error(`Failed to rollback case ${caseId}:`, rollbackError);
  }
}

function buildPricingInputs(facts: any[]): PricingInputs {
  const inputs: PricingInputs = {};

  for (const fact of facts) {
    const value = fact.value_json ?? fact.value_number ?? fact.value_text;

    switch (fact.fact_key) {
      case "routing.origin_port":
        inputs.originPort = String(value);
        break;
      case "routing.origin_airport":
        inputs.originAirport = String(value);
        break;
      case "routing.destination_port":
        inputs.destinationPort = String(value);
        break;
      case "routing.destination_airport":
        inputs.destinationAirport = String(value);
        break;
      case "routing.destination_city":
        inputs.finalDestination = String(value);
        break;
      case "routing.incoterm":
        inputs.incoterm = String(value);
        break;
      case "cargo.containers": {
        // V4.1.5: Defensive parse for double-encoded JSON strings
        let parsedContainers = value;
        if (typeof parsedContainers === "string") {
          try { parsedContainers = JSON.parse(parsedContainers); } catch { parsedContainers = []; }
        }
        inputs.containers = Array.isArray(parsedContainers) ? parsedContainers : [];
        break;
      }
      case "cargo.weight_kg":
        inputs.cargoWeight = Number(value);
        break;
      case "cargo.volume_cbm":
        inputs.cargoVolume = Number(value);
        break;
      case "cargo.value":
        inputs.cargoValue = Number(value);
        break;
      case "cargo.value_currency":
        inputs.cargoValueCurrency = String(value);
        break;
      case "cargo.description":
        inputs.cargoDescription = String(value);
        break;
      case "carrier.name":
        inputs.carrier = String(value);
        break;
      case "contacts.client_email":
        inputs.clientEmail = String(value);
        break;
      case "contacts.client_company":
        inputs.clientCompany = String(value);
        break;
      case "cargo.hs_code":
        inputs.hsCode = String(value);
        break;
      case "cargo.articles_detail": {
        let parsed = value;
        if (typeof parsed === "string") {
          try { parsed = JSON.parse(parsed); } catch { parsed = []; }
        }
        inputs.articlesDetail = Array.isArray(parsed) ? parsed : [];
        break;
      }
      case "customs.regime_code":
        inputs.regimeCode = String(value);
        break;
      case "regulatory.exemption_title":
        inputs.exemptionTitle = String(value);
        break;
      case "cargo.freight_cost": {
        const raw = String(value ?? "").trim();
        const normalized = raw.replace(/\s/g, "").replace(/,/g, ".");
        const n = Number(normalized);
        inputs.freightCost = Number.isFinite(n) ? n : undefined;
        break;
      }
      case "cargo.freight_currency":
        inputs.freightCurrency = String(value);
        break;
      case "service.package":
        inputs.servicePackage = String(value);
        break;
    }
  }

  return inputs;
}

function summarizeInputs(inputs: PricingInputs): string {
  const parts: string[] = [];
  if (inputs.originPort) parts.push(`from ${inputs.originPort}`);
  if (inputs.originAirport) parts.push(`from ${inputs.originAirport}`);
  if (inputs.finalDestination) parts.push(`to ${inputs.finalDestination}`);
  if (inputs.incoterm) parts.push(inputs.incoterm);
  if (inputs.containers?.length) {
    parts.push(`${inputs.containers.map(c => `${c.quantity}x${c.type}`).join(", ")}`);
  }
  return parts.join(" ") || "No routing info";
}

/**
 * P3b.1: Merge lot-specific extracted_facts_json over global facts by key.
 * CTO-corrected: converts values based on valueType (number, json, text).
 */
function mergeFactsForLot(globalFacts: any[], lotExtractedFacts: any[]): any[] {
  const merged = new Map<string, any>();

  for (const f of globalFacts) {
    merged.set(f.fact_key, f);
  }

  for (const lf of lotExtractedFacts || []) {
    if (!lf?.key) continue;

    const valueType = String(lf.valueType || "").toLowerCase();
    const raw = lf.value;

    let value_text: string | null = null;
    let value_number: number | null = null;
    let value_json: any = null;

    if (valueType === "number") {
      const n = Number(raw);
      value_number = Number.isFinite(n) ? n : null;
      value_text = raw != null ? String(raw) : null;
    } else if (valueType === "json") {
      value_json = raw;
      value_text = typeof raw === "string" ? raw : JSON.stringify(raw);
    } else {
      value_text = raw != null ? String(raw) : null;
    }

    merged.set(lf.key, {
      fact_key: lf.key,
      value_text,
      value_number,
      value_json,
      source_type: "lot_override",
      confidence: typeof lf.confidence === "number" ? lf.confidence : 0.8,
    });
  }

  return Array.from(merged.values());
}

/**
 * P3b.1: Resolve service package for a lot based on request_type_hint and incoterm.
 * Aligned with P3a — covers only currently emitted request types.
 * Does NOT replace the global service package registry.
 */
function resolveServicePackageForLot(requestTypeHint: string, incoterm: string): string | undefined {
  const rt = String(requestTypeHint || "").trim().toUpperCase();
  const ic = String(incoterm || "").trim().toUpperCase();
  const isOrigin = ["EXW", "FCA", "FAS"].includes(ic);

  if (rt === "SEA_LCL_IMPORT") return isOrigin ? "LCL_IMPORT_EXW" : "LCL_IMPORT_DAP";
  if (rt === "AIR_LCL_IMPORT" || rt === "AIR_IMPORT") return isOrigin ? "AIR_IMPORT_EXW" : "AIR_IMPORT_DAP";
  if (rt === "SEA_FCL_IMPORT" || rt === "IMPORT_PROJECT_DAP") return isOrigin ? "DAP_PROJECT_IMPORT_EXW" : "DAP_PROJECT_IMPORT";

  return undefined;
}

/**
 * P3b.1: Resolve transport mode for a lot from its request_type_hint.
 */
function resolveTransportModeForLot(requestTypeHint: string): string {
  return String(requestTypeHint || "").toUpperCase().includes("AIR") ? "aerien" : "maritime";
}
