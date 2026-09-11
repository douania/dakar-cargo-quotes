/**
 * DTHC-1 — Sélection déterministe et fail-closed du DTHC DP World import
 * (`port_tariffs`, source_document = l'arrêté d'homologation en vigueur).
 *
 * La source canonique est l'arrêté ministériel n° 035532 du 28 novembre 2023
 * portant révision des tarifs de manutention de conteneurs, publié au Journal
 * officiel de la République du Sénégal n° 7723 du 6 avril 2024, page 471. Son
 * annexe porte les cinq familles ci-dessous, au taux par EVP.
 *
 * Elle remplace la référence `DPW_TARIFS_2025_0001.pdf` retenue par la décision
 * CTO du 2026-08-25, qui désignait un fichier interne et non le texte
 * homologué. Les montants sont inchangés — le JO les confirme au franc près ;
 * seule la provenance devient citable. La migration
 * `20260911120000_dthc4_provenance_arrete_035532.sql` aligne `port_tariffs` sur
 * cette constante et DOIT être déployée avec elle : appliquée seule, l'une ou
 * l'autre fait tomber tout le DTHC en TO_CONFIRM.
 * Les cinq familles sont adressées par `cargo_type` EXACT, et la `classification`
 * doit correspondre à la famille attendue — aucun `includes`, aucun fuzzy, aucun
 * premier-match. Zéro ou plusieurs candidats ⇒ TO_CONFIRM, montant `null`.
 *
 * La famille se déduit de l'équipement ET de la marchandise. Un conteneur sec ne
 * conclut RIEN à lui seul : sans désignation validée il reste indéterminé, sinon
 * une marchandise dangereuse en sec serait sous-facturée.
 *
 * Le multiplicateur EVP est appliqué ici et nulle part ailleurs : la fonction rend
 * le montant de ligne déjà multiplié. Module pur : aucune I/O, aucune horloge.
 */

export const DPW_DTHC_SOURCE_DOCUMENT =
  "Arrêté ministériel n° 035532 du 28/11/2023 - JORS n° 7723 du 06/04/2024 p. 471";
export const DPW_DTHC_PROVIDERS: readonly string[] = ["DPW", "DP_WORLD"];
export const DPW_DTHC_EVIDENCE_WHITELIST: readonly string[] = [
  "official",
  "validated_internal",
];
export const DPW_DTHC_TO_CONFIRM_CODE = "TARIF_DTHC_A_CONFIRMER" as const;

/** Les cinq familles tarifaires, telles que `port_tariffs.cargo_type` les porte. */
export type DpwDthcFamily =
  | "BASIC"
  | "STANDARD"
  | "REEFER"
  | "DANGEROUS"
  | "SPECIAL";

/**
 * DTHC-2 (GO CTO 2026-09-08) : liste fermée des familles, pour valider une
 * famille FOURNIE par l'opérateur (fait `pricing.dthc_family`). Toute autre
 * valeur vaut « absent » (null) : le résolveur retombe alors sur l'inférence
 * fail-closed ci-dessous. Aucune famille n'est jamais devinée ici.
 */
export const DPW_DTHC_FAMILIES: readonly DpwDthcFamily[] = [
  "BASIC",
  "STANDARD",
  "REEFER",
  "DANGEROUS",
  "SPECIAL",
];

export function normalizeDpwDthcFamily(raw: unknown): DpwDthcFamily | null {
  if (typeof raw !== "string") return null;
  const upper = raw.trim().toUpperCase();
  return (DPW_DTHC_FAMILIES as readonly string[]).includes(upper)
    ? (upper as DpwDthcFamily)
    : null;
}

/**
 * Libellé `classification` attendu par famille, hors parenthèse d'énumération.
 * Le contrôle est une égalité stricte après normalisation : une ligne dont le
 * `cargo_type` dit STANDARD mais dont le libellé dit « Transbordement » est
 * rejetée.
 */
const EXPECTED_CLASSIFICATION: Readonly<Record<DpwDthcFamily, string>> = {
  BASIC: "PRODUITS DE BASE",
  STANDARD: "PRODUITS STANDARDS",
  REEFER: "CONTENEURS FRIGORIFIQUES",
  DANGEROUS: "PRODUITS DANGEREUX",
  SPECIAL: "CONTENEURS SPECIAUX",
};

/** Nature de l'équipement. `DRY` ne conclut RIEN à lui seul : un sec peut être
 * standard, de base ou dangereux. */
export type DthcEquipment = "DRY" | "REEFER" | "SPECIAL";

