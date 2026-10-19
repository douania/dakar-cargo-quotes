import { assert, assertEquals, assertRejects, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handleBackfillCaseDocuments } from '../backfill-case-documents/index.ts';
import { handleParseDocument } from '../parse-document/index.ts';
import { documentAnalysisInventory, documentAnalysisRequest, readableCaseDocuments, assertLoadedDocumentSources } from '../_shared/case-document-analysis.ts';
Deno.env.set('BUILD_CASE_PUZZLE_DISABLE_SERVE','1');
const { buildCasePuzzleHandler } = await import('../build-case-puzzle/index.ts');
type Row=Record<string,unknown>;
const contextHash='a'.repeat(32),sourceHash='b'.repeat(32);
const digest=async(text:unknown)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof text==='string'?text:'<NULL>')))].map(x=>x.toString(16).padStart(2,'0')).join('');
async function fixture(run:(f:Awaited<ReturnType<typeof make>>) => Promise<void>){
 const keys=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','LOVABLE_API_KEY'],old=keys.map(k=>Deno.env.get(k)),fetchBefore=globalThis.fetch;
 const runtime=globalThis as unknown as {EdgeRuntime?:{waitUntil:(p:Promise<unknown>)=>void}};
 const oldRuntime=runtime.EdgeRuntime;
 Deno.env.set(keys[0],'https://fixture.invalid');Deno.env.set(keys[1],'synthetic-anon');Deno.env.set(keys[2],'synthetic-service');Deno.env.delete(keys[3]);
 const f=await make();globalThis.fetch=f.network;runtime.EdgeRuntime={waitUntil:p=>{f.background.push(p);}};
 try{await run(f);await Promise.all(f.background);}finally{globalThis.fetch=fetchBefore;runtime.EdgeRuntime=oldRuntime;keys.forEach((k,i)=>old[i]===undefined?Deno.env.delete(k):Deno.env.set(k,old[i]!));}
}
async function make(){
 const docs:Row[]=[{id:'bad',case_id:'case',file_name:'unreadable.png',document_type:'other',mime_type:'image/png',storage_path:'case/bad',extracted_text:null},
  {id:'good',case_id:'case',file_name:'invoice.txt',document_type:'invoice',mime_type:'text/plain',storage_path:'case/good',extracted_text:'SYNTHETIC invoice: 250 kg, 20 cartons.'}];
 const facts:Row[]=[{id:'manual',case_id:'case',fact_key:'cargo.weight_kg',fact_category:'cargo',value_number:190,source_type:'manual_input',is_validated:false,is_current:true,source_revision_id:null},
  {id:'validated',case_id:'case',fact_key:'cargo.pieces_count',fact_category:'cargo',value_number:5,source_type:'email_body',is_validated:true,is_current:true,source_revision_id:null}];
 const tables:Record<string,Row[]>={case_documents:docs,quote_facts:facts,quote_gaps:[],case_timeline_events:[],case_puzzle_jobs:[],
  quote_cases:[{id:'case',thread_id:null,status:'RFQ_DETECTED',request_type:'UNKNOWN',email_threads:null}],emails:[],email_attachments:[]};
 const calls:Array<{path:string;method:string;body:unknown}>=[],background:Promise<unknown>[]=[];
 let deny=false,inventoryError=false,beginError='',finishError=false,latest:Row|null=null,storedResult:Row|null=null,outcome:string|null=null;
 const sources=async()=>({documents:await Promise.all(docs.map(async d=>({id:d.id,name:d.file_name,document_type:d.document_type,
  readable:readableCaseDocuments([d]).length===1,text_hash:await digest(d.extracted_text),source_hash:sourceHash}))),emails:await Promise.all(tables.emails.map(async e=>({...e,text_hash:await digest(e.body_text)})))});
 const inventory=async()=>({contract:1,scope:'manual_case_documents',context_hash:contextHash,...await sources(),readable_email_count:tables.emails.length,latest});
 const reply=(data:unknown,status=200,count?:number)=>Response.json(data,{status,headers:count===undefined?{}:{'Content-Range':count?'0-'+(count-1)+'/'+count:'*/0'}});
 const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII='),x=>x.charCodeAt(0));
 const network:typeof fetch=async(input,init)=>{
  const req=input instanceof Request?input:new Request(String(input),init),url=new URL(req.url),table=url.pathname.split('/').pop()!;
  assertEquals(url.hostname,'fixture.invalid','No external network permitted');
  let body:unknown=null;if(req.method!=='GET'&&req.method!=='HEAD'&&!url.pathname.endsWith('/parse-document'))body=await req.clone().json().catch(()=>null);
  calls.push({path:url.pathname,method:req.method,body});
  if(url.pathname==='/auth/v1/user')return reply({id:'operator',email:'operator@fixture.invalid'});
  if(table==='has_workspace_access')return reply(!deny);
  if(table==='case_document_analysis_inspect')return inventoryError?reply({message:'SYNTHETIC read refused',code:'XX000'},503):reply(await inventory());
  if(table==='case_document_analysis_begin'){
   if(beginError)return reply({message:beginError,code:'PT409'},409);
   const p=body as Row;tables.quote_gaps.push({id:'coverage',case_id:'case',gap_key:'documents.analysis_coverage',status:'open',is_blocking:true});
   return reply({id:p.p_id,mode:p.p_mode,context_hash:p.p_hash,...await sources()});
  }
  if(table==='case_document_analysis_finish'){
   if(finishError)return reply({message:'SYNTHETIC source changed',code:'40001'},409);
   const p=body as Row,request=calls.find(c=>c.path.endsWith('/case_document_analysis_begin'))!.body as Row;
   const partial=request.p_mode==='readable';
   storedResult={...(p.p_result as Row),new_status:partial?'NEED_INFO':(p.p_patch as Row).status,
    ready_to_price:partial?false:(p.p_result as Row).ready_to_price,document_analysis:{id:p.p_id,mode:request.p_mode,state:partial?'partial':'complete',context_hash:contextHash,scope:'manual_case_documents',documents:(await sources()).documents}};
   if(!partial)tables.quote_gaps.filter(g=>g.gap_key==='documents.analysis_coverage').forEach(g=>g.status='resolved');
   outcome=partial?'partial':'complete';return reply(storedResult);
  }
  if(table==='case_document_analysis_fail'){outcome='failed';return reply(null);}
  if(table==='case_document_analysis_job')return reply({managed:true,pending:outcome===null,outcome,result:storedResult});
  if(url.pathname==='/functions/v1/parse-document')return handleParseDocument(req);
  if(url.pathname==='/functions/v1/build-case-puzzle')return buildCasePuzzleHandler(req);
  if(url.pathname.startsWith('/functions/v1/'))return reply({success:true});
  if(url.pathname.startsWith('/storage/v1/object/'))return new Response(bytes.slice(),{headers:{'Content-Type':'image/png'}});
  if(url.pathname.includes('/rpc/'))return reply(table==='supersede_fact'?'synthetic-fact':[]);
  let rows=tables[table]||[];
  for(const [key,v]of url.searchParams){
   if(v.startsWith('eq.'))rows=rows.filter(r=>String(r[key])===v.slice(3));
   if(v.startsWith('neq.'))rows=rows.filter(r=>String(r[key])!==v.slice(4));
   if(v==='is.true')rows=rows.filter(r=>r[key]===true);
   if(v==='is.null')rows=rows.filter(r=>r[key]==null);
   if(v==='not.is.null')rows=rows.filter(r=>r[key]!=null);
   if(v==='not.is.true')rows=rows.filter(r=>r[key]!==true);
   if(v.startsWith('in.('))rows=rows.filter(r=>v.slice(4,-1).split(',').includes(String(r[key])));
  }
  if(req.method==='HEAD')return new Response(null,{headers:{'Content-Range':'*/'+rows.length}});
  if(req.method==='POST'){
   const values=Array.isArray(body)?body:[body];rows=values.map((value,i)=>({id:crypto.randomUUID(),...(value as Row),created_at:'2026-10-19T09:00:00Z'}));
   (tables[table]??=[]).push(...rows);
  }
  if(req.method==='PATCH'){const patch=body as Row;rows.forEach(r=>Object.assign(r,patch));}
  const single=req.headers.get('Accept')?.includes('vnd.pgrst.object');
  return reply(single?rows[0]??null:rows,200,rows.length);
 };
 const request=(body:Row)=>new Request('https://fixture.invalid/request',{method:'POST',headers:{Authorization:'Bearer synthetic-only-token','Content-Type':'application/json'},body:JSON.stringify(body)});
 return{network,docs,facts,calls,tables,background,inventory,request,set latest(v:Row|null){latest=v;},set deny(v:boolean){deny=v;},set inventoryError(v:boolean){inventoryError=v;},set beginError(v:string){beginError=v;},set finishError(v:boolean){finishError=v;}};
}
Deno.test('document contract rejects unknown modes, malformed hashes and untrusted extra instructions',()=>{
 for(const value of [null,{}, {mode:'partial',context_hash:contextHash},{mode:'readable',context_hash:'bad'},{mode:'readable',context_hash:contextHash,ignore_errors:true}])assertThrows(()=>documentAnalysisRequest(value));
 assertEquals(documentAnalysisRequest({context_hash:contextHash,mode:'readable'}),{mode:'readable',context_hash:contextHash});
 assertEquals(documentAnalysisRequest(undefined),undefined);
});
Deno.test('inventory rejects missing counts, duplicate IDs and legacy response contracts',async()=>fixture(async f=>{
 const data=await f.inventory();assertEquals(documentAnalysisInventory(data).documents.length,2);
 for(const invalid of [{...data,contract:0},{...data,readable_email_count:null},{...data,documents:[data.documents[0],data.documents[0]]}])assertThrows(()=>documentAnalysisInventory(invalid));
}));
Deno.test('loaded source content must match every readable server source before any fact work',async()=>{
 const doc={id:'d',file_name:'invoice.txt',document_type:'invoice',extracted_text:'5'},email={id:'e',body_text:'Hi',from_address:'client@example.test',to_addresses:[],subject:'RFQ',sent_at:null,is_quotation_request:null};
 const sources={documents:[{id:'d',name:'invoice.txt',document_type:'invoice',readable:true,text_hash:await digest('5')}],emails:[{...email,text_hash:await digest('Hi')}]};
 await assertLoadedDocumentSources(sources,[doc],[email]);
 await assertRejects(()=>assertLoadedDocumentSources(sources,[{...doc,extracted_text:'6'}],[email]));
 await assertRejects(()=>assertLoadedDocumentSources(sources,[],[email]));
 await assertRejects(()=>assertLoadedDocumentSources(sources,[doc],[{...email,body_text:'Changed'}]));
 assertEquals(readableCaseDocuments([{extracted_text:null},{extracted_text:'[OCR vide]'},{extracted_text:'5'}]),[{extracted_text:'5'}]);
});
Deno.test('content failure returns a retained-source offer only under the explicit new contract',()=>fixture(async f=>{
 const strict=await handleBackfillCaseDocuments(f.request({case_id:'case'}));assertEquals(strict.status,503);assertEquals((await strict.json()).analysis_offer,undefined);
 const response=await handleBackfillCaseDocuments(f.request({case_id:'case',analysis_contract:1})),body=await response.json();
 assertEquals(response.status,503);assertEquals(body.success,false);assertEquals(body.extraction.code,'OCR_NOT_CONFIGURED');assertEquals(body.remaining,1);
 assertEquals(documentAnalysisInventory(body.analysis_offer).documents.filter(d=>d.readable).length,1);
 assertEquals(f.docs[0].extracted_text,null);assert(!f.calls.some(c=>c.method==='DELETE'||c.method==='PATCH'));
}));
Deno.test('inventory inspection performs no extraction or business write; a failed inventory never grants a partial offer',()=>fixture(async f=>{
 const response=await handleBackfillCaseDocuments(f.request({case_id:'case',mode:'inspect',document_id:'__inspect_only_no_extraction__'}));assertEquals(response.status,200);assertEquals((await response.json()).success,true);
 assert(!f.calls.some(c=>c.path.includes('/functions/v1/parse-document')));
 f.inventoryError=true;const refused=await handleBackfillCaseDocuments(f.request({case_id:'case',analysis_contract:1}));assertEquals(refused.status,503);assertEquals((await refused.json()).analysis_offer,undefined);
}));
Deno.test('admission refusal blocks both inspection and fallback before any source access',()=>fixture(async f=>{
 f.deny=true;assertEquals((await handleBackfillCaseDocuments(f.request({case_id:'case',mode:'inspect'}))).status,403);
 assert(!f.calls.some(c=>c.path.endsWith('/case_document_analysis_inspect')));
}));
Deno.test('successful extraction on the same source prepares complete reanalysis rather than declaring business success',()=>fixture(async f=>{
 f.docs[0].extracted_text='SYNTHETIC recovered OCR';const r=await handleBackfillCaseDocuments(f.request({case_id:'case',analysis_contract:1})),body=await r.json();
 assertEquals(r.status,200);assertEquals(body.remaining,0);assertEquals(body.document_analysis,{mode:'complete',context_hash:contextHash});assertEquals(f.docs.length,2);
}));
for(const mode of ['readable','complete'])Deno.test('actual synchronous builder records '+mode+' coverage while protecting manual and validated facts',()=>fixture(async f=>{
 if(mode==='complete')f.docs[0].extracted_text='SYNTHETIC recovered source';
 const facts=JSON.stringify(f.facts);const r=await buildCasePuzzleHandler(f.request({case_id:'case',document_analysis:{mode,context_hash:contextHash}})),body=await r.json();
 assertEquals(r.status,200,JSON.stringify(body));assertEquals(body.document_analysis.state,mode==='readable'?'partial':'complete');
 if(mode==='readable')assertEquals(body.ready_to_price,false);
 assertEquals(JSON.stringify(f.facts),facts);
 assert(!f.calls.some(c=>c.path.endsWith('/supersede_fact')&&['cargo.weight_kg','cargo.pieces_count'].includes(String((c.body as Row)?.p_fact_key))));
 assertEquals(f.docs.length,2);assert(!f.calls.some(c=>c.method==='DELETE'&&c.path.endsWith('/case_documents')));
}));
Deno.test('reservation refusal stops the actual builder before automatic facts, and finalization refusal never becomes success',()=>fixture(async f=>{
 f.beginError='SYNTHETIC No readable source';let response=await buildCasePuzzleHandler(f.request({case_id:'case',document_analysis:{mode:'readable',context_hash:contextHash}}));assertEquals(response.status,409);
 assert(!f.calls.some(c=>c.path.endsWith('/supersede_fact')));
 f.beginError='';f.finishError=true;response=await buildCasePuzzleHandler(f.request({case_id:'case',document_analysis:{mode:'readable',context_hash:contextHash}}));assertEquals(response.status,409);
 assert(f.calls.some(c=>c.path.endsWith('/case_document_analysis_fail')));
}));
Deno.test('async start propagates exact consent and polling uses the immutable result, not an editable job payload',()=>fixture(async f=>{
 const request={mode:'readable',context_hash:contextHash};const started=await buildCasePuzzleHandler(f.request({case_id:'case',mode:'start',document_analysis:request})),body=await started.json();
 assertEquals(started.status,200);await Promise.all(f.background);
 const job=f.tables.case_puzzle_jobs.find(j=>j.id===body.job_id)!;assertEquals((job.request_params as Row).document_analysis,request);assertEquals(job.status,'completed');
 const self=f.calls.find(c=>c.path==='/functions/v1/build-case-puzzle')!.body as Row;assertEquals(self.document_analysis,request);assertEquals(self.document_analysis_job_id,job.id);
 job.final_result={ready_to_price:true};const polled=await buildCasePuzzleHandler(f.request({mode:'poll',job_id:job.id})),saved=await polled.json();
 assertEquals(polled.status,200);assertEquals(saved.final_result.ready_to_price,false);assertEquals(saved.final_result.document_analysis.state,'partial');
 for(const status of ['running','failed']){
  job.status=status;const recovered=await buildCasePuzzleHandler(f.request({mode:'poll',job_id:job.id})),result=await recovered.json();
  assertEquals(recovered.status,200);assertEquals(result.status,'completed');assertEquals(result.final_result.document_analysis.state,'partial');
 }
}));
Deno.test('implicit legacy analysis cannot reuse managed coverage or claim source completeness',()=>fixture(async f=>{
 const inventory=await f.inventory();f.latest={id:'attempt',mode:'complete',state:'complete',context_hash:contextHash,documents:inventory.documents,sources_changed:true};
 const response=await buildCasePuzzleHandler(f.request({case_id:'case'}));assertEquals(response.status,409);
 assert(!f.calls.some(c=>c.path.endsWith('/supersede_fact')||c.path.endsWith('/case_document_analysis_begin')||c.method==='PATCH'));
}));
Deno.test('only historical email quotation and an unreadable manual image cannot finalize any usable analysis',()=>fixture(async f=>{
 f.docs.splice(1);f.tables.quote_cases[0].thread_id='thread';
 f.tables.emails.push({id:'email',thread_ref:'thread',from_address:'client@example.test',to_addresses:[],subject:'RFQ',sent_at:null,is_quotation_request:null,body_text:'> Old historical quote\n> 250 kg'});
 const response=await buildCasePuzzleHandler(f.request({case_id:'case',document_analysis:{mode:'readable',context_hash:contextHash}})),body=await response.json();
 assertEquals(response.status,409,JSON.stringify(body));assert(f.calls.some(c=>c.path.endsWith('/case_document_analysis_fail')));
 assert(!f.calls.some(c=>c.path.endsWith('/supersede_fact')||c.path.endsWith('/case_document_analysis_finish')));
}));
Deno.test('lost failed-job acknowledgement converges to durable failure and permits an explicit new start',()=>fixture(async f=>{
 f.finishError=true;const selected={mode:'readable',context_hash:contextHash};
 const start=await buildCasePuzzleHandler(f.request({case_id:'case',mode:'start',document_analysis:selected})),first=await start.json();await Promise.all(f.background);
 const job=f.tables.case_puzzle_jobs.find(j=>j.id===first.job_id)!;job.status='running';
 const poll=await buildCasePuzzleHandler(f.request({mode:'poll',job_id:job.id})),failed=await poll.json();assertEquals(poll.status,200);assertEquals(failed.status,'failed');assertEquals(failed.final_result,null);
 f.finishError=false;const retry=await buildCasePuzzleHandler(f.request({case_id:'case',mode:'start',document_analysis:selected})),next=await retry.json();
 assertEquals(retry.status,200);assert(next.job_id!==first.job_id);await Promise.all(f.background);assertEquals(job.status,'failed');
}));
