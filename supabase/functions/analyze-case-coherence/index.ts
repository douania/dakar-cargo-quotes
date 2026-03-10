import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

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
function parseDimensions(dimText: string): { l: number; w: number; h: number; unit: string } | null {
  // Support formats: "120x80x100 cm", "1.2x0.8x1.0 m", "120 x 80 x 100cm"
  const match = dimText.match(
    /(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)\s*(cm|m|mm)?/i
  );
  if (!match) return null;
  const l = parseFloat(match[1].replace(",", "."));
  const w = parseFloat(match[2].replace(",", "."));
  const h = parseFloat(match[3].replace(",", "."));
  if (!match[4]) return null; // No unit = ambiguous, skip
  const unit = match[4].toLowerCase();
  return { l, w, h, unit };
}

function dimensionsToVolumeCbm(l: number, w: number, h: number, unit: string): number {
  let factor = 1;
  if (unit === "cm") factor = 1e-6;
  else if (unit === "mm") factor = 1e-9;
  // m → already cbm
  return l * w * h * factor;
}

serve(async (req: Request) => {
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
    let intentQuery = serviceClient
      .from("case_timeline_events")
      .select("id, event_data, related_email_id")
      .eq("case_id", case_id)
      .eq("event_type", "thread_intent_v1")
      .order("created_at", { ascending: false })
      .limit(5);

    const { data: intentEvents } = await intentQuery;

    // Prefer intent matching related_email_id if provided
    let intentEvent = intentEvents?.[0] ?? null;
    if (related_email_id && intentEvents) {
      const matching = intentEvents.find((e) => e.related_email_id === related_email_id);
      if (matching) intentEvent = matching;
    }

    const intentEventId = intentEvent?.id ?? null;
    const effectiveEmailId = related_email_id || intentEvent?.related_email_id || null;

    // ── 2. Idempotence check ──
    const dedupe_key = `${case_id}_case_coherence_v1_${effectiveEmailId ?? intentEventId ?? "no_ref"}`;

    const { data: existing } = await serviceClient
      .from("case_timeline_events")
      .select("id, event_data")
      .eq("case_id", case_id)
      .eq("event_type", "case_coherence_v1")
      .eq("related_email_id", effectiveEmailId ?? "")
      .maybeSingle();

    // Also check by dedupe_key in event_data for robustness
    if (existing) {
      return jsonResponse({
        ok: true,
        idempotent: true,
        coherence: existing.event_data,
      });
    }

    // If no email ref, also check by intent_event_id
    if (!effectiveEmailId && intentEventId) {
      const { data: existingByIntent } = await serviceClient
        .from("case_timeline_events")
        .select("id, event_data")
        .eq("case_id", case_id)
        .eq("event_type", "case_coherence_v1")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingByIntent) {
        const ed = existingByIntent.event_data as Record<string, unknown> | null;
        if (ed?.["intent_event_id"] === intentEventId) {
          return jsonResponse({
            ok: true,
            idempotent: true,
            coherence: existingByIntent.event_data,
          });
        }
      }
    }

    // ── 3. Load facts + gaps ──
    const [factsRes, gapsRes] = await Promise.all([
      userClient
        .from("quote_facts")
        .select("fact_key, fact_category, value_text, value_number, value_json")
        .eq("case_id", case_id)
        .eq("is_current", true),
      userClient
        .from("quote_gaps")
        .select("gap_key, gap_category, is_blocking, status")
        .eq("case_id", case_id)
        .eq("status", "open"),
    ]);

    const facts = factsRes.data ?? [];
    const gaps = gapsRes.data ?? [];

    // Build lookup maps
    const factByKey = new Map<string, { value_text: string | null; value_number: number | null; value_json: unknown }>();
    for (const f of facts) {
      factByKey.set(f.fact_key, { value_text: f.value_text, value_number: f.value_number, value_json: f.value_json });
    }

    const openGapKeys = new Set(gaps.map((g) => g.gap_key));
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

    // ── Rule 1: dimensions → volume candidate ──
    const dimFact = factByKey.get("cargo.dimensions");
    const volumeFact = factByKey.get("cargo.volume_cbm");
    if (dimFact?.value_text && (!volumeFact || volumeFact.value_number === null)) {
      const dims = parseDimensions(dimFact.value_text);
      if (dims) {
        const volumeCbm = dimensionsToVolumeCbm(dims.l, dims.w, dims.h, dims.unit);
        if (volumeCbm > 0 && volumeCbm < 10000) {
          derivedCandidates.push({
            fact_key: "cargo.volume_cbm",
            value_number: Math.round(volumeCbm * 1000) / 1000,
            reason_code: "DIMENSIONS_TO_VOLUME",
            auto_applicable: true,
            explanation_fr: `Volume calculé depuis dimensions ${dimFact.value_text}: ${(Math.round(volumeCbm * 1000) / 1000)} m³`,
          });

          // Rule 5 (narrowed): If gap exists for volume, flag as potential false blocker
          if (openGapKeys.has("cargo.volume_cbm")) {
            falseBlockerCandidates.push({
              gap_key: "cargo.volume_cbm",
              reason_code: "DERIVABLE_FROM_DIMENSIONS",
              message_fr: "Ce gap peut être résolu automatiquement à partir des dimensions du colis.",
            });
          }
        }
      }
    }

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
    const coherenceResult: CoherenceResult = {
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
});
