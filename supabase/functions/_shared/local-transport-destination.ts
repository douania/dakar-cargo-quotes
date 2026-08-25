/**
 * P0-D-3 — Résolution déterministe et fail-closed du barème officiel de livraison
 * conteneur (`local_transport_rates`, source_document
 * `TARIFS_LIVRAISONS_CONTENEURS_20P_40P_OFFICIELS`).
 *
 * Contrat métier arrêté par le responsable SODATRA le 2026-08-24 :
 *   * le barème 20P / 40P est le tarif en vigueur, sans date d'expiration ;
 *   * priorité absolue au tarif EXACT du barème ;
 *   * destination inconnue, non couverte ou ambiguë => TO_CONFIRM
 *     (`TARIF_TRANSPORT_A_CONFIRMER`), montant `null`. Jamais de montant inventé ;
 *   * la formule kilométrique (57k + 1k/km en 20P, 69k + 2k/km en 40P, avec
 *     exceptions) est un contrôle de cohérence de barème. Elle est délibérément
 *     ABSENTE de ce module : aucun montant runtime ne doit pouvoir en dériver.
 *     Elle est encodée dans la migration de promotion et dans les tests.
 *
 * Règles de matching, sans exception :
 *   * normalisation déterministe (accents / casse / ponctuation / espaces) ;
 *   * aliases EXPLICITES uniquement — aucun `ilike '%terme%'`, aucun `includes()`,
 *     aucun fuzzy, aucun premier-match ;
 *   * un libellé composé ("KIDIRA / BISSAU") est adressable par son libellé
 *     complet ou par l'un de ses composants exacts ("KIDIRA", "BISSAU") ;
 *   * toute clé normalisée qui viserait deux destinations canoniques est marquée
 *     ambiguë et ne résout rien (fail-closed) ;
 *   * après filtrage destination + conteneur + scope client + validité + preuve,
 *     il faut EXACTEMENT un candidat. Zéro ou plusieurs => TO_CONFIRM.
 *
 * Module pur : aucune I/O, aucun accès réseau, aucune horloge implicite. La date
 * d'évaluation est fournie par l'appelant (`asOfDate`).
 */

/** source_document du barème officiel de livraison conteneur. */
export const OFFICIAL_LOCAL_TRANSPORT_SOURCE_DOCUMENT =
  "TARIFS_LIVRAISONS_CONTENEURS_20P_40P_OFFICIELS";

/** Whitelist de provenance déjà appliquée par les deux lecteurs runtime. */
export const LOCAL_TRANSPORT_EVIDENCE_WHITELIST: readonly string[] = Object
  .freeze([
    "official",
    "validated_internal",
  ]);

/** Code métier exposé quand aucun tarif exact ne peut être servi. */
export const LOCAL_TRANSPORT_TO_CONFIRM_CODE =
  "TARIF_TRANSPORT_A_CONFIRMER" as const;

/** Orthographes exactes stockées en base pour les deux tailles couvertes. */
export const LOCAL_TRANSPORT_CONTAINER_20 = "20' Dry" as const;
export const LOCAL_TRANSPORT_CONTAINER_40 = "40' Dry" as const;

/**
 * Les 30 destinations canoniques du barème, orthographiées exactement comme en
 * base (cf. migration 20260823130000). Toute divergence casse la promotion.
 */
export const CANONICAL_LOCAL_TRANSPORT_DESTINATIONS: readonly string[] = Object
  .freeze([
    "FORFAIT ZONE 1 <18 KM",
    "FORFAIT ZONE 2, SEIKHOTANE ET POUT",
    "THIES / POPONGUINE",
    "THIADIAYE",
    "MBOUR",
    "TIVAOUNE",
    "MEKHE",
    "BAMBEYE TAIBA",
    "JOAL",
    "DIOURBEL",
    "KEBEMER / FATICK",
    "MBACKE",
    "KAOLACK",
    "LOUGA / TOUBA",
    "SOKONE",
    "KAFFRINE",
    "NIORO / ST LOUIS",
    "RICHARD TOLL",
    "DAGANA / MAKA",
    "BIGNONA",
    "ZIGUINCHOR",
    "TAMBACOUNDA",
    "PODOR",
    "CAP SKIRING",
    "VELINGARA / GOUDIRI",
    "ROSSO / NIOKOLOKO",
    "KIDIRA / BISSAU",
    "KOLDA / MATAM",
    "KEDOUGOU",
    "ZIGUINCHOR VIA TAMBA",
  ]);

