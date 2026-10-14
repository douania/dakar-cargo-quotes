import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { callAI, parseAIResponse } from "../_shared/ai-client.ts";
import { extractAndParseJSON } from "../_shared/json-parser.ts";
import { deriveConsigneeDocumentRequest, deriveRequestServiceEvidence, documentVerificationAction, readServiceScopeEvent } from '../_shared/request-service-evidence.ts';

// ── System prompt: strict business-scope detection ──
const SYSTEM_PROMPT = `Tu es un expert en logistique internationale spécialisé dans le transit au port de Dakar (Sénégal).

Ton rôle : analyser un email (et son contexte de thread) pour déterminer le SCOPE RÉEL de la mission logistique demandée à SODATRA (transitaire à Dakar).

RÈGLE FONDAMENTALE :
"maritime import" ≠ "fret maritime à coter".
Si le texte indique que le fret principal est déjà arrangé/payé par une autre partie, freight_scope DOIT être false.

RÈGLES DE PRIORITÉ DES DONNÉES :
- CONFIRMED_FACTS est la vérité actuelle du dossier.
- En cas de conflit entre CONFIRMED_FACTS et le sujet/corps email, toujours suivre CONFIRMED_FACTS.
- Les sujets email peuvent être obsolètes ou réutilisés depuis d'anciens dossiers.
- Ne jamais conclure "Dakar -> Peking" ou "Dakar -> Pékin" si CONFIRMED_FACTS indiquent Suisse -> Sénégal.
- Ne jamais mettre shipment_type="export" si CONFIRMED_FACTS indiquent une origine hors Sénégal et une destination Sénégal.

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
const TARGET_FACT_KEYS = [
  "routing.origin_country",
  "routing.origin_port",
  "routing.origin_airport",
  "routing.destination_country",
  "routing.destination_city",
  "routing.destination_port",
  "routing.destination_airport",
  "routing.incoterm",
  "cargo.weight_kg",
  "cargo.volume_cbm",
  "cargo.pieces_count",
  "cargo.description",
  "service.package",
  "service.overrides",
  "contacts.client_company",
  "contacts.client_email",
];

const FACT_LABELS: Record<string, string> = {
  "routing.origin_country": "origin_country",
  "routing.origin_port": "origin_port",
  "routing.origin_airport": "origin_airport",
  "routing.destination_country": "destination_country",
  "routing.destination_city": "destination_city",
  "routing.destination_port": "destination_port",
  "routing.destination_airport": "destination_airport",
  "routing.incoterm": "incoterm",
  "cargo.weight_kg": "cargo_weight_kg",
  "cargo.volume_cbm": "volume_cbm",
  "cargo.pieces_count": "pieces_count",
  "cargo.description": "cargo_description",
  "service.package": "service_package",
  "contacts.client_company": "client_company",
  "contacts.client_email": "client_email",
};

type QuoteFact = {
  id?: string;
  is_validated?: boolean;
  fact_key: string;
  value_text: string | null;
  value_number: number | null;
  value_json: unknown;
  source_type: string | null;
  source_excerpt: string | null;
};

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function factValueAsString(fact: QuoteFact | undefined): string {
  if (!fact) return "";
  if (typeof fact.value_text === "string" && fact.value_text.trim()) return fact.value_text.trim();
  if (typeof fact.value_number === "number") return String(fact.value_number);
  if (typeof fact.value_json === "string" || typeof fact.value_json === "number" || typeof fact.value_json === "boolean") {
    return String(fact.value_json);
  }
  if (fact.value_json && typeof fact.value_json === "object") {
    const obj = fact.value_json as Record<string, unknown>;
    if (typeof obj["value"] === "string" || typeof obj["value"] === "number") return String(obj["value"]);
  }
  return "";
}

function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function buildConfirmedFactsBlock(facts: QuoteFact[]): string {
  if (facts.length === 0) return "[CONFIRMED_FACTS]\n(none)";
  const lines = facts.map((fact) => {
    const label = FACT_LABELS[fact.fact_key] ?? fact.fact_key;
    const source = fact.source_type ? ` source=${fact.source_type}` : "";
    const excerpt = fact.source_excerpt ? ` excerpt=${JSON.stringify(fact.source_excerpt.slice(0, 180))}` : "";
    return `${label}=${factValueAsString(fact)}${source}${excerpt}`;
  });
  return `[CONFIRMED_FACTS]\n${lines.join("\n")}`;
}

function subjectMentionsPeking(subject: string | null): boolean {
  const normalized = normalizeText(subject);
  return normalized.includes("peking")
    || normalized.includes("pekin")
    || normalized.includes("dakar to peking")
    || normalized.includes("dakar a pekin");
}

export const analyzeServiceScopeHandler = async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  try {
    const { case_id, force_refresh } = await req.json();
    if (!case_id) return errorResponse("case_id is required", 400);
    const forceRefresh = force_refresh === true;

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
      .select("id, thread_id, email_threads(client_email)")
      .eq("id", case_id)
      .maybeSingle();

    if (caseErr || !quoteCase?.thread_id) {
      return errorResponse("Case not found or no thread linked", 404);
    }

    const { data: quoteFacts, error: factsErr } = await userClient
      .from("quote_facts")
      .select("id, fact_key, value_text, value_number, value_json, source_type, source_excerpt, is_validated")
      .eq("case_id", case_id)
      .eq("is_current", true)
      .in("fact_key", TARGET_FACT_KEYS);

    if (factsErr) {
      console.error("[analyze-service-scope] quote_facts load failed:", factsErr.message);
      return errorResponse("Failed to load confirmed facts", 500);
    }

    const confirmedFacts = ((quoteFacts ?? []) as QuoteFact[])
      .filter((fact) => factValueAsString(fact) !== "")
      .sort((a, b) => TARGET_FACT_KEYS.indexOf(a.fact_key) - TARGET_FACT_KEYS.indexOf(b.fact_key));
    const factsByKey = new Map(confirmedFacts.map((fact) => [fact.fact_key, factValueAsString(fact)]));
    const factsHash = stableHash(
      confirmedFacts.map((fact) => `${fact.fact_key}=${factValueAsString(fact)}`).join("|")
    );

    // 2. Fetch emails from thread (most recent first)
    const { data: emails, error: emailsErr } = await userClient
      .from("emails")
      .select("id, from_address, subject, body_text, sent_at")
      .eq("thread_ref", quoteCase.thread_id)
      .order("sent_at", { ascending: false })
      .limit(50);

    if (emailsErr || !emails?.length) {
      return errorResponse("No emails found for this thread", 404);
    }

    const latestEmail = emails[0];
    const latestEmailId = latestEmail.id;
    // Existing scope/reasoning/manual-action contracts; no fact, tariff or workflow mutation.
    const thread = quoteCase.email_threads as unknown as { client_email?: string } | null;
    const externalAddresses = [factsByKey.get('contacts.client_email') ?? '', thread?.client_email ?? ''];
    // Read human authority before any deterministic or AI fallback, including
    // when protected facts make the destination interpretation inapplicable.
    const { data: operatorScope, error: operatorScopeError } = await serviceClient.from('case_timeline_events')
      .select('id, event_data, related_email_id').eq('case_id', case_id)
      .eq('event_type', 'service_scope_v1').eq('actor_type', 'operator')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (operatorScopeError) return errorResponse('Failed to load operator scope', 500);
    const retainedScope = operatorScope ? readServiceScopeEvent(operatorScope.event_data) : null;
    if (operatorScope && !retainedScope) return errorResponse('Invalid operator scope; review required', 409);
    const requestEvidence = emails.length < 50
      ? deriveRequestServiceEvidence(emails, quoteFacts ?? [], externalAddresses)
      : null; // A truncated thread cannot establish the current request.
    if (requestEvidence || operatorScope) {
      const { data: timeline, error: timelineError, count } = await serviceClient.from('case_timeline_events')
        .select('id, event_type, actor_type, related_email_id, event_data', { count: 'exact' })
        .eq('case_id', case_id).in('event_type', ['service_scope_v1', 'case_reasoning_v1', 'manual_action'])
        .order('created_at', { ascending: false }).limit(200);
      if (timelineError || !Array.isArray(timeline) || count !== timeline.length) {
        return errorResponse('Failed to load complete scope/action history', 500);
      }
      const documentRequest = emails.length < 50
        ? requestEvidence?.document_request ?? deriveConsigneeDocumentRequest(emails, externalAddresses)
        : null;
      const documentAction = documentRequest
        ? documentVerificationAction(case_id, documentRequest, timeline)
        : null;
      if (operatorScope) {
        if (documentAction) {
          const { error } = await serviceClient.from('case_timeline_events').insert(documentAction);
          if (error) return errorResponse(`Failed to record consignee document action: ${error.message}`, 500);
        }
        const retainedReasoning = timeline.find(e => e.event_type === 'case_reasoning_v1' && e.related_email_id === operatorScope.related_email_id);
        return jsonResponse({ ok: true, idempotent: !documentAction, case_id, scope: retainedScope,
          reasoning: retainedReasoning?.event_data ?? null, request_proposal: requestEvidence,
          created: documentAction ? ['manual_action'] : [], operator_scope_preserved: true });
      }
      if (!requestEvidence) return errorResponse('Current request evidence unavailable', 409);
      const scope = {
        shipment_type: 'import', freight_scope: requestEvidence.freight_scope,
        freight_scope_basis: requestEvidence.freight_scope_basis, customs_scope: requestEvidence.services.some(s => s.service === 'CUSTOMS_DAKAR'), transit_scope: false,
        document_scope: !!requestEvidence.document_request, confidence: requestEvidence.mode === 'conflicting' ? 'low' : 'high',
        signals: ['Interprétation sourcée du périmètre destination ; aucune exclusion contractuelle inventée'],
        request_evidence: requestEvidence,
      };
      const reasoning = {
        summary: 'Prestations destination déduites de la demande du partenaire à l’origine',
        services_expected: requestEvidence.services.map(s => s.service),
        service_evidence: requestEvidence.services,
        blocking_assumptions: ['Interprétation de la demande, pas validation de conformité ni exclusion contractuelle'],
        questions_to_confirm: requestEvidence.mode === 'conflicting' ? ['Demandes de services contradictoires dans le même message : revue opérateur'] : [],
        confidence: requestEvidence.mode === 'conflicting' ? 'low' : 'high',
        document_request: requestEvidence.document_request,
      };
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ scope, reasoning }))))]
        .map(byte => byte.toString(16).padStart(2, '0')).join('');
      const key = `request-service-evidence:${case_id}:${digest}`;
      const created: string[] = [];
      const proposed = [
        { event_type: 'service_scope_v1', event_data: scope },
        { event_type: 'case_reasoning_v1', event_data: reasoning },
      ];
      for (const event of proposed) {
        if (timeline.some(e => e.event_type === event.event_type && e.event_data?.dedupe_key === key)) continue;
        const { error } = await serviceClient.from('case_timeline_events').insert({ case_id,
          ...event, actor_type: 'system', related_email_id: requestEvidence.source_email_id,
          event_data: { ...event.event_data, dedupe_key: key, model_meta: { model: 'deterministic', version: 'request-service-evidence-v1' } },
        });
        if (error) return errorResponse(`Failed to record ${event.event_type}: ${error.message}`, 500);
        created.push(event.event_type);
      }
      if (documentAction) {
        const { error } = await serviceClient.from('case_timeline_events').insert(documentAction);
        if (error) return errorResponse(`Failed to record consignee document action: ${error.message}`, 500);
        created.push('manual_action');
      }
      return jsonResponse({ ok: true, idempotent: created.length === 0, case_id, scope, reasoning, created, interpretation: true });
    }
    const originCountry = factsByKey.get("routing.origin_country") ?? "";
    const originPort = factsByKey.get("routing.origin_port") ?? factsByKey.get("routing.origin_airport") ?? "";
    const destinationCountry = factsByKey.get("routing.destination_country") ?? "";
    const destinationCity = factsByKey.get("routing.destination_city")
      ?? factsByKey.get("routing.destination_port")
      ?? factsByKey.get("routing.destination_airport")
      ?? "";
    const incoterm = factsByKey.get("routing.incoterm") ?? "";
    const staleSubject = subjectMentionsPeking(latestEmail.subject ?? null)
      && normalizeText(originCountry).includes("switzerland")
      && normalizeText(destinationCountry).includes("senegal");

    console.log(
      `[SCOPE-GROUND] facts_loaded=${confirmedFacts.length} origin=${originPort || originCountry || "unknown"} destination=${destinationCity || destinationCountry || "unknown"} incoterm=${incoterm || "unknown"} stale_subject=${staleSubject}`
    );

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

    if (!forceRefresh && existingTypes.has("service_scope_v1") && existingTypes.has("case_reasoning_v1")) {
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
    const confirmedFactsBlock = buildConfirmedFactsBlock(confirmedFacts);
    const staleSubjectBlock = staleSubject
      ? `\n\n[SUBJECT_LIKELY_STALE]\nEmail subject is likely stale/reused. Ignore the subject for route and shipment_type decisions. Use CONFIRMED_FACTS.`
      : "";
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

    const userPrompt = `${confirmedFactsBlock}${staleSubjectBlock}\n\n${latestBlock}${previousBlock}\n\nPriorité : fonder l'analyse sur CONFIRMED_FACTS. Utiliser LATEST_EMAIL et PREVIOUS_CONTEXT uniquement pour clarifier des ambiguïtés non résolues par les facts confirmés.`;

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
    const forceRefreshRunId = forceRefresh ? Date.now().toString(36) : "";
    const scopeDedupeKey = forceRefresh
      ? `service_scope_v1:${case_id}:${latestEmailId}:facts:${factsHash}:refresh:${forceRefreshRunId}`
      : `service_scope_v1:${case_id}:${latestEmailId}`;
    const reasoningDedupeKey = forceRefresh
      ? `case_reasoning_v1:${case_id}:${latestEmailId}:facts:${factsHash}:refresh:${forceRefreshRunId}`
      : `case_reasoning_v1:${case_id}:${latestEmailId}`;

    if (forceRefresh || !existingTypes.has("service_scope_v1")) {
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
        return errorResponse(`Failed to insert service_scope_v1: ${scopeErr.message}`, 500);
      }
      created.push("service_scope_v1");
    }

    if (forceRefresh || !existingTypes.has("case_reasoning_v1")) {
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
        return errorResponse(`Failed to insert case_reasoning_v1: ${reasoningErr.message}`, 500);
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
};
if (Deno.env.get('ANALYZE_SERVICE_SCOPE_DISABLE_SERVE') !== '1') serve(analyzeServiceScopeHandler);
