import { describe, expect, it } from 'vitest';
import { commercialPreparationSummary, parseCommercialAmount, prepareCommercialQuote, reviseCommercialPreparation, type CommercialAction, type CommercialPreparation } from './commercialPreparation';
import { airTariffSeed } from '../../supabase/functions/_shared/air-tariff-seed';
import { resolveAirTariff, type AirTariffState } from '../../supabase/functions/_shared/air-tariff';
import { airHandlingSource } from '../../supabase/functions/_shared/air-handling';

function fixture() {
  const air: AirTariffState = {
    profile: null, request_type: 'AIR_IMPORT', lot_count: 0, context_hash: 'fixture-context',
    selection: { id: 'fixture-selection', profile_id: null, context_hash: 'fixture-context', source_reference: 'Synthetic explicit source', warehouse_bracket_confirmed: true },
    catalogue: { id: 'fixture-catalogue', parent_id: null, revision: 1, effective_from: '2026-10-16', effective_to: null, source_reference: 'Synthetic catalogue', payload: structuredClone(airTariffSeed) },
    basis: { general_cargo_confirmed: true, warehouse_bracket_confirmed: true, ordinary_storage: { enabled: false, tariff_key: 'storage_0', weight_fact_id: null, billable_days: null, days_status: 'unknown', source_reference: '' } },
    facts: [{ id: 'fixture-taxable', fact_key: 'cargo.chargeable_weight_kg', value_number: 64, is_validated: true }],
  };
  const snapshot = { raw_lines: [
    { category: 'AIR_HANDLING', label: 'Handling', amount: null, source: airHandlingSource(resolveAirTariff(air, '2026-10-17')!) },
    { category: 'AGENCY', label: 'Honoraires', amount: 200000, source: { type: 'fee_rule' } },
    { category: 'CUSTOMS_RESERVE', label: 'Droits et taxes', amount: 0, type: 'provisional_reserve', source: { type: 'TO_CONFIRM' } },
  ], totals: { currency: 'XOF', subtotal_before_sodatra_vat: 200000, honoraires_tva: 36000, total_payable: 236000 } };
  return { air, snapshot, draft: prepareCommercialQuote('fixture-case', 'fixture-version', snapshot) };
}
function change(draft: CommercialPreparation, action: CommercialAction, extra = {}) {
  return reviseCommercialPreparation(draft, action, { expected_revision: draft.revision, operation_id: `fixture-op-${draft.revision + 1}`, actor_id: 'fixture-operator', occurred_at: '2026-10-17T10:00:00Z', ...extra });
}
const reason = 'Décision opérateur pour ce seul dossier fictif';
const storageAdd: CommercialAction = { type: 'add', line_id: 'operator:storage', label: 'Magasinage estimé', kind: 'storage_estimate', amount: null, basis: 'unknown', reason };
const storageEstimate: CommercialAction = { type: 'storage', line_id: 'operator:storage', tariff_key: 'storage_0', weight_fact_id: 'fixture-taxable', billable_days: 2, reason };

