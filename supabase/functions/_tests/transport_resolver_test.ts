/**
 * Phase PRICING V4.1 — Transport Resolver E2E Tests
 *
 * 4 tests validating findLocalTransportRate logic + CTO corrections.
 * Uses a snapshot copy of the pure function to avoid importing the full
 * edge function (which triggers Deno.serve and heavy Supabase deps).
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// ═══ Snapshot of findLocalTransportRate (from price-service-lines/index.ts) ═══

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
  caf_value: number | null;
  client_code: string | null;
  destination_city: string | null;
}

function findLocalTransportRate(
  preloadedRates: LocalTransportRate[],
  serviceKey: string,
  pricingCtx: PricingContext,
  isAirMode: boolean,
): { rate: number; currency: string; source: string; confidence: number; explanation: string } | null {
  if (serviceKey !== "TRUCKING" && serviceKey !== "ON_CARRIAGE") return null;
  if (isAirMode) return null;
  const destCity = pricingCtx.destination_city;
  if (!destCity) return null;
  const destNorm = destCity.toUpperCase().trim();
  const today = new Date().toISOString().split("T")[0];
  const validRates = preloadedRates.filter(r =>
    r.is_active &&
    (!r.validity_start || r.validity_start <= today) &&
    (!r.validity_end || r.validity_end >= today)
  );
  let candidates = validRates.filter(r => r.destination.toUpperCase().trim() === destNorm);
  if (candidates.length === 0) {
    const partialMatches = validRates.filter(r => {
      const rDest = r.destination.toUpperCase().trim();
      return rDest.includes(destNorm) || destNorm.includes(rDest);
    });
    const uniqueDests = new Set(partialMatches.map(r => r.destination.toUpperCase().trim()));
    if (uniqueDests.size === 1) {
      candidates = partialMatches;
    } else {
      return null;
    }
  }
  if (candidates.length === 0) return null;
  const ctxContainer = pricingCtx.container_type;
  if (!ctxContainer) return null;
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
  if (!bestRate) return null;
  return {
    rate: bestRate.rate_amount,
    currency: bestRate.rate_currency || "XOF",
    source: "local_transport_rate",
    confidence: 0.90,
    explanation: `local_transport: dest=${bestRate.destination}, container=${bestRate.container_type}, provider=${bestRate.provider || "unknown"}, rate=${bestRate.rate_amount}`,
  };
}

// ═══ Mock data (real values from local_transport_rates) ═══

const MOCK_RATES: LocalTransportRate[] = [
  {
    origin: "DAKAR", destination: "KAOLACK", container_type: "40' Dry",
    rate_amount: 527460, rate_currency: "XOF", is_active: true,
    validity_start: null, validity_end: null, provider: "Aksa Energy", cargo_category: null,
  },
  {
    origin: "DAKAR", destination: "KAOLACK", container_type: "20' Dry",
    rate_amount: 290280, rate_currency: "XOF", is_active: true,
    validity_start: null, validity_end: null, provider: "Aksa Energy", cargo_category: null,
  },
  {
    origin: "DAKAR", destination: "THIES / POPONGUINE", container_type: "40' Dry",
    rate_amount: 248980, rate_currency: "XOF", is_active: true,
    validity_start: null, validity_end: null, provider: null, cargo_category: null,
  },
  {
    origin: "DAKAR", destination: "THIES / POPONGUINE", container_type: "20' Dry",
    rate_amount: 151040, rate_currency: "XOF", is_active: true,
    validity_start: null, validity_end: null, provider: null, cargo_category: null,
  },
];

// ═══ PricingContext factory ═══

function makeCtx(overrides: { destination_city?: string | null; container_type?: string | null }): PricingContext {
  return {
    scope: "import", container_type: "container_type" in overrides ? overrides.container_type! : "40DV",
    container_count: 1, corridor: null, origin_port: null, destination_port: null,
    origin_country: null, destination_country: null, containers: [],
    weight_kg: null, caf_value: null, client_code: null,
    destination_city: overrides.destination_city ?? null,
  };
}

// ═══ Test 1: Match exact — KAOLACK + 40DV ═══

Deno.test("findLocalTransportRate — exact match KAOLACK 40DV returns 527460", () => {
  const result = findLocalTransportRate(MOCK_RATES, "TRUCKING", makeCtx({ destination_city: "KAOLACK", container_type: "40DV" }), false);
  assertEquals(result !== null, true, "Should return a result");
  assertEquals(result!.rate, 527460);
  assertEquals(result!.source, "local_transport_rate");
  assertEquals(result!.confidence, 0.90);
});

// ═══ Test 2: Partial unique — THIES + 20DV ═══

Deno.test("findLocalTransportRate — partial match THIES 20DV returns 151040", () => {
  const result = findLocalTransportRate(MOCK_RATES, "TRUCKING", makeCtx({ destination_city: "THIES", container_type: "20DV" }), false);
  assertEquals(result !== null, true, "Should match THIES / POPONGUINE via partial");
  assertEquals(result!.rate, 151040);
  assertEquals(result!.source, "local_transport_rate");
});

// ═══ Test 3: AIR interdit (CTO Correction B) ═══

Deno.test("findLocalTransportRate — AIR mode returns null", () => {
  const result = findLocalTransportRate(MOCK_RATES, "TRUCKING", makeCtx({ destination_city: "KAOLACK", container_type: "40DV" }), true);
  assertEquals(result, null, "AIR mode must return null — CTO Correction B");
});

// ═══ Test 4: Container missing (CTO Correction A) ═══

Deno.test("findLocalTransportRate — null container returns null", () => {
  const result = findLocalTransportRate(MOCK_RATES, "TRUCKING", makeCtx({ destination_city: "KAOLACK", container_type: null }), false);
  assertEquals(result, null, "Null container must return null — CTO Correction A");
});