/**
 * Types de conteneur pris en charge par le produit — strictement ceux de
 * `EVP_CONVERSION` (`_shared/quotation-rules.ts`) — avec leur facteur EVP.
 */
export const CONTAINER_PROFILES: Readonly<
  Record<string, { evp: number; equipment: DthcEquipment }>
> = {
  "20DV": { evp: 1, equipment: "DRY" },
  "20DC": { evp: 1, equipment: "DRY" },
  "20GP": { evp: 1, equipment: "DRY" },
  "20ST": { evp: 1, equipment: "DRY" },
  // DTHC-4-B : le 20 pieds high cube manquait, alors que ses homologues 40HC et
  // 40HQ étaient là depuis l'origine. L'EVP est une unité de LONGUEUR : un high
  // cube est plus haut, pas plus long, donc 1 EVP comme tout 20 pieds — c'est ce
  // que pose l'arrêté n° 035532 (« Un 20 Pieds = 1 EVP ») et ce que le produit
  // applique déjà au 40HC. Sans ces deux clés, tout dossier en 20HQ tombait en
  // CONTAINER_TYPE_UNSUPPORTED, donc sans DTHC.
  "20HC": { evp: 1, equipment: "DRY" },
  "20HQ": { evp: 1, equipment: "DRY" },
  "20RF": { evp: 1, equipment: "REEFER" },
  "20OT": { evp: 1, equipment: "SPECIAL" },
  "20FR": { evp: 1, equipment: "SPECIAL" },
  // DTHC-4-C : `FL` est le code que DP World imprime pour un flat — la facture
  // 3384292 du 31/07/2026 porte quatre conteneurs « 20FL » facturés ACCONAGE C7
  // à 310 000, soit la ligne « Autres conteneurs spéciaux (hors gabarit, Flat,
  // Open Top, Tank…) » de l'arrêté n° 035532. Sans cette clé, ces dossiers
  // tombaient en CONTAINER_TYPE_UNSUPPORTED alors qu'ils sont, eux, parfaitement
  // qualifiés. `40FL` est le pendant symétrique, comme 20FR l'est de 40FR.
  "20FL": { evp: 1, equipment: "SPECIAL" },
  "40DV": { evp: 2, equipment: "DRY" },
  "40DC": { evp: 2, equipment: "DRY" },
  "40GP": { evp: 2, equipment: "DRY" },
  "40ST": { evp: 2, equipment: "DRY" },
  "40HC": { evp: 2, equipment: "DRY" },
  "40HQ": { evp: 2, equipment: "DRY" },
  "40RF": { evp: 2, equipment: "REEFER" },
  "40OT": { evp: 2, equipment: "SPECIAL" },
  "40FR": { evp: 2, equipment: "SPECIAL" },
  "40FL": { evp: 2, equipment: "SPECIAL" },
  "45HC": { evp: 2.25, equipment: "DRY" },
  "45HQ": { evp: 2.25, equipment: "DRY" },
};

/**
 * Désignations marchandise explicitement validées par le métier qui résolvent
 * STANDARD en conteneur sec. Liste fermée : toute autre désignation sèche reste
 * indéterminée. Aucun alias spéculatif.
 */
const VALIDATED_STANDARD_DESIGNATIONS: readonly string[] = [
  "PIECES DETACHEES DE MACHINES ET APPAREILS",
];

/** Tokens autonomes signalant une marchandise dangereuse. */
const DANGEROUS_TOKENS: readonly string[] = [
  "DG",
  "DANGEROUS",
  "HAZMAT",
  "IMO",
  "IMDG",
];

export type DpwDthcToConfirmReason =
  | "OPERATION_NOT_SUPPORTED"
  | "CONTAINERS_MISSING"
  | "CONTAINER_TYPE_UNSUPPORTED"
  | "CONTAINER_QUANTITY_INVALID"
  | "FAMILY_AMBIGUOUS"
  | "FAMILY_UNDETERMINED"
  | "AS_OF_DATE_MISSING"
  | "NO_MATCHING_TARIFF"
  | "AMBIGUOUS_TARIFF"
  | "INVALID_TARIFF_AMOUNT";

