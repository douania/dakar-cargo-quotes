/**
 * PAD-NST-2E-C-D — Constantes locales du panneau UI opérateur PAD-NST.
 *
 * Frontend-only. Aucune dépendance DB côté écriture.
 * - Libellés PAD : SOURCE DE VÉRITÉ = commodity_categories(pad_category, pad_category_label)
 *   chargée par PadNstSuggestionsPanel et passée en argument à getPadCategoryLabel.
 *   Aucun libellé hardcodé — fallback strict "<code> (libellé non référencé)".
 * - Traduction evidence_level → libellé FR.
 * - Familles de conflits critiques P1-C (alertes UI au-dessus des cartes).
 */

/**
 * Restitue le libellé PAD officiel depuis un dictionnaire externe (commodity_categories).
 * Null-safe. N'invente JAMAIS de libellé : fallback strict si code absent ou dict vide.
 */
export function getPadCategoryLabel(
  code: string | null | undefined,
  dict?: Record<string, string>,
): string {
  if (!code) return "—";
  const label = dict?.[code];
  if (label && label.trim().length > 0) return label;
  return `${code} (libellé non référencé)`;
}

export const EVIDENCE_LEVEL_LABELS: Record<string, string> = {
  expert_rule: "Règle experte PAD-NST",
  nstr_bridge_inferred: "Inférée par correspondance NST/R → NST",
};

export function getEvidenceLevelLabel(level: string | null | undefined): string {
  if (!level) return "—";
  return EVIDENCE_LEVEL_LABELS[level] ?? level;
}

/**
 * Confidence display rules (§6 spec PAD_NST_2E_C_D_UI_OPERATOR_SPEC).
 */
export type ConfidenceTier = "strong" | "probable" | "weak";

export function getConfidenceTier(confidence: number | null | undefined): ConfidenceTier | null {
  if (confidence == null) return null;
  if (confidence >= 0.8) return "strong";
  if (confidence >= 0.6) return "probable";
  if (confidence >= 0.45) return "weak";
  return null;
}

export const CONFIDENCE_TIER_LABELS: Record<ConfidenceTier, string> = {
  strong: "Forte — validation obligatoire",
  probable: "Probable — à confirmer",
  weak: "Faible — prudence",
};

/**
 * Conflits critiques P1-C (5 familles documentées dans PAD_NST_P1_C_CONFLICTS_GUIDE.md).
 * Match par nst_code (group ou division).
 */
export interface PadNstConflictAlert {
  family: string;
  message: string;
}

export const PAD_NST_CONFLICTS: Array<{ codes: string[]; alert: PadNstConflictAlert }> = [
  {
    codes: ["09", "09.2", "03.5"],
    alert: {
      family: "Ciment / Clinker",
      message:
        "Ciment ou clinker ? Vérifiez si la marchandise est conditionnée (→ T05) ou en vrac non conditionné (→ T07).",
    },
  },
  {
    codes: ["03.3", "08.3"],
    alert: {
      family: "Phosphates / Engrais",
      message:
        "Phosphates ou engrais formulés ? T08 est recommandé pour les minéraux bruts. T06 uniquement si contexte hydrocarbure confirmé.",
    },
  },
  {
    codes: ["02", "07", "07.3"],
    alert: {
      family: "Pétrole / Hydrocarbures",
      message:
        "T11 pour pétrole brut / essences / bitumes. T06 pour gasoil / diesel / fuel / butane. Validation opérateur indispensable si libellé incomplet.",
    },
  },
  {
    codes: ["08", "08.4", "08.6"],
    alert: {
      family: "Plastiques",
      message:
        "Plastique brut / granule → T03. Tuyau / film / produit fini → T12. Vérifiez le stade de transformation.",
    },
  },
  {
    codes: ["02.3"],
    alert: {
      family: "Gaz naturel",
      message:
        "⚠️ Aucune catégorie PAD dominante pour le gaz naturel. Validation opérateur obligatoire — préciser la forme physique (bouteille, vrac, GNL, pipeline).",
    },
  },
];

export function findConflictAlert(nstCode: string | null | undefined): PadNstConflictAlert | null {
  if (!nstCode) return null;
  for (const entry of PAD_NST_CONFLICTS) {
    if (entry.codes.includes(nstCode)) return entry.alert;
  }
  return null;
}
