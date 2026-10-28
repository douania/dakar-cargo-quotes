import {assert,assertEquals} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {prepareRevisionGroups} from '../_shared/email-fact-revisions.ts';
import {emailCargoEvidence} from '../_shared/cargo-source-evidence.ts';
import {partialKgQuantity,partialChargeableWeight} from '../_shared/partial-destination-quote.ts';
Deno.env.set('BUILD_CASE_PUZZLE_DISABLE_SERVE','1');
const {bindExtractedFactSources,extractFactsWithAI,extractFactsBasic,buildCasePuzzleHandler}=await import('../build-case-puzzle/index.ts');
const mail=(body_text:string,id='mail')=>({id,body_text,from_address:'qa@example.invalid',sent_at:'2026-10-28T10:00:00Z'});
const fact=(value:number,sourceExcerpt:string,sourceType='ai_extraction')=>({key:'cargo.weight_kg',category:'cargo',value,valueType:'number' as const,sourceType,sourceExcerpt,sourceEmailId:'mail',confidence:.99});
for(const [body,excerpt] of [
 ['3 cartons; Gross weight:25kg/carton','Gross weight:25kg/carton'],
 ['3 cartons; Gross weight:25kg/carton','25kg'],
 ['3 packages; Gross weight:25kg per package','25kg'],
 ['3 colis; Poids par colis:25 kg','25 kg'],
 ['3 cartons; Each carton weighs 25 kg','25 kg'],
 ['3 cartons; Gross weight:25kg\nper carton','25kg'],
 ['3 cartons; Weight per carton:\n25kg','25kg'],
])Deno.test('weight scope: source unit weight never becomes canonical total even with clipped AI excerpt: '+body,async()=>{
 const emails=[mail(body)],bound=bindExtractedFactSources([fact(25,excerpt)],emails,[]);
 assertEquals(bound.filter(f=>f.key==='cargo.weight_kg'),[]);
 const groups=await prepareRevisionGroups({emails,facts:bound,ownBody:s=>s,basic:e=>bindExtractedFactSources(extractFactsBasic([e],[]),[e],[]),eligible:()=>true});
 assert(!groups.some(g=>g.key==='cargo.weight_kg'),'No proposal may reach ordered canonical writer');
 assertEquals(partialKgQuantity({requires_fact_key:'cargo.weight_kg'},bound.map(f=>({fact_key:f.key,value_number:typeof f.value==='number'?f.value:null}))).kg,null);
 assertEquals(partialChargeableWeight([]).kg,null,'No gross-to-taxable substitution');
});
Deno.test('weight scope: no invented multiplication or assumption bypass',()=>{
 const emails=[mail('Total 3 cartons. Gross weight:25kg/carton')];
 for(const proposal of [fact(75,'Gross weight:25kg/carton'),{...fact(25,'25kg','ai_assumption'),isAssumption:true}])assertEquals(bindExtractedFactSources([proposal],emails,[]),[]);
});
Deno.test('weight scope: explicit total coexisting with a unit amount remains usable and traceable',async()=>{
 const body='Total 3 cartons. Unit weight:25 kg/carton.\nTotal gross weight:75 kg';
 const bound=bindExtractedFactSources([fact(75,'Total gross weight:75 kg')],[mail(body)],[]);
 assertEquals(bound.length,1);assertEquals(bound[0].value,75);assertEquals(bound[0].sourceEmailId,'mail');
 const groups=await prepareRevisionGroups({emails:[mail(body)],facts:bound,ownBody:s=>s,basic:()=>[],eligible:()=>true});
 assertEquals(groups[0].candidates[0].evidence_error,null);
 assertEquals(bindExtractedFactSources([fact(75,'75')],[mail(body)],[]).length,1,'A clipped numeric quote retains its uniquely explicit total');
 assertEquals(partialKgQuantity({requires_fact_key:'cargo.weight_kg'},[{fact_key:'cargo.weight_kg',value_number:75}]).kg,75);
});
Deno.test('weight scope: ordinary source totals and kg/t units keep existing positive extraction',()=>{
 for(const [body,value,excerpt] of [['Gross weight:75 kg',75,'75 kg'],['Total gross weight:0.075 tonnes',75,'0.075 tonnes']] as const){
  const bound=bindExtractedFactSources([fact(value,excerpt)],[mail(body)],[]);assertEquals(bound.length,1);assertEquals(bound[0].value,value);
 }
 assertEquals(emailCargoEvidence('3 cartons; Gross weight:25kg/carton').weightKg,null,'The existing basic parser already refuses this unit weight');
});
Deno.test('weight scope: repeated bare amount cannot borrow a different total declaration; complete total excerpt remains valid',()=>{
 const body='Total 3 cartons. Unit weight:25kg/carton.\nTotal gross weight:25kg';
 assertEquals(bindExtractedFactSources([fact(25,'25kg')],[mail(body)],[]),[]);
 assertEquals(bindExtractedFactSources([fact(25,'Total gross weight:25kg')],[mail(body)],[]).length,1);
});
Deno.test('weight scope: quoted history and other messages do not invalidate the selected explicit total',()=>{
 const emails=[mail('Gross weight:75 kg\n\nOn yesterday, Client wrote:\n> Gross weight:25kg/carton'),mail('Gross weight:25kg/carton','other')];
 const bound=bindExtractedFactSources([fact(75,'Gross weight:75 kg')],emails,[]);assertEquals(bound.length,1);assertEquals(bound[0].value,75);
});
Deno.test('weight scope: existing manual sources and explicit attachment sources keep their own paths',()=>{
 const body='Gross weight:25kg/carton',emails=[mail(body)];
 assertEquals(bindExtractedFactSources([fact(75,'Operator total:75kg','manual_input')],emails,[])[0].value,75);
 const document={id:'doc',email_id:'mail',extracted_text:'Total gross weight:75 kg'};
 const bound=bindExtractedFactSources([{...fact(75,document.extracted_text),sourceAttachmentId:'doc'}],emails,[document]);
 assertEquals(bound[0].sourceAttachmentId,'doc');assertEquals(bound[0].value,75);
});
Deno.test('weight scope: actual AI extraction is intercepted locally and cannot return a unit amount as a global fact',async()=>{
 const original=globalThis.fetch;let calls=0;const body='Total 3 cartons; Gross weight:25kg/carton';
 globalThis.fetch=async(input)=>{assertEquals(new URL(input instanceof Request?input.url:String(input)).hostname,'ai.gateway.lovable.dev');calls++;return Response.json({choices:[{message:{content:JSON.stringify({facts:[fact(25,'25kg')]})}}]});};
 try{const facts=await extractFactsWithAI('', '',[mail(body)],[],'synthetic-only-key');assertEquals(calls,1);assert(!facts.some(f=>f.key==='cargo.weight_kg'));assertEquals(body,'Total 3 cartons; Gross weight:25kg/carton');}
 finally{globalThis.fetch=original;}
});

