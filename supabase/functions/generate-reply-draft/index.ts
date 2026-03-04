import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { callAI, parseAIResponse } from "../_shared/ai-client.ts";
import { extractAndParseJSON } from "../_shared/json-parser.ts";

serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  // ── Auth ──
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  // ── Parse body ──
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const caseId = body.case_id as string | undefined;
  const actionDedupeKey = body.action_dedupe_key as string | undefined;
  if (!caseId || !actionDedupeKey) {
    return errorResponse("case_id and action_dedupe_key are required", 400);
  }

  // ── Clients ──
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization")! } },
    auth: { persistSession: false },
  });
  const serviceClient = createClient(supabaseUrl, serviceKey);

  // ── Verify case access (RLS) ──
  const { data: caseRow, error: caseErr } = await userClient
    .from("quote_cases")
    .select("id")
    .eq("id", caseId)
    .maybeSingle();
  if (caseErr || !caseRow) {
    return errorResponse("Case not found", 404);
  }

  // ── Find action event by dedupe_key ──
  const { data: actionEvents, error: actionErr } = await userClient
    .from("case_timeline_events")
    .select("id, event_data, related_email_id")
    .eq("case_id", caseId)
    .eq("event_type", "manual_action")
    .order("created_at", { ascending: false })
    .limit(200);
  if (actionErr) {
    console.error("Failed to load actions:", actionErr.message);
    return errorResponse("Failed to load actions", 500);
  }

  const actionEvent = (actionEvents ?? []).find((e: any) => {
    const ed = e.event_data as Record<string, unknown> | null;
    return ed?.dedupe_key === actionDedupeKey;
  });
  if (!actionEvent) {
    return errorResponse("Action not found", 404);
  }

  // ── Micro-ajustement #1: guard action_code ──
  const actionData = actionEvent.event_data as Record<string, unknown> | null;
  if (actionData?.action_code !== "PREPARE_CLIENT_REPLY_DRAFT") {
    return errorResponse("Action is not PREPARE_CLIENT_REPLY_DRAFT", 400);
  }

  const relatedEmailId = actionEvent.related_email_id as string | null;

  // ── Idempotence check ──
  const draftDedupeKey = `reply_draft_v1:${actionDedupeKey}`;

  const { data: existingOutputs } = await userClient
    .from("case_timeline_events")
    .select("event_data")
    .eq("case_id", caseId)
    .eq("event_type", "output_generated")
    .order("created_at", { ascending: false })
    .limit(200);

  // Micro-ajustement #2: match both dedupe_key AND kind
  const existingDraft = (existingOutputs ?? []).find((e: any) => {
    const ed = e.event_data as Record<string, unknown> | null;
    return ed?.dedupe_key === draftDedupeKey && ed?.kind === "reply_draft_v1";
  });

  if (existingDraft) {
    const ed = existingDraft.event_data as Record<string, unknown>;
    return jsonResponse({
      ok: true,
      idempotent: true,
      draft: ed.draft_reply,
      dedupe_key: draftDedupeKey,
    });
  }

  // ── Load source email (non-blocking) ──
  let emailContext = "";
  if (relatedEmailId) {
    const { data: emailRow } = await userClient
      .from("emails")
      .select("id, subject, body_text")
      .eq("id", relatedEmailId)
      .maybeSingle();
    if (emailRow) {
      const bodySnippet = (emailRow.body_text || "").slice(0, 2000);
      emailContext = `\nEmail source:\nSujet: ${emailRow.subject || "(sans sujet)"}\nCorps:\n${bodySnippet}`;
    }
  }

  // ── Load latest intent (non-blocking, enrichment) ──
  let intentContext = "";
  const { data: intentEvents } = await userClient
    .from("case_timeline_events")
    .select("event_data")
    .eq("case_id", caseId)
    .eq("event_type", "thread_intent_v1")
    .order("created_at", { ascending: false })
    .limit(1);
  if (intentEvents?.[0]) {
    const ed = (intentEvents[0].event_data ?? null) as Record<string, unknown> | null;
    const intentObj = (ed?.["intent"] ?? null) as Record<string, unknown> | null;

    const intentType =
      (intentObj?.["intent_type"] as string | undefined) ??
      (ed?.["intent_type"] as string | undefined);

    const confidence =
      (intentObj?.["confidence"] as number | undefined) ??
      (ed?.["confidence"] as number | undefined);

    const riskLevel = (intentObj?.["risk_level"] as string | undefined) ?? undefined;
    const replyRecommended = (intentObj?.["reply_recommended"] as boolean | undefined) ?? undefined;
    const rawMissing = intentObj?.["missing_fields"] ?? ed?.["missing_fields"] ?? undefined;
    const missingStr = rawMissing ? JSON.stringify(rawMissing).slice(0, 1000) : undefined;

    if (intentType) {
      intentContext =
        `\n\n[THREAD_INTENT]\n- intent_type: ${intentType}` +
        (confidence !== undefined ? `\n- confidence: ${confidence}` : "") +
        (riskLevel ? `\n- risk_level: ${riskLevel}` : "") +
        (replyRecommended !== undefined ? `\n- reply_recommended: ${replyRecommended}` : "") +
        (missingStr ? `\n- missing_fields: ${missingStr}` : "") +
        `\n[/THREAD_INTENT]\n`;
    }
  }

  // ── AI call ──
  const systemPrompt = `Tu es un assistant logistique professionnel chez SODATRA (transitaire/commissionnaire de transport au Sénégal).
Génère un brouillon de réponse email en français, professionnel et court.
- Confirme la réception de la demande
- Indique la prochaine étape (ex: "nous revenons vers vous avec un devis sous 24h")
- Ne pas inventer de chiffres, dates ou tarifs. Si une info manque, demande-la clairement.
- Ton : professionnel, courtois, concis.

Tu dois répondre UNIQUEMENT avec un objet JSON valide :
{"subject":"...","body":"..."}

Aucun texte avant ou après le JSON.`;

  const userPrompt = `Prépare un brouillon de réponse pour ce dossier de cotation.${emailContext}${intentContext}`;

  try {
    const aiResponse = await callAI(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { model: "google/gemini-2.5-flash", temperature: 0.3 }
    );

    const rawText = await parseAIResponse(aiResponse);

    const parsed = extractAndParseJSON<{ subject: string; body: string }>(rawText, {
      label: "reply-draft",
      expectRoot: "object",
      maxLogChars: 500,
    });

    // ── Micro-ajustement #3: strict validation ──
    if (
      typeof parsed.subject !== "string" || parsed.subject.trim().length < 3 ||
      typeof parsed.body !== "string" || parsed.body.trim().length < 20
    ) {
      return jsonResponse({ ok: false, error: "AI_INVALID_DRAFT" }, 200);
    }

    const draft = { subject: parsed.subject.trim(), body: parsed.body.trim() };

    // ── Insert timeline event ──
    const { error: insertErr } = await serviceClient
      .from("case_timeline_events")
      .insert({
        case_id: caseId,
        event_type: "output_generated",
        actor_type: "ai",
        related_email_id: relatedEmailId,
        event_data: {
          dedupe_key: draftDedupeKey,
          source_action_dedupe_key: actionDedupeKey,
          kind: "reply_draft_v1",
          draft_reply: draft,
          model_meta: { model: "google/gemini-2.5-flash", version: "v1" },
        },
      });

    if (insertErr) {
      console.error("Timeline insert failed:", insertErr.message);
      return jsonResponse({ ok: false, error: "TIMELINE_INSERT_FAILED" }, 200);
    }

    return jsonResponse({
      ok: true,
      idempotent: false,
      draft,
      dedupe_key: draftDedupeKey,
    });
  } catch (err) {
    console.error("generate-reply-draft error:", (err as Error).message);
    return jsonResponse({ ok: false, error: "AI_JSON_PARSE_FAILED" }, 200);
  }
});
