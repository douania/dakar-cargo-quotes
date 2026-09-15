import type { ScenarioTariffLine } from "./domain.ts";
import { scenarioPadViolation, type ScenarioPadChoice } from "../_shared/scenario-pad-contract.ts";

type Row = Record<string, unknown>;
/** One current source per category, one line per group. No global classification fallback. */
export function priceScenarioPad(snapshot: Row, tariffs: Row[], today: string): ScenarioTariffLine[] {
  if (scenarioPadViolation(snapshot)) throw new Error("SCENARIO_PAD_CONTRACT_INVALID");
  return (snapshot.pad_choices as ScenarioPadChoice[]).map(choice => {
    const unit = (snapshot.cargo_units as Row[]).find(u => u.unit_ref === choice.unit_ref)!;
    const weight = typeof unit.gross_weight_kg === "number" && unit.gross_weight_kg > 0 &&
      ["total", "per_unit"].includes(String(unit.weight_basis))
      ? unit.gross_weight_kg * (unit.weight_basis === "per_unit" ? Number(unit.quantity) : 1) : null;
    const valid = tariffs.filter(t => unit.unit_kind === "CONTAINER" && t.classification === choice.category && choice.category !== null &&
      t.provider === "PAD" && t.category === "DROIT_PASSAGE" && t.operation_type === "IMPORT" &&
      // port_tariffs PAD has no currency column: its existing contract is FCFA/t.
      t.cargo_type === "CONTENEUR" && t.is_active === true && (t.currency === undefined || t.currency === "XOF") &&
      ["official", "validated_internal"].includes(String(t.evidence_level)) &&
      typeof t.id === "string" && typeof t.source_document === "string" && t.source_document.trim() &&
      ["t", "ton", "tonne", "tonnes"].includes(String(t.unit).trim().toLowerCase()) &&
      typeof t.amount === "number" && Number.isFinite(t.amount) && t.amount > 0 &&
      typeof t.effective_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.effective_date) && t.effective_date <= today &&
      (t.expiry_date === null || (typeof t.expiry_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.expiry_date) && t.expiry_date >= today)));
    const rate = valid.length === 1 ? valid[0] : null;
    const computed = rate && weight !== null && Number.isSafeInteger(weight) && weight <= 1e12 ? Math.round(weight / 1000 * Number(rate.amount)) : null;
    const amount = computed !== null && Number.isSafeInteger(computed) ? computed : null;
    const reason = choice.category === null ? "Catégorie PAD à choisir pour ce groupe" : weight === null ? "Poids du groupe à préciser" : "Source tarifaire PAD unique et applicable non vérifiée";
    return { id: `scenario-pad-${choice.unit_ref}`, bloc: "operationnel", category: "PAD_DROIT_PASSAGE", canonical: { service_key: "PAD_DROIT_PASSAGE" },
      description: `Droit de passage PAD — ${choice.unit_ref}${choice.category ? ` (${choice.category})` : ""}`,
      amount, currency: "XOF", isEditable: false,
      notes: amount !== null ? `Classification de scénario, non confirmée comme fait client. ${choice.basis}` : reason,
      source: amount !== null ? { type: String(rate!.evidence_level), reference: String(rate!.source_document),
        tariff_id: rate!.id, unit_ref: choice.unit_ref, category: choice.category, unit_rate: rate!.amount, weight_kg: weight,
        effective_date: rate!.effective_date, expiry_date: rate!.expiry_date, currency: "XOF", currency_basis: "PAD_CATALOG_FCFA_PER_TONNE", confidence: 0.8 }
        : { type: "TO_CONFIRM", reference: reason, unit_ref: choice.unit_ref, confidence: 0 } };
  });
}
