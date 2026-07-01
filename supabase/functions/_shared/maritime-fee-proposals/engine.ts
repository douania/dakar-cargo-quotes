// DCQ-MARITIME-FEES-PROPOSALS-1 / PATCH B1
// Moteur PUR de propositions de frais maritimes (taxe de port PAD + commission
// consignataire) basé sur `dcq_pad_parametrage.json` v2.
//
// DOCTRINE (non négociable) :
//  - Ce moteur ne PRODUIT JAMAIS de montant ferme. `amount` est toujours `null`.
//  - Un montant calculé n'est qu'une SUGGESTION (`suggested_amount_xof`) qui
//    doit toujours être confirmée par un humain (`needs_human_confirmation: true`).
//  - Aucun total n'est produit ici : `suggested_amount_xof` ne doit jamais être
//    réutilisé comme total ferme par l'appelant.
//  - Périmètre validé = IMPORT uniquement. Export / Transit : aucune proposition.
//  - Aucun taux, catégorie, devise, frais ou source n'est inventé : tout provient
//    du paramétrage v2 fourni.
//
// Contraintes techniques : module TypeScript pur. Pas de Supabase, pas de fetch,
// pas de Deno.env, pas de Date.now, pas de Math.random, pas d'écriture DB, pas de
// dépendance React/DOM.

// ---------------------------------------------------------------------------
// Types du paramétrage (structure minimale consommée par le moteur)
// ---------------------------------------------------------------------------

export interface CommissionCarrierConfig {
  taux: number;
  base: string | null;
  libelle: string | null;
  preuve: string;
}

