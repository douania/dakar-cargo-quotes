import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { callAI, parseAIResponse } from "../_shared/ai-client.ts";
import { extractAndParseJSON } from "../_shared/json-parser.ts";
import {
  isClientResolvableGap,
  buildClientQuestionsFromGaps,
  normalizeGapKeys,
} from "../_shared/client-gap-policy.ts";

const INTERNAL_DOMAINS = ["sodatra.sn", "2hlgroup.com", "2hl.sn"];

function isInternalEmail(fromAddress: string): boolean {
  const lower = (fromAddress ?? "").toLowerCase();
  return INTERNAL_DOMAINS.some((d) => lower.includes("@" + d));
}

function detectLanguage(text: string): "fr" | "en" {
  const lower = text.toLowerCase();
  let fr = 0;
  let en = 0;
  // French indicators
  if (lower.includes("bonjour")) fr++;
  if (lower.includes("cordialement")) fr++;
  if (lower.includes("merci")) fr++;
  if (lower.includes(" vous ")) fr++;
  if (lower.includes(" nous ")) fr++;
  if (lower.includes(" des ")) fr++;
  if (lower.includes(" les ")) fr++;
  if (lower.includes(" pour ")) fr++;
  if (lower.includes("cotation")) fr++;
  if (lower.includes("marchandise")) fr++;
  // English indicators
  if (lower.includes("dear ")) en++;
  if (lower.includes("regards")) en++;
  if (lower.includes("please")) en++;
  if (lower.includes("thank you")) en++;
  if (lower.includes(" the ")) en++;
  if (lower.includes(" is ")) en++;
  if (lower.includes(" are ")) en++;
  if (lower.includes("freight")) en++;
  if (lower.includes("shipment")) en++;
  if (lower.includes("quotation")) en++;
  return en > fr ? "en" : "fr";
}

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
    .select("id, thread_id")
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
  const actionCode = actionData?.["action_code"] as string | undefined;
  const ALLOWED_ACTIONS = ["PREPARE_CLIENT_REPLY_DRAFT", "REQUEST_CLIENT_INFO_FOR_GAPS"];
  if (!actionCode || !ALLOWED_ACTIONS.includes(actionCode)) {
    return errorResponse("Action code not supported for draft generation", 400);
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

  // ── Detect customer language (fr/en) ──
  let customerLanguage: "fr" | "en" = "fr";
  let languageSource = "fallback_fr";

  {
    let langText: string | null = null;

    if (relatedEmailId) {
      const { data: langEmail } = await userClient
        .from("emails")
        .select("from_address, subject, body_text")
        .eq("id", relatedEmailId)
        .maybeSingle();
      if (langEmail && !isInternalEmail((langEmail as any).from_address ?? "")) {
        langText = (langEmail as any).body_text || (langEmail as any).subject || null;
        languageSource = "related_email";
      }
    }

    if (!langText) {
      const threadId = (caseRow as any).thread_id as string | null;
      if (threadId) {
        const { data: threadEmails } = await userClient
          .from("emails")
          .select("from_address, subject, body_text")
          .eq("thread_ref", threadId)
          .order("sent_at", { ascending: false })
          .limit(20);
        const externalEmail = (threadEmails ?? []).find(
          (e: any) => !isInternalEmail(e.from_address ?? "")
        );
        if (externalEmail) {
          langText = externalEmail.body_text || externalEmail.subject || null;
          languageSource = "latest_external_thread_email";
        }
      }
    }

    if (langText) {
      customerLanguage = detectLanguage(langText);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // P0-C: Deterministic branch for REQUEST_CLIENT_INFO_FOR_GAPS
  // Skips AI entirely — builds draft from gap policy whitelist
  // ══════════════════════════════════════════════════════════════
  if (actionCode === "REQUEST_CLIENT_INFO_FOR_GAPS") {
    // 1. Get requested gap keys from action event_data
    const requestedGapKeys = (actionData?.["requested_gap_keys"] as string[]) ?? [];

    // 2. Load open gaps for this case
    const { data: openGaps, error: gapsErr } = await userClient
      .from("quote_gaps")
      .select("gap_key")
      .eq("case_id", caseId)
      .eq("status", "open");

    if (gapsErr) {
      console.error("Failed to load gaps:", gapsErr.message);
      return jsonResponse({ ok: false, error: "GAPS_LOAD_FAILED" }, 200);
    }

    // 3. Filter: still open + client-resolvable + in requested set
    const requestedSet = new Set(requestedGapKeys);
    const relevantGaps = (openGaps ?? []).filter((g: Record<string, unknown>) => {
      const key = g["gap_key"] as string;
      return isClientResolvableGap(key) && requestedSet.has(key);
    });

    if (relevantGaps.length === 0) {
      return jsonResponse({ ok: false, error: "NO_RELEVANT_GAPS" }, 200);
    }

    // 4. Build deterministic questions (sorted + deduped)
    const normalizedKeys = normalizeGapKeys(
      relevantGaps.map((g: Record<string, unknown>) => g["gap_key"] as string)
    );
    const questions = buildClientQuestionsFromGaps(
      normalizedKeys.map((k) => ({ gap_key: k })),
      customerLanguage
    );

    // 5. Build deterministic email (language-aware)
    const draftSubject = customerLanguage === "en"
      ? "Additional information required for your quotation"
      : "Informations complémentaires pour votre cotation";

    const draftBody = customerLanguage === "en"
      ? `Hello,

To finalize your logistics quotation, we need a few additional details:

${questions.map((q) => "- " + q).join("\n")}

As soon as we receive this information, we will be able to finalize your quote promptly.

Best regards,
Quotation Team
SODATRA`
      : `Bonjour,

Afin de finaliser votre cotation logistique, nous avons besoin de quelques informations complémentaires :

${questions.map((q) => "- " + q).join("\n")}

Dès réception de ces informations, nous pourrons finaliser votre devis rapidement.

Cordialement,
Service Cotation
SODATRA`;

    const draft = { subject: draftSubject, body: draftBody };

    // 6. Insert timeline event (same pattern as AI branch)
    const { data: insertedEvent, error: insertErr } = await serviceClient
      .from("case_timeline_events")
      .insert({
        case_id: caseId,
        event_type: "output_generated",
        actor_type: "system",
        related_email_id: relatedEmailId,
        event_data: {
          dedupe_key: draftDedupeKey,
          source_action_dedupe_key: actionDedupeKey,
          kind: "reply_draft_v1",
          draft_reply: draft,
          requested_gap_keys: normalizedKeys,
          deterministic: true,
          customer_language: customerLanguage,
          language_source: languageSource,
        },
      })
      .select("id")
      .single();

    if (insertErr || !insertedEvent) {
      console.error("Timeline insert failed:", insertErr?.message);
      return jsonResponse({ ok: false, error: "TIMELINE_INSERT_FAILED" }, 200);
    }

    // ── CL1: Create client_gap_requests for each gap (insert-if-not-exists) ──
    const timelineEventId = insertedEvent.id;
    for (const gapKey of normalizedKeys) {
      try {
        // Check if active row already exists
        const { data: existingRow, error: checkErr } = await serviceClient
          .from("client_gap_requests")
          .select("id")
          .eq("case_id", caseId)
          .eq("gap_key", gapKey)
          .in("status", ["drafted", "sent", "answered"])
          .maybeSingle();

        if (checkErr) {
          console.warn(`[CL1] client_gap_requests check failed for ${gapKey}:`, checkErr.message);
          continue;
        }

        if (!existingRow) {
          const { error: insertErr2 } = await serviceClient.from("client_gap_requests").insert({
            case_id: caseId,
            gap_key: gapKey,
            source_timeline_event_id: timelineEventId,
            draft_subject: draft.subject,
            draft_body: draft.body,
            status: "drafted",
            created_by: auth.user.id,
          });
          if (insertErr2) {
            console.warn(`[CL1] client_gap_requests insert failed for ${gapKey}:`, insertErr2.message);
          }
        }
      } catch (gapErr) {
        console.warn(`[CL1] client_gap_requests insert failed for ${gapKey}:`, (gapErr as Error).message);
      }
    }

    return jsonResponse({
      ok: true,
      idempotent: false,
      draft,
      dedupe_key: draftDedupeKey,
      deterministic: true,
    });
  }

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
  const langInstruction = customerLanguage === "en"
    ? "Write the email reply draft strictly in English."
    : "Rédige le brouillon de réponse email strictement en français.";

  const systemPrompt = `Tu es un assistant logistique professionnel chez SODATRA (transitaire/commissionnaire de transport au Sénégal).
${langInstruction}
Génère un brouillon de réponse email professionnel et court.
- Confirme la réception de la demande
- Indique la prochaine étape (ex: "nous revenons vers vous avec un devis sous 24h" / "we will get back to you with a quote within 24h")
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
          customer_language: customerLanguage,
          language_source: languageSource,
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
