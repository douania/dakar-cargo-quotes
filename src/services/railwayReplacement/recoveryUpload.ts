/** Candidate upload port. No default Storage client and no application routing.
 * A production binding must use the captured actor JWT, with upsert:false.
 * An uncertain first write is only observed, never automatically repeated. */
import type {RecoveryGateway,RecoveryTransport} from './recoveryClient';
import {RecoveryError,canonicalJson,type IntakeFileDescriptor} from './recoveryContract';
import {readFileBytes,sha256Bytes} from './intakeDocument';
export interface IntakeUploadPort {put(actor:string,path:string,bytes:Blob,options:{upsert:false},canContinue?:()=>void):Promise<{error:unknown}>}
export function createRecoveryUploader(gateway:RecoveryGateway,storage:IntakeUploadPort,randomUUID:()=>string){return async(id:string,file:Blob,descriptor:IntakeFileDescriptor)=>{
 const actor=await gateway.identity();const read=await gateway.call(id,'read');if(!read.found||read.actor_user_id!==actor||canonicalJson(read.draft.file)!==canonicalJson(descriptor))throw new RecoveryError('DOCUMENT_SOURCE_CHANGED');
 if(read.steps.upload)return gateway.call(id,'recover_step',{step:'upload'});
 if(file.size!==descriptor.size||await sha256Bytes(await readFileBytes(file))!==descriptor.sha256)throw new RecoveryError('FILE_CHANGED');
 const claim=randomUUID(),claimed=await gateway.call(id,'claim',{step:'upload',claim_id:claim,input:{descriptor}});
 if(!claimed.found)throw new RecoveryError('DOCUMENT_TICKET_CHANGED','UNKNOWN');
 if(!claimed.claimed)return gateway.call(id,'recover_step',{step:'upload'});
 const step=claimed.steps.upload;
 if(claimed.actor_user_id!==actor||canonicalJson(claimed.draft.file)!==canonicalJson(descriptor)||!step||step.claim_id!==claim||step.state!=='running'||canonicalJson(step.input)!==canonicalJson({descriptor}))throw new RecoveryError('DOCUMENT_TICKET_CHANGED','UNKNOWN');
 if(await gateway.identity()!==actor)throw new RecoveryError('ACTOR_CHANGED','UNKNOWN');
 try{await storage.put(actor,descriptor.path,file,{upsert:false});}catch{/* A lost upload ack cannot prove absence; observe the same path below. */}
 if(await gateway.identity()!==actor)throw new RecoveryError('ACTOR_CHANGED','UNKNOWN');
 return gateway.call(id,'recover_step',{step:'upload'});
};}

/** Explicit SDK binding for a future connected bench. No default client, URL,
 * token persistence, privileged key or automatic call. The installed SDK accepts
 * per-upload headers; pin the captured actor JWT rather than mutable client auth. */
export function createRecoveryUploadPort(transport:Pick<RecoveryTransport,'auth'>&{storage:{from(bucket:string):{upload(path:string,bytes:Blob,options:{upsert:false;headers:Record<string,string>}):Promise<{error:unknown}>}}}):IntakeUploadPort{
 return {async put(actor,path,bytes,options,canContinue){
  const result=await transport.auth.getSession();const session=result.data.session;
  if(result.error||!session?.access_token)throw new RecoveryError('AUTH_REQUIRED');
  if(session.user.id!==actor)throw new RecoveryError('ACTOR_CHANGED','UNKNOWN');
  canContinue?.();
  return transport.storage.from('case-documents').upload(path,bytes,{upsert:false,headers:{Authorization:`Bearer ${session.access_token}`}});
 }};
}