export interface Parametrage {
  _meta: { version: string; source_bareme: string; [k: string]: unknown };
  conversions_devise: {
    EUR_XOF: number;
    USD_XOF: string | number;
    [k: string]: unknown;
  };
  commission_debours: {
    par_compagnie: Record<string, CommissionCarrierConfig>;
    [k: string]: unknown;
  };
  taxe_de_port: {
    bareme_droits_passage: {
      _colonnes: string[];
      _unite?: string;
      [category: string]: number[] | string[] | string | undefined;
    };
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Types publics d'entrée / sortie
// ---------------------------------------------------------------------------

export type EvidenceLevel = "official" | "validated_internal" | "to_confirm";

/** Montant monétaire brut avec sa devise d'origine. */
export interface MonetaryAmount {
  value: number;
  currency: string; // "XOF" | "EUR" | "USD" | ...
}

export interface MaritimeFeeInput {
  /** "IMPORT" | "EXPORT" | "TRANSIT" | autre. Seul IMPORT produit des propositions. */
  operation_type?: string | null;
  /** Mode d'acheminement : conteneur vs conventionnel/RoRo. */
  cargo_mode?: string | null;
  /** Compagnie maritime (clé de commission_debours.par_compagnie). */
  carrier?: string | null;
  /** Catégorie PAD (T01-T14 / P01-P05). Jugement opérateur — jamais auto-confirmé. */
  pad_category?: string | null;
  /** Tonnage taxable (tonnes). */
  tonnage?: number | null;
  /** Fret maritime (base de commission ONE / Hapag). Peut être en EUR/USD/XOF. */
  seafreight?: MonetaryAmount | null;
  /** Taux USD->XOF explicite. USD n'est JAMAIS converti sans ce taux fourni. */
  usdToXofRate?: number | null;
}

/** Proposition unitaire. `amount` est TOUJOURS null (doctrine). */
export interface MaritimeFeeProposal {
  id: string;
  category: string;
  label: string;
  amount: null;
  currency: "XOF";
  suggested_amount_xof: number | null;
  suggested_formula: string | null;
  source_reference: string;
  evidence_level: EvidenceLevel;
  needs_human_confirmation: true;
  reason: string;
  missing_confirmation: string[];
}

export interface MaritimeFeeProposalsResult {
  proposals: MaritimeFeeProposal[];
  warnings: string[];
}

// Type de ligne reconnu lors du mapping libellé facture -> nature du frais.
export type InvoiceLineFeeType =
  | "taxe_de_port"
  | "commission"
  | "ignored"
  | "unknown";

export interface InvoiceLineInput {
  label?: string | null;
  charge_code?: string | null;
  carrier?: string | null;
  operation_type?: string | null;
}

export interface InvoiceLineClassification {
  feeType: InvoiceLineFeeType;
  reason: string;
}

// ---------------------------------------------------------------------------
// Helpers purs
// ---------------------------------------------------------------------------

/** Normalisation texte : sans accents, espaces compactés, MAJUSCULES. */
export function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** true si `operation_type` est strictement un IMPORT. */
export function isImport(operationType: unknown): boolean {
  return normalizeText(operationType) === "IMPORT";
}

/**
 * Résout le mode d'acheminement en "conteneurs" | "conventionnel" | null.
 * RoRo / roulant / conventionnel / breakbulk -> conventionnel.
 */
export function resolveCargoMode(
  cargoMode: unknown,
): "conteneurs" | "conventionnel" | null {
  const m = normalizeText(cargoMode);
  if (!m) return null;
  if (/(CONTENEUR|CONTAINER|\bFCL\b|\bLCL\b|\bTC\b)/.test(m)) return "conteneurs";
  if (/(CONVENTIONNEL|CONVENTIONAL|RORO|RO-RO|RO RO|ROULANT|BREAK ?BULK|CONVENTIONNELLE)/.test(m)) {
    return "conventionnel";
  }
  return null;
}

/**
 * Colonne du barème droits de passage pour un IMPORT.
 * conteneur -> import_conteneurs ; conventionnel/RoRo -> import_conventionnel.
 * Les colonnes export ne sont JAMAIS retournées ici.
 */
export function resolveImportColumn(
  cargoMode: unknown,
): "import_conteneurs" | "import_conventionnel" | null {
  const mode = resolveCargoMode(cargoMode);
  if (mode === "conteneurs") return "import_conteneurs";
  if (mode === "conventionnel") return "import_conventionnel";
  return null;
}

/** Récupère un taux PAD (FCFA/tonne) pour une catégorie + colonne. null si introuvable. */
export function lookupPadRate(
  parametrage: Parametrage,
  category: string,
  column: string,
): number | null {
  const bdp = parametrage.taxe_de_port?.bareme_droits_passage;
  if (!bdp) return null;
  const columns = bdp._colonnes;
  const colIndex = columns.indexOf(column);
  if (colIndex < 0) return null;
  const row = bdp[normalizeCategory(category)] as number[] | undefined;
  if (!Array.isArray(row)) return null;
  const rate = row[colIndex];
  return typeof rate === "number" ? rate : null;
}

/** Normalise une catégorie en "T04" / "P02" (majuscule, sans espaces). */
export function normalizeCategory(category: unknown): string {
  return normalizeText(category).replace(/\s+/g, "");
}

/** Résout la config de commission pour un carrier (tolérant à la casse/espaces). */
export function resolveCommissionConfig(
  parametrage: Parametrage,
  carrier: unknown,
): { key: string; config: CommissionCarrierConfig } | null {
  const table = parametrage.commission_debours?.par_compagnie ?? {};
  const target = normalizeText(carrier);
  if (!target) return null;
  for (const key of Object.keys(table)) {
    if (normalizeText(key) === target) return { key, config: table[key] };
  }
  return null;
}

/**
 * Convertit un montant vers XOF selon la doctrine devises :
 *  - XOF : tel quel
 *  - EUR : parité FIXE conversions_devise.EUR_XOF
 *  - USD : UNIQUEMENT si usdToXofRate est explicitement fourni ; sinon null
 *  - autre : non convertible -> null
 * Retourne le montant XOF (arrondi) ou null, plus un code `missing` le cas échéant.
 */
export function convertToXof(
  amount: MonetaryAmount | null | undefined,
  parametrage: Parametrage,
  usdToXofRate?: number | null,
): { xof: number | null; missing: string | null } {
  // Valeur absente ou invalide (non finie, nulle, négative) : refus strict.
  // Utilisée comme base seafreight -> signaler "seafreight" manquant.
  if (
    !amount ||
    typeof amount.value !== "number" ||
    !Number.isFinite(amount.value) ||
    amount.value <= 0
  ) {
    return { xof: null, missing: "seafreight" };
  }
  const currency = normalizeText(amount.currency);
  if (currency === "XOF" || currency === "FCFA" || currency === "CFA") {
    return { xof: Math.round(amount.value), missing: null };
  }
  if (currency === "EUR") {
    const rate = parametrage.conversions_devise.EUR_XOF;
    return { xof: Math.round(amount.value * rate), missing: null };
  }
  if (currency === "USD") {
    if (
      typeof usdToXofRate === "number" &&
      Number.isFinite(usdToXofRate) &&
      usdToXofRate > 0
    ) {
      return { xof: Math.round(amount.value * usdToXofRate), missing: null };
    }
    // Taux USD variable : ne jamais figer. Pas de conversion sans taux fourni.
    return { xof: null, missing: "usd_exchange_rate" };
  }
  return { xof: null, missing: "currency_conversion" };
}

// ---------------------------------------------------------------------------
// Reconnaissance des lignes de facture (rule 4 + Hapag THD/THO)
// ---------------------------------------------------------------------------

/**
 * Mappe un libellé de ligne facture -> nature du frais.
 * Pièges gérés :
 *  - Maersk "Frais Additionnel Import" = taxe de port PAD déguisée.
 *  - MSC "HARBOUR TAX FEE" = commission (JAMAIS comptée comme PAD).
 *  - Hapag "THO" en import = poste export -> ignoré (hors scope import).
 */
export function classifyInvoiceLine(
  line: InvoiceLineInput,
): InvoiceLineClassification {
  const text = normalizeText(`${line.label ?? ""} ${line.charge_code ?? ""}`);
  const carrier = normalizeText(line.carrier);
  const isHapag = carrier.includes("HAPAG");

  // Hapag : THD = import (port dues) ; THO = export. En import, THO est hors scope.
  if (isHapag && /\bTHO\b/.test(text)) {
    if (isImport(line.operation_type) || !line.operation_type) {
      return {
        feeType: "ignored",
        reason:
          "Hapag THO = table export (THO). Hors scope IMPORT (utiliser THD pour l'import).",
      };
    }
  }

  // Piège MSC : "HARBOUR TAX FEE" est une COMMISSION, pas une taxe de port.
  if (text.includes("HARBOUR TAX FEE")) {
    return {
      feeType: "commission",
      reason:
        "'HARBOUR TAX FEE' = commission sur débours (2,8%), PAS une taxe de port PAD.",
    };
  }

  // Cas spécial Maersk : "Frais Additionnel Import" = taxe de port PAD déguisée.
  // Ce libellé n'est reconnu comme taxe de port QUE pour Maersk. Chez un autre
  // carrier, il ne doit PAS être classé taxe_de_port (à confirmer).
  if (text.includes("FRAIS ADDITIONNEL IMPORT")) {
    if (carrier.includes("MAERSK")) {
      return {
        feeType: "taxe_de_port",
        reason: "Maersk 'Frais Additionnel Import' = taxe de port PAD déguisée.",
      };
    }
    return {
      feeType: "unknown",
      reason:
        "'Frais Additionnel Import' n'est une taxe de port PAD que chez Maersk ; " +
        "carrier différent -> à confirmer manuellement, non classé taxe_de_port.",
    };
  }

  // Taxe de port (libellé explicite, tous carriers).
  if (text.includes("TAXE DE PORT")) {
    return {
      feeType: "taxe_de_port",
      reason: "Libellé taxe de port PAD reconnu.",
    };
  }

  // Commission (autres libellés).
  if (
    text.includes("COMMISSION SUR DEBOURS") ||
    text.includes("COMMISSION SUR DE") ||
    text.includes("COLLECTION FEE")
  ) {
    return { feeType: "commission", reason: "Libellé commission reconnu." };
  }

  // Hapag THD explicite -> taxe de port import.
  if (isHapag && /\bTHD\b/.test(text)) {
    return {
      feeType: "taxe_de_port",
      reason: "Hapag THD = port dues import (= barème PAD import).",
    };
  }

  return { feeType: "unknown", reason: "Libellé non reconnu." };
}

// ---------------------------------------------------------------------------
// Construction de la proposition Taxe de Port (PAD)
// ---------------------------------------------------------------------------

function buildPadProposal(
  input: MaritimeFeeInput,
  parametrage: Parametrage,
): MaritimeFeeProposal {
  const missing: string[] = [];
  const category = input.pad_category ? normalizeCategory(input.pad_category) : null;
  const column = resolveImportColumn(input.cargo_mode);

  if (!column) missing.push("cargo_mode");

  let rate: number | null = null;
  if (!category) {
    missing.push("pad_category");
  } else if (column) {
    rate = lookupPadRate(parametrage, category, column);
    if (rate === null) {
      // Catégorie fournie mais inconnue du barème -> à re-confirmer.
      missing.push("pad_category");
    }
  }

  // Tonnage valide = nombre fini strictement positif (jamais 0 ni négatif).
  const hasTonnage =
    typeof input.tonnage === "number" &&
    Number.isFinite(input.tonnage) &&
    input.tonnage > 0;
  if (!hasTonnage) missing.push("tonnage");

  let suggested: number | null = null;
  let formula: string | null = null;
  if (rate !== null && column) {
    if (hasTonnage) {
      suggested = Math.round(rate * (input.tonnage as number));
      formula = `taxe_de_port = ${rate} × ${input.tonnage} (${category}/${column})`;
    } else {
      formula = `taxe_de_port = ${rate} × <tonnage> (${category}/${column})`;
    }
  }

  const sourceBareme = parametrage._meta?.source_bareme ?? "REDEVANCES_PORTUAIRES_2006";

  return {
    id: "pad-taxe-de-port",
    category: "taxe_de_port",
    label: "Taxe de port (PAD — droit de passage)",
    amount: null,
    currency: "XOF",
    suggested_amount_xof: suggested,
    suggested_formula: formula,
    source_reference: `PAD ${sourceBareme} — bareme_droits_passage[${
      category ?? "?"
    }][${column ?? "?"}]`,
    // Le taux est officiel (barème PAD), mais catégorie + tonnage restent à confirmer.
    evidence_level: "official",
    needs_human_confirmation: true,
    reason:
      "Barème PAD officiel. Catégorie produit = jugement opérateur et tonnage = à confirmer par pièce ; confirmation humaine obligatoire.",
    missing_confirmation: dedupe(missing),
  };
}

// ---------------------------------------------------------------------------
// Construction de la proposition Commission consignataire
// ---------------------------------------------------------------------------

function evidenceForCommission(config: CommissionCarrierConfig): EvidenceLevel {
  // Source PDF officiel du carrier -> official ; sinon observé sur facture -> validated_internal.
  return /\bPDF\b/i.test(config.preuve) ? "official" : "validated_internal";
}

function buildCommissionProposal(
  input: MaritimeFeeInput,
  parametrage: Parametrage,
  padProposal: MaritimeFeeProposal,
): MaritimeFeeProposal | null {
  const resolved = resolveCommissionConfig(parametrage, input.carrier);
  if (!resolved) return null;
  const { key, config } = resolved;

  // Maersk : aucune commission observée -> pas de proposition.
  if (!config.base || config.taux === 0) return null;

  const base = normalizeText(config.base);
  const needsSeafreight = base.includes("FRET") || base.includes("SEAFREIGHT");
  const needsTaxeDePort = base.includes("TAXE"); // "taxe_de_port" / "taxes_de_port"

  const missing: string[] = [];
  let baseXof = 0;
  let baseOk = true;
  const parts: string[] = [];

  if (needsSeafreight) {
    const { xof, missing: convMissing } = convertToXof(
      input.seafreight,
      parametrage,
      input.usdToXofRate,
    );
    if (xof === null) {
      baseOk = false;
      missing.push(convMissing ?? "seafreight");
    } else {
      baseXof += xof;
      parts.push(`seafreight=${xof}`);
    }
  }

  if (needsTaxeDePort) {
    const tax = padProposal.suggested_amount_xof;
    if (tax === null) {
      baseOk = false;
      missing.push("taxe_de_port");
      for (const m of padProposal.missing_confirmation) missing.push(m);
    } else {
      baseXof += tax;
      parts.push(`taxe_de_port=${tax}`);
    }
  }

  let suggested: number | null = null;
  let formula: string | null = null;
  if (baseOk) {
    suggested = Math.round(config.taux * baseXof);
    formula = `${config.taux} × (${parts.join(" + ")}) = ${config.taux} × ${baseXof}`;
  } else {
    formula = `${config.taux} × (${config.base})`;
  }

  return {
    id: "commission-debours",
    category: "commission_debours",
    label: config.libelle ?? `Commission consignataire (${key})`,
    amount: null,
    currency: "XOF",
    suggested_amount_xof: suggested,
    suggested_formula: formula,
    source_reference: config.preuve,
    evidence_level: evidenceForCommission(config),
    needs_human_confirmation: true,
    reason:
      `Commission ${key} = ${config.taux * 100}% sur ${config.base}. ` +
      "Proposition à confirmer ; jamais un montant ferme.",
    missing_confirmation: dedupe(missing),
  };
}

// ---------------------------------------------------------------------------
// API principale
// ---------------------------------------------------------------------------

/**
 * Construit les propositions de frais maritimes pour un dossier IMPORT.
 * Ne produit AUCUN total et AUCUN montant ferme (`amount` toujours null).
 */
export function buildMaritimeFeeProposals(
  input: MaritimeFeeInput,
  parametrage: Parametrage,
): MaritimeFeeProposalsResult {
  const warnings: string[] = [];

  // Règle 1 : périmètre validé = IMPORT uniquement.
  if (!isImport(input.operation_type)) {
    const op = input.operation_type ? String(input.operation_type) : "(non renseigné)";
    warnings.push(
      `Périmètre non IMPORT (operation_type=${op}). Aucune proposition maritime générée : ` +
        "seul l'IMPORT est couvert par ce moteur (export/transit hors scope).",
    );
    return { proposals: [], warnings };
  }

  const proposals: MaritimeFeeProposal[] = [];

  // Proposition taxe de port PAD.
  const padProposal = buildPadProposal(input, parametrage);
  proposals.push(padProposal);

  // Proposition commission consignataire (selon carrier).
  if (!input.carrier) {
    warnings.push(
      "Carrier non renseigné : commission consignataire non déterminée.",
    );
  } else if (!resolveCommissionConfig(parametrage, input.carrier)) {
    warnings.push(
      `Carrier inconnu du paramétrage (${input.carrier}) : commission non déterminée.`,
    );
  } else {
    const commission = buildCommissionProposal(input, parametrage, padProposal);
    if (commission) {
      proposals.push(commission);
    } else {
      warnings.push(
        `Aucune commission pour ${input.carrier} (taux nul / non observée).`,
      );
    }
  }

  return { proposals, warnings };
}

// ---------------------------------------------------------------------------
// util
// ---------------------------------------------------------------------------

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    if (!seen.has(it)) {
      seen.add(it);
      out.push(it);
    }
  }
  return out;
}
