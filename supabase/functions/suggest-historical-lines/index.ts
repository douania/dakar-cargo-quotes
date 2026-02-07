/**
 * Phase M2.3 — suggest-historical-lines
 *
 * Recommandation intelligente de lignes tarifaires basée sur l'historique.
 * Réutilise la logique de scoring M2.2 en interne (pas d'appel HTTP).
 * Agrège les lignes des cotations similaires et propose des suggestions
 * avec un score de confiance.
 *
 * Purement consultatif — zéro impact sur le moteur normatif.
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

interface RecommendationInput {
  destination_country: string;
  final_destination?: string;
  origin_country?: string;
  incoterm?: string;
  transport_mode?: string;
  cargo_description?: string;
  total_weight_kg?: number;
  hs_code?: string;
  carrier?: string;
  container_types?: string[];
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

interface AggregatedLine {
  bloc: string;
  category: string;
  description: string;
  total_amount: number;
  count: number;
  currencies: Set<string>;
}

interface SuggestedLine {
  bloc: string;
  category: string;
  description: string;
  suggested_amount: number;
  currency: string;
  confidence: number;
  based_on: number;
}

// ============================================================================
// SCORING (same logic as M2.2)
// ============================================================================

const n = (s: string | null | undefined): string =>
  (s || "").trim().toLowerCase();

function computeScore(input: RecommendationInput, profile: HistoricalProfile): number {
  let score = 0;

  const inputFD = n(input.final_destination);
  if (inputFD && inputFD === n(profile.final_destination)) score += 30;

  if (n(input.destination_country) === n(profile.destination_country)) score += 20;

  if (n(input.transport_mode) && n(input.transport_mode) === n(profile.transport_mode)) score += 10;

  if (n(input.incoterm) && n(input.incoterm) === n(profile.incoterm)) score += 10;

  if (input.hs_code && profile.hs_code) {
    if (input.hs_code.substring(0, 4) === profile.hs_code.substring(0, 4)) score += 10;
  }

  if (n(input.carrier) && n(input.carrier) === n(profile.carrier)) score += 5;

  const inputWeight = input.total_weight_kg ?? 0;
  const profileWeight = profile.total_weight_kg ?? 0;
  if (inputWeight > 0 && profileWeight > 0) {
    const ratio = inputWeight / profileWeight;
    if (ratio >= 0.7 && ratio <= 1.3) score += 10;
  }

  if (input.container_types?.length && profile.container_types?.length) {
    const inputSet = input.container_types.map(n);
    const profileSet = profile.container_types.map(n);
    if (inputSet.some((t) => profileSet.includes(t))) score += 5;
  }

  return score;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const t0 = Date.now();
  const correlationId = getCorrelationId(req);
  const FN = "suggest-historical-lines";

  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // 1. Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      await logRuntimeEvent(serviceClient, {
        correlationId, functionName: FN, status: "fatal_error",
        errorCode: "AUTH_MISSING_JWT", httpStatus: 401, durationMs: Date.now() - t0,
      });
      return respondError({ code: "AUTH_MISSING_JWT", message: "Authorization header missing or malformed", correlationId });
    }

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);

    if (claimsError || !claimsData?.claims) {
      await logRuntimeEvent(serviceClient, {
        correlationId, functionName: FN, status: "fatal_error",
        errorCode: "AUTH_INVALID_JWT", httpStatus: 401, durationMs: Date.now() - t0,
      });
      return respondError({ code: "AUTH_INVALID_JWT", message: "Invalid or expired JWT", correlationId });
    }

    const userId = claimsData.claims.sub as string;

    // 2. Parse & validate
    const input: RecommendationInput = await req.json();

    if (!input.destination_country?.trim()) {
      await logRuntimeEvent(serviceClient, {
        correlationId, functionName: FN, op: "validate", userId,
        status: "fatal_error", errorCode: "VALIDATION_FAILED", httpStatus: 400, durationMs: Date.now() - t0,
      });
      return respondError({ code: "VALIDATION_FAILED", message: "destination_country is required", correlationId });
    }

    const hasSecondary = !!input.final_destination?.trim() || !!input.cargo_description?.trim() || !!input.hs_code?.trim();
    if (!hasSecondary) {
      await logRuntimeEvent(serviceClient, {
        correlationId, functionName: FN, op: "validate", userId,
        status: "fatal_error", errorCode: "VALIDATION_FAILED", httpStatus: 400, durationMs: Date.now() - t0,
      });
      return respondError({
        code: "VALIDATION_FAILED",
        message: "At least one of final_destination, cargo_description, or hs_code is required",
        correlationId,
      });
    }

    // 3. Limit (default 3, max 10 for recommendations)
    const limit = Math.min(input.limit ?? 3, 10);

    // 4. Load profiles
    const { data: profiles, error: profilesError } = await serviceClient
      .from("historical_quotation_profiles")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (profilesError) {
      await logRuntimeEvent(serviceClient, {
        correlationId, functionName: FN, op: "load_profiles", userId,
        status: "retryable_error", errorCode: "UPSTREAM_DB_ERROR", httpStatus: 500,
        durationMs: Date.now() - t0, meta: { error: profilesError.message } as JsonObject,
      });
      return respondError({ code: "UPSTREAM_DB_ERROR", message: "Failed to load historical profiles", correlationId });
    }

    // 5. Score & filter
    const scored = (profiles as HistoricalProfile[])
      .map((profile) => ({ profile, score: computeScore(input, profile) }))
      .filter((item) => item.score >= 40)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const totalQuotations = scored.length;

    if (totalQuotations === 0) {
      await logRuntimeEvent(serviceClient, {
        correlationId, functionName: FN, op: "suggest", userId,
        status: "ok", httpStatus: 200, durationMs: Date.now() - t0,
        meta: { profiles_scanned: (profiles as HistoricalProfile[]).length, matches: 0 } as JsonObject,
      });
      return respondOk({ suggested_lines: [], based_on_quotations: 0 }, correlationId);
    }

    // 6. Load lines for matched quotations
    const quotationIds = scored.map((s) => s.profile.quotation_id);
    const { data: allLines, error: linesError } = await serviceClient
      .from("historical_quotation_lines")
      .select("quotation_id, bloc, category, description, amount, currency")
      .in("quotation_id", quotationIds);

    if (linesError) {
      await logRuntimeEvent(serviceClient, {
        correlationId, functionName: FN, op: "load_lines", userId,
        status: "retryable_error", errorCode: "UPSTREAM_DB_ERROR", httpStatus: 500,
        durationMs: Date.now() - t0, meta: { error: linesError.message } as JsonObject,
      });
      return respondError({ code: "UPSTREAM_DB_ERROR", message: "Failed to load quotation lines", correlationId });
    }

    // 7. Aggregate lines by bloc|category|description
    const aggregated = new Map<string, AggregatedLine>();

    for (const line of (allLines as QuotationLine[]) || []) {
      const bloc = (line.bloc || "").trim();
      const category = (line.category || "").trim();
      const description = (line.description || "").trim();
      const key = `${bloc}|${category}|${description}`;

      if (!bloc && !category && !description) continue;

      const existing = aggregated.get(key);
      if (existing) {
        existing.total_amount += line.amount ?? 0;
        existing.count += 1;
        if (line.currency) existing.currencies.add(line.currency);
      } else {
        aggregated.set(key, {
          bloc, category, description,
          total_amount: line.amount ?? 0,
          count: 1,
          currencies: new Set(line.currency ? [line.currency] : []),
        });
      }
    }

    // 8. Build suggestions with confidence filtering
    const suggestedLines: SuggestedLine[] = [];

    for (const agg of aggregated.values()) {
      const confidence = agg.count / totalQuotations;
      if (confidence < 0.5) continue;

      // Pick majority currency (first in set)
      const currency = agg.currencies.size > 0
        ? Array.from(agg.currencies)[0]
        : "XOF";

      suggestedLines.push({
        bloc: agg.bloc,
        category: agg.category,
        description: agg.description,
        suggested_amount: Math.round(agg.total_amount / agg.count),
        currency,
        confidence: Math.round(confidence * 100) / 100,
        based_on: agg.count,
      });
    }

    // Sort by confidence desc, then by amount desc
    suggestedLines.sort((a, b) =>
      b.confidence - a.confidence || b.suggested_amount - a.suggested_amount
    );

    // 9. Success
    await logRuntimeEvent(serviceClient, {
      correlationId, functionName: FN, op: "suggest", userId,
      status: "ok", httpStatus: 200, durationMs: Date.now() - t0,
      meta: {
        profiles_scanned: (profiles as HistoricalProfile[]).length,
        matches: totalQuotations,
        suggestions_count: suggestedLines.length,
      } as JsonObject,
    });

    return respondOk({ suggested_lines: suggestedLines, based_on_quotations: totalQuotations }, correlationId);
  } catch (err) {
    await logRuntimeEvent(serviceClient, {
      correlationId, functionName: FN, status: "fatal_error",
      errorCode: "UNKNOWN", httpStatus: 500, durationMs: Date.now() - t0,
      meta: { error: String(err) } as JsonObject,
    });
    return respondError({ code: "UNKNOWN", message: "Internal error in suggest-historical-lines", correlationId });
  }
});