const MESSAGES: Readonly<Record<DpwDthcToConfirmReason, string>> = {
  OPERATION_NOT_SUPPORTED:
    "DTHC hors périmètre import DP World — tarif terminal à confirmer.",
  CONTAINERS_MISSING:
    "Aucun conteneur exploitable — tarif terminal DP World à confirmer.",
  CONTAINER_TYPE_UNSUPPORTED:
    "Type de conteneur hors grille DTHC DP World — tarif terminal à confirmer.",
  CONTAINER_QUANTITY_INVALID:
    "Nombre de conteneurs inexploitable — tarif terminal DP World à confirmer.",
  FAMILY_AMBIGUOUS:
    "Familles DTHC incompatibles sur le même lot — tarif terminal à confirmer.",
  FAMILY_UNDETERMINED:
    "Famille DTHC non déterminable depuis la désignation marchandise — tarif terminal à confirmer.",
  AS_OF_DATE_MISSING:
    "Date d'évaluation absente — tarif terminal DP World à confirmer.",
  NO_MATCHING_TARIFF:
    "Aucun tarif DTHC canonique actif pour cette famille — tarif terminal à confirmer.",
  AMBIGUOUS_TARIFF:
    "Plusieurs tarifs DTHC canoniques concurrents — tarif terminal à confirmer.",
  INVALID_TARIFF_AMOUNT:
    "Tarif DTHC canonique trouvé mais montant inexploitable — tarif terminal à confirmer.",
};

/**
 * Accents supprimés, majuscules, ponctuation en espace, espaces effondrés, et
 * parenthèse d'énumération retirée ("Produits de base (huile, riz)" -> "PRODUITS
 * DE BASE").
 */
function normalizeDthcText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeDthcLabel(raw: unknown): string {
  return typeof raw === "string" ? normalizeDthcText(raw.split("(")[0]) : "";
}

/** Vrai si la description porte un token DANGEREUX AUTONOME ("BUDGET" ne matche pas). */
function hasDangerousToken(description: unknown): boolean {
  const normalized = normalizeDthcText(description);
  if (!normalized) return false;
  return normalized.split(" ").some((token) => DANGEROUS_TOKENS.includes(token));
}

/**
 * Alias fermés des libellés non ambigus déjà émis par l'intake. Les tailles
 * seules (`20'`, `40'`) restent volontairement hors profil : elles ne disent
 * pas si l'équipement est dry, reefer ou spécial.
 */
export const DTHC_CONTAINER_TYPE_ALIASES: Readonly<Record<string, string>> = {
  "20DRY": "20DV",
  "40DRY": "40DV",
  "20DRYVAN20DV": "20DV",
  // DTHC-2 : libellés intake avec hauteur — 8'6 = standard, 9'6 = high cube.
  // "40 DRY 9'6" -> "40DRY96" -> 40HC. Alias exacts, aucun rapprochement partiel.
  "20DRY86": "20DV",
  "40DRY86": "40DV",
  "40DRY96": "40HC",
  // DTHC-4-B : pendant strict du 40DRY96, pour le 20 pieds high cube.
  "20DRY96": "20HC",
  // DTHC-4-C : formes réellement présentes dans `cargo.containers` pour un flat
  // rack transportant de la marchandise dangereuse. L'ÉQUIPEMENT est le flat
  // rack — c'est lui qui détermine la famille tarifaire ; le caractère dangereux
  // vient du fait `cargo.dangerous_goods` (DTHC-4-A), pas du libellé du
  // conteneur. Le cumul des deux reste volontairement non tranché par ce module.
  "20FRDG": "20FR",
  "20FRDGSOC": "20FR",
};

/**
 * Majuscules, ponctuation et espaces retirés, puis alias intake exact appliqué :
 * "20' DV" -> "20DV", "20' Dry" -> "20DV". Aucun rapprochement partiel.
 */
export function normalizeDthcContainerType(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const normalized = raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
  return DTHC_CONTAINER_TYPE_ALIASES[normalized] ?? normalized;
}

/** `source_document` peut porter une localisation ("…pdf, Page 4") : seul le document compte. */
function isCanonicalSource(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  return normalizeDthcLabel(raw.split(",")[0].replace(/\.pdf$/i, "")) ===
    normalizeDthcLabel(DPW_DTHC_SOURCE_DOCUMENT.replace(/\.pdf$/i, ""));
}

export interface DpwDthcTariffRow {
  id?: string | null;
  provider?: string | null;
  category?: string | null;
  operation_type?: string | null;
  classification?: string | null;
  cargo_type?: string | null;
  amount?: number | string | null;
  unit?: string | null;
  surcharge_percent?: number | string | null;
  source_document?: string | null;
  effective_date?: string | null;
  expiry_date?: string | null;
  is_active?: boolean | null;
  evidence_level?: string | null;
}

