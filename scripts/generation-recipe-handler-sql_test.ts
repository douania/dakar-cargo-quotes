import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { runRecipeFixture } from '../supabase/functions/generate-response/recipe-mode_test.ts';
import { IDEMPOTENT_RECIPE } from '../supabase/functions/generate-response/recipe-ledger.ts';

// Only the owning offline runner supplies this ID. No sockets, ports, secrets,
// real JWTs, Cloud APIs or business records are used by this integration test.
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const E='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',C='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const G='33333333-3333-4333-8333-333333333333',ATTEMPT='44444444-4444-4444-8444-444444444444';
const encoder=new TextDecoder();
const lit=(v:unknown)=>v===null?'NULL':typeof v==='boolean'?String(v):"'"+String(v).replaceAll("'","''")+"'";
Deno.test('ledger SQL pipeline: real handler, actual PostgreSQL receipt transaction, status and lost ACK',async()=>{
 const cid=Deno.env.get('RECIPE_SQL_TEST_CONTAINER');assert(cid&&/^[0-9a-f]{64}$/.test(cid),'Only an explicitly owned synthetic container is allowed');
 const inspect=await new Deno.Command('docker',{args:['inspect','--format','{{index .Config.Labels "dcq.local.test"}}',cid],stdout:'piped',stderr:'piped'}).output();assertEquals(encoder.decode(inspect.stdout).trim(),'generation-recipe-ledger');
 async function sql(text:string){const p=new Deno.Command('docker',{args:['exec','-i',cid!,'psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],stdin:'piped',stdout:'piped',stderr:'piped'}).spawn();const w=p.stdin.getWriter();await w.write(new TextEncoder().encode(text));await w.close();const r=await p.output();return {code:r.code,out:encoder.decode(r.stdout).trim(),err:encoder.decode(r.stderr)};}
 const calls:string[]=[];
 const rpc=async(name:string,args:Record<string,unknown>)=>{calls.push(name);assert(/^(register_generation_recipe_grant|claim_generation_recipe_attempt|finish_generation_recipe_attempt|mark_generation_recipe_uncertain|read_generation_recipe_receipt|revoke_generation_recipe_grant|begin_generation_email_lease|finish_generation_email_lease)$/.test(name));const q='SET ROLE service_role;SET request.jwt.claims='+lit(JSON.stringify({role:'service_role'}))+';SELECT public.'+name+'('+Object.entries(args).map(([k,v])=>{assert(/^p_[a-z_]+$/.test(k));return k+'=>'+lit(v);}).join(',')+');';const r=await sql(q);return r.code?{data:null,error:{code:r.err.includes('42501')?'42501':'XX000',message:'Synthetic SQL error'}}:{data:JSON.parse(r.out),error:null};};
 const reset=await sql('TRUNCATE public.generation_recipe_attempts,public.generation_recipe_grants,public.generation_recipe_email_leases,public.generation_recipe_quarantines,public.email_drafts;');assertEquals(reset.code,0,reset.err);
 const now=Date.now(),policy={grant_id:G,actor_user_id:A,case_id:C,email_id:E,starts_at:new Date(now-1000).toISOString(),expires_at:new Date(now+900000).toISOString()};
 const body={recipe_mode:IDEMPOTENT_RECIPE,recipe_grant_id:G,recipe_case_id:C,recipe_email_id:E,recipe_attempt_id:ATTEMPT,zone_reply_contract:'optional_factor_v1',actor_user_id:B,fence:'forged-client-value'};
 const options={policyText:null,ledgerPolicyText:JSON.stringify(policy),ledgerReady:'1',attachments:[],now,ledgerRpc:rpc};
 // A normal draft INSERT loses its transport ACK. Its durable lease must stay
 // active while a delayed remote commit could still be pending.
 const ordinary=await runRecipeFixture({policyText:null,now,request:{recipe_mode:undefined,recipe_email_id:undefined,emailId:E},draftAckLost:true,ledgerRpc:rpc});assertEquals(ordinary.status,500);assertEquals((await sql("SELECT count(*) FROM public.generation_recipe_email_leases WHERE state='active';")).out,'1');
 const blocked=await runRecipeFixture({...options,request:body});assertEquals(blocked.status,409);assertEquals(blocked.extraction+blocked.finalAi,0);assertEquals(blocked.output.error.code,'RECIPE_TARGET_UNRESOLVED');
 const delayed=await sql("INSERT INTO public.email_drafts(original_email_id,to_addresses,subject,body_text,status,ai_generated,created_by) VALUES("+lit(E)+",ARRAY['sender@example.invalid'],'Synthetic delayed ACK','Synthetic','draft',true,"+lit(A)+");");assertEquals(delayed.code,0,delayed.err);
 const stillBlocked=await runRecipeFixture({...options,request:body});assertEquals(stillBlocked.status,409);assertEquals(stillBlocked.extraction+stillBlocked.finalAi,0);
 assertEquals((await sql('TRUNCATE public.generation_recipe_attempts,public.generation_recipe_grants,public.generation_recipe_email_leases,public.email_drafts;')).code,0);
 const first=await runRecipeFixture({...options,request:body});assertEquals(first.status,200,JSON.stringify(first.output));assertEquals(first.engineTokens,['synthetic-A']);assertEquals(first.authTokens,['synthetic-A','synthetic-A']);assertEquals(first.extraction,1);assertEquals(first.finalAi,1);assertEquals(first.generatedFiles+first.storage+first.attachmentUpdates,0);assertEquals(first.drafts.length,1,'V2 never uses the old direct draft insert');assertEquals(first.output.data.recipe_receipt.state,'completed');const draft=first.output.data.recipe_receipt.draft_id;
 assertEquals((await sql('SELECT count(*) FROM public.email_drafts;')).out,'1');assertEquals((await sql("SELECT count(*) FROM public.generation_recipe_attempts WHERE state='completed' AND draft_id="+lit(draft)+" AND actor_id="+lit(A)+" AND fence::text<>'forged-client-value';")).out,'1');
 const replay=await runRecipeFixture({...options,request:{...body,recipe_attempt_id:crypto.randomUUID()}});assertEquals(replay.status,200,JSON.stringify(replay.output));assertEquals(replay.output.data.recipe_receipt.draft_id,draft);assertEquals(replay.extraction+replay.finalAi,0);assertEquals((await sql('SELECT count(*) FROM public.email_drafts;')).out,'1');
 const before=(await sql("SELECT md5(string_agg(row_to_json(t)::text,'|' ORDER BY id)) FROM public.generation_recipe_attempts t;")).out;calls.length=0;
 const status=await runRecipeFixture({policyText:null,now,request:{...body,recipe_action:'status'},ledgerRpc:rpc});assertEquals(status.status,200);assertEquals(status.output.data.recipe_receipt.draft_id,draft);assertEquals(calls,['read_generation_recipe_receipt']);assertEquals(status.extraction+status.finalAi+status.runtimeEvents+status.usageUpdates,0);assertEquals((await sql("SELECT md5(string_agg(row_to_json(t)::text,'|' ORDER BY id)) FROM public.generation_recipe_attempts t;")).out,before);
 const foreign=await runRecipeFixture({policyText:null,now,token:'synthetic-B',request:{...body,recipe_action:'status'},ledgerRpc:rpc});assertEquals(foreign.status,404);assert(!JSON.stringify(foreign.output).includes(draft));
 const revokedRole=await sql('DELETE FROM public.app_roles WHERE user_id='+lit(A)+';');assertEquals(revokedRole.code,0);const denied=await runRecipeFixture({policyText:null,now,request:{...body,recipe_action:'status'},ledgerRpc:rpc});assertEquals(denied.status,403);assertEquals(denied.extraction+denied.finalAi,0);assertEquals((await sql('SELECT count(*) FROM public.email_drafts;')).out,'1');
});
