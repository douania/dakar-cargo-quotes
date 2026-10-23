/** Archive-aware orchestration only: existing parse/analyze own algorithms.
 * Read/recover never starts work. Provider uniqueness is enforced by its SQL begin.
 * No automatic retry after authorization or UNKNOWN. */
import {canonicalJson,decodeRecoveryOperation,RecoveryError} from '../manual-intake/prepare.generated.js';
type Auth={token:string;user:{id:string}};
export interface ArchiveWorkerDependencies {
 call(auth:Auth,id:string,action:string,payload:Record<string,unknown>):Promise<Record<string,unknown>>;
 invoke(auth:Auth,step:string,id:string,claim:string):Promise<{data:unknown;error:unknown}>;
 verify(auth:Auth,row:Record<string,unknown>):Promise<unknown>;
 randomUUID():string;
}
export function createArchiveWorker(deps:ArchiveWorkerDependencies){return async(auth:Auth,operation:Record<string,unknown>,payload:Record<string,unknown>)=>{
 const id=operation.operation_id as string,step=payload.step as 'extraction'|'analysis';if(!['extraction','analysis'].includes(step))throw new RecoveryError('DOCUMENT_STEP_INVALID');
 const row0=decodeRecoveryOperation(operation,id,auth.user.id);if(!row0.found||!row0.draft.file)throw new RecoveryError('DOCUMENT_REQUIRED');
 let row=row0;const extraction=row.steps.extraction;
 const input=step==='extraction'?{file_sha256:row.draft.file.sha256}:extraction?.state==='complete'&&extraction.output?.archive_id?{file_sha256:row.draft.file.sha256,extraction_claim_id:extraction.claim_id,text_sha256:extraction.output.text_sha256}:null;
 if(!input)throw new RecoveryError('ARCHIVED_EXTRACTION_REQUIRED');
 const original=row.steps[step];if(original&&canonicalJson(original.input)!==canonicalJson(input))throw new RecoveryError('DOCUMENT_SOURCE_CHANGED','UNKNOWN');
 if(payload.recover===true)return await deps.call(auth,id,'read',{}); // observation only
 if(original?.state==='complete'){await deps.verify(auth,operation);return row;}
 if(original&&original.state!=='running')return row; // failed/unknown never rerun
 if(row.state!=='reserved')throw new RecoveryError('OPERATION_FROZEN');
 if(!original){
  const claim=deps.randomUUID();const response=await deps.call(auth,id,'claim',{step,claim_id:claim,input});const claimed=decodeRecoveryOperation(response,id,auth.user.id);if(!claimed.found)throw new RecoveryError('DOCUMENT_TICKET_CHANGED','UNKNOWN');row=claimed;
  const saved=row.steps[step];if(!saved||canonicalJson(saved.input)!==canonicalJson(input)||row.claimed===true&&saved.claim_id!==claim)throw new RecoveryError('DOCUMENT_TICKET_CHANGED','UNKNOWN');
  if(row.claimed!==true)return row; // competing reservation: no effect
 }
 const ticket=row.steps[step]!;if(ticket.dispatch_authorized===true)return row;
 await deps.verify(auth,row as unknown as Record<string,unknown>);
 try{
  const result=await deps.invoke(auth,step,id,ticket.claim_id);const envelope=result.data as {ok?:boolean;data?:unknown}|null;
  if(!result.error&&envelope?.ok===true){const confirmed=decodeRecoveryOperation(envelope.data,id,auth.user.id);if(confirmed.found&&confirmed.steps[step]?.claim_id===ticket.claim_id)return confirmed;}
 }catch{/* Observe the same ticket; never invoke the provider again. */}
 return await deps.call(auth,id,'read',{});
};}