describe('Commercial preparation, isolated from canonical prices', () => {
  it('exposes purchase34420 without making it a client charge or treating the customs sentinel0 as free', () => {
    const { draft } = fixture();
    expect(draft.lines[0].supplier?.amount_ht_xof).toBe(34420);
    expect(draft.lines[0].client_amount_xof).toBeNull();
    expect(draft.lines[1].client_amount_xof).toBe(200000);
    expect(draft.lines[2].client_amount_xof).toBeNull();
    expect(commercialPreparationSummary(draft).unpriced_lines).toBe(2);
  });
  it('retains an independent estimated customer price and complete unchanged source snapshot/catalogue', () => {
    const { draft, snapshot, air } = fixture(), before = structuredClone({ draft, snapshot, air });
    const next = change(draft, { type: 'edit', line_id: 'source:0', amount: 40000, basis: 'before_sodatra_vat', reason });
    expect(next.lines[0]).toMatchObject({ client_amount_xof: 40000, status: 'estimated', supplier: { amount_ht_xof: 34420 } });
    expect(next.source_snapshot).toEqual(snapshot);
    expect(next.events[0]).toMatchObject({ actor_id: 'fixture-operator', before: { client_amount_xof: null }, after: { client_amount_xof: 40000 }, action: { reason } });
    expect({ draft, snapshot, air }).toEqual(before);
  });
  it('permits a customs operator provision despite unknown HS and other unpriced lines without validating tax rates', () => {
    const { draft } = fixture();
    const next = change(draft, { type: 'add', line_id: 'operator:customs', label: 'Provision douane', kind: 'customs_estimate', amount: 150000, basis: 'taxes_included', reason });
    expect(next.lines[next.lines.length - 1]).toMatchObject({ kind: 'customs_estimate', status: 'estimated', client_amount_xof: 150000, supplier: null });
    expect(next.lines[2].client_amount_xof).toBeNull();
    expect(commercialPreparationSummary(next)).toMatchObject({ taxes_included: 150000, unpriced_lines: 2, firm: false });
    expect(next.source_snapshot).toEqual(draft.source_snapshot);
  });
  it('records removal/restoration without deleting the source or prior decisions', () => {
    const { draft } = fixture(); const removed = change(draft, { type: 'remove', line_id: 'source:1', reason });
    expect(removed.lines).toHaveLength(3); expect(removed.lines[1].included).toBe(false);
    expect(commercialPreparationSummary(removed).basis_unknown).toBeNull();
    const restored = change(removed, { type: 'restore', line_id: 'source:1', reason });
    expect(restored.lines[1].client_amount_xof).toBe(200000); expect(restored.events).toHaveLength(2);
    expect(removed.lines[1].included).toBe(false); expect(draft.lines[1].included).toBe(true);
  });
  it('accepts zero only as an explicit decision, not from blank input', () => {
    expect(parseCommercialAmount('')).toBeNull(); expect(parseCommercialAmount('   ')).toBeNull(); expect(parseCommercialAmount('0')).toBe(0);
    const next = change(fixture().draft, { type: 'edit', line_id: 'source:0', amount: 0, basis: 'taxes_included', reason });
    expect(next.lines[0]).toMatchObject({ client_amount_xof: 0, status: 'estimated' });
    expect(commercialPreparationSummary(next).taxes_included).toBe(0);
  });
  it('parses French decimal amounts without truncation and rejects partial/negative/exponential/non-finite input', () => {
    expect(parseCommercialAmount('1\u202f420,8')).toBe(1420.8);
    for (const value of ['12abc', '-1', '1e3', 'NaN', 'Infinity', '1,2.3', '1000000000000']) expect(() => parseCommercialAmount(value)).toThrow();
  });
  it('requires a customer amount basis/reason and rejects invalid values without changing the draft', () => {
    const { draft } = fixture(), before = structuredClone(draft);
    for (const amount of [-1, Infinity, NaN, 1e12]) expect(() => change(draft, { type: 'edit', line_id: 'source:0', amount, basis: 'before_sodatra_vat', reason })).toThrow();
    expect(() => change(draft, { type: 'edit', line_id: 'source:0', amount: 500, basis: 'unknown', reason })).toThrow(/Base/);
    expect(() => change(draft, { type: 'remove', line_id: 'source:0', reason: '' })).toThrow(/Justification/);
    expect(draft).toEqual(before);
  });
  it('keeps pre-VAT and taxes-included amounts in separate buckets and never claims a validated payable', () => {
    const first = change(fixture().draft, { type: 'edit', line_id: 'source:0', amount: 40000, basis: 'before_sodatra_vat', reason });
    const next = change(first, { type: 'add', line_id: 'operator:provision', label: 'Provision', kind: 'additional', amount: 7000, basis: 'taxes_included', reason });
    const summary = commercialPreparationSummary(next);
    expect(summary).toMatchObject({ before_sodatra_vat: 40000, taxes_included: 7000, basis_unknown: 200000, firm: false });
    expect(summary).not.toHaveProperty('total_payable');
  });
  it('bounds additions and rejects missing targets and reserved source identifiers', () => {
    const { draft } = fixture();
    expect(() => change(draft, { ...storageAdd, line_id: 'source:8' })).toThrow(/Ajout/);
    expect(() => change(draft, { type: 'edit', line_id: 'foreign:line', amount: 3, basis: 'taxes_included', reason })).toThrow(/absente/);
    const full = { ...draft, lines: Array.from({ length: 100 }, (_, i) => ({ ...draft.lines[0], id: `source:${i}` })) };
    expect(() => change(full, storageAdd)).toThrow(/Ajout/);
  });
  it('rejects stale changes/conflicting operation reuse and deduplicates an exact retry', () => {
    const { draft } = fixture(); const action: CommercialAction = { type: 'edit', line_id: 'source:0', amount: 40000, basis: 'before_sodatra_vat', reason };
    const next = change(draft, action);
    expect(change(next, action, { expected_revision: 0, operation_id: 'fixture-op-1' })).toEqual(next);
    expect(() => change(next, { ...action, amount: 50000 }, { operation_id: 'fixture-op-1' })).toThrow(/réutilisée/);
    expect(() => change(next, action, { expected_revision: 0 })).toThrow(/révision/);
    expect(() => change(next, action, { operation_id: 'fixture-op-1', actor_id: 'other-operator' })).toThrow(/réutilisée/);
  });
  it('reuses catalogue resolution64kg×20×2=2560, retaining full provenance and an independent price decision', () => {
    const { draft, air } = fixture(), original = structuredClone(air); const added = change(draft, storageAdd);
    const estimated = change(added, storageEstimate, { air, air_case_id: 'fixture-case' });
    const last = estimated.lines[estimated.lines.length - 1];
    expect(last).toMatchObject({ client_amount_xof: null, status: 'to_confirm', supplier: { amount_ht_xof: 2560, status: 'estimated' } });
    expect((last.supplier?.evidence as { catalogue: { payload: { entries: unknown[] } } }).catalogue.payload.entries).toHaveLength(180);
    expect(air).toEqual(original);
    const retained = change(estimated, { type: 'edit', line_id: 'operator:storage', amount: 3000, basis: 'before_sodatra_vat', reason });
    expect(retained.lines[retained.lines.length - 1]).toMatchObject({ client_amount_xof: 3000, status: 'estimated', supplier: { amount_ht_xof: 2560 } });
    const revised = change(retained, { ...storageEstimate, billable_days: 3 }, { air, air_case_id: 'fixture-case' });
    expect(revised.lines[revised.lines.length - 1]).toMatchObject({ client_amount_xof: null, supplier: { amount_ht_xof: 3840 } });
    expect(retained.lines[retained.lines.length - 1].client_amount_xof).toBe(3000);
  });
  it('keeps unknown storage days/weight null while another line can still be prepared', () => {
    const { draft, air } = fixture(); air.facts[0].is_validated = false;
    const next = change(change(draft, storageAdd), { ...storageEstimate, billable_days: null }, { air, air_case_id: 'fixture-case' });
    expect(next.lines[next.lines.length - 1].supplier?.amount_ht_xof).toBeNull();
    const other = change(next, { type: 'edit', line_id: 'source:0', amount: 40000, basis: 'before_sodatra_vat', reason });
    expect(other.lines[0].client_amount_xof).toBe(40000); expect(other.lines[other.lines.length - 1].client_amount_xof).toBeNull();
  });
  it('preserves explicit zero storage days as zero estimated cost without inferring a free client line', () => {
    const { draft, air } = fixture();
    const next = change(change(draft, storageAdd), { ...storageEstimate, billable_days: 0 }, { air, air_case_id: 'fixture-case' });
    expect(next.lines[next.lines.length - 1]).toMatchObject({ client_amount_xof: null, supplier: { amount_ht_xof: 0, status: 'estimated' } });
  });
  it('refuses a foreign case/non-storage target and keeps a stale catalogue selection unknown', () => {
    const { draft, air } = fixture(), added = change(draft, storageAdd);
    expect(() => change(added, storageEstimate, { air, air_case_id: 'foreign-case' })).toThrow(/dossier/);
    expect(() => change(added, { ...storageEstimate, line_id: 'source:0' }, { air, air_case_id: 'fixture-case' })).toThrow(/distincte/);
    air.selection!.context_hash = 'stale';
    const stale = change(added, storageEstimate, { air, air_case_id: 'fixture-case' });
    expect(stale.lines[stale.lines.length - 1].supplier?.amount_ht_xof).toBeNull();
  });
  it('refuses unsupported multi-lot input before preparing changes', () => {
    expect(() => prepareCommercialQuote('case', 'version', { is_multi_lot: true, raw_lines: [] })).toThrow(/mono-lot/);
  });
  it('never interprets foreign or unattested amounts as XOF; an explicitly XOF line remains usable', () => {
    const draft = prepareCommercialQuote('case', 'version', { totals: { currency: 'USD' }, raw_lines: [
      { label: 'USD', amount: 100, currency: 'USD', source: { type: 'fee_rule' } },
      { label: 'XOF', amount: 2000, currency: 'XOF', source: { type: 'fee_rule' } },
    ] });
    expect(draft.lines[0]).toMatchObject({ client_amount_xof: null, status: 'to_confirm' });
    expect(draft.lines[0].reason).toContain('USD'); expect(draft.lines[1].client_amount_xof).toBe(2000);
    const missing = prepareCommercialQuote('case', 'version', { raw_lines: [{ amount: 100 }] });
    expect(missing.lines[0].client_amount_xof).toBeNull();
    expect(draft.source_snapshot.raw_lines).toEqual([{ label: 'USD', amount: 100, currency: 'USD', source: { type: 'fee_rule' } }, { label: 'XOF', amount: 2000, currency: 'XOF', source: { type: 'fee_rule' } }]);
  });
  it('rejects a cumulative overflow before replacing the prior valid draft', () => {
    const first = change(fixture().draft, { type: 'edit', line_id: 'source:0', amount: 999999999999, basis: 'taxes_included', reason });
    const before = structuredClone(first);
    expect(() => change(first, { type: 'add', line_id: 'operator:extra', label: 'Extra', kind: 'additional', amount: 1, basis: 'taxes_included', reason })).toThrow(/Somme hors limites/);
    expect(first).toEqual(before); expect(commercialPreparationSummary(first).taxes_included).toBe(999999999999);
  });
  it('rejects an overflowing source before creating a draft that would crash at initial render', () => {
    expect(() => prepareCommercialQuote('case', 'version', { totals: { currency: 'XOF' }, raw_lines: [{ amount: 600000000000 }, { amount: 600000000000 }] })).toThrow(/Somme hors limites/);
  });
  it('pins added storage to the historical AIR catalogue and context despite original=null', () => {
    const { draft, air } = fixture(); const added = change(draft, storageAdd);
    air.catalogue!.id = 'different-catalogue';
    expect(() => change(added, storageEstimate, { air, air_case_id: 'fixture-case' })).toThrow(/Base fournisseur modifiée/);
    expect(added.lines[added.lines.length - 1].supplier).toBeNull();
  });
});
