import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { prepareRevisionGroups, writeEmailFactRevisions, type RevisionFact } from '../_shared/email-fact-revisions.ts';
Deno.env.set('BUILD_CASE_PUZZLE_DISABLE_SERVE','1');
const {extractFactsBasic,ownFactEmailBody,buildCasePuzzleHandler}=await import('../build-case-puzzle/index.ts');
const mail=(id:string,body_text:string)=>({id,body_text,from_address:'client@example.test',sent_at:'2026-10-18T10:00:00Z'});
const emails=[mail('m1','Gross weight: 200 kg. Incoterm: DDP'),mail('m2','Gross weight: 300 kg.\n\nOn 17 Oct 2026, Client wrote:\n> Gross weight: 200 kg. Incoterm: DDP')];
const prepare=(facts:RevisionFact[]=[])=>prepareRevisionGroups({emails,facts,ownBody:ownFactEmailBody,basic:e=>extractFactsBasic([e],[]),eligible:()=>true});
Deno.test('email revisions: actual parser keeps both own corrections and never promotes quoted history',async()=>{
 const groups=await prepare(),weight=groups.find(g=>g.key==='cargo.weight_kg')!;
 assertEquals(weight.candidates.map(c=>[c.email_id,c.value]).sort(),[['m1',200],['m2',300]]);
 assert(!groups.find(g=>g.key==='routing.incoterm')!.candidates.some(c=>c.email_id==='m2'));
 assert(weight.candidates.every(c=>c.body_sha256?.length===64&&c.excerpt&&c.evidence_error===null));
});
Deno.test('email revisions: same-source conflicting AI/basic values remain candidates, duplicates collapse and unbound AI stays conflict evidence',async()=>{
 const fact:RevisionFact={key:'cargo.weight_kg',category:'cargo',value:99,valueType:'number',sourceType:'ai_extraction',sourceEmailId:'m2',sourceExcerpt:'Gross weight: 300 kg.',confidence:.9};
 const groups=await prepare([fact,fact,{...fact,key:'cargo.volume_cbm',sourceEmailId:undefined}]);
 assertEquals(groups.find(g=>g.key==='cargo.weight_kg')!.candidates.length,3);
 assertEquals(groups.find(g=>g.key==='cargo.volume_cbm')!.candidates[0].evidence_error,'SOURCE_EMAIL_MISSING');
});
Deno.test('email revisions: incomplete collection, refused RPC and malformed receipt are observable; command recovery is stable',async()=>{
 const groups=await prepare(),args={caseId:'case',actorId:'actor',groups,allEmails:emails,collectionComplete:true};let writes=0;const commands:string[]=[];
 const client={rpc:async(_name:string,p:Record<string,unknown>)=>{writes++;commands.push(String(p.p_command));return {data:{decisions:groups.map(g=>({key:g.key,status:'applied',reason:'newer_verified_declaration',fact_id:'fact',changed:true,replay:false}))},error:null};}};
 await assertRejects(()=>writeEmailFactRevisions(client,{...args,collectionComplete:false}));assertEquals(writes,0);
 await writeEmailFactRevisions(client,args);await writeEmailFactRevisions(client,{...args,allEmails:[...emails].reverse()});assertEquals(commands[0],commands[1]);
 await writeEmailFactRevisions(client,{...args,allEmails:[...emails,mail('m3','Merci.')]});assert(commands[2]!==commands[1]);
 await assertRejects(()=>writeEmailFactRevisions({rpc:async()=>({data:null,error:{message:'TEST_ONLY unavailable'}})},args));
 await assertRejects(()=>writeEmailFactRevisions({rpc:async()=>({data:{decisions:[]},error:null})},args));
});

