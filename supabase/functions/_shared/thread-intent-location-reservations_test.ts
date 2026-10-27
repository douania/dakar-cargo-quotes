import {assert,assertEquals,assertStringIncludes} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {ambiguousAirportRoles,reserveIntentAirportRoles,readAirportRoleReservations} from './thread-intent-location-reservations.ts';
import {locationOwnText} from './request-location-evidence.ts';
const model={intent_type:'new_quote_request',confidence:0.98,pricing_gate:true,transport_mode_hypothesis:'air',incoterm_hypothesis:'DAP',
 request_summary:'Arrival at NBO confirmed',reasoning:'Departure NBO confirmed',case_updates:['Arrival NBO'],operator_guidance:['Use arrival NBO'],open_questions:[],missing_business_questions:[]};
Deno.test('intent: classification confidence is preserved but every unproven airport narrative is reserved',()=>{
 const raw=structuredClone(model),r=reserveIntentAirportRoles(raw,ambiguousAirportRoles('AOD:\nNBO'));
 assertEquals(raw,model);assertEquals(r.confidence,0.98);assertEquals(r.intent_type,'new_quote_request');assertEquals(r.pricing_gate,true);
 assertEquals(r.transport_mode_hypothesis,'air');assertEquals(r.incoterm_hypothesis,'DAP');
 for(const key of ['request_summary','reasoning','case_updates','operator_guidance','open_questions','missing_business_questions']){
  const text=JSON.stringify(r[key as keyof typeof r]);assertStringIncludes(text,'reste à confirmer');assert(!/confirmed|Use arrival/.test(text));
 }
});
Deno.test('intent: explicit affirmative airport roles and ordinary explicit requests are retained',()=>{
 for(const text of ['Airport of destination: NBO','AOD: NBO\nArrival airport: NBO','Departure airport: NBO','Sea import POD: Mombasa']){
  const r=ambiguousAirportRoles(text);assertEquals(r,[]);assertEquals(reserveIntentAirportRoles(model,r),model);
 }
});
Deno.test('intent: negation, another airport, composite declarations or conflicting roles do not resolve AOD',()=>{
 for(const text of ['AOD: NBO\nNot Arrival airport: NBO','AOD: NBO\nArrival airport: MBA','AOD: NBO\nArrival airport: NBO or MBA',
  'AOD: NBO\nArrival airport: NBO\nDeparture airport: NBO','AOD: NBO\nArrival airport: NBO is not confirmed'])assertEquals(ambiguousAirportRoles(text),[{code:'NBO',reason:'ambiguous_airport_role'}]);
 assertEquals(ambiguousAirportRoles(locationOwnText('Ordinary update\n> AOD: NBO')),[]);
 assertEquals(readAirportRoleReservations([null,{},'NBO',{code:'NBO',reason:'model_claim'}]),[]);
});
Deno.env.set('MAIL_FUNCTION_DISABLE_SERVE','1');
const {handleThreadIntent}=await import('../analyze-thread-event/index.ts');
async function fixture(existing:boolean,body='AOD:\nNBO',admitted=true,actor='ai'){
 const savedFetch=globalThis.fetch,keys=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','LOVABLE_API_KEY'];
 const before=keys.map(k=>Deno.env.get(k));keys.forEach((k,i)=>Deno.env.set(k,i===0?'https://intent.fixture.invalid':'synthetic-only'));
 const calls:string[]=[],writes:Record<string,unknown>[]=[];
 globalThis.fetch=async(input,init)=>{
  const req=new Request(input,init),u=new URL(req.url),name=u.pathname.split('/').pop()!;calls.push(req.method+' '+name);
  if(u.pathname==='/auth/v1/user')return Response.json({id:'00000000-0000-4000-8000-000000000001',aud:'authenticated',email:'actor@fixture.invalid'});
  if(name==='has_workspace_access')return Response.json(admitted);
  if(name==='emails')return Response.json({id:'email-test',thread_ref:'thread-test',body_text:body,subject:'Synthetic air request'});
  if(name==='email_threads')return Response.json({id:'thread-test'});
  if(name==='quote_cases')return Response.json({id:'case-test'});
  if(name==='case_timeline_events'&&req.method==='GET')return Response.json(existing?{id:'event-test',actor_type:actor,event_data:{intent:model,confidence:0.98}}:null);
  if(u.hostname==='ai.gateway.lovable.dev')return Response.json({choices:[{message:{content:JSON.stringify(model)}}]});
  if(name==='case_timeline_events'&&req.method==='POST'){writes.push(await req.json());return Response.json({id:'created-event'});}
  throw new Error('Unexpected synthetic boundary '+req.method+' '+u.hostname+' '+name);
 };
 try{
  const response=await handleThreadIntent(new Request('https://intent.fixture.invalid/functions/v1/analyze-thread-event',{method:'POST',headers:{Authorization:'Bearer synthetic-only','Content-Type':'application/json'},body:JSON.stringify({email_id:'email-test'})}));
  return {status:response.status,result:await response.json(),calls,writes};
 }finally{globalThis.fetch=savedFetch;keys.forEach((k,i)=>before[i]===undefined?Deno.env.delete(k):Deno.env.set(k,before[i]!));}
}
Deno.test('intent handler: persists guarded intent and original model with exactly one simulated AI call',async()=>{
 const f=await fixture(false);assertEquals(f.status,200);assertEquals(f.result.ok,true);assertEquals(f.writes.length,1);
 const ed=f.writes[0].event_data as Record<string,unknown>;assertEquals(ed.model_intent,model);assertEquals(ed.confidence_scope,'intent_classification_only');
 assertStringIncludes(f.result.intent.request_summary,'reste à confirmer');assertEquals(f.calls.filter(x=>x==='POST completions').length,1);
 assert(!f.calls.some(c=>c.includes('apply-thread')));
});
Deno.test('intent handler: idempotent historical read is projected without AI or any write',async()=>{
 const f=await fixture(true);assertEquals(f.result.idempotent,true);assertStringIncludes(f.result.intent.request_summary,'reste à confirmer');
 assertEquals(f.writes,[]);assert(f.calls.every(c=>c.startsWith('GET')));
});
Deno.test('intent handler: explicit role does not discard model prose or add reservations',async()=>{
 const f=await fixture(false,'Airport of destination: NBO');assertEquals(f.result.intent.request_summary,model.request_summary);
 assertEquals((f.writes[0].event_data as Record<string,unknown>).model_intent,undefined);
});
Deno.test('intent handler: admission refusal precedes AI and system writes',async()=>{
 const f=await fixture(false,'AOD: NBO',false);assertEquals(f.status,403);assertEquals(f.writes,[]);assert(!f.calls.includes('POST completions'));
});

