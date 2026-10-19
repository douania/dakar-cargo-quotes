import {assert,assertEquals,assertRejects} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type {SupabaseClient} from 'jsr:@supabase/supabase-js@2';
Deno.env.set('BUILD_CASE_PUZZLE_DISABLE_SERVE','1');
const {parseContainersFromText,extractFactsBasic,bindExtractedFactSources,detectRequestType,hasCargoLclSignal,extractExplicitSeaGatewayFacts}=await import('../build-case-puzzle/index.ts');
const {prepareRevisionGroups}=await import('../_shared/email-fact-revisions.ts');
const mail=(body_text:string)=>({id:'original',from_address:'client@fixture.invalid',body_text,subject:'Sea freight request'});
const basic=(text:string)=>extractFactsBasic([mail(text)],[]).find(f=>f.key==='cargo.containers')?.value;
for(const mark of ["'",'\u2018','\u2019','\u2032','\u02bc','\uff07'])for(const suffix of ['HC','HQ'])Deno.test('equipment: '+mark+suffix+' remains explicit through both parsers and revision preparation',async()=>{
 const text=`No. of containers: 1 x 40${mark}${suffix}'`,e=mail(text),wanted=[{quantity:1,type:'40'+suffix}];
 assertEquals(parseContainersFromText(text),wanted);assertEquals(basic(text),wanted);
 const groups=await prepareRevisionGroups({emails:[e],facts:[],ownBody:x=>x,basic:x=>bindExtractedFactSources(extractFactsBasic([x],[]),[x],[]),eligible:()=>true});
 assertEquals(groups.find(g=>g.key==='cargo.containers')?.candidates.map(c=>c.value),[wanted]);
});
Deno.test('LCL: contractual partial award and unrelated substrings do not override explicit FCL',()=>{
 for(const text of ['We reserve the right to accept the whole or part of your offer.','Part of our documents are attached.','https://fixture.invalid/lclocal']){
  assertEquals(hasCargoLclSignal(text),false);assertEquals(detectRequestType('Container 1x40HC. '+text,[]),{type:'SEA_FCL_IMPORT',ambiguous_lcl_fcl:false});
 }
 for(const s of ['LCL shipment','part of a container','part of the 40HC container','2 CBM groupage'])assertEquals(hasCargoLclSignal(s),true);
 assertEquals(detectRequestType('LCL sea freight 1x40HC',[]).ambiguous_lcl_fcl,true);
});
function client(rows:unknown[],error:unknown=null){const calls:Array<unknown>=[];const q={select(){return q;},in(_k:string,v:unknown){calls.push(v);return q;},eq(){return q;},then(resolve:(v:unknown)=>unknown,reject:(e:unknown)=>unknown){return Promise.resolve({data:rows,error}).then(resolve,reject);}};return{db:{from(){return q;}} as unknown as SupabaseClient,calls};}
Deno.test('gateway: explicit own clause resolves an existing active sea alias, retaining Bunia',async()=>{
 const c=client([{locations_reference:{canonical_name:'Mombasa',location_type:'sea',is_active:true}}]);
 const facts=await extractExplicitSeaGatewayFacts(c.db,[mail('Place of delivery: Bunia, DR Congo via Mombasa Kenya')]);
 assertEquals(facts.map(f=>[f.key,f.value]),[['routing.destination_port','Mombasa'],['routing.destination_city','Bunia'],['routing.final_destination','Bunia']]);
 assert(facts.every(f=>f.sourceEmailId==='original'&&f.sourceExcerpt?.includes('via Mombasa Kenya')));
});
Deno.test('gateway: unknown/inland aliases, alternatives and cited history do not select a sea gateway',async()=>{
 for(const text of ['Place of delivery: Bunia via Uganda','Place of delivery: Bunia via Mombasa or Durban','Reminder\nOn Monday, Client wrote:\n> Place of delivery: Bunia via Mombasa Kenya']){
  const c=client([]);assertEquals(await extractExplicitSeaGatewayFacts(c.db,[mail(text)]),[]);
 }
});
Deno.test('gateway: reference access error is visible',async()=>{
 const c=client([],{message:'synthetic read denied'});await assertRejects(()=>extractExplicitSeaGatewayFacts(c.db,[mail('Place of delivery: Bunia via Mombasa Kenya')]),Error,'could not be verified');
});
