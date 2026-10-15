import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { equivalentHsTaxation, knownHsTaxProfile, protectedHsReference, HS_TAX_FIELDS, HS_TAX_BASIS_VERSION, type TaxRow, type HsEquivalenceContext } from './hs-tax-profile.ts';

// Entirely synthetic fiscal evidence; these values do not validate a real tariff.
function fixture() {
  const rows: TaxRow[] = ['3004901000', '3004902000', '3004909000'].map(code_normalized => ({
    ...Object.fromEntries(HS_TAX_FIELDS.map(k => [k, 0])), code_normalized, dd: 4, rs: 2, tva: 7,
    bic: false, mercurialis: false, tax_profile_status: 'verified',
    tax_evidence: { source_ref: 'SYNTHETIC-ONLY', verified_at: '2026-01-01T00:00:00Z',
      basis_version: HS_TAX_BASIS_VERSION, exemptions: 'none', regime_codes: ['TEST'] },
  }));
  const regime = { code: 'TEST', is_active: true, ...Object.fromEntries(['dd','stx','rs','tin','tva','cosec','pcs','pcc','tpast','ta','hors_promad','hors_bic'].map(k => [k, true])) };
  const ctx: HsEquivalenceContext = { sourceDigits: '30049099', allowEstimate: true, cargoValue: 12345,
    currency: 'XOF', regimeCode: 'TEST', regime, exemptionsReviewed: true, transportMode: 'aerien' };
  return { rows, ctx };
}
Deno.test('HS equivalence: complete synthetic profiles preserve candidates and never choose a classification', () => {
  const { rows, ctx } = fixture(); const before = JSON.stringify(rows);
  const result = equivalentHsTaxation(rows, 3, ctx); assert(result.eligible);
  assertEquals(result.validated_hs_code, null); assertEquals(result.classification_status, 'to_confirm');
  assertEquals(result.candidate_codes, rows.map(r => r.code_normalized)); assertEquals(result.common_profile.code, undefined);
  assertEquals(result.common_profile.code_normalized, undefined); assertEquals(JSON.stringify(rows), before);
  rows[0].dd = 100; assertEquals(result.proof.profiles[0].dd, 4);
});
for (const field of HS_TAX_FIELDS) Deno.test(`HS equivalence rejects difference/unknown in ${field}`, () => {
  const { rows, ctx } = fixture(); rows[1][field] = 3; assert(!equivalentHsTaxation(rows, 3, ctx).eligible);
  rows[1][field] = null; assert(!equivalentHsTaxation(rows, 3, ctx).eligible);
});
for (const mutation of ['legacy','unknown','no_source','no_basis','no_regime','no_exemptions','bad_date','bic','mercurialis'] as const) {
  Deno.test(`HS equivalence refuses incomplete proof ${mutation}`, () => {
    const { rows, ctx } = fixture(); const evidence = rows[1].tax_evidence as TaxRow;
    if (mutation === 'legacy' || mutation === 'unknown') rows[1].tax_profile_status = mutation;
    if (mutation === 'no_source') delete evidence.source_ref;
    if (mutation === 'no_basis') delete evidence.basis_version;
    if (mutation === 'no_regime') evidence.regime_codes = [];
    if (mutation === 'no_exemptions') delete evidence.exemptions;
    if (mutation === 'bad_date') evidence.verified_at = 'unknown';
    if (mutation === 'bic' || mutation === 'mercurialis') rows[1][mutation] = true;
    assert(!equivalentHsTaxation(rows, 3, ctx).eligible);
  });
}
Deno.test('HS equivalence rejects truncated, duplicate, unrelated and missing candidates', () => {
  const { rows, ctx } = fixture();
  for (const count of [null, 2, 4]) assert(!equivalentHsTaxation(rows, count, ctx).eligible);
  assert(!equivalentHsTaxation([rows[0]], 1, ctx).eligible);
  rows[1].code_normalized = rows[0].code_normalized; assert(!equivalentHsTaxation(rows, 3, ctx).eligible);
  rows[1].code_normalized = '9999990000'; assert(!equivalentHsTaxation(rows, 3, ctx).eligible);
});
Deno.test('HS equivalence rejects unknown valuation, regime, exemption or non-explicit mode', () => {
  const { rows, ctx } = fixture();
  for (const change of [{ cargoValue: undefined }, { cargoValue: 0 }, { currency: '' }, { regime: null },
    { regime: { ...ctx.regime, tva: null } }, { exemptionsReviewed: false }, { exemptionTitle: 'PENDING' },
    { allowEstimate: false }, { sourceDigits: '3004909000' }, { transportMode: 'unknown' }]) {
    assert(!equivalentHsTaxation(rows, 3, { ...ctx, ...change }).eligible);
  }
});
Deno.test('HS zero is known; null, NaN, negative, absent and unknown evidence are not zero', () => {
  const { rows } = fixture(); assert(knownHsTaxProfile(rows[0]));
  for (const value of [null, undefined, NaN, -1, '0']) assert(!knownHsTaxProfile({ ...rows[0], dd: value }));
  assert(!knownHsTaxProfile({ ...rows[0], tax_profile_status: 'unknown' }));
  assert(protectedHsReference({ nomenclature_evidence: { source_ref: 'fixture' } }));
  assert(protectedHsReference({ tax_profile_status: 'unknown' })); assert(!protectedHsReference({}));
});
