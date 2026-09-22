/** Scenario-only stay assumptions. No tariff, client fact or calendar is invented. */
export const CONTAINER_STAY_KEY = "pricing.container_stay_estimate";
export interface StayGroup {
  unit_ref: string; equipment_code: string; quantity: number; ownership: "SOC" | "COC";
  storage_days: number | null; demurrage_days: number | null; provider: "DPW" | "UNKNOWN";
  storage_p1_code?: string | null;
}
export interface StayBasis {
  schema_version: 1; source: string; verified_on: string; groups: StayGroup[];
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 1000;
const integer = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const date = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
export function stayBasisError(raw: unknown): string | null {
  if (!object(raw) || Object.keys(raw).some(k => !["schema_version", "source", "verified_on", "groups"].includes(k)) ||
    raw.schema_version !== 1 || !text(raw.source) || !date(raw.verified_on)) return "Source, date et contrat de séjour version 1 requis.";
  if (!Array.isArray(raw.groups) || !raw.groups.length || raw.groups.length > 12) return "Renseigner entre 1 et 12 lots de séjour.";
  const refs = new Set();
  for (const g of raw.groups) {
    if (!object(g) || Object.keys(g).some(k => !["unit_ref", "equipment_code", "quantity", "ownership", "storage_days", "demurrage_days", "provider", "storage_p1_code"].includes(k)) ||
      (g.storage_p1_code != null && (typeof g.storage_p1_code !== "string" || !/^41[0-9]$/.test(g.storage_p1_code))) ||
      !text(g.unit_ref) || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(g.unit_ref) || refs.has(g.unit_ref) ||
      !text(g.equipment_code) || !integer(g.quantity, 1, 1000000) ||
      (g.storage_days !== null && !integer(g.storage_days, 1, 3660)) || (g.demurrage_days !== null && !integer(g.demurrage_days, 1, 3660)) ||
      // A sourced designation may be linked before a forecast duration exists.
      // Null durations still prevent every monetary stay calculation downstream.
      (g.storage_days === null && g.demurrage_days === null &&
        !(g.provider === "DPW" && typeof g.storage_p1_code === "string" && /^41[0-9]$/.test(g.storage_p1_code))) ||
      !["SOC", "COC"].includes(String(g.ownership)) || !["DPW", "UNKNOWN"].includes(String(g.provider))) return "Lot : référence unique, équipement, propriété et quantité requis ; renseigner des jours entiers positifs ou une désignation magasinage 410–419 sous hypothèse DPW sans durée.";
    refs.add(g.unit_ref);
  }
  return null;
}
export function resolveStayGroup(raw: unknown, unit: Record<string, unknown>, asOf: string): { group: StayGroup | null; reason: string | null } {
  const invalid = stayBasisError(raw);
  if (invalid) return { group: null, reason: invalid };
  const basis = raw as StayBasis;
  if (!date(asOf) || basis.verified_on > asOf) return { group: null, reason: "Vérification du séjour future ou invalide." };
  const g = basis.groups.find(g => g.unit_ref === unit.unit_ref);
  if (!g || unit.unit_kind !== "CONTAINER" || g.equipment_code.toUpperCase() !== String(unit.equipment_code).toUpperCase() ||
    g.quantity !== unit.quantity || g.ownership !== unit.ownership) return { group: null, reason: "Hypothèse de séjour absente ou lot modifié : actualiser et relier l’hypothèse." };
  return { group: g, reason: null };
}

export interface StayTier {
  day_from: unknown; day_to: unknown; rate_per_day: unknown; currency: unknown;
  evidence_level: unknown; source_document: unknown;
}
/** Day indexes include free time (J1 = first day under the carrier's counting rule).
 * Never infer detention outside the terminal from this input. Reject incomplete
 * schedules even inside free time; never sum foreign currencies into XOF totals.
 */
export function calculateStayTiers(tiers: StayTier[], freeDays: unknown, days: number, quantity: number) {
  const refuse = (reason: string) => ({ amount: null, reason, breakdown: [] as Array<{ from: number; to: number; days: number; rate: number; amount: number }> });
  if (!integer(freeDays, 0, 3660) || !integer(days, 1, 3660) || !integer(quantity, 1, 1000000) || !tiers.length) return refuse("Franchise, durée ou paliers manquants.");
  const sorted = [...tiers].sort((a, b) => Number(a.day_from) - Number(b.day_from));
  let next = freeDays + 1;
  let amount = 0;
  const breakdown: Array<{ from: number; to: number; days: number; rate: number; amount: number }> = [];
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    const rate = typeof t.rate_per_day === "number" || (typeof t.rate_per_day === "string" && /^\d+(\.\d+)?$/.test(t.rate_per_day)) ? Number(t.rate_per_day) : NaN;
    if (!integer(t.day_from, 1, 3661) || t.day_from !== next ||
      (t.day_to !== null && !integer(t.day_to, t.day_from, 3660)) || (t.day_to === null && i !== sorted.length - 1) ||
      !Number.isFinite(rate) || rate <= 0 || rate > 1e9 || !text(t.source_document) ||
      !["official", "validated_internal"].includes(String(t.evidence_level))) return refuse("Paliers non prouvés, incomplets, chevauchants ou invalides.");
    if (!["XOF", "FCFA"].includes(String(t.currency))) return refuse("Conversion monétaire sourcée nécessaire avant addition au total XOF.");
    const end = Math.min(days, t.day_to === null ? days : Number(t.day_to));
    const charged = Math.max(0, end - t.day_from + 1);
    if (charged) {
      const part = Math.round(charged * rate * quantity);
      amount += part;
      breakdown.push({ from: t.day_from, to: end, days: charged, rate, amount: part });
    }
    next = t.day_to === null ? Infinity : Number(t.day_to) + 1;
  }
  if (next !== Infinity || !Number.isSafeInteger(amount) || amount > 1e12) return refuse("Fin de barème absente ou montant hors limites.");
  return { amount, reason: null, breakdown };
}

