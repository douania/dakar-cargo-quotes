/** A commercial assumption is never a client fact. Absence means legacy exact basis. */
export type WeightBasis = "confirmed" | "provisional";
export type WeightBasisDecision = { weight_basis?: WeightBasis; weight_reservation?: string;
  weight_container_count?: number; weight_per_container_kg?: number };
export function validWeightBasis(d: WeightBasisDecision): boolean {
  const mode = d.weight_basis ?? "confirmed";
  const reserve = d.weight_reservation ?? "";
  return typeof reserve === "string" && reserve.length <= 2000 &&
    (mode === "confirmed" ? reserve === "" : mode === "provisional" && reserve.trim().length >= 10);
}
export function weightBasisNotice(unitRef: string, weightKg: number, d: WeightBasisDecision): string | null {
  if (!validWeightBasis(d) || !Number.isFinite(weightKg) || weightKg <= 0) throw new Error("WEIGHT_BASIS_INVALID");
  const hasUnit = d.weight_container_count !== undefined || d.weight_per_container_kg !== undefined;
  if (hasUnit && (!Number.isSafeInteger(d.weight_container_count) || d.weight_container_count! <= 0 ||
    !Number.isFinite(d.weight_per_container_kg) || d.weight_per_container_kg! <= 0 ||
    Math.abs(d.weight_container_count! * d.weight_per_container_kg! - weightKg) > 0.001)) throw new Error("WEIGHT_BASIS_INVALID");
  const basis = hasUnit ? `${d.weight_container_count} conteneurs × ${d.weight_per_container_kg! / 1000} tonnes/conteneur = ${weightKg / 1000} tonnes` : `${weightKg / 1000} tonnes`;
  return d.weight_basis === "provisional"
    ? `Groupe ${unitRef} : base de cotation ${basis}, poids non définitif. ${d.weight_reservation!.trim()}` : null;
}

/** Read the immutable calculation lines, not today's mutable case or decisions. */
export function quotationWeightNotices(lines: readonly unknown[]): string[] {
  return lines.flatMap(raw => {
    const l = raw as { quantity?: number; source?: WeightBasisDecision & { unit_ref?: string } };
    if (!l?.source || l.source.weight_basis !== "provisional") return [];
    if (typeof l.source.unit_ref !== "string" || typeof l.quantity !== "number") throw new Error("WEIGHT_BASIS_INVALID");
    return [weightBasisNotice(l.source.unit_ref, l.quantity * 1000, l.source)!];
  });
}
