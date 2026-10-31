// Actual Edge handler code, transpiled unchanged. Only platform/Auth/DB/AI are
// doubles; no network, real credentials, or customer data. Not a Cloud recipe.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { beforeEach, expect, it } from 'vitest';
import * as gapScope from '../../supabase/functions/_shared/client-gap-scope';
import * as policy from '../../supabase/functions/_shared/client-gap-policy';
import * as review from './padGapReview';

type Row=Record<string,unknown>;
let clientHeaders:Record<string,string>[]=[];
let airRequirements:Row|null=null,airReads=0;
let db:Record<string,Row[]>, writes:{table:string;op:string}[], seq:number, failTable:string|null, unavailableTable:string|null, authOk:boolean,fenceInstalled:boolean,failOperation:string|null,failCode:string|undefined;
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
function query(table:string) {
  const filters:((r:Row)=>boolean)[]=[]; let op='select', payload:Row|undefined, sortKey='',desc=false,limit=Infinity,single=false;
  const q={select:()=>q,eq:(k:string,v:unknown)=>{filters.push(r=>r[k]===v);return q;},
    in:(k:string,v:unknown[])=>{filters.push(r=>v.includes(r[k]));return q;},
    order:(k:string,o:{ascending:boolean})=>{sortKey=k;desc=!o.ascending;return q;},limit:(n:number)=>{limit=n;return q;},
    maybeSingle:()=>{single=true;return q;},single:()=>{single=true;return q;},
    update:(p:Row)=>{op='update';payload=p;return q;},insert:(p:Row)=>{op='insert';payload=p;return q;},
    then:(resolve:(v:unknown)=>unknown)=>{
      if(unavailableTable===table)return Promise.resolve(resolve({data:null,error:null}));
      if(failTable===table&&(!failOperation||failOperation===op))return Promise.resolve(resolve({data:null,error:{message:'injected read/write failure',code:failCode}}));
      if(!db[table])throw Error(`Unexpected table ${table}`);
      let rows=db[table].filter(r=>filters.every(f=>f(r)));
      if(table==='quote_gaps'&&op==='select')rows=rows.map(r=>({id:r.id??`scope-${r.gap_key}`,...r}));
      if(sortKey)rows=rows.slice().sort((a,b)=>(Number(a[sortKey])-Number(b[sortKey]))*(desc?-1:1));
      rows=rows.slice(0,limit);
      if(op!=='select')writes.push({table,op});
      if(op==='insert'){const row:Row={id:`new-${++seq}`,created_at:seq,...structuredClone(payload)};if(fenceInstalled&&table==='case_timeline_events'&&(row.event_data as Row)?.client_question_policy_version===4)(row.event_data as Row).client_gap_fence_version=1;db[table].push(row);rows=[row];}
      if(op==='update')rows.forEach(r=>Object.assign(r,structuredClone(payload)));
      return Promise.resolve(resolve({data:structuredClone(single?(rows[0]??null):rows),error:null}));
    }};
  return q;
}
function handler(name:string) {
  let captured:((r:Request)=>Promise<Response>)|undefined;
  const jsonResponse=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  const source=ts.transpileModule(readFileSync(`supabase/functions/${name}/index.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{exports:{},console,Response,Request,Date,Set,Map,
    Deno:{env:{get:()=> 'fake-local'},serve:(fn:typeof captured)=>{captured=fn;}},
    require:(path:string)=>{
      if(path.endsWith('/http/server.ts'))return {serve:(fn:typeof captured)=>{captured=fn;}};
      if(path==='jsr:@supabase/supabase-js@2')return {createClient:(_url:string,_key:string,options?:{global?:{headers?:Record<string,string>}})=>{clientHeaders.push(options?.global?.headers??{});return {from:query};}};
      if(path.endsWith('/air-cross-trade-service.ts'))return {readAirCrossTradeRequirements:async()=>{airReads++;return structuredClone(airRequirements);}};
      if(path.endsWith('/auth.ts'))return {requireUser:async()=>authOk?{user:{id:'operator'}}:new Response('{}',{status:401})};
      if(path.endsWith('/cors.ts'))return {handleCors:()=>null,jsonResponse,errorResponse:(error:string,status:number)=>jsonResponse({error},status)};
      if(path.endsWith('/client-gap-scope.ts'))return gapScope;
      if(path.endsWith('/client-gap-policy.ts'))return policy;
      if(path.endsWith('/pad-gap-review.ts'))return review;
      if(path.endsWith('/language-detection.ts'))return {detectLanguage:()=> 'fr',normalizeTextForLanguageDetection:(s:string)=>s};
      if(path.endsWith('/ai-client.ts')||path.endsWith('/json-parser.ts'))return new Proxy({},{get:()=>()=>{throw Error('AI must not be called');}});
      throw Error(`Unexpected import ${path}`);
    }});
  if(!captured)throw Error('Handler not registered');
  return async(body:Row)=>{const response=await captured!(new Request('https://local.invalid',{method:'POST',body:JSON.stringify(body)}));
    return {status:response.status,body:await response.json()};};
}
beforeEach(()=>{airRequirements=null;airReads=0;clientHeaders=[];seq=10;writes=[];failTable=null;unavailableTable=null;authOk=true;fenceInstalled=true;failOperation=null;failCode=undefined;db={quote_cases:[{id:'c',thread_id:null}],quote_gaps:[],case_timeline_events:[],client_gap_requests:[]};});

it('PAD-only reconciliation closes old client action once, cancels unsent draft, preserves canonical gap',async()=>{
  seed(); const sync=handler('sync-gap-client-actions');
  expect((await sync({case_id:'c'})).body).toMatchObject({created:false});
  expect(db.quote_gaps[0]).toMatchObject({status:'open',is_blocking:true});
  expect(db.client_gap_requests[0].status).toBe('cancelled');
  expect((db.case_timeline_events.at(-1)?.event_data as Row).status).toBe('done');
  const firstWrites=writes.length; await sync({case_id:'c'});expect(writes).toHaveLength(firstWrites);
});
it('mixed PAD/weight action becomes weight-only; whole old email is retired and clean draft is idempotent',async()=>{
  const oldKey=seed([pad,weight]);
  expect((await handler('generate-reply-draft')({case_id:'c',action_dedupe_key:oldKey})).body.error).toBe('ACTION_REQUIRES_GAP_SYNC');
  const sync=await handler('sync-gap-client-actions')({case_id:'c'});
  expect(sync.body.requested_gap_keys).toEqual([weight]);
  expect(db.client_gap_requests.every(r=>r.status==='cancelled')).toBe(true);
  const generate=handler('generate-reply-draft');
  const a=await generate({case_id:'c',action_dedupe_key:sync.body.dedupe_key});
  expect(a.body.draft.body).toContain('poids');expect(a.body.draft.body).not.toMatch(/PAD|nature exacte|OLD GENERIC/);
  const count=writes.length;
  expect((await generate({case_id:'c',action_dedupe_key:sync.body.dedupe_key})).body.idempotent).toBe(true);
  expect(writes).toHaveLength(count);
  db.quote_gaps=[];
  expect((await generate({case_id:'c',action_dedupe_key:sync.body.dedupe_key})).body.error).toBe('NO_RELEVANT_GAPS');
});
it('cached PAD-only draft is rejected before the cached response can escape',async()=>{
  const key=seed(); const r=await handler('generate-reply-draft')({case_id:'c',action_dedupe_key:key});
  expect(r.body.ok).toBe(false);expect(r.body.draft).toBeUndefined();expect(writes).toEqual([]);
});
it('already sent or answered PAD requests retain their recorded state and content',async()=>{
  seed();db.client_gap_requests[0].status='sent';db.client_gap_requests.push({...db.client_gap_requests[0],id:'answered',status:'answered'});
  await handler('sync-gap-client-actions')({case_id:'c'});
  expect(db.client_gap_requests.map(r=>r.status)).toEqual(['sent','answered']);
});
it('no-open-gap path still reconciles stale history',async()=>{
  seed();db.quote_gaps=[];await handler('sync-gap-client-actions')({case_id:'c'});
  expect((db.case_timeline_events.at(-1)?.event_data as Row).status).toBe('done');
});
it('mark sent rejects PAD and mixed legacy bodies, while allowing a clean weight draft',async()=>{
  seed([pad,weight]);const mark=handler('mark-client-gap-request-sent');
  expect((await mark({case_id:'c',gap_keys:[pad,weight]})).body).toMatchObject({updated:0,skipped:2});
  db.case_timeline_events.push({id:'clean',case_id:'c',event_type:'output_generated',event_data:{kind:'reply_draft_v1',client_question_policy_version:4,requested_gap_keys:[weight]}});
  db.client_gap_requests[1].source_timeline_event_id='clean';
  expect((await mark({case_id:'c',gap_keys:[weight]})).body.updated).toBe(1);
  expect((await mark({case_id:'c',gap_keys:[weight]})).body.updated).toBe(0);
});
it.each(['sync-gap-client-actions','generate-reply-draft','mark-client-gap-request-sent'])('%s retains Auth and case-access guards',async name=>{
  const key=seed();const call=handler(name),body={case_id:'c',action_dedupe_key:key,gap_keys:[pad]};
  authOk=false;expect((await call(body)).status).toBe(401);expect(writes).toEqual([]);
  authOk=true;db.quote_cases=[];expect((await call(body)).status).toBe(404);expect(writes).toEqual([]);
});
it('gap read failure causes no reconciliation writes',async()=>{
  seed();failTable='quote_gaps';expect((await handler('sync-gap-client-actions')({case_id:'c'})).status).toBe(500);expect(writes).toEqual([]);
});

// Data-first quotation requests: server handlers, all I/O synthetic.
it('asks only blocking client facts, never optional HS or internal tariff questions',async()=>{
 db.quote_gaps=[{case_id:'c',gap_key:weight,status:'open',is_blocking:true},{case_id:'c',gap_key:'cargo.hs_code',status:'open',is_blocking:false},{case_id:'c',gap_key:'pricing.internal_rate',status:'open',is_blocking:true}];
 const sync=await handler('sync-gap-client-actions')({case_id:'c'});expect(sync.body.requested_gap_keys).toEqual([weight]);
 const draft=await handler('generate-reply-draft')({case_id:'c',action_dedupe_key:sync.body.dedupe_key});
 expect(draft.body.draft.body).toMatch(/poids/i);expect(draft.body.draft.body).not.toMatch(/HS|tarif|packing|facture/i);
});
it('non-blocking details alone create no client request',async()=>{
 db.quote_gaps=[{case_id:'c',gap_key:'cargo.value',status:'open',is_blocking:false}];
 expect((await handler('sync-gap-client-actions')({case_id:'c'})).body).toMatchObject({created:false,reason:'no_client_resolvable_gaps'});expect(writes).toEqual([]);
});
it('retires an unsent legacy body, preserves its history and sent rows, then produces one clean replayable draft',async()=>{
 const key=seed([weight]);(db.case_timeline_events.find(e=>e.id==='old-draft')!.event_data as Row).draft_reply={subject:'old',body:'Mandatory invoice and packing list'};
 db.client_gap_requests.push({...db.client_gap_requests[0],id:'sent-other',gap_key:'cargo.value',status:'sent'});
 const original=JSON.stringify(db.case_timeline_events.find(e=>e.id==='old-draft'));
 const generate=handler('generate-reply-draft');expect((await generate({case_id:'c',action_dedupe_key:key})).body.error).toBe('ACTION_REQUIRES_GAP_SYNC');
 await handler('sync-gap-client-actions')({case_id:'c'});
 expect(db.client_gap_requests.find(r=>r.id==='r0')!.status).toBe('cancelled');expect(db.client_gap_requests.find(r=>r.id==='sent-other')!.status).toBe('sent');
 expect(JSON.stringify(db.case_timeline_events.find(e=>e.id==='old-draft'))).toBe(original);
 const next=await generate({case_id:'c',action_dedupe_key:key});expect(next.body.ok).toBe(true);expect(next.body.draft.body).not.toMatch(/Mandatory|packing|facture/i);
 const n=writes.length;expect((await generate({case_id:'c',action_dedupe_key:key})).body.idempotent).toBe(true);expect(writes).toHaveLength(n);
});
it('retires the WHOLE mixed current-version draft when optional information no longer belongs in the request',async()=>{
 const oldKey=seed([weight,'cargo.value']);db.quote_gaps.find(g=>g.gap_key==='cargo.value')!.is_blocking=false;
 const old=db.case_timeline_events.find(e=>e.id==='old-draft')!.event_data as Row;old.client_question_policy_version=4;old.client_gap_fence_version=1;old.client_gap_guard=gapScope.clientGapGuard(db.quote_gaps.map(r=>({id:`scope-${r.gap_key}`,...r})));
 const sync=await handler('sync-gap-client-actions')({case_id:'c'});expect(sync.body.requested_gap_keys).toEqual([weight]);expect(db.client_gap_requests.every(r=>r.status==='cancelled')).toBe(true);
 const draft=await handler('generate-reply-draft')({case_id:'c',action_dedupe_key:sync.body.dedupe_key});expect(draft.body.ok).toBe(true);expect(draft.body.draft.body).not.toMatch(/valeur|OLD GENERIC/);
 expect(oldKey).not.toBe(sync.body.dedupe_key);
});
it('R02 with no identified blocking need produces no obvious weight question or new writes',async()=>{
 // The product decision retains104kg as total for R02; no new weight gap is invented here.
 // This is not a test of assumption persistence, UI presentation, or pricing.
 db.quote_gaps=[];expect((await handler('sync-gap-client-actions')({case_id:'c'})).body.created).toBe(false);expect(writes).toEqual([]);
});
it('data-first questions ask for a reply, not mandatory documents, preserve bilingual needs and generic weight scope',()=>{
 for(const lang of ['fr','en'] as const){
  const value=policy.buildClientQuestionsFromGaps([{gap_key:'cargo.value_conflict'}],lang).join(' ');
  expect(value).toMatch(lang==='fr'?/devise/:/currency/);expect(value).toMatch(lang==='fr'?/r[eé]pondre.*message|par message/:/reply.*message|in your reply/);
  expect(value).not.toMatch(lang==='fr'?/merci de joindre/:/please attach/);
  const total=policy.buildClientQuestionsFromGaps([{gap_key:'cargo.weight_kg'},{gap_key:'cargo.weight_total_confirmation'}],lang);
  expect(total).toHaveLength(1);expect(total[0]).not.toMatch(/bus|packing|invoice/i);
 }
});

it('replays a current active source older than200outputs without duplication or a sync loop',async()=>{
 const sync=await handler('sync-gap-client-actions');db.quote_gaps=[{case_id:'c',gap_key:weight,status:'open',is_blocking:true}];
 const a=await sync({case_id:'c'}),generate=handler('generate-reply-draft');const first=await generate({case_id:'c',action_dedupe_key:a.body.dedupe_key});expect(first.body.ok).toBe(true);
 for(let i=0;i<201;i++)db.case_timeline_events.push({id:`later${i}`,case_id:'c',event_type:'output_generated',created_at:++seq,event_data:{kind:'other'}});
 const n=writes.length;const next=await generate({case_id:'c',action_dedupe_key:a.body.dedupe_key});expect(next.body.idempotent).toBe(true);expect(next.body.draft).toEqual(first.body.draft);expect(writes).toHaveLength(n);
});
it('an orphan unsent source is reconciled then regenerated, with sent history untouched',async()=>{
 const key=seed([weight]);db.case_timeline_events=db.case_timeline_events.filter(e=>e.id!=='old-draft');
 expect((await handler('generate-reply-draft')({case_id:'c',action_dedupe_key:key})).body.error).toBe('ACTION_REQUIRES_GAP_SYNC');
 await handler('sync-gap-client-actions')({case_id:'c'});expect(db.client_gap_requests[0].status).toBe('cancelled');
 expect((await handler('generate-reply-draft')({case_id:'c',action_dedupe_key:key})).body.ok).toBe(true);
});
it('unavailable client-draft read never creates a misleading successful draft',async()=>{
 db.quote_gaps=[{case_id:'c',gap_key:weight,status:'open',is_blocking:true}];const a=await handler('sync-gap-client-actions')({case_id:'c'});writes=[];failTable='client_gap_requests';
 expect((await handler('generate-reply-draft')({case_id:'c',action_dedupe_key:a.body.dedupe_key})).body.error).toBe('DRAFTS_LOAD_FAILED');expect(writes).toEqual([]);
});

it.each(['other','reply_without_keys'])('repairs an unsent invalid source %s instead of looping sync',async kind=>{
 const key=seed([weight]);const data=db.case_timeline_events.find(e=>e.id==='old-draft')!.event_data as Row;data.client_question_policy_version=4;data.client_gap_fence_version=1;data.client_gap_guard=gapScope.clientGapGuard(db.quote_gaps.map(r=>({id:`scope-${r.gap_key}`,...r})));
 if(kind==='other')data.kind='other';else delete data.requested_gap_keys;
 expect((await handler('generate-reply-draft')({case_id:'c',action_dedupe_key:key})).body.error).toBe('ACTION_REQUIRES_GAP_SYNC');
 await handler('sync-gap-client-actions')({case_id:'c'});expect(db.client_gap_requests[0].status).toBe('cancelled');
 expect((await handler('generate-reply-draft')({case_id:'c',action_dedupe_key:key})).body.ok).toBe(true);
});
it('null gap rows are unavailable, not proof that no information is necessary',async()=>{
 unavailableTable='quote_gaps';expect((await handler('sync-gap-client-actions')({case_id:'c'})).status).toBe(500);expect(writes).toEqual([]);
});
it('null active-draft rows cannot generate a false successful new request',async()=>{
 db.quote_gaps=[{case_id:'c',gap_key:weight,status:'open',is_blocking:true}];const a=await handler('sync-gap-client-actions')({case_id:'c'});writes=[];unavailableTable='client_gap_requests';
 expect((await handler('generate-reply-draft')({case_id:'c',action_dedupe_key:a.body.dedupe_key})).body.error).toBe('DRAFTS_LOAD_FAILED');expect(writes).toEqual([]);
});

it('missing DB fence never becomes a successful current proposal; installation recovers without rewriting the orphan',async()=>{
 db.quote_gaps=[{case_id:'c',gap_key:weight,status:'open',is_blocking:true}];fenceInstalled=false;
 const sync=handler('sync-gap-client-actions'),generate=handler('generate-reply-draft');const first=await sync({case_id:'c'});
 const missing=await generate({case_id:'c',action_dedupe_key:first.body.dedupe_key});expect(missing.status).toBe(503);expect(missing.body.error).toBe('CLIENT_GAP_FENCE_NOT_INSTALLED');expect(db.client_gap_requests).toHaveLength(0);
 const orphan=db.case_timeline_events.find(e=>e.event_type==='output_generated')!,original=JSON.stringify(orphan);expect(review.isObsoletePadDraft(orphan.event_data as Row,[weight])).toBe(true);
 fenceInstalled=true;const renewed=await sync({case_id:'c'});const result=await generate({case_id:'c',action_dedupe_key:renewed.body.dedupe_key});expect(result.body).toMatchObject({ok:true,client_question_policy_version:4,client_gap_fence_version:1});
 expect(db.client_gap_requests).toHaveLength(1);expect(JSON.stringify(orphan)).toBe(original);expect(db.case_timeline_events.filter(e=>e.event_type==='output_generated')).toHaveLength(2);
});
it.each(['case_timeline_events','client_gap_requests'])('scope fencing PT409 from %s is explicit and never reported as current success',async table=>{
 db.quote_gaps=[{case_id:'c',gap_key:weight,status:'open',is_blocking:true}];const a=await handler('sync-gap-client-actions')({case_id:'c'});writes=[];
 failTable=table;failOperation='insert';failCode='PT409';const result=await handler('generate-reply-draft')({case_id:'c',action_dedupe_key:a.body.dedupe_key});
 expect(result.status).toBe(409);expect(result.body).toMatchObject({ok:false,error:'CLIENT_GAP_SCOPE_CHANGED'});expect(db.client_gap_requests).toHaveLength(0);
});

it('protected acknowledgement requires exact caller intent and forwards it to the DB request',async()=>{
 seed([weight]);const source=db.case_timeline_events.find(e=>e.id==='old-draft')!.event_data as Row;
 source.client_question_policy_version=4;source.client_gap_fence_version=1;
 const mark=handler('mark-client-gap-request-sent');
 expect(await mark({case_id:'c',gap_keys:[weight]})).toMatchObject({status:409,body:{ok:false,updated:0}});
 expect(db.client_gap_requests[0].status).toBe('drafted');expect(writes).toEqual([]);
 for(const intent of [{gap_key:weight,request_id:'older',source_timeline_event_id:'old-draft'},{gap_key:weight,request_id:'r0',source_timeline_event_id:'older-source'}]) {
  expect((await mark({case_id:'c',gap_keys:[weight],expected_requests:[intent]})).status).toBe(409);
  expect(db.client_gap_requests[0].status).toBe('drafted');
 }
 expect((await mark({case_id:'c',gap_keys:[weight],expected_requests:[{gap_key:weight,request_id:'r0',source_timeline_event_id:'old-draft'}]})).body).toMatchObject({updated:1,skipped:0});
 expect(clientHeaders).toContainEqual({'x-dcq-client-gap-request-id':'r0','x-dcq-client-gap-source-id':'old-draft'});
});
it('acknowledgement rejects malformed or duplicated intents and reports DB conflict without a receipt',async()=>{
 seed([weight]);const mark=handler('mark-client-gap-request-sent');
 expect((await mark({case_id:'c',gap_keys:[weight],expected_requests:[null]})).status).toBe(400);
 const intent={gap_key:weight,request_id:'r0',source_timeline_event_id:'old-draft'};
 expect((await mark({case_id:'c',gap_keys:[weight],expected_requests:[intent,intent]})).status).toBe(409);
 failTable='client_gap_requests';failOperation='update';failCode='PT409';
 expect(await mark({case_id:'c',gap_keys:[weight],expected_requests:[intent]})).toMatchObject({status:409,body:{ok:false,updated:0}});
 expect(db.client_gap_requests[0].status).toBe('drafted');
});

it('Cross qualification absent suspends reconciliation and cached replay without cancelling historical rows',async()=>{
 const key=seed([weight]);db.quote_cases[0].request_type='AIR_CROSS_TRADE';const before=JSON.stringify(db);writes=[];
 expect(await handler('sync-gap-client-actions')({case_id:'c'})).toMatchObject({status:409,body:{error:'AIR_QUALIFICATION_STALE'}});
 expect(await handler('generate-reply-draft')({case_id:'c',action_dedupe_key:key})).toMatchObject({status:409,body:{error:'AIR_QUALIFICATION_STALE'}});
 expect(airReads).toBe(2);expect(writes).toEqual([]);expect(JSON.stringify(db)).toBe(before);
});
it('Cross current qualification selects only source-needed customer facts and retains full blocking snapshot',async()=>{
 db.quote_cases[0].request_type='AIR_CROSS_TRADE';airRequirements={plan_id:'synthetic-plan',required_fact_keys:[weight],client_data_keys:[weight]};
 db.quote_gaps=[{id:'w',case_id:'c',gap_key:weight,status:'open',is_blocking:true},{id:'city',case_id:'c',gap_key:'routing.destination_city',status:'open',is_blocking:true}];
 const result=await handler('sync-gap-client-actions')({case_id:'c'});expect(result.body.requested_gap_keys).toEqual([weight]);
 const event=db.case_timeline_events.at(-1)!.event_data as Row;expect(event.client_gap_guard).toEqual(gapScope.clientGapGuard(db.quote_gaps));
 const draft=await handler('generate-reply-draft')({case_id:'c',action_dedupe_key:result.body.dedupe_key});expect(draft.body.draft.body).toMatch(/poids/i);expect(draft.body.draft.body).not.toMatch(/ville|packing|facture/i);
 airRequirements=null;const count=writes.length;expect((await handler('generate-reply-draft')({case_id:'c',action_dedupe_key:result.body.dedupe_key})).status).toBe(409);expect(writes).toHaveLength(count);
});
