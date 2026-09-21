/** Read-only quote information. Examples never participate in pricing totals. */
import { calculateStayTiers, DPW_FRANCHISE_SOURCE, type StayGroup, type StayTier } from "./container-stay-estimate.ts";
import { estimateStorageByTonne, storageRateEstimate } from "./storage-rate-estimate.ts";
import { buildDemurrageComparison, readDemurrageComparison, demurrageComparisonText, type DemurrageComparison, type DemurrageComparisonInput } from "./demurrage-reference-information.ts";

export interface StayInformation {
  schema_version: 1;
  free_days: number | null;
  franchise_note: string;
  tiers: Array<{ from: number; to: number | null; rate: number; currency: string; unit: string; relative: boolean }>;
  example: { days: number; amount: number; currency: string; formula: string } | null;
  reservations: string[];
  sources: string[];
  carrier_comparison?: DemurrageComparison;
}
export function readStayInformation(value: unknown): StayInformation | null {
  if (!value || typeof value !== "object") return null;
  const v = value as StayInformation;
  const positive = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;
  const day = (n: unknown) => positive(n) && Number.isSafeInteger(n);
  const currency = (v: unknown) => typeof v === "string" && ["XOF", "FCFA", "EUR", "USD"].includes(v);
  if (v.schema_version !== 1 || (v.free_days !== null && !day(v.free_days)) || typeof v.franchise_note !== "string" ||
    !Array.isArray(v.tiers) || !v.tiers.every(t => t && day(t.from) && t.from >= 1 && (t.to === null || (day(t.to) && t.to >= t.from)) && positive(t.rate) && t.rate > 0 &&
      currency(t.currency) && typeof t.unit === "string" && typeof t.relative === "boolean") ||
    !Array.isArray(v.reservations) || !v.reservations.every(r => typeof r === "string") ||
    !Array.isArray(v.sources) || !v.sources.every(s => typeof s === "string") ||
    (v.example !== null && (!v.example || !day(v.example.days) || v.example.days < 1 || !positive(v.example.amount) ||
      !currency(v.example.currency) || typeof v.example.formula !== "string"))) return null;
  if (v.carrier_comparison !== undefined && (!readDemurrageComparison(v.carrier_comparison) || v.free_days !== null || v.example !== null || v.tiers.length)) return null;
  return v;
}
const number = (value: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 6 }).format(value);
export const formatStayAmount = (value: number, currency: string) => `${number(value)} ${currency === "XOF" ? "FCFA" : currency}`;
export function stayRange(from: number, to: number | null, relative = false): string {
  return `${to === null ? `À partir du jour ${from}` : `Du jour ${from} au jour ${to}`}${relative ? " après franchise" : ""}`;
}
export function storageStayInformation(group: StayGroup | null, totalKg: number, franchiseVerified: boolean, reason: string): StayInformation {
  const free = franchiseVerified ? 10 : null;
  const info: StayInformation = { schema_version: 1, free_days: free,
    franchise_note: free === null ? "Franchise applicable à confirmer : terminal, équipement et conditions IMO/température à vérifier." : "10 jours sous hypothèse DP World, conteneur sec, import local ; règle de décompte à confirmer.",
    tiers: [], example: null, reservations: [reason], sources: [DPW_FRANCHISE_SOURCE] };
  const rate = group?.storage_p1_code && /^41[0-9]$/.test(group.storage_p1_code) ? storageRateEstimate(group.storage_p1_code, group.provider) : null;
  if (!rate) {
    info.reservations.push("Choisir et relier une hypothèse de séjour avec le terminal et la désignation magasinage (code 410–419) pour afficher les taux ; renseigner séparément les durées magasinage et armateur.");
    return info;
  }
  info.tiers = [rate.p1, rate.p2!, rate.p3!].map((rate, index) => ({
    from: (free ?? 0) + index * 15 + 1, to: index === 2 ? null : (free ?? 0) + (index + 1) * 15,
    rate, currency: "FCFA", unit: "tonne/jour", relative: free === null,
  }));
  info.sources.push(rate.source);
  if (rate.observed_source) info.sources.push(rate.observed_source);
  info.reservations.push(`Code ${rate.code} choisi sous hypothèse. P1 historique ×1,111, arrondi au franc ; P2/P3 historiques, actualité à confirmer. Aucun tarif ferme.`);
  if (rate.observed_source && !rate.observed_for_provider) info.reservations.push("Observation P1 chez un autre opérateur : application à ce terminal non corroborée.");
  if (!rate.observed_source) info.reservations.push("P1 estimé, à corroborer sur facture.");
  // Fixed TWO paid days, expressly illustrative: never fills the selected duration.
  if (free !== null) {
    const sample = estimateStorageByTonne(rate.code, group!.provider, totalKg, free + 2, free);
    if (sample.amount !== null) info.example = { days: free + 2, amount: sample.amount, currency: "FCFA",
      formula: `${number(totalKg / 1000)} tonnes de ce lot × 2 jours facturables × ${number(rate.p1)} FCFA/tonne/jour` };
    else info.reservations.push("Poids total et base du poids à renseigner pour illustrer le coût sur cette marchandise.");
  }
  return info;
}

