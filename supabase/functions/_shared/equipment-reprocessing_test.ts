import {assertEquals,assertRejects,assert} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {createClient} from 'jsr:@supabase/supabase-js@2';
import {reprocessEquipment,writeEmailFactRevisions,type RevisionGroup} from './email-fact-revisions.ts';
const group:RevisionGroup={key:'cargo.containers',category:'cargo',candidates:[{email_id:'email',body_sha256:'a'.repeat(64),excerpt:'1x40’HC',value_type:'json',value:[{quantity:1,type:'40HC'}],source_type:'email_body',confidence:.9,evidence_error:null}]};
const args={caseId:'case',actorId:'actor',groups:[group],allEmails:[{id:'email',body_text:'1x40’HC',from_address:'client@fixture.invalid'}],collectionComplete:true};
function fixture(result:unknown,error=false,currentOverrides:Record<string,unknown>={}){
 const calls:Array<{name:string;body:Record<string,unknown>}> = [];
 const client=createClient('https://equipment.fixture.invalid','synthetic-service',{auth:{persistSession:false},global:{fetch:async(input,init)=>{
  const r=new Request(input,init),u=new URL(r.url);assertEquals(u.hostname,'equipment.fixture.invalid');
  const name=u.pathname.split('/').pop()!;
  if(r.method==='GET')return Response.json({id:'fact',source_revision_id:'revision',source_email_id:'email',source_type:'email_body',is_validated:false,value_json:[{quantity:1,type:'40GP'}],...currentOverrides});
  const body=await r.json();calls.push({name,body});
  if(name==='apply_case_email_fact_revisions')return Response.json({decisions:[{key:group.key,status:'conflict',reason:'same_source_contradictory_values',fact_id:'fact',changed:false,replay:false}]});
  return Response.json(error?{message:'synthetic CAS failure'}:result,{status:error?409:200});
 }}});return {client,calls};
}
Deno.test('equipment repair: exact receipt and stable command, raw full source manifest',async()=>{
 const f=fixture({key:group.key,status:'applied',reason:'parser_correction',fact_id:'successor',changed:true,replay:false});
 assertEquals((await reprocessEquipment(f.client,args))?.fact_id,'successor');await reprocessEquipment(f.client,args);
 assertEquals(f.calls[0].name,'reprocess_case_equipment');assertEquals(f.calls[0].body.p_command,f.calls[1].body.p_command);
 assertEquals(f.calls[0].body.p_expected_fact,'fact');assertEquals(f.calls[0].body.p_expected_revision,'revision');
 assertEquals((f.calls[0].body.p_manifest as Array<{sha256:string}>)[0].sha256.length,64);
});
Deno.test('equipment repair: explicit ineligibility falls through ordinary ordered writer',async()=>{
 const f=fixture({status:'not_eligible',rule:'equipment-unicode-suffix/2',reason:'defect_not_proven'});
 assertEquals(await reprocessEquipment(f.client,args),null);
 assertEquals((await writeEmailFactRevisions(f.client,args))[0].status,'conflict');
 assertEquals(f.calls.map(x=>x.name),['reprocess_case_equipment','apply_case_email_fact_revisions']);
});
Deno.test('equipment repair: new source, quantity, size or protected value do not invoke repair',async()=>{
 for(const overrides of [{source_email_id:'new-email'},{value_json:[{quantity:2,type:'40GP'}]},{value_json:[{quantity:1,type:'20GP'}]},{is_validated:true},{source_type:'manual_input'}]){
  const f=fixture(null,false,overrides);assertEquals(await reprocessEquipment(f.client,args),null);assertEquals(f.calls.length,0);
 }
});
Deno.test('equipment repair: transport/CAS error, unconfirmed receipt and incomplete collection remain errors',async()=>{
 for(const result of [null,{status:'not_eligible',rule:'other'},{key:group.key,status:'applied'}])await assertRejects(()=>reprocessEquipment(fixture(result).client,args),Error,'receipt unavailable');
 await assertRejects(()=>reprocessEquipment(fixture(null,true).client,args),Error,'CAS failure');
 const f=fixture(null);await assertRejects(()=>reprocessEquipment(f.client,{...args,collectionComplete:false}),Error,'incomplete');assert(!f.calls.length);
});
