// Actual Edge handler code, transpiled unchanged. Only platform/Auth/DB/AI are
// doubles; no network, real credentials, or customer data. Not a Cloud recipe.
import { createHash } from 'node:crypto';
import legacyFixture from './fixtures/client-gap-legacy-776d1af.json';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { beforeEach, expect, it } from 'vitest';
import * as gapScope from '../../supabase/functions/_shared/client-gap-scope';
import * as policy from '../../supabase/functions/_shared/client-gap-policy';
import * as review from './padGapReview';

type Row=Record<string,unknown>;
type Version='legacy'|'candidate';
const gates=new Map<string,{skip:number;enter:()=>void;wait:Promise<void>}>();
function gate(version:Version,table:string,op:string,skip=0){let entered!:()=>void,release!:()=>void;const entry=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);gates.set(`${version}:${table}:${op}`,{skip,enter:entered,wait});return {entered:entry,release};}
const baseline=(name:string)=>{const source=(legacyFixture.files as Record<string,string>)[`supabase/functions/${name}`];if(typeof source!=='string')throw Error(`Missing pinned fixture: ${name}`);return source;};
function pure(name:string,version:Version):Record<string,unknown>{if(version==='candidate'&&name==='client-gap-policy.ts')return policy as unknown as Record<string,unknown>;const exports={};const source=version==='legacy'?baseline(`_shared/${name}`):readFileSync(`supabase/functions/_shared/${name}`,'utf8');vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:(path:string)=>path.endsWith('client-gap-policy.ts')?pure('client-gap-policy.ts',version):path.endsWith('client-gap-scope.ts')?gapScope:(()=>{throw Error(path);})()});return exports;}
let db:Record<string,Row[]>, writes:{table:string;op:string}[], seq:number, failTable:string|null, unavailableTable:string|null, authOk:boolean;
const pad='pricing.pad_category', weight='cargo.weight_kg';
const action=(keys:string[],status='open')=>({id:'action',case_id:'c',event_type:'manual_action',created_at:++seq,
  event_data:{action_code:'REQUEST_CLIENT_INFO_FOR_GAPS',dedupe_key:`REQUEST_CLIENT_INFO_FOR_GAPS:c:${keys.slice().sort().join(',')}`,requested_gap_keys:keys,status}});