Deno.test('weight scope: nonliteral or absent model quote cannot revive an unbound unit weight',()=>{
 const emails=[mail('Total 3 cartons; Gross weight:25kg/carton')];
 for(const sourceExcerpt of ['25 KG','model normalized weight',''])assertEquals(bindExtractedFactSources([fact(25,sourceExcerpt)],emails,[]),[]);
 for(const sourceEmailId of [undefined,'invented-email'])assertEquals(bindExtractedFactSources([{...fact(25,'25 KG'),sourceEmailId}],emails,[]),[]);
 assertEquals(bindExtractedFactSources([{...fact(25,'model normalized weight'),sourceEmailId:'unrelated'}],[...emails,mail('No declared weight','unrelated')],[]),[],'An unproven ID cannot hide the unit declaration in the other own source');
});
Deno.test('weight scope: source rejection callback retains only the proposal and relevant source clause',()=>{
 const rejection:Array<{email?:string;value:unknown;reason:string;context:string}>=[];
 const bound=bindExtractedFactSources([fact(25,'25kg')],[mail('Total 3 cartons; Gross weight:25kg/carton')],[],'',(f,issue)=>rejection.push({email:f.sourceEmailId,value:f.value,reason:issue.reason,context:issue.unit_declarations[0].excerpt}));
 assertEquals(bound,[]);assertEquals(rejection.length,1);assertEquals(rejection[0].email,'mail');assertEquals(rejection[0].value,25);assertEquals(rejection[0].reason,'PER_UNIT_WEIGHT_NOT_TOTAL');assert(rejection[0].context.includes('25kg/carton'));
});
Deno.test('weight scope: manual case-document context does not borrow a per-unit email source',()=>{
 const doc='Total gross weight:75 kg',bound=bindExtractedFactSources([fact(75,doc)],[mail('25kg/carton')],[],doc);
 assertEquals(bound.length,1);assertEquals(bound[0].value,75);assertEquals(bound[0].sourceEmailId,undefined);
});

