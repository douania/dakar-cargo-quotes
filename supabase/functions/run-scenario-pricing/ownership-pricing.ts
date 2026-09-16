import type { ScenarioCargoContext } from "../_shared/scenario-cargo.ts";
import type { PricingFactRow, ScenarioTariffLine } from "./domain.ts";

/** Scenario-only applicability. Never invent a haulage rate or assume that an
 * absent destination country means Senegal (legacy canonical rule does). */
export function scenarioEmptyReturnLines(cargo: ScenarioCargoContext, facts: PricingFactRow[], movementDirection: string): ScenarioTariffLine[] {
  const countries = facts.filter(f => f.fact_key === "routing.destination_country")
    .map(f => String(f.value_text ?? "").trim().toUpperCase());
  const senegal = countries.length > 0 && countries.every(c => ["SN", "SENEGAL", "SÉNÉGAL"].includes(c));
  return cargo.cargo_units.map(u => {
    const soc = u.ownership === "SOC";
    const excluded = soc || (u.ownership === "COC" && senegal && movementDirection === "IMPORT");
    const reason = soc ? "SCENARIO_SOC_NO_CARRIER_RETURN" : excluded ? "EMPTY_RETURN_IMPORT_SN_CLIENT_OBLIGATION" : "EMPTY_RETURN_CONTRACT_AND_RATE_REQUIRED";
    return {
      id: `scenario-empty-return-${u.unit_ref}`, bloc: "operationnel", category: "EMPTY_RETURN",
      canonical: { service_key: "EMPTY_RETURN" }, currency: "XOF", amount: excluded ? 0 : null, isEditable: false,
      description: `Retour vide armateur — ${u.unit_ref} (${u.ownership})${excluded ? ' — exclu de l’estimation' : ' — à confirmer'}`,
      notes: soc ? "Hypothèse SOC : pas de restitution du conteneur à l’armateur. Tout repositionnement demandé par le client reste à chiffrer séparément ; aucun transport gratuit présumé."
        : excluded ? "Règle métier existante import Sénégal : retour vide à la charge du client, non facturé par SODATRA dans cette estimation. Zéro signifie exclusion, pas gratuité du transport ; responsabilité contractuelle à vérifier."
        : "COC : lieu de restitution, responsabilité contractuelle et tarif à confirmer. Aucun pays, forfait ni retour inclus déduit de la seule destination de livraison.",
      source: { type: excluded ? "EXCLUDED_BY_RULE" : "TO_CONFIRM", reference: reason, unit_ref: u.unit_ref,
        ownership: u.ownership, basis: u.scenario_basis, confidence: 0,
        ...(excluded && !soc ? { rule_source: "price-service-lines:EMPTY_RETURN_IMPORT_SN" } : {}) },
    };
  });
}
