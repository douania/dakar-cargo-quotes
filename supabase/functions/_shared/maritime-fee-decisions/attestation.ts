// P1-B2 — attestation « montant TTC de la facture fournisseur » (commissions).
//
// DOCTRINE MÉTIER (clarification CTO 2026-08-30, non négociable) :
//   Les commissions / collection fees consignataires sont des DÉBOURS. Le
//   montant qui entre dans l'application est EXACTEMENT celui de la facture
//   fournisseur, TVA COMPRISE, recopié À L'IDENTIQUE. Il n'y a donc :
//     - AUCUNE multiplication par 1,18 (ni ici, ni ailleurs) ;
//     - AUCUNE extraction puis ré-addition de TVA ;
//     - AUCUNE TVA SODATRA appliquée sur ces débours.
//   `computeCommercialTotals` traite déjà la couche `enrichment_carrier_commission`
//   de cette façon : ce module n'ajoute AUCUN calcul monétaire, il ne fait
//   qu'exiger et tracer une ATTESTATION HUMAINE explicite.
//
// POURQUOI UNE ATTESTATION EXPLICITE :
//   `suggested_amount_xof` est une formule INDICATIVE (2,8 % du droit de passage
//   PAD, etc.). Rien ne prouve qu'elle égale le TTC facturé pour CE frais. Sans
//   marqueur explicite, confirmer une suggestion reviendrait à déclarer un TTC
//   fournisseur que personne n'a vérifié. On ne DÉDUIT donc jamais l'attestation
//   d'un texte libre (`decision_source`), et une décision ANCIENNE, écrite avant
//   ce contrat, n'est jamais présumée attestée : elle bloque, fail-closed.
//
// Module PUR : aucune I/O, aucune horloge, aucun aléa, aucun montant calculé.

/** Seule base de montant reconnue pour une commission ferme. */
export const SUPPLIER_INVOICE_TTC_BASIS = "supplier_invoice_ttc";

/** Version du contrat d'attestation stocké dans `proposal_snapshot`. */
export const MARITIME_FEE_ATTESTATION_SCHEMA_VERSION = 1;

/** Préfixe des clés de décision portant une commission consignataire. */
export const CARRIER_DEBOURS_COMMISSION_PREFIX = "CARRIER_DEBOURS_COMMISSION:";

/** Catégorie de proposition des commissions consignataires. */
export const COMMISSION_DEBOURS_CATEGORY = "commission_debours";

/**
 * Attestation SERVEUR — jamais fournie par le client, jamais recopiée d'un
 * champ client. Elle fige, à côté du snapshot de proposition, ce que l'humain a
 * déclaré : « le montant décidé EST le TTC facturé pour ce frais ».
 */
export interface MaritimeFeeAttestation {
  schema_version: number;
  amount_basis: typeof SUPPLIER_INVOICE_TTC_BASIS;
  supplier_invoice_ttc_confirmed: true;
  decision_action: "confirm" | "adjust";
  /** Montant décidé, en FCFA, TVA fournisseur INCLUSE — recopié tel quel. */
  decided_amount_xof: number;
  /** Référence opérateur de la pièce (champ `decision_source` existant). */
  decision_source: string;
  /** Aucune taxe n'est ajoutée à ce montant en aval. */
  vat_added_by_sodatra: false;
}

/**
 * Ce frais exige-t-il l'attestation TTC ? UNIQUEMENT les commissions
 * consignataires. Le PAD en est exclu : sa souveraineté reste le barème
 * officiel, pas une facture fournisseur.
 */
export function requiresSupplierInvoiceTtcAttestation(
  decisionKey: unknown,
  proposalCategory: unknown,
): boolean {
  return String(decisionKey ?? "").startsWith(
      CARRIER_DEBOURS_COMMISSION_PREFIX,
    ) ||
    String(proposalCategory ?? "") === COMMISSION_DEBOURS_CATEGORY;
}

