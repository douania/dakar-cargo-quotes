import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { airTariffSeed } from './air-tariff-seed.ts';
import { resolveAirTariff, validAirCatalogue, type AirTariffState } from './air-tariff.ts';
import { airFixture } from './air-handling_test.ts';
export function fullAirFixture(): AirTariffState {
  const s=airFixture();s.facts[0].id='taxable';s.facts.push({id:'gross',fact_key:'cargo.weight_kg',value_number:35.52,source_type:'operator',is_validated:true});
  return {...s,catalogue:{id:'catalogue-v2',parent_id:null,revision:1,effective_from:'2026-10-16',effective_to:null,source_reference:'Synthetic full catalogue source',payload:structuredClone(airTariffSeed)},
    basis:{general_cargo_confirmed:true,warehouse_bracket_confirmed:true,ordinary_storage:{enabled:true,tariff_key:'storage_0',weight_fact_id:'taxable',billable_days:2,days_status:'confirmed',source_reference:'Synthetic days and weight documentary source'}}};
}
const date='2026-10-16';
Deno.test('AIR catalogue retains all five sheets, 180 records, 54 textual codes and fifteen annex services',()=>{
  assert(validAirCatalogue(airTariffSeed));const e=airTariffSeed.entries;
  assertEquals(e.length,180);assertEquals(new Set(e.map(x=>x.source.sheet)).size,5);
  assertEquals(e.filter(x=>x.section==='Codes de facturation').length,54);assert(e.some(x=>x.code==='0001'&&x.value===10000));assert(e.some(x=>x.code==='0037'&&x.value===950000));
  assertEquals(e.filter(x=>x.section==='Services annexes').length,15);assertEquals(e.find(x=>x.code==='5201')!.minimum,13100);
  assertEquals(e.find(x=>x.key==='pmg_0')!.value,null);assertEquals(e.find(x=>x.key==='stamp_0')!.threshold,100000);
  assertEquals(e.find(x=>x.key==='service_5212')!.value,20);assertEquals(e.find(x=>x.key==='service_5204')!.unit,'XOF/heure commencée/agent');
  const contradictory=e.find(x=>x.key==='frigo_EXPORT_2_entry')!;assertEquals(contradictory.source.raw_cells[2],'1 à 1 000 kg');assertEquals(contradictory.qualification,'ambiguous');
  assertEquals(e.find(x=>x.key==='frigo_IMPORT_0_entry')!.free_hours,48);
});
Deno.test('AIR ordinary storage uses pinned catalogue and explicitly chosen weight and days; supplier cost stays separate',()=>{
  const s=fullAirFixture(),before=JSON.stringify(s),r=resolveAirTariff(s,date)!;
  assertEquals(r.schema_version,2);assertEquals(r.components.at(-1)!.supplier_ht_xof,2560);assertEquals(r.supplier_known_ht_xof,35060);
  assertEquals(r.supplier_ttc_xof,null);assertEquals(r.selling_amount_xof,null);assertEquals(JSON.stringify(s),before);
  s.basis!.ordinary_storage.weight_fact_id='gross';assertEquals(resolveAirTariff(s,date)!.components.at(-1)!.supplier_ht_xof,1420.8000000000002);
  s.catalogue!.payload.entries.find(e=>e.key==='storage_1')!.value=37;s.basis!.ordinary_storage.tariff_key='storage_1';
  s.basis!.ordinary_storage.weight_fact_id='taxable';assertEquals(resolveAirTariff(s,date)!.components.at(-1)!.supplier_ht_xof,4736);
});
for(const status of ['assumed','unknown'] as const) Deno.test(`AIR ${status} days never enter known HT`,()=>{
  const s=fullAirFixture();s.basis!.ordinary_storage.days_status=status;const r=resolveAirTariff(s,date)!;
  assertEquals(r.supplier_known_ht_xof,32500);assertEquals(r.components.at(-1)!.supplier_ht_xof,null);
  assertEquals(r.supplier_estimated_ht_xof,status==='assumed'?2560:null);
});
for(const field of ['weight','days','source','rate','unit','minimum','context','validity','general','export','multi'] as const) Deno.test(`AIR missing/inapplicable ${field} never produces a fictitious storage zero`,()=>{
  const s=fullAirFixture(),b=s.basis!.ordinary_storage,e=s.catalogue!.payload.entries.find(e=>e.key==='storage_0')!;
  if(field==='weight')b.weight_fact_id='absent';if(field==='days')b.billable_days=null;if(field==='source')b.source_reference='';
  if(field==='rate')e.value=null;if(field==='unit')e.unit='XOF';if(field==='minimum')e.minimum=1;
  if(field==='context')s.context_hash='changed';if(field==='validity')s.catalogue!.effective_to='2026-10-15';if(field==='general')s.basis!.general_cargo_confirmed=false;
  if(field==='export')s.request_type='AIR_EXPORT';if(field==='multi')s.lot_count=2;
  assertEquals(resolveAirTariff(s,date)!.components.at(-1)!.supplier_ht_xof,null);
});
Deno.test('AIR explicitly confirmed zero billable days is zero; fractional quantities have no inferred ceiling',()=>{
  const s=fullAirFixture();s.basis!.ordinary_storage.billable_days=0;assertEquals(resolveAirTariff(s,date)!.components.at(-1)!.supplier_ht_xof,0);
  s.basis!.ordinary_storage.billable_days=.5;assertEquals(resolveAirTariff(s,date)!.components.at(-1)!.supplier_ht_xof,640);
});
Deno.test('AIR catalogue edits unsupported minima/units reserve the active core instead of ignoring them',()=>{
  for(const patch of [{minimum:10000},{unit:'XOF'},{qualification:'ambiguous'}]){
    const s=fullAirFixture();Object.assign(s.catalogue!.payload.entries.find(e=>e.key==='collection_0')!,patch);
    assertEquals(resolveAirTariff(s,date)!.components[0].supplier_ht_xof,null);
  }
});
Deno.test('AIR old profiles retain exact legacy resolution without v2 selection',()=>{
  const s=airFixture(),r=resolveAirTariff(s,date)!;assertEquals(r.schema_version,1);assertEquals(r.supplier_known_ht_xof,34420);assertEquals(r.components.length,5);assertEquals(r.catalogue,undefined);
});
Deno.test('AIR documented ordinary storage is independent from an unknown unrelated documentary fee',()=>{
  const s=fullAirFixture();s.catalogue!.payload.entries.find(e=>e.key==='doc_DME_0')!.value=null;
  const r=resolveAirTariff(s,date)!;assertEquals(r.components.at(-1)!.supplier_ht_xof,2560);assertEquals(r.components.find(e=>e.code==='documents')!.supplier_ht_xof,null);
});
