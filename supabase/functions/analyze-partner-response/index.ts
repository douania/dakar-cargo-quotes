// Phase EQ1 — Analyze partner response email and extract proposed facts
// SECURITY: requireUser is mandatory because verify_jwt=false
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { callAI, parseAIResponse } from "../_shared/ai-client.ts";
import { extractAndParseJSON } from "../_shared/json-parser.ts";

// Purpose-aware extraction prompts
const PURPOSE_PROMPTS: Record<string, string> = {
  origin_charges: `Extrais les frais d'origine (origin charges) mentionnés. Cherche :
- Frais de manutention / handling
- Frais de documentation / doc fees
- Pick-up / collecte
- Frais de dédouanement export
- Autres frais locaux à l'origine
Pour chaque montant, donne le fact_key approprié (ex: "cargo.origin_charges", "cargo.pickup_cost").`,

  freight_rate: `Extrais les tarifs de fret mentionnés. Cherche :
- Fret maritime / aérien / routier
- Surcharges (BAF, CAF, etc.)
- Transit time
- Validité de l'offre
Pour chaque montant, donne le fact_key approprié (ex: "cargo.freight_cost", "routing.transit_time_days").`,

  air_tariff: `Extrais les tarifs aériens mentionnés. Cherche :
- Tarif au kg
- Minimum de taxation
- Surcharges fuel / sécurité
- Transit time
- Validité
Pour chaque montant, donne le fact_key approprié (ex: "cargo.freight_cost", "cargo.freight_rate_per_kg").`,

  pre_carriage: `Extrais les coûts de pré-acheminement. Cherche :
- Transport terrestre (camion, rail)
- Frais de chargement
- Distance / itinéraire
Pour chaque montant, donne le fact_key approprié (ex: "cargo.pre_carriage_cost").`,

  general: `Extrais tous les faits métier exploitables : montants, dates, conditions, délais, incoterms, restrictions.`,
};

const SYSTEM_PROMPT = `Tu es un analyste de réponses partenaires/fournisseurs pour un transitaire logistique (SODATRA, Dakar).
Tu analyses la réponse d'un correspondant/agent/partenaire et extrais les faits exploitables pour construire une cotation.

Retourne un JSON strict avec :
- proposed_facts: tableau d'objets avec :
  - fact_key (string, ex: "cargo.freight_cost", "cargo.origin_charges")
  - value_text (string | null)  
  - value_number (number | null)
  - currency (string | null, ex: "EUR", "USD", "XOF")
  - confidence (nombre entre 0 et 1)
  - source_excerpt (string courte : extrait verbatim de l'email source)
- summary_fr: string (résumé en une phrase de la réponse du partenaire)

Réponds UNIQUEMENT avec le JSON, sans texte autour.`;

serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  try {
    const { case_id, request_id, email_id } = await req.json();
    if (!case_id || !request_id || !email_id) {
      return errorResponse("case_id, request_id, email_id are required", 400);
    }

    const authHeader = req.headers.get("Authorization")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // 1. Load request
    const { data: extReq, error: reqErr } = await userClient
      .from("external_quote_requests")
      .select("id, purpose, partner_name, case_id")
      .eq("id", request_id)
      .eq("case_id", case_id)
      .maybeSingle();

    if (reqErr || !extReq) return errorResponse("External request not found", 404);

    // 2. Load email
    const { data: email, error: emailErr } = await userClient
      .from("emails")
      .select("id, body_text, subject, from_address")
      .eq("id", email_id)
      .maybeSingle();

    if (emailErr || !email) return errorResponse("Email not found", 404);

    // 3. Idempotence: ON CONFLICT returns nothing, then we fetch existing
    const { data: inserted, error: insertErr } = await serviceClient
      .from("external_quote_responses")
      .insert({
        request_id,
        case_id,
        source_email_id: email_id,
        raw_excerpt: (email.body_text || "").slice(0, 2000),
        status: "received",
      })
      .select("id")
      .maybeSingle();

    let responseId: string;

    if (insertErr?.code === "23505") {
      // Unique constraint violation — already exists
      const { data: existing } = await serviceClient
        .from("external_quote_responses")
        .select("id, status")
        .eq("request_id", request_id)
        .eq("source_email_id", email_id)
        .maybeSingle();

      if (!existing) return errorResponse("Response conflict but not found", 500);

      if (existing.status === "analyzed" || existing.status === "reviewed") {
        const { data: existingFacts } = await serviceClient
          .from("external_quote_response_facts")
          .select("*")
          .eq("response_id", existing.id);

        return jsonResponse({
          ok: true,
          idempotent: true,
          response_id: existing.id,
          facts: existingFacts || [],
        });
      }
      responseId = existing.id;
    } else if (insertErr) {
      console.error("[analyze-partner-response] Insert response failed:", insertErr.message);
      return errorResponse("Failed to create response record", 500);
    } else {
      responseId = inserted!.id;
    }

    // Fix 5: Anti-duplication guard — if facts already exist for this responseId, return idempotent
    const { data: existingFactsForResponse } = await serviceClient
      .from("external_quote_response_facts")
      .select("id")
      .eq("response_id", responseId)
      .limit(1);

    if (existingFactsForResponse && existingFactsForResponse.length > 0) {
      const { data: allExistingFacts } = await serviceClient
        .from("external_quote_response_facts")
        .select("*")
        .eq("response_id", responseId);

      return jsonResponse({
        ok: true,
        idempotent: true,
        response_id: responseId,
        facts: allExistingFacts || [],
      });
    }

    // 4. Update request status → response_received (if still sent)
    await serviceClient
      .from("external_quote_requests")
      .update({ status: "response_received" })
      .eq("id", request_id)
      .in("status", ["sent", "draft"]);

    // 5. Call AI with purpose-aware prompt
    const purposeGuidance = PURPOSE_PROMPTS[extReq.purpose] || PURPOSE_PROMPTS.general;
    const emailContent = `Partenaire: ${extReq.partner_name}
Objet de la demande: ${extReq.purpose}
Sujet email: ${email.subject || "(sans sujet)"}
De: ${email.from_address}

${purposeGuidance}

--- EMAIL DU PARTENAIRE ---
${email.body_text || "(corps vide)"}`;

    const aiResponse = await callAI(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: emailContent },
      ],
      { model: "google/gemini-2.5-flash", temperature: 0.1 }
    );

    const rawText = await parseAIResponse(aiResponse);

    let parsed: Record<string, unknown>;
    try {
      parsed = extractAndParseJSON<Record<string, unknown>>(rawText, {
        label: "partner-response-analysis",
        maxLogChars: 500,
        expectRoot: "object",
      });
    } catch {
      console.warn("[analyze-partner-response] AI JSON parse failed for email:", email_id);
      return jsonResponse({ ok: false, error: "AI_JSON_PARSE_FAILED" }, 200);
    }

    // 6. Normalize and insert proposed facts
    const rawFacts = Array.isArray(parsed["proposed_facts"]) ? parsed["proposed_facts"] : [];
    const validFacts = rawFacts
      .filter((f: unknown): f is Record<string, unknown> => {
        if (typeof f !== "object" || f === null) return false;
        const obj = f as Record<string, unknown>;
        return typeof obj["fact_key"] === "string" && obj["fact_key"].length > 0;
      })
      .map((f: Record<string, unknown>) => ({
        response_id: responseId,
        request_id,
        case_id,
        fact_key: String(f["fact_key"]),
        proposed_value_text: typeof f["value_text"] === "string" ? f["value_text"] : null,
        proposed_value_number: typeof f["value_number"] === "number" ? f["value_number"] : null,
        currency: typeof f["currency"] === "string" ? f["currency"] : null,
        confidence: typeof f["confidence"] === "number" ? Math.max(0, Math.min(1, f["confidence"])) : 0.7,
        source_excerpt: typeof f["source_excerpt"] === "string" ? f["source_excerpt"].slice(0, 500) : null,
        validation_status: "proposed",
      }));

    if (validFacts.length > 0) {
      const { error: factsErr } = await serviceClient
        .from("external_quote_response_facts")
        .insert(validFacts);

      if (factsErr) {
        console.error("[analyze-partner-response] Facts insert failed:", factsErr.message);
      }
    }

    // 7. Update response status → analyzed
    await serviceClient
      .from("external_quote_responses")
      .update({ status: "analyzed", analyzed_at: new Date().toISOString() })
      .eq("id", responseId);

    // 8. Update request status → response_analyzed
    await serviceClient
      .from("external_quote_requests")
      .update({ status: "response_analyzed" })
      .eq("id", request_id)
      .in("status", ["response_received", "sent", "draft"]);

    // 9. Timeline events
    const summaryFr = typeof parsed["summary_fr"] === "string" ? parsed["summary_fr"] : "Réponse partenaire analysée";

    await serviceClient.from("case_timeline_events").insert({
      case_id,
      event_type: "external_response_analyzed",
      related_email_id: email_id,
      actor_type: "ai",
      new_value: summaryFr,
      event_data: {
        request_id,
        response_id: responseId,
        partner_name: extReq.partner_name,
        purpose: extReq.purpose,
        facts_count: validFacts.length,
      },
    });

    // 10. Manual action for review
    const actionDedupeKey = `partner_review:${responseId}`;
    const { data: existingActions } = await serviceClient
      .from("case_timeline_events")
      .select("event_data")
      .eq("case_id", case_id)
      .eq("event_type", "manual_action")
      .limit(100);

    const existingKeys = new Set(
      (existingActions ?? [])
        .map((a) => (a.event_data as Record<string, unknown> | null)?.["dedupe_key"])
        .filter((k): k is string => typeof k === "string")
    );

    if (!existingKeys.has(actionDedupeKey)) {
      await serviceClient.from("case_timeline_events").insert({
        case_id,
        event_type: "manual_action",
        related_email_id: email_id,
        actor_type: "ai",
        event_data: {
          dedupe_key: actionDedupeKey,
          action_code: "REVIEW_PARTNER_RESPONSE",
          title_fr: "Valider les faits du partenaire",
          description_fr: `${validFacts.length} fait(s) proposé(s) par ${extReq.partner_name}`,
          status: "open",
        },
      });
    }

    return jsonResponse({
      ok: true,
      idempotent: false,
      response_id: responseId,
      facts_count: validFacts.length,
      summary: summaryFr,
      facts: validFacts,
    });
  } catch (err) {
    console.error("[analyze-partner-response] Unexpected error:", (err as Error).message);
    return errorResponse("Internal server error", 500);
  }
});
