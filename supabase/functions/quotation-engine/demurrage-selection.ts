/**
 * Sélection fail-closed des barèmes de surestaries.
 *
 * Une grille n'est admissible que si l'armateur ET le type ISO du conteneur
 * correspondent exactement après normalisation déterministe. Il n'existe
 * aucun fallback par taille, sous-chaîne, premier résultat ou grille GENERIC.
 */

export type DemurrageContainerType =
  | "20DV"
  | "40DV"
  | "40HC"
  | "20RF"
  | "40RF"
  | "20OT"
  | "40OT";

export interface DemurrageEquipmentResolution {
  containerType: DemurrageContainerType | null;
  reason: string | null;
}

export interface DemurrageRateSelection {
  row: DemurrageRateRow | null;
  matchKind: "exact" | null;
  reason: string | null;
}

export interface DemurrageRateRow {
  id: string;
  carrier: string;
  container_type: string;
  free_days_import?: number | null;
  free_days_export?: number | null;
  currency?: string | null;
  day_1_7_rate?: number | null;
  day_8_14_rate?: number | null;
  day_15_plus_rate?: number | null;
  source_document?: string | null;
  [key: string]: unknown;
}

export interface DemurragePendingProvenance {
  type: "TO_CONFIRM";
  confidence: number;
}

function normalizeToken(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const CONTAINER_TYPE_ALIASES: Readonly<Record<string, DemurrageContainerType>> = {
  "20": "20DV",
  "20FT": "20DV",
  "20GP": "20DV",
  "20DC": "20DV",
  "20STD": "20DV",
  "20DV": "20DV",
  "20DRY": "20DV",
  "20DRYVAN": "20DV",
  "40": "40DV",
  "40FT": "40DV",
  "40GP": "40DV",
  "40DC": "40DV",
  "40STD": "40DV",
  "40DV": "40DV",
  "40DRY": "40DV",
  "40DRYVAN": "40DV",
  "40HC": "40HC",
  "40HQ": "40HC",
  "40HIGHCUBE": "40HC",
  "20RF": "20RF",
  "20REEFER": "20RF",
  "40RF": "40RF",
  "40REEFER": "40RF",
  "20OT": "20OT",
  "20OPENTOP": "20OT",
  "40OT": "40OT",
  "40OPENTOP": "40OT",
  "40HCOT": "40OT",
};

export function normalizeDemurrageContainerType(value: unknown): DemurrageContainerType | null {
  return CONTAINER_TYPE_ALIASES[normalizeToken(value)] ?? null;
}

/**
 * Le moteur ne produit qu'une ligne de surestaries. Des équipements de types
 * différents nécessitent donc des lignes séparées : on bloque au lieu de
 * choisir silencieusement l'un des barèmes.
 */
export function resolveDemurrageEquipment(containers: unknown[]): DemurrageEquipmentResolution {
  const list = Array.isArray(containers) ? containers : [];
  if (list.length === 0) {
    return { containerType: null, reason: "Type de conteneur inconnu (aucun conteneur renseigné)" };
  }

  const types = new Set<DemurrageContainerType>();
  for (const container of list) {
    const type = typeof container === "object" && container !== null && "type" in container
      ? container.type
      : null;
    const resolved = normalizeDemurrageContainerType(type);
    if (!resolved) {
      return {
        containerType: null,
        reason: `Type de conteneur non couvert par un barème exact: "${String(type ?? "")}"`,
      };
    }
    types.add(resolved);
  }

  if (types.size !== 1) {
    return {
      containerType: null,
      reason: `Types de conteneurs mixtes (${[...types].sort().join("/")}) — barèmes séparés requis`,
    };
  }

  return { containerType: [...types][0], reason: null };
}

const CARRIER_ALIASES: Readonly<Record<string, string>> = {
  CMACGM: "CMACGM",
  MSC: "MSC",
  MEDITERRANEANSHIPPINGCOMPANY: "MSC",
  MAERSK: "MAERSK",
  MAERSKLINE: "MAERSK",
  HAPAGLLOYD: "HAPAGLLOYD",
  ONE: "ONE",
  OCEANNETWORKEXPRESS: "ONE",
};

function normalizeCarrier(value: unknown): string | null {
  const token = normalizeToken(value);
  if (!token) return null;
  return CARRIER_ALIASES[token] ?? token;
}

/**
 * Un barème prouvé ne prouve pas le montant final : celui-ci dépend encore du
 * nombre réel de jours facturables. La provenance reste donc fail-closed.
 */
export function resolveDemurragePendingProvenance(evidenceLevel: unknown): DemurragePendingProvenance {
  const evidence = String(evidenceLevel ?? "").toLowerCase();
  const confidence = evidence === "official"
    ? 0.9
    : evidence === "validated_internal"
    ? 0.85
    : evidence === "observed"
    ? 0.8
    : 0.7;
  return { type: "TO_CONFIRM", confidence };
}

/**
 * Sélectionne exactement une ligne. L'absence d'armateur, une collision ou
 * l'absence du couple armateur/type retourne un refus explicite.
 */
export function selectDemurrageRate(
  rows: DemurrageRateRow[] | null | undefined,
  detectedCarrier: string | null | undefined,
  containerType: DemurrageContainerType,
): DemurrageRateSelection {
  const carrier = normalizeCarrier(detectedCarrier);
  if (!carrier) {
    return {
      row: null,
      matchKind: null,
      reason: "Armateur non détecté — sélection d'un barème de surestaries interdite",
    };
  }

  const candidates = (Array.isArray(rows) ? rows : []).filter((row) =>
    normalizeCarrier(row?.carrier) === carrier &&
    normalizeDemurrageContainerType(row?.container_type) === containerType
  );

  if (candidates.length === 0) {
    return {
      row: null,
      matchKind: null,
      reason: `Aucun barème exact de surestaries pour ${detectedCarrier} / ${containerType}`,
    };
  }

  if (candidates.length !== 1) {
    return {
      row: null,
      matchKind: null,
      reason: `Collision de barèmes surestaries pour ${detectedCarrier} / ${containerType} (${candidates.length})`,
    };
  }

  return { row: candidates[0], matchKind: "exact", reason: null };
}
