/**
 * P1-A — Shared cockpit status constants & helpers.
 * Pure module, zero React dependency.
 * Single source of truth for status hierarchy used across cockpit components.
 */

/** Explicit status hierarchy — no naive string comparison */
export const STATUS_ORDER: Record<string, number> = {
  INTAKE: 0,
  NEW_THREAD: 1,
  RFQ_DETECTED: 2,
  FACTS_PARTIAL: 3,
  NEED_INFO: 4,
  READY_TO_PRICE: 5,
  DECISIONS_PENDING: 6,
  DECISIONS_COMPLETE: 7,
  ACK_READY_FOR_PRICING: 8,
  PRICING_RUNNING: 9,
  PRICED_DRAFT: 10,
  HUMAN_REVIEW: 11,
  QUOTED_VERSIONED: 12,
  SENT: 13,
  ACCEPTED: 14,
  REJECTED: 15,
  ARCHIVED: 16,
};

/** Statuses where no further operator action is expected */
export const TERMINAL_STATUSES = new Set(["SENT", "ACCEPTED", "REJECTED", "ARCHIVED"]);

/** Request statuses indicating a response phase (exploitable data exists) */
export const RESPONSE_PHASE_STATUSES = new Set([
  "response_received",
  "response_analyzed",
  "partially_validated",
  "facts_validated",
]);

export function statusBelow(current: string, threshold: string): boolean {
  return (STATUS_ORDER[current] ?? -1) < (STATUS_ORDER[threshold] ?? 999);
}

export function statusAtLeast(current: string, threshold: string): boolean {
  return (STATUS_ORDER[current] ?? -1) >= (STATUS_ORDER[threshold] ?? 999);
}

export function statusAbove(current: string, threshold: string): boolean {
  return (STATUS_ORDER[current] ?? -1) > (STATUS_ORDER[threshold] ?? 999);
}
