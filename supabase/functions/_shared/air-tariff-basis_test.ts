import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { fullAirFixture } from './air-tariff_test.ts';
import { resolveAirTariff } from './air-tariff.ts';
import { airFixture } from './air-handling_test.ts';
import { resolveAirHandling } from './air-handling.ts';
import { assertAirHandlingFresh } from './air-handling-store.ts';
import historicalV2 from './fixtures/air-tariff-v2-before.json' with {type:'json'};
import type { AirResolution } from './air-handling.ts';
const date='2026-10-19';
Deno.test('catalogue basis: a validated taxable weight never supplies an unspecified collection or security basis',()=>{
 const s=fullAirFixture(),before=JSON.stringify(s);s.basis!.ordinary_storage.enabled=false;
 const r=resolveAirTariff(s,date)!;
 for(const code of ['collection_per_kg','security_per_kg']){const c=r.components.find(c=>c.code===code)!;assertEquals(c.supplier_ht_xof,null);assertEquals(c.quantity,null);assert(c.reason?.includes('brut ou taxable'));}
 assertEquals(r.supplier_known_ht_xof,32500);assertEquals(r.supplier_complete_ht_xof,null);
 s.basis!.ordinary_storage.enabled=true;assertEquals(JSON.stringify(s),before);
});
Deno.test('catalogue basis: an unknown weighted rate is isolated from fixed charges and cannot create a full total',()=>{
 for(const change of [{value:null},{minimum:1},{unit:'XOF'},{qualification:'ambiguous'}]){
 const s=fullAirFixture();s.facts=[];s.basis!.ordinary_storage.enabled=false;Object.assign(s.catalogue!.payload.entries.find(e=>e.key==='collection_0')!,change);
 const r=resolveAirTariff(s,date)!;assertEquals(r.components.find(c=>c.code==='documents')!.supplier_ht_xof,25000);
 assertEquals(r.components.find(c=>c.code==='it')!.supplier_ht_xof,1500);assertEquals(r.components.find(c=>c.code==='warehouse_passage')!.supplier_ht_xof,6000);
 assertEquals(r.supplier_known_ht_xof,32500);assertEquals(r.supplier_complete_ht_xof,null);assertEquals(r.supplier_ttc_xof,null);assertEquals(r.selling_amount_xof,null);
 }
});
Deno.test('catalogue basis: documented fixed fees invariant across source columns do not need a taxable weight or DMS admission',()=>{
 const s=fullAirFixture();s.facts=[];s.basis!.warehouse_bracket_confirmed=false;s.basis!.ordinary_storage.enabled=false;
 const r=resolveAirTariff(s,date)!;assertEquals(r.supplier_known_ht_xof,26500);
 assertEquals(r.components.find(c=>c.code==='warehouse_passage')!.supplier_ht_xof,null);
 const changed=structuredClone(s);changed.catalogue!.payload.entries.find(e=>e.key==='it_1')!.value=2000;
 assertEquals(resolveAirTariff(changed,date)!.components.find(c=>c.code==='it')!.supplier_ht_xof,null);
 const conditional=structuredClone(s);const e=conditional.catalogue!.payload.entries.find(e=>e.key==='doc_DME_0')!;e.condition=e.source.calculation_condition='Only refrigerated cargo';
 assertEquals(resolveAirTariff(conditional,date)!.components.find(c=>c.code==='documents')!.supplier_ht_xof,null);
});
Deno.test('catalogue basis: unrelated taxable1000plus does not choose a warehouse bracket for v2',()=>{
 const s=fullAirFixture();s.facts[0].value_number=1200;s.basis!.ordinary_storage.enabled=false;
 assertEquals(resolveAirTariff(s,date)!.components.find(c=>c.code==='warehouse_passage')!.supplier_ht_xof,6000);
 s.basis!.warehouse_bracket_confirmed=false;assertEquals(resolveAirTariff(s,date)!.components.find(c=>c.code==='warehouse_passage')!.supplier_ht_xof,null);
});
Deno.test('catalogue basis: missing category, stale context, date or scope reserves even independent fees',()=>{
 for(const field of ['category','context','date','scope','lots']){
 const s=fullAirFixture();if(field==='category')s.basis!.general_cargo_confirmed=false;if(field==='context')s.context_hash='changed';
 if(field==='scope')s.request_type='AIR_EXPORT';if(field==='lots')s.lot_count=2;
 const r=resolveAirTariff(s,field==='date'?'2026-10-15':date)!;assertEquals(r.supplier_known_ht_xof,null);assertEquals(r.supplier_complete_ht_xof,null);
 }
});
Deno.test('catalogue basis: the historical profile keeps byte-equivalent evidence and all three confirmed examples',()=>{
 for(const [kg,total] of [[64,34420],[545,48850],[268,40540]]){
 const s=airFixture();s.facts[0].value_number=kg;
 assertEquals(resolveAirTariff(s,date),resolveAirHandling(s,date));assertEquals(resolveAirTariff(s,date)!.supplier_complete_ht_xof,total);
 }
});
Deno.test('catalogue basis: fresh v1 and new v2 receipts pass, a prior v2 taxable receipt is retained but refused as a fresh run result',async()=>{
 const historical=airFixture(),legacy=resolveAirHandling(historical,date)!,old=JSON.stringify(legacy);
 await assertAirHandlingFresh({rpc:async()=>({data:historical,error:null})},'synthetic-case',[{source:{air_handling:legacy}}]);assertEquals(JSON.stringify(legacy),old);
 const s=fullAirFixture(),current=resolveAirTariff(s,date)!;
 await assertAirHandlingFresh({rpc:async()=>({data:s,error:null})},'synthetic-case',[{source:{air_handling:current}}]);
 // Old v2 inherited the LTA profile. This frozen synthetic receipt must not be
 // accepted as a calculation of the newly reserved catalogue charges.
 const prior=structuredClone(historicalV2.resolution) as unknown as AirResolution,saved=JSON.stringify(prior);
 await assertRejects(()=>assertAirHandlingFresh({rpc:async()=>({data:s,error:null})},'synthetic-case',[{source:{air_handling:prior}}]),Error,'AIR_HANDLING_CONTEXT_CHANGED');
 assertEquals(JSON.stringify(prior),saved);
});

