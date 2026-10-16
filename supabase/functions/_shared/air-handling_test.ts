import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { resolveAirHandling, validAirRates, type AirState } from './air-handling.ts';
import { assertAirHandlingFresh } from './air-handling-store.ts';

// Anonymized document observations, supplied by two parent readers. No client identity or LTA is committed.
export function airFixture(): AirState {
  return { selection: { id: 'selected-v1', profile_id: 'profile-v1', context_hash: 'facts-v1', source_reference: 'Synthetic documentary attestation', warehouse_bracket_confirmed: true },
    profile: { id: 'profile-v1', revision: 1, supplier: '2AS', airport: 'DSS', direction: 'IMPORT', cargo_class: 'GENERAL_CARGO', effective_from: '2026-10-16', effective_to: null,
      rates: { collection_per_kg: 20, security_per_kg: 10, documents: 25000, warehouse_passage: 6000, it: 1500 },
      source_reference: 'Synthetic transcription of supplied supplier grid; current confirmation 2026-10-16', evidence: { kind: 'test-only' } },
    context_hash: 'facts-v1', request_type: 'AIR_IMPORT', lot_count: 0,
    facts: [{ fact_key: 'cargo.chargeable_weight_kg', value_number: 64, source_type: 'operator', is_validated: true }] };
}
for (const [name, gross, taxable, collection, security, ht, observedTtc] of [
  ['A',35.52,64,1280,640,34420,40345], ['B',545,545,10900,5450,48850,57370], ['C',175.77,268,5360,2680,40540,47565],
] as const) Deno.test(`AIR_HANDLING example ${name}: confirmed HT; observed TTC is not an inferred tax rule`, () => {
  const s = airFixture(); s.facts[0].value_number = taxable;
  s.facts.push({ fact_key: 'cargo.weight_kg', value_number: gross, source_type: 'lta' });
  if (name === 'B') s.facts.push({ fact_key: 'cargo.weight_kg', value_number: 520, source_type: 'invoice' });
  const before = JSON.stringify(s), r = resolveAirHandling(s, '2026-10-16')!;
  assertEquals(r.components[0].supplier_ht_xof, collection); assertEquals(r.components[1].supplier_ht_xof, security);
  assertEquals(r.supplier_complete_ht_xof, ht); assertEquals(r.supplier_known_ht_xof, ht);
  assertEquals(r.supplier_tax_xof, null); assertEquals(r.supplier_ttc_xof, null); assertEquals(r.selling_amount_xof, null);
  assert(observedTtc > ht); // Documentary observation is deliberately NOT returned by the resolver.
  assertEquals(JSON.stringify(s), before, 'No facts or contradictory sources overwritten');
});
for (const [name, mutate] of [
  ['unknown taxable', (s: AirState) => { s.facts=[]; }],
  ['gross only', (s: AirState) => { s.facts[0].fact_key='cargo.weight_kg'; }],
  ['unvalidated extracted taxable', (s: AirState) => { s.facts[0].source_type='email_body'; s.facts[0].is_validated=false; }],
  ['duplicate taxable', (s: AirState) => { s.facts.push({...s.facts[0], value_number:65}); }],
  ['zero taxable', (s: AirState) => { s.facts[0].value_number=0; }],
  ['negative taxable', (s: AirState) => { s.facts[0].value_number=-1; }],
  ['non finite taxable', (s: AirState) => { s.facts[0].value_number=Infinity; }],
  ['1 tonne boundary', (s: AirState) => { s.facts[0].value_number=1000; }],
  ['higher bracket', (s: AirState) => { s.facts[0].value_number=1500; }],
] as const) Deno.test(`AIR_HANDLING ${name}: KG costs reserved without gross/volumetric substitution`, () => {
  const s=airFixture(); mutate(s); const r=resolveAirHandling(s,'2026-10-16')!;
  assertEquals(r.components[0].supplier_ht_xof,null); assertEquals(r.components[1].supplier_ht_xof,null);
  assertEquals(r.supplier_complete_ht_xof,null); assertEquals(r.selling_amount_xof,null);
});
for (const [name, mutate] of [
  ['stale facts',(s:AirState)=>{s.context_hash='facts-v2';}],
  ['wrong profile',(s:AirState)=>{s.profile!.id='other';}],
  ['wrong provider',(s:AirState)=>{s.profile!.supplier='other';}],
  ['fridge not inferred from medicines',(s:AirState)=>{s.profile!.cargo_class='FRIDGE';}],
  ['export',(s:AirState)=>{s.request_type='AIR_EXPORT';}],
  ['sea',(s:AirState)=>{s.request_type='SEA_FCL';}],
  ['multi lot',(s:AirState)=>{s.lot_count=2;}],
  ['expired',(s:AirState)=>{s.profile!.effective_to='2026-10-15';}],
  ['future',(s:AirState)=>{s.profile!.effective_from='2026-10-17';}],
] as const) Deno.test(`AIR_HANDLING ${name}: fail closed and no numeric zero`,()=>{
  const s=airFixture(); mutate(s); const r=resolveAirHandling(s,'2026-10-16')!;
  assert(r.components.every(c=>c.supplier_ht_xof===null)); assertEquals(r.supplier_known_ht_xof,null);
});
Deno.test('AIR_HANDLING warehouse eligibility is explicit, never inferred from a weight',()=>{
  const s=airFixture(); s.selection!.warehouse_bracket_confirmed=false;
  const r=resolveAirHandling(s,'2026-10-16')!; assertEquals(r.components[3].supplier_ht_xof,null);
  assertEquals(r.supplier_complete_ht_xof,null); assertStringIncludes(r.components[3].reason!,'attester');
});
Deno.test('AIR_HANDLING disabled or absent selection preserves unrelated paths',()=>{
  const s=airFixture();s.selection=null;assertEquals(resolveAirHandling(s,'2026-10-16'),null);
  s.selection={...airFixture().selection!,profile_id:null};assertEquals(resolveAirHandling(s,'2026-10-16'),null);
});
Deno.test('AIR_HANDLING does not import spreadsheet formulas, undocumented taxes or storage hypotheses',()=>{
  const r=resolveAirHandling(airFixture(),'2026-10-16')!;
  for(const word of ['Magasinage','TVA','ANACIM','Timbre','Vente']) assert(r.reserves.some(v=>v.includes(word)));
  for(const storage of [12800,21800,69680]) assert(!r.components.some(c=>c.supplier_ht_xof===storage));
  assertEquals(validAirRates({...airFixture().profile!.rates, collection_per_kg:-1}),false);
  assertEquals(validAirRates({...airFixture().profile!.rates, tax:18}),false);
});
Deno.test('AIR_HANDLING freshness includes pinned profile, selection and all component evidence',async()=>{
  const s=airFixture(), r=resolveAirHandling(s,new Date().toISOString().slice(0,10))!;
  const client={rpc:()=>Promise.resolve({data:s,error:null})};
  await assertAirHandlingFresh(client,'case',[{source:{air_handling:r}}]);
  s.selection!.id='new-selection';let rejected=false;
  try{await assertAirHandlingFresh(client,'case',[{source:{air_handling:r}}]);}catch{rejected=true;}assert(rejected);
});
