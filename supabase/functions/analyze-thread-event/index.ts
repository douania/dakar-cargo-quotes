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
  "other",
] as const;

const SYSTEM_PROMPT = `Tu es un classificateur d'intentions pour des emails de transit/logistique.
Analyse l'email et retourne un JSON strict avec ces champs :
- intent_type: une valeur parmi ${INTENT_TYPES.join(", ")}
- risk_level: "low" | "medium" | "high"
- confidence: nombre entre 0 et 1
- case_updates: tableau de strings décrivant les mises à jour potentielles du dossier
- open_questions: tableau de strings avec les questions non résolues
- reply_recommended: boolean indiquant si une réponse est recommandée

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

    const intent = {
      intent_type: typeof parsed["intent_type"] === "string" ? parsed["intent_type"] : "other",
      risk_level: typeof parsed["risk_level"] === "string" ? parsed["risk_level"] : "low",
      confidence: typeof parsed["confidence"] === "number" ? parsed["confidence"] : 0.5,
      case_updates: Array.isArray(parsed["case_updates"]) ? parsed["case_updates"] : [],
      open_questions: Array.isArray(parsed["open_questions"]) ? parsed["open_questions"] : [],
      reply_recommended: Boolean(parsed["reply_recommended"]),
    };

    // 7. Insert timeline event
    const dedupe_key = `${case_id}_thread_intent_v1_${email_id}`;

    const { error: insertErr } = await serviceClient
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
      });

    if (insertErr) {
      console.warn("[analyze-thread-event] Timeline insert failed:", insertErr.message);
      return jsonResponse({ ok: false, error: "TIMELINE_INSERT_FAILED" }, 200);
    }

    return jsonResponse({
      ok: true,
      case_id,
      thread_id,
      email_id,
      intent,
      idempotent: false,
    });
  } catch (err) {
    console.error("[analyze-thread-event] Unexpected error:", (err as Error).message);
    return errorResponse("Internal server error", 500);
  }
});