export interface DpwDthcResolutionInput {
  /** `scope` du contexte de pricing. Seul `import` porte le DTHC destination. */
  scope: unknown;
  containers: readonly { type?: unknown; quantity?: unknown }[] | null | undefined;
  /** Famille imposée par un fait métier validé ; sinon déduite ci-dessous. */
  family?: DpwDthcFamily | null;
  /** Désignation marchandise du dossier (`cargo.description`). */
  cargoDescription?: unknown;
  /** Marqueur dangereux structuré (IMO / hazmat) porté par la demande. */
  isDangerous?: boolean | null;
  /** Date d'évaluation `YYYY-MM-DD`, fournie par l'appelant (module pur). */
  asOfDate?: string | null;
}

export type DpwDthcResolution =
  | {
    status: "RESOLVED";
    family: DpwDthcFamily;
    baseUnitAmount: number;
    surchargePercent: number;
    effectiveUnitAmount: number;
    evpQuantity: number;
    /** Montant de ligne final. Déjà multiplié : ne pas remultiplier. */
    amount: number;
    detail: string;
    tariff: DpwDthcTariffRow;
  }
  | {
    status: "TO_CONFIRM";
    code: typeof DPW_DTHC_TO_CONFIRM_CODE;
    reason: DpwDthcToConfirmReason;
    message: string;
    family: DpwDthcFamily | null;
    evpQuantity: number | null;
    amount: null;
    matchCount: number;
  };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toConfirm(
  reason: DpwDthcToConfirmReason,
  family: DpwDthcFamily | null,
  evpQuantity: number | null,
  matchCount = 0,
): DpwDthcResolution {
  return {
    status: "TO_CONFIRM",
    code: DPW_DTHC_TO_CONFIRM_CODE,
    reason,
    message: MESSAGES[reason],
    family,
    evpQuantity,
    amount: null,
    matchCount,
  };
}

/**
 * Quantité EVP et famille déduites du contenant. Unique lieu du facteur EVP.
 */
/**
 * H2-b : profil d'un type de conteneur (taille en pieds, équipement, EVP) pour
 * les règles d'honoraires « par conteneur 20'/40' » et « famille de conteneur ».
 * Même table CONTAINER_PROFILES, même normalisation d'alias ; type inconnu ⇒ null.
 */
export function resolveContainerProfile(
  raw: unknown,
): { key: string; sizeFt: 20 | 40 | 45; equipment: DthcEquipment; evp: number } | null {
  const key = normalizeDthcContainerType(raw);
  const profile = key ? CONTAINER_PROFILES[key] : undefined;
  if (!profile) return null;
  const sizeFt = key.startsWith("45") ? 45 : key.startsWith("40") ? 40 : 20;
  return { key, sizeFt, equipment: profile.equipment, evp: profile.evp };
}

export function resolveDthcContainerBasis(
  containers: readonly { type?: unknown; quantity?: unknown }[] | null | undefined,
):
  | { status: "OK"; evpQuantity: number; equipments: DthcEquipment[]; detail: string }
  | {
    status: "REJECTED";
    reason: Extract<
      DpwDthcToConfirmReason,
      "CONTAINERS_MISSING" | "CONTAINER_TYPE_UNSUPPORTED" | "CONTAINER_QUANTITY_INVALID"
    >;
  } {
  const list = Array.isArray(containers) ? containers : [];
  if (list.length === 0) return { status: "REJECTED", reason: "CONTAINERS_MISSING" };

  let evpQuantity = 0;
  const equipments: DthcEquipment[] = [];
  const parts: string[] = [];

  for (const container of list) {
    const key = normalizeDthcContainerType(container?.type);
    if (!key) return { status: "REJECTED", reason: "CONTAINERS_MISSING" };
    const profile = CONTAINER_PROFILES[key];
    if (!profile) return { status: "REJECTED", reason: "CONTAINER_TYPE_UNSUPPORTED" };

    const quantity = Number(container?.quantity ?? 1);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { status: "REJECTED", reason: "CONTAINER_QUANTITY_INVALID" };
    }

    evpQuantity += profile.evp * quantity;
    if (!equipments.includes(profile.equipment)) equipments.push(profile.equipment);
    parts.push(`${quantity}x${key}(${profile.evp})`);
  }

  return { status: "OK", evpQuantity, equipments, detail: parts.join("+") };
}

/**
 * Famille DTHC déduite de l'équipement et de la marchandise. Fail-closed :
 *   - équipements incompatibles sur le lot -> ambigu ;
 *   - dangereux + reefer/spécial -> ambigu (la grille n'arbitre pas ce cumul) ;
 *   - sec non dangereux -> STANDARD seulement si la désignation est validée,
 *     sinon indéterminé. BASIC n'est jamais inféré : il passe par `family`.
 */