function seed(keys:string[]=[pad]) {
  db.quote_gaps=keys.map(gap_key=>({case_id:'c',gap_key,status:'open',is_blocking:true}));
  const a=action(keys);db.case_timeline_events.push(a);
  const ed=a.event_data as Row;
  db.case_timeline_events.push({id:'old-draft',case_id:'c',event_type:'output_generated',created_at:++seq,event_data:{
    kind:'reply_draft_v1',dedupe_key:`reply_draft_v1:${ed.dedupe_key}`,source_action_dedupe_key:ed.dedupe_key,
    requested_gap_keys:keys,draft_reply:{subject:'old',body:'OLD GENERIC PAD QUESTION'}}});
  db.client_gap_requests=keys.map((gap_key,i)=>({id:`r${i}`,case_id:'c',gap_key,status:'drafted',source_timeline_event_id:'old-draft'}));
  return ed.dedupe_key as string;
}
function query(table:string,version:Version) {
  const filters:((r:Row)=>boolean)[]=[]; let op='select', payload:Row|undefined, sortKey='',desc=false,limit=Infinity,single=false;
  const q={select:()=>q,eq:(k:string,v:unknown)=>{filters.push(r=>r[k]===v);return q;},
    in:(k:string,v:unknown[])=>{filters.push(r=>v.includes(r[k]));return q;},
    order:(k:string,o:{ascending:boolean})=>{sortKey=k;desc=!o.ascending;return q;},limit:(n:number)=>{limit=n;return q;},
    maybeSingle:()=>{single=true;return q;},single:()=>{single=true;return q;},
    update:(p:Row)=>{op='update';payload=p;return q;},insert:(p:Row)=>{op='insert';payload=p;return q;},
    then:async(resolve:(v:unknown)=>unknown)=>{
      const barrier=gates.get(`${version}:${table}:${op}`);if(barrier){if(barrier.skip)barrier.skip--;else{gates.delete(`${version}:${table}:${op}`);barrier.enter();await barrier.wait;}}
      if(unavailableTable===table)return Promise.resolve(resolve({data:null,error:null}));
      if(failTable===table)return Promise.resolve(resolve({data:null,error:{message:'injected read/write failure'}}));
      if(!db[table])throw Error(`Unexpected table ${table}`);
      let rows=db[table].filter(r=>filters.every(f=>f(r)));
      if(table==='quote_gaps'&&op==='select')rows=rows.map(r=>({id:r.id??`scope-${r.gap_key}`,...r}));
      if(sortKey)rows=rows.slice().sort((a,b)=>(Number(a[sortKey])-Number(b[sortKey]))*(desc?-1:1));
      rows=rows.slice(0,limit);
      if(op!=='select')writes.push({table,op});
      if(op==='insert'){if(table==='client_gap_requests'&&db[table].some(r=>r.case_id===payload?.case_id&&r.gap_key===payload?.gap_key&&['drafted','sent','answered'].includes(String(r.status))))return resolve({data:null,error:{code:'23505',message:'synthetic active partial unique index'}});const row:Row={id:`new-${++seq}`,created_at:seq,...structuredClone(payload)};if(table==='case_timeline_events'&&(row.event_data as Row)?.client_question_policy_version===4)(row.event_data as Row).client_gap_fence_version=1;db[table].push(row);rows=[row];}
      if(op==='update')rows.forEach(r=>Object.assign(r,structuredClone(payload)));
      return Promise.resolve(resolve({data:structuredClone(single?(rows[0]??null):rows),error:null}));
    }};
  return q;
}
function handler(name:string,version:Version='candidate') {
  let captured:((r:Request)=>Promise<Response>)|undefined;
  const jsonResponse=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  const source=ts.transpileModule((version==='legacy'?baseline(`${name}/index.ts`):readFileSync(`supabase/functions/${name}/index.ts`,'utf8')),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{exports:{},console,Response,Request,Date,Set,Map,
    Deno:{env:{get:()=> 'fake-local'},serve:(fn:typeof captured)=>{captured=fn;}},
    require:(path:string)=>{
      if(path.endsWith('/http/server.ts'))return {serve:(fn:typeof captured)=>{captured=fn;}};
      if(path==='jsr:@supabase/supabase-js@2')return {createClient:()=>({from:(table:string)=>query(table,version)})};
      if(path.endsWith('/air-cross-trade-service.ts'))return {readAirCrossTradeRequirements:async()=>{throw Error('Unexpected Cross qualification read in a legacy fixture');}};
      if(path.endsWith('/auth.ts'))return {requireUser:async()=>authOk?{user:{id:'operator'}}:new Response('{}',{status:401})};
      if(path.endsWith('/cors.ts'))return {handleCors:()=>null,jsonResponse,errorResponse:(error:string,status:number)=>jsonResponse({error},status)};
      if(path.endsWith('/client-gap-scope.ts'))return gapScope;
      if(path.endsWith('/client-gap-policy.ts'))return version==='legacy'?pure('client-gap-policy.ts',version):policy;
      if(path.endsWith('/pad-gap-review.ts'))return version==='legacy'?pure('pad-gap-review.ts',version):review;
      if(path.endsWith('/language-detection.ts'))return {detectLanguage:()=> 'fr',normalizeTextForLanguageDetection:(s:string)=>s};
      if(path.endsWith('/ai-client.ts')||path.endsWith('/json-parser.ts'))return new Proxy({},{get:()=>()=>{throw Error('AI must not be called');}});
      throw Error(`Unexpected import ${path}`);
    }});
  if(!captured)throw Error('Handler not registered');
  return async(body:Row)=>{const response=await captured!(new Request('https://local.invalid',{method:'POST',body:JSON.stringify(body)}));
    return {status:response.status,body:await response.json()};};
}
beforeEach(()=>{gates.clear();seq=10;writes=[];failTable=null;unavailableTable=null;authOk=true;db={quote_cases:[{id:'c',thread_id:null}],quote_gaps:[],case_timeline_events:[],client_gap_requests:[]};});


