/** Documentary comparison ONLY. Never a selected carrier or a pricing input. */
export interface DemurrageReference {
  carrier: string;
  source_url: string;
  effective_date: string;
  currency: "XOF" | "EUR";
  xof_per_currency: number;
  free_days: number;
  tiers: Array<{ from: number; to: number | null; rate: number }>;
}
export interface DemurrageComparison {
  schema_version: 1;
  consulted_on: string;
  equipment: "20DV" | "40DV" | "40HC";
  quantity: number;
  references: DemurrageReference[];
  conversion_source: string;
  reservations: string[];
}
const CONSULTED_ON = "2026-09-21";
const EUR_XOF = 655.957;
const BCEAO = "https://www.bceao.int/cours/cours-de-reference-des-principales-devises-contre-Franc-CFA";
const CMA = "https://www.cma-cgm.com/assets/public/documents/DD_Tarifs_SN_2025-01-01_1.pdf";
const HAPAG = "https://www.hapag-lloyd.com/content/dam/website/downloads/detention_demurrage/SN.pdf";
const integer = (n: unknown, min: number, max: number): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= max;
const date = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;

export interface DemurrageComparisonInput {
  carrier: string | null;
  equipment: string | null;
  unit: Record<string, unknown> | undefined;
  movement_direction?: string;
  destination_country?: string;
  discharge_port?: string;
  terminal_mode?: unknown;
  is_transit: boolean;
  as_of: string;
}

/** Standard references may illustrate UNKNOWN danger, never override known DG.
 * The explicit conditional scope below travels with the snapshot and exports.
 * Source dates are frozen: never relabel a historical reference as today's rate.
 */
export function buildDemurrageComparison(input: DemurrageComparisonInput): DemurrageComparison | null {
  const unit = input.unit;
  const port = (input.discharge_port ?? "").trim().toLowerCase();
  if (input.carrier?.trim() || input.is_transit || input.movement_direction !== "IMPORT" || input.destination_country !== "SN" ||
    !["dakar", "dakar port", "port de dakar", "sndkr", "sn dkr"].includes(port) ||
    (input.terminal_mode != null && input.terminal_mode !== "LOLO") ||
    !date(input.as_of) || input.as_of < CONSULTED_ON || !unit || unit.unit_kind !== "CONTAINER" || unit.ownership !== "COC" ||
    !integer(unit.quantity, 1, 1000000) || ![false, null].includes(unit.dangerous_goods as false | null) ||
    unit.un_number != null || unit.imo_class != null || unit.temperature_control_required !== false ||
    !["20DV", "40DV", "40HC"].includes(input.equipment ?? "")) return null;
  const twenty = input.equipment === "20DV";
  const reference = (carrier: string, source_url: string, effective_date: string, currency: "XOF" | "EUR", first: number, next: number): DemurrageReference => ({
    carrier, source_url, effective_date, currency, xof_per_currency: currency === "EUR" ? EUR_XOF : 1, free_days: 10,
    tiers: [{ from: 11, to: 20, rate: first }, { from: 21, to: null, rate: next }],
  });
  return {
    schema_version: 1, consulted_on: CONSULTED_ON, equipment: input.equipment as DemurrageComparison["equipment"], quantity: unit.quantity,
    references: [reference("CMA CGM", CMA, "2025-01-01", "XOF", twenty ? 17715 : 38050, twenty ? 22960 : 45920),
      reference("Hapag-Lloyd", HAPAG, "2024-05-01", "EUR", twenty ? 27 : 54, twenty ? 33 : 64)],
    conversion_source: BCEAO,
    reservations: [
      "Indicatif — armateur à confirmer. Comparaison limitée à ces deux références, pas une fourchette de tout le marché ni un plafond garanti.",
      "Hypothèse illustrative : conteneur sec standard non dangereux à l’import Dakar. Catégorie tarifaire et conditions du booking à confirmer ; aucun armateur ni aucune franchise applicable ne sont sélectionnés.",
      ...(unit.dangerous_goods === null ? ["Danger du lot inconnu : exemple de base standard uniquement, sans supplément IMO ; aucune qualification non dangereuse déduite."] : []),
      "Barèmes publiés jusqu’à nouvel avis, aux dates indiquées. Actualité et conditions négociées à reconfirmer avant utilisation contractuelle.",
      "CMA CGM : tableau « IMPORT - DAKAR CITY CENTER », section DEMURRAGE uniquement. Les conditions de détention selon la destination intérieure ne sont pas reprises ici.",
      "Jours calendaires, franchise comprise ; point de départ du décompte à confirmer. Magasinage DPW, détention après sortie et TVA fournisseur éventuelle exclus.",
      "Durées purement hypothétiques, sans lien avec les durées retenues. Aucun montant de cette comparaison n’est ajouté aux totaux.",
    ],
  };
}

