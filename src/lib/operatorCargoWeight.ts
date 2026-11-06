import { readOperatorBasis } from "../../supabase/functions/_shared/operator-quotation-basis";

/** Presentation from this immutable operator scope only. Never relabel legacy globals
 * or sum different lots; the optional per-lot total is explicitly derived, not a fact. */
export function operatorCargoWeightText(value: unknown): string[] {
  const basis = readOperatorBasis(value);
  if (!basis) return [];
  const fmt = (n: number) => new Intl.NumberFormat("fr-FR", { maximumSignificantDigits: 21 }).format(n);
  const nonnegative = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
  return (basis.scope.cargo_units as unknown[]).map((item, index) => {
    const u = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
    const label = typeof u.unit_ref === "string" && u.unit_ref.trim() ? u.unit_ref : String(index + 1);
    const weight = nonnegative(u.gross_weight_kg) ? u.gross_weight_kg : null;
    const quantity = nonnegative(u.quantity) && Number.isSafeInteger(u.quantity) && u.quantity > 0 ? u.quantity : null;
    const equipment = typeof u.equipment_code === "string" ? u.equipment_code.toUpperCase() : "équipement non précisé";
    const ownership = u.ownership === "COC" || u.ownership === "SOC" ? u.ownership : "propriété non précisée";
    const prefix = `Lot ${label} — hypothèse enregistrée : ${quantity === null ? "quantité non précisée" : fmt(quantity)} × ${equipment}, ${ownership} ; `;
    if (weight === null) return `${prefix}poids brut non précisé.`;
    if (u.weight_basis === "total") return `${prefix}poids brut total du lot ${fmt(weight)} kg (${fmt(weight / 1000)} tonnes).`;
    if (u.weight_basis !== "per_unit") return `${prefix}poids brut ${fmt(weight)} kg ; base par unité ou total du lot non précisée.`;
    const total = quantity === null ? null : quantity * weight;
    return `${prefix}${fmt(weight)} kg par unité${quantity === null ? "; quantité non précisée" : ` × ${fmt(quantity)}`}${total !== null && Number.isSafeInteger(total) ? ` ; poids total du lot calculé depuis ces bases : ${fmt(total)} kg (${fmt(total / 1000)} tonnes)` : " ; poids total du lot non établi"}.`;
  });
}