/** Only the published DPW dry/local-import franchise is cross-checked here.
 * Existing daily storage prices have ambiguous EVP units and unproven origin:
 * they MUST NOT be used, nor may PAD/Dakar Terminal substitute for DPW.
 */
export function assessDpwStorageFranchise(rows: Record<string, unknown>[], group: StayGroup, unit: Record<string, unknown>, asOf: string) {
  const pending = (reason: string) => ({ amount: null, reason });
  if (group.provider !== "DPW") return pending("Terminal magasinage à préciser.");
  const aliases: Record<string, string> = { "20GP": "20DV", "20DV": "20DV", "40GP": "40DV", "40DV": "40DV", "40HQ": "40HC", "40HC": "40HC" };
  const type = aliases[group.equipment_code.toUpperCase()];
  if (!type || unit.dangerous_goods !== false || unit.temperature_control_required !== false) return pending("Franchise spécifique équipement/IMO/température à vérifier.");
  const candidates = rows.filter(r => ["DPW", "DP_WORLD"].includes(String(r.provider)) && r.cargo_type === "FCL" &&
    r.container_type === type && r.is_active === true && date(r.effective_date) && r.effective_date <= asOf &&
    (r.expiry_date == null || (date(r.expiry_date) && r.expiry_date >= asOf)));
  if (candidates.length !== 1 || candidates[0].free_days !== 10) return pending("Franchise DPW absente, ambiguë ou différente de la source vérifiée.");
  if (group.storage_days === null) return pending("Durée de magasinage non renseignée ; durée armateur non réutilisée.");
  if (group.storage_days > 10) return pending("Séjour au-delà de la franchise : tarif magasinage et unité EVP à vérifier sur pièce, aucun montant journalier présumé.");
  return { amount: 0, reason: "Sous hypothèse de sortie dans la franchise DPW de 10 jours pour conteneur sec import local. Les autres frais ne sont pas inclus." };
}
export const DPW_FRANCHISE_SOURCE = "https://dpw-prod-cd-1.dpworld.com/senegal/faqs (consulté le 2026-09-16)";
export function isCurrentStayTariff(row: Record<string, unknown>, asOf: string): boolean {
  return date(asOf) && row.is_active === true && date(row.effective_date) && row.effective_date <= asOf &&
    (row.expiry_date == null || (date(row.expiry_date) && row.expiry_date >= asOf));
}
