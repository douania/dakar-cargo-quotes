import {assert,assertEquals} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {handleCommercialPreparation} from './index.ts';
const uid='11111111-1111-4111-8111-111111111111',cid='22222222-2222-4222-8222-222222222222',vid='33333333-3333-4333-8333-333333333333',rid='44444444-4444-4444-8444-444444444444',op='55555555-5555-4555-8555-555555555555';
const snapshot={meta:{},inputs:{},client:{},totals:{currency:'XOF',subtotal_before_sodatra_vat:1000,honoraires_ht:1000,honoraires_tva:180},raw_lines:[{label:'Honoraires',amount:1000,bloc:'honoraires',currency:'XOF'}]};
const state={available:true,source_version_id:vid,source_hash:'server-hash',context_hash:'server-context',head_id:null,draft:null,snapshot,can_write:true,case_status:'QUOTED_VERSIONED'};
type Body=Record<string,unknown>;
const body=()=>({action:'save',case_id:cid,source_version_id:vid,parent_id:null,source_hash:'server-hash',context_hash:'server-context',operation_id:rid,
 actor_id:'forged-actor',draft:{source_snapshot:{amount:1}},operations:[{operation_id:op,action:{type:'edit',line_id:'source:0',amount:2000,basis:'before_sodatra_vat',reason:'Explicit fictitious operator service amount'}}]});
async function withFetch(admitted:boolean,run:(calls:Array<{url:string;body:Body}>)=>Promise<void>,denyWrite=false){
 const prior=globalThis.fetch,names=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'],values=names.map(n=>Deno.env.get(n));
 Deno.env.set(names[0],'http://fictional.invalid');Deno.env.set(names[1],'fictitious-anon');Deno.env.set(names[2],'fictitious-service');
 const calls:Array<{url:string;body:Body}>=[];
 globalThis.fetch=async(input,init)=>{
  const url=String(input instanceof Request?input.url:input),data=init?.body?JSON.parse(String(init.body)):{};calls.push({url,body:data});
  let response:unknown;
  if(url.includes('/auth/v1/user'))response={id:uid,aud:'authenticated',role:'authenticated',email:'fixture@example.invalid'};
  else if(url.includes('/rpc/has_workspace_access'))response=admitted;
  else if(url.includes('/rpc/commercial_actor_guard')){if(denyWrite)return new Response(JSON.stringify({code:'42501',message:'Commercial write forbidden'}),{status:403,headers:{'Content-Type':'application/json'}});response=null;}
  else if(url.includes('/rpc/commercial_read'))response=state;
  else if(url.includes('/rpc/commercial_store'))response={id:rid,draft:data.p_draft};
  else if(url.includes('/quote_commercial_revisions'))response=null;
  else throw new Error('Unexpected URL '+url);
  return new Response(JSON.stringify(response),{status:200,headers:{'Content-Type':'application/json'}});
 };
 try{await run(calls);}finally{globalThis.fetch=prior;names.forEach((n,i)=>values[i]===undefined?Deno.env.delete(n):Deno.env.set(n,values[i]!));}
}
const request=(value:unknown,auth=true)=>new Request('http://localhost/manage-commercial-preparation',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer fictitious-user-token'}:{})},body:JSON.stringify(value)});
Deno.test('commercial admission: missing token401; denied workspace403 before source or write',async()=>{
 await withFetch(false,async calls=>{assertEquals((await handleCommercialPreparation(request(body(),false))).status,401);assertEquals(calls.length,0);assertEquals((await handleCommercialPreparation(request(body()))).status,403);assert(!calls.some(c=>c.url.includes('commercial_')));});
});
Deno.test('commercial handler binds server actor/source/time; browser draft and actor are ignored',async()=>{
 await withFetch(true,async calls=>{
  const response=await handleCommercialPreparation(request(body()));assertEquals(response.status,200);
  const stored=calls.find(c=>c.url.includes('/rpc/commercial_store'))!.body;
  assertEquals(stored.p_actor,uid);const draft=stored.p_draft as {source_snapshot:unknown;events:Array<{actor_id:string;occurred_at:string}>};
  assertEquals(draft.source_snapshot,snapshot);assertEquals(draft.events[0].actor_id,uid);assert(Number.isFinite(Date.parse(draft.events[0].occurred_at)));
  assert(calls.some(c=>c.url.includes('/rpc/commercial_read')));
 });
});
Deno.test('commercial handler refuses non-owner and stale context before inserting a revision',async()=>{
 await withFetch(true,async calls=>{assertEquals((await handleCommercialPreparation(request(body()))).status,403);assert(!calls.some(c=>c.url.includes('/rpc/commercial_store')));},true);
 await withFetch(true,async calls=>{assertEquals((await handleCommercialPreparation(request({...body(),context_hash:'stale'}))).status,409);assert(!calls.some(c=>c.url.includes('/rpc/commercial_store')));});
});
