import { assert,assertEquals,assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { parseCustomsCommand } from './domain.ts';
import { handleCustomsBasis } from './index.ts';
import { syntheticCustoms } from '../_tests/customs-basis-fixture.ts';
const id='00000001-1111-4111-8111-111111111111';
Deno.test('Customs request is closed and cannot accept actor, context evidence or null operation IDs',()=>{
 assertEquals(parseCustomsCommand({action:'read',case_id:id}).action,'read');
 for(const raw of [{action:'read',case_id:id,actor:id},{action:'adopt',case_id:id,id:null},{action:'adopt',case_id:id,id,parent_id:null,context_hash:'a'.repeat(32),decision:{},context:{}}])assertThrows(()=>parseCustomsCommand(raw));
});
for(const stale of [false,true])Deno.test('Customs actual HTTP read '+(stale?'recovers from removed stale sources without claiming eligible':'returns saved proof for refresh without another adoption'),async()=>{
 const f=syntheticCustoms(),oldFetch=globalThis.fetch,keys=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'],old=keys.map(k=>Deno.env.get(k));
 keys.forEach((k,i)=>Deno.env.set(k,i===0?'https://fixture.invalid':'synthetic-not-a-real-key'));
 let mutations=0;
 globalThis.fetch=async(input,init)=>{const url=new URL(String(input));assertEquals(url.hostname,'fixture.invalid');const name=url.pathname.split('/').pop();
   if(init?.method==='PATCH')mutations++;
   const data=url.pathname==='/auth/v1/user'?{id:f.record.created_by}:name==='has_workspace_access'?true:name==='customs_basis_read'?{
     context:stale?{...f.context,attachments:[]}:f.context,context_hash:stale?'b'.repeat(32):f.record.context_hash,head:f.record,can_write:true}:null;
   return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
 };
 try{
  const result=await handleCustomsBasis(new Request('https://fixture.invalid/functions/v1/manage-customs-basis',{method:'POST',headers:{Authorization:'Bearer synthetic-token'},body:JSON.stringify({action:'read',case_id:f.record.case_id})}));
  assertEquals(result.status,200);const body=await result.json();assertEquals(body.assessment.eligible,!stale);assertEquals(body.basis?.id??null,stale?null:f.record.id);assertEquals(mutations,0);
 }finally{globalThis.fetch=oldFetch;keys.forEach((k,i)=>old[i]===undefined?Deno.env.delete(k):Deno.env.set(k,old[i]!));}
});
Deno.test('Customs HTTP OPTIONS/auth failure never touches business sources',async()=>{
 const before=globalThis.fetch;globalThis.fetch=()=>{throw new Error('Business read reached without auth');};
 try{assertEquals((await handleCustomsBasis(new Request('https://fixture.invalid',{method:'POST'}))).status,401);
 assertEquals((await handleCustomsBasis(new Request('https://fixture.invalid',{method:'OPTIONS'}))).status,200);}finally{globalThis.fetch=before;}
});
Deno.test('Customs actual HTTP adoption derives actor server-side and persists an unknown profile as a reserve, without fact promotion',async()=>{
 const f=syntheticCustoms();f.context.profiles[2].tax_profile_status='unknown';
 const oldFetch=globalThis.fetch,keys=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'],old=keys.map(k=>Deno.env.get(k));
 keys.forEach((k,i)=>Deno.env.set(k,i===0?'https://fixture.invalid':'synthetic-not-a-real-key'));
 const calls:string[]=[];let stored=false;
 globalThis.fetch=async(input,init)=>{const url=new URL(String(input));assertEquals(url.hostname,'fixture.invalid');const name=url.pathname.split('/').pop(),body=init?.body?JSON.parse(String(init.body)):{};calls.push(`${init?.method??'GET'}:${name}`);
   let data:unknown=null;
   if(url.pathname==='/auth/v1/user')data={id:f.record.created_by};
   if(name==='has_workspace_access')data=true;
   if(name==='customs_basis_read')data={context:f.context,context_hash:f.record.context_hash,head:null,can_write:true};
   if(name==='customs_basis_store'){assertEquals(body.p_actor,f.record.created_by);assertEquals(body.p_decision,f.decision);assertEquals(body.p_parent,null);stored=true;data=f.record;}
   if(name==='quote_customs_basis'){assert(stored);assertEquals(url.searchParams.get('case_id'),'eq.'+f.record.case_id);data={...f.record,context:f.context};}
   return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
 };
 try{
  const result=await handleCustomsBasis(new Request('https://fixture.invalid/functions/v1/manage-customs-basis',{method:'POST',headers:{Authorization:'Bearer synthetic-token'},body:JSON.stringify({action:'adopt',case_id:f.record.case_id,id:f.record.id,parent_id:null,context_hash:f.record.context_hash,decision:f.decision})}));
  assertEquals(result.status,200);const body=await result.json();assertEquals(body.basis.created_by,f.record.created_by);assertEquals(body.basis.assessment.eligible,false);assert(!calls.some(c=>c.includes('quote_facts')));assertEquals(calls.filter(c=>c==='POST:customs_basis_store').length,1);
 }finally{globalThis.fetch=oldFetch;keys.forEach((k,i)=>old[i]===undefined?Deno.env.delete(k):Deno.env.set(k,old[i]!));}
});
