/**
 * Phase 7.0.4: run-pricing
 * Executes deterministic pricing via quotation-engine
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  containers?: Array<{ type: string; quantity: number; coc_soc?: string }>;
  cargoWeight?: number;
  cargoVolume?: number;
  cargoValue?: number;
  cargoValueCurrency?: string;
  cargoDescription?: string;
  carrier?: string;
  clientEmail?: string;
  clientCompany?: string;
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

    if (caseData.created_by !== userId && caseData.assigned_to !== userId) {
      return new Response(
        JSON.stringify({ error: "Access denied" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (caseData.status !== "READY_TO_PRICE") {
      return new Response(
        JSON.stringify({ 
          error: "Case not ready for pricing",
          current_status: caseData.status,
          required_status: "READY_TO_PRICE"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Transition to PRICING_RUNNING
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
      previous_value: "READY_TO_PRICE",
      new_value: "PRICING_RUNNING",
      actor_type: "system",
    });

    // 5. Load all current facts
    const { data: facts, error: factsError } = await serviceClient
      .from("quote_facts")
      .select("*")
      .eq("case_id", case_id)
      .eq("is_current", true);

    if (factsError) {
      throw new Error(`Failed to load facts: ${factsError.message}`);
    }

    // 6. Build facts snapshot (frozen copy)
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

    // 7. Build inputs_json from facts
    const inputs = buildPricingInputs(facts || []);

    // 8. Get next run number
    const { count: existingRuns } = await serviceClient
      .from("pricing_runs")
      .select("*", { count: "exact", head: true })
      .eq("case_id", case_id);

    const runNumber = (existingRuns || 0) + 1;

    // 9. Create pricing_run record
    const { data: pricingRun, error: runInsertError } = await serviceClient
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

    if (runInsertError || !pricingRun) {
      throw new Error(`Failed to create pricing run: ${runInsertError?.message}`);
    }

    await serviceClient.from("case_timeline_events").insert({
      case_id,
      event_type: "pricing_started",
      event_data: { run_number: runNumber, inputs_summary: summarizeInputs(inputs) },
      related_pricing_run_id: pricingRun.id,
      actor_type: "system",
    });

    // 10. Call quotation-engine
    let engineResponse: any;
    let tariffSources: any[] = [];

    try {
      const engineRequest = {
        finalDestination: inputs.finalDestination,
        originPort: inputs.originPort,
        originAirport: inputs.originAirport,
        incoterm: inputs.incoterm,
        containers: inputs.containers,
        cargoWeight: inputs.cargoWeight,
        cargoVolume: inputs.cargoVolume,
        cargoValue: inputs.cargoValue,
        carrier: inputs.carrier,
        requestType: caseData.request_type,
      };

      const engineUrl = `${supabaseUrl}/functions/v1/quotation-engine`;
      const engineRes = await fetch(engineUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${supabaseServiceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(engineRequest),
      });

      if (!engineRes.ok) {
        const errorText = await engineRes.text();
        throw new Error(`quotation-engine error: ${engineRes.status} - ${errorText}`);
      }

      engineResponse = await engineRes.json();
      tariffSources = engineResponse.sources || engineResponse.tariffSources || [];

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

      // Transition case back
      await serviceClient
        .from("quote_cases")
        .update({ 
          status: "FACTS_PARTIAL",
          updated_at: new Date().toISOString(),
        })
        .eq("id", case_id);

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

    // 11. Parse and store results
    const tariffLines = engineResponse.lines || engineResponse.quotationLines || [];
    const totalHt = engineResponse.totalHt || engineResponse.total_ht || 
                    tariffLines.reduce((sum: number, l: any) => sum + (l.amount || l.total || 0), 0);
    const totalTtc = engineResponse.totalTtc || engineResponse.total_ttc || totalHt;
    const currency = engineResponse.currency || "XOF";

    const outputsJson = {
      lines: tariffLines,
      totals: { ht: totalHt, ttc: totalTtc, currency },
      metadata: {
        engine_version: engineResponse.version || "v4",
        computed_at: new Date().toISOString(),
        request_type: caseData.request_type,
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

    // 12. Update pricing_run with results
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

    // 13. Transition case to PRICED_DRAFT
    await serviceClient
      .from("quote_cases")
      .update({ 
        status: "PRICED_DRAFT",
        pricing_runs_count: runNumber,
        last_activity_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", case_id);

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

    await serviceClient.from("case_timeline_events").insert({
      case_id,
      event_type: "status_changed",
      previous_value: "PRICING_RUNNING",
      new_value: "PRICED_DRAFT",
      actor_type: "system",
    });

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

function buildPricingInputs(facts: any[]): PricingInputs {
  const inputs: PricingInputs = {};

  for (const fact of facts) {
    const value = fact.value_text || fact.value_number || fact.value_json;

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
      case "cargo.containers":
        inputs.containers = Array.isArray(value) ? value : [];
        break;
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
