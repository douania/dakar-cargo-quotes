/**
 * M3.7 — price-service-lines
 * 
 * Deterministic pricing lookup for auto-injected service lines.
 * NO LLM — pure rate card matching with progressive fallback.
 * 
 * P0-1: Canonical service_key with whitelist
 * P0-2: Deterministic quantity (no silent assumption for per-unit)
 * P0-4: Idempotent audit via upsert (case_id, service_line_id)
 * P0-5: Ignores any rate from client, validates quantity/currency
 * P0-6: JWT client for RLS reads, service_role for pricing + audit
 * P1-A: Explicit match scoring (40–100)
 * P1-B: Date filtering on rate cards
 * P1-C: Unit normalization + mismatch detection
 * CTO-1: Currency normalization (FCFA → XOF canonical)
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCors } from "../_shared/cors.ts";
import {
  getCorrelationId,
  respondOk,
  respondError,
  structuredLog,
  logRuntimeEvent,
} from "../_shared/runtime.ts";

const FUNCTION_NAME = "price-service-lines";

// ═══ P0-1: Service key whitelist ═══
const VALID_SERVICE_KEYS = new Set([
  "DTHC", "ON_CARRIAGE", "EMPTY_RETURN", "DISCHARGE",
  "PORT_CHARGES", "TRUCKING", "CUSTOMS", "PORT_DAKAR_HANDLING",
  "CUSTOMS_DAKAR", "CUSTOMS_EXPORT", "BORDER_FEES", "AGENCY",
  "SURVEY", "CUSTOMS_BAMAKO", "TRANSIT_DOCS",
]);

// ═══ CTO-1: Currency normalization ═══
const CURRENCY_ALIASES: Record<string, string> = {
  FCFA: "XOF",
  CFA: "XOF",
};
const VALID_CURRENCIES = new Set(["XOF", "USD", "EUR"]);

function normalizeCurrency(raw: string): string | null {
  const upper = (raw || "").toUpperCase().trim();
  const mapped = CURRENCY_ALIASES[upper] || upper;
  return VALID_CURRENCIES.has(mapped) ? mapped : null;
}

// ═══ P1-C: Unit normalization ═══
const UNIT_ALIASES: Record<string, string> = {
  EVP: "EVP", TEU: "EVP",
  tonne: "TON", t: "TON", ton: "TON", TON: "TON",
  déclaration: "DECL", declaration: "DECL", decl: "DECL", DECL: "DECL",
  voyage: "VOYAGE", VOYAGE: "VOYAGE",
  forfait: "FORFAIT", FORFAIT: "FORFAIT",
};

function normalizeUnit(raw: string): string {
  return UNIT_ALIASES[raw] || UNIT_ALIASES[raw.toLowerCase()] || raw.toUpperCase();
}

// ═══ Types ═══
interface ServiceLineInput {
  id: string;
  service: string;
  unit: string;
  quantity: number;
  currency: string;
}

interface PricingContext {
  scope: string; // import | export | transit
  container_type: string | null;
  container_count: number | null;
  corridor: string | null;
  origin_port: string | null;
  destination_port: string | null;
  origin_country: string | null;
  destination_country: string | null;
}

interface PricedLine {
  id: string;
  rate: number | null;
  currency: string;
  source: string;
  confidence: number;
  explanation: string;
  quantity_assumed?: boolean;
}

Deno.serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const correlationId = getCorrelationId(req);
  const t0 = Date.now();

  try {
    // ═══ Auth: JWT validation ═══
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return respondError({ code: "AUTH_MISSING_JWT", message: "Missing authorization", correlationId });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // P0-6: JWT client for RLS reads
    const jwtClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await jwtClient.auth.getUser();
    if (authError || !user) {
      return respondError({ code: "AUTH_INVALID_JWT", message: "Invalid token", correlationId });
    }

    // P0-6: Service role client for pricing lookups + audit writes
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // ═══ Parse & validate input ═══
    const body = await req.json();
    const { case_id, service_lines } = body as {
      case_id: string;
      service_lines: ServiceLineInput[];
    };

    if (!case_id || !Array.isArray(service_lines) || service_lines.length === 0) {
      return respondError({
        code: "VALIDATION_FAILED",
        message: "case_id and non-empty service_lines required",
        correlationId,
      });
    }

    // ═══ Ownership check via JWT client (RLS) ═══
    const { data: caseData, error: caseError } = await jwtClient
      .from("quote_cases")
      .select("id, status")
      .eq("id", case_id)
      .single();

    if (caseError || !caseData) {
      return respondError({
        code: "FORBIDDEN_OWNER",
        message: "Case not found or access denied",
        correlationId,
      });
    }

    // ═══ Load facts for pricing context (JWT client, RLS) ═══
    const { data: facts } = await jwtClient
      .from("quote_facts")
      .select("fact_key, value_text, value_json, value_number")
      .eq("case_id", case_id)
      .eq("is_current", true);

    const factsMap = new Map((facts || []).map((f: { fact_key: string; value_text: string | null; value_json: unknown; value_number: number | null }) => [f.fact_key, f]));

    // ═══ Build pricing context from facts ═══
    const pricingCtx = buildPricingContext(factsMap);

    structuredLog({
      level: "info",
      service: FUNCTION_NAME,
      op: "pricing_context",
      correlationId,
      userId: user.id,
      meta: {
        case_id,
        scope: pricingCtx.scope,
        corridor: pricingCtx.corridor,
        container_type: pricingCtx.container_type,
        lines_count: service_lines.length,
      },
    });

    // ═══ Load all active rate cards (service role — public table) ═══
    const { data: rateCards, error: rcError } = await serviceClient
      .from("pricing_rate_cards")
      .select("*")
      .or("effective_from.is.null,effective_from.lte." + new Date().toISOString().split("T")[0])
      .or("effective_to.is.null,effective_to.gte." + new Date().toISOString().split("T")[0]);

    if (rcError) {
      structuredLog({ level: "error", service: FUNCTION_NAME, op: "load_rate_cards", correlationId, errorCode: "UPSTREAM_DB_ERROR" });
      return respondError({ code: "UPSTREAM_DB_ERROR", message: "Failed to load rate cards", correlationId });
    }

    const allCards = rateCards || [];

    // ═══ Price each line ═══
    const pricedLines: PricedLine[] = [];
    const missing: string[] = [];

    for (const line of service_lines) {
      // P0-5: Validate each line
      const serviceKey = line.service;
      if (!VALID_SERVICE_KEYS.has(serviceKey)) {
        structuredLog({ level: "warn", service: FUNCTION_NAME, op: "unknown_service_key", correlationId, meta: { service_key: serviceKey } });
        missing.push(serviceKey);
        pricedLines.push({
          id: line.id,
          rate: null,
          currency: "XOF",
          source: "unknown_service",
          confidence: 0,
          explanation: `Service key "${serviceKey}" not in whitelist`,
        });
        continue;
      }

      const currency = normalizeCurrency(line.currency);
      if (!currency) {
        pricedLines.push({
          id: line.id,
          rate: null,
          currency: line.currency,
          source: "invalid_currency",
          confidence: 0,
          explanation: `Currency "${line.currency}" not recognized`,
        });
        missing.push(serviceKey);
        continue;
      }

      // P0-5: Validate quantity
      const quantity = line.quantity;
      if (typeof quantity !== "number" || quantity < 0 || quantity > 10000) {
        pricedLines.push({
          id: line.id,
          rate: null,
          currency,
          source: "invalid_quantity",
          confidence: 0,
          explanation: `Quantity ${quantity} out of bounds [0, 10000]`,
        });
        missing.push(serviceKey);
        continue;
      }

      // P0-2: Determine effective quantity for per-unit services
      const lineUnit = normalizeUnit(line.unit);
      let effectiveQuantity = quantity;
      let quantityAssumed = false;

      if (lineUnit === "EVP" && quantity <= 1 && pricingCtx.container_count && pricingCtx.container_count > 1) {
        // Use container count from facts for EVP-based services
        effectiveQuantity = pricingCtx.container_count;
        quantityAssumed = true;
      } else if (lineUnit === "EVP" && quantity <= 1 && !pricingCtx.container_count) {
        // P0-2 CTO: Cannot assume quantity for per-container — missing_quantity
        pricedLines.push({
          id: line.id,
          rate: null,
          currency,
          source: "missing_quantity",
          confidence: 0,
          explanation: `Unit is EVP but container count unknown — operator must set quantity`,
        });
        missing.push(serviceKey);
        continue;
      }

      // ═══ P1-A: Progressive matching with scoring ═══
      const match = findBestRateCard(allCards, serviceKey, pricingCtx, lineUnit, currency);

      if (match) {
        pricedLines.push({
          id: line.id,
          rate: match.card.value,
          currency: match.card.currency || currency,
          source: match.card.source,
          confidence: match.score / 100,
          explanation: match.explanation,
          quantity_assumed: quantityAssumed,
        });
      } else {
        pricedLines.push({
          id: line.id,
          rate: null,
          currency,
          source: "no_match",
          confidence: 0,
          explanation: `No rate card found for ${serviceKey} (scope=${pricingCtx.scope}, unit=${lineUnit})`,
        });
        missing.push(serviceKey);
      }
    }

    // ═══ P0-4: Idempotent audit write via upsert ═══
    const auditRows = pricedLines.map((pl) => ({
      case_id,
      service_line_id: pl.id,
      service_key: service_lines.find((sl) => sl.id === pl.id)?.service || "UNKNOWN",
      suggested_rate: pl.rate,
      currency: pl.currency,
      source: pl.source,
      confidence: pl.confidence,
      explanation: pl.explanation,
    }));

    if (auditRows.length > 0) {
      const { error: auditError } = await serviceClient
        .from("quote_service_pricing")
        .upsert(auditRows, { onConflict: "case_id,service_line_id" });

      if (auditError) {
        structuredLog({ level: "warn", service: FUNCTION_NAME, op: "audit_write_failed", correlationId, meta: { error: String(auditError.message) } });
      }
    }

    const durationMs = Date.now() - t0;

    await logRuntimeEvent(serviceClient, {
      correlationId,
      functionName: FUNCTION_NAME,
      op: "price",
      userId: user.id,
      status: "ok",
      httpStatus: 200,
      durationMs,
      meta: { priced: pricedLines.filter((l) => l.rate !== null).length, missing: missing.length },
    });

    return respondOk(
      {
        priced_lines: pricedLines,
        missing,
        summary: {
          priced: pricedLines.filter((l) => l.rate !== null).length,
          missing: missing.length,
          total: pricedLines.length,
        },
      },
      correlationId
    );
  } catch (err) {
    const durationMs = Date.now() - t0;
    structuredLog({
      level: "error",
      service: FUNCTION_NAME,
      op: "unhandled",
      correlationId,
      errorCode: "UNKNOWN",
      durationMs,
      meta: { error: String(err) },
    });
    return respondError({ code: "UNKNOWN", message: "Internal error", correlationId });
  }
});

// ═══════════════════════════════════════════════════════════════
// PRICING CONTEXT FROM FACTS
// ═══════════════════════════════════════════════════════════════

function buildPricingContext(
  factsMap: Map<string, { value_text: string | null; value_json: unknown; value_number: number | null }>
): PricingContext {
  // Derive scope from flow type
  const flowType = factsMap.get("service.flow_type")?.value_text || "";
  let scope = "import";
  if (/EXPORT/i.test(flowType)) scope = "export";
  else if (/TRANSIT/i.test(flowType)) scope = "transit";

  // Container type
  let containerType: string | null = null;
  let containerCount: number | null = null;
  const containersFact = factsMap.get("cargo.containers");
  if (containersFact?.value_json && Array.isArray(containersFact.value_json)) {
    const containers = containersFact.value_json as Array<{ type: string; quantity: number }>;
    if (containers.length > 0) {
      // Use the first/primary container type, normalize
      let ct = containers[0].type.replace(/['\s]/g, "").toUpperCase();
      if (ct === "40") ct = "40HC";
      if (ct === "20") ct = "20DV";
      containerType = ct;
      containerCount = containers.reduce((sum, c) => sum + (c.quantity || 1), 0);
    }
  }

  // Corridor detection
  const destCity = factsMap.get("routing.destination_city")?.value_text?.toUpperCase() || "";
  const destCountry = factsMap.get("routing.destination_country")?.value_text?.toUpperCase() || "";
  let corridor: string | null = null;
  if (destCity.includes("BAMAKO") || destCountry.includes("MALI")) corridor = "DAKAR_BAMAKO";
  else if (destCity.includes("BANJUL") || destCountry.includes("GAMBI")) corridor = "DAKAR_BANJUL";

  // Ports & countries
  const originPort = factsMap.get("routing.origin_port")?.value_text || null;
  const destPort = factsMap.get("routing.destination_port")?.value_text || null;
  const originCountry = factsMap.get("routing.origin_country")?.value_text || null;
  const destCountryVal = factsMap.get("routing.destination_country")?.value_text || null;

  return {
    scope,
    container_type: containerType,
    container_count: containerCount,
    corridor,
    origin_port: originPort,
    destination_port: destPort,
    origin_country: originCountry,
    destination_country: destCountryVal,
  };
}

// ═══════════════════════════════════════════════════════════════
// RATE CARD MATCHING — P1-A DETERMINISTIC SCORING
// ═══════════════════════════════════════════════════════════════

interface RateCardRow {
  id: string;
  service_key: string;
  scope: string;
  currency: string;
  unit: string;
  value: number;
  source: string;
  confidence: number;
  container_type: string | null;
  corridor: string | null;
  origin_port: string | null;
  destination_port: string | null;
  origin_country: string | null;
  destination_country: string | null;
  effective_from: string | null;
  effective_to: string | null;
  min_charge: number | null;
  notes: string | null;
}

function findBestRateCard(
  allCards: RateCardRow[],
  serviceKey: string,
  ctx: PricingContext,
  lineUnit: string,
  lineCurrency: string
): { card: RateCardRow; score: number; explanation: string } | null {
  // Filter: must match service_key
  const candidates = allCards.filter((c) => c.service_key === serviceKey);
  if (candidates.length === 0) return null;

  let bestCard: RateCardRow | null = null;
  let bestScore = -1;
  let bestExplanation = "";

  for (const card of candidates) {
    let score = 40; // Base: service_key match only
    const matchParts: string[] = [serviceKey];

    // P1-C: Unit check
    const cardUnit = normalizeUnit(card.unit);
    if (cardUnit !== lineUnit) {
      continue; // Skip — unit_mismatch (don't even score)
    }

    // Scope match
    if (card.scope === ctx.scope) {
      score += 20;
      matchParts.push(ctx.scope);
    } else {
      continue; // Scope mismatch = skip entirely
    }

    // Container type match
    if (ctx.container_type && card.container_type) {
      if (card.container_type === ctx.container_type) {
        score += 20;
        matchParts.push(ctx.container_type);
      } else {
        score -= 10; // Wrong container type penalty
      }
    }

    // Corridor match
    if (ctx.corridor && card.corridor) {
      if (card.corridor === ctx.corridor) {
        score += 20;
        matchParts.push(card.corridor);
      } else {
        score -= 5; // Wrong corridor penalty
      }
    } else if (ctx.corridor && !card.corridor) {
      // Generic card (no corridor specified) — acceptable but lower score
    }

    // Currency match (prefer same currency)
    const cardCurrency = normalizeCurrency(card.currency) || card.currency;
    if (cardCurrency === lineCurrency) {
      score += 5;
    }

    // Card confidence boost
    score += Math.round(card.confidence * 5);

    if (score > bestScore) {
      bestScore = score;
      bestCard = card;
      bestExplanation = `match: ${matchParts.join("+")}, score=${score}, rate_card=${card.id.slice(0, 8)}`;
    }
  }

  if (!bestCard || bestScore < 40) return null;

  return { card: bestCard, score: bestScore, explanation: bestExplanation };
}
