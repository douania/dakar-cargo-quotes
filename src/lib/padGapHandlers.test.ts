// Actual Edge handler code, transpiled unchanged. Only platform/Auth/DB/AI are
// doubles; no network, real credentials, or customer data. Not a Cloud recipe.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { beforeEach, expect, it } from 'vitest';
import * as policy from '../../supabase/functions/_shared/client-gap-policy';
import * as review from './padGapReview';

type Row=Record<string,unknown>;
let db:Record<string,Row[]>, writes:{table:string;op:string}[], seq:number, failTable:string|null, authOk:boolean;
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
      if(failTable===table)return Promise.resolve(resolve({data:null,error:{message:'injected read/write failure'}}));
      if(!db[table])throw Error(`Unexpected table ${table}`);
      let rows=db[table].filter(r=>filters.every(f=>f(r)));
      if(sortKey)rows=rows.slice().sort((a,b)=>(Number(a[sortKey])-Number(b[sortKey]))*(desc?-1:1));
      rows=rows.slice(0,limit);
      if(op!=='select')writes.push({table,op});
      if(op==='insert'){const row={id:`new-${++seq}`,created_at:seq,...structuredClone(payload)};db[table].push(row);rows=[row];}
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
      if(path==='jsr:@supabase/supabase-js@2')return {createClient:()=>({from:query})};
      if(path.endsWith('/auth.ts'))return {requireUser:async()=>authOk?{user:{id:'operator'}}:new Response('{}',{status:401})};
      if(path.endsWith('/cors.ts'))return {handleCors:()=>null,jsonResponse,errorResponse:(error:string,status:number)=>jsonResponse({error},status)};
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
beforeEach(()=>{seq=10;writes=[];failTable=null;authOk=true;db={quote_cases:[{id:'c',thread_id:null}],quote_gaps:[],case_timeline_events:[],client_gap_requests:[]};});

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
  db.case_timeline_events.push({id:'clean',case_id:'c',event_type:'output_generated',event_data:{kind:'reply_draft_v1',requested_gap_keys:[weight]}});
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