/**
 * Aliases de zone EXPLICITEMENT validés. Volontairement minimalistes : toute
 * autre commune (Pikine, Guédiawaye, Rufisque, Diamniadio, Keur Massar…) n'est
 * PAS couverte par une décision métier écrite et doit rester TO_CONFIRM.
 */
export const LOCAL_TRANSPORT_DESTINATION_ALIASES: Readonly<
  Record<string, string>
> = Object.freeze({
  DAKAR: "FORFAIT ZONE 1 <18 KM",
  POUT: "FORFAIT ZONE 2, SEIKHOTANE ET POUT",
  SEBIKHOTANE: "FORFAIT ZONE 2, SEIKHOTANE ET POUT",
  SEIKHOTANE: "FORFAIT ZONE 2, SEIKHOTANE ET POUT",
});

/**
 * Variantes de conteneur explicitement reconnues. Clés = forme normalisée
 * (majuscules, sans ponctuation). Toute forme absente (reefer, flat rack, open
 * top, tank, 45', LCL, low bed…) reste non résolue : pas de taille inventée.
 *
 * Les clés `…DRYVAN` sont le pendant strict des clés `…DRY` : "Dry Van" est la
 * désignation ISO courante du conteneur sec standard, que certains runtimes
 * émettent en toutes lettres ("20' Dry Van"). Elles sont énumérées une à une,
 * jamais dérivées par suffixe : aucune autre famille n'en hérite.
 */
export const LOCAL_TRANSPORT_CONTAINER_ALIASES: Readonly<
  Record<string, string>
> = Object.freeze({
  "20": LOCAL_TRANSPORT_CONTAINER_20,
  "20DRY": LOCAL_TRANSPORT_CONTAINER_20,
  "20DRYVAN": LOCAL_TRANSPORT_CONTAINER_20,
  "20DV": LOCAL_TRANSPORT_CONTAINER_20,
  "20DC": LOCAL_TRANSPORT_CONTAINER_20,
  "20GP": LOCAL_TRANSPORT_CONTAINER_20,
  "20STD": LOCAL_TRANSPORT_CONTAINER_20,
  "20FT": LOCAL_TRANSPORT_CONTAINER_20,
  "20FTDRY": LOCAL_TRANSPORT_CONTAINER_20,
  "20FTDRYVAN": LOCAL_TRANSPORT_CONTAINER_20,
  "40": LOCAL_TRANSPORT_CONTAINER_40,
  "40DRY": LOCAL_TRANSPORT_CONTAINER_40,
  "40DRYVAN": LOCAL_TRANSPORT_CONTAINER_40,
  "40DV": LOCAL_TRANSPORT_CONTAINER_40,
  "40DC": LOCAL_TRANSPORT_CONTAINER_40,
  "40GP": LOCAL_TRANSPORT_CONTAINER_40,
  "40STD": LOCAL_TRANSPORT_CONTAINER_40,
  "40FT": LOCAL_TRANSPORT_CONTAINER_40,
  "40FTDRY": LOCAL_TRANSPORT_CONTAINER_40,
  "40FTDRYVAN": LOCAL_TRANSPORT_CONTAINER_40,
  "40HC": LOCAL_TRANSPORT_CONTAINER_40,
  "40HQ": LOCAL_TRANSPORT_CONTAINER_40,
  "40HCDRY": LOCAL_TRANSPORT_CONTAINER_40,
  "40HCDRYVAN": LOCAL_TRANSPORT_CONTAINER_40,
  "40FTHC": LOCAL_TRANSPORT_CONTAINER_40,
});

