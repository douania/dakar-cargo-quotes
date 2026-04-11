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

// ---------------------------------------------------------------------------
// P2-A — Partner collection verdict (pure function, no React dependency)
// ---------------------------------------------------------------------------

export type CollectionVerdict = "neutral" | "insufficient" | "in_progress" | "sufficient";

/**
 * Compute the partner collection readiness verdict.
 *
 * Semantics:
 *  - `neutral`       → 0 partner requests exist (direct pricing)
 *  - `insufficient`  → requests exist but none are exploitable yet
 *  - `in_progress`   → some exploitable, but open requests or pending facts remain
 *  - `sufficient`    → all requests closed or exploitable with 0 pending facts
 *
 * "Exploitable" means: the request is `closed`, **or** it is in a response
 * phase AND has zero pending (proposed) facts.  Note: `closed` is NOT in
 * `RESPONSE_PHASE_STATUSES` — it is an exploitable terminal state handled
 * explicitly here.
 */
export function computeCollectionVerdict(
  requests: ReadonlyArray<{ id: string; status: string }>,
  pendingFactsByRequestId: ReadonlyMap<string, number>,
): { verdict: CollectionVerdict; exploitable: number; openCount: number; totalPending: number } {
  const total = requests.length;
  if (total === 0) {
    return { verdict: "neutral", exploitable: 0, openCount: 0, totalPending: 0 };
  }

  let exploitable = 0;
  let openCount = 0;
  let totalPending = 0;

  for (const [, count] of pendingFactsByRequestId) {
    totalPending += count;
  }

  for (const r of requests) {
    if (r.status === "closed") {
      exploitable++;
      continue;
    }
    openCount++;
    if (RESPONSE_PHASE_STATUSES.has(r.status) && (pendingFactsByRequestId.get(r.id) ?? 0) === 0) {
      exploitable++;
    }
  }

  let verdict: CollectionVerdict;
  if (exploitable === 0) {
    verdict = "insufficient";
  } else if (openCount > 0 || totalPending > 0) {
    verdict = "in_progress";
  } else {
    verdict = "sufficient";
  }

  return { verdict, exploitable, openCount, totalPending };
}