function inferFamily(
  equipments: readonly DthcEquipment[],
  cargoDescription: unknown,
  isDangerous: boolean | null | undefined,
):
  | { family: DpwDthcFamily }
  | { reason: Extract<DpwDthcToConfirmReason, "FAMILY_AMBIGUOUS" | "FAMILY_UNDETERMINED"> } {
  if (equipments.length !== 1) return { reason: "FAMILY_AMBIGUOUS" };
  const equipment = equipments[0];
  const dangerous = isDangerous === true || hasDangerousToken(cargoDescription);

  if (dangerous) {
    return equipment === "DRY" ? { family: "DANGEROUS" } : { reason: "FAMILY_AMBIGUOUS" };
  }
  if (equipment === "REEFER") return { family: "REEFER" };
  if (equipment === "SPECIAL") return { family: "SPECIAL" };

  return VALIDATED_STANDARD_DESIGNATIONS.includes(normalizeDthcText(cargoDescription))
    ? { family: "STANDARD" }
    : { reason: "FAMILY_UNDETERMINED" };
}

export function resolveDpwDthcTariff(
  rows: readonly DpwDthcTariffRow[] | null | undefined,
  input: DpwDthcResolutionInput,
): DpwDthcResolution {
  const scope = typeof input.scope === "string" ? input.scope.trim().toLowerCase() : "";
  if (scope !== "import") return toConfirm("OPERATION_NOT_SUPPORTED", null, null);

  const basis = resolveDthcContainerBasis(input.containers);
  if (basis.status === "REJECTED") return toConfirm(basis.reason, null, null);

  let family = input.family ?? null;
  if (family === null) {
    const inferred = inferFamily(basis.equipments, input.cargoDescription, input.isDangerous);
    if ("reason" in inferred) return toConfirm(inferred.reason, null, basis.evpQuantity);
    family = inferred.family;
  }

  const asOf = typeof input.asOfDate === "string" && ISO_DATE.test(input.asOfDate.slice(0, 10))
    ? input.asOfDate.slice(0, 10)
    : null;
  if (!asOf) return toConfirm("AS_OF_DATE_MISSING", family, basis.evpQuantity);

  const candidates = (rows ?? []).filter((row) => {
    if (row?.is_active !== true) return false;
    if (!DPW_DTHC_EVIDENCE_WHITELIST.includes(String(row.evidence_level ?? ""))) return false;
    if (!DPW_DTHC_PROVIDERS.includes(String(row.provider ?? "").trim().toUpperCase())) return false;
    if (normalizeDthcLabel(row.category) !== "THC") return false;
    if (normalizeDthcLabel(row.operation_type) !== "IMPORT") return false;
    if (!isCanonicalSource(row.source_document)) return false;
    if (normalizeDthcLabel(row.unit) !== "EVP") return false;
    // Une ligne non datable n'est pas présumée applicable.
    const start = typeof row.effective_date === "string" ? row.effective_date.slice(0, 10) : "";
    if (!ISO_DATE.test(start) || start > asOf) return false;
    const end = typeof row.expiry_date === "string" ? row.expiry_date.slice(0, 10) : null;
    if (end && end < asOf) return false;
    // Clé de famille : `cargo_type` exact, ET libellé conforme à la famille.
    if (String(row.cargo_type ?? "").trim().toUpperCase() !== family) return false;
    return normalizeDthcLabel(row.classification) === EXPECTED_CLASSIFICATION[family];
  });

  if (candidates.length === 0) {
    return toConfirm("NO_MATCHING_TARIFF", family, basis.evpQuantity, 0);
  }
  if (candidates.length > 1) {
    return toConfirm("AMBIGUOUS_TARIFF", family, basis.evpQuantity, candidates.length);
  }

  const tariff = candidates[0];
  const baseUnitAmount = Number(tariff.amount);
  if (!Number.isFinite(baseUnitAmount) || baseUnitAmount <= 0) {
    return toConfirm("INVALID_TARIFF_AMOUNT", family, basis.evpQuantity, 1);
  }
  const surchargePercent = Number(tariff.surcharge_percent ?? 0);
  if (!Number.isFinite(surchargePercent) || surchargePercent < 0) {
    return toConfirm("INVALID_TARIFF_AMOUNT", family, basis.evpQuantity, 1);
  }

  const effectiveUnitAmount = baseUnitAmount * (1 + surchargePercent / 100);

  return {
    status: "RESOLVED",
    family,
    baseUnitAmount,
    surchargePercent,
    effectiveUnitAmount,
    evpQuantity: basis.evpQuantity,
    // Unique application du multiplicateur EVP de toute la chaîne DTHC.
    amount: Math.round(effectiveUnitAmount * basis.evpQuantity),
    detail: basis.detail,
    tariff,
  };
}
