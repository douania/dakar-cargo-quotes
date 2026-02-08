/**
 * Phase M2.2 — find-similar-quotations
 *
 * Moteur de similarité pour cotations historiques.
 * Reçoit un profil de cotation, retourne les N cotations les plus proches
 * avec score et lignes tarifaires.
 *
 * Corrections CTO intégrées :
 * 1. Validation renforcée (destination_country + au moins 1 champ secondaire)
 * 2. Critère poids sécurisé (les deux > 0)
 * 3. Normalisation trim().toLowerCase()
 * 4. Limite max 20 côté serveur
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors } from "../_shared/cors.ts";
import {
  getCorrelationId,
  respondOk,
  respondError,
  logRuntimeEvent,
  type JsonObject,
} from "../_shared/runtime.ts";

// ============================================================================
// TYPES
// ============================================================================

interface SimilarityInput {
  origin_country?: string;
  destination_country: string;
  final_destination?: string;
  incoterm?: string;
  transport_mode?: string;
  cargo_description?: string;
  total_weight_kg?: number;
  hs_code?: string;
  carrier?: string;
  container_types?: string[];
  container_count?: number;
  limit?: number;
}

interface HistoricalProfile {
  quotation_id: string;
  origin_country: string | null;
  destination_country: string | null;
  final_destination: string | null;
  incoterm: string | null;
  transport_mode: string | null;
  cargo_description: string | null;
  total_weight_kg: number | null;
  hs_code: string | null;
  carrier: string | null;
  container_types: string[] | null;
  container_count: number | null;
  created_at: string;
}

interface QuotationLine {
  bloc: string | null;
  category: string | null;
  description: string | null;
  amount: number | null;
  currency: string | null;
}

interface SimilarQuotation {
  quotation_id: string;
  score: number;
  route: string;
  incoterm: string | null;
  transport_mode: string | null;
  cargo_description: string | null;
  total_weight_kg: number | null;
  lines: QuotationLine[];
}

// ============================================================================
// HELPERS
// ============================================================================

/** Normalize string for comparison (CTO correction 3) */
const n = (s: string | null | undefined): string =>
  (s || "").trim().toLowerCase();

/** Compute similarity score between input and a historical profile */
function computeScore(input: SimilarityInput, profile: HistoricalProfile): number {
  let score = 0;

  // Destination finale (+30)
  const inputFD = n(input.final_destination);
  if (inputFD && inputFD === n(profile.final_destination)) {
    score += 30;
  }

  // Pays destination (+20)
  if (n(input.destination_country) === n(profile.destination_country)) {
    score += 20;
  }

  // Mode transport (+10)
  if (n(input.transport_mode) && n(input.transport_mode) === n(profile.transport_mode)) {
    score += 10;
  }

  // Incoterm (+10)
  if (n(input.incoterm) && n(input.incoterm) === n(profile.incoterm)) {
    score += 10;
  }

  // HS code préfixe 4 chiffres (+10)
  if (input.hs_code && profile.hs_code) {
    if (input.hs_code.substring(0, 4) === profile.hs_code.substring(0, 4)) {
      score += 10;
    }
  }

  // Carrier (+5)
  if (n(input.carrier) && n(input.carrier) === n(profile.carrier)) {
    score += 5;
  }

  // Poids ±30% (+10) — CTO correction 2: seulement si les deux > 0
  const inputWeight = input.total_weight_kg ?? 0;
  const profileWeight = profile.total_weight_kg ?? 0;
  if (inputWeight > 0 && profileWeight > 0) {
    const ratio = inputWeight / profileWeight;
    if (ratio >= 0.7 && ratio <= 1.3) {
      score += 10;
    }
  }

  // Conteneurs intersection (+5)
  if (input.container_types?.length && profile.container_types?.length) {
    const inputSet = input.container_types.map(n);
    const profileSet = profile.container_types.map(n);
    const hasIntersection = inputSet.some((t) => profileSet.includes(t));
    if (hasIntersection) {
      score += 5;
    }
  }

  return score;
}

/** Categorize transport mode for hard filtering (Phase S1) */
function modeCategory(mode: string | null | undefined): string | null {
  const m = n(mode);
  if (!m) return null;
  if (m.includes('air')) return 'AIR';
  if (m.includes('sea') || m.includes('fcl') || m.includes('lcl')) return 'SEA';
  if (m.includes('road') || m.includes('truck')) return 'ROAD';
  return null;
}

