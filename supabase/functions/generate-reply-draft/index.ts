import {readAirCrossTradeRequirements} from "../_shared/air-cross-trade-service.ts";
import { clientGapGuard, type ClientGapScope } from '../_shared/client-gap-scope.ts';
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { hasPadGapReference, isCurrentGapDraft, isObsoletePadDraft } from "../_shared/pad-gap-review.ts";
import { callAI, parseAIResponse } from "../_shared/ai-client.ts";
import { extractAndParseJSON } from "../_shared/json-parser.ts";
import {
  isRequiredClientGapForCase,
  CLIENT_QUESTION_POLICY_VERSION,
  buildClientQuestionsFromGaps,
  normalizeGapKeys,
} from "../_shared/client-gap-policy.ts";
import {
  detectLanguage,
  normalizeTextForLanguageDetection,
} from "../_shared/language-detection.ts";

const INTERNAL_DOMAINS = ["sodatra.sn", "2hlgroup.com", "2hl.sn"];

function isInternalEmail(fromAddress: string): boolean {
  const lower = (fromAddress ?? "").toLowerCase();
  return INTERNAL_DOMAINS.some((d) => lower.includes("@" + d));
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
    .select("id, thread_id, request_type")
    .eq("id", caseId)
    .maybeSingle();
  if (caseErr || !caseRow) {
    return errorResponse("Case not found", 404);
  }

  const airRequirementFacts: Array<{fact_key:string;value_json:unknown}> = [];
  const clientGapContext = {request_type:caseRow.request_type,facts:airRequirementFacts};

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

  // Fresh eligibility BEFORE cached output lookup. Old PAD and mixed drafts
  // must never bypass reconciliation through an idempotent response.
  let currentClientKeys: string[] = [];
  let currentScope: ClientGapScope | undefined;
  if (actionCode === "REQUEST_CLIENT_INFO_FOR_GAPS") {
  if (caseRow.request_type === "AIR_CROSS_TRADE") {
    let qualified;try{qualified=await readAirCrossTradeRequirements(auth,caseId,serviceClient);}catch{return errorResponse("AIR_REQUIREMENTS_LOAD_FAILED",503);}
    if(!qualified)return errorResponse("AIR_QUALIFICATION_STALE",409);
    airRequirementFacts.push({fact_key:"service.air_cross_trade_requirements",value_json:qualified});
  }
    if (actionData?.status !== "open") return jsonResponse({ ok: false, error: "ACTION_NOT_OPEN" }, 200);
    if (hasPadGapReference(actionData.requested_gap_keys, actionDedupeKey)) {
      return jsonResponse({ ok: false, error: "ACTION_REQUIRES_GAP_SYNC" }, 200);
    }
    const requested = new Set(Array.isArray(actionData.requested_gap_keys) ? actionData.requested_gap_keys : []);
    const { data: openGaps, error } = await userClient.from("quote_gaps")
      .select("id, gap_key, is_blocking").eq("case_id", caseId).eq("status", "open");
    if (error || !Array.isArray(openGaps)) return jsonResponse({ ok: false, error: "GAPS_LOAD_FAILED" }, 200);
    try { currentScope = clientGapGuard(openGaps).scope; } catch { return jsonResponse({ok:false,error:"CLIENT_GAP_SCOPE_UNAVAILABLE"},500); }
    currentClientKeys = normalizeGapKeys(openGaps.filter(g=>isRequiredClientGapForCase(g,clientGapContext)).map(g => g.gap_key));
    if (!currentClientKeys.length) return jsonResponse({ ok: false, error: "NO_RELEVANT_GAPS" }, 200);
    if (normalizeGapKeys([...requested] as string[]).join(",") !== currentClientKeys.join(","))
      return jsonResponse({ ok: false, error: "ACTION_REQUIRES_GAP_SYNC" }, 200);
  }

  // ── Idempotence check ──
  const draftDedupeKey = `reply_draft_v1:${actionDedupeKey}` +
    (actionCode === "REQUEST_CLIENT_INFO_FOR_GAPS" ? `:client-scope-v${CLIENT_QUESTION_POLICY_VERSION}:${currentClientKeys.join(",")}` : "");

  const { data: existingOutputs, error: outputsError } = await userClient
    .from("case_timeline_events")
    .select("id, event_data")
    .eq("case_id", caseId)
    .eq("event_type", "output_generated")
    .order("created_at", { ascending: false })
    .limit(200);

  let draftOutputs = existingOutputs ?? [];
  const activeDraftSourceIds = new Set<string>();
  if (actionCode === "REQUEST_CLIENT_INFO_FOR_GAPS") {
    if (outputsError || !Array.isArray(existingOutputs)) return jsonResponse({ ok: false, error: "OUTPUTS_LOAD_FAILED" }, 200);
    const { data: activeDrafts, error } = await userClient.from("client_gap_requests")
      .select("id, source_timeline_event_id").eq("case_id", caseId).eq("status", "drafted");
    if (error || !Array.isArray(activeDrafts)) return jsonResponse({ ok: false, error: "DRAFTS_LOAD_FAILED" }, 200);
    const sourceIds = [...new Set((activeDrafts ?? []).map(row => row.source_timeline_event_id).filter((id): id is string => typeof id === "string" && !!id))];
    sourceIds.forEach(id => activeDraftSourceIds.add(id));
    const sourceRead = sourceIds.length ? await userClient.from("case_timeline_events")
      .select("id, event_data").eq("case_id", caseId).eq("event_type", "output_generated").in("id", sourceIds)
      : { data: [], error: null };
    if (sourceRead.error || !Array.isArray(sourceRead.data)) return jsonResponse({ ok: false, error: "DRAFT_SOURCES_LOAD_FAILED" }, 200);
    draftOutputs = [...new Map([...draftOutputs, ...(sourceRead.data ?? [])].map(row => [row.id, row])).values()];
    const needsSync = (activeDrafts ?? []).some(row => {
      const source = draftOutputs.find(e => e.id === row.source_timeline_event_id)?.event_data as Record<string, unknown> | undefined;
      return !source || isObsoletePadDraft(source) || !isCurrentGapDraft(source, currentClientKeys, currentScope);
    });
    if (needsSync) return jsonResponse({ ok: false, error: "ACTION_REQUIRES_GAP_SYNC" }, 200);
  }

  // Verify active tracking before reporting a client-gap draft as usable.
  // No row/source is overwritten. The existing partial unique index arbitrates
  // insert races; a transport failure is not proof that an insert did not happen.
  // This is read-after-write confirmation, NOT an atomic cross-handler fence.
  async function confirmClientRequestBindings(eventId: string, draft: { subject: string; body: string }): Promise<string | null> {
    for (const gapKey of currentClientKeys) {
      const readActive = () => userClient.from("client_gap_requests")
        .select("id, status, source_timeline_event_id").eq("case_id", caseId).eq("gap_key", gapKey)
        .in("status", ["drafted", "sent", "answered"]).maybeSingle();
      try {
        let active = await readActive();
        if (active.error) return "CLIENT_GAP_BINDING_UNCONFIRMED";
        if (!active.data) {
          const inserted = await serviceClient.from("client_gap_requests").insert({
            case_id: caseId, gap_key: gapKey, source_timeline_event_id: eventId,
            draft_subject: draft.subject, draft_body: draft.body, status: "drafted", created_by: auth.user.id,
          });
          // Re-read even on23505 or an uncertain response; never blindly repeat an insert.
          if (inserted.error?.code === "PT409") return "CLIENT_GAP_SCOPE_CHANGED";
          active = await readActive();
          if (active.error || !active.data) return "CLIENT_GAP_BINDING_UNCONFIRMED";
          if (inserted.error && active.data.source_timeline_event_id !== eventId)
            return inserted.error.code === "23505" ? "CLIENT_GAP_BINDING_CONFLICT" : "CLIENT_GAP_BINDING_UNCONFIRMED";
        }
        if (active.data.status === "sent" || active.data.status === "answered")
          return "CLIENT_GAP_ALREADY_FOLLOWED";
        if (active.data.status !== "drafted" || active.data.source_timeline_event_id !== eventId)
          return "CLIENT_GAP_BINDING_CONFLICT";
      } catch {
        return "CLIENT_GAP_BINDING_UNCONFIRMED";
      }
    }
    return null;
  }

  // Micro-ajustement #2: match both dedupe_key AND kind
  const candidateDrafts = draftOutputs.filter((e: any) => {
    const ed = e.event_data as Record<string, unknown> | null;
    return ed?.dedupe_key === draftDedupeKey && ed?.kind === "reply_draft_v1" &&
      (actionCode !== "REQUEST_CLIENT_INFO_FOR_GAPS" || isCurrentGapDraft(ed, currentClientKeys, currentScope));
  });

  // A later unbound concurrent output must not mask the already linked source.
  const existingDraft = candidateDrafts.find(e => activeDraftSourceIds.has(e.id)) ?? candidateDrafts[0];
  if (existingDraft) {
    const ed = existingDraft.event_data as Record<string, unknown>;
    if (actionCode === "REQUEST_CLIENT_INFO_FOR_GAPS") {
      const draft = ed.draft_reply as { subject?: unknown; body?: unknown } | undefined;
      if (!draft || typeof draft.subject !== "string" || typeof draft.body !== "string")
        return jsonResponse({ ok: false, error: "INVALID_SAVED_CLIENT_DRAFT" }, 200);
      const bindingError = await confirmClientRequestBindings(existingDraft.id, {subject:draft.subject,body:draft.body});
      if (bindingError) return jsonResponse({ok:false,error:bindingError},bindingError === "CLIENT_GAP_SCOPE_CHANGED" ? 409 : 200);
    }
    return jsonResponse({
      ok: true,
      idempotent: true,
      ...(actionCode === "REQUEST_CLIENT_INFO_FOR_GAPS" ? {client_question_policy_version:CLIENT_QUESTION_POLICY_VERSION,client_gap_fence_version:1} : {}),
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
      // Le corps stocké peut être MIME/base64 brut (ex: "QzAg...") : on le
      // normalise pour restaurer les marqueurs de langue avant détection.
      // Sinon detectLanguage ne voit aucun marqueur et retombe sur "fr".
      customerLanguage = detectLanguage(normalizeTextForLanguageDetection(langText));
    }
  }

  // ══════════════════════════════════════════════════════════════
  // P0-C: Deterministic branch for REQUEST_CLIENT_INFO_FOR_GAPS
  // Skips AI entirely — builds draft from gap policy whitelist
  // ══════════════════════════════════════════════════════════════
  if (actionCode === "REQUEST_CLIENT_INFO_FOR_GAPS") {
    const normalizedKeys = currentClientKeys;
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

To prepare your quotation, could you clarify the following points?

${questions.map((q) => "- " + q).join("\n")}

You can reply directly to this message. Thank you.

Best regards,
Quotation Team
SODATRA`
      : `Bonjour,

Pour préparer votre cotation, pouvez-vous préciser les points suivants ?

${questions.map((q) => "- " + q).join("\n")}

Vous pouvez répondre directement à ce message. Merci.

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
          client_question_policy_version: CLIENT_QUESTION_POLICY_VERSION,
          client_gap_guard: {version:1,scope:currentScope},
          deterministic: true,
          customer_language: customerLanguage,
          language_source: languageSource,
        },
      })
      .select("id, event_data")
      .single();

    if (insertErr || !insertedEvent) {
      console.error("Timeline insert failed:", insertErr?.message);
      return jsonResponse({ ok: false, error: insertErr?.code === "PT409" ? "CLIENT_GAP_SCOPE_CHANGED" : "TIMELINE_INSERT_FAILED" }, insertErr?.code === "PT409" ? 409 : 200);
    }

    if ((insertedEvent.event_data as Record<string,unknown>)?.client_gap_fence_version !== 1)
      return jsonResponse({ok:false,error:"CLIENT_GAP_FENCE_NOT_INSTALLED"},503);
    const bindingError = await confirmClientRequestBindings(insertedEvent.id, draft);
    if (bindingError) return jsonResponse({ok:false,error:bindingError},bindingError === "CLIENT_GAP_SCOPE_CHANGED" ? 409 : 200);

    return jsonResponse({
      ok: true,
      idempotent: false,
      draft,
      dedupe_key: draftDedupeKey,
      deterministic: true,
      client_question_policy_version:CLIENT_QUESTION_POLICY_VERSION,
      client_gap_fence_version:1,
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
      return jsonResponse({ ok: false, error: insertErr?.code === "PT409" ? "CLIENT_GAP_SCOPE_CHANGED" : "TIMELINE_INSERT_FAILED" }, insertErr?.code === "PT409" ? 409 : 200);
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
