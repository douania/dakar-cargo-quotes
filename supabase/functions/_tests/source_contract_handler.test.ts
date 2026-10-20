import {assert,assertEquals} from 'https://deno.land/std@0.224.0/assert/mod.ts';
Deno.env.set('BUILD_CASE_PUZZLE_DISABLE_SERVE','1');
const {buildCasePuzzleHandler}=await import('../build-case-puzzle/index.ts');
for(const failure of [null,'evidence_read','gap_write','evidence_write'] as const)Deno.test('source contract actual builder: '+(failure??'fresh RFQ, no provider'),async()=>{
 const saved=globalThis.fetch,keys=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','LOVABLE_API_KEY'],env=keys.map(k=>Deno.env.get(k));
 Deno.env.set(keys[0],'https://fixture.invalid');Deno.env.set(keys[1],'synthetic-anon');Deno.env.set(keys[2],'synthetic-service');Deno.env.delete(keys[3]);
 const request={id:'case',status:'FACTS_PARTIAL',thread_id:'thread',request_type:'SEA_LCL_IMPORT',email_threads:{id:'thread',client_email:'client@fixture.invalid',subject_normalized:'Sea freight request'}};
 const tables:Record<string,Array<Record<string,unknown>>>={quote_facts:[],quote_gaps:[],case_timeline_events:[],external_quote_requests:[],client_gap_requests:[],
  emails:[{id:'original',thread_ref:'thread',from_address:'client@fixture.invalid',sent_at:'2026-10-16T05:00:00Z',subject:'Sea freight request',body_text:"No. of containers: 1 x 40’HC'\nPlace of delivery: Bunia, DR Congo via Mombasa Kenya\nCommodity: 2 vehicles\nExcluded\nExport customs clearance\nImport customs clearance\nSubmission deadline: Monday 19h October, 12:00 AM UAE time"}],
  email_attachments:[{id:'rfq',email_id:'original',filename:'RFQ-LOCAL.pdf',content_type:'application/pdf',is_analyzed:true,
   extracted_text:'1 Bid Submission Deadline: 19.10.2026 12:00 UAE time\nIncluded\nExport customs clearance\nExcluded\nImport customs clearance\nWe reserve the right to accept the whole or part of your offer.\n3 Deadline for submission: Monday 19th October 2026 10:00 UAE time.',
   extracted_data:{extracted_info:{origine:'Dakar',origine_country:'Senegal',destination:'Bunia',destination_country:'DR Congo',incoterms:'DAP',number_of_containers:"1x40'HC"}}}]};
 const calls:string[]=[];let sequence=0;
 const matches=(row:Record<string,unknown>,u:URL)=>[...u.searchParams].every(([key,value])=>{
  if(['select','order','limit','offset','or','and'].includes(key))return true;
  const actual=key==='event_data->>kind'?(row.event_data as {kind?:unknown})?.kind:row[key];
  if(value.startsWith('eq.'))return String(actual)===value.slice(3);
  if(value.startsWith('in.('))return value.slice(4,-1).split(',').includes(String(actual));return true;
 });
 globalThis.fetch=async(input,init)=>{
  const req=new Request(input,init),u=new URL(req.url),name=u.pathname.split('/').pop()!,method=req.method;assertEquals(u.hostname,'fixture.invalid');calls.push(method+' '+name);
  const json=(v:unknown,count=0)=>new Response(method==='HEAD'?null:JSON.stringify(v),{headers:{'Content-Type':'application/json','Content-Range':`0-${Math.max(0,count-1)}/${count}`}});
  const denied=()=>new Response(JSON.stringify({message:'synthetic contract failure',code:'42501'}),{status:400,headers:{'Content-Type':'application/json'}});
  if(name==='user')return json({id:'operator',email:'operator@fixture.invalid'});
  if(name==='has_workspace_access')return json(true);
  if(name==='case_document_analysis_inspect')return json({contract:1,scope:'manual_case_documents',context_hash:'a'.repeat(32),documents:[],readable_email_count:0,latest:null});
  if(name==='apply_case_email_fact_revisions'){
   const args=await req.json(),decisions=[];
   for(const g of args.p_groups){const c=g.candidates[0],id='fact-'+g.key;
    if(!tables.quote_facts.some(f=>f.fact_key===g.key))tables.quote_facts.push({id,case_id:'case',fact_key:g.key,fact_category:g.category,value_text:c.value_type==='text'?c.value:null,value_json:c.value_type==='json'?c.value:null,source_type:c.source_type,source_email_id:c.email_id,source_excerpt:c.excerpt,source_revision_id:'revision-'+g.key,is_current:true,is_validated:false});
    decisions.push({key:g.key,status:'applied',reason:'memory-only source capture',fact_id:id,changed:true,replay:false});
   }return json({decisions});
  }
  if(name==='supersede_fact'){
   const a=await req.json(),existing=tables.quote_facts.find(f=>f.fact_key===a.p_fact_key);
   if(existing&&(existing.source_revision_id||existing.source_type==='manual_input'||existing.is_validated))return json(existing.id);
   const row={id:'fact-'+a.p_fact_key,case_id:'case',fact_key:a.p_fact_key,fact_category:a.p_fact_category,value_text:a.p_value_text,value_json:a.p_value_json,value_number:a.p_value_number,source_type:a.p_source_type,source_email_id:a.p_source_email_id,source_attachment_id:a.p_source_attachment_id,is_current:true,is_validated:false};
   if(existing)Object.assign(existing,row);else tables.quote_facts.push(row);return json(row.id);
  }
  if(u.pathname.includes('/rpc/'))return json([]);
  if(name==='quote_cases'){if(method==='PATCH')Object.assign(request,await req.json());return json(request);}
  if(name==='location_aliases')return json([{locations_reference:{canonical_name:'Mombasa',location_type:'sea',is_active:true}}]);
  if(failure==='evidence_read'&&name==='case_timeline_events'&&u.searchParams.has('event_data->>kind'))return denied();
  const rows=tables[name];if(rows){
   if(method==='POST'){
    const body=await req.json();
    if(name==='quote_gaps'&&!(Array.isArray(body)?body:[body]).every((g:{gap_category?:string})=>['cargo','routing','timing','pricing','documents','contacts','other'].includes(g.gap_category||'')))
     return new Response(JSON.stringify({message:'quote_gaps_gap_category_check',code:'23514'}),{status:400,headers:{'Content-Type':'application/json'}});
    if(failure==='gap_write'&&name==='quote_gaps'&&String(body.gap_key).startsWith('source_contract.'))return denied();
    if(failure==='evidence_write'&&name==='case_timeline_events'&&body.event_data?.kind==='source_contract_review')return denied();
    const added=(Array.isArray(body)?body:[body]).map((row,i)=>({id:'local-'+name+'-'+rows.length+'-'+i,created_at:new Date(Date.UTC(2026,9,19)+sequence++).toISOString(),...row}));
    for(const row of added)if(!rows.some(r=>r.id===row.id))rows.push(row);
    if(req.headers.get('Prefer')?.includes('return=representation'))return json(req.headers.get('Accept')?.includes('vnd.pgrst.object')?added[0]:added,added.length);
    return json(null);
   }
   if(method==='PATCH'){const data=await req.json(),found=rows.filter(r=>matches(r,u));found.forEach(r=>Object.assign(r,data));return json(req.headers.get('Accept')?.includes('vnd.pgrst.object')?found[0]??null:found,found.length);}
   let found=rows.filter(r=>matches(r,u));
   if(u.searchParams.get('order')==='created_at.desc')found.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
   if(u.searchParams.has('limit'))found=found.slice(0,Number(u.searchParams.get('limit')));
   return json(req.headers.get('Accept')?.includes('vnd.pgrst.object')?found[0]??null:found,found.length);
  }
  return json(req.headers.get('Accept')?.includes('vnd.pgrst.object')?null:[]);
 };
 try{
  const invoke=()=>buildCasePuzzleHandler(new Request('https://fixture.invalid/build-case-puzzle',{method:'POST',headers:{Authorization:'Bearer synthetic-token','Content-Type':'application/json'},body:JSON.stringify({case_id:'case'})}));
  const r=await invoke(),body=await r.json();
  if(failure){assertEquals(r.status,500,JSON.stringify(body));assert(request.status!=='READY_TO_PRICE');return;}
  assertEquals(r.status,200,JSON.stringify(body));assertEquals(request.request_type,'SEA_FCL_IMPORT');assertEquals(request.status,'NEED_INFO');
  assertEquals(tables.quote_facts.find(f=>f.fact_key==='cargo.containers')?.value_json,[{quantity:1,type:'40HC'}]);
  assertEquals(tables.quote_facts.find(f=>f.fact_key==='routing.destination_port')?.value_text,undefined);
  const contracts=tables.quote_gaps.filter(g=>String(g.gap_key).startsWith('source_contract.'));assertEquals(contracts.length,2);assert(contracts.every(g=>g.status==='open'&&g.is_blocking));
  assert(!tables.quote_gaps.some(g=>g.gap_key==='routing.shipment_mode_clarification'&&g.status==='open'));
  const drafts=tables.external_quote_requests;assertEquals(drafts.length,1);assert(String(drafts[0].purpose_detail).includes('Bunia'));assert(!String(drafts[0].purpose_detail).includes('Mombasa'));assert(String(drafts[0].purpose_detail).includes('1x40HC'));assertEquals(drafts[0].status,'draft');
  const e=tables.case_timeline_events.filter(e=>(e.event_data as {kind?:string})?.kind==='source_contract_review');assertEquals(e.length,1);
  const second=await invoke();assertEquals(second.status,200);assertEquals(tables.external_quote_requests.length,1);
  assertEquals(tables.case_timeline_events.filter(e=>(e.event_data as {kind?:string})?.kind==='source_contract_review').length,1);
  const originalText=tables.emails[0].body_text;
  tables.emails[0].body_text=String(originalText)+'\nAdditional readable source statement.';
  assertEquals((await invoke()).status,200);
  tables.emails[0].body_text=originalText;
  assertEquals((await invoke()).status,200);
  assertEquals((await invoke()).status,200);
  const reviews=tables.case_timeline_events.filter(e=>(e.event_data as {kind?:string})?.kind==='source_contract_review');
  assertEquals(reviews.length,3);assertEquals(new Set(reviews.map(e=>e.id)).size,3);
  const fingerprints=reviews.map(e=>(e.event_data as {fingerprint:string}).fingerprint);
  assertEquals(fingerprints[0],fingerprints[2]);assert(fingerprints[0]!==fingerprints[1]);
  assertEquals((reviews[1].event_data as {previous_contract_event_id:string}).previous_contract_event_id,reviews[0].id);
  assertEquals((reviews[2].event_data as {previous_contract_event_id:string}).previous_contract_event_id,reviews[1].id);
  assertEquals(tables.external_quote_requests.length,1);
  assertEquals(tables.quote_gaps.filter(g=>String(g.gap_key).startsWith('source_contract.')&&g.status==='open').length,2);
  assert(!calls.some(x=>/send|run-pricing|quotation|pdf/i.test(x)));
 }finally{globalThis.fetch=saved;keys.forEach((k,i)=>env[i]===undefined?Deno.env.delete(k):Deno.env.set(k,env[i]!));}
});
