/** Operator-authorized ESTIMATION policy, not a regulatory tariff revision.
 * Historical catalogue remains untouched. Never feed this into firm pricing.
 */
export const STORAGE_POLICY = "STORAGE_P1_OPERATOR_1111_20260916";
export const STORAGE_GRID_SOURCE = "Grille Tarifaire Officielle Dakar Terminal, 09/12/2014, p.34";
export const STORAGE_P1_FACTOR = 1.111;
// [P1, P2, P3], historical FCFA. 420 has no complete schedule;
// vehicle/unit exceptions 420/421 must not enter tonne-based estimation.
const HISTORICAL: Record<string, readonly [number, number | null, number | null]> = {
  "410": [140, 238, 305], "411": [158, 318, 410], "412": [177, 294, 394],
  "413": [215, 354, 461], "414": [355, 599, 775], "415": [466, 750, 969],
  "416": [571, 954, 1229], "417": [884, 1476, 1909], "418": [1396, 2325, 3073],
  "419": [1768, 2873, 3708], "420": [1974, null, null], "421": [3558, 5921, 7654],
};
const OBSERVED: Record<string, { rate: number; provider: string; source: string }> = {
  "412": { rate: 197, provider: "DPW", source: "Facture DP World 3300753 du 23/02/2026, PDF factures combinées p.99 et105 (même facture)" },
  "419": { rate: 1964, provider: "TOM", source: "Facture TOM p.12 et proforma TOM FV10863 du 23/03/2026 p.110, PDF factures combinées" },
};
export function storageRateEstimate(code: string, provider: string) {
  const base = HISTORICAL[code];
  if (!base) return null;
  const observation = OBSERVED[code];
  return { code, base_p1: base[0], p1: Math.round(base[0] * STORAGE_P1_FACTOR), p2: base[1], p3: base[2],
    evidence: observation ? "observed_invoice" : "estimated_unproven",
    observed_source: observation?.source ?? null,
    observed_for_provider: observation?.provider === provider,
    policy: STORAGE_POLICY, factor: STORAGE_P1_FACTOR, source: STORAGE_GRID_SOURCE, firm_eligible: false as const };
}
export function estimateStorageByTonne(code: string, provider: string, totalKg: number, days: number, freeDays: number) {
  const rate = storageRateEstimate(code, provider);
  const refuse = (reason: string) => ({ amount: null, reason, rate });
  if (!rate || !/^41[0-9]$/.test(code)) return refuse("Code ou unité de magasinage non couvert par l’estimation à la tonne.");
  if (!Number.isFinite(totalKg) || totalKg <= 0 || totalKg > 1e12 || !Number.isSafeInteger(days) || days < 1 || days > 3660 ||
    !Number.isSafeInteger(freeDays) || freeDays < 0 || freeDays > 3660) return refuse("Poids total, durée ou franchise invalide.");
  const paid = Math.max(0, days - freeDays);
  const counts = [Math.min(paid, 15), Math.min(Math.max(0, paid - 15), 15), Math.max(0, paid - 30)];
  const rates = [rate.p1, rate.p2!, rate.p3!];
  // Preserve exact declared kg; do not generalize invoice rounding discrepancies.
  const amounts = counts.map((d, i) => Math.round(totalKg / 1000 * d * rates[i]));
  const amount = amounts.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(amount) || amount > 1e12) return refuse("Montant magasinage hors limites.");
  const evidence = rate.observed_source
    ? `P1 observé : ${rate.observed_source}.${rate.observed_for_provider ? "" : " Application à cet opérateur sous hypothèse, non corroborée chez lui."}`
    : "P1 estimé par coefficient opérateur ×1,111, à corroborer sur facture.";
  return { amount, rate, reason: `${STORAGE_POLICY} : code ${code}, P1 historique ${rate.base_p1} ×1,111 arrondi au franc = ${rate.p1} FCFA/t/j. ${evidence} ` +
    `P2/P3 historiques inchangés, actualité à confirmer. Source : ${STORAGE_GRID_SOURCE}. ` +
    `Franchise retenue ${freeDays}j ; poids total ${totalKg / 1000}t sans arrondi à la tonne ; ` +
    counts.map((d, i) => `P${i + 1} ${d}j ×${rates[i]} FCFA/t/j = ${amounts[i]} FCFA`).join(" ; ") +
    ". Estimation HT non ferme ; hors frais annexes et suppléments spécifiques." };
}
