import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import {projectVolumeAdvice,stableCoherenceInput} from "../_shared/cargo-volume-advice.ts";
import {contractHash} from "../_shared/request-source-contract.ts";

// ── Types ──
interface DerivedCandidate {
  fact_key: string;
  value_number: number;
  reason_code: string;
  auto_applicable: boolean;
  explanation_fr: string;
}

interface ContradictionFlag {
  code: string;
  severity: "warning" | "error";
  message_fr: string;
}

interface CoherenceWarning {
  code: string;
  severity: "warning";
  message_fr: string;
}

interface FalseBlockerCandidate {
  gap_key: string;
  reason_code: string;
  message_fr: string;
}

interface CoherenceResult {
  related_email_id: string | null;
  intent_event_id: string | null;
  dedupe_key: string;
  summary: string;
  confidence: number;
  contradiction_flags: ContradictionFlag[];
  warnings: CoherenceWarning[];
  derived_candidates: DerivedCandidate[];
  operator_guidance: string[];
  suggested_client_questions: string[];
  false_blocker_candidates: FalseBlockerCandidate[];
}

// ── Helpers ──
export const analyzeCaseCoherenceHandler = async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  try {
    const { case_id, related_email_id } = await req.json();
    if (!case_id) return errorResponse("case_id is required", 400);

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

    // ── 1. Load latest thread_intent_v1 ──
    const intentQuery = serviceClient
      .from("case_timeline_events")
      .select("id, event_data, related_email_id")
      .eq("case_id", case_id)
      .eq("event_type", "thread_intent_v1")
      .order("created_at", { ascending: false })
      .limit(5);

    const { data: intentEvents, error: intentReadError } = await intentQuery;
    if(intentReadError)return errorResponse("Coherence intent unavailable",503);

    // Prefer intent matching related_email_id if provided
    let intentEvent = intentEvents?.[0] ?? null;
    if (related_email_id && intentEvents) {
      const matching = intentEvents.find((e) => e.related_email_id === related_email_id);
      if (matching) intentEvent = matching;
    }

    const intentEventId = intentEvent?.id ?? null;
    const effectiveEmailId = related_email_id || intentEvent?.related_email_id || null;

    const [factsRes, gapsRes] = await Promise.all([
      userClient
        .from("quote_facts")
        .select("fact_key, fact_category, value_text, value_number, value_json, source_type, is_validated")
        .eq("case_id", case_id)
        .eq("is_current", true),
      userClient
        .from("quote_gaps")
        .select("gap_key, gap_category, is_blocking, status")
        .eq("case_id", case_id)
        .eq("status", "open"),
    ]);

    if (factsRes.error || gapsRes.error || !Array.isArray(factsRes.data) || !Array.isArray(gapsRes.data)) return errorResponse("Current coherence inputs unavailable", 503);
    const facts = factsRes.data ?? [];
    const gaps = gapsRes.data ?? [];
    const ordered = (values: unknown[]) => [...values].sort((a,b)=>stableCoherenceInput(a).localeCompare(stableCoherenceInput(b)));
    const input_hash=await contractHash(stableCoherenceInput({rule_version:2,related_email_id:effectiveEmailId,
      intent_event_id:intentEventId,intent:intentEvent?.event_data??null,facts:ordered(facts),gaps:ordered(gaps)}));
    const dedupe_key=`${case_id}_case_coherence_v2_${input_hash}`;
    // Validate current inputs before reusing advice. Old snapshots remain append-only.
    let cacheQuery=serviceClient.from("case_timeline_events").select("id, event_data")
      .eq("case_id",case_id).eq("event_type","case_coherence_v1");
    cacheQuery=effectiveEmailId?cacheQuery.eq("related_email_id",effectiveEmailId):cacheQuery.is("related_email_id",null);
    const {data:existing,error:cacheError}=await cacheQuery.order("created_at",{ascending:false}).limit(1).maybeSingle();
    if(cacheError)return errorResponse("Coherence history unavailable",503);
    const cached=existing?.event_data as Record<string,unknown>|null;
    if(cached?.rule_version===2&&cached.input_hash===input_hash)return jsonResponse({ok:true,idempotent:true,coherence:cached});

    const blockingGapKeys = new Set(gaps.filter((g) => g.is_blocking).map((g) => g.gap_key));

    // Extract intent data
    const intentData = intentEvent?.event_data as Record<string, unknown> | null;
    const intentObj = (intentData?.["intent"] as Record<string, unknown>) ?? {};
    const extractedSignals = (intentObj["extracted_signals"] as Record<string, boolean>) ?? {};
    const transportHypothesis = (intentObj["transport_mode_hypothesis"] as string) ?? "unknown";
    const scopeHypothesis = (intentObj["shipment_scope_hypothesis"] as string) ?? "unknown";

    // ── 4. Apply rules ──
    const contradictions: ContradictionFlag[] = [];
    const warnings: CoherenceWarning[] = [];
    const derivedCandidates: DerivedCandidate[] = [];
    const operatorGuidance: string[] = [];
    const suggestedQuestions: string[] = [];
    const falseBlockerCandidates: FalseBlockerCandidate[] = [];

    // ── Rule 2: LCL + explicit container → contradiction ──
    if (extractedSignals["has_lcl_signal"] && extractedSignals["has_container_signal"]) {
      contradictions.push({
        code: "LCL_WITH_CONTAINER",
        severity: "warning",
        message_fr: "Signal LCL/groupage détecté mais un conteneur (20ft/40ft) est aussi mentionné. Clarification nécessaire.",
      });
      suggestedQuestions.push(
        "Pouvez-vous confirmer si l'expédition est en LCL (groupage) ou en FCL (conteneur complet) ?"
      );
      operatorGuidance.push(
        "Vérifier avec le client si la mention du conteneur est indicative ou structurante."
      );
    }

    // ── Rule 3: AIR + container → contradiction ──
    if (extractedSignals["has_air_signal"] && extractedSignals["has_container_signal"]) {
      contradictions.push({
        code: "AIR_WITH_CONTAINER",
        severity: "warning",
        message_fr: "Signal aérien détecté mais un conteneur maritime est aussi mentionné. Incohérence probable.",
      });
      suggestedQuestions.push(
        "Pouvez-vous confirmer le mode de transport souhaité : aérien ou maritime ?"
      );
      operatorGuidance.push(
        "Le client semble mentionner à la fois l'aérien et un conteneur. Clarifier le mode avant pricing."
      );
    }

    // ── Rule 4: Scope mismatch (warning only) ──
    const transportOnlyScopes = new Set(["quote_transport_only"]);
    const customsGapKeys = ["customs.regime_code", "customs.hs_code_validated", "cargo.hs_code"];
    const hasCustomsBlockers = customsGapKeys.some((k) => blockingGapKeys.has(k));

    if (transportOnlyScopes.has(scopeHypothesis) && hasCustomsBlockers) {
      warnings.push({
        code: "POSSIBLE_SCOPE_MISMATCH",
        severity: "warning",
        message_fr: "Le client semble demander un devis transport uniquement, mais des blockers douaniers restent ouverts. Vérification opérateur recommandée.",
      });
      operatorGuidance.push(
        "Si le client veut uniquement un prix de transport (sans droits/taxes), les blockers douaniers peuvent être ignorés ou waivés."
      );
    }

    // ── Build summary ──
    const summaryParts: string[] = [];
    if (contradictions.length > 0) {
      summaryParts.push(`${contradictions.length} contradiction(s) détectée(s)`);
    }
    if (warnings.length > 0) {
      summaryParts.push(`${warnings.length} avertissement(s)`);
    }
    if (derivedCandidates.length > 0) {
      summaryParts.push(`${derivedCandidates.length} fait(s) dérivable(s)`);
    }
    if (falseBlockerCandidates.length > 0) {
      summaryParts.push(`${falseBlockerCandidates.length} gap(s) potentiellement résolvable(s) automatiquement`);
    }

    const summary = summaryParts.length > 0
      ? summaryParts.join(", ") + "."
      : "Aucune incohérence détectée.";

    const confidence = contradictions.length === 0 && warnings.length === 0 ? 0.95 : 0.7;

    // ── 5. Build result ──
    const baseResult: CoherenceResult = {
      related_email_id: effectiveEmailId,
      intent_event_id: intentEventId,
      dedupe_key,
      summary,
      confidence,
      contradiction_flags: contradictions,
      warnings,
      derived_candidates: derivedCandidates,
      operator_guidance: operatorGuidance,
      suggested_client_questions: suggestedQuestions,
      false_blocker_candidates: falseBlockerCandidates,
    };

    const coherenceResult={...projectVolumeAdvice(baseResult as unknown as Record<string,unknown>,facts,gaps.map(g=>g.gap_key)),rule_version:2,input_hash};
    // Informational snapshot only: no canonical fact or gap mutation.
    // ── 6. Insert timeline event ──
    const { error: insertErr } = await serviceClient
      .from("case_timeline_events")
      .insert({
        case_id,
        event_type: "case_coherence_v1",
        related_email_id: effectiveEmailId,
        actor_type: "ai",
        event_data: coherenceResult,
      });

    if (insertErr) {
      console.warn("[analyze-case-coherence] Timeline insert failed:", insertErr.message);
      return jsonResponse({ ok: false, error: "TIMELINE_INSERT_FAILED" }, 200);
    }

    return jsonResponse({
      ok: true,
      case_id,
      idempotent: false,
      coherence: coherenceResult,
    });
  } catch (err) {
    console.error("[analyze-case-coherence] Unexpected error:", (err as Error).message);
    return errorResponse("Internal server error", 500);
  }
};
if(Deno.env.get("ANALYZE_CASE_COHERENCE_DISABLE_SERVE")!=="1")serve(analyzeCaseCoherenceHandler);