// These are counterexample tests: passing asserts a real limitation, not a safe rollout.
it('legacy producer returns success while the strict candidate reader hides its body',async()=>{
 db.quote_gaps=[{case_id:'c',gap_key:weight,status:'open',is_blocking:true}];
 db.case_timeline_events.push(action([weight]));
 const key=(db.case_timeline_events[0].event_data as Row).dedupe_key;
 const result=await handler('generate-reply-draft','legacy')({case_id:'c',action_dedupe_key:key});
 expect(result.body.ok).toBe(true);
 const source=db.case_timeline_events.find(e=>e.event_type==='output_generated')!.event_data as Row;
 expect((pure('pad-gap-review.ts','legacy').isObsoletePadDraft as (x:Row)=>boolean)(source)).toBe(false);
 expect(review.isObsoletePadDraft(source,[weight])).toBe(true);
 expect((source.draft_reply as Row).body).toBeTruthy();
});
it('legacy sync cannot resolve the strict generator optional-scope mismatch',async()=>{
 db.quote_gaps=[{case_id:'c',gap_key:weight,status:'open',is_blocking:true},{case_id:'c',gap_key:'cargo.value',status:'open',is_blocking:false}];
 const sync=handler('sync-gap-client-actions','legacy'),generate=handler('generate-reply-draft');
 const a=await sync({case_id:'c'});
 expect(a.body.requested_gap_keys).toEqual([weight,'cargo.value'].sort());
 expect((await generate({case_id:'c',action_dedupe_key:a.body.dedupe_key})).body.error).toBe('ACTION_REQUIRES_GAP_SYNC');
 await sync({case_id:'c'});
 expect((await generate({case_id:'c',action_dedupe_key:a.body.dedupe_key})).body.error).toBe('ACTION_REQUIRES_GAP_SYNC');
});
it('actual legacy sync does not cancel a valid nonPAD v3 draft merely because optional gaps exist',async()=>{
 db.quote_gaps=[{case_id:'c',gap_key:weight,status:'open',is_blocking:true},{case_id:'c',gap_key:'cargo.value',status:'open',is_blocking:false}];
 const a=await handler('sync-gap-client-actions')({case_id:'c'});
 await handler('generate-reply-draft')({case_id:'c',action_dedupe_key:a.body.dedupe_key});
 const row=structuredClone(db.client_gap_requests[0]),event=JSON.stringify(db.case_timeline_events.find(e=>e.id===row.source_timeline_event_id));
 await handler('sync-gap-client-actions','legacy')({case_id:'c'});
 expect(db.client_gap_requests[0]).toEqual(row);expect(JSON.stringify(db.case_timeline_events.find(e=>e.id===row.source_timeline_event_id))).toBe(event);
});
it('late legacy row is detected without false success; replay repairs v3 tracking without duplicate output',async()=>{
 db.quote_gaps=[{case_id:'c',gap_key:weight,status:'open',is_blocking:true}];db.case_timeline_events.push(action([weight]));
 const key=(db.case_timeline_events[0].event_data as Row).dedupe_key;
 const oldGate=gate('legacy','case_timeline_events','insert');
 const old=handler('generate-reply-draft','legacy')({case_id:'c',action_dedupe_key:key});await oldGate.entered;
 const newGate=gate('candidate','client_gap_requests','select',1);
 const modern=handler('generate-reply-draft')({case_id:'c',action_dedupe_key:key});await newGate.entered;
 oldGate.release();expect((await old).body.ok).toBe(true);newGate.release();expect((await modern).body).toMatchObject({ok:false,error:'CLIENT_GAP_BINDING_CONFLICT'});
 const outputs=db.case_timeline_events.filter(e=>e.event_type==='output_generated');expect(outputs).toHaveLength(2);
 const linked=db.case_timeline_events.find(e=>e.id===db.client_gap_requests[0].source_timeline_event_id)!.event_data as Row;
 expect(linked.client_question_policy_version).toBeUndefined();
 const history=JSON.stringify(outputs);
 await handler('sync-gap-client-actions')({case_id:'c'});
 expect(db.client_gap_requests.every(r=>r.status==='cancelled')).toBe(true);
 const replay=await handler('generate-reply-draft')({case_id:'c',action_dedupe_key:key});
 expect(replay.body).toMatchObject({ok:true,idempotent:true});
 const active=db.client_gap_requests.filter(r=>['drafted','sent','answered'].includes(String(r.status)));expect(active).toHaveLength(1);
 const linkedV3=db.case_timeline_events.find(e=>e.id===active[0].source_timeline_event_id)!.event_data as Row;expect(linkedV3.client_question_policy_version).toBe(4);
 expect(JSON.stringify(db.case_timeline_events.filter(e=>e.event_type==='output_generated'))).toBe(history);
});
it('historical clean legacy acknowledgement survives upgrade; no source or body is rewritten',async()=>{
 seed([weight]);const original=JSON.stringify(db.case_timeline_events);
 expect((await handler('mark-client-gap-request-sent')({case_id:'c',gap_keys:[weight]})).body.updated).toBe(1);
 expect(db.client_gap_requests[0].status).toBe('sent');
 expect((await handler('mark-client-gap-request-sent','legacy')({case_id:'c',gap_keys:[weight]})).body.updated).toBe(0);
 expect(JSON.stringify(db.case_timeline_events)).toBe(original);
});

