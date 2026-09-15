import { buildScopeSnapshot, emptyCargoUnitDraft, emptyScenarioDraftV2, type ScenarioDraft } from "./quoteScenarios";
import type { ScenarioProposal } from "../../supabase/functions/recommend-pad-category/scenario-domain";
export type { ScenarioProposal };

export function proposalToDraft(proposal: ScenarioProposal): ScenarioDraft {
  if (proposal.status !== "proposed" || !/^[a-f0-9]{64}$/.test(proposal.source_fingerprint) ||
    !Array.isArray(proposal.groups) || !proposal.groups.length || proposal.groups.length > 12) throw new Error("Proposition source invalide");
  const draft = emptyScenarioDraftV2();
  draft.title = "Proposition maritime — hypothèses par groupes";
  draft.cargoUnits = proposal.groups.map((g, i) => ({
    ...emptyCargoUnitDraft(i + 1, 2), unitRef: g.unit_ref, equipmentKnown: true, equipmentCode: g.equipment.toLowerCase(),
    quantity: String(g.quantity), grossWeightKg: g.weight_kg === null ? "" : String(g.weight_kg),
    ownership: g.ownership, weightBasis: g.weight_basis, dangerousGoods: g.dangerous,
    unNumber: g.un_number ?? "", imoClass: g.imo_class ?? "",
    // Existing immutable scenario field, bounded by the server's 200-character structural guard.
    // Keep the full source fingerprint and email ID; no PAD amounts or inferred facts in this field.
    scenarioBasis: `Hypothèses à vérifier; e-mail ${g.source_email_id}; SHA256 ${proposal.source_fingerprint}; ${g.assumptions.some(a => a.includes("fourchette")) ? "poids haut; " : ""}${g.quantity_basis === "explicit_containers" ? "Qté conteneurs source." : "1 unité/conteneur."}`,
  }));
  const built = buildScopeSnapshot(draft);
  if (!built.ok || draft.cargoUnits.some(g => (g.scenarioBasis?.length ?? 0) > 200)) throw new Error("Proposition incompatible avec le contrat scénario ; vérifier les groupes");
  return draft;
}

export function proposalReason(code: string): string {
  const labels: Record<string, string> = {
    CLIENT_SOURCE_UNVERIFIED: "Expéditeur client non vérifié : pas de proposition automatique.",
    SOURCE_BODY_UNAVAILABLE: "Corps d’e-mail absent, encodé ou incomplet : lecture manuelle nécessaire.",
    SOURCE_REVISION_REVIEW: "Une correction ou annulation est mentionnée : vérifier quelle liste fait foi.",
    CARGO_ROW_UNSUPPORTED: "Une ligne de marchandises n’est pas interprétable sans ambiguïté.",
    CONDITIONAL_CARGO_ROW: "Une ligne est conditionnelle : son contenu doit être vérifié.",
    OWNERSHIP_CONFLICT: "SOC et COC se contredisent sur une même ligne.",
    IMO_ROW_REVIEW: "Numéro ONU ou classe à vérifier sur une ligne ; aucun rattachement automatique.",
    INCOMPLETE_CARGO_LIST: "Liste numérotée incomplète ou désordonnée : vérifier les groupes.",
    MULTIPLE_CARGO_SOURCES: "Plusieurs listes client existent : choisir la version applicable avant de créer un scénario.",
    UN_OUTSIDE_GROUP: "Mention ONU/IMO ou classe située hors des lignes de marchandises : rattachement à vérifier.",
    CARGO_LIST_REQUIRED: "Aucune liste de conteneurs exploitable détectée ; le scénario manuel reste disponible.",
    PAD_CATALOG_UNAVAILABLE: "Catalogue PAD complet non disponible : aucune catégorie ni tarif inventé.",
    PAD_AI_UNAVAILABLE: "Suggestions PAD indisponibles ; la proposition de groupes reste utilisable.",
    PAD_NO_SOURCED_CANDIDATE: "Aucun candidat PAD rattaché à un alias validé trouvé.",
  };
  return labels[code] ?? code;
}