export type LocalTransportToConfirmReason =
  | "DESTINATION_MISSING"
  | "DESTINATION_UNKNOWN"
  | "DESTINATION_AMBIGUOUS"
  | "CONTAINER_MISSING"
  | "CONTAINER_UNSUPPORTED"
  | "NO_MATCHING_RATE"
  | "AMBIGUOUS_RATE"
  | "INVALID_RATE_AMOUNT";

/** Messages FR déterministes, réutilisés tels quels par les deux lecteurs. */
export const LOCAL_TRANSPORT_TO_CONFIRM_MESSAGES: Readonly<
  Record<LocalTransportToConfirmReason, string>
> = Object.freeze({
  DESTINATION_MISSING:
    "Destination de livraison absente — tarif transport à confirmer.",
  DESTINATION_UNKNOWN:
    "Destination hors barème officiel de livraison conteneur — tarif transport à confirmer.",
  DESTINATION_AMBIGUOUS:
    "Destination ambiguë vis-à-vis du barème officiel — tarif transport à confirmer.",
  CONTAINER_MISSING: "Type de conteneur absent — tarif transport à confirmer.",
  CONTAINER_UNSUPPORTED:
    "Type de conteneur hors barème officiel (20' Dry / 40' Dry) — tarif transport à confirmer.",
  NO_MATCHING_RATE:
    "Aucun tarif officiel actif pour cette destination et ce conteneur — tarif transport à confirmer.",
  AMBIGUOUS_RATE:
    "Plusieurs tarifs officiels concurrents pour cette destination et ce conteneur — tarif transport à confirmer.",
  INVALID_RATE_AMOUNT:
    "Tarif officiel trouvé mais montant inexploitable — tarif transport à confirmer.",
});

/**
 * Normalisation des libellés de destination.
 *
 * Accents supprimés, majuscules, toute ponctuation autre que le séparateur `/`
 * remplacée par une espace, espaces effondrés, espaces retirés autour du `/`.
 *   "Thiès/Popoguine "  -> "THIES/POPOGUINE"
 *   "THIES / POPONGUINE"-> "THIES/POPONGUINE"
 *   "FORFAIT ZONE 1 <18 KM" -> "FORFAIT ZONE 1 18 KM"
 */
export function normalizeLocalTransportDestination(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9/]+/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalisation des types de conteneur : accents supprimés, majuscules, toute
 * ponctuation et toute espace retirées.
 *   "20' Dry" -> "20DRY"   "40 ' dry" -> "40DRY"   "40HC" -> "40HC"
 */
