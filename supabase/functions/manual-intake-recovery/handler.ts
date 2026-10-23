/** Inactive recovery endpoint. Canonical writes always use the admitted user JWT.
 * External-step attestations are separate, service-only journal writes. */
import { jsonResponse, handleCors } from '../_shared/cors.ts';
import { prepareManualIntake, validateRecoveryDraft, decodeRecoveryOperation, uuid, RecoveryError } from '../manual-intake/prepare.generated.js';
export interface RecoveryDependencies {
 authenticate(req:Request):Promise<{token:string;user:{id:string}}|Response>;
 rpc(token:string,name:string,params:Record<string,unknown>):Promise<{data:unknown;error:{code?:string;message?:string}|null}>;
 attestPrepared(auth:{token:string;user:{id:string}},id:string,payload:Record<string,unknown>):Promise<{data:unknown;error:{code?:string;message?:string}|null}>;
 verifyFile?(token:string,operation:Record<string,unknown>):Promise<void>;
 documentStep?(auth:{token:string;user:{id:string}},operation:Record<string,unknown>,payload:Record<string,unknown>):Promise<unknown>;
}
class RpcFailure extends Error {constructor(readonly detail:{code?:string;message?:string}){super('RPC_FAILED');}}
export async function readRecoveryBody(req:Request){const reader=req.body?.getReader();if(!reader)throw new RecoveryError('INVALID_JSON');const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576){void reader.cancel().catch(()=>{});throw new RecoveryError('PAYLOAD_LIMIT');}chunks.push(value);}}finally{reader.releaseLock();}
 const data=new Uint8Array(size);let offset=0;for(const x of chunks){data.set(x,offset);offset+=x.length;}try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));}catch{throw new RecoveryError('INVALID_JSON');}}
