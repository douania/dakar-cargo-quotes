import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
Deno.env.set('BUILD_CASE_PUZZLE_DISABLE_SERVE','1');
const { injectAttachmentFacts, upsertDeterministicFact, applyAssumptionRules, deactivateUnprotectedCurrentFact, buildCasePuzzleHandler } = await import(Deno.env.get('FACT_PRESERVATION_MODULE_URL') ?? '../build-case-puzzle/index.ts');
type Row=Record<string,unknown>;
function fixture(facts:Row[]=[],attachments:Row[]=[]){
 const rows=facts.map((r,i)=>({id:'fact-'+i,case_id:'case',is_current:true,is_validated:false,...r})),rpc:Row[]=[],updates:URL[]=[],events:Row[]=[];
 let failKey='',failRead=false,failUpdate=false,validateBeforeUpdate=false;
 const project=(r:Row,columns:string|null)=>!columns||columns==='*'?r:Object.fromEntries(columns.split(',').map(key=>[key,r[key]]));
 const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 const client=createClient('https://fixture.invalid','synthetic-anon',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{
  const options=init as {method?:string;body?:unknown;headers?:HeadersInit}|undefined;
  const url=new URL(String(input)),table=url.pathname.split('/').pop()!,method=options?.method??'GET';assertEquals(url.hostname,'fixture.invalid');
  if(table==='supersede_fact'){const p=JSON.parse(String(options?.body));rpc.push(p);return p.p_fact_key===failKey?json({message:'PROTECTED_FACT_REQUIRES_OPERATOR',code:'P0001'},400):json('new-fact');}
  if(table==='case_timeline_events'&&method==='POST'){events.push(JSON.parse(String(options?.body)));return json(null,201);}
  if(method==='PATCH'){
   updates.push(url);if(failUpdate)return json({message:'Update refused'},503);
   if(validateBeforeUpdate&&rows[0])rows[0].is_validated=true;
  }
  if(failRead&&method==='GET')return json({message:'Read refused'},503);
  let selected=table==='quote_facts'?rows:table==='email_attachments'?attachments:[];
  for(const [key,value] of url.searchParams){
   if(value.startsWith('eq.'))selected=selected.filter(r=>String(r[key])===value.slice(3));
   if(value==='is.null')selected=selected.filter(r=>r[key]==null);
   if(value==='not.is.true')selected=selected.filter(r=>r[key]!==true);
   if(value.startsWith('not.in.('))selected=selected.filter(r=>!value.slice(8,-1).split(',').includes(String(r[key])));
  }
  if(method==='PATCH'){const patch=JSON.parse(String(options?.body));selected.forEach(r=>Object.assign(r,patch));}
  const data=selected.map(r=>project(r,url.searchParams.get('select'))),single=new Headers(options?.headers).get('Accept')?.includes('vnd.pgrst.object');
  return json(single?data[0]??null:data);
 }}});
 return {client,rows,rpc,updates,events,set failKey(v:string){failKey=v;},set failRead(v:boolean){failRead=v;},set failUpdate(v:boolean){failUpdate=v;},set validateBeforeUpdate(v:boolean){validateBeforeUpdate=v;}};
}
for(const source of ['operator','manual_input','operator_correction','validated','ordered']){
 Deno.test('fact preservation: destination redirect preserves '+source,async()=>{
  const f=fixture([{fact_key:'routing.destination_country',value_text:'SENEGAL',source_type:['validated','ordered'].includes(source)?'email_body':source,is_validated:source==='validated',source_revision_id:source==='ordered'?'revision':null}],
   [{id:'attachment',email_id:'mail',filename:'invoice.pdf',extracted_data:{confidence:.2,extracted_info:{destination_city:'MALI'}}}]);
  const result=await injectAttachmentFacts('case',f.client,['mail']);assertEquals(f.rpc.filter(p=>p.p_fact_key==='routing.destination_country'),[]);assertEquals(result.added,0);
 });
 Deno.test('fact preservation: deterministic stage preserves '+source,async()=>{
  const f=fixture([{fact_key:'cargo.pieces_count',value_number:40,source_type:['validated','ordered'].includes(source)?'email_body':source,is_validated:source==='validated',source_revision_id:source==='ordered'?'revision':null}]);
  assertEquals(await upsertDeterministicFact(f.client,{case_id:'case',fact_key:'cargo.pieces_count',fact_category:'cargo',value_number:99,source_excerpt:'Uncertain source',confidence:.2}),'skipped');assertEquals(f.rpc,[]);
 });
 Deno.test('fact preservation: conditional deactivation preserves '+source,async()=>{
  const f=fixture([{fact_key:'cargo.weight_kg',value_number:100,source_type:['validated','ordered'].includes(source)?'email_body':source,is_validated:source==='validated',source_revision_id:source==='ordered'?'revision':null}]);
  assertEquals(await deactivateUnprotectedCurrentFact(f.client,'case','fact-0'),false);assertEquals(f.rows[0].is_current,true);
 });
}
Deno.test('fact preservation: validation concurrent with deactivation wins in the UPDATE predicate',async()=>{
 const f=fixture([{fact_key:'cargo.weight_kg',value_number:100,source_type:'email_body'}]);f.validateBeforeUpdate=true;
 assertEquals(await deactivateUnprotectedCurrentFact(f.client,'case','fact-0'),false);assertEquals(f.rows[0].is_current,true);assertEquals(f.rows[0].is_validated,true);
});
Deno.test('fact preservation: unvalidated automatic source still deactivates and cross-case id cannot change it',async()=>{
 const f=fixture([{fact_key:'cargo.weight_kg',value_number:100,source_type:'email_body'}]);
 assertEquals(await deactivateUnprotectedCurrentFact(f.client,'other-case','fact-0'),false);assertEquals(f.rows[0].is_current,true);
 assertEquals(await deactivateUnprotectedCurrentFact(f.client,'case','fact-0'),true);assertEquals(f.rows[0].is_current,false);
});
Deno.test('fact preservation: refused conditional UPDATE is observable and does not claim a change',async()=>{
 const f=fixture([{fact_key:'cargo.weight_kg',value_number:100,source_type:'email_body'}]);f.failUpdate=true;
 await assertRejects(()=>deactivateUnprotectedCurrentFact(f.client,'case','fact-0'));assertEquals(f.rows[0].is_current,true);
});
for(const [service,key] of [['CIF','cargo.value_currency'],['Freight','cargo.freight_currency']]){
 Deno.test('fact preservation: attachment '+key+' refusal never increments a successful write',async()=>{
  const f=fixture([],[{id:'source',email_id:'mail',filename:'invoice.pdf',extracted_data:{confidence:.2,tariff_lines:[{service,amount:100,currency:'EUR'}]}}]);f.failKey=key;
  await assertRejects(()=>injectAttachmentFacts('case',f.client,['mail']),Error,'could not be recorded');assert(f.rpc.some(p=>p.p_fact_key===key));
 });
}
Deno.test('fact preservation: assumptions do not replace a validated package',async()=>{
 const f=fixture([{fact_key:'service.package',value_text:'OPERATOR PACKAGE',source_type:'email_body',is_validated:true}]);
 await applyAssumptionRules('case',f.client,['mail'],'AIR_IMPORT');assertEquals(f.rpc.filter(p=>p.p_fact_key==='service.package'),[]);
});
Deno.test('fact preservation: deterministic RPC refusal is an error, no successful counter',async()=>{
 const f=fixture([]);f.failKey='cargo.pieces_count';
 await assertRejects(()=>upsertDeterministicFact(f.client,{case_id:'case',fact_key:'cargo.pieces_count',fact_category:'cargo',value_number:99,source_excerpt:'Uncertain',confidence:.2}));
});