Deno.test('intent: unrelated explicit cargo details, HS questions and documentary guidance remain useful',()=>{
 const raw={...model,request_summary:'3 cartons, 190 kg, DDP',operator_guidance:['Vérifier la facture'],open_questions:['Quel code HS ?'],case_updates:['3 cartons'],missing_business_questions:['Quelle valeur déclarée ?']};
 const result=reserveIntentAirportRoles(raw,ambiguousAirportRoles('AOD: NBO'));
 assertEquals(result.request_summary,raw.request_summary);assertEquals(result.case_updates[0],'3 cartons');
 assertEquals(result.open_questions[0],'Quel code HS ?');assertEquals(result.operator_guidance[0],'Vérifier la facture');
 assertEquals(result.missing_business_questions[0],'Quelle valeur déclarée ?');assertEquals(raw.request_summary,'3 cartons, 190 kg, DDP');
});

Deno.test('intent handler: idempotent operator decision is preserved without AI or write',async()=>{
 const f=await fixture(true,'AOD: NBO',true,'operator');assertEquals(f.result.intent,model);assertEquals(f.writes,[]);assert(f.calls.every(c=>c.startsWith('GET')));
});
Deno.test('intent: standalone airport code is reserved and explicit operator roles are never swapped',()=>{
 const raw={...model,request_summary:'NBO'};
 assertStringIncludes(reserveIntentAirportRoles(raw,ambiguousAirportRoles('AOD: NBO')).request_summary,'reste à confirmer');
 const result=reserveIntentAirportRoles(model,[{code:'NBO',reason:'ambiguous_airport_role'}],[{code:'NBO',role:'departure_airport'}]);
 assertStringIncludes(result.request_summary,'de départ');assert(!result.request_summary.includes('d’arrivée'));
});
