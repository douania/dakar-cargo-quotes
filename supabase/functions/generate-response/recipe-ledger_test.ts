import { assert, assertEquals, assertRejects, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { IDEMPOTENT_RECIPE, resolveLedgerRequest, recipeIntentHash, readRecipeReceipt, RecipeLedgerError, type RecipeTarget } from './recipe-ledger.ts';
import { runRecipeFixture } from './recipe-mode_test.ts';

const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222';
const E='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', C='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const G='33333333-3333-4333-8333-333333333333', ATTEMPT='44444444-4444-4444-8444-444444444444';
const NOW=Date.parse('2026-11-04T12:15:00.000Z');
const policy={grant_id:G,actor_user_id:A,case_id:C,email_id:E,starts_at:'2026-11-04T12:00:00.000Z',expires_at:'2026-11-04T12:30:00.000Z'};
const body={recipe_mode:IDEMPOTENT_RECIPE,recipe_grant_id:G,recipe_case_id:C,recipe_email_id:E,recipe_attempt_id:ATTEMPT,zone_reply_contract:'optional_factor_v1'};
const target:RecipeTarget={grantId:G,actorId:A,caseId:C,emailId:E};
const resolve=(request:Record<string,unknown>=body,config:string|undefined=JSON.stringify(policy),ready:string|undefined='1',blocked?:string,actor=A)=>resolveLedgerRequest(request,actor,config,ready,blocked,NOW);
function refusal(fn:()=>unknown,code:string){const e=assertThrows(fn,RecipeLedgerError);assertEquals(e.code,code);}

Deno.test('ledger policy binds validated actor and freezes run admission',()=>{const r=resolve();assert(r?.action==='run');assert(Object.isFrozen(r));assertEquals(r.actorId,A);});
for(const action of ['status','revoke']) Deno.test('ledger '+action+' survives corrupt/missing policy and readiness without admitting AI',()=>{const r=resolve({...body,recipe_action:action},'{bad','0','{bad');assertEquals(r?.action,action);});
for(const key of ['emailId','quotationData'])for(const value of [null,'',{},E]) Deno.test('ledger rejects legacy field presence '+key+JSON.stringify(value),()=>refusal(()=>resolve({...body,[key]:value}),'RECIPE_PAYLOAD_INVALID'));
for(const key of ['recipe_grant_id','recipe_case_id','recipe_email_id','recipe_attempt_id'])for(const value of [null,'bad','']) Deno.test('ledger rejects malformed '+key+JSON.stringify(value),()=>refusal(()=>resolve({...body,[key]:value}),'RECIPE_PAYLOAD_INVALID'));
for(const config of [null,[],{}, {...policy,extra:true},{...policy,starts_at:'2026-02-30T12:00:00.000Z'},{...policy,expires_at:policy.starts_at},{...policy,expires_at:'2026-11-05T12:00:00.000Z'}])Deno.test('ledger rejects policy shape '+JSON.stringify(config),()=>refusal(()=>resolve(body,JSON.stringify(config)),'RECIPE_POLICY_INVALID'));
for(const actor of [B,'service-role','']) Deno.test('ledger never trusts body actor '+actor,()=>refusal(()=>resolve({...body,actor_user_id:A,userId:A},JSON.stringify(policy),'1',undefined,actor),actor===B?'RECIPE_SCOPE_FORBIDDEN':'RECIPE_PAYLOAD_INVALID'));
for(const ready of [undefined,'0','true',''])Deno.test('ledger readiness is explicit '+ready,()=>refusal(()=>resolve(body,JSON.stringify(policy),ready===undefined?'missing':ready),'RECIPE_LEDGER_NOT_READY'));
Deno.test('ledger missing policy refuses run',()=>refusal(()=>resolveLedgerRequest(body,A,undefined,'1',undefined,NOW),'RECIPE_DISABLED'));
Deno.test('ledger exact expiry refuses admission',()=>refusal(()=>resolve(body,JSON.stringify({...policy,expires_at:new Date(NOW).toISOString()})),'RECIPE_WINDOW_CLOSED'));
Deno.test('ledger legacy quarantine rejects run and production but permits readonly receipt',()=>{for(const request of [body,{emailId:E}])refusal(()=>resolve(request,JSON.stringify(policy),'1',JSON.stringify([E])),'RECIPE_PRIOR_EXECUTION_UNCONFIRMED');assertEquals(resolve({...body,recipe_action:'status'},undefined,undefined,JSON.stringify([E]))?.action,'status');});
for(const block of ['{}','null','[1]','["invalid"]',''])Deno.test('ledger corrupt quarantine fails closed '+block,()=>refusal(()=>resolve(body,JSON.stringify(policy),'1',block),'RECIPE_QUARANTINE_INVALID'));
Deno.test('ledger policy reserves normal target across actors and expiry',()=>refusal(()=>resolve({emailId:E},JSON.stringify(policy),'1',undefined,B),'RECIPE_MODE_REQUIRED'));
Deno.test('ledger stable intent excludes client nonce and untrusted actor/fence, binds semantic instructions',async()=>{const a=await recipeIntentHash(target,body);assertEquals(a,await recipeIntentHash(target,{...body,recipe_attempt_id:crypto.randomUUID(),actor_user_id:B,fence:'forged'}));assert(a!==await recipeIntentHash(target,{...body,customInstructions:'different'}));assert(a!==await recipeIntentHash({...target,actorId:B},body));});
Deno.test('ledger receipt parser strips server fence and private fields',async()=>{const r=await readRecipeReceipt({rpc:()=>Promise.resolve({error:null,data:{kind:'receipt',grant_id:G,actor_id:A,case_id:C,email_id:E,state:'running',attempt_id:ATTEMPT,draft_id:null,engine_verified:null,revoked:false,fence:'PRIVATE',body:'PRIVATE'}})},target);assert(!JSON.stringify(r).includes('PRIVATE'));});
Deno.test('ledger receipt parser rejects cross-user data',async()=>{await assertRejects(()=>readRecipeReceipt({rpc:()=>Promise.resolve({error:null,data:{kind:'receipt',grant_id:G,actor_id:B,case_id:C,email_id:E,state:'running',attempt_id:ATTEMPT,draft_id:null,engine_verified:null,revoked:false}})},target),RecipeLedgerError);});

/** Stateful transport double; PostgreSQL runner independently proves actual SQL. */
function ledgerDouble(){
 const calls:Array<{name:string;args:Record<string,unknown>}>=[];let state='authorized',attempt:string|null=null,revoked=false,hash:string|null=null,drafts=0;
 const rpc=async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});let data:unknown;
  if(args.p_actor!==A)return {data:{kind:'not_found'},error:null};
  if(name==='register_generation_recipe_grant'){if(hash&&hash!==args.p_hash)data={kind:'conflict'};else{hash=String(args.p_hash);data={kind:revoked?'revoked':'registered'};}}
  else if(name==='claim_generation_recipe_attempt'){if(state==='completed')data={kind:'replay'};else if(state!=='authorized')data={kind:'unresolved'};else{state='running';attempt=String(args.p_attempt);data={kind:'started'};}}
  else if(name==='finish_generation_recipe_attempt'){state='completed';drafts++;data={kind:'completed'};}
  else if(name==='mark_generation_recipe_uncertain'){if(state==='running')state='uncertain';data={kind:'retained'};}
  else if(name==='read_generation_recipe_receipt')data={kind:'receipt',grant_id:G,actor_id:A,case_id:C,email_id:E,state,attempt_id:attempt,draft_id:state==='completed'?'55555555-5555-4555-8555-555555555555':null,engine_verified:state==='completed'?true:null,revoked};
  else if(name==='revoke_generation_recipe_grant'){revoked=true;data={kind:'revoked'};}
  else throw Error('Unexpected RPC '+name);
  return {data,error:null};
 };return {calls,rpc,get drafts(){return drafts;},get state(){return state;}};
}
const fixtureOptions={policyText:null,ledgerPolicyText:JSON.stringify(policy),ledgerReady:'1',attachments:[]};
Deno.test('ledger real handler admits once, uses validated JWT for engine, creates no files and only terminal receipt',async()=>{
 const db=ledgerDouble();const r=await runRecipeFixture({...fixtureOptions,request:body,ledgerRpc:db.rpc});assertEquals(r.status,200,JSON.stringify(r.output));assertEquals(r.extraction,1);assertEquals(r.finalAi,1);assertEquals(db.drafts,1);assertEquals(r.drafts.length,1);assertEquals(r.generatedFiles,0);assertEquals(r.storage,0);assertEquals(r.attachmentUpdates,0);assertEquals(r.engineTokens,['synthetic-A']);assertEquals(r.authTokens,['synthetic-A','synthetic-A']);assertEquals(r.output.data.recipe_receipt.state,'completed');assertEquals(db.calls.map(c=>c.name),['register_generation_recipe_grant','claim_generation_recipe_attempt','finish_generation_recipe_attempt','read_generation_recipe_receipt']);assert(db.calls.every(c=>c.args.p_actor===A));assert(!JSON.stringify(r.output).includes('Synthetic reply'));
 const replay=await runRecipeFixture({...fixtureOptions,request:{...body,recipe_attempt_id:crypto.randomUUID()},ledgerRpc:db.rpc});assertEquals(replay.status,200,JSON.stringify(replay.output));assertEquals(replay.extraction,0);assertEquals(replay.finalAi,0);assertEquals(db.drafts,1);assertEquals(replay.output.data.recipe_receipt.attempt_id,ATTEMPT);
});
for(const token of ['synthetic-service','invalid'])Deno.test('ledger real handler refuses non-user token '+token,async()=>{const db=ledgerDouble();const r=await runRecipeFixture({...fixtureOptions,request:body,ledgerRpc:db.rpc,token});assertEquals(r.status,401);assertEquals(db.calls.length,0);assertEquals(r.extraction,0);});
Deno.test('ledger real handler body actor cannot replace validated JWT',async()=>{const db=ledgerDouble();const r=await runRecipeFixture({...fixtureOptions,request:{...body,actor_user_id:A,userId:A},ledgerRpc:db.rpc,token:'synthetic-B'});assertEquals(r.status,403);assertEquals(db.calls.length,0);assertEquals(r.extraction,0);});
Deno.test('ledger real handler read status remains strictly readonly without any activation',async()=>{const db=ledgerDouble();const r=await runRecipeFixture({policyText:null,request:{...body,recipe_action:'status'},ledgerRpc:db.rpc});assertEquals(r.status,200,JSON.stringify(r.output));assertEquals(db.calls.map(c=>c.name),['read_generation_recipe_receipt']);assertEquals(r.extraction,0);assertEquals(r.finalAi,0);assertEquals(r.runtimeEvents,0);assertEquals(r.usageUpdates,0);assertEquals(r.drafts.length,1);assertEquals(r.generatedFiles,0);});
Deno.test('ledger real handler revoke is explicit and never generates',async()=>{const db=ledgerDouble();const r=await runRecipeFixture({policyText:null,request:{...body,recipe_action:'revoke'},ledgerRpc:db.rpc});assertEquals(r.status,200);assertEquals(r.output.data.recipe_receipt.revoked,true);assertEquals(db.calls.map(c=>c.name),['revoke_generation_recipe_grant','read_generation_recipe_receipt']);assertEquals(r.extraction+r.finalAi,0);});
for(const stage of ['register_generation_recipe_grant','claim_generation_recipe_attempt','finish_generation_recipe_attempt']) Deno.test('ledger real handler lost '+stage+' outcome never retries AI or admission',async()=>{const db=ledgerDouble();const r=await runRecipeFixture({...fixtureOptions,request:body,ledgerRpc:async(n,a)=>{const result=await db.rpc(n,a);return n===stage?{data:null,error:{code:'08006',message:'SYNTHETIC PRIVATE ERROR'}}:result;}});assertEquals(r.status,503,JSON.stringify(r.output));assertEquals(r.output.error.code,'RECIPE_LEDGER_UNCONFIRMED');assertEquals(db.calls.filter(c=>c.name===stage).length,1);assertEquals(r.extraction,stage==='finish_generation_recipe_attempt'?1:0);assert(!JSON.stringify(r.output).includes('PRIVATE'));if(stage==='claim_generation_recipe_attempt')assertEquals(db.state,'uncertain');if(stage==='finish_generation_recipe_attempt')assertEquals(db.state,'completed');});
Deno.test('ledger real handler engine admission loss preserves unresolved fence and no draft',async()=>{const db=ledgerDouble();const r=await runRecipeFixture({...fixtureOptions,request:body,ledgerRpc:db.rpc,revokeAtEngine:true});assertEquals(r.status,503);assertEquals(db.drafts,0);assertEquals(db.state,'uncertain');assertEquals(r.generatedFiles,0);assertEquals(db.calls.at(-1)?.name,'mark_generation_recipe_uncertain');});
for(const mode of ['normal','v1'])Deno.test('ledger '+mode+' always takes and ends durable email lease even with READY absent',async()=>{const calls:string[]=[];const r=await runRecipeFixture({policyText:mode==='v1'?undefined:null,request:mode==='v1'?{}:{recipe_mode:undefined,recipe_email_id:undefined,emailId:E},ledgerRpc:async(n)=>{calls.push(n);return {data:{kind:n==='begin_generation_email_lease'?'started':'retained'},error:null};}});assertEquals(r.status,200,JSON.stringify(r.output));assertEquals(calls,['begin_generation_email_lease','finish_generation_email_lease']);});
Deno.test('ledger absent migration blocks normal AI instead of silently bypassing lease',async()=>{const r=await runRecipeFixture({policyText:null,request:{recipe_mode:undefined,recipe_email_id:undefined,emailId:E},ledgerRpc:async()=>({data:null,error:{code:'PGRST202'}})});assertEquals(r.status,503);assertEquals(r.extraction+r.finalAi,0);assertEquals(r.drafts.length,1);});
for(const failure of ['draftAckLost','fileAckLost'] as const)Deno.test('ledger normal retains active reservation after '+failure,async()=>{const calls:string[]=[];const r=await runRecipeFixture({policyText:null,request:{recipe_mode:undefined,recipe_email_id:undefined,emailId:E},[failure]:true,ledgerRpc:async n=>{calls.push(n);return {data:{kind:'started'},error:null};}});assertEquals(r.status,failure==='draftAckLost'?500:200);assertEquals(calls,['begin_generation_email_lease']);});