// Every combination is characterized; success of this test is not rollout approval.
for(const syncVersion of ['legacy','candidate'] as const)for(const generateVersion of ['legacy','candidate'] as const)for(const markVersion of ['legacy','candidate'] as const)for(const uiVersion of ['legacy','candidate'] as const)
 it(`matrix sync=${syncVersion} generate=${generateVersion} mark=${markVersion} reader=${uiVersion}`,async()=>{
  const key=seed([weight]);const original=JSON.stringify(db.case_timeline_events.find(e=>e.id==='old-draft'));
  db.client_gap_requests.push({id:'sent',case_id:'c',gap_key:'cargo.value',status:'sent'},{id:'answered',case_id:'c',gap_key:'cargo.hs_code',status:'answered'});
  const followup=JSON.stringify(db.client_gap_requests.slice(1));
  await handler('sync-gap-client-actions',syncVersion)({case_id:'c'});
  const result=await handler('generate-reply-draft',generateVersion)({case_id:'c',action_dedupe_key:key});
  const reader=uiVersion==='legacy'?pure('pad-gap-review.ts','legacy'):review;
  const active=db.client_gap_requests.find(r=>r.status==='drafted');
  const source=db.case_timeline_events.find(e=>e.id===active?.source_timeline_event_id)?.event_data as Row|undefined;
  const visible=!!source&&!(reader.isObsoletePadDraft as (x:Row,k:string[])=>boolean)(source,[weight]);
  const needsSync=syncVersion==='legacy'&&generateVersion==='candidate';
  expect(result.body.ok===true).toBe(!needsSync);
  // A failed new generation does not erase the old body still visible to an old reader.
  expect(visible).toBe(uiVersion==='legacy'||(syncVersion==='candidate'&&generateVersion==='candidate'));
  if(result.body.ok){const mark=await handler('mark-client-gap-request-sent',markVersion)({case_id:'c',gap_keys:[weight],expected_requests:active?[{gap_key:weight,request_id:active.id,source_timeline_event_id:active.source_timeline_event_id}]:[]});
   expect(mark.body.updated).toBe(1);}
  expect(JSON.stringify(db.case_timeline_events.find(e=>e.id==='old-draft'))).toBe(original);
  expect(JSON.stringify(db.client_gap_requests.filter(r=>r.id==='sent'||r.id==='answered'))).toBe(followup);
 });
