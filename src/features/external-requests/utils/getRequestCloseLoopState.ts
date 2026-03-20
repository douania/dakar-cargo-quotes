export type RequestCloseLoopState =
  | "awaiting_validation"
  | "pricing_rerunning"
  | "ready_to_close"
  | "already_closed"
  | "in_progress";

export interface RequestCloseLoopInfo {
  state: RequestCloseLoopState;
  label: string;
  reasons: string[];
  remainingProposedCount: number;
}

const PRICING_CRITICAL_KEYS = new Set([
  "cargo.freight_cost",
  "cargo.freight_rate_per_kg",
  "cargo.origin_charges",
  "cargo.pre_carriage_cost",
]);

interface FactInput {
  fact_key: string;
  validation_status: string;
}

export function getRequestCloseLoopState(
  requestStatus: string,
  requestFacts: FactInput[],
  isPricingRerunning: boolean,
): RequestCloseLoopInfo {
  // 1. Already closed
  if (requestStatus === "closed") {
    return {
      state: "already_closed",
      label: "Clôturée",
      reasons: ["Demande clôturée par l'opérateur"],
      remainingProposedCount: 0,
    };
  }

  const proposedFacts = requestFacts.filter(
    (f) => f.validation_status === "proposed",
  );
  const validatedFacts = requestFacts.filter(
    (f) => f.validation_status === "validated",
  );

  // 2. Awaiting validation
  if (proposedFacts.length > 0) {
    return {
      state: "awaiting_validation",
      label: `Encore ${proposedFacts.length} fait(s)`,
      reasons: [`${proposedFacts.length} fait(s) proposé(s) restant(s)`],
      remainingProposedCount: proposedFacts.length,
    };
  }

  // 3. Pricing rerunning with validated pricing-critical fact
  if (
    isPricingRerunning &&
    validatedFacts.some((f) => PRICING_CRITICAL_KEYS.has(f.fact_key))
  ) {
    return {
      state: "pricing_rerunning",
      label: "Pricing relancé",
      reasons: ["Recalcul en cours après validation"],
      remainingProposedCount: 0,
    };
  }

  // 4. Ready to close
  if (proposedFacts.length === 0 && validatedFacts.length > 0) {
    return {
      state: "ready_to_close",
      label: "Prête à clôturer",
      reasons: ["Plus aucun fait en attente", "Tous les faits traités"],
      remainingProposedCount: 0,
    };
  }

  // 5. Fallback
  return {
    state: "in_progress",
    label: "En cours",
    reasons: [],
    remainingProposedCount: 0,
  };
}
