/**
 * HONORAIRES-1 — source unique des honoraires internes SODATRA.
 *
 * Décision CTO 2026-09-09 : les honoraires (frais d'agence, honoraires de
 * dédouanement) proviennent d'UNE seule source paramétrable par
 * l'administrateur, `pricing_rate_cards` (source `internal`), lue par
 * `price-service-lines`. Le moteur `quotation-engine` n'émet plus de bloc
 * honoraires, et ni les paliers douaniers ni le catalogue ne servent ces clés.
 *
 * Module pur, sans I/O : partagé par run-pricing (classification, totaux,
 * TVA SODATRA) et price-service-lines (sélection de source).
 */

/** Clés de service portant des honoraires internes (soumis à la TVA SODATRA). */
export const INTERNAL_FEE_SERVICE_KEYS: ReadonlySet<string> = new Set([
  "AGENCY",
  "CUSTOMS_DAKAR",
]);

/** Bloc de présentation des honoraires dans les lignes de chiffrage. */
export const INTERNAL_FEE_BLOC = "honoraires" as const;

export function isInternalFeeServiceKey(serviceKey: unknown): boolean {
  return typeof serviceKey === "string" &&
    INTERNAL_FEE_SERVICE_KEYS.has(serviceKey.trim().toUpperCase());
}

/** Forme minimale d'une ligne de chiffrage canonisée par run-pricing. */
export interface InternalFeeLineLike {
  amount?: unknown;
  source?: { type?: unknown } | null;
  canonical?: { origin_layer?: unknown; service_key?: unknown } | null;
}

function finiteAmount(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function isToConfirm(line: InternalFeeLineLike): boolean {
  return String(line?.source?.type ?? "")
    .trim()
    .split("+")[0]
    .split(":")[0]
    .toUpperCase() === "TO_CONFIRM";
}

/**
 * Somme des honoraires internes FERMES produits par la couche package
 * (`origin_layer = package_enrichment`). Les lignes TO_CONFIRM, nulles ou
 * négatives, et toute ligne d'une autre couche, sont ignorées : le moteur
 * compte déjà ses propres lignes dans `totals.honoraires`.
 */
export function sumFirmInternalFeePackageLines(
  lines: ReadonlyArray<InternalFeeLineLike> | null | undefined,
): number {
  if (!Array.isArray(lines)) return 0;
  let total = 0;
  for (const line of lines) {
    if (line?.canonical?.origin_layer !== "package_enrichment") continue;
    if (!isInternalFeeServiceKey(line?.canonical?.service_key)) continue;
    if (isToConfirm(line)) continue;
    const amount = finiteAmount(line?.amount);
    if (amount > 0) total += amount;
  }
  return total;
}