export function normalizeLocalTransportContainerType(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

/**
 * Construit l'index clé normalisée -> destination canonique.
 * Valeur `null` = clé ambiguë (deux canoniques visées) : ne résout rien.
 */
export function buildLocalTransportDestinationIndex(
  aliases: Readonly<Record<string, string>> =
    LOCAL_TRANSPORT_DESTINATION_ALIASES,
): Map<string, string | null> {
  const index = new Map<string, string | null>();

  const put = (key: string, canonical: string): void => {
    if (!key) return;
    if (!index.has(key)) {
      index.set(key, canonical);
      return;
    }
    const current = index.get(key);
    if (current !== canonical) index.set(key, null);
  };

  for (const canonical of CANONICAL_LOCAL_TRANSPORT_DESTINATIONS) {
    const full = normalizeLocalTransportDestination(canonical);
    put(full, canonical);
    if (full.includes("/")) {
      for (const component of full.split("/")) {
        put(component.trim(), canonical);
      }
    }
  }

  for (const [alias, canonical] of Object.entries(aliases)) {
    put(normalizeLocalTransportDestination(alias), canonical);
  }

  return index;
}

const DESTINATION_INDEX: ReadonlyMap<string, string | null> =
  buildLocalTransportDestinationIndex();

export type CanonicalDestinationResolution =
  | { canonical: string; reason: null }
  | {
    canonical: null;
    reason: Extract<
      LocalTransportToConfirmReason,
      "DESTINATION_MISSING" | "DESTINATION_UNKNOWN" | "DESTINATION_AMBIGUOUS"
    >;
  };

/** Résout un libellé libre vers l'une des 30 destinations canoniques, ou rien. */
export function resolveCanonicalLocalTransportDestination(
  raw: unknown,
): CanonicalDestinationResolution {
  const key = normalizeLocalTransportDestination(raw);
  if (!key) return { canonical: null, reason: "DESTINATION_MISSING" };
  if (!DESTINATION_INDEX.has(key)) {
    return { canonical: null, reason: "DESTINATION_UNKNOWN" };
  }
  const canonical = DESTINATION_INDEX.get(key) ?? null;
  if (canonical === null) {
    return { canonical: null, reason: "DESTINATION_AMBIGUOUS" };
  }
  return { canonical, reason: null };
}

/** Résout un type de conteneur vers "20' Dry" / "40' Dry", ou rien. */
export function resolveCanonicalLocalTransportContainerType(
  raw: unknown,
): string | null {
  const key = normalizeLocalTransportContainerType(raw);
  if (!key) return null;
  return LOCAL_TRANSPORT_CONTAINER_ALIASES[key] ?? null;
}

export interface LocalTransportRateCandidate {
  destination?: string | null;
  container_type?: string | null;
  rate_amount?: number | string | null;
  rate_currency?: string | null;
  is_active?: boolean | null;
  evidence_level?: string | null;
  validity_start?: string | null;
  validity_end?: string | null;
  client_code?: string | null;
  origin?: string | null;
  cargo_category?: string | null;
  source_document?: string | null;
  provider?: string | null;
}

export interface LocalTransportResolutionInput {
  destination: unknown;
  containerType: unknown;
  /** Code client du dossier. `null` = générique : aucune ligne client-spécifique. */
  clientCode?: string | null;
  /** Date d'évaluation `YYYY-MM-DD`, fournie par l'appelant (module pur). */
  asOfDate?: string | null;
  /** Filtres optionnels, appliqués seulement s'ils sont fournis. */
  origin?: string | null;
  cargoCategory?: string | null;
}

export type LocalTransportResolution =
  | {
    status: "RESOLVED";
    canonicalDestination: string;
    canonicalContainerType: string;
    amount: number;
    currency: string;
    rate: LocalTransportRateCandidate;
  }
  | {
    status: "TO_CONFIRM";
    code: typeof LOCAL_TRANSPORT_TO_CONFIRM_CODE;
    reason: LocalTransportToConfirmReason;
    message: string;
    canonicalDestination: string | null;
    canonicalContainerType: string | null;
    amount: null;
    matchCount: number;
  };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toConfirm(
  reason: LocalTransportToConfirmReason,
  canonicalDestination: string | null,
  canonicalContainerType: string | null,
  matchCount = 0,
): LocalTransportResolution {
  return {
    status: "TO_CONFIRM",
    code: LOCAL_TRANSPORT_TO_CONFIRM_CODE,
    reason,
    message: LOCAL_TRANSPORT_TO_CONFIRM_MESSAGES[reason],
    canonicalDestination,
    canonicalContainerType,
    amount: null,
    matchCount,
  };
}

/**
 * Fenêtre de validité. `asOf` invalide ou absent => seules les lignes sans
 * aucune borne passent (fail-closed : on ne présume pas d'une date).
 */
function isWithinValidity(
  row: LocalTransportRateCandidate,
  asOf: string | null,
): boolean {
  const start = typeof row.validity_start === "string"
    ? row.validity_start.slice(0, 10)
    : null;
  const end = typeof row.validity_end === "string"
    ? row.validity_end.slice(0, 10)
    : null;
  if (!start && !end) return true;
  if (!asOf) return false;
  if (start && !(start <= asOf)) return false;
  if (end && !(end >= asOf)) return false;
  return true;
}

/**
 * Sélection fail-closed du tarif officiel de livraison conteneur.
 *
 * Aucun `.limit(1)`, aucun premier-match : la fonction exige exactement un
 * candidat survivant, sinon elle rend TO_CONFIRM avec un montant `null`.
 */
export function resolveOfficialLocalTransportRate(
  rates: readonly LocalTransportRateCandidate[] | null | undefined,
  input: LocalTransportResolutionInput,
): LocalTransportResolution {
  const destination = resolveCanonicalLocalTransportDestination(
    input.destination,
  );
  if (destination.canonical === null) {
    return toConfirm(destination.reason, null, null);
  }

  const rawContainerKey = normalizeLocalTransportContainerType(
    input.containerType,
  );
  if (!rawContainerKey) {
    return toConfirm("CONTAINER_MISSING", destination.canonical, null);
  }
  const containerType = resolveCanonicalLocalTransportContainerType(
    input.containerType,
  );
  if (containerType === null) {
    return toConfirm("CONTAINER_UNSUPPORTED", destination.canonical, null);
  }

  const asOf = typeof input.asOfDate === "string" &&
      ISO_DATE.test(input.asOfDate.slice(0, 10))
    ? input.asOfDate.slice(0, 10)
    : null;
  const clientCode = input.clientCode ?? null;
  const originFilter = typeof input.origin === "string"
    ? input.origin.trim().toUpperCase()
    : null;
  const cargoFilter = typeof input.cargoCategory === "string"
    ? input.cargoCategory.trim().toUpperCase()
    : null;

  const eligible = (rates ?? []).filter((row) => {
    if (row?.is_active !== true) return false;
    if (
      !LOCAL_TRANSPORT_EVIDENCE_WHITELIST.includes(
        String(row.evidence_level ?? ""),
      )
    ) {
      return false;
    }
    if (!isWithinValidity(row, asOf)) return false;
    if (originFilter !== null) {
      const rowOrigin = typeof row.origin === "string"
        ? row.origin.trim().toUpperCase()
        : null;
      if (rowOrigin !== null && rowOrigin !== originFilter) return false;
    }
    if (cargoFilter !== null) {
      const rowCargo = typeof row.cargo_category === "string"
        ? row.cargo_category.trim().toUpperCase()
        : null;
      if (rowCargo !== null && rowCargo !== cargoFilter) return false;
    }
    if (
      normalizeLocalTransportDestination(row.destination) !==
        normalizeLocalTransportDestination(destination.canonical)
    ) {
      return false;
    }
    return resolveCanonicalLocalTransportContainerType(row.container_type) ===
      containerType;
  });

  // Scope client : sans code client, aucune ligne client-spécifique n'est
  // atteignable (anti-fuite). Avec code client, l'exact prime sur le générique.
  const clientScoped = eligible.filter((row) => {
    const rowClient = row.client_code ?? null;
    if (clientCode === null) return rowClient === null;
    return rowClient === clientCode || rowClient === null;
  });
  const exactClient = clientScoped.filter((row) =>
    (row.client_code ?? null) === clientCode
  );
  const candidates = clientCode !== null && exactClient.length > 0
    ? exactClient
    : clientScoped;

  if (candidates.length === 0) {
    return toConfirm(
      "NO_MATCHING_RATE",
      destination.canonical,
      containerType,
      0,
    );
  }
  if (candidates.length > 1) {
    return toConfirm(
      "AMBIGUOUS_RATE",
      destination.canonical,
      containerType,
      candidates.length,
    );
  }

  const rate = candidates[0];
  const amount = typeof rate.rate_amount === "number"
    ? rate.rate_amount
    : Number(rate.rate_amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return toConfirm(
      "INVALID_RATE_AMOUNT",
      destination.canonical,
      containerType,
      1,
    );
  }

  const currency =
    typeof rate.rate_currency === "string" && rate.rate_currency.trim() !== ""
      ? rate.rate_currency.trim()
      : "XOF";

  return {
    status: "RESOLVED",
    canonicalDestination: destination.canonical,
    canonicalContainerType: containerType,
    amount,
    currency,
    rate,
  };
}
