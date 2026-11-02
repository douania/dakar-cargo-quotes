import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { explainPartialKgInputs, explainAirHandlingInputs } from './pricing-input-diagnostic.ts';
import { airTariffSeed } from './air-tariff-seed.ts';
import type { AirTariffState } from './air-tariff.ts';

const date='2026-11-02';
function kgInput():Parameters<typeof explainPartialKgInputs>[0] {
 return {service_key:'TRUCKING',eligibility:{allowProvisional:true,packageKey:'AIR_IMPORT_DDP',requestType:'AIR_IMPORT',lotCount:0,
  serviceKeys:['CUSTOMS_DAKAR','TRUCKING'],scopeEvent:{actor_type:'operator',event_data:{schema_version:1,shipment_type:'import',freight_scope:false,customs_scope:true}}},
  selected_source:{schema_version:1,table:'synthetic_rate_cards',id:'synthetic-rate',validation_status:'unverified',selected_at:date,
   snapshot:{service_key:'TRUCKING',unit:'KG',pricing_mode:'PER_UNIT',source_reference:'Synthetic source, not a business tariff'}},
  quantity_rule:{id:'synthetic-rule',quantity_basis:'KG',requires_fact_key:'cargo.weight_kg'},facts:[]};
}
function profile():AirTariffState {
 return {request_type:'AIR_IMPORT',lot_count:0,context_hash:'synthetic-current',
  selection:{id:'synthetic-selection',profile_id:'synthetic-profile',context_hash:'synthetic-current',warehouse_bracket_confirmed:true,source_reference:'Synthetic selection only'},
  profile:{id:'synthetic-profile',revision:1,supplier:'2AS',airport:'DSS',direction:'IMPORT',cargo_class:'GENERAL_CARGO',effective_from:'2026-01-01',effective_to:null,
   rates:{collection_per_kg:1,security_per_kg:1,documents:1,warehouse_passage:1,it:1},source_reference:'Synthetic fixture, no approved commercial price',evidence:{}},
  facts:[{id:'taxable',fact_key:'cargo.chargeable_weight_kg',value_number:80,source_type:'operator',is_validated:true}]};
}
function catalogue():AirTariffState {
 return {...profile(),catalogue:{id:'synthetic-catalogue',parent_id:null,revision:1,effective_from:'2026-01-01',effective_to:null,
  source_reference:'Fixture using the already versioned catalogue contract',payload:structuredClone(airTariffSeed)},
  basis:{general_cargo_confirmed:true,warehouse_bracket_confirmed:true,ordinary_storage:{enabled:true,tariff_key:'storage_0',weight_fact_id:'taxable',billable_days:2,days_status:'confirmed',source_reference:'Synthetic duration justification'}}};
}
const weight=(key='cargo.weight_kg',value=104)=>({id:'weight',fact_key:key,value_number:value,source_type:'email_body',is_validated:false});
Deno.test('needs: explicit gross requirement missing is a client datum, not a document request',()=>{
 const r=explainPartialKgInputs(kgInput());assertEquals(r.needs[0].state,'missing');assertEquals(r.needs[0].owner,'client');
 assertEquals(r.needs[0].source?.id,'synthetic-rate');assertEquals(r.automatic_question,false);assertEquals(r.quote_readiness,'NOT_DETERMINED');
 assert(!JSON.stringify(r).includes('facture obligatoire'));
});
Deno.test('needs: provided gross information is usable without human validation or packing list',()=>{
 const i=kgInput();i.facts=[weight()];const before=JSON.stringify(i),r=explainPartialKgInputs(i);
 assertEquals(r.needs[0].state,'provided');assertEquals(r.needs[0].fact_ids,['weight']);assertEquals(r.needs[0].observations[0].is_validated,false);
 assertEquals(JSON.stringify(i),before);assert(!('selling_amount_xof' in r));
});
Deno.test('needs: net and taxable bases do not borrow the available gross weight',()=>{
 for(const key of ['cargo.weight_net_kg','cargo.chargeable_weight_kg']){
  const i=kgInput();i.quantity_rule!.requires_fact_key=key;i.facts=[weight()];const n=explainPartialKgInputs(i).needs[0];
  assertEquals(n.key,key);assertEquals(n.state,'missing');assertEquals(n.owner,key.includes('chargeable')?'operator':'client');
 }
});
Deno.test('needs: an unspecified kg basis belongs to the tariff source',()=>{
 const i=kgInput();i.quantity_rule!.requires_fact_key=null;i.facts=[weight()];const n=explainPartialKgInputs(i).needs[0];
 assertEquals(n.key,'weight_basis');assertEquals(n.owner,'reference');assertEquals(n.state,'unqualified');
});
Deno.test('needs: DAP, export and multi-lot cannot inherit the partial DDP contract',()=>{
 for(const patch of [{packageKey:'AIR_IMPORT_DAP'},{requestType:'AIR_CROSS_TRADE'},{lotCount:2}]){
  const i=kgInput();Object.assign(i.eligibility,patch);const r=explainPartialKgInputs(i);
  assertEquals(r.needs.length,1);assertEquals(r.needs[0].key,'contract');assertEquals(r.needs[0].state,'unqualified');assertEquals(r.needs[0].owner,'operator');
 }
});
Deno.test('needs: a fixed source or wrong service never becomes a kg dependency',()=>{
 for(const patch of [{pricing_mode:'FIXED'},{service_key:'AIR_FREIGHT'},{unit:'TONNE'}]){
  const i=kgInput();Object.assign(i.selected_source!.snapshot,patch);assertEquals(explainPartialKgInputs(i).needs[0].key,'contract');
 }
});
Deno.test('needs: zero, negative and non-finite weights are invalid, not missing or a free price',()=>{
 for(const value of [0,-1,NaN,Infinity]){const i=kgInput();i.facts=[weight(undefined,value)];assertEquals(explainPartialKgInputs(i).needs[0].state,'invalid');}
});
Deno.test('needs: an assumed total remains visible and available for operator review',()=>{
 const i=kgInput();i.facts=[{...weight(),source_type:'scenario_assumption'}];const n=explainPartialKgInputs(i).needs[0];
 assertEquals(n.state,'assumption');assertEquals(n.owner,'operator');assertEquals(n.observations[0].value_number,104);assertEquals(n.observations[0].is_validated,false);
});
Deno.test('needs: duplicate current weights are not silently resolved by first-row selection',()=>{
 const i=kgInput();i.facts=[weight(),{...weight(undefined,120),id:'other'}];const n=explainPartialKgInputs(i).needs[0];
 assertEquals(n.state,'contradiction');assertEquals(n.owner,'operator');assertEquals(n.fact_ids,['weight','other']);
});
Deno.test('needs: superseded rows do not create a false contradiction',()=>{
 const i=kgInput();i.facts=[weight(),{...weight(undefined,120),id:'old',is_current:false}];assertEquals(explainPartialKgInputs(i).needs[0].state,'provided');
});
Deno.test('needs: dimensional conflict blocks unconfirmed taxable weight while operator choice stays protected',()=>{
 const i=kgInput();i.quantity_rule!.requires_fact_key='cargo.chargeable_weight_kg';
 i.facts=[weight('cargo.chargeable_weight_kg'),{fact_key:'cargo.dimensions_evidence',value_json:{conflict:true}}];
 assertEquals(explainPartialKgInputs(i).needs[0].state,'contradiction');i.facts[0].source_type='operator';assertEquals(explainPartialKgInputs(i).needs[0].state,'provided');
});
Deno.test('needs: stale caller context requires operator revalidation, not customer questions',()=>{
 const i=kgInput();i.context={selected:'before',current:'after'};i.facts=[weight()];const n=explainPartialKgInputs(i).needs[0];
 assertEquals(n.key,'context');assertEquals(n.state,'contradiction');assertEquals(n.owner,'operator');
});
Deno.test('needs: positive historical profile retains its explicit taxable basis and source',()=>{
 const r=explainAirHandlingInputs(profile(),date);assertEquals(r.needs.filter(n=>n.key.startsWith('component:')&&n.state==='provided').length,5);
 const n=r.needs.find(n=>n.key==='collection_per_kg:cargo.chargeable_weight_kg')!;assertEquals(n.state,'provided');assertEquals(n.owner,'operator');
 assertEquals(n.source?.id,'synthetic-profile');assertEquals(r.quote_readiness,'NOT_DETERMINED');
});
Deno.test('needs: legacy taxable input absent stays internal even with a gross fact',()=>{
 const s=profile();s.facts=[weight()];const r=explainAirHandlingInputs(s,date);
 assertEquals(r.needs.find(n=>n.key==='collection_per_kg:cargo.chargeable_weight_kg')!.owner,'operator');assert(!r.needs.some(n=>n.owner==='client'));
});
Deno.test('needs: catalogue invariant flat fees need no weight; unspecified kg basis stays with the source',()=>{
 const s=catalogue();s.facts=[];s.basis!.warehouse_bracket_confirmed=false;s.basis!.ordinary_storage.enabled=false;
 const r=explainAirHandlingInputs(s,date);
 for(const key of ['component:documents','component:it'])assertEquals(r.needs.find(n=>n.key===key)!.state,'provided');
 assertEquals(r.needs.find(n=>n.key==='collection_per_kg:documented_weight_basis')!.owner,'reference');assert(!r.needs.some(n=>n.owner==='client'));
});
Deno.test('needs: confirmed zero days, unknown duration and an assumption are distinct',()=>{
 for(const [days,status,want] of [[0,'confirmed','provided'],[null,'unknown','missing'],[2,'assumed','assumption']] as const){
  const s=catalogue();s.basis!.ordinary_storage.billable_days=days;s.basis!.ordinary_storage.days_status=status;
  const n=explainAirHandlingInputs(s,date).needs.find(n=>n.key==='ordinary_storage:days')!;assertEquals(n.state,want);assertEquals(n.owner,'operator');
 }
});
Deno.test('needs: source condition, storage weight and duration justification are not guessed',()=>{
 const s=catalogue();s.basis!.ordinary_storage.weight_fact_id='absent';s.basis!.ordinary_storage.source_reference='';
 const r=explainAirHandlingInputs(s,date);assertEquals(r.needs.find(n=>n.key==='ordinary_storage:selected_storage_weight_fact')!.owner,'operator');
 assertEquals(r.needs.find(n=>n.key==='ordinary_storage:days')!.state,'missing');
});
Deno.test('needs: missing days do not make an already justified storage weight missing',()=>{
 const s=catalogue();s.basis!.ordinary_storage.billable_days=null;s.basis!.ordinary_storage.days_status='unknown';
 const r=explainAirHandlingInputs(s,date);assertEquals(r.needs.find(n=>n.key==='ordinary_storage:cargo.chargeable_weight_kg')!.state,'provided');
 assertEquals(r.needs.find(n=>n.key==='ordinary_storage:days')!.state,'missing');
});
Deno.test('needs: explicit storage fact identity wins over other current weights of the same kind',()=>{
 const s=catalogue();s.facts.push({id:'other-taxable',fact_key:'cargo.chargeable_weight_kg',value_number:100,source_type:'operator',is_validated:true});
 const n=explainAirHandlingInputs(s,date).needs.find(n=>n.key==='ordinary_storage:cargo.chargeable_weight_kg')!;
 assertEquals(n.state,'provided');assertEquals(n.fact_ids,['taxable']);assertEquals(n.observations[0].value_number,80);
});
Deno.test('needs: present invalid storage duration differs from missing or confirmed zero days',()=>{
 for(const days of [-2,Infinity,NaN,1e6]){const s=catalogue();s.basis!.ordinary_storage.billable_days=days;
  assertEquals(explainAirHandlingInputs(s,date).needs.find(n=>n.key==='ordinary_storage:days')!.state,'invalid');}
});
Deno.test('needs: stale, expired, outbound or unqualified catalogue cannot present supplier components as available',()=>{
 for(const change of ['stale','expired','outbound','category']){
  const s=catalogue();if(change==='stale')s.context_hash='changed';if(change==='expired')s.catalogue!.effective_to='2026-01-02';if(change==='outbound')s.request_type='AIR_CROSS_TRADE';if(change==='category')s.basis!.general_cargo_confirmed=false;
  const r=explainAirHandlingInputs(s,date);assert(!r.needs.some(n=>n.key.startsWith('component:')&&n.state==='provided'));assert(!r.needs.some(n=>n.owner==='client'));
 }
});
Deno.test('needs: no opt-in and missing catalogue basis remain explicit, not a ready quotation',()=>{
 const s=profile();s.selection=null;assertEquals(explainAirHandlingInputs(s,date).needs[0].state,'unqualified');
 const c=catalogue();c.basis=null;assertEquals(explainAirHandlingInputs(c,date).needs[0].state,'unqualified');
});
Deno.test('needs: complete report preserves inputs and never exposes supplier totals as selling prices',()=>{
 const s=catalogue(),before=JSON.stringify(s),r=explainAirHandlingInputs(s,date);assertEquals(JSON.stringify(s),before);
 assertEquals(r.automatic_question,false);assertEquals(r.quote_readiness,'NOT_DETERMINED');
 for(const key of ['supplier_known_ht_xof','selling_amount_xof','total_ttc'])assert(!JSON.stringify(r).includes('"'+key+'"'));
});
