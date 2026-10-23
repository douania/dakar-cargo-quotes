/** LOCAL INACTIVE CANDIDATE. No Cloud application or provider execution in tests. */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { requireUser } from '../_shared/auth.ts';
import { createRecoveryHandler } from './handler.ts';
import { createArchiveWorker } from './archive-worker.ts';
import { createDocumentWorker } from './document-worker.ts';
import { verifyIntakeFile, RecoveryError } from '../manual-intake/prepare.generated.js';
const userClient=(token:string)=>createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{auth:{persistSession:false},global:{headers:{Authorization:`Bearer ${token}`}}});
const serviceClient=()=>createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const rpc=async(token:string,name:string,params:Record<string,unknown>)=>{const {data,error}=await userClient(token).rpc(name,params);return {data,error};};
const verify=async(auth:{token:string},row:Record<string,unknown>)=>{const file=(row.draft as {file:unknown}).file;if(!file)throw new RecoveryError('DOCUMENT_REQUIRED');return await verifyIntakeFile({read:(path:string)=>userClient(auth.token).storage.from('case-documents').download(path)},file);};
const worker=createDocumentWorker({
 call:async(auth,id,action,payload)=>{const result=await rpc(auth.token,'manual_intake_operation',{p_id:id,p_action:action,p_payload:payload});if(result.error)throw new RecoveryError('STEP_CLAIM_UNCONFIRMED','UNKNOWN');return result.data as Record<string,unknown>;},
 finish:async(auth,id,step,claim,state,output,error)=>{
  // Service authority attests journal metadata only. It never calls a facts/case RPC.
  const result=await serviceClient().rpc('manual_intake_finish_step',{p_id:id,p_actor:auth.user.id,p_step:step,p_claim:claim,p_state:state,p_output:output,p_error:error});
  if(result.error)throw new RecoveryError('STEP_RECEIPT_UNCONFIRMED','UNKNOWN');return result.data;
 },verify,canRun:()=>false,randomUUID:()=>crypto.randomUUID(),
 // Upload verification only. Archive-aware extraction/analysis use the worker below.
});
const archiveWorker=createArchiveWorker({
 call:async(auth,id,action,payload)=>{const r=await rpc(auth.token,'manual_intake_operation',{p_id:id,p_action:action,p_payload:payload});if(r.error)throw new RecoveryError('STEP_RECEIPT_UNCONFIRMED','UNKNOWN');return r.data as Record<string,unknown>;},
 verify,randomUUID:()=>crypto.randomUUID(),
 invoke:async(auth,step,id,claim)=>{if(step==='extraction'){const body=new FormData();body.set('intake_operation_id',id);body.set('intake_claim_id',claim);return await userClient(auth.token).functions.invoke('parse-document',{body});}return await userClient(auth.token).functions.invoke('analyze-document',{body:{intake_ticket:{operation_id:id,claim_id:claim},analysisType:'transit_order'}});},
});
export const handleRequest=createRecoveryHandler({authenticate:requireUser,rpc,
 attestPrepared:async(auth,id,payload)=>{const {data,error}=await serviceClient().rpc('manual_intake_prepare',{p_id:id,p_actor:auth.user.id,p_payload:payload});return {data,error};},
 verifyFile:async(token,row)=>{await verify({token},row);},documentStep:(auth,row,payload)=>payload.step==='upload'?worker(auth,row,payload):archiveWorker(auth,row,payload),
});
if(import.meta.main)Deno.serve(handleRequest);