type Row=Record<string,unknown>;
async function handlerFixture(options:{total?:boolean;manual?:boolean;journalFailure?:boolean}={}){
 const before=globalThis.fetch,keys=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','LOVABLE_API_KEY'],old=keys.map(k=>Deno.env.get(k));
 keys.forEach((k,i)=>Deno.env.set(k,['https://fixture.invalid','synthetic-anon','synthetic-service','synthetic-ai'][i]));
 const source={thread_ref:'thread',...mail('Air freight DAP\nTotal 3 cartons; Gross weight:25kg/carton'+(options.total?'\nTotal gross weight:75 kg':''))};
 const current:Row[]=[{id:'city',case_id:'case',fact_key:'routing.destination_city',value_text:'Nairobi',source_type:'operator',is_validated:true,is_current:true},
  {id:'package',case_id:'case',fact_key:'service.package',value_text:'AIR_IMPORT_DAP',source_type:'operator',is_validated:true,is_current:true},
  ...(options.manual?[{id:'manual-total',case_id:'case',fact_key:'cargo.weight_kg',value_number:75,source_type:'manual_input',is_validated:true,is_current:true}]:[])];
 const tables:Record<string,Row[]>={quote_facts:current,emails:[source],quote_gaps:[],case_timeline_events:[],quote_request_lines:[],quote_cases:[{id:'case',thread_id:'thread',status:'FACTS_PARTIAL',email_threads:{id:'thread',client_email:'qa@example.invalid',subject_normalized:'Air freight DAP'}}]};
 const calls:Array<{name:string;method:string;body:Row|null}>=[];
 globalThis.fetch=async(input,init)=>{
  const req=input instanceof Request?input:new Request(String(input),init),u=new URL(req.url),name=u.pathname.split('/').pop()!;
  const body=req.method==='GET'||req.method==='HEAD'?null:await req.clone().json().catch(()=>null);calls.push({name,method:req.method,body});
  const reply=(data:unknown,count=0,status=200)=>Response.json(data,{status,headers:{'Content-Range':count?`0-${count-1}/${count}`:'*/0'}});
  if(u.hostname==='ai.gateway.lovable.dev')return reply({choices:[{message:{content:JSON.stringify({facts:[fact(options.total?75:25,options.total?'Total gross weight:75 kg':'25kg')]})}}]});
  assertEquals(u.hostname,'fixture.invalid','No live service or AI is allowed');
  if(name==='user')return reply({id:'actor',email:'operator@fixture.invalid'});
  if(name==='has_workspace_access')return reply(true);
  if(name==='case_document_analysis_inspect')return reply({contract:1,scope:'manual_case_documents',context_hash:'a'.repeat(32),documents:[],readable_email_count:1,latest:null});
  if(name==='case_timeline_events'&&req.method==='POST'&&(body?.event_data as Row)?.kind==='cargo_weight_scope_rejections'&&options.journalFailure)return reply({message:'Synthetic evidence append unavailable'},0,503);
  if(name==='apply_case_email_fact_revisions'){
   for(const g of body.p_groups as Array<{key:string;candidates:Array<{value:unknown;value_type:string;email_id:string;excerpt:string}>}>){
    const candidate=g.candidates[0];if(!current.some(f=>f.fact_key===g.key))current.push({id:'ordered-'+g.key,case_id:'case',fact_key:g.key,value_number:candidate.value_type==='number'?candidate.value:null,value_text:candidate.value_type==='text'?candidate.value:null,source_type:'email_body',source_email_id:candidate.email_id,source_excerpt:candidate.excerpt,source_revision_id:'revision',is_current:true,is_validated:false});
   }
   return reply({decisions:body.p_groups.map((g:{key:string})=>({key:g.key,status:'applied',reason:'synthetic_verified_source',fact_id:'ordered-'+g.key,changed:true,had_current:false,replay:false}))});
  }
  if(name==='supersede_fact'){
   if(!current.some(f=>f.fact_key===body.p_fact_key))current.push({id:'legacy-'+body.p_fact_key,case_id:'case',fact_key:body.p_fact_key,value_number:body.p_value_number,value_text:body.p_value_text,source_type:body.p_source_type,is_current:true,is_validated:false});
   return reply('synthetic-fact');
  }
  if(u.pathname.includes('/rpc/'))return reply([]);
  let rows=tables[name]||[];
  for(const [k,v]of u.searchParams){
   if(v.startsWith('eq.'))rows=rows.filter(r=>String(r[k])===v.slice(3));
   if(v==='is.null')rows=rows.filter(r=>r[k]==null);
   if(v==='not.is.null')rows=rows.filter(r=>r[k]!=null);
   if(v.startsWith('in.('))rows=rows.filter(r=>v.slice(4,-1).split(',').includes(String(r[k])));
  }
  if(req.method==='HEAD')return new Response(null,{headers:{'Content-Range':'*/'+rows.length}});
  if(req.method==='POST'){rows=(Array.isArray(body)?body:[body]).map((r:Row)=>({id:crypto.randomUUID(),...(name==='quote_gaps'?{status:'open'}:{}),...r}));(tables[name]??=[]).push(...rows);}
  if(req.method==='PATCH')rows.forEach(r=>Object.assign(r,body));
  const single=req.headers.get('Accept')?.includes('vnd.pgrst.object');return reply(single?rows[0]??null:rows,rows.length);
 };
 const run=async()=>{const response=await buildCasePuzzleHandler(new Request('https://fixture.invalid/build-case-puzzle',{method:'POST',headers:{Authorization:'Bearer synthetic-only','Content-Type':'application/json'},body:JSON.stringify({case_id:'case'})}));return{status:response.status,data:await response.json()};};
 return{run,calls,current,tables,restore:()=>{globalThis.fetch=before;keys.forEach((k,i)=>old[i]===undefined?Deno.env.delete(k):Deno.env.set(k,old[i]!));}};
}
Deno.test('weight scope: real handler records refusal before canonical writes, raises missing-total blocker and repeats without duplicate gaps',async()=>{
 const f=await handlerFixture();try{
  const r=await f.run();assertEquals(r.status,200);assertEquals(r.data.new_status,'NEED_INFO');assertEquals(r.data.ready_to_price,false);
  assert(!f.current.some(r=>r.fact_key==='cargo.weight_kg'));
  const event=f.tables.case_timeline_events.find(e=>(e.event_data as Row)?.kind==='cargo_weight_scope_rejections');assert(event);
  const proposals=(event.event_data as {proposals:Array<{source_email_id:string;proposed_value:number;body_sha256:string;reason:string}>}).proposals;
  assertEquals(proposals[0].source_email_id,'mail');assertEquals(proposals[0].proposed_value,25);assertEquals(proposals[0].reason,'PER_UNIT_WEIGHT_NOT_TOTAL');assertEquals(proposals[0].body_sha256.length,64);
  assert(f.tables.quote_gaps.some(g=>g.gap_key==='cargo.weight_kg'&&g.is_blocking));
  await f.run();assertEquals(f.tables.quote_gaps.filter(g=>g.gap_key==='cargo.weight_kg'&&g.status==='open').length,1);
  assert(!f.calls.some(c=>c.name==='supersede_fact'&&c.body?.p_fact_key==='cargo.weight_kg'));
 }finally{f.restore();}
});
for(const mode of ['total','manual'] as const)Deno.test('weight scope: real handler retains positive '+mode+' total without false manual-validation requirement',async()=>{
 const f=await handlerFixture({[mode]:true});try{const r=await f.run();assertEquals(r.status,200);assertEquals(r.data.new_status,'READY_TO_PRICE');assertEquals(r.data.ready_to_price,true);assertEquals(f.current.find(f=>f.fact_key==='cargo.weight_kg')!.value_number,75);if(mode==='manual')assertEquals(f.current.find(f=>f.fact_key==='cargo.weight_kg')!.id,'manual-total');}finally{f.restore();}
});
Deno.test('weight scope: refused rejection journal is observable before every canonical write',async()=>{
 const f=await handlerFixture({journalFailure:true});try{const r=await f.run();assertEquals(r.status,500);assert(String(r.data.details).includes('Weight scope evidence could not be retained'));assert(!f.calls.some(c=>['supersede_fact','apply_case_email_fact_revisions'].includes(c.name)));}finally{f.restore();}
});
