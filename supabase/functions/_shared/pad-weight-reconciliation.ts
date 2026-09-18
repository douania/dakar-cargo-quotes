import type { PadGroupContext, PadGroupDecision } from "./pad-group-confirmation.ts";

export type WeightFact = { id: string; number: number | null; text: string | null; source_type: string; source_email_id: string | null };
export type WeightReconciliation = { id: string; case_id: string; context_hash: string; confirmation_heads: PadGroupDecision[];
  original_fact: WeightFact; total_weight_kg: number; action: "retain" | "revoke"; justification: string; reservation: string };
export const PAD_WEIGHT_REVIEW_FR = "Écart de poids à rapprocher : les catégories PAD peuvent déjà être validées. Vérifiez le poids extrait et la somme des groupes, puis retenez explicitement une base de cotation révisable avec sa source et sa réserve. Ne recommencez pas les validations de catégorie pour résoudre cet écart.";
export const PAD_WEIGHT_REVIEW_TITLE = "Rapprocher le poids extrait et la base de cotation";

function headIds(heads: PadGroupDecision[]): string {
  return heads.map(h => h.id).sort().join("|");
}
export function usableWeightReconciliation(context: PadGroupContext, heads: PadGroupDecision[], facts: WeightFact[], decision: WeightReconciliation | null): boolean {
  if (!decision || decision.action !== "retain" || decision.case_id !== context.case_id || decision.context_hash !== context.context_hash ||
    !Array.isArray(decision.confirmation_heads) || headIds(decision.confirmation_heads) !== headIds(heads) ||
    facts.length !== 1 || facts[0].source_type !== "ai_extraction" ||
    !decision.original_fact || Object.keys(facts[0]).some(k => facts[0][k as keyof WeightFact] !== decision.original_fact[k as keyof WeightFact]) ||
    typeof decision.justification !== "string" || decision.justification.trim().length < 10 ||
    typeof decision.reservation !== "string" || decision.reservation.trim().length < 10 || decision.reservation.length > 2000) return false;
  const weights = context.groups.map(g => g.total_weight_kg);
  return weights.length > 0 && weights.every(w => typeof w === "number" && Number.isFinite(w) && w > 0) &&
    Number.isFinite(decision.total_weight_kg) && Math.abs(weights.reduce<number>((sum, w) => sum + w!, 0) - decision.total_weight_kg) < 0.001;
}
