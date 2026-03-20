export type FactReviewLevel = "strong" | "medium" | "weak" | "conflict";

export interface FactReview {
  level: FactReviewLevel;
  label: string;
  reasons: string[];
}

interface FactInput {
  id: string;
  fact_key: string;
  proposed_value_number: number | null;
  proposed_value_text: string | null;
  currency: string | null;
  confidence: number;
  validation_status: string;
}

const MONETARY_PATTERN = /rate|cost|amount|charge|price|freight/i;

function isMonetaryFact(factKey: string): boolean {
  return MONETARY_PATTERN.test(factKey);
}

function hasValue(fact: FactInput): boolean {
  if (fact.proposed_value_number != null) return true;
  if (fact.proposed_value_text && fact.proposed_value_text.trim().length > 0) return true;
  return false;
}

export function reviewPartnerFact(
  fact: FactInput,
  siblingFacts: FactInput[],
): FactReview {
  const reasons: string[] = [];

  // 1. Conflict detection among proposed siblings
  const proposedSiblings = siblingFacts.filter(
    (f) => f.validation_status === "proposed",
  );

  if (proposedSiblings.length > 0) {
    const hasNumericConflict =
      fact.proposed_value_number != null &&
      proposedSiblings.some(
        (s) =>
          s.proposed_value_number != null &&
          s.proposed_value_number !== fact.proposed_value_number,
      );

    const hasDeviseConflict =
      fact.currency != null &&
      proposedSiblings.some(
        (s) => s.currency != null && s.currency !== fact.currency,
      );

    if (hasNumericConflict || hasDeviseConflict) {
      if (hasNumericConflict) reasons.push("Valeurs numériques différentes");
      if (hasDeviseConflict) reasons.push("Devises différentes");
      return { level: "conflict", label: "Conflit", reasons };
    }
  }

  // 2. Strong
  const monetary = isMonetaryFact(fact.fact_key);
  const valuePresent = hasValue(fact);
  const highConfidence = fact.confidence >= 0.85;

  if (highConfidence && valuePresent && (!monetary || fact.currency != null)) {
    if (fact.proposed_value_number != null) reasons.push("Montant structuré");
    if (highConfidence) reasons.push("Confiance IA élevée");
    if (monetary && fact.currency) reasons.push("Devise présente");
    return { level: "strong", label: "Confiance forte", reasons };
  }

  // 3. Weak
  if (
    fact.confidence < 0.6 ||
    !valuePresent ||
    (monetary && fact.currency == null)
  ) {
    if (fact.confidence < 0.6) reasons.push("Confiance IA faible");
    if (!valuePresent) reasons.push("Valeur absente");
    if (monetary && fact.currency == null) reasons.push("Devise manquante");
    return { level: "weak", label: "Faible", reasons };
  }

  // 4. Medium fallback
  reasons.push("À vérifier manuellement");
  return { level: "medium", label: "À vérifier", reasons };
}