// Normal/V1 terminal lifecycle; shared fixture already imported above.
const normal={recipe_mode:undefined,recipe_email_id:undefined,emailId:E};
type Fault=NonNullable<Parameters<typeof runRecipeFixture>[0]>;
function ledger(){
 let active:Record<string,unknown>|null=null;
 const calls:Array<{name:string;args:Record<string,unknown>}>=[];
 const rpc=async(name:string,args:Record<string,unknown>)=>{
  calls.push({name,args});
  if(name==='begin_generation_email_lease'){
   if(active)return {data:{kind:'unresolved'},error:null};
   active={...args};return {data:{kind:'started'},error:null};
  }
  assertEquals(name,'finish_generation_email_lease');
  if(active&&active.p_lease===args.p_lease&&active.p_actor===args.p_actor&&active.p_fence===args.p_fence)active=null;
  return {data:{kind:'retained'},error:null};
 };
 return {rpc,calls,get active(){return active;}};
}
const safe:Array<[string,Fault,number]>=[
 ['empty body',{emailBody:''},400],
 ['zone confirmation',{destination:'SYNTHETIC UNKNOWN CITY',request:{...normal,zone_reply_contract:undefined}},409],
 ['engine unavailability',{engineFault:true},503],
 ['extraction HTTP refusal',{extractionFault:'http'},500],
 ['extraction transport ended without output',{extractionFault:'network'},500],
 ['final AI HTTP refusal',{finalFault:'http'},500],
 ['final AI transport ended without output',{finalFault:'network'},500],
 ['final response parse error',{finalFault:'parse'},500],
 ['database permission rejection',{draftRejectCode:'42501'},500],
 ['database constraint rejection',{draftRejectCode:'23505'},500],
];
for(const [name,fault,status] of safe)Deno.test('normal lease safe terminal: '+name+' permits only a later explicit invocation',async()=>{
 const db=ledger();
 const first=await runRecipeFixture({policyText:null,request:normal,attachmentOutput:false,attachments:[],...fault,ledgerRpc:db.rpc});
 assertEquals(first.status,status,JSON.stringify(first.output));assertEquals(first.drafts.length,1,'Existing draft is retained; no new draft from failed attempt');
 assertEquals(first.generatedFiles,0);assertEquals(db.calls.map(x=>x.name),['begin_generation_email_lease','finish_generation_email_lease']);assertEquals(db.active,null);
 const start=db.calls[0].args,end=db.calls[1].args;
 for(const key of ['p_lease','p_actor','p_fence'])assertEquals(end[key],start[key]);
 const next=await runRecipeFixture({policyText:null,request:normal,attachments:[],attachmentOutput:false,ledgerRpc:db.rpc});
 assertEquals(next.status,200,JSON.stringify(next.output));assertEquals(next.drafts.length,2);assertEquals(next.extraction,1);assertEquals(db.active,null);
 assertEquals(db.calls.filter(c=>c.name==='begin_generation_email_lease').length,2,'No automatic admission retry inside either request');
});
for(const [name,fault,status] of [
 ['lost draft ACK',{draftAckLost:true},500],
 ['malformed draft ACK',{draftMalformedAck:true},500],
 ['unclassified database error',{draftRejectCode:'XX000'},500],
 ['connection SQLSTATE',{draftRejectCode:'08006'},500],
 ['cancellation SQLSTATE',{draftRejectCode:'57014'},500],
 ['unconfirmed generated file',{fileAckLost:true},200],
] as Array<[string,Fault,number]>)Deno.test('normal lease uncertain terminal: '+name+' retains reservation and prevents a second worker',async()=>{
 const db=ledger();const result=await runRecipeFixture({policyText:null,request:normal,attachments:[],...fault,ledgerRpc:db.rpc});
 assertEquals(result.status,status,JSON.stringify(result.output));assert(db.active);assertEquals(db.calls.map(c=>c.name),['begin_generation_email_lease']);
 const retry=await runRecipeFixture({policyText:null,request:normal,ledgerRpc:db.rpc});assertEquals(retry.status,409);assertEquals(retry.output.error.code,'RECIPE_TARGET_UNRESOLVED');assertEquals(retry.extraction+retry.finalAi,0);
});
Deno.test('normal lease unconfirmed begin never finishes an unacknowledged or foreign lease',async()=>{
 const db=ledger();const first=await runRecipeFixture({policyText:null,request:normal,ledgerRpc:async(n,a)=>{await db.rpc(n,a);return {data:null,error:{code:'08006'}};}});
 assertEquals(first.status,503);assertEquals(first.extraction+first.finalAi,0);assert(db.active);assertEquals(db.calls.map(c=>c.name),['begin_generation_email_lease']);
 const next=await runRecipeFixture({policyText:null,request:normal,ledgerRpc:db.rpc});assertEquals(next.status,409);assertEquals(next.extraction+next.finalAi,0);assertEquals(db.calls.filter(x=>x.name==='finish_generation_email_lease').length,0);
});
Deno.test('normal lease release ACK loss is not replayed and cannot repeat AI or draft writes',async()=>{
 const db=ledger();const r=await runRecipeFixture({policyText:null,request:normal,emailBody:'',attachments:[],ledgerRpc:async(n,a)=>{const result=await db.rpc(n,a);return n==='finish_generation_email_lease'?{data:null,error:{code:'08006'}}:result;}});
 assertEquals(r.status,400);assertEquals(r.extraction+r.finalAi,0);assertEquals(r.drafts.length,1);assertEquals(db.calls.map(x=>x.name),['begin_generation_email_lease','finish_generation_email_lease']);
});
Deno.test('V1 known no-file refusal finishes only its own lease; V2 and quarantine paths remain separate',async()=>{
 const db=ledger();const r=await runRecipeFixture({linkOutput:true,ledgerRpc:db.rpc});assertEquals(r.status,409);assertEquals(r.drafts.length,1);assertEquals(db.calls.map(x=>x.name),['begin_generation_email_lease','finish_generation_email_lease']);assertEquals(db.active,null);
 const q=await runRecipeFixture({policyText:null,request:normal,blockedEmails:JSON.stringify([E]),ledgerRpc:db.rpc});assertEquals(q.status,409);assertEquals(q.output.error.code,'RECIPE_PRIOR_EXECUTION_UNCONFIRMED');assertEquals(db.calls.length,2);assertEquals(q.extraction+q.finalAi,0);
});

for(const invalid of ['not-a-uuid','',null,17,{},[]])Deno.test('normal lease invalid draft key '+JSON.stringify(invalid)+' remains uncertain',async()=>{
 const db=ledger();const first=await runRecipeFixture({policyText:null,request:normal,attachments:[],attachmentOutput:false,draftAckId:invalid,ledgerRpc:db.rpc});
 assertEquals(first.status,500);assert(db.active);assertEquals(db.calls.map(c=>c.name),['begin_generation_email_lease']);
 const next=await runRecipeFixture({policyText:null,request:normal,ledgerRpc:db.rpc});assertEquals(next.status,409);assertEquals(next.extraction+next.finalAi,0);
});
