import { buildScopeSnapshot, emptyCargoUnitDraft, emptyScenarioDraftV2, type ScenarioDraft } from "./quoteScenarios";
import type { ScenarioProposal } from "../../supabase/functions/recommend-pad-category/scenario-domain";
export type { ScenarioProposal };

/** Reuse reviewed candidates without replacing quantities, routing, links or other
 * choices in an existing scenario. Same reference alone is NOT a source match. */
export function proposalPadRevision(current: ScenarioDraft, proposal: ScenarioProposal, choices: Record<string, string>): ScenarioDraft {
  const proposed = proposalToDraft(proposal, choices);
  if ((current.schemaVersion ?? 1) < 2 || current.transportMode !== "MARITIME" ||
    current.movementDirection !== "IMPORT" || !Object.values(choices).some(Boolean)) {
    throw new Error("Choisir au moins une catégorie PAD pour un scénario maritime d’import.");
  }
  const selected = Object.entries(choices).filter(([, category]) => category);
  for (const [ref] of selected) {
    const existing = current.cargoUnits.filter(g => g.unitRef === ref);
    const incoming = proposed.cargoUnits.find(g => g.unitRef === ref);
    const source = proposal.groups.find(g => g.unit_ref === ref);
    const keys = ["unitKind", "equipmentCode", "quantity", "ownership", "weightBasis", "grossWeightKg", "dangerousGoods", "unNumber", "imoClass"] as const;
    if (existing.length !== 1 || !incoming || !source || keys.some(k => existing[0][k] !== incoming[k]) ||
      !existing[0].scenarioBasis?.includes(proposal.source_fingerprint) || !existing[0].scenarioBasis?.includes(source.source_email_id)) {
      throw new Error(`Sources ou groupe ${ref} différents : vérifier manuellement le choix PAD, sans remplacer le scénario.`);
    }
  }
  const next = { ...current, schemaVersion: 3 as const, revisionReason: "Choix PAD sourcés revus pour l’estimation",
    padChoices: current.cargoUnits.map(g => {
      if (!choices[g.unitRef]) return current.padChoices?.find(c => c.unit_ref === g.unitRef) ?? { unit_ref: g.unitRef, category: null, basis: "" };
      const candidate = proposal.pad_candidates.find(c => c.unit_ref === g.unitRef && c.category === choices[g.unitRef])!;
      if (!candidate.matching_aliases.length) throw new Error("Choix PAD sans alias validé");
      const reference = String(candidate.tariff_source?.id ?? "tarif à vérifier");
      return { unit_ref: g.unitRef, category: candidate.category,
        basis: `Hypothèse PAD ${candidate.category}; alias ${candidate.matching_aliases[0].slice(0, 90)}; réf. ${reference.slice(0, 50)}. Tarif relu au calcul.`.slice(0, 200) };
    }) };
  if (!buildScopeSnapshot(next).ok) throw new Error("Révision PAD incompatible avec le contrat scénario");
  return next;
}

export function proposalToDraft(proposal: ScenarioProposal, choices?: Record<string, string>): ScenarioDraft {
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
  if (choices && Object.values(choices).some(Boolean)) {
    if (Object.keys(choices).some(ref => !proposal.groups.some(g => g.unit_ref === ref))) throw new Error("Groupe PAD inconnu");
    draft.schemaVersion = 3;
    draft.padChoices = proposal.groups.map(g => {
      const category = choices[g.unit_ref] || null;
      const candidate = proposal.pad_candidates.find(c => c.unit_ref === g.unit_ref && c.category === category);
      if (category && !candidate) throw new Error("Choix PAD absent de la proposition");
      return { unit_ref: g.unit_ref, category, basis: candidate ? `Choix opérateur PAD ${category}; ${candidate.justification}`.slice(0, 200) : "" };
    });
  }
  const built = buildScopeSnapshot(draft);
  if (!built.ok || draft.cargoUnits.some(g => (g.scenarioBasis?.length ?? 0) > 200)) throw new Error("Proposition incompatible avec le contrat scénario ; vérifier les groupes");
  return draft;
}

export function proposalReason(code: string): string {
  const labels: Record<string, string> = {
    CLIENT_SOURCE_UNVERIFIED: "Expéditeur client non vérifié : pas de proposition automatique.",
    CLIENT_IDENTITY_CONFLICT: "Identités client contradictoires ou invalides entre le dossier et le fil : vérifier la source.",
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
