// SECURITY: requireUser is mandatory because verify_jwt=false
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { callAI, parseAIResponse } from "../_shared/ai-client.ts";
import { extractAndParseJSON } from "../_shared/json-parser.ts";
import { isOperatorCompanyName } from "../_shared/operator-identity.ts";

const SYSTEM_PROMPT = `Tu es un analyste de réponses clients pour un transitaire logistique (Dakar).
Analyse l'email de réponse du client et retourne un JSON strict avec ces champs :

- proposed_facts: tableau d'objets avec :
  - fact_key (string, ex: "cargo.weight_kg", "routing.destination_city")
  - value_text (string | null)
  - value_num (number | null)
  - value_json (object | null)
  - confidence (nombre entre 0 et 1)
  - rationale (string courte expliquant pourquoi)
- open_questions: tableau de strings (questions non résolues)
- ready_to_price: boolean (true si toutes les infos essentielles sont disponibles)
- reply_recommended: boolean (true si une réponse au client est recommandée)
- recommended_actions: tableau d'objets avec :
  - action_code (string)
  - title_fr (string)
  - description_fr (string)

Réponds UNIQUEMENT avec le JSON, sans texte autour.`;

serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

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

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // 1. Fetch email
    const { data: email, error: emailErr } = await userClient
      .from("emails")
      .select("id, thread_ref, body_text, subject")
      .eq("id", email_id)
      .maybeSingle();

    if (emailErr || !email) return errorResponse("Email not found", 404);

    // 2. Resolve thread
    if (!email.thread_ref) return errorResponse("Email has no thread_ref", 400);

    const { data: thread, error: threadErr } = await userClient
      .from("email_threads")
      .select("id")
      .eq("id", email.thread_ref)
      .maybeSingle();

    if (threadErr || !thread) return errorResponse("Thread not found", 404);
    const thread_id = thread.id;

    // 3. Find quote_case
    const { data: quoteCase, error: caseErr } = await userClient
      .from("quote_cases")
      .select("id")
      .eq("thread_id", thread_id)
      .maybeSingle();

    if (caseErr || !quoteCase) return errorResponse("No quote_case linked to this thread", 404);
    const case_id = quoteCase.id;

    // 4. Idempotence check — limit query + JS filter on event_data.kind
    const { data: recentOutputs } = await serviceClient
      .from("case_timeline_events")
      .select("id, event_data")
      .eq("case_id", case_id)
      .eq("event_type", "output_generated")
      .eq("related_email_id", email_id)
      .order("created_at", { ascending: false })
      .limit(50);

    const existing = (recentOutputs ?? []).find((evt) => {
      const ed = evt.event_data as Record<string, unknown> | null;
      return ed?.["kind"] === "reply_analysis_v1";
    });

    if (existing) {
      const ed = existing.event_data as Record<string, unknown> | null;
      return jsonResponse({
        ok: true,
        idempotent: true,
        analysis_event_id: existing.id,
        analysis: ed?.["analysis"] ?? null,
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
        label: "reply-analysis",
        maxLogChars: 500,
        expectRoot: "object",
      });
    } catch {
      console.warn("[analyze-reply-event] AI JSON parse failed for email:", email_id);
      return jsonResponse({ ok: false, error: "AI_JSON_PARSE_FAILED" }, 200);
    }

    // 7. Normalize analysis
    const rawFacts = Array.isArray(parsed["proposed_facts"]) ? parsed["proposed_facts"] : [];
    const proposed_facts = rawFacts
      .filter((f: unknown): f is Record<string, unknown> => {
        if (typeof f !== "object" || f === null) return false;
        const obj = f as Record<string, unknown>;
        if (typeof obj["fact_key"] !== "string" || !obj["fact_key"]) return false;
        // Skip if all value fields are null/undefined
        if (obj["value_text"] == null && obj["value_num"] == null && obj["value_json"] == null) return false;
        return true;
      })
      .map((f: Record<string, unknown>) => ({
        fact_key: String(f["fact_key"]),
        value_text: typeof f["value_text"] === "string" ? f["value_text"] : null,
        value_num: typeof f["value_num"] === "number" ? f["value_num"] : null,
        value_json: (typeof f["value_json"] === "object" && f["value_json"] !== null) ? f["value_json"] : null,
        confidence: typeof f["confidence"] === "number" ? Math.max(0, Math.min(1, f["confidence"])) : 0.5,
        rationale: typeof f["rationale"] === "string" ? f["rationale"] : "",
      }))
      .filter((pf) => {
        if (pf.fact_key === "contacts.client_company" && isOperatorCompanyName(pf.value_text)) {
          console.log(`[operator-client-company-guard] reply proposal filtered: ${pf.value_text}`);
          return false;
        }
        return true;
      });

    const open_questions = Array.isArray(parsed["open_questions"])
      ? (parsed["open_questions"] as unknown[]).filter((q): q is string => typeof q === "string")
      : [];

    const ready_to_price = Boolean(parsed["ready_to_price"]);
    const reply_recommended = Boolean(parsed["reply_recommended"]);

    const rawActions = Array.isArray(parsed["recommended_actions"]) ? parsed["recommended_actions"] : [];
    const recommended_actions = rawActions
      .filter((a: unknown): a is Record<string, unknown> => typeof a === "object" && a !== null)
      .map((a: Record<string, unknown>) => ({
        action_code: typeof a["action_code"] === "string" ? a["action_code"] : "UNKNOWN",
        title_fr: typeof a["title_fr"] === "string" ? a["title_fr"] : "",
        description_fr: typeof a["description_fr"] === "string" ? a["description_fr"] : "",
      }));

    const analysis = { proposed_facts, open_questions, ready_to_price, reply_recommended, recommended_actions };

    // 7b. CL1: Match proposed facts to active client_gap_requests (sent-first priority)
    const matchedGapRequests: Array<{ gap_key: string; request_id: string; status: string }> = [];
    try {
      const { data: activeRequests, error: fetchErr } = await serviceClient
        .from("client_gap_requests")
        .select("id, gap_key, status")
        .eq("case_id", case_id)
        .in("status", ["drafted", "sent"]);

      if (fetchErr) {
        console.warn("[CL1] client_gap_requests fetch failed:", fetchErr.message);
      }

      if (activeRequests && activeRequests.length > 0) {
        const sentRows = activeRequests.filter((r: any) => r.status === "sent");
        const draftedRows = activeRequests.filter((r: any) => r.status === "drafted");
        const matchedRequestIds = new Set<string>();

        for (const pf of proposed_facts) {
          // Priority: match sent first, fallback to drafted
          const match =
            sentRows.find((r: any) => r.gap_key === pf.fact_key && !matchedRequestIds.has(r.id)) ||
            draftedRows.find((r: any) => r.gap_key === pf.fact_key && !matchedRequestIds.has(r.id));

          if (match) {
            matchedRequestIds.add(match.id);
            const { error: updateErr } = await serviceClient
              .from("client_gap_requests")
              .update({
                status: "answered",
                response_email_id: email_id,
                matched_fact_key: pf.fact_key,
              })
              .eq("id", match.id);

            if (!updateErr) {
              matchedGapRequests.push({ gap_key: match.gap_key, request_id: match.id, status: "answered" });
            } else {
              console.warn(`[CL1] client_gap_requests update failed for ${match.gap_key}:`, updateErr.message);
            }
          }
        }
      }
    } catch (clErr) {
      console.warn("[CL1] client_gap_requests matching failed:", (clErr as Error).message);
    }

    // 8. Insert timeline event
    const dedupe_key = `reply_analysis_v1:${case_id}:${email_id}`;

    const { data: inserted, error: insertErr } = await serviceClient
      .from("case_timeline_events")
      .insert({
        case_id,
        event_type: "output_generated",
        related_email_id: email_id,
        actor_type: "ai",
        event_data: {
          kind: "reply_analysis_v1",
          dedupe_key,
          email_id,
          thread_id,
          case_id,
          analysis,
          model_meta: { model: "google/gemini-2.5-flash", version: "v1" },
        },
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      console.warn("[analyze-reply-event] Timeline insert failed:", insertErr?.message);
      return jsonResponse({ ok: false, error: "TIMELINE_INSERT_FAILED" }, 200);
    }

    const analysis_event_id = inserted.id;

    // 9. Generate idempotent manual_action events
    // Load existing actions for THIS case only
    const { data: existingActions } = await serviceClient
      .from("case_timeline_events")
      .select("event_data")
      .eq("case_id", case_id)
      .eq("event_type", "manual_action")
      .order("created_at", { ascending: false })
      .limit(200);

    const existingDedupeKeys = new Set(
      (existingActions ?? [])
        .map((a) => (a.event_data as Record<string, unknown> | null)?.["dedupe_key"])
        .filter((k): k is string => typeof k === "string")
    );

    // Build action list
    const actionsToCreate: Array<{
      action_code: string;
      title_fr: string;
      description_fr: string;
    }> = [
      {
        action_code: "APPLY_FACT_PROPOSALS",
        title_fr: "Appliquer les faits proposés",
        description_fr: `${proposed_facts.length} fait(s) proposé(s) par l'analyse de la réponse client`,
      },
    ];

    if (reply_recommended) {
      actionsToCreate.push({
        action_code: "PREPARE_CLIENT_REPLY_DRAFT",
        title_fr: "Préparer un brouillon de réponse",
        description_fr: "L'analyse recommande de répondre au client",
      });
    }

    if (ready_to_price) {
      actionsToCreate.push({
        action_code: "LAUNCH_PRICING",
        title_fr: "Lancer le chiffrage",
        description_fr: "Les informations sont suffisantes pour chiffrer",
      });
    }

    const insertedActionIds: string[] = [];

    for (const act of actionsToCreate) {
      const actionDedupeKey = `reply_action:${analysis_event_id}:${act.action_code}`;

      if (existingDedupeKeys.has(actionDedupeKey)) continue;

      const { data: actionInserted, error: actionErr } = await serviceClient
        .from("case_timeline_events")
        .insert({
          case_id,
          event_type: "manual_action",
          related_email_id: email_id,
          actor_type: "ai",
          event_data: {
            dedupe_key: actionDedupeKey,
            source_reply_analysis_event_id: analysis_event_id,
            action_code: act.action_code,
            title_fr: act.title_fr,
            description_fr: act.description_fr,
            status: "open",
          },
        })
        .select("id")
        .single();

      if (actionErr) {
        console.warn(`[analyze-reply-event] Action insert failed (${act.action_code}):`, actionErr.message);
      } else if (actionInserted) {
        insertedActionIds.push(actionInserted.id);
      }
    }

    return jsonResponse({
      ok: true,
      idempotent: false,
      case_id,
      thread_id,
      email_id,
      analysis_event_id,
      analysis,
      actions_created: insertedActionIds.length,
      matched_gap_requests: matchedGapRequests,
    });
  } catch (err) {
    console.error("[analyze-reply-event] Unexpected error:", (err as Error).message);
    return errorResponse("Internal server error", 500);
  }
});