export function demurrageStayInformation(tiers: StayTier[], freeDays: unknown, quantity: number, eligible: boolean, reason: string): StayInformation {
  const info: StayInformation = { schema_version: 1, free_days: null, franchise_note: "Franchise et grille armateur à confirmer.", tiers: [], example: null,
    reservations: [reason, "Détention après sortie et TVA fournisseur éventuelle non incluses ; convention de décompte à confirmer."], sources: [] };
  const currency = tiers.length ? String(tiers[0].currency) : "";
  if (!["XOF", "FCFA", "EUR", "USD"].includes(currency) || tiers.some(t => String(t.currency) !== currency)) return info;
  // Validate the schedule with the existing algorithm. Numeric calculation stays
  // in its NATIVE currency; this is NOT an exchange conversion or an XOF total.
  const checked = calculateStayTiers(tiers.map(t => ({ ...t, currency: "XOF" })), freeDays, 1, quantity);
  if (checked.amount === null) { info.reservations.push(checked.reason!); return info; }
  const free = freeDays as number;
  info.free_days = free;
  info.franchise_note = eligible ? "Franchise du barème armateur sélectionné, sous réserve de la convention de décompte." : "Franchise du barème de référence seulement : application à ce lot non confirmée (périmètre, validité ou conditions spécifiques).";
  info.tiers = [...tiers].sort((a, b) => Number(a.day_from) - Number(b.day_from)).map(t => ({
    from: t.day_from as number, to: t.day_to as number | null, rate: Number(t.rate_per_day), currency, unit: "conteneur/jour", relative: false,
  }));
  info.sources = Array.from(new Set(tiers.map(t => String(t.source_document))));
  if (eligible) {
    const sample = calculateStayTiers(tiers.map(t => ({ ...t, currency: "XOF" })), free, free + 2, quantity);
    const amount = sample.amount === null ? null : ["XOF", "FCFA"].includes(currency) ? sample.amount
      : Math.round(sample.breakdown.reduce((sum, p) => sum + p.days * p.rate * quantity, 0) * 100) / 100;
    if (amount !== null && amount <= 1e12) info.example = { days: free + 2, amount, currency,
      formula: sample.breakdown.map(p => `${number(quantity)} conteneur(s) de ce lot × ${p.days} jour(s) × ${number(p.rate)} ${currency}/conteneur/jour`).join(" + ") };
  }
  if (!["XOF", "FCFA"].includes(currency)) info.reservations.push(`Exemple en ${currency} uniquement ; aucune conversion ni addition au total XOF.`);
  return info;
}

export function unknownCarrierStayInformation(input: DemurrageComparisonInput): StayInformation | null {
  const comparison = buildDemurrageComparison(input);
  return comparison ? { schema_version: 1, free_days: null, franchise_note: "Franchise applicable à confirmer : les franchises ci-dessous appartiennent aux barèmes de référence, pas à un armateur sélectionné.",
    tiers: [], example: null, reservations: [], sources: [], carrier_comparison: comparison } : null;
}

/** Plain text travels with existing line notes into immutable quotation outputs. */
export function stayInformationText(info: StayInformation): string {
  if (info.carrier_comparison) return [info.franchise_note, demurrageComparisonText(info.carrier_comparison)].join("\n");
  return [info.free_days === null ? "Franchise : à confirmer." : `Franchise : ${info.free_days} jours.`, info.franchise_note,
    ...info.tiers.map(t => `${stayRange(t.from, t.to, t.relative)} : ${number(t.rate)} ${t.currency}/${t.unit}.`),
    info.example ? `Exemple illustratif pour un séjour HYPOTHÉTIQUE de ${info.example.days} jours, franchise comprise : ${info.example.formula} = ${number(info.example.amount)} ${info.example.currency}. Non ajouté au total ; ce n’est pas la durée retenue.` : "Exemple non chiffrable avec les conditions connues.",
    ...info.reservations, ...info.sources.map(s => `Source : ${s}`)].join("\n");
}
