/**
 * PAD-RUNTIME-EXPAND / Lot B
 *
 * Constante statique versionnée des alias facture / libellés commerciaux
 * connus pour la redevance "DROITS DE PASSAGE DES MARCHANDISES" (PAD 2006).
 *
 * Règles canoniques :
 * - Tous ces libellés pointent vers canonical_rate_family = "DROIT_PASSAGE".
 * - Aucun de ces libellés n'est, à lui seul, suffisant pour choisir une
 *   classification PAD (T01..T14, P01..P05, C01..C03).
 * - "PORT_TAX" est traité comme alias legacy ; il déclenche un warning
 *   spécifique et requires_review = true.
 *
 * Ce fichier est une donnée statique pure : aucun import externe, aucun effet
 * de bord. Toute modification doit être tracée en revue.
 */

import type { PadCanonicalRateFamily } from "./types";

export interface InvoiceLabelAlias {
  /** Forme normalisée pour comparaison (lowercase, trim, espaces compactés). */
  normalized_label: string;
  /** Libellé tel qu'observé en facture (référence humaine). */
  original_label: string;
  canonical_rate_family: PadCanonicalRateFamily;
  /** Confiance que ce libellé désigne bien la redevance PAD DROIT_PASSAGE. */
  confidence: number;
  /** True si l'opérateur doit valider l'assimilation avant facturation. */
  requires_review: boolean;
  /** Justification courte / preuve documentaire. */
  reason: string;
}

export const INVOICE_LABEL_ALIASES: ReadonlyArray<InvoiceLabelAlias> = [
  {
    normalized_label: "taxe de port",
    original_label: "Taxe de port",
    canonical_rate_family: "DROIT_PASSAGE",
    confidence: 0.9,
    requires_review: false,
    reason:
      "Libellé commercial usuel pour la redevance PAD DROIT_PASSAGE en facture transitaire/compagnie.",
  },
  {
    normalized_label: "port tax",
    original_label: "Port tax",
    canonical_rate_family: "DROIT_PASSAGE",
    confidence: 0.9,
    requires_review: false,
    reason:
      "Traduction anglaise courante de la taxe de port = DROIT_PASSAGE PAD.",
  },
  {
    normalized_label: "taxe pad",
    original_label: "Taxe PAD",
    canonical_rate_family: "DROIT_PASSAGE",
    confidence: 0.95,
    requires_review: false,
    reason:
      "Référence explicite au Port Autonome de Dakar : redevance droits de passage marchandises.",
  },
  {
    normalized_label: "frais de passage portuaire",
    original_label: "Frais de passage portuaire",
    canonical_rate_family: "DROIT_PASSAGE",
    confidence: 0.9,
    requires_review: false,
    reason: "Variante de libellé pour DROIT_PASSAGE PAD.",
  },
  {
    normalized_label: "droit de passage",
    original_label: "Droit de passage",
    canonical_rate_family: "DROIT_PASSAGE",
    confidence: 1.0,
    requires_review: false,
    reason: "Libellé officiel singulier du barème PAD 2006.",
  },
  {
    normalized_label: "droits de passage",
    original_label: "Droits de passage",
    canonical_rate_family: "DROIT_PASSAGE",
    confidence: 1.0,
    requires_review: false,
    reason:
      "Libellé officiel pluriel du barème PAD 2006 (DROITS DE PASSAGE DES MARCHANDISES).",
  },
  {
    normalized_label: "port_tax",
    original_label: "PORT_TAX",
    canonical_rate_family: "DROIT_PASSAGE",
    confidence: 0.6,
    requires_review: true,
    reason:
      "Code legacy historique présent en base (lignes Taleb_Quote_2024). Doit être assimilé à DROIT_PASSAGE sans créer de famille parallèle. Validation opérateur requise.",
  },
  {
    normalized_label: "txi",
    original_label: "TXI",
    canonical_rate_family: "DROIT_PASSAGE",
    confidence: 0.5,
    requires_review: true,
    reason:
      "Code carrier observé : assimilation à DROIT_PASSAGE probable mais à confirmer cas par cas.",
  },
  {
    normalized_label: "port charges",
    original_label: "Port charges",
    canonical_rate_family: "DROIT_PASSAGE",
    confidence: 0.5,
    requires_review: true,
    reason:
      "Libellé générique compagnie pouvant inclure d'autres frais. Validation opérateur requise.",
  },
  {
    normalized_label: "port dues",
    original_label: "Port dues",
    canonical_rate_family: "DROIT_PASSAGE",
    confidence: 0.5,
    requires_review: true,
    reason:
      "Libellé générique compagnie pouvant inclure d'autres frais. Validation opérateur requise.",
  },
];

/** Warning spécifique émis quand un libellé "PORT_TAX" est rencontré. */
export const PORT_TAX_ALIAS_WARNING = "port_tax_alias_treated_as_droit_passage";

/** Warning émis pour tout autre libellé facture reconnu (informatif). */
export const INVOICE_LABEL_RECOGNIZED_WARNING =
  "invoice_label_recognized_as_droit_passage";

/** Warning émis pour un libellé facture présent mais non mappé. */
export const INVOICE_LABEL_UNMAPPED_WARNING = "invoice_label_unmapped";

/**
 * Normalise un libellé facture pour comparaison.
 * Pure : pas de regex Unicode lourde, pas de dépendance i18n externe.
 */
export function normalizeInvoiceLabel(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .toString()
    .toLowerCase()
    .replace(/[\s\u00A0]+/g, " ")
    .trim();
}

/**
 * Cherche un alias facture connu. Retourne null si non reconnu.
 */
export function findInvoiceLabelAlias(
  raw: string | null | undefined,
): InvoiceLabelAlias | null {
  const normalized = normalizeInvoiceLabel(raw);
  if (!normalized) return null;
  for (const alias of INVOICE_LABEL_ALIASES) {
    if (alias.normalized_label === normalized) {
      return alias;
    }
  }
  return null;
}