/**
 * Construit l'attestation SERVEUR. `decidedAmountXof` vient du serveur
 * (suggestion exacte pour `confirm`, montant saisi validé pour `adjust`) : le
 * client ne peut donc pas glisser un montant d'attestation différent du montant
 * réellement enregistré.
 */
export function buildSupplierInvoiceTtcAttestation(params: {
  action: "confirm" | "adjust";
  decidedAmountXof: number;
  decisionSource: string;
}): MaritimeFeeAttestation {
  return {
    schema_version: MARITIME_FEE_ATTESTATION_SCHEMA_VERSION,
    amount_basis: SUPPLIER_INVOICE_TTC_BASIS,
    supplier_invoice_ttc_confirmed: true,
    decision_action: params.action,
    decided_amount_xof: params.decidedAmountXof,
    decision_source: params.decisionSource,
    vat_added_by_sodatra: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Lit l'attestation d'un `proposal_snapshot` stocké. `null` = absente. */
export function readMaritimeFeeAttestation(
  proposalSnapshot: unknown,
): Record<string, unknown> | null {
  if (!isRecord(proposalSnapshot)) return null;
  const attestation = proposalSnapshot.attestation;
  return isRecord(attestation) ? attestation : null;
}

/**
 * Vérifie qu'une décision ferme de commission porte bien une attestation
 * SERVEUR cohérente avec ce qui a été enregistré.
 *
 * Retourne `null` si tout concorde, sinon le DÉTAIL opérateur du blocage. Toute
 * divergence (attestation absente, base de montant inconnue, montant ou source
 * qui ne correspondent plus) est fail-closed : mieux vaut bloquer un chiffrage
 * qu'appliquer un montant dont l'origine TTC n'est plus prouvable.
 */
export function verifySupplierInvoiceTtcAttestation(params: {
  proposalSnapshot: unknown;
  action: "confirm" | "adjust";
  decidedAmountXof: number | null;
  decisionSource: string;
  decisionKey: string;
  decisionVersion: number;
}): string | null {
  const { action, decidedAmountXof, decisionKey, decisionVersion } = params;
  const prefix =
    `Décision ${action} v${decisionVersion} sur « ${decisionKey} » :`;
  const attestation = readMaritimeFeeAttestation(params.proposalSnapshot);
  if (!attestation) {
    return `${prefix} aucune attestation « montant TTC de la facture fournisseur » n'a été enregistrée. Une décision antérieure à ce contrat n'est jamais présumée attestée.`;
  }
  if (attestation.schema_version !== MARITIME_FEE_ATTESTATION_SCHEMA_VERSION) {
    return `${prefix} version d'attestation inconnue.`;
  }
  if (attestation.amount_basis !== SUPPLIER_INVOICE_TTC_BASIS) {
    return `${prefix} base de montant « ${
      String(attestation.amount_basis ?? "absente")
    } » non reconnue (seul ${SUPPLIER_INVOICE_TTC_BASIS} est consommable).`;
  }
  if (attestation.supplier_invoice_ttc_confirmed !== true) {
    return `${prefix} l'attestation TTC fournisseur n'est pas confirmée.`;
  }
  if (attestation.decision_action !== action) {
    return `${prefix} l'attestation porte l'action « ${
      String(attestation.decision_action ?? "absente")
    } », incohérente avec la décision enregistrée.`;
  }
  if (
    typeof attestation.decided_amount_xof !== "number" ||
    !Number.isSafeInteger(attestation.decided_amount_xof) ||
    attestation.decided_amount_xof !== decidedAmountXof
  ) {
    return `${prefix} le montant attesté (${
      String(attestation.decided_amount_xof ?? "absent")
    }) ne correspond pas au montant décidé (${String(decidedAmountXof)}).`;
  }
  if (
    typeof attestation.decision_source !== "string" ||
    attestation.decision_source !== params.decisionSource
  ) {
    return `${prefix} la référence de pièce attestée ne correspond plus à la source de la décision.`;
  }
  if (attestation.vat_added_by_sodatra !== false) {
    return `${prefix} l'attestation ne garantit pas l'absence de TVA ajoutée sur ce débours.`;
  }
  return null;
}
