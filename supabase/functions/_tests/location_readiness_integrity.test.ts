import {assert,assertEquals} from 'https://deno.land/std@0.224.0/assert/mod.ts';
Deno.env.set('BUILD_CASE_PUZZLE_DISABLE_SERVE','1');
const {buildCasePuzzleHandler}=await import(Deno.env.get('BUILD_CASE_INTEGRITY_MODULE_URL') || '../build-case-puzzle/index.ts');
type Row=Record<string,unknown>;
const key='routing.destination_city';
const raw='Air freight DAP request\r\nAOD : NBO\r\nDelivery address:\r\nCentre d\u00c3\u00a9monstration, Nairobi, Kenya\r\n2 pcs | 60 x 80 x 65 cm | 104 kg';
async function fixture(options:{explicit?:boolean;operator?:boolean;frozen?:boolean;omitAirport?:boolean;readError?:boolean;orphan?:boolean}={}){
 const names=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','LOVABLE_API_KEY'],old=names.map(k=>Deno.env.get(k)),before=globalThis.fetch;
 names.forEach((k,i)=>Deno.env.set(k,['https://fixture.invalid','synthetic-anon','synthetic-service','synthetic-ai'][i]));
 const text=options.explicit?raw.replace('AOD : NBO','Arrival airport: NBO'):raw;
 const email={id:'mail',thread_ref:'thread',from_address:'buyer@example.test',to_addresses:['operator@fixture.invalid'],subject:'Air freight DAP',body_text:text,sent_at:'2026-10-20T10:00:00Z'};
 const facts:Row[]=[{id:'package',case_id:'case',fact_key:'service.package',value_text:'DAP',source_type:'email_body',is_current:true,is_validated:false},
  ...(options.orphan?[{id:'orphan-city',case_id:'case',fact_key:key,value_text:'Nairobi',source_type:'ai_extraction',source_email_id:null,is_current:true,is_validated:false}]:[]),
  ...(options.operator?[{id:'operator-airport',case_id:'case',fact_key:'routing.destination_airport',value_text:'NBO',source_type:'manual_input',is_current:true,is_validated:false}]:[])];
 const calls:Array<{name:string;method:string;body:Row|null}>=[],groups:Row[]=[],commands:string[]=[];
 const tables:Record<string,Row[]>={quote_facts:facts,emails:[email],quote_gaps:[],case_timeline_events:[],quote_request_lines:[],
  location_aliases:[{normalized_alias:'NAIROBI',locations_reference:{id:'city-ke',canonical_name:'Nairobi',location_type:'inland',is_active:true,country_code:'KE',country_name:'Kenya'}},{normalized_alias:'NBO',locations_reference:{id:'air-ke',canonical_name:'Nairobi airport',location_type:'air',is_active:true,country_code:'KE',country_name:'Kenya'}}],
  quote_cases:[{id:'case',thread_id:'thread',status:options.frozen?'ACK_READY_FOR_PRICING':'FACTS_PARTIAL',request_type:'AIR_IMPORT',email_threads:{id:'thread',client_email:'buyer@example.test',subject_normalized:'Air freight DAP'}}]};
 const reply=(data:unknown,count=0,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Content-Range':count?`0-${count-1}/${count}`:'*/0'}});
 globalThis.fetch=async(input,init)=>{
  const req=input instanceof Request?input:new Request(String(input),init),url=new URL(req.url),name=url.pathname.split('/').pop()!;
  const body=req.method==='GET'||req.method==='HEAD'?null:await req.clone().json().catch(()=>null);calls.push({name,method:req.method,body});
  if(url.hostname==='ai.gateway.lovable.dev'){
   const prompt=JSON.stringify(body?.messages);
   if(prompt.includes('expert freight forwarding analyst'))return reply({choices:[{message:{content:JSON.stringify({facts:[
    {key,category:'routing',value:'Nairobi',valueType:'text',sourceExcerpt:'Centre démonstration, Nairobi, Kenya',confidence:.98},
    ...(!options.omitAirport?[{key:'routing.destination_airport',category:'routing',value:'NBO',valueType:'text',sourceExcerpt:options.explicit?'Arrival airport: NBO':'AOD : NBO',sourceEmailId:'mail',confidence:.98}]:[])
   ]})}}]});
   return reply({choices:[{message:{content:'{}'}}]});
  }
  assertEquals(url.hostname,'fixture.invalid','Every provider/database call is intercepted; no real network');
  if(name==='user')return reply({id:'actor',email:'operator@fixture.invalid'});
  if(name==='has_workspace_access')return reply(true);
  if(name==='case_document_analysis_inspect')return reply({contract:1,scope:'manual_case_documents',context_hash:'a'.repeat(32),documents:[],readable_email_count:1,latest:null});
  if(name==='apply_case_email_fact_revisions'){
   groups.push(...body!.p_groups);commands.push(body!.p_command);
   for(const g of body!.p_groups){
    if(facts.some(f=>f.fact_key===g.key&&f.source_type==='manual_input'))continue;
    const c=g.candidates.find((c:Row)=>c.evidence_error===null);
    if(c&&!facts.some(f=>f.fact_key===g.key))facts.push({id:'ordered-'+g.key,case_id:'case',fact_key:g.key,value_text:c.value,source_type:c.source_type,source_email_id:c.email_id,source_excerpt:c.excerpt,source_revision_id:'revision',is_current:true,is_validated:false});
   }
   return reply({decisions:body!.p_groups.map((g:Row)=>({key:g.key,status:options.orphan&&g.key===key?'conflict':'unchanged',reason:options.orphan&&g.key===key?'current_source_not_orderable':'synthetic_receipt',fact_id:'ordered-'+g.key,changed:false,replay:false}))});
  }
  if(name==='supersede_fact'){
   if(!facts.some(f=>f.fact_key===body!.p_fact_key))facts.push({id:'legacy-'+body!.p_fact_key,case_id:'case',fact_key:body!.p_fact_key,value_text:body!.p_value_text,source_email_id:body!.p_source_email_id,source_type:body!.p_source_type,is_current:true});
   return reply('synthetic-fact');
  }
  if(url.pathname.includes('/rpc/'))return reply([]);
  let rows=tables[name]||[];
  for(const [k,v]of url.searchParams){
   if(v.startsWith('eq.')&&!k.includes('.'))rows=rows.filter(r=>String(r[k])===v.slice(3));
   if(v.startsWith('neq.'))rows=rows.filter(r=>String(r[k])!==v.slice(4));
   if(v==='not.is.null')rows=rows.filter(r=>r[k]!=null);
   if(v==='is.null')rows=rows.filter(r=>r[k]==null);
   if(v==='not.is.true')rows=rows.filter(r=>r[k]!==true);
   if(v.startsWith('in.('))rows=rows.filter(r=>v.slice(4,-1).split(',').includes(String(r[k])));
  }
  if(options.readError&&name==='quote_facts'&&url.searchParams.get('select')?.startsWith('fact_key')&&url.searchParams.get('fact_key')?.includes('service.package'))return reply({message:'Synthetic critical read unavailable'},0,503);
  if(req.method==='HEAD')return new Response(null,{headers:{'Content-Range':'*/'+rows.length}});
  if(req.method==='POST'){rows=(Array.isArray(body)?body:[body]).map((r:Row)=>({id:crypto.randomUUID(),...r}));(tables[name]??=[]).push(...rows);}
  if(req.method==='PATCH')rows.forEach(r=>Object.assign(r,body));
  const single=req.headers.get('Accept')?.includes('vnd.pgrst.object');return reply(single?rows[0]??null:rows,rows.length);
 };
 try{
  const run=async()=>{const response=await buildCasePuzzleHandler(new Request('https://fixture.invalid/build-case-puzzle',{method:'POST',headers:{Authorization:'Bearer synthetic-only','Content-Type':'application/json'},body:JSON.stringify({case_id:'case'})}));const result=await response.json();assertEquals(response.status,200,JSON.stringify(result));return result;};
  return {result:await run(),facts,calls,groups,commands,run,restore:()=>{globalThis.fetch=before;names.forEach((k,i)=>old[i]===undefined?Deno.env.delete(k):Deno.env.set(k,old[i]!));}};
 }catch(e){globalThis.fetch=before;names.forEach((k,i)=>old[i]===undefined?Deno.env.delete(k):Deno.env.set(k,old[i]!));throw e;}
}
Deno.test('location integrity: actual handler passes proven raw email source into ordered revisions, never the legacy null-source writer',async()=>{
 const f=await fixture();try{
  const journals=f.calls.filter(c=>c.name==='case_timeline_events').map(c=>c.body?.event_data as {kind?:string;proofs?:Array<{key:string;status:string;sources:Array<{id:string}>}>}|undefined);
  const city=journals.find(e=>e?.kind==='location_evidence')?.proofs?.find(p=>p.key===key);assertEquals(city?.status,'accepted');assertEquals(city?.sources[0].id,'mail');
  const group=f.groups.find(g=>g.key===key);assert(group,'Proven city must use established ordered revision RPC');
  const c=(group.candidates as Array<{email_id:string;evidence_error:string|null;excerpt:string;body_sha256:string}>)[0];assertEquals(c.email_id,'mail');assertEquals(c.evidence_error,null);assert(String(c.excerpt).startsWith('Delivery address:'));assert(String(c.excerpt).includes('d\u00c3\u00a9monstration'));
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));assertEquals(c.body_sha256,[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join(''));
  assertEquals(f.facts.find(r=>r.fact_key===key)!.source_email_id,'mail');assert(!f.calls.some(c=>c.name==='supersede_fact'&&c.body?.p_fact_key===key));
  const first=f.commands[0];await f.run();assertEquals(f.commands.at(-1),first,'Retry keeps the same ordered writer command');
 }finally{f.restore();}
});
for(const omitAirport of [false,true])Deno.test('location integrity: actual P4 reserves sourced AOD even when AI omits airport proposal; omitted='+omitAirport,async()=>{
 const f=await fixture({omitAirport});try{assertEquals(f.result.request_type,'AIR_IMPORT');assertEquals(f.result.new_status,'DECISIONS_PENDING');assertEquals(f.result.ready_to_price,false);}finally{f.restore();}
});
for(const option of ['explicit','operator','frozen','readError'] as const)Deno.test('location integrity: P4 preserves '+option,async()=>{
 const f=await fixture({[option]:true});try{
  assertEquals(f.result.new_status,option==='frozen'?'ACK_READY_FOR_PRICING':option==='readError'?'DECISIONS_PENDING':'READY_TO_PRICE');
  assertEquals(f.result.ready_to_price,option!=='readError');
  if(option==='operator')assert(!f.calls.some(c=>c.name==='supersede_fact'&&c.body?.p_fact_key==='routing.destination_airport'));
 }finally{f.restore();}
});

Deno.test('location integrity: a conflict receipt never repairs an old orphan by guessing its source or bypassing ordered history',async()=>{
 const f=await fixture({orphan:true});try{
  const original=f.facts.find(r=>r.id==='orphan-city')!;assertEquals(original.source_email_id,null);
  assertEquals(f.result.email_fact_revisions.find((r:Row)=>r.key===key).reason,'current_source_not_orderable');
  assertEquals(f.facts.filter(r=>r.fact_key===key).length,1);
  assert(!f.calls.some(c=>c.name==='supersede_fact'&&c.body?.p_fact_key===key));
 }finally{f.restore();}
});
