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
  caf_value: number | null; // Phase PRICING V2: CAF value from canonical fact cargo.caf_value
  client_code: string | null; // Phase PRICING V3.2: canonical fact client.code
  destination_city: string | null; // Phase V4.1: for local_transport_rates matching
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
  let ct = raw.replace(/['\s_-]/g, "").toUpperCase();
  ct = ct.replace(/^(\d{2})FT/, "$1");   // "40FTHC" -> "40HC"
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
  let containersRaw = containersFact?.value_json;

  // V4.1.5: Defensive parse for double-encoded JSON strings
  if (typeof containersRaw === "string") {
    try {
      containersRaw = JSON.parse(containersRaw);
    } catch {
      containersRaw = null;
    }
  }

  if (containersRaw && Array.isArray(containersRaw)) {
    const raw = containersRaw as Array<{ type: string; quantity: number }>;
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

  // Phase PRICING V2 — CTO correction 3: CAF from canonical fact only
  const cafValue = factsMap.get("cargo.caf_value")?.value_number ?? null;

  // Phase PRICING V3.2 — CTO Fix #3: canonical fact client.code (no heuristic)
  const clientCode = factsMap.get("client.code")?.value_text ?? null;

  // Phase V4.1: Extract destination_city for transport rate matching
  const destinationCity = factsMap.get("routing.destination_city")?.value_text || null;

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
    caf_value: cafValue,
    client_code: clientCode,
    destination_city: destinationCity,
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
// Phase V4.1: LOCAL TRANSPORT RATES RESOLVER
// CTO Correction A: No fallback to first candidate if container unmatched → return null
// CTO Correction B: Skip entirely in AIR mode → return null
// ═══════════════════════════════════════════════════════════════

interface LocalTransportRate {
  origin: string;
  destination: string;
  container_type: string;
  rate_amount: number;
  rate_currency: string | null;
  is_active: boolean;
  validity_start: string | null;
  validity_end: string | null;
  provider: string | null;
  cargo_category: string | null;
}

function findLocalTransportRate(
  preloadedRates: LocalTransportRate[],
  serviceKey: string,
  pricingCtx: PricingContext,
  isAirMode: boolean,
): { rate: number; currency: string; source: string; confidence: number; explanation: string } | null {
  // Only TRUCKING and ON_CARRIAGE use local transport rates
  if (serviceKey !== "TRUCKING" && serviceKey !== "ON_CARRIAGE") return null;

  // CTO Correction B: Transport routier conteneurisé n'existe pas en AIR
  if (isAirMode) return null;

  const destCity = pricingCtx.destination_city;
  if (!destCity) return null;

  const destNorm = destCity.toUpperCase().trim();

  // Phase V4.1.2: City-to-zone mapping for destinations
  // that use zone-based naming in local_transport_rates
  const CITY_TO_ZONE: Record<string, string> = {
    "DAKAR": "FORFAIT ZONE 1 <18 KM",
    "GUEDIAWAYE": "FORFAIT ZONE 1 <18 KM",
    "PIKINE": "FORFAIT ZONE 1 <18 KM",
    "RUFISQUE": "FORFAIT ZONE 1 <18 KM",
    "DIAMNIADIO": "FORFAIT ZONE 2, SEIKHOTANE ET POUT",
    "SEIKHOTANE": "FORFAIT ZONE 2, SEIKHOTANE ET POUT",
    "POUT": "FORFAIT ZONE 2, SEIKHOTANE ET POUT",
  };
  const resolvedDest = CITY_TO_ZONE[destNorm] || destNorm;

  // Temporal filter
  const today = new Date().toISOString().split("T")[0];
  const validRates = preloadedRates.filter(r =>
    r.is_active &&
    (!r.validity_start || r.validity_start <= today) &&
    (!r.validity_end || r.validity_end >= today)
  );

  // Destination matching: exact first, then partial (single match only)
  let candidates = validRates.filter(r => r.destination.toUpperCase().trim() === resolvedDest);

  if (candidates.length === 0) {
    // Partial: destination DB contains the city OR city contains the destination DB
    const partialMatches = validRates.filter(r => {
      const rDest = r.destination.toUpperCase().trim();
      return rDest.includes(resolvedDest) || resolvedDest.includes(rDest);
    });
    // CTO adjustment: ambiguous partial matches → null (multiple destinations matched)
    // We keep all partial matches for the same destination string, then check uniqueness of destination
    const uniqueDests = new Set(partialMatches.map(r => r.destination.toUpperCase().trim()));
    if (uniqueDests.size === 1) {
      candidates = partialMatches;
    } else {
      // Multiple distinct destinations matched → ambiguous, return null
      return null;
    }
  }

  if (candidates.length === 0) return null;

  // Container type matching with mapping
  const ctxContainer = pricingCtx.container_type; // e.g. "20DV", "40DV", "40HC"
  if (!ctxContainer) return null; // CTO Correction A: no container info → null

  const containerSearchTerms: string[] = [];
  const ctNorm = ctxContainer.toUpperCase();
  if (ctNorm.startsWith("20")) {
    containerSearchTerms.push("20'", "20' DRY", "20'DRY");
  } else if (ctNorm.startsWith("40")) {
    containerSearchTerms.push("40'", "40' DRY", "40'DRY");
  } else if (ctNorm.includes("LOW") || ctNorm.includes("FLAT")) {
    containerSearchTerms.push("LOW BED", "LOWBED");
  }

  const bestRate = candidates.find(r => {
    const rct = r.container_type.toUpperCase().trim();
    return containerSearchTerms.some(term => rct.includes(term));
  });

  // CTO Correction A: No container match → return null (no arbitrary fallback)
  if (!bestRate) return null;

  return {
    rate: bestRate.rate_amount,
    currency: bestRate.rate_currency || "XOF",
    source: `local_transport_rate`,
    confidence: 0.90,
    explanation: `local_transport: dest=${bestRate.destination}, container=${bestRate.container_type}, provider=${bestRate.provider || "unknown"}, rate=${bestRate.rate_amount}`,
  };
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
// Phase V3.3: PERCENTAGE resolver helper (CTO correction)
// Re-executes downstream cascade WITHOUT client_override to find fallback price.
// Returns raw rate (no modifiers, no min_price) or null.
// ═══════════════════════════════════════════════════════════════

async function resolveWithoutClientOverride(
  serviceKey: string,
  computed: { quantity_used: number; unit_used: string; rule_id: string | null; conversion_used?: string },
  pricingCtx: PricingContext,
  isAirMode: boolean,
  currency: string,
  customsTiers: Array<{
    id: string; mode: string; basis: string;
    min_value: number; max_value: number | null;
    min_weight_kg?: number | null; max_weight_kg?: number | null;
    price: number | null; percent: number | null;
    min_price: number | null; max_price: number | null;
    currency: string;
  }>,
  catalogue: Map<string, any>,
  allCards: RateCardRow[],
  serviceClient: ReturnType<typeof createClient>,
  preloadedTransportRates: LocalTransportRate[] = [],
): Promise<{
  rate: number; source: string; confidence: number; explanation: string;
  quantity_used: number; unit_used: string; rule_id: string | null; conversion_used?: string;
} | null> {

  const transportMode = isAirMode ? "AIR" : "SEA";
  const lineUnit = normalizeUnit(computed.unit_used);

  // 1. Customs tier CAF
  if (serviceKey.startsWith("CUSTOMS_")) {
    const caf = pricingCtx.caf_value;
    if (caf && caf > 0) {
      const tier = customsTiers.find(t =>
        t.mode === transportMode && t.basis === "CAF" &&
        caf >= t.min_value && (t.max_value == null || caf < t.max_value)
      );
      if (tier) {
        const rate = tier.percent != null ? caf * tier.percent / 100 : (tier.price ?? 0);
        return {
          rate, source: "customs_tier", confidence: 0.90,
          explanation: `fallback customs_tier: CAF=${caf}, percent=${tier.percent}`,
          quantity_used: computed.quantity_used, unit_used: computed.unit_used,
          rule_id: computed.rule_id, conversion_used: computed.conversion_used,
        };
      }
    }

    // 2. Customs weight tier
    const weight = pricingCtx.weight_kg;
    if (weight && weight > 0) {
      const wTier = customsTiers.find(t =>
        t.mode === transportMode && t.basis === "WEIGHT" &&
        weight >= (t.min_weight_kg ?? 0) && (t.max_weight_kg == null || weight < t.max_weight_kg)
      );
      if (wTier) {
        return {
          rate: wTier.price ?? 0, source: "customs_weight_tier", confidence: 0.85,
          explanation: `fallback customs_weight_tier: weight=${weight}`,
          quantity_used: computed.quantity_used, unit_used: computed.unit_used,
          rule_id: computed.rule_id, conversion_used: computed.conversion_used,
        };
      }
    }
  }

  // 3. Catalogue SODATRA
  const catEntry = catalogue.get(serviceKey);
  const catMode = isAirMode ? "AIR" : "SEA";
  const scopeOk = !catEntry?.mode_scope || catEntry.mode_scope === catMode;
  const priceOk = catEntry?.pricing_mode === "UNIT_RATE" ? catEntry.base_price > 0 : true;
  const qtyOk = catEntry?.pricing_mode === "UNIT_RATE" ? (computed.quantity_used > 0) : true;

  if (catEntry && scopeOk && priceOk && qtyOk) {
    const rate = catEntry.pricing_mode === "UNIT_RATE"
      ? catEntry.base_price * computed.quantity_used
      : catEntry.base_price;
    return {
      rate, source: "catalogue_sodatra", confidence: 0.95,
      explanation: `fallback catalogue: ${serviceKey}, base=${catEntry.base_price}`,
      quantity_used: computed.quantity_used, unit_used: computed.unit_used,
      rule_id: computed.rule_id, conversion_used: computed.conversion_used,
    };
  }

  // 3.5 Phase V4.1: Local transport rates
  const transportFb = findLocalTransportRate(preloadedTransportRates, serviceKey, pricingCtx, isAirMode);
  if (transportFb) {
    return {
      rate: transportFb.rate, source: transportFb.source, confidence: transportFb.confidence,
      explanation: `fallback ${transportFb.explanation}`,
      quantity_used: computed.quantity_used, unit_used: computed.unit_used,
      rule_id: computed.rule_id, conversion_used: computed.conversion_used,
    };
  }

  // 4. Rate card
  const match = findBestRateCard(allCards, serviceKey, pricingCtx, lineUnit, currency, isAirMode);
  if (match) {
    return {
      rate: match.card.value, source: match.card.source, confidence: match.score / 100,
      explanation: `fallback rate_card: ${match.explanation}`,
      quantity_used: computed.quantity_used, unit_used: computed.unit_used,
      rule_id: computed.rule_id, conversion_used: computed.conversion_used,
    };
  }

  // 5. Port tariff
  const ptFallback = await findPortTariffFallback(serviceClient, serviceKey, pricingCtx);
  if (ptFallback) {
    return {
      rate: ptFallback.rate, source: ptFallback.source, confidence: ptFallback.confidence,
      explanation: `fallback port_tariff: ${ptFallback.explanation}`,
      quantity_used: computed.quantity_used, unit_used: computed.unit_used,
      rule_id: computed.rule_id, conversion_used: computed.conversion_used,
    };
  }

  return null;
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
    const { case_id, service_lines, active_modifiers } = body as {
      case_id: string;
      service_lines: ServiceLineInput[];
      active_modifiers?: string[];
    };
    const activeModifierCodes = new Set(active_modifiers || []);

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
    const [rulesResult, conversionsResult, rateCardsResult, catalogueResult, modifiersResult, customsTiersResult, clientOverridesResult, transportRatesResult] = await Promise.all([
      serviceClient.from("service_quantity_rules").select("*"),
      serviceClient.from("unit_conversions").select("key, factor").eq("conversion_type", "CONTAINER_TO_EVP"),
      serviceClient
        .from("pricing_rate_cards")
        .select("*")
        .or("effective_from.is.null,effective_from.lte." + new Date().toISOString().split("T")[0])
        .or("effective_to.is.null,effective_to.gte." + new Date().toISOString().split("T")[0]),
      serviceClient.from("pricing_service_catalogue").select("*").eq("active", true),
      serviceClient.from("pricing_modifiers").select("*").eq("active", true),
      // Phase PRICING V2: Load customs duty tiers
      serviceClient.from("pricing_customs_tiers").select("*").eq("active", true),
      // Phase PRICING V3.2: Load client overrides
      serviceClient.from("pricing_client_overrides").select("*").eq("active", true),
      // Phase V4.1: Preload local transport rates (avoid N+1 queries)
      serviceClient.from("local_transport_rates").select("*").eq("is_active", true),
    ]);

    // Phase PRICING V2: Customs tiers array
    const customsTiers = (customsTiersResult.data || []) as Array<{
      id: string; mode: string; basis: string;
      min_value: number; max_value: number | null;
      price: number | null; percent: number | null;
      min_price: number | null; max_price: number | null;
      currency: string;
    }>;

    // Phase PRICING V3.2: Client overrides index (CTO Fix #1: unique index guarantees 1 active per key)
    const clientOverrides = (clientOverridesResult.data || []) as Array<{
      id: string; client_code: string; service_code: string;
      pricing_mode: string; base_price: number; min_price: number;
      currency: string; mode_scope: string | null;
      valid_from: string | null; valid_to: string | null;
      description: string | null;
    }>;
    // CTO Fix: index by client_code::service_code::mode_scope for scoped vs generic lookup
    const clientOverrideMap = new Map(
      clientOverrides.map((o) => [`${o.client_code}::${o.service_code}::${o.mode_scope ?? '*'}`, o])
    );

    // Phase PRICING V1: Build catalogue and modifiers maps
    const catalogue = new Map(
      (catalogueResult.data || []).map((c: any) => [c.service_code, c])
    );
    const allModifiers = (modifiersResult.data || []) as Array<{
      modifier_code: string; label: string; type: string; value: number; applies_to: string[] | null;
    }>;

    const quantityRules = new Map(
      (rulesResult.data || []).map((r: QuantityRule) => [r.service_key, r])
    );
    const evpConversions = new Map(
      (conversionsResult.data || []).map((c: UnitConversion) => [c.key, c.factor])
    );
    const allCards: RateCardRow[] = rateCardsResult.data || [];
    // Phase V4.1: Preloaded transport rates for in-memory matching
    const preloadedTransportRates = (transportRatesResult.data || []) as LocalTransportRate[];

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

      // ═══ V4.1.6: Business rule — EMPTY_RETURN = 0 for import Senegal ═══
      if (serviceKey === "EMPTY_RETURN") {
        const destCountry = (pricingCtx.destination_country || "").toUpperCase();
        const isSenegal = destCountry === "SN" || destCountry === "SENEGAL" || destCountry === "";
        if (isSenegal && pricingCtx.scope === "import") {
          pricedLines.push({
            id: line.id, rate: 0, currency, source: "business_rule",
            confidence: 1.0,
            explanation: "EMPTY_RETURN: Obligation contractuelle client, non facturé en import SN",
            quantity_used: computed.quantity_used ?? 1, unit_used: computed.unit_used,
            rule_id: computed.rule_id, conversion_used: computed.conversion_used,
          });
          continue;
        }
      }

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

      // ═══ Phase PRICING V3.2: Client override resolver (highest priority) ═══
      if (pricingCtx.client_code) {
        // CTO Fix: scoped lookup (AIR/SEA) then fallback to generic (*)
        const transportMode_co = isAirMode ? "AIR" : "SEA";
        const keyScoped = `${pricingCtx.client_code}::${serviceKey}::${transportMode_co}`;
        const keyAny = `${pricingCtx.client_code}::${serviceKey}::*`;
        const override = clientOverrideMap.get(keyScoped) ?? clientOverrideMap.get(keyAny);

        if (override) {
          // CTO Fix #2: Stable UTC date string for temporal validity
          const todayStr = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD' UTC
          const dateValid = (!override.valid_from || override.valid_from <= todayStr) &&
                            (!override.valid_to || override.valid_to >= todayStr);

          if (dateValid) {
            let lineTotal = 0;
            let skipOverride = false;

            if (override.pricing_mode === "FIXED") {
              lineTotal = override.base_price;
            } else if (override.pricing_mode === "UNIT_RATE") {
              // CTO Fix #4: Use computed.quantity_used, skip if null/<=0
              if (!computed.quantity_used || computed.quantity_used <= 0) {
                skipOverride = true;
              } else {
                lineTotal = override.base_price * computed.quantity_used;
              }
            } else if (override.pricing_mode === "PERCENTAGE") {
              // Phase V3.3: Percentage override — resolve fallback then apply %
              const fallback = await resolveWithoutClientOverride(
                serviceKey, computed, pricingCtx, isAirMode, currency,
                customsTiers, catalogue, allCards, serviceClient,
                preloadedTransportRates,
              );

              if (fallback) {
                lineTotal = fallback.rate * override.base_price / 100;
              } else {
                skipOverride = true; // No fallback found, line falls to no_match
              }
            } else {
              skipOverride = true;
            }

            if (!skipOverride) {
              const rawTotal = lineTotal;

              // Apply active modifiers FIRST
              const appliedMods: string[] = [];
              for (const mod of allModifiers) {
                if (!activeModifierCodes.has(mod.modifier_code)) continue;
                if (mod.applies_to && mod.applies_to.length > 0 && !mod.applies_to.includes(serviceKey)) continue;
                if (mod.type === "FIXED") {
                  lineTotal += mod.value;
                  appliedMods.push(`${mod.modifier_code}(+${mod.value})`);
                } else if (mod.type === "PERCENT") {
                  lineTotal *= (1 + mod.value / 100);
                  appliedMods.push(`${mod.modifier_code}(${mod.value > 0 ? "+" : ""}${mod.value}%)`);
                }
              }

              // Apply min_price LAST
              lineTotal = Math.max(lineTotal, override.min_price);
              lineTotal = Math.round(lineTotal); // XOF integer

              const isPercentage = override.pricing_mode === "PERCENTAGE";
              const modeLabel = isPercentage ? "client_override_percentage" : "client_override";
              const modSuffix = appliedMods.length > 0 ? "+modifiers" : "";
              pricedLines.push({
                id: line.id,
                rate: lineTotal,
                currency: override.currency || currency,
                source: `${modeLabel}${modSuffix}`,
                confidence: 1.0,
                explanation: isPercentage
                  ? `client_override_percentage: client=${pricingCtx.client_code}, base_fallback=${Math.round(lineTotal * 100 / override.base_price)}, percent=${override.base_price}, raw=${Math.round(rawTotal)}, modifiers=[${appliedMods.join(",")}], min_price=${override.min_price}, final=${lineTotal}`
                  : `client_override: client=${pricingCtx.client_code}, service=${serviceKey}, mode=${override.pricing_mode}, base=${override.base_price}, qty=${computed.quantity_used ?? 1}, raw=${Math.round(rawTotal)}, modifiers=[${appliedMods.join(",")}], min_price=${override.min_price}, final=${lineTotal}`,
                quantity_used: computed.quantity_used ?? 1,
                unit_used: computed.unit_used,
                rule_id: computed.rule_id,
                conversion_used: computed.conversion_used,
              });
              continue; // Skip all downstream resolvers
            }
          }
        }
      }

      // ═══ Phase PRICING V2: Customs tier resolver (priority over catalogue for CUSTOMS_*) ═══
      if (serviceKey.startsWith("CUSTOMS_")) {
        const caf = pricingCtx.caf_value;
        const transportMode_v2 = isAirMode ? "AIR" : "SEA";

        if (caf && caf > 0) {
          const tier = customsTiers.find(t =>
            t.mode === transportMode_v2 &&
            t.basis === "CAF" &&
            caf >= t.min_value &&
            (t.max_value == null || caf < t.max_value) // CTO correction 2: max exclusif
          );

          if (tier) {
            // CTO correction 1: percent = taux réel, formule caf * percent / 100
            let lineTotal = tier.percent != null
              ? caf * tier.percent / 100
              : (tier.price ?? 0);

            const rawTotal = lineTotal;

            // Apply active modifiers FIRST (reuse V1 logic)
            const appliedMods: string[] = [];
            for (const mod of allModifiers) {
              if (!activeModifierCodes.has(mod.modifier_code)) continue;
              if (mod.applies_to && mod.applies_to.length > 0 && !mod.applies_to.includes(serviceKey)) continue;
              if (mod.type === "FIXED") {
                lineTotal += mod.value;
                appliedMods.push(`${mod.modifier_code}(+${mod.value})`);
              } else if (mod.type === "PERCENT") {
                lineTotal *= (1 + mod.value / 100);
                appliedMods.push(`${mod.modifier_code}(${mod.value > 0 ? "+" : ""}${mod.value}%)`);
              }
            }

            // Apply min_price / max_price bounds LAST (final guardrails)
            if (tier.min_price != null) lineTotal = Math.max(lineTotal, tier.min_price);
            if (tier.max_price != null) lineTotal = Math.min(lineTotal, tier.max_price);

            lineTotal = Math.round(lineTotal); // XOF integer

            const modSuffix = appliedMods.length > 0 ? "+modifiers" : "";
            pricedLines.push({
              id: line.id,
              rate: lineTotal,
              currency: tier.currency || currency,
              source: `customs_tier${modSuffix}`,
              confidence: 0.90,
              explanation: `customs_tier: mode=${transportMode_v2}, basis=CAF, caf=${caf}, percent=${tier.percent}, raw=${Math.round(rawTotal)}, min_price=${tier.min_price}, max_price=${tier.max_price}, modifiers=[${appliedMods.join(",")}], final=${lineTotal}`,
              quantity_used: computed.quantity_used ?? 1,
              unit_used: computed.unit_used,
              rule_id: computed.rule_id,
              conversion_used: computed.conversion_used,
            });
            continue; // Skip catalogue + rate card fallback
          }
        }
        // No CAF or no tier found → fall through to WEIGHT resolver (V3.1)
      }

      // ═══ Phase PRICING V3.1: Customs WEIGHT tier resolver (only if CAF did NOT resolve) ═══
      const cafResolved = serviceKey.startsWith("CUSTOMS_") && pricingCtx.caf_value && pricingCtx.caf_value > 0 &&
        pricedLines.some(pl => pl.id === line.id && pl.source?.startsWith("customs_tier"));

      if (serviceKey.startsWith("CUSTOMS_") && !cafResolved) {
        const weight = pricingCtx.weight_kg;
        const transportMode_v3 = isAirMode ? "AIR" : "SEA";

        if (weight && weight > 0) {
          const weightTier = customsTiers.find(t =>
            t.mode === transportMode_v3 &&
            t.basis === "WEIGHT" &&
            weight >= (t.min_weight_kg ?? 0) &&
            (t.max_weight_kg == null || weight < t.max_weight_kg)
          );

          if (weightTier) {
            let lineTotal = weightTier.price ?? 0;
            const rawTotal = lineTotal;

            // Apply active modifiers FIRST (reuse V1 logic)
            const appliedMods: string[] = [];
            for (const mod of allModifiers) {
              if (!activeModifierCodes.has(mod.modifier_code)) continue;
              if (mod.applies_to && mod.applies_to.length > 0 && !mod.applies_to.includes(serviceKey)) continue;
              if (mod.type === "FIXED") {
                lineTotal += mod.value;
                appliedMods.push(`${mod.modifier_code}(+${mod.value})`);
              } else if (mod.type === "PERCENT") {
                lineTotal *= (1 + mod.value / 100);
                appliedMods.push(`${mod.modifier_code}(${mod.value > 0 ? "+" : ""}${mod.value}%)`);
              }
            }

            // Apply min_price / max_price bounds LAST (final guardrails)
            if (weightTier.min_price != null) lineTotal = Math.max(lineTotal, weightTier.min_price);
            if (weightTier.max_price != null) lineTotal = Math.min(lineTotal, weightTier.max_price);

            lineTotal = Math.round(lineTotal); // XOF integer

            const modSuffix = appliedMods.length > 0 ? "+modifiers" : "";
            const tierRange = `${weightTier.min_weight_kg ?? 0}-${weightTier.max_weight_kg ?? "∞"}`;
            pricedLines.push({
              id: line.id,
              rate: lineTotal,
              currency: weightTier.currency || currency,
              source: `customs_weight_tier${modSuffix}`,
              confidence: 0.85,
              explanation: `customs_weight_tier: mode=${transportMode_v3}, weight=${weight}, tier=${tierRange}, raw=${Math.round(rawTotal)}, min_price=${weightTier.min_price}, max_price=${weightTier.max_price}, modifiers=[${appliedMods.join(",")}], final=${lineTotal}`,
              quantity_used: computed.quantity_used ?? 1,
              unit_used: computed.unit_used,
              rule_id: computed.rule_id,
              conversion_used: computed.conversion_used,
            });
            continue; // Skip catalogue + rate card fallback
          }
        }
        // No weight or no tier found → fall through to catalogue V1 (natural fallback)
      }

      // ═══ Phase PRICING V1: Catalogue resolver (priority over rate cards) ═══
      const catalogueEntry = catalogue.get(serviceKey);
      const transportMode = isAirMode ? "AIR" : (pricingCtx.scope === "export" ? "SEA" : "SEA");
      const scopeOk = !catalogueEntry?.mode_scope || catalogueEntry.mode_scope === transportMode;
      // CTO R1: UNIT_RATE with base_price=0 → fallback; FIXED with 0 → accepted
      const priceOk = catalogueEntry?.pricing_mode === "UNIT_RATE"
        ? catalogueEntry.base_price > 0
        : true;
      // CTO R2: UNIT_RATE needs valid quantity
      const qtyOk = catalogueEntry?.pricing_mode === "UNIT_RATE"
        ? (computed.quantity_used != null && computed.quantity_used > 0)
        : true;

      if (catalogueEntry && scopeOk && priceOk && qtyOk) {
        // Calculate lineTotal based on pricing_mode
        let lineTotal = 0;
        if (catalogueEntry.pricing_mode === "UNIT_RATE") {
          lineTotal = catalogueEntry.base_price * (computed.quantity_used ?? 1);
        } else {
          // FIXED (or PERCENTAGE reserved for V2)
          lineTotal = catalogueEntry.base_price;
        }

        // Apply active modifiers on lineTotal
        const appliedMods: string[] = [];
        for (const mod of allModifiers) {
          if (!activeModifierCodes.has(mod.modifier_code)) continue;
          if (mod.applies_to && mod.applies_to.length > 0 && !mod.applies_to.includes(serviceKey)) continue;
          if (mod.type === "FIXED") {
            lineTotal += mod.value;
            appliedMods.push(`${mod.modifier_code}(+${mod.value})`);
          } else if (mod.type === "PERCENT") {
            lineTotal *= (1 + mod.value / 100);
            appliedMods.push(`${mod.modifier_code}(${mod.value > 0 ? "+" : ""}${mod.value}%)`);
          }
        }

        // Apply min_price LAST (CTO correction 2)
        lineTotal = Math.max(lineTotal, catalogueEntry.min_price);
        lineTotal = Math.round(lineTotal); // Round to integer for XOF

        const modSuffix = appliedMods.length > 0 ? "+modifiers" : "";
        pricedLines.push({
          id: line.id,
          rate: lineTotal,
          currency: catalogueEntry.currency || currency,
          source: `catalogue_sodatra${modSuffix}`,
          confidence: 0.95,
          explanation: `catalogue:${serviceKey}, mode=${catalogueEntry.pricing_mode}, base=${catalogueEntry.base_price}, qty=${computed.quantity_used ?? 1}, modifiers=[${appliedMods.join(",")}], min_price=${catalogueEntry.min_price}, final=${lineTotal}`,
          quantity_used: computed.quantity_used ?? 1,
          unit_used: computed.unit_used,
          rule_id: computed.rule_id,
          conversion_used: computed.conversion_used,
        });
        continue; // Skip rate card fallback
      }

      // ═══ Phase V4.1: Local transport rate resolver (between catalogue and rate card) ═══
      const transportFallback = findLocalTransportRate(preloadedTransportRates, serviceKey, pricingCtx, isAirMode);
      if (transportFallback) {
        let lineTotal = transportFallback.rate;

        // Apply active modifiers
        const appliedMods: string[] = [];
        for (const mod of allModifiers) {
          if (!activeModifierCodes.has(mod.modifier_code)) continue;
          if (mod.applies_to && mod.applies_to.length > 0 && !mod.applies_to.includes(serviceKey)) continue;
          if (mod.type === "FIXED") {
            lineTotal += mod.value;
            appliedMods.push(`${mod.modifier_code}(+${mod.value})`);
          } else if (mod.type === "PERCENT") {
            lineTotal *= (1 + mod.value / 100);
            appliedMods.push(`${mod.modifier_code}(${mod.value > 0 ? "+" : ""}${mod.value}%)`);
          }
        }
        lineTotal = Math.round(lineTotal);

        const modSuffix = appliedMods.length > 0 ? "+modifiers" : "";
        pricedLines.push({
          id: line.id,
          rate: lineTotal,
          currency: transportFallback.currency,
          source: `local_transport_rate${modSuffix}`,
          confidence: transportFallback.confidence,
          explanation: transportFallback.explanation,
          quantity_used: computed.quantity_used ?? 1,
          unit_used: computed.unit_used,
          rule_id: computed.rule_id,
          conversion_used: computed.conversion_used,
        });
        continue;
      }

      // ═══ P1-A: Progressive matching with scoring (fallback) ═══
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

    // ═══ Normalise source for CHECK constraint ═══
    function normalizeSourceForAudit(source: string): string {
      if (source.startsWith("port_tariffs")) return "port_tariffs";
      if (source.startsWith("rate_card")) return "internal";
      // Strip "+modifiers" suffix for CHECK constraint
      const base = source.replace(/\+modifiers$/, "");
      if (["client_override", "client_override_percentage", "catalogue_sodatra",
           "local_transport_rate", "customs_tier", "customs_weight_tier",
           "business_rule", "no_match", "missing_quantity",
           "internal", "official", "historical", "fallback"].includes(base)) {
        return base.replace("_percentage", ""); // client_override_percentage → client_override
      }
      return base;
    }

    // ═══ V4.1.7: Human-readable explanation for operator UI ═══
    function humanExplanation(pl: PricedLine): string {
      const fmt = (n: number) => n.toLocaleString("fr-FR");
      const src = pl.source.replace(/\+modifiers$/, "");
      const rate = pl.rate ?? 0;

      if (src === "business_rule") {
        // Already human-readable (e.g. "EMPTY_RETURN: Obligation contractuelle...")
        return pl.explanation;
      }
      if (src === "catalogue_sodatra") {
        // Parse base_price and qty from technical explanation
        const baseMatch = pl.explanation.match(/base=(\d+)/);
        const qtyMatch = pl.explanation.match(/qty=([\d.]+)/);
        const modeMatch = pl.explanation.match(/mode=(\w+)/);
        const base = baseMatch ? parseInt(baseMatch[1]) : rate;
        const qty = qtyMatch ? parseFloat(qtyMatch[1]) : pl.quantity_used;
        if (modeMatch?.[1] === "UNIT_RATE" && base > 0) {
          return `Catalogue SODATRA : ${fmt(base)} × ${qty} ${pl.unit_used || ""} = ${fmt(rate)} FCFA`;
        }
        return `Catalogue SODATRA : forfait ${fmt(rate)} FCFA`;
      }
      if (src === "local_transport_rate") {
        const destMatch = pl.explanation.match(/dest=([^,]+)/);
        const dest = destMatch?.[1] || "";
        return `Transport local${dest ? ` (${dest})` : ""} : ${fmt(rate)} FCFA/voyage`;
      }
      if (src === "customs_tier") {
        const pctMatch = pl.explanation.match(/percent=([\d.]+)/);
        const cafMatch = pl.explanation.match(/caf=([\d.]+)/);
        const pct = pctMatch ? parseFloat(pctMatch[1]) : null;
        const caf = cafMatch ? parseFloat(cafMatch[1]) : null;
        if (pct != null && caf != null) {
          return `Barème douane CAF : ${pct}% de ${fmt(caf)} = ${fmt(rate)} FCFA`;
        }
        return `Barème douane CAF : ${fmt(rate)} FCFA`;
      }
      if (src === "customs_weight_tier") {
        const tierMatch = pl.explanation.match(/tier=([\d∞.-]+)/);
        const weightMatch = pl.explanation.match(/weight=([\d.]+)/);
        const tierRange = tierMatch?.[1] || "?";
        const weight = weightMatch ? `${fmt(parseFloat(weightMatch[1]))} kg` : "";
        return `Barème douane poids${weight ? ` (${weight})` : ""} : tranche ${tierRange} kg, forfait ${fmt(rate)} FCFA`;
      }
      if (src === "client_override" || src === "client_override_percentage") {
        const clientMatch = pl.explanation.match(/client=([^,]+)/);
        const client = clientMatch?.[1] || "";
        return `Tarif contractuel${client ? ` client ${client}` : ""} : ${fmt(rate)} FCFA`;
      }
      if (src === "no_match") {
        return "Aucun tarif trouvé — à confirmer";
      }
      if (src === "missing_quantity") {
        return "Quantité manquante — tarification impossible";
      }
      // port_tariffs, rate_card, or other fallbacks
      if (pl.source.startsWith("port_tariffs")) {
        return `Grille portuaire : ${fmt(rate)} FCFA`;
      }
      // Generic fallback
      const confPct = Math.round(pl.confidence * 100);
      return `Grille tarifaire : ${fmt(rate)} FCFA (confiance ${confPct}%)`;
    }

    // ═══ V4.1.7: Replace technical explanations with human-readable ones ═══
    for (const pl of pricedLines) {
      const debugExplanation = pl.explanation;
      pl.explanation = humanExplanation(pl);
      // Log the technical detail for debugging
      structuredLog({ level: "debug", service: FUNCTION_NAME, op: "human_explanation", correlationId,
        meta: { id: pl.id, source: pl.source, human: pl.explanation, debug: debugExplanation } });
    }

    // ═══ P0-4: Idempotent audit write via upsert ═══
    const auditRows = pricedLines.map((pl) => ({
      case_id,
      service_line_id: pl.id,
      service_key: service_lines.find((sl) => sl.id === pl.id)?.service || "UNKNOWN",
      suggested_rate: pl.rate,
      currency: pl.currency,
      source: normalizeSourceForAudit(pl.source),
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


