import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { callAI, parseAIResponse } from "../_shared/ai-client.ts";
import { extractAndParseJSON } from "../_shared/json-parser.ts";

// ── System prompt: strict business-scope detection ──
const SYSTEM_PROMPT = `Tu es un expert en logistique internationale spécialisé dans le transit au port de Dakar (Sénégal).

Ton rôle : analyser un email (et son contexte de thread) pour déterminer le SCOPE RÉEL de la mission logistique demandée à SODATRA (transitaire à Dakar).

RÈGLE FONDAMENTALE :
"maritime import" ≠ "fret maritime à coter".
Si le texte indique que le fret principal est déjà arrangé/payé par une autre partie, freight_scope DOIT être false.

Signaux clés à détecter :
- "CIF Dakar", "CFR Dakar", "CIP Dakar" → fret déjà inclus, freight_scope = false
- "customer paying up to port Dakar" → freight_scope = false
- "shipment arriving in Dakar" → probablement freight_scope = false (à confirmer)
- "FOB [origine]" → fret à coter par SODATRA, freight_scope = true
- "document transfer", "remise documentaire" → document_scope = true
- "final delivery [pays tiers]", "transit Mali/Burkina/etc." → transit_scope = true
- demande de dédouanement, handling import → customs_scope = true

Retourne UNIQUEMENT un JSON strict avec exactement cette structure :
{
  "scope": {
    "shipment_type": "import" | "export" | "transit" | "unknown",
    "freight_scope": true | false | null,
    "customs_scope": true | false | null,
    "transit_scope": true | false | null,
    "document_scope": true | false | null,
    "confidence": "high" | "medium" | "low",
    "signals": ["signal 1", "signal 2"]
  },
  "reasoning": {
    "summary": "une phrase résumant la compréhension du dossier",
    "services_expected": ["import_handling", "customs_clearance"],
    "blocking_assumptions": ["hypothèses à ne pas faire"],
    "questions_to_confirm": ["points à confirmer"],
    "confidence": "high" | "medium" | "low"
  }
}

Sois prudent : en cas de doute, mets null et confidence = "low".
Ne surévalue jamais la confiance.
Réponds UNIQUEMENT avec le JSON, sans texte autour.`;

// ── Max chars for previous context emails ──
const PREV_EMAIL_MAX_CHARS = 500;
const MAX_CONTEXT_EMAILS = 4;

serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  try {
    const { case_id } = await req.json();
    if (!case_id) return errorResponse("case_id is required", 400);

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

    // 1. Resolve thread from quote_case
    const { data: quoteCase, error: caseErr } = await userClient
      .from("quote_cases")
      .select("id, thread_id")
      .eq("id", case_id)
      .maybeSingle();

    if (caseErr || !quoteCase?.thread_id) {
      return errorResponse("Case not found or no thread linked", 404);
    }

    // 2. Fetch emails from thread (most recent first)
    const { data: emails, error: emailsErr } = await userClient
      .from("emails")
      .select("id, subject, body_text, sent_at")
      .eq("thread_ref", quoteCase.thread_id)
      .order("sent_at", { ascending: false })
      .limit(5);

    if (emailsErr || !emails?.length) {
      return errorResponse("No emails found for this thread", 404);
    }

    const latestEmail = emails[0];
    const latestEmailId = latestEmail.id;

    // 3. Dual idempotence check — both events for this email
    const { data: existingEvents } = await serviceClient
      .from("case_timeline_events")
      .select("id, event_type, event_data")
      .eq("case_id", case_id)
      .in("event_type", ["service_scope_v1", "case_reasoning_v1"])
      .eq("related_email_id", latestEmailId);

    const existingTypes = new Set(
      (existingEvents || []).map((e: { event_type: string }) => e.event_type)
    );

    if (existingTypes.has("service_scope_v1") && existingTypes.has("case_reasoning_v1")) {
      // Both exist → full idempotent return
      const scopeEvent = existingEvents!.find(
        (e: { event_type: string }) => e.event_type === "service_scope_v1"
      );
      const reasoningEvent = existingEvents!.find(
        (e: { event_type: string }) => e.event_type === "case_reasoning_v1"
      );
      return jsonResponse({
        ok: true,
        idempotent: true,
        case_id,
        scope: scopeEvent?.event_data ?? null,
        reasoning: reasoningEvent?.event_data ?? null,
      });
    }

    // 4. Build structured prompt context
    const latestBlock = [
      `[LATEST_EMAIL]`,
      `Sujet: ${latestEmail.subject || "(sans sujet)"}`,
      `Corps:`,
      latestEmail.body_text || "(corps vide)",
    ].join("\n");

    const previousEmails = emails.slice(1, 1 + MAX_CONTEXT_EMAILS);
    let previousBlock = "";
    if (previousEmails.length > 0) {
      const lines = previousEmails.map((e, i) => {
        const body = (e.body_text || "").slice(0, PREV_EMAIL_MAX_CHARS);
        return `Email ${i + 2}: Sujet: ${e.subject || "(sans sujet)"} | Corps: ${body}`;
      });
      previousBlock = `\n\n[PREVIOUS_CONTEXT]\n${lines.join("\n")}`;
    }

    const userPrompt = `${latestBlock}${previousBlock}\n\nPriorité : fonder l'analyse sur LATEST_EMAIL. Utiliser PREVIOUS_CONTEXT uniquement pour clarifier des ambiguïtés.`;

    // 5. Single AI call
    const aiResponse = await callAI(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { model: "google/gemini-2.5-flash", temperature: 0.1 }
    );

    const rawText = await parseAIResponse(aiResponse);

    const modelMeta = { model: "google/gemini-2.5-flash", version: "v1" };

    let parsed: { scope: Record<string, unknown>; reasoning: Record<string, unknown> };
    try {
      parsed = extractAndParseJSON<typeof parsed>(rawText, {
        label: "service-scope",
        maxLogChars: 800,
        expectRoot: "object",
      });
    } catch {
      console.warn("[analyze-service-scope] AI JSON parse failed for case:", case_id);
      return jsonResponse({ ok: false, error: "AI_JSON_PARSE_FAILED" }, 200);
    }

    // Validate structure minimally
    if (!parsed.scope || !parsed.reasoning) {
      console.warn("[analyze-service-scope] Missing scope or reasoning in AI output");
      return jsonResponse({ ok: false, error: "AI_OUTPUT_INCOMPLETE" }, 200);
    }

    // 6. Insert only missing events
    const created: string[] = [];
    const scopeDedupeKey = `service_scope_v1:${case_id}:${latestEmailId}`;
    const reasoningDedupeKey = `case_reasoning_v1:${case_id}:${latestEmailId}`;

    if (!existingTypes.has("service_scope_v1")) {
      const { error: scopeErr } = await serviceClient
        .from("case_timeline_events")
        .insert({
          case_id,
          event_type: "service_scope_v1",
          related_email_id: latestEmailId,
          actor_type: "ai",
          event_data: {
            ...parsed.scope,
            dedupe_key: scopeDedupeKey,
            model_meta: modelMeta,
          },
        });

      if (scopeErr) {
        console.error("[analyze-service-scope] scope insert failed:", scopeErr.message);
        return errorResponse("Failed to insert service_scope_v1", 500);
      }
      created.push("service_scope_v1");
    }

    if (!existingTypes.has("case_reasoning_v1")) {
      const { error: reasoningErr } = await serviceClient
        .from("case_timeline_events")
        .insert({
          case_id,
          event_type: "case_reasoning_v1",
          related_email_id: latestEmailId,
          actor_type: "ai",
          event_data: {
            ...parsed.reasoning,
            dedupe_key: reasoningDedupeKey,
            model_meta: modelMeta,
          },
        });

      if (reasoningErr) {
        console.error("[analyze-service-scope] reasoning insert failed:", reasoningErr.message);
        return errorResponse("Failed to insert case_reasoning_v1", 500);
      }
      created.push("case_reasoning_v1");
    }

    return jsonResponse({
      ok: true,
      idempotent: false,
      case_id,
      scope: parsed.scope,
      reasoning: parsed.reasoning,
      created,
    });
  } catch (err) {
    console.error("[analyze-service-scope] Unexpected error:", (err as Error).message);
    return errorResponse("Internal server error", 500);
  }
});
