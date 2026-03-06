import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { callAI, parseAIResponse } from "../_shared/ai-client.ts";
import { extractAndParseJSON } from "../_shared/json-parser.ts";

const INTENT_TYPES = [
  "new_quote_request",
  "provide_missing_info",
  "change_instructions",
  "accept_quote",
  "reject_quote",
  "follow_up",
  "send_document",
  "opportunity_check",
  "general_inquiry",
  "other",
] as const;

// Phase 16: Intents that block pricing
const PRICING_BLOCKED_INTENTS = new Set([
  "opportunity_check",
  "general_inquiry",
  "send_document",
]);

const SYSTEM_PROMPT = `Tu es un classificateur d'intentions pour des emails de transit/logistique.
Analyse l'email et retourne un JSON strict avec ces champs :
- intent_type: une valeur parmi ${INTENT_TYPES.join(", ")}
- risk_level: "low" | "medium" | "high"
- confidence: nombre entre 0 et 1
- case_updates: tableau de strings décrivant les mises à jour potentielles du dossier
- open_questions: tableau de strings avec les questions non résolues
- reply_recommended: boolean indiquant si une réponse est recommandée
- pricing_gate: boolean — true si le pricing est autorisé, false si bloqué
- reasoning: string — explication courte de la classification

Règles de classification :
- "new_quote_request" : le client demande explicitement un devis, une cotation, un prix
- "opportunity_check" : demande commerciale qui n'est PAS une cotation (contacter un réceptionnaire, organiser une remise documentaire HBL, demander un suivi, etc.)
- "general_inquiry" : question générale sans demande d'action commerciale spécifique
- "send_document" : le client envoie uniquement des documents (PI, BL, etc.) sans demande de prix
- "provide_missing_info" : réponse à une question posée, complément d'information
- pricing_gate = true UNIQUEMENT pour : new_quote_request, provide_missing_info, change_instructions, accept_quote
- pricing_gate = false pour : opportunity_check, general_inquiry, send_document, follow_up, reject_quote, other

Réponds UNIQUEMENT avec le JSON, sans texte autour.`;

serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  // Auth
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  try {
    const { email_id } = await req.json();
    if (!email_id) return errorResponse("email_id is required", 400);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing Authorization header", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // userClient for RLS-respecting reads
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    // serviceClient for system writes
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // 1. Fetch email
    const { data: email, error: emailErr } = await userClient
      .from("emails")
      .select("id, thread_ref, body_text, subject")
      .eq("id", email_id)
      .maybeSingle();

    if (emailErr || !email) {
      return errorResponse("Email not found", 404);
    }

    // 2. Resolve thread
    if (!email.thread_ref) {
      return errorResponse("Email has no thread_ref", 400);
    }

    const { data: thread, error: threadErr } = await userClient
      .from("email_threads")
      .select("id")
      .eq("id", email.thread_ref)
      .maybeSingle();

    if (threadErr || !thread) {
      return errorResponse("Thread not found", 404);
    }

    const thread_id = thread.id;

    // 3. Find quote_case
    const { data: quoteCase, error: caseErr } = await userClient
      .from("quote_cases")
      .select("id")
      .eq("thread_id", thread_id)
      .maybeSingle();

    if (caseErr || !quoteCase) {
      return errorResponse("No quote_case linked to this thread", 404);
    }

    const case_id = quoteCase.id;

    // 4. Idempotence check
    const { data: existing } = await serviceClient
      .from("case_timeline_events")
      .select("id, event_data")
      .eq("case_id", case_id)
      .eq("event_type", "thread_intent_v1")
      .eq("related_email_id", email_id)
      .maybeSingle();

    if (existing) {
      const intentData = existing.event_data as Record<string, unknown> | null;
      return jsonResponse({
        ok: true,
        idempotent: true,
        intent: intentData ? (intentData["intent"] as unknown) ?? null : null,
        confidence: intentData ? (intentData["confidence"] as unknown) ?? null : null,
      });
    }

    // 5. Call AI
    const emailContent = `Sujet: ${email.subject || "(sans sujet)"}\n\n${email.body_text || "(corps vide)"}`;

    const aiResponse = await callAI(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: emailContent },
      ],
      { model: "google/gemini-2.5-flash", temperature: 0.1 }
    );

    const rawText = await parseAIResponse(aiResponse);

    // 6. Parse JSON
    let parsed: Record<string, unknown>;
    try {
      parsed = extractAndParseJSON<Record<string, unknown>>(rawText, {
        label: "thread-intent",
        maxLogChars: 500,
        expectRoot: "object",
      });
    } catch {
      console.warn("[analyze-thread-event] AI JSON parse failed for email:", email_id);
      return jsonResponse({ ok: false, error: "AI_JSON_PARSE_FAILED" }, 200);
    }

    const intentType = typeof parsed["intent_type"] === "string" ? parsed["intent_type"] : "other";
    const intent = {
      intent_type: intentType,
      risk_level: typeof parsed["risk_level"] === "string" ? parsed["risk_level"] : "low",
      confidence: typeof parsed["confidence"] === "number" ? parsed["confidence"] : 0.5,
      case_updates: Array.isArray(parsed["case_updates"]) ? parsed["case_updates"] : [],
      open_questions: Array.isArray(parsed["open_questions"]) ? parsed["open_questions"] : [],
      reply_recommended: Boolean(parsed["reply_recommended"]),
      pricing_gate: typeof parsed["pricing_gate"] === "boolean"
        ? parsed["pricing_gate"]
        : !PRICING_BLOCKED_INTENTS.has(intentType),
      reasoning: typeof parsed["reasoning"] === "string" ? parsed["reasoning"] : "",
    };

    // 7. Insert timeline event (with returning id for auto-apply)
    const dedupe_key = `${case_id}_thread_intent_v1_${email_id}`;

    const { data: inserted, error: insertErr } = await serviceClient
      .from("case_timeline_events")
      .insert({
        case_id,
        event_type: "thread_intent_v1",
        related_email_id: email_id,
        actor_type: "ai",
        event_data: {
          email_id,
          thread_id,
          dedupe_key,
          intent,
          confidence: intent.confidence,
          model_meta: { model: "google/gemini-2.5-flash", version: "v1" },
        },
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      console.warn("[analyze-thread-event] Timeline insert failed:", insertErr?.message);
      return jsonResponse({ ok: false, error: "TIMELINE_INSERT_FAILED" }, 200);
    }

    // 8. Auto-apply for trivial intents (non-blocking, timeout 2.5s)
    const AUTO_APPLY_INTENTS = new Set(["provide_missing_info"]);

    if (AUTO_APPLY_INTENTS.has(intent.intent_type)) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 2500);
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/apply-thread-intent-v1`, {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ case_id, intent_event_id: inserted.id }),
          signal: controller.signal,
        });
        if (!resp.ok) {
          console.warn("[analyze-thread-event] Auto-apply non-blocking HTTP:", resp.status);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[analyze-thread-event] Auto-apply failed (non-blocking):", msg);
      } finally {
        clearTimeout(t);
      }
    }

    return jsonResponse({
      ok: true,
      case_id,
      thread_id,
      email_id,
      intent,
      intent_event_id: inserted.id,
      idempotent: false,
    });
  } catch (err) {
    console.error("[analyze-thread-event] Unexpected error:", (err as Error).message);
    return errorResponse("Internal server error", 500);
  }
});
