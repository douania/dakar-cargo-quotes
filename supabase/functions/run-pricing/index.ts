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