/** Build route string from profile */
function buildRoute(profile: HistoricalProfile): string {
  const parts: string[] = [];
  if (profile.origin_country) parts.push(profile.origin_country);
  if (profile.destination_country) parts.push(profile.destination_country);
  if (profile.final_destination) parts.push(profile.final_destination);
  return parts.join(" → ");
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req: Request) => {
  // 1. CORS
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const t0 = Date.now();
  const correlationId = getCorrelationId(req);

  // Service client for DB operations & runtime logging
  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // 2. Auth — validate JWT via getClaims()
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: "find-similar-quotations",
        status: "fatal_error",
        errorCode: "AUTH_MISSING_JWT",
        httpStatus: 401,
        durationMs: Date.now() - t0,
      });
      return respondError({
        code: "AUTH_MISSING_JWT",
        message: "Authorization header missing or malformed",
        correlationId,
      });
    }

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } =
      await anonClient.auth.getClaims(token);

    if (claimsError || !claimsData?.claims) {
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: "find-similar-quotations",
        status: "fatal_error",
        errorCode: "AUTH_INVALID_JWT",
        httpStatus: 401,
        durationMs: Date.now() - t0,
      });
      return respondError({
        code: "AUTH_INVALID_JWT",
        message: "Invalid or expired JWT",
        correlationId,
      });
    }

    const userId = claimsData.claims.sub as string;

    // 3. Parse body
    const input: SimilarityInput = await req.json();

    // 4. Validation — CTO correction 1
    if (!input.destination_country?.trim()) {
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: "find-similar-quotations",
        op: "validate",
        userId,
        status: "fatal_error",
        errorCode: "VALIDATION_FAILED",
        httpStatus: 400,
        durationMs: Date.now() - t0,
      });
      return respondError({
        code: "VALIDATION_FAILED",
        message: "destination_country is required",
        correlationId,
      });
    }

    const hasSecondary =
      !!input.final_destination?.trim() ||
      !!input.cargo_description?.trim() ||
      !!input.hs_code?.trim();

    if (!hasSecondary) {
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: "find-similar-quotations",
        op: "validate",
        userId,
        status: "fatal_error",
        errorCode: "VALIDATION_FAILED",
        httpStatus: 400,
        durationMs: Date.now() - t0,
      });
      return respondError({
        code: "VALIDATION_FAILED",
        message:
          "At least one of final_destination, cargo_description, or hs_code is required",
        correlationId,
      });
    }

    // 5. Limit — CTO correction 4
    const limit = Math.min(input.limit ?? 5, 20);

    // 6. Load profiles
    const { data: profiles, error: profilesError } = await serviceClient
      .from("historical_quotation_profiles")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (profilesError) {
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: "find-similar-quotations",
        op: "load_profiles",
        userId,
        status: "retryable_error",
        errorCode: "UPSTREAM_DB_ERROR",
        httpStatus: 500,
        durationMs: Date.now() - t0,
        meta: { error: profilesError.message } as JsonObject,
      });
      return respondError({
        code: "UPSTREAM_DB_ERROR",
        message: "Failed to load historical profiles",
        correlationId,
      });
    }

    // 7. Hard exclusion + score in memory (Phase S1)
    const inputMode = modeCategory(input.transport_mode);

    const scored = (profiles as HistoricalProfile[])
      .filter((profile) => {
        // Hard filter 1: transport mode must be compatible
        if (inputMode) {
          const profileMode = modeCategory(profile.transport_mode);
          if (profileMode && profileMode !== inputMode) return false;
        }
        // Hard filter 2: weight ratio must be within 3x
        const iw = input.total_weight_kg ?? 0;
        const pw = profile.total_weight_kg ?? 0;
        if (iw > 0 && pw > 0) {
          const ratio = iw / pw;
          if (ratio > 3 || ratio < 0.33) return false;
        }
        return true;
      })
      .map((profile) => ({
        profile,
        score: computeScore(input, profile),
      }))
      .filter((item) => item.score >= 40)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // 8. Enrich with tariff lines
    const results: SimilarQuotation[] = [];

    for (const item of scored) {
      const { data: lines } = await serviceClient
        .from("historical_quotation_lines")
        .select("bloc, category, description, amount, currency")
        .eq("quotation_id", item.profile.quotation_id);

      results.push({
        quotation_id: item.profile.quotation_id,
        score: item.score,
        route: buildRoute(item.profile),
        incoterm: item.profile.incoterm,
        transport_mode: item.profile.transport_mode,
        cargo_description: item.profile.cargo_description,
        total_weight_kg: item.profile.total_weight_kg,
        lines: (lines as QuotationLine[]) || [],
      });
    }

    // 9. Success
    await logRuntimeEvent(serviceClient, {
      correlationId,
      functionName: "find-similar-quotations",
      op: "search",
      userId,
      status: "ok",
      httpStatus: 200,
      durationMs: Date.now() - t0,
      meta: {
        profiles_scanned: (profiles as HistoricalProfile[]).length,
        matches_found: results.length,
        top_score: results[0]?.score ?? 0,
      } as JsonObject,
    });

    return respondOk({ similar_quotations: results }, correlationId);
  } catch (err) {
    await logRuntimeEvent(serviceClient, {
      correlationId,
      functionName: "find-similar-quotations",
      status: "fatal_error",
      errorCode: "UNKNOWN",
      httpStatus: 500,
      durationMs: Date.now() - t0,
      meta: { error: String(err) } as JsonObject,
    });
    return respondError({
      code: "UNKNOWN",
      message: "Internal error in find-similar-quotations",
      correlationId,
    });
  }
});
