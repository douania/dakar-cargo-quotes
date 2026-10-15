/** HS nomenclature and fiscal evidence are separate. No classification or formula here. */
export type TaxRow = Record<string, unknown>;
export const HS_TAX_FIELDS = ['dd', 'surtaxe', 'rs', 'pcs', 'pcc', 'cosec', 'uemoa', 'tin', 'tva', 'tev', 'ta', 't_past', 't_para', 't_conj', 't_ciment', 'ref'] as const;
const ENGINE_FIELDS = ['dd', 'surtaxe', 'rs', 'pcs', 'pcc', 'cosec', 'tin', 'tva', 't_conj'] as const;
const REGIME_FLAGS = ['dd', 'stx', 'rs', 'tin', 'tva', 'cosec', 'pcs', 'pcc', 'tpast', 'ta', 'hors_promad', 'hors_bic'] as const;
const object = (v: unknown): TaxRow => v && typeof v === 'object' && !Array.isArray(v) ? v as TaxRow : {};
const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
export const HS_TAX_BASIS_VERSION = 'dcq-customs-existing-formulas-v1';
export const REVIEWED_HS_CODES = ['3004901000', '3004902000', '3004909000'];

/** Null, absent, invalid and explicitly unconfirmed rates never become zero. */
export function knownHsTaxProfile(row: TaxRow): boolean {
  return [undefined, 'legacy', 'verified'].includes(row.tax_profile_status as string | undefined) && ENGINE_FIELDS.every(key => number(row[key]));
}

export interface HsEquivalenceContext {
  sourceDigits: string;
  allowEstimate: boolean;
  cargoValue: number | undefined;
  currency: string | undefined;
  regimeCode: string | undefined;
  regime: TaxRow | null;
  exemptionsReviewed: boolean;
  exemptionTitle?: string;
  transportMode: string;
}
export type HsTaxEquivalence = { eligible: false; reason: string } | {
  eligible: true;
  classification_status: 'to_confirm';
  validated_hs_code: null;
  candidate_codes: string[];
  common_profile: TaxRow;
  proof: { basis_version: string; source_digits: string; profiles: TaxRow[]; regime: TaxRow; transport_mode: string; currency: string; cargo_value: number };
};

/** Require the complete candidate set and explicit evidence of bases, regime and exemptions.
 * Legacy numeric equality alone is deliberately insufficient. Unsupported tax bases stay reserved.
 */
export function equivalentHsTaxation(rows: TaxRow[], totalCount: number | null, ctx: HsEquivalenceContext): HsTaxEquivalence {
  const fail = (reason: string): HsTaxEquivalence => ({ eligible: false, reason });
  if (!ctx.allowEstimate || !/^(?:\d{6}|\d{8})$/.test(ctx.sourceDigits)) return fail('HS_ESTIMATE_NOT_REQUESTED');
  if (!number(ctx.cargoValue) || ctx.cargoValue === 0 || !ctx.currency?.trim()) return fail('CUSTOMS_VALUATION_UNKNOWN');
  if (!['XOF', 'FCFA', 'CFA'].includes(ctx.currency.trim().toUpperCase())) return fail('CUSTOMS_EXCHANGE_RATE_UNVERIFIED');
  if (!ctx.regimeCode || !ctx.regime || ctx.regime.code !== ctx.regimeCode || ctx.regime.is_active !== true ||
    !REGIME_FLAGS.every(k => typeof ctx.regime![k] === 'boolean')) return fail('CUSTOMS_REGIME_UNKNOWN');
  if (!ctx.exemptionsReviewed || ctx.exemptionTitle?.trim()) return fail('CUSTOMS_EXEMPTIONS_UNRESOLVED');
  if (!['aerien', 'maritime', 'routier'].includes(ctx.transportMode)) return fail('CUSTOMS_TRANSPORT_UNKNOWN');
  if (totalCount === null || totalCount !== rows.length || rows.length < 2 || rows.length > 100) return fail('HS_CANDIDATES_INCOMPLETE');
  const codes = rows.map(r => String(r.code_normalized ?? ''));
  if (new Set(codes).size !== codes.length || codes.some(c => !/^\d{10}$/.test(c) || !c.startsWith(ctx.sourceDigits.slice(0, 6)))) return fail('HS_CANDIDATES_INVALID');
  for (const row of rows) {
    if (!knownHsTaxProfile(row) || !HS_TAX_FIELDS.every(k => number(row[k])) || typeof row.bic !== 'boolean' || typeof row.mercurialis !== 'boolean') return fail('HS_TAX_PROFILE_UNKNOWN');
    const evidence = object(row.tax_evidence);
    if (row.tax_profile_status !== 'verified' || typeof evidence.source_ref !== 'string' || !evidence.source_ref.trim() ||
      typeof evidence.verified_at !== 'string' || !Number.isFinite(Date.parse(evidence.verified_at)) ||
      evidence.basis_version !== HS_TAX_BASIS_VERSION || evidence.exemptions !== 'none' ||
      !Array.isArray(evidence.regime_codes) || !evidence.regime_codes.includes(ctx.regimeCode)) return fail('HS_TAX_EVIDENCE_INCOMPLETE');
    // The existing kernel has no formulas for these fields. Do not claim complete taxation otherwise.
    if (['uemoa', 'tev', 'ta', 't_past', 't_para', 't_ciment', 'ref'].some(k => row[k] !== 0) || row.bic || row.mercurialis) return fail('HS_TAX_BASIS_UNSUPPORTED');
  }
  const signature = (r: TaxRow) => JSON.stringify([...HS_TAX_FIELDS.map(k => r[k]), r.bic, r.mercurialis]);
  if (rows.some(r => signature(r) !== signature(rows[0]))) return fail('HS_TAX_PROFILES_DIFFER');
  // This common fiscal profile has no code/id/description: it cannot masquerade as a chosen HS.
  const common_profile: TaxRow = Object.fromEntries(HS_TAX_FIELDS.map(k => [k, rows[0][k]]));
  return { eligible: true, classification_status: 'to_confirm', validated_hs_code: null,
    candidate_codes: [...codes].sort(), common_profile,
    proof: { basis_version: HS_TAX_BASIS_VERSION, source_digits: ctx.sourceDigits,
      profiles: structuredClone(rows), regime: structuredClone(ctx.regime), transport_mode: ctx.transportMode,
      currency: ctx.currency!, cargo_value: ctx.cargoValue! } };
}

/** Importers must preserve reviewed nomenclature and its unconfirmed taxation. */
export function protectedHsReference(row: TaxRow): boolean {
  const code = String(row.code_normalized ?? row.code ?? '').replace(/\D/g, '');
  return REVIEWED_HS_CODES.includes(code) || Object.keys(object(row.nomenclature_evidence)).length > 0 || row.tax_profile_status === 'unknown';
}
