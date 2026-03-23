/**
 * Fact keys whose validation should trigger a pricing rerun.
 * Single source of truth — imported by useExternalRequestFlow and getRequestCloseLoopState.
 */
export const PRICING_CRITICAL_KEYS = new Set([
  "cargo.freight_cost",
  "cargo.freight_rate_per_kg",
  "cargo.origin_charges",
  "cargo.pre_carriage_cost",
]);