it('23505 from a same-source racing insert is confirmed by re-read without a second insertion',async()=>{
 db.quote_gaps=[{case_id:'c',gap_key:weight,status:'open',is_blocking:true}];db.case_timeline_events.push(action([weight]));
 const key=(db.case_timeline_events[0].event_data as Row).dedupe_key;
 const barrier=gate('candidate','client_gap_requests','insert');const pending=handler('generate-reply-draft')({case_id:'c',action_dedupe_key:key});await barrier.entered;
 const event=db.case_timeline_events.find(e=>(e.event_data as Row).client_question_policy_version===4)!;
 db.client_gap_requests.push({id:'race',case_id:'c',gap_key:weight,status:'drafted',source_timeline_event_id:event.id});
 barrier.release();expect((await pending).body.ok).toBe(true);expect(db.client_gap_requests).toHaveLength(1);
 expect(writes.filter(w=>w.table==='client_gap_requests')).toHaveLength(1);
});
it('23505 from a different-source race is a conflict and never overwrites the winning source',async()=>{
 db.quote_gaps=[{case_id:'c',gap_key:weight,status:'open',is_blocking:true}];db.case_timeline_events.push(action([weight]));
 const key=(db.case_timeline_events[0].event_data as Row).dedupe_key;
 const barrier=gate('candidate','client_gap_requests','insert');const pending=handler('generate-reply-draft')({case_id:'c',action_dedupe_key:key});await barrier.entered;
 const winner={id:'race',case_id:'c',gap_key:weight,status:'drafted',source_timeline_event_id:'other-source'};db.client_gap_requests.push(winner);
 barrier.release();expect((await pending).body).toMatchObject({ok:false,error:'CLIENT_GAP_BINDING_CONFLICT'});
 expect(db.client_gap_requests).toEqual([winner]);expect(writes.filter(w=>w.table==='client_gap_requests')).toHaveLength(1);
});
it('without the DB fence a stale candidate sync can still cancel newer scope; mocks are not atomic evidence',async()=>{
 db.quote_gaps=[{case_id:'c',gap_key:weight,status:'open',is_blocking:true},{case_id:'c',gap_key:'cargo.value',status:'open',is_blocking:true}];
 const barrier=gate('candidate','case_timeline_events','select',1);
 const stale=handler('sync-gap-client-actions')({case_id:'c'});await barrier.entered;
 db.quote_gaps[1].is_blocking=false;
 const current=await handler('sync-gap-client-actions')({case_id:'c'});
 expect(current.body.requested_gap_keys).toEqual([weight]);
 await handler('generate-reply-draft')({case_id:'c',action_dedupe_key:current.body.dedupe_key});
 const sourceId=db.client_gap_requests[0].source_timeline_event_id,original=JSON.stringify(db.case_timeline_events.find(e=>e.id===sourceId));
 barrier.release();await stale;
 expect(db.quote_gaps[1].is_blocking).toBe(false);
 expect(db.client_gap_requests[0].status).toBe('cancelled');
 expect(JSON.stringify(db.case_timeline_events.find(e=>e.id===sourceId))).toBe(original);
 await handler('sync-gap-client-actions')({case_id:'c'});
 const replay=await handler('generate-reply-draft')({case_id:'c',action_dedupe_key:current.body.dedupe_key});expect(replay.body).toMatchObject({ok:true,idempotent:true});
 expect(db.client_gap_requests.filter(r=>r.status==='drafted')).toHaveLength(1);
 expect(db.case_timeline_events.filter(e=>e.event_type==='output_generated')).toHaveLength(1);
});

