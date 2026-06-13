/**
 * P1 — Deterministic partner-resolvable gap policy (centralized)
 *
 * Minimal doctrine for the EXPORT_SENEGAL / SEA_FREIGHT partner-quote gap.
 * No AI logic, no DB access here — pure constants/descriptor.
 *
 * Behavior must remain identical to the values previously inlined in
 * build-case-puzzle/index.ts. Do not change keys or wording without GO CTO.
 */

// Gap key raised when an export SEA_FREIGHT case needs a partner ocean-freight quote.
export const EXPORT_SEA_FREIGHT_PARTNER_GAP_KEY = "pricing.sea_freight_partner_quote_required";

// Validated partner fact keys that are considered to COVER the export SEA_FREIGHT gap.
export const EXPORT_SEA_FREIGHT_PARTNER_FACT_KEYS = new Set<string>([
  "cargo.freight_cost",
  "cargo.freight_rate_per_kg",
  "pricing.sea_freight",
  "pricing.sea_freight_rate",
  "sea_freight",
]);
