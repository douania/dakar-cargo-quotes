/** Descriptive delivery zones only. Never selects a tariff or computes a fee. */
export interface DeliveryZone {
  code: string;
  name: string;
  examples: readonly string[];
  multiplier: number;
  distanceKm: number;
}

export type ZoneCatalogSource = "delivery_zones" | "static_fallback";
export type DeliveryZoneResolution<T> =
  | { status: "matched"; zone: T; candidate_codes: string[] }
  | { status: "unknown" | "ambiguous"; zone: null; candidate_codes: string[] };

function normalize(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ")
    : "";
}

/** Exact codes, names and explicit examples; collect all candidates before deciding. */
export function resolveDeliveryZone<T extends DeliveryZone>(
  destination: unknown,
  zones: Readonly<Record<string, T>>,
): DeliveryZoneResolution<T> {
  const key = normalize(destination);
  if (!key) return { status: "unknown", zone: null, candidate_codes: [] };
  const candidates = Object.values(zones).filter((zone) =>
    normalize(zone.code) &&
    [zone.code, zone.name, ...zone.examples].some((alias) =>
      normalize(alias) === key
    )
  );
  const codes = [...new Set(candidates.map((zone) => zone.code))].sort();
  if (!candidates.length) {
    return { status: "unknown", zone: null, candidate_codes: [] };
  }
  // Duplicate/conflicting records also fail closed; never choose a catalogue's first row.
  if (candidates.length !== 1) {
    return { status: "ambiguous", zone: null, candidate_codes: codes };
  }
  return { status: "matched", zone: candidates[0], candidate_codes: codes };
}

export function deliveryZoneMetadata<T extends DeliveryZone>(
  destination: unknown,
  zones: Readonly<Record<string, T>>,
  source: ZoneCatalogSource,
  country?: string | null,
) {
  const resolution = resolveDeliveryZone(destination, zones);
  const zone = resolution.zone;
  return {
    zone: zone
      ? {
        code: zone.code,
        name: zone.name,
        multiplier: Number.isFinite(zone.multiplier) && zone.multiplier > 0
          ? zone.multiplier
          : null,
        distanceKm: Number.isFinite(zone.distanceKm) && zone.distanceKm >= 0
          ? zone.distanceKm
          : null,
        country: country || undefined,
      }
      : null,
    zone_resolution: {
      status: resolution.status,
      source,
      candidate_codes: resolution.candidate_codes,
    },
  };
}

export function deliveryZoneWarnings(
  status: "matched" | "unknown" | "ambiguous",
): string[] {
  if (status === "matched") return [];
  return [
    status === "ambiguous"
      ? "Zone de livraison ambiguë : à confirmer ; plusieurs correspondances exactes."
      : "Zone de livraison à confirmer : aucune correspondance exacte. Aucun facteur de zone retenu.",
  ];
}

/** New unresolved metadata and legacy absent zones never imply a neutral 1.0. */
export function zoneComplexityFactor(metadata: unknown): number | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const { zone, zone_resolution: resolution } = metadata as {
    zone?: { multiplier?: unknown } | null;
    zone_resolution?: { status?: unknown } | null;
  };
  if (resolution && resolution.status !== "matched") return undefined;
  const factor = zone?.multiplier;
  return typeof factor === "number" && Number.isFinite(factor) && factor > 0
    ? factor
    : undefined;
}
