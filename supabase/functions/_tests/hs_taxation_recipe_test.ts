import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { HS_TAX_FIELDS, HS_TAX_BASIS_VERSION, type TaxRow } from '../_shared/hs-tax-profile.ts';
import { classifyClientLine } from '../_shared/client-quote-projection.ts';
import { customsBasisSnapshot } from '../_shared/customs-basis.ts';
import { syntheticCustoms } from './customs-basis-fixture.ts';
const flag = Deno.env.get('QUOTATION_ENGINE_DISABLE_SERVE');
Deno.env.set('QUOTATION_ENGINE_DISABLE_SERVE', '1');
const { generateQuotationLines } = await import('../quotation-engine/index.ts');
if (flag === undefined) Deno.env.delete('QUOTATION_ENGINE_DISABLE_SERVE'); else Deno.env.set('QUOTATION_ENGINE_DISABLE_SERVE', flag);

// A synthetic in-memory database boundary exercises the actual production formulas.
function fixture() {
  const profiles: TaxRow[] = ['3004901000','3004902000','3004909000'].map(code_normalized => ({
    ...Object.fromEntries(HS_TAX_FIELDS.map(k => [k, 0])), code: code_normalized, code_normalized,
    dd: 4, rs: 2, tva: 7, bic: false, mercurialis: false, tax_profile_status: 'verified',
    tax_evidence: { source_ref: 'SYNTHETIC-NOT-A-REAL-TARIFF', verified_at: '2026-01-01',
      basis_version: HS_TAX_BASIS_VERSION, exemptions: 'none', regime_codes: ['TEST'] },
  }));
  const regime = { code: 'TEST', name: 'Synthetic', is_active: true, ...Object.fromEntries(
    ['dd','stx','rs','tin','tva','cosec','pcs','pcc','tpast','ta'].map(k => [k, true])), hors_promad: false, hors_bic: false };
  const tables: Record<string, TaxRow[]> = { hs_codes: profiles, customs_regimes: [regime],
    quote_cases: [{ id:'fixture-case', request_type:'AIR_IMPORT' }], quote_request_lines: [],
    case_timeline_events: [{ case_id:'fixture-case', event_type:'service_scope_v1', actor_type:'operator',
      event_data:{ freight_scope:false, customs_scope:true, request_evidence:{ mode:'destination' } } }],
    quote_facts: [{ case_id:'fixture-case', is_current:true, fact_key:'service.package', value_text:'AIR_IMPORT_DDP' }],
  };
  const state = { fail: '', countDelta: 0, writes: 0 };
  function from(table: string) {
    let selected = [...(tables[table] ?? [])], single = false, max = Infinity;
    const query = {
      select: (_fields?: string, _options?: unknown) => query,
      eq: (key: string, value: unknown) => { selected = selected.filter(r => r[key] === value); return query; },
      in: (key: string, values: unknown[]) => { selected = selected.filter(r => values.includes(r[key])); return query; },
      like: (key: string, value: string) => { selected = selected.filter(r => String(r[key]).startsWith(value.replace(/%$/, ''))); return query; },
      or: (value: string) => { selected = selected.filter(r => value.split(',').some(term => { const [key,,v] = term.split('.'); return r[key] === v; })); return query; },
      gte: () => query, lte: () => query, gt: () => query, lt: () => query, is: () => query,
      contains: () => query, ilike: () => query, not: () => query,
      order: () => query, limit: (n: number) => { max = n; return query; },
      maybeSingle: () => { single = true; return query; }, single: () => { single = true; return query; },
      then: (resolve: (v: unknown) => void) => resolve({ data: state.fail === table ? null : single ? selected[0] ?? null : selected.slice(0, max),
        count: selected.length + state.countDelta, error: state.fail === table ? { message: 'Synthetic read failure' } : null }),
    };
    return query;
  }
  const request = { finalDestination: 'Dakar', transportMode: 'aerien' as 'aerien' | 'maritime' | 'routier', incoterm: 'DDP', cargoType: 'general',
    cargoValue: 100000, cargoCurrency: 'XOF', hsCode: '30049099', regimeCode: 'TEST',
    hsEstimate: { enabled: true, exemptionsReviewed: true, caseId:'fixture-case' } };
  return { profiles, request, state, tables, client: { from } };
}
type Fixture = ReturnType<typeof fixture>;
Deno.test('Customs explicit CAF uses unchanged real kernel formulas without adding non-XOF freight or default insurance',async()=>{
 const f=fixture(),b=syntheticCustoms();b.context.profiles=f.profiles;b.context.regimes=f.tables.customs_regimes;
 const basis=customsBasisSnapshot(b.record,b.context),request={...f.request,hsCode:basis.decision.hs_digits,hsEstimate:undefined,freightAmount:999999,freightCurrency:'UNSUPPORTED-TEST-CURRENCY'};
 const result=await generateQuotationLines(f.client,request,basis),line=result.lines.find(l=>l.id==='duties_total');assert(line);assertEquals(line.amount,13420);
 assertEquals(result.dutyBreakdown[0].caf,100000);assertEquals(f.state.writes,0);
});
async function calculate(f: Fixture) {
  const output = await generateQuotationLines(f.client, f.request);
  const line = output.lines.find(l => l.id === 'duties_total'); assert(line, 'Actual customs output missing');
  return { output, line };
}
Deno.test('HS production kernel: equivalent synthetic profiles quote without choosing HS10, unchanged formulas and estimate provenance', async () => {
  const f = fixture(), before = JSON.stringify(f.profiles);
  const { line, output } = await calculate(f); assert(typeof line.amount === 'number' && line.amount > 0);
  assertEquals(line.source.type, 'CALCULATED'); assertEquals(classifyClientLine(line, line).status, 'estimated');
  assertEquals(output.dutyBreakdown[0].hs_code, '30049099');
  assertEquals((output.dutyBreakdown[0] as unknown as TaxRow).validated_hs_code, null);
  const proof = (line.source as unknown as TaxRow).hs_tax_equivalence as TaxRow;
  assertEquals(proof.candidate_codes, f.profiles.map(r => r.code_normalized));
  const exact = fixture(); exact.request.hsCode = '3004909000'; exact.request.hsEstimate.enabled = false;
  assertEquals((await calculate(exact)).line.amount, line.amount, 'Same existing formulas must give the same result');
  assertEquals(JSON.stringify(f.profiles), before); assertEquals(f.state.writes, 0);
});
for (const key of ['dd','rs','surtaxe','tin','t_conj','pcs','pcc','cosec','tva']) {
  Deno.test(`HS production kernel: missing ${key} reserves taxes rather than using zero`, async () => {
    const f = fixture(); f.request.hsCode = '3004902000'; f.request.hsEstimate.enabled = false; f.profiles[1][key] = null;
    const { line, output } = await calculate(f); assertEquals(line.amount, null); assertEquals(line.source.type, 'TO_CONFIRM');
    assertEquals(output.dutyBreakdown, []);
  });
}
Deno.test('HS production kernel: unknown status with retained numeric rates is still unknown', async () => {
  const f = fixture(); f.request.hsCode = '3004901000'; f.request.hsEstimate.enabled = false; f.profiles[0].tax_profile_status = 'unknown';
  assertEquals((await calculate(f)).line.amount, null);
});
Deno.test('HS production kernel: one unknown article cannot produce a deceptively complete partial customs total', async () => {
  const f = fixture(); f.request.hsCode = '3004901000,3004902000'; f.request.hsEstimate.enabled = false; f.profiles[1].dd = null;
  const { line, output } = await calculate(f); assertEquals(line.amount, null); assertEquals(output.dutyBreakdown, []);
});
Deno.test('HS production kernel: a real known zero remains zero in the legacy exact path', async () => {
  const f = fixture(); f.request.hsCode = '3004909000'; f.request.hsEstimate.enabled = false;
  for (const k of HS_TAX_FIELDS) f.profiles[2][k] = 0;
  f.profiles[2].tax_profile_status = 'legacy';
  const { line, output } = await calculate(f); assertEquals(line.amount, 0); assertEquals(output.dutyBreakdown[0].dd_rate, 0);
});
for (const reason of ['different_pcs','legacy','regime','exemption','truncated','read_error','opt_out']) {
  Deno.test(`HS production kernel refuses insufficient equivalence: ${reason}`, async () => {
    const f = fixture();
    if (reason === 'different_pcs') f.profiles[1].pcs = 9;
    if (reason === 'legacy') f.profiles[1].tax_profile_status = 'legacy';
    if (reason === 'regime') f.request.regimeCode = 'UNKNOWN';
    if (reason === 'exemption') f.request.hsEstimate.exemptionsReviewed = false;
    if (reason === 'truncated') f.state.countDelta = 1;
    if (reason === 'read_error') f.state.fail = 'hs_codes';
    if (reason === 'opt_out') f.request.hsEstimate.enabled = false;
    const { line } = await calculate(f); assertEquals(line.amount, null); assertEquals(line.source.type, 'TO_CONFIRM');
  });
}

for (const scope of ['maritime','routier','DAP','multi-lot','freight','one-legacy-candidate']) Deno.test(`HS production estimate remains inside authorized scope: ${scope}`, async () => {
  const f = fixture();
  if (scope === 'maritime' || scope === 'routier') f.request.transportMode = scope;
  if (scope === 'DAP') f.request.incoterm = 'DAP';
  if (scope === 'multi-lot') f.tables.quote_request_lines = [{ case_id:'fixture-case' },{ case_id:'fixture-case' }];
  if (scope === 'freight') f.tables.case_timeline_events[0].event_data = { freight_scope:true, customs_scope:true };
  if (scope === 'one-legacy-candidate') { f.profiles.splice(1); f.profiles[0].tax_profile_status = 'legacy'; }
  assertEquals((await calculate(f)).line.amount, null);
});