/** Read persisted references, not the current catalog: old outputs stay frozen. */
export function readDemurrageComparison(value: unknown): DemurrageComparison | null {
  if (!value || typeof value !== "object") return null;
  const c = value as DemurrageComparison;
  if (c.schema_version !== 1 || !date(c.consulted_on) || !["20DV", "40DV", "40HC"].includes(c.equipment) ||
    !integer(c.quantity, 1, 1000000) || c.conversion_source !== BCEAO ||
    !Array.isArray(c.reservations) || !c.reservations.length || !c.reservations.every(s => typeof s === "string" && s.trim()) ||
    !Array.isArray(c.references) || c.references.length !== 2) return null;
  const carriers = new Set<string>();
  for (const r of c.references) {
    if (!r || !["CMA CGM", "Hapag-Lloyd"].includes(r.carrier) || carriers.has(r.carrier) ||
      r.source_url !== (r.carrier === "CMA CGM" ? CMA : HAPAG) || !date(r.effective_date) || r.effective_date > c.consulted_on ||
      r.currency !== (r.carrier === "CMA CGM" ? "XOF" : "EUR") || r.xof_per_currency !== (r.currency === "EUR" ? EUR_XOF : 1) ||
      r.free_days !== 10 || !Array.isArray(r.tiers) || r.tiers.length !== 2 || !r.tiers.every((t, i) => t &&
        t.from === (i === 0 ? 11 : 21) && t.to === (i === 0 ? 20 : null) && typeof t.rate === "number" && Number.isFinite(t.rate) && t.rate > 0 && t.rate <= 1000000)) return null;
    carriers.add(r.carrier);
    // Protect rendering/conversion from oversized or tampered persisted data.
    const maximumExample = demurrageReferenceExample(r, c.quantity, 25).xof_amount;
    if (!Number.isSafeInteger(maximumExample) || maximumExample > 1e12) return null;
  }
  return c;
}

/** Round the converted aggregate once, not each daily rate. No pricing calls. */
export function demurrageReferenceExample(reference: DemurrageReference, quantity: number, days: number) {
  const parts = reference.tiers.map(t => ({ days: Math.max(0, Math.min(days, t.to ?? days) - t.from + 1), rate: t.rate }));
  const nativeAmount = parts.reduce((sum, p) => sum + p.days * p.rate * quantity, 0);
  return { parts, native_amount: nativeAmount, xof_amount: Math.round(nativeAmount * reference.xof_per_currency) };
}
export const DEMURRAGE_EXAMPLE_DAYS = [15, 20, 25] as const;
const number = (v: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(v);
export function demurrageComparisonText(c: DemurrageComparison): string {
  return ["Comparaison informative — armateur à confirmer.", `Lot : ${c.quantity} × ${c.equipment}. Sources consultées le ${c.consulted_on}.`,
    ...c.references.flatMap(r => [
      `${r.carrier} — franchise de référence : ${r.free_days} jours calendaires. Barème effectif le ${r.effective_date}.`,
      ...r.tiers.map(t => `${t.to === null ? `À partir du jour ${t.from}` : `Du jour ${t.from} au jour ${t.to}`} : ${number(t.rate)} ${r.currency}/conteneur/jour${r.currency === "EUR" ? ` (environ ${number(Math.round(t.rate * r.xof_per_currency))} FCFA)` : ""}.`),
      `Source : ${r.source_url}`,
    ]),
    ...DEMURRAGE_EXAMPLE_DAYS.map(days => {
      const examples = c.references.map(r => ({ carrier: r.carrier, ...demurrageReferenceExample(r, c.quantity, days) }));
      const amounts = examples.map(e => e.xof_amount);
      return `Séjour HYPOTHÉTIQUE de ${days} jours, franchise comprise, ${c.quantity} conteneur(s) : ${examples.map(e => `${e.carrier} ${number(e.xof_amount)} FCFA`).join(" ; ")} ; fourchette ${number(Math.min(...amounts))}–${number(Math.max(...amounts))} FCFA. Non ajouté au total.`;
    }),
    `Conversion informative : 1 EUR = ${number(EUR_XOF)} FCFA (BCEAO). Arrondi du total de l’exemple au franc, pas du taux journalier. Source : ${c.conversion_source}`,
    ...c.reservations,
  ].join("\n");
}