const fail=(code:string,status:number,outcome:'BLOCKED'|'UNKNOWN'='BLOCKED')=>jsonResponse({ok:false,error:{code,outcome}},status);
export function createRecoveryHandler(deps:RecoveryDependencies){return async(req:Request):Promise<Response>=>{
 const cors=handleCors(req);if(cors)return cors;if(req.method!=='POST')return fail('METHOD_NOT_ALLOWED',405);
 let auth;try{auth=await deps.authenticate(req);}catch{return fail('AUTH_UNAVAILABLE',503);}
 if(auth instanceof Response)return fail(auth.status===401?'AUTH_REQUIRED':auth.status===403?'WORKSPACE_ACCESS_DENIED':'AUTH_UNAVAILABLE',[401,403,503].includes(auth.status)?auth.status:503);
 if(req.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return fail('JSON_REQUIRED',415);
 let mutationStarted=false;
 try{
  const raw=await readRecoveryBody(req);if(!raw||typeof raw!=='object'||Array.isArray(raw)||!uuid(raw.operation_id)||!['read','reserve','save','prepare','commit','abandon','claim','link','verify','step','recover_step','document_result','archive_read'].includes(raw.action)||!raw.payload||typeof raw.payload!=='object'||Array.isArray(raw.payload)||Object.keys(raw).some(k=>!['operation_id','action','payload'].includes(k)))throw new RecoveryError('INVALID_COMMAND');
  const id=raw.operation_id,action=raw.action,payload=raw.payload;
  const call=async(a:string,p:Record<string,unknown>={})=>{if(a!=='read')mutationStarted=true;const result=await deps.rpc(auth.token,'manual_intake_operation',{p_id:id,p_action:a,p_payload:p});if(result.error)throw new RpcFailure(result.error);return decodeRecoveryOperation(result.data,id,auth.user.id);};
  if(action==='reserve'||action==='save')validateRecoveryDraft(payload.draft,id);
  let result;
  if(action==='prepare'){
   const row=await call('read');if(!row.found)throw new RecoveryError('OPERATION_NOT_FOUND');
   // A frozen historical classifier/batch must never be reconstructed on replay.
   if(row.prepared!==null)result=row;
   else{if(payload.expected_revision!==row.revision)throw new RecoveryError('REVISION_CONFLICT');const body={version:1,case_id:id,...row.draft.form};const p=prepareManualIntake(body);mutationStarted=true;const response=await deps.attestPrepared(auth,id,{expected_revision:row.revision,body,command:p.command,classifier_version:'railway-c34c6dc-native-v1'});if(response.error)throw new RpcFailure(response.error);result=decodeRecoveryOperation(response.data,id,auth.user.id);}
  }else if(['commit','link','verify','step','recover_step','document_result','archive_read'].includes(action)){
   const row=await call('read');if(!row.found)throw new RecoveryError('OPERATION_NOT_FOUND');
   if(action==='document_result'||action==='archive_read'){
    if(!['extraction','analysis'].includes(payload.step))throw new RecoveryError('DOCUMENT_STEP_INVALID');
    const response=await deps.rpc(auth.token,action==='archive_read'?'manual_intake_archive_read':'manual_intake_document_result',{p_id:id,p_step:payload.step});if(response.error)throw new RpcFailure(response.error);
    result=decodeRecoveryOperation({...row,document_result:{...response.data as object,step:payload.step}},id,auth.user.id);
   }else if(action==='step'||action==='recover_step'){

    if(!deps.documentStep)throw new RecoveryError('DOCUMENT_DRIVER_UNAVAILABLE');
    mutationStarted=true;result=await deps.documentStep(auth,row as unknown as Record<string,unknown>,{...payload,recover:action==='recover_step'});
   }else{
    if(row.draft.file){if(!deps.verifyFile)throw new RecoveryError('FILE_VERIFICATION_UNAVAILABLE');await deps.verifyFile(auth.token,row as unknown as Record<string,unknown>);}
    result=action==='verify'?row:await call(action,payload);
   }
  }else result=await call(action,payload);
  return jsonResponse({ok:true,data:result});
 }catch(error){
  if(error instanceof RpcFailure){const {code,message=''}=error.detail;
   if(code==='42501'&&/^(MIR_(AUTH_REQUIRED|OWNER_REQUIRED|CASE_ACCESS_DENIED)|DIS_(AUTH_REQUIRED|CASE_ACCESS_DENIED))$/.test(message))return fail('ACCESS_DENIED',403);
   if(code==='23505'&&/^MIR_[A-Z_]+$/.test(message))return fail(message,409);
   if(code==='23505'&&/^DIS_(IDEMPOTENCY_CONFLICT|LEGACY_BATCH_COLLISION)$/.test(message))return fail('INTAKE_CONFLICT',409);
   if(code==='P0001'&&message==='PROTECTED_FACT_REQUIRES_OPERATOR')return fail('PROTECTED_FACT',409);
   // Trusted PostgreSQL error response attests rollback of this RPC, not a
   // transport failure. Never exposes a constraint name, row or raw message.
   if(code==='PT409'&&/^(Automatic source revision requires the ordered writer|Ordered source values require a successor|Ordered source fact requires an explicit or ordered successor)$/.test(message))return fail('SOURCE_REVISION_CONFLICT',409);
   if(code==='23505'&&/^duplicate key value violates unique constraint "(case_documents_case_id_file_name_unique|uq_quote_facts_current_key|intake_fact_batches_case_id_batch_key_key)"$/.test(message))return fail('INTAKE_CONFLICT',409);
   if(code==='22023'&&/^MIR_[A-Z_]+$/.test(message))return fail('VALIDATION_FAILED',400);
   return fail('RECOVERY_UNCONFIRMED',503,mutationStarted?'UNKNOWN':'BLOCKED');
  }
  if(error instanceof RecoveryError)return fail(error.code,error.code==='PAYLOAD_LIMIT'?413:409,error.outcome==='UNKNOWN'?'UNKNOWN':'BLOCKED');
  // A decoder/file-read error never prints its source or proves a prior write absent.
  return fail('RECOVERY_UNCONFIRMED',503,mutationStarted?'UNKNOWN':'BLOCKED');
 }
};}
