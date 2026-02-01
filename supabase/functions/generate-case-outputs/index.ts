/**
 * Phase 7.0.5: generate-case-outputs
 * Generates draft email + PDF from pricing run
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

interface GenerateOutputsRequest {
  case_id: string;
  pricing_run_id?: string;
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
    const { case_id, pricing_run_id }: GenerateOutputsRequest = await req.json();

    if (!case_id) {
      return new Response(
        JSON.stringify({ error: "case_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Load case and verify ownership + status
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

    if (caseData.status !== "PRICED_DRAFT") {
      return new Response(
        JSON.stringify({ 
          error: "Case not ready for output generation",
          current_status: caseData.status,
          required_status: "PRICED_DRAFT"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Load pricing run (latest or specified)
    let pricingRunQuery = serviceClient
      .from("pricing_runs")
      .select("*")
      .eq("case_id", case_id)
      .eq("status", "success");

    if (pricing_run_id) {
      pricingRunQuery = pricingRunQuery.eq("id", pricing_run_id);
    } else {
      pricingRunQuery = pricingRunQuery.order("run_number", { ascending: false }).limit(1);
    }

    const { data: pricingRuns, error: runError } = await pricingRunQuery;

    if (runError || !pricingRuns || pricingRuns.length === 0) {
      return new Response(
        JSON.stringify({ error: "No successful pricing run found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const pricingRun = pricingRuns[0];
    const outputsJson = pricingRun.outputs_json;

    if (!outputsJson) {
      return new Response(
        JSON.stringify({ error: "Pricing run has no outputs" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Load facts for additional context
    const { data: facts } = await serviceClient
      .from("quote_facts")
      .select("fact_key, value_text, value_number, value_json")
      .eq("case_id", case_id)
      .eq("is_current", true);

    const factsMap = (facts || []).reduce((acc, f) => {
      acc[f.fact_key] = f.value_text || f.value_number || f.value_json;
      return acc;
    }, {} as Record<string, any>);

    // 6. Load original email for context
    const { data: emails } = await serviceClient
      .from("emails")
      .select("id, from_address, subject, body_text")
      .eq("thread_ref", caseData.thread_id)
      .eq("is_quotation_request", true)
      .order("sent_at", { ascending: true })
      .limit(1);

    const originalEmail = emails?.[0];

    // 7. Generate draft email
    let draftEmailBody = "";
    let draftEmailSubject = "";

    if (lovableApiKey) {
      const emailResult = await generateEmailWithAI(
        outputsJson,
        factsMap,
        originalEmail,
        caseData.email_threads?.subject_normalized || "",
        lovableApiKey
      );
      draftEmailBody = emailResult.body;
      draftEmailSubject = emailResult.subject;
    } else {
      // Fallback to template
      const result = generateEmailTemplate(outputsJson, factsMap, originalEmail);
      draftEmailBody = result.body;
      draftEmailSubject = result.subject;
    }

    // 8. Store draft in case (as JSON field - we could also use email_drafts)
    const draftEmail = {
      subject: draftEmailSubject,
      to: factsMap["contacts.client_email"] || originalEmail?.from_address,
      body: draftEmailBody,
      generated_at: new Date().toISOString(),
      pricing_run_id: pricingRun.id,
    };

    // 9. Generate PDF by calling existing generate-quotation-pdf
    let pdfUrl: string | null = null;
    let pdfDocumentId: string | null = null;

    try {
      // Build GeneratedSnapshot compatible structure
      const snapshot = {
        quotation_ref: `QC-${case_id.slice(0, 8).toUpperCase()}`,
        generated_at: new Date().toISOString(),
        status: "generated",
        version: pricingRun.run_number,
        client: {
          name: factsMap["contacts.client_email"]?.split("@")[0] || "Client",
          company: factsMap["contacts.client_company"] || "",
          email: factsMap["contacts.client_email"] || "",
        },
        routing: outputsJson.routing || {
          origin: factsMap["routing.origin_port"] || factsMap["routing.origin_airport"],
          destination: factsMap["routing.destination_city"],
          incoterm: factsMap["routing.incoterm"],
        },
        cargo_lines: (outputsJson.lines || []).filter((l: any) => l.type === "cargo").map((l: any, i: number) => ({
          id: `cargo-${i}`,
          description: l.description || l.service,
          cargo_type: caseData.request_type?.includes("AIR") ? "airfreight" : "container",
          origin: factsMap["routing.origin_port"] || factsMap["routing.origin_airport"],
        })),
        service_lines: (outputsJson.lines || []).map((l: any, i: number) => ({
          id: `svc-${i}`,
          service: l.service || l.code || `Service ${i + 1}`,
          description: l.description || "",
          unit: l.unit || "forfait",
          quantity: l.quantity || 1,
          rate: l.rate || l.amount || 0,
          currency: l.currency || outputsJson.totals?.currency || "XOF",
        })),
        totals: {
          total_ht: outputsJson.totals?.ht || pricingRun.total_ht || 0,
          total_ttc: outputsJson.totals?.ttc || pricingRun.total_ttc || 0,
          currency: outputsJson.totals?.currency || "XOF",
        },
        regulatory_info: {},
      };

      // For now, we skip actual PDF generation - would need quotation_history record
      // This can be enhanced in Phase 7.1 to fully integrate with generate-quotation-pdf
      console.log("PDF generation skipped - requires quotation_history integration");

    } catch (pdfError) {
      console.error("PDF generation error:", pdfError);
      // Continue without PDF - not blocking
    }

    // 10. Update case with draft info and transition to HUMAN_REVIEW
    await serviceClient
      .from("quote_cases")
      .update({ 
        status: "HUMAN_REVIEW",
        last_activity_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", case_id);

    // Log timeline events
    await serviceClient.from("case_timeline_events").insert({
      case_id,
      event_type: "output_generated",
      event_data: { 
        draft_email_subject: draftEmailSubject,
        has_pdf: !!pdfUrl,
        pricing_run_id: pricingRun.id,
      },
      related_pricing_run_id: pricingRun.id,
      actor_type: "ai",
    });

    await serviceClient.from("case_timeline_events").insert({
      case_id,
      event_type: "status_changed",
      previous_value: "PRICED_DRAFT",
      new_value: "HUMAN_REVIEW",
      actor_type: "system",
    });

    console.log(`Generated outputs for case ${case_id}`);

    return new Response(
      JSON.stringify({
        case_id,
        new_status: "HUMAN_REVIEW",
        draft_email: draftEmail,
        pdf_url: pdfUrl,
        pdf_document_id: pdfDocumentId,
        pricing_run_id: pricingRun.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in generate-case-outputs:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function generateEmailWithAI(
  outputsJson: any,
  factsMap: Record<string, any>,
  originalEmail: any,
  threadSubject: string,
  apiKey: string
): Promise<{ subject: string; body: string }> {
  const systemPrompt = `You are a professional freight forwarding quotation specialist at SODATRA.
Generate a professional quotation email response in the same language as the original request.

CRITICAL RULES:
1. Use ONLY the amounts from the provided pricing data - NEVER invent numbers
2. Keep the tone professional but warm
3. Include all line items from the pricing
4. Add standard validity (15 days) and payment terms
5. Do NOT mention any attachments unless explicitly instructed
6. Sign as "L'équipe SODATRA" or "SODATRA Team"

Output format:
{
  "subject": "Re: <original subject>",
  "body": "<email body with proper formatting>"
}`;

  const userPrompt = `Generate quotation email response.

Original request from: ${originalEmail?.from_address || factsMap["contacts.client_email"]}
Original subject: ${originalEmail?.subject || threadSubject}

Pricing data (USE THESE EXACT AMOUNTS):
${JSON.stringify(outputsJson, null, 2)}

Route: ${factsMap["routing.origin_port"] || factsMap["routing.origin_airport"]} → ${factsMap["routing.destination_city"]}
Incoterm: ${factsMap["routing.incoterm"] || "N/A"}`;

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
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      throw new Error(`AI error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        subject: parsed.subject || `Re: ${threadSubject}`,
        body: parsed.body || "",
      };
    }

    return generateEmailTemplate(outputsJson, factsMap, originalEmail);
  } catch (error) {
    console.error("AI email generation error:", error);
    return generateEmailTemplate(outputsJson, factsMap, originalEmail);
  }
}

function generateEmailTemplate(
  outputsJson: any,
  factsMap: Record<string, any>,
  originalEmail: any
): { subject: string; body: string } {
  const lines = outputsJson.lines || [];
  const totals = outputsJson.totals || {};
  const routing = outputsJson.routing || {};

  const clientName = factsMap["contacts.client_email"]?.split("@")[0] || "Client";
  const origin = routing.origin || factsMap["routing.origin_port"] || factsMap["routing.origin_airport"] || "Origin";
  const destination = routing.destination || factsMap["routing.destination_city"] || "Destination";
  const incoterm = routing.incoterm || factsMap["routing.incoterm"] || "";

  const linesText = lines
    .map((l: any) => `- ${l.service || l.description}: ${(l.amount || l.rate || 0).toLocaleString()} ${l.currency || totals.currency || "XOF"}`)
    .join("\n");

  const body = `Dear ${clientName},

Thank you for your enquiry. Please find below our quotation for your shipment from ${origin} to ${destination}${incoterm ? ` (${incoterm})` : ""}:

--- QUOTATION ---
${linesText}

TOTAL: ${(totals.ht || 0).toLocaleString()} ${totals.currency || "XOF"} HT

--- CONDITIONS ---
- This quotation is valid for 15 days
- Payment terms: As per agreement
- All duties and taxes extra, if applicable

We remain at your disposal for any questions.

Best regards,
L'équipe SODATRA
---
SODATRA - Transit & Logistics
Port Autonome de Dakar`;

  return {
    subject: `Re: ${originalEmail?.subject || "Quotation Request"}`,
    body,
  };
}
