/**
 * M3.7 — price-service-lines (Phase T3)
 * 
 * Deterministic pricing lookup for auto-injected service lines.
 * NO LLM — pure rate card matching with progressive fallback.
 * 
 * T3: Quantity computed from service_quantity_rules + unit_conversions tables
 * T3: Fallback to port_tariffs for DTHC when no rate card match
 * 
 * P0-1: Canonical service_key with whitelist
 * P0-2: Deterministic quantity via DB rules (no silent assumption)
 * P0-4: Idempotent audit via upsert (case_id, service_line_id)
 * P0-5: Ignores any rate from client, validates quantity/currency
 * P0-6: JWT client for RLS reads, service_role for pricing + audit
 * P1-A: Explicit match scoring (40–100)
 * P1-B: Date filtering on rate cards
 * P1-C: Unit normalization + mismatch detection
 * CTO-1: Currency normalization (FCFA → XOF canonical)
 * CTO-T3: COUNT depends on service_key (TRUCKING ≥40' rule)
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
import { requireUser } from "../_shared/auth.ts";

const FUNCTION_NAME = "price-service-lines";

// ═══ P0-1: Service key whitelist ═══
const VALID_SERVICE_KEYS = new Set([
  "DTHC", "ON_CARRIAGE", "EMPTY_RETURN", "DISCHARGE",
  "PORT_CHARGES", "TRUCKING", "CUSTOMS", "PORT_DAKAR_HANDLING",
  "CUSTOMS_DAKAR", "CUSTOMS_EXPORT", "BORDER_FEES", "AGENCY",
  "SURVEY", "CUSTOMS_BAMAKO", "TRANSIT_DOCS",
  "AIR_HANDLING", "AIR_FREIGHT",
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
  kg: "KG", KG: "KG",
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
  scope: string;
  container_type: string | null;
  container_count: number | null;
  corridor: string | null;
  origin_port: string | null;
  destination_port: string | null;
  origin_country: string | null;
  destination_country: string | null;
  containers: Array<{ type: string; quantity: number }>;
  weight_kg: number | null;
}

interface PricedLine {
  id: string;
  rate: number | null;
  currency: string;
  source: string;
  confidence: number;
  explanation: string;
  quantity_used: number;
  unit_used: string;
  rule_id: string | null;
  conversion_used?: string;
}

interface QuantityRule {
  id: string;
  service_key: string;
  quantity_basis: string;
  default_unit: string;
  requires_fact_key: string | null;
  notes: string | null;
}

interface UnitConversion {
  key: string;
  factor: number;
}

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

// ═══════════════════════════════════════════════════════════════
// T3: COMPUTE QUANTITY FROM DB RULES
// CTO-T3: COUNT depends on service_key
// ═══════════════════════════════════════════════════════════════

function computeQuantity(
  serviceKey: string,
  rule: QuantityRule | undefined,
  ctx: PricingContext,
  evpConversions: Map<string, number>,
  isAirMode: boolean = false,
): { quantity_used: number | null; unit_used: string; rule_id: string | null; conversion_used?: string } {

  if (!rule) {
    // No rule found — use input quantity as-is
    return { quantity_used: 1, unit_used: "FORFAIT", rule_id: null, conversion_used: "no_rule" };
  }

  const basis = rule.quantity_basis;

  // Phase S1.3: Skip container-based quantity for AIR mode
  if (isAirMode && (basis === "EVP" || basis === "COUNT")) {
    return {
      quantity_used: null,
      unit_used: rule.default_unit,
      rule_id: rule.id,
      conversion_used: "air_mode_skip_container_basis",
    };
  }

  if (basis === "EVP") {
    // Sum EVP factors for each container in cargo.containers
    if (ctx.containers.length === 0) {
      return { quantity_used: 1, unit_used: rule.default_unit, rule_id: rule.id, conversion_used: "missing_containers_default_1" };
    }
    let totalEvp = 0;
    const details: string[] = [];
    for (const c of ctx.containers) {
      const key = normalizeContainerKey(c.type);
      const factor = evpConversions.get(key) ?? evpConversions.get(key.replace(/['\s]/g, "").toUpperCase()) ?? null;
      if (factor !== null) {
        totalEvp += factor * c.quantity;
        details.push(`${c.quantity}×${key}(${factor})`);
      } else {
        // Unknown container type — assume factor 1
        totalEvp += c.quantity;
        details.push(`${c.quantity}×${key}(?=1)`);
      }
    }
    return {
      quantity_used: totalEvp,
      unit_used: rule.default_unit,
      rule_id: rule.id,
      conversion_used: details.join("+"),
    };
  }

  if (basis === "COUNT") {
    if (ctx.containers.length === 0) {
      return { quantity_used: 1, unit_used: rule.default_unit, rule_id: rule.id, conversion_used: "missing_containers_default_1" };
    }

    // CTO-T3: TRUCKING counts containers ≥40' only
    if (serviceKey === "TRUCKING") {
      let count40plus = 0;
      let has20Only = true;
      for (const c of ctx.containers) {
        const key = normalizeContainerKey(c.type);
        const size = extractContainerSize(key);
        if (size >= 40) {
          count40plus += c.quantity;
          has20Only = false;
        }
      }
      // If only 20DV containers, 1 voyage minimum
      const qty = has20Only ? Math.max(1, ctx.containers.reduce((s, c) => s + c.quantity, 0)) : count40plus;
      return {
        quantity_used: qty,
        unit_used: rule.default_unit,
        rule_id: rule.id,
        conversion_used: has20Only ? "20DV_only_count" : `count_gte40=${count40plus}`,
      };
    }

    // Other COUNT services: sum physical containers
    const total = ctx.containers.reduce((s, c) => s + c.quantity, 0);
    return {
      quantity_used: total,
      unit_used: rule.default_unit,
      rule_id: rule.id,
      conversion_used: `count_physical=${total}`,
    };
  }

  if (basis === "TONNE") {
    const weightKg = ctx.weight_kg;
    if (!weightKg || weightKg <= 0) {
      return { quantity_used: 1, unit_used: rule.default_unit, rule_id: rule.id, conversion_used: "missing_weight_default_1" };
    }
    const tonnes = Math.ceil(weightKg / 1000);
    return {
      quantity_used: tonnes,
      unit_used: rule.default_unit,
      rule_id: rule.id,
      conversion_used: `${weightKg}kg/${1000}=${tonnes}t`,
    };
  }

  // A1: KG basis for air freight (P0-3 CTO: null if missing, no pricing)
  if (basis === "KG") {
    const chargeableKg = ctx.weight_kg;
    if (!chargeableKg || chargeableKg <= 0) {
      return {
        quantity_used: null as any,
        unit_used: rule.default_unit,
        rule_id: rule.id,
        conversion_used: "missing_weight_no_pricing",
      };
    }
    return {
      quantity_used: chargeableKg,
      unit_used: rule.default_unit,
      rule_id: rule.id,
      conversion_used: `chargeable=${chargeableKg}kg`,
    };
  }

  // FLAT or unknown
  return { quantity_used: 1, unit_used: rule.default_unit || "FORFAIT", rule_id: rule.id, conversion_used: "flat" };
}

function normalizeContainerKey(raw: string): string {
  let ct = raw.replace(/['\s]/g, "").toUpperCase();
  if (ct === "40") ct = "40HC";
  if (ct === "20") ct = "20DV";
  if (ct === "20GP") ct = "20DV";
  return ct;
}

function extractContainerSize(key: string): number {
  const m = key.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 20;
}

// ═══════════════════════════════════════════════════════════════
// PRICING CONTEXT FROM FACTS
// ═══════════════════════════════════════════════════════════════

function buildPricingContext(
  factsMap: Map<string, { value_text: string | null; value_json: unknown; value_number: number | null }>
): PricingContext {
  const flowType = factsMap.get("service.flow_type")?.value_text || "";
  let scope = "import";
  if (/EXPORT/i.test(flowType)) scope = "export";
  else if (/TRANSIT/i.test(flowType)) scope = "transit";

  let containerType: string | null = null;
  let containerCount: number | null = null;
  const containers: Array<{ type: string; quantity: number }> = [];

  const containersFact = factsMap.get("cargo.containers");
  if (containersFact?.value_json && Array.isArray(containersFact.value_json)) {
    const raw = containersFact.value_json as Array<{ type: string; quantity: number }>;
    for (const c of raw) {
      containers.push({ type: c.type, quantity: c.quantity || 1 });
    }
    if (containers.length > 0) {
      containerType = normalizeContainerKey(containers[0].type);
      containerCount = containers.reduce((sum, c) => sum + (c.quantity || 1), 0);
    }
  }

  const destCity = factsMap.get("routing.destination_city")?.value_text?.toUpperCase() || "";
  const destCountry = factsMap.get("routing.destination_country")?.value_text?.toUpperCase() || "";
  let corridor: string | null = null;
  if (destCity.includes("BAMAKO") || destCountry.includes("MALI")) corridor = "DAKAR_BAMAKO";
  else if (destCity.includes("BANJUL") || destCountry.includes("GAMBI")) corridor = "DAKAR_BANJUL";

  const originPort = factsMap.get("routing.origin_port")?.value_text || null;
  const destPort = factsMap.get("routing.destination_port")?.value_text || null;
  const originCountry = factsMap.get("routing.origin_country")?.value_text || null;
  const destCountryVal = factsMap.get("routing.destination_country")?.value_text || null;

  // A1: Prioritize chargeable_weight_kg for air freight
  const chargeableWeight = factsMap.get("cargo.chargeable_weight_kg")?.value_number;
  const rawWeight = factsMap.get("cargo.weight_kg")?.value_number;
  const weightKg = chargeableWeight ?? rawWeight ?? null;

  return {
    scope,
    container_type: containerType,
    container_count: containerCount,
    corridor,
    origin_port: originPort,
    destination_port: destPort,
    origin_country: originCountry,
    destination_country: destCountryVal,
    containers,
    weight_kg: weightKg,
  };
}

// ═══════════════════════════════════════════════════════════════
// RATE CARD MATCHING — P1-A DETERMINISTIC SCORING
// ═══════════════════════════════════════════════════════════════

function findBestRateCard(
  allCards: RateCardRow[],
  serviceKey: string,
  ctx: PricingContext,
  lineUnit: string,
  lineCurrency: string,
  isAirMode: boolean = false,
): { card: RateCardRow; score: number; explanation: string } | null {
  const candidates = allCards.filter((c) => c.service_key === serviceKey);
  if (candidates.length === 0) return null;

  let bestCard: RateCardRow | null = null;
  let bestScore = -1;
  let bestExplanation = "";

  for (const card of candidates) {
    // Phase S1.3: Exclure rate cards container pour mode AIR
    if (isAirMode && card.container_type) continue;
    let score = 40;
    const matchParts: string[] = [serviceKey];

    const cardUnit = normalizeUnit(card.unit);
    if (cardUnit !== lineUnit) continue;

    if (card.scope === ctx.scope) {
      score += 20;
      matchParts.push(ctx.scope);
    } else {
      continue;
    }

    if (ctx.container_type && card.container_type) {
      if (card.container_type === ctx.container_type) {
        score += 20;
        matchParts.push(ctx.container_type);
      } else {
        score -= 10;
      }
    }

    if (ctx.corridor && card.corridor) {
      if (card.corridor === ctx.corridor) {
        score += 20;
        matchParts.push(card.corridor);
      } else {
        score -= 5;
      }
    }

    const cardCurrency = normalizeCurrency(card.currency) || card.currency;
    if (cardCurrency === lineCurrency) {
      score += 5;
    }

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

// ═══════════════════════════════════════════════════════════════
// T3: FALLBACK PORT_TARIFFS FOR DTHC
// ═══════════════════════════════════════════════════════════════

async function findPortTariffFallback(
  serviceClient: ReturnType<typeof createClient>,
  serviceKey: string,
  ctx: PricingContext,
): Promise<{ rate: number; currency: string; source: string; confidence: number; explanation: string } | null> {
  // Only DTHC triggers port_tariffs fallback
  if (serviceKey !== "DTHC") return null;

  const today = new Date().toISOString().split("T")[0];
  const operationType = ctx.scope === "export" ? "Export" : "Import";

  const { data, error } = await serviceClient
    .from("port_tariffs")
    .select("*")
    .eq("provider", "DPW")
    .ilike("category", "%THC%")
    .eq("is_active", true)
    .eq("operation_type", operationType)
    .lte("effective_date", today)
    .order("effective_date", { ascending: false })
    .limit(5);

  if (error || !data || data.length === 0) return null;

  // Pick best match by container type/classification
  let bestRow = data[0];
  if (ctx.container_type) {
    const ctMatch = data.find((r) =>
      r.classification?.toUpperCase().includes(ctx.container_type!.replace(/[^0-9A-Z]/g, ""))
    );
    if (ctMatch) bestRow = ctMatch;
  }

  return {
    rate: bestRow.amount,
    currency: normalizeCurrency(bestRow.currency || "XOF") || "XOF",
    source: `port_tariffs:${bestRow.provider}:${bestRow.id.slice(0, 8)}`,
    confidence: 0.85,
    explanation: `fallback port_tariffs DPW THC ${operationType} ${bestRow.classification || ""}, effective=${bestRow.effective_date}`,
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const correlationId = getCorrelationId(req);
  const t0 = Date.now();

  try {
    // ═══ Phase S0: Unified auth guard ═══
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const jwtClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${auth.token}` } },
    });

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
      .select("id, status, request_type")
      .eq("id", case_id)
      .single();

    if (caseError || !caseData) {
      return respondError({
        code: "FORBIDDEN_OWNER",
        message: "Case not found or access denied",
        correlationId,
      });
    }

    // Phase S1.3: Derive transport mode from quote_case
    const requestType = caseData?.request_type || "";
    const isAirMode = /AIR/i.test(requestType);

    // ═══ Load facts for pricing context (JWT client, RLS) ═══
    const { data: facts } = await jwtClient
      .from("quote_facts")
      .select("fact_key, value_text, value_json, value_number")
      .eq("case_id", case_id)
      .eq("is_current", true);

    const factsMap = new Map(
      (facts || []).map((f: { fact_key: string; value_text: string | null; value_json: unknown; value_number: number | null }) => [f.fact_key, f])
    );

    const pricingCtx = buildPricingContext(factsMap);

    // ═══ T3: Load service_quantity_rules + unit_conversions ═══
    const [rulesResult, conversionsResult, rateCardsResult] = await Promise.all([
      serviceClient.from("service_quantity_rules").select("*"),
      serviceClient.from("unit_conversions").select("key, factor").eq("conversion_type", "CONTAINER_TO_EVP"),
      serviceClient
        .from("pricing_rate_cards")
        .select("*")
        .or("effective_from.is.null,effective_from.lte." + new Date().toISOString().split("T")[0])
        .or("effective_to.is.null,effective_to.gte." + new Date().toISOString().split("T")[0]),
    ]);

    const quantityRules = new Map(
      (rulesResult.data || []).map((r: QuantityRule) => [r.service_key, r])
    );
    const evpConversions = new Map(
      (conversionsResult.data || []).map((c: UnitConversion) => [c.key, c.factor])
    );
    const allCards: RateCardRow[] = rateCardsResult.data || [];

    if (rateCardsResult.error) {
      structuredLog({ level: "error", service: FUNCTION_NAME, op: "load_rate_cards", correlationId, errorCode: "UPSTREAM_DB_ERROR" });
      return respondError({ code: "UPSTREAM_DB_ERROR", message: "Failed to load rate cards", correlationId });
    }

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
        containers: pricingCtx.containers,
        lines_count: service_lines.length,
        rules_loaded: quantityRules.size,
        evp_conversions_loaded: evpConversions.size,
        request_type: requestType,
        is_air_mode: isAirMode,
      },
    });

    // ═══ Price each line ═══
    const pricedLines: PricedLine[] = [];
    const missing: string[] = [];

    for (const line of service_lines) {
      const serviceKey = line.service;
      if (!VALID_SERVICE_KEYS.has(serviceKey)) {
        structuredLog({ level: "warn", service: FUNCTION_NAME, op: "unknown_service_key", correlationId, meta: { service_key: serviceKey } });
        missing.push(serviceKey);
        pricedLines.push({
          id: line.id, rate: null, currency: "XOF", source: "unknown_service",
          confidence: 0, explanation: `Service key "${serviceKey}" not in whitelist`,
          quantity_used: line.quantity, unit_used: line.unit, rule_id: null,
        });
        continue;
      }

      const currency = normalizeCurrency(line.currency);
      if (!currency) {
        pricedLines.push({
          id: line.id, rate: null, currency: line.currency, source: "invalid_currency",
          confidence: 0, explanation: `Currency "${line.currency}" not recognized`,
          quantity_used: line.quantity, unit_used: line.unit, rule_id: null,
        });
        missing.push(serviceKey);
        continue;
      }

      // P0-5: Validate quantity
      const quantity = line.quantity;
      if (typeof quantity !== "number" || quantity < 0 || quantity > 10000) {
        pricedLines.push({
          id: line.id, rate: null, currency, source: "invalid_quantity",
          confidence: 0, explanation: `Quantity ${quantity} out of bounds [0, 10000]`,
          quantity_used: line.quantity, unit_used: line.unit, rule_id: null,
        });
        missing.push(serviceKey);
        continue;
      }

      // ═══ T3: Compute quantity from DB rules ═══
      const rule = quantityRules.get(serviceKey);
      const computed = computeQuantity(serviceKey, rule, pricingCtx, evpConversions, isAirMode);
      const lineUnit = normalizeUnit(computed.unit_used || line.unit);

      // A1: If quantity_used is null (missing weight for KG basis), skip pricing
      if (computed.quantity_used === null || computed.quantity_used === undefined) {
        pricedLines.push({
          id: line.id, rate: null, currency, source: "missing_quantity",
          confidence: 0, explanation: `Cannot price ${serviceKey}: ${computed.conversion_used}`,
          quantity_used: 0, unit_used: computed.unit_used, rule_id: computed.rule_id,
          conversion_used: computed.conversion_used,
        });
        missing.push(serviceKey);
        continue;
      }

      // ═══ P1-A: Progressive matching with scoring ═══
      const match = findBestRateCard(allCards, serviceKey, pricingCtx, lineUnit, currency, isAirMode);

      if (match) {
        pricedLines.push({
          id: line.id,
          rate: match.card.value,
          currency: match.card.currency || currency,
          source: match.card.source,
          confidence: match.score / 100,
          explanation: match.explanation,
          quantity_used: computed.quantity_used,
          unit_used: computed.unit_used,
          rule_id: computed.rule_id,
          conversion_used: computed.conversion_used,
        });
      } else {
        // T3: Fallback port_tariffs for DTHC
        const fallback = await findPortTariffFallback(serviceClient, serviceKey, pricingCtx);
        if (fallback) {
          pricedLines.push({
            id: line.id,
            rate: fallback.rate,
            currency: fallback.currency,
            source: fallback.source,
            confidence: fallback.confidence,
            explanation: fallback.explanation,
            quantity_used: computed.quantity_used,
            unit_used: computed.unit_used,
            rule_id: computed.rule_id,
            conversion_used: computed.conversion_used,
          });
        } else {
          pricedLines.push({
            id: line.id, rate: null, currency, source: "no_match",
            confidence: 0, explanation: `No rate card found for ${serviceKey} (scope=${pricingCtx.scope}, unit=${lineUnit})`,
            quantity_used: computed.quantity_used,
            unit_used: computed.unit_used,
            rule_id: computed.rule_id,
            conversion_used: computed.conversion_used,
          });
          missing.push(serviceKey);
        }
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
      quantity_used: pl.quantity_used,
      unit_used: pl.unit_used,
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