for(const validated of [false,true])Deno.test('fact preservation: real handler HS guard validated='+validated,async()=>{
 const keys=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','LOVABLE_API_KEY'],saved=keys.map(k=>Deno.env.get(k)),oldFetch=globalThis.fetch;
 Deno.env.set(keys[0],'https://fixture.invalid');Deno.env.set(keys[1],'synthetic-anon');Deno.env.set(keys[2],'synthetic-service');Deno.env.delete(keys[3]);
 const hs={id:'protected-hs',case_id:'case',fact_key:'cargo.hs_code',value_text:'99999999999',source_type:'email_body',is_validated:validated,is_current:true};let refused=0,laterAssumptions=0;
 globalThis.fetch=async(input,init)=>{
  const options=init as {method?:string;body?:unknown;headers?:HeadersInit}|undefined;
  const url=new URL(input instanceof Request?input.url:String(input)),method=options?.method??'GET';assertEquals(url.hostname,'fixture.invalid');
  const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Content-Range':'0-0/1'}});
  if(url.pathname.endsWith('/user'))return json({id:'operator',email:'operator@fixture.invalid'});
  if(url.pathname.endsWith('/has_workspace_access'))return json(true);
  if(url.pathname.endsWith('/supersede_fact')){
   const p=JSON.parse(String(options?.body));
   if(p.p_fact_key==='cargo.hs_code'&&p.p_source_type==='hs_resolution'){refused++;return json({code:'P0001',message:'PROTECTED_FACT_REQUIRES_OPERATOR'},400);}
   if(p.p_source_type==='ai_assumption')laterAssumptions++;return json('new-fact');
  }
  if(url.pathname.includes('/rpc/'))return json([]);
  if(method==='HEAD')return new Response(null,{headers:{'Content-Range':'*/0'}});
  if(method!=='GET')return json([]);
  const single=new Headers(options?.headers).get('Accept')?.includes('vnd.pgrst.object'),table=url.pathname.split('/').pop();
  if(table==='quote_cases')return json({id:'case',thread_id:'thread',status:'FACTS_PARTIAL',request_type:'UNKNOWN',email_threads:{id:'thread',client_email:'buyer@fixture.invalid',subject_normalized:'Merci'}});
  if(table==='emails')return json([{id:'mail',thread_ref:'thread',from_address:'buyer@fixture.invalid',to_addresses:['operator@fixture.invalid'],subject:'Merci',body_text:'Merci reçu.',sent_at:'2026-10-18T12:00:00Z'}]);
  if(table==='hs_codes'){const code={code_normalized:'9999999999',description:'SYNTHETIC ONLY'};return json(single?code:[code]);}
  if(table==='quote_facts'){
   const key=url.searchParams.get('fact_key'),rows=key&&key!=='eq.cargo.hs_code'?[]:[hs];return json(single?rows[0]??null:rows);
  }
  return json(single?null:[]);
 };
 try{
  const response=await buildCasePuzzleHandler(new Request('https://fixture.invalid/build-case-puzzle',{method:'POST',headers:{Authorization:'Bearer synthetic-token','Content-Type':'application/json'},body:JSON.stringify({case_id:'case'})}));
  const body=await response.json();assertEquals(refused,validated?0:1);assertEquals(response.status,validated?200:500);if(!validated){assert(String(body.details).includes('PROTECTED_FACT_REQUIRES_OPERATOR'));assertEquals(laterAssumptions,0);}assertEquals(hs.is_validated,validated);assertEquals(hs.value_text,'99999999999');
 }finally{globalThis.fetch=oldFetch;keys.forEach((key,i)=>saved[i]===undefined?Deno.env.delete(key):Deno.env.set(key,saved[i]!));}
});