it('a later orphan concurrent v3 output never masks the linked current source on replay',async()=>{
 db.quote_gaps=[{case_id:'c',gap_key:weight,status:'open',is_blocking:true}];db.case_timeline_events.push(action([weight]));
 const key=(db.case_timeline_events[0].event_data as Row).dedupe_key;
 const barrier=gate('candidate','case_timeline_events','insert');const first=handler('generate-reply-draft')({case_id:'c',action_dedupe_key:key});await barrier.entered;
 expect((await handler('generate-reply-draft')({case_id:'c',action_dedupe_key:key})).body.ok).toBe(true);
 const linked=structuredClone(db.client_gap_requests[0]);
 barrier.release();expect((await first).body).toMatchObject({ok:false,error:'CLIENT_GAP_BINDING_CONFLICT'});
 expect(db.case_timeline_events.filter(e=>e.event_type==='output_generated')).toHaveLength(2);
 expect((await handler('generate-reply-draft')({case_id:'c',action_dedupe_key:key})).body).toMatchObject({ok:true,idempotent:true});
 expect(db.client_gap_requests).toEqual([linked]);expect(db.case_timeline_events.filter(e=>e.event_type==='output_generated')).toHaveLength(2);
});
it('acknowledgement reports no update if a reconciliation won the drafted CAS',async()=>{
 seed([weight]);const barrier=gate('candidate','client_gap_requests','update');const pending=handler('mark-client-gap-request-sent')({case_id:'c',gap_keys:[weight]});await barrier.entered;
 db.client_gap_requests[0].status='cancelled';barrier.release();
 expect((await pending).body).toMatchObject({updated:0,skipped:1});expect(db.client_gap_requests[0].status).toBe('cancelled');
});
it.each(['other_kind','wrong_gap','pad_body'])('historical acknowledgement still refuses %s',async kind=>{
 seed([weight]);const source=db.case_timeline_events.find(e=>e.id==='old-draft')!.event_data as Row;
 if(kind==='other_kind')source.kind='other';else if(kind==='wrong_gap')source.requested_gap_keys=['cargo.value'];else source.requested_gap_keys=[weight,pad];
 expect((await handler('mark-client-gap-request-sent')({case_id:'c',gap_keys:[weight]})).body.updated).toBe(0);expect(db.client_gap_requests[0].status).toBe('drafted');
});

it('pinned baseline fixture is self-contained for shallow CI and matches its source checksums',()=>{
 expect(legacyFixture.commit).toBe('776d1affb4408b391907db5c5ce783ca5ee96434');
 for(const [path,source] of Object.entries(legacyFixture.files))expect(createHash('sha256').update(source).digest('hex')).toBe((legacyFixture.hashes as Record<string,string>)[path]);
});

it('an old displayed source cannot acknowledge a newer follow-up found by gap key',async()=>{
 seed([weight]);const intent={gap_key:weight,request_id:'r0',source_timeline_event_id:'old-draft'};
 const source=db.case_timeline_events.find(e=>e.id==='old-draft')!.event_data as Row;
 source.client_question_policy_version=4;source.client_gap_fence_version=1;
 db.case_timeline_events.push({id:'new-source',case_id:'c',event_type:'output_generated',event_data:{...source}});
 db.client_gap_requests[0]={...db.client_gap_requests[0],id:'replacement',source_timeline_event_id:'new-source'};
 const result=await handler('mark-client-gap-request-sent')({case_id:'c',gap_keys:[weight],expected_requests:[intent]});
 expect(result).toMatchObject({status:409,body:{ok:false,updated:0}});
 expect(db.client_gap_requests[0]).toMatchObject({id:'replacement',status:'drafted'});expect(writes).toEqual([]);
});
