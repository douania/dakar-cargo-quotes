/**
 * PAD-RUNTIME-EXPAND / Lot B
 *
 * Types purs pour le resolver PAD canonique.
 * Aucune dépendance externe — utilisable côté front (Vite/React) ET côté Deno
 * (copie miroir future dans supabase/functions/_shared/pad/ au Lot C).
 *
 * Famille canonique invariante : DROIT_PASSAGE (barème PAD 2006).
 * PORT_TAX n'est JAMAIS une famille canonique de sortie.
 */

export type PadOperationType =
  | "IMPORT"
  | "EXPORT"
  | "TRANSIT_IMPORT"
  | "TRANSIT_EXPORT"
  | "TRANSBORDEMENT";

export type PadCargoType = "CONTENEUR" | "CONVENTIONNEL";

export type PadCanonicalRateFamily = "DROIT_PASSAGE";

export type PadClassificationSource =
  | "operator_confirmed"
  | "validated_alias"
  | "hs_to_nst"
  | "nst_rule"
  | "designation_match"
  | "ai_suggestion"
  | "none";

export type PadBlockingGap =
  | "pricing.pad_category_required"
  | "pricing.cargo_type_required"
  | "pricing.operation_type_required"
  | "pricing.container_size_required_for_T13_transit"
  | "pricing.hs_or_nst_required"
  | "pricing.pad_classification_needs_review"
  | "pricing.invoice_label_unmapped"
  | "pricing.port_tax_alias_needs_review"
  | null;

/**
 * Tailles conteneur acceptées. Type ouvert (string) pour accommoder les
 * libellés non standards observés en facture (ex : "20HC", "40HQ"), mais
 * le helper n'inventera jamais le mapping vers C01/C02/C03 sans contexte.
 */
export type PadContainerSize = 20 | 40 | string | null;

export interface ResolvePadInput {
  /** Catégorie PAD confirmée par opérateur (priorité 1 absolue). */
  known_pad_category?: string | null;

  /** Désignation marchandise libre. */
  designation?: string | null;

  /** Codes nomenclatures (chacun optionnel ; aucun n'est normalisé en interne). */
  hs_code?: string | null;
  cn_code?: string | null;
  nhm_code?: string | null;
  nstr_code?: string | null;
  /** NST 2007 : group "XX.X" ou division "XX". */
  nst_code?: string | null;

  /** Libellé facture / commercial éventuel (ex: "Taxe de port", "PORT_TAX"). */
  invoice_label?: string | null;

  operation_type?: PadOperationType | null;
  cargo_type?: PadCargoType | null;
  container_size?: PadContainerSize;

  /** Suggestion IA brute (texte ou catégorie proposée). Jamais OFFICIAL. */
  ai_suggestion?: string | null;
}

export interface ResolvePadOutput {
  canonical_rate_family: PadCanonicalRateFamily; // toujours "DROIT_PASSAGE"
  classification: string | null;
  operation_type: PadOperationType | null;
  cargo_type: PadCargoType | null;
  container_size: PadContainerSize;
  confidence: number; // 0.0 .. 1.0
  source: PadClassificationSource;
  reason: string;
  needs_human_review: boolean;
  blocking_gap: PadBlockingGap;
  warnings: string[];
}

/* -------------------------------------------------------------------------- */
/* Contexte injecté (toutes les données de référence viennent de l'appelant). */
/* -------------------------------------------------------------------------- */

export type PadAliasKind = "designation" | "invoice_label" | "carrier_label";

export interface PadAliasCandidate {
  /** Forme normalisée du terme (lowercase, trim, espaces compactés). */
  normalized_term: string;
  pad_category: string;
  alias_kind: PadAliasKind;
  is_validated: boolean;
  source_type?: string | null;
}

export interface PadNstRuleCandidate {
  nst_level: "group" | "division";
  nst_code: string;
  pad_category: string;
  /** Confiance fournie par la règle (0..1). */
  confidence: number;
  requires_operator_validation: boolean;
  validation_status: "candidate" | "validated" | "rejected" | string;
}

export interface PadDesignationMatchCandidate {
  normalized_term: string;
  pad_category_candidate: string;
  is_validated: boolean;
  score?: number | null;
}

/**
 * Mapping explicite HS/CN/NHM → NST. Le resolver ne dérive JAMAIS ce mapping
 * (pas de "8 premiers chiffres", pas de "chapitre HS"). L'appelant fournit
 * le couple validé.
 */
export interface PadHsToNstMapping {
  /** Code source tel que reçu en input (hs_code/cn_code/nhm_code). */
  source_code: string;
  source_kind: "hs" | "cn" | "nhm";
  nst_code: string;
  nst_level: "group" | "division";
  /** Catégorie PAD résolue uniquement si règle NST→PAD validée. */
  pad_category: string | null;
  is_unique: boolean;
}

/**
 * Mapping taille conteneur → catégorie C01/C02/C03 pour T13 transit/transbordement.
 * NON fourni par défaut : sans cette table, le resolver bloque.
 */
export interface PadContainerSizeToCxx {
  container_size: PadContainerSize;
  classification: "C01" | "C02" | "C03";
  source_document?: string | null;
}

export interface ResolvePadContext {
  aliases?: PadAliasCandidate[];
  nstRules?: PadNstRuleCandidate[];
  designationMatches?: PadDesignationMatchCandidate[];
  hsToNstMapping?: PadHsToNstMapping[];
  containerSizeToCxxMapping?: PadContainerSizeToCxx[];
}