for(const refused of [false,true])Deno.test('email revisions: actual analyser binds all own messages, rejects unconfirmed write, preserves ordered facts; refused='+refused,async()=>{
 const oldFetch=globalThis.fetch,keys=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','LOVABLE_API_KEY'],saved=keys.map(k=>Deno.env.get(k));
 Deno.env.set(keys[0],'https://fixture.invalid');Deno.env.set(keys[1],'synthetic-anon');Deno.env.set(keys[2],'synthetic-service');Deno.env.delete(keys[3]);
 let proposals:Record<string,unknown>|undefined,legacyWeightWrites=0,laterStages=0;
 const current={id:'ordered-fact',case_id:'case',fact_key:'cargo.weight_kg',value_number:300,source_type:'email_body',source_revision_id:'revision',is_current:true,is_validated:false};
 globalThis.fetch=async(input,init)=>{
  const options=init as {method?:string;body?:unknown;headers?:HeadersInit}|undefined;
  const url=new URL(input instanceof Request?input.url:String(input));assertEquals(url.hostname,'fixture.invalid');const name=url.pathname.split('/').pop()!,method=options?.method??'GET';
  const json=(data:unknown,status=200,count=0)=>new Response(method==='HEAD'?null:JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Content-Range':`0-${Math.max(0,count-1)}/${count}`}});
  if(name==='user')return json({id:'operator',email:'operator@fixture.invalid'});
  if(name==='has_workspace_access')return json(true);
  if(name==='case_document_analysis_inspect')return json({contract:1,scope:'manual_case_documents',context_hash:'a'.repeat(32),documents:[],readable_email_count:0,latest:null});
  if(name==='apply_case_email_fact_revisions'){
   proposals=JSON.parse(String(options?.body));if(refused)return json({code:'PT409',message:'Source collection changed'},409);
   const groups=proposals!.p_groups as Array<{key:string}>;
   return json({decisions:groups.map(g=>({key:g.key,status:'applied',reason:'newer_verified_declaration',fact_id:'ordered-fact',changed:true,replay:false}))});
  }
  if(name==='supersede_fact') {const p=JSON.parse(String(options?.body));if(p.p_fact_key==='cargo.weight_kg')legacyWeightWrites++;else laterStages++;return json('fact');}
  if(url.pathname.includes('/rpc/'))return json([]);
  if(method==='HEAD')return json(null,200,0);
  if(method!=='GET')return json([]);
  const single=new Headers(options?.headers).get('Accept')?.includes('vnd.pgrst.object');
  if(name==='quote_cases')return json({id:'case',thread_id:'thread',status:'FACTS_PARTIAL',request_type:'UNKNOWN',email_threads:{id:'thread',client_email:'client@example.test',subject_normalized:'Correction de poids'}});
  if(name==='emails')return json(emails,200,emails.length);
  if(name==='quote_facts'){
   const key=url.searchParams.get('fact_key');let rows=key&&key!=='eq.cargo.weight_kg'?[]:[current];
   if(key?.startsWith('in.'))rows=key.includes('cargo.weight_kg')?[current]:[];
   return json(single?rows[0]??null:rows,200,rows.length);
  }
  return json(single?null:[]);
 };
 try{
  const response=await buildCasePuzzleHandler(new Request('https://fixture.invalid/build-case-puzzle',{method:'POST',headers:{Authorization:'Bearer synthetic-token','Content-Type':'application/json'},body:JSON.stringify({case_id:'case'})}));
  const body=await response.json();assert(proposals,JSON.stringify(body));
  const groups=proposals.p_groups as Array<{key:string;candidates:Array<{email_id:string;value:unknown}>}>;
  assertEquals(groups.find(g=>g.key==='cargo.weight_kg')!.candidates.map(c=>c.value).sort(),[200,300]);
  assertEquals((proposals.p_manifest as unknown[]).length,2);assertEquals(legacyWeightWrites,0);
  if(refused){assertEquals(response.status,500);assertEquals(laterStages,0);assert(String(body.details).includes('Source collection changed'));}
  else{assertEquals(response.status,200,JSON.stringify(body));assert(Array.isArray(body.email_fact_revisions));}
 }finally{globalThis.fetch=oldFetch;keys.forEach((key,i)=>saved[i]===undefined?Deno.env.delete(key):Deno.env.set(key,saved[i]!));}
});
