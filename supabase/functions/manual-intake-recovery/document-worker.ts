/** Claims are durable before effects. No timeout/lease implies success or retry.
 * Driver lookup is observation only. The default runtime binds upload verification
 * only; extraction/analysis need an idempotent adapter, never a blind legacy call. */
import { RecoveryError, validateDocumentStepOutput, canonicalJson, sha256Bytes } from '../manual-intake/prepare.generated.js';
type Auth={token:string;user:{id:string}};
export interface DocumentWorkerDependencies {
 call(auth:Auth,id:string,action:string,payload:Record<string,unknown>):Promise<Record<string,unknown>>;
 finish(auth:Auth,id:string,step:string,claim:string,state:string,output:unknown,error:string|null):Promise<unknown>;
 verify(auth:Auth,operation:Record<string,unknown>):Promise<Record<string,unknown>>;
 canRun(step:string):boolean;
 perform?(auth:Auth,operation:Record<string,unknown>,step:string,claim:string):Promise<unknown>;
 lookup?(auth:Auth,operation:Record<string,unknown>,step:string,claim:string):Promise<unknown|null>;
 randomUUID():string;
}
export function createDocumentWorker(deps:DocumentWorkerDependencies){return async(auth:Auth,operation:Record<string,unknown>,payload:Record<string,unknown>)=>{
 const id=operation.operation_id as string,step=payload.step as string,recover=payload.recover===true;
 if(!['upload','extraction','analysis'].includes(step))throw new RecoveryError('DOCUMENT_STEP_INVALID');
 const draft=operation.draft as {file:Record<string,unknown>|null};if(!draft.file)throw new RecoveryError('DOCUMENT_REQUIRED');
 const sourceHash=async(text:string)=>await sha256Bytes(new TextEncoder().encode(text).buffer);
 const extraction=(operation.steps as Record<string,Record<string,unknown>>).extraction;
 const expectedInput=step==='upload'?{descriptor:draft.file}:step==='extraction'?{file_sha256:draft.file.sha256}:extraction?.state==='complete'?{file_sha256:draft.file.sha256,extraction_claim_id:extraction.claim_id,text_sha256:await sourceHash((extraction.output as Record<string,unknown>).text as string)}:null;
 if(!expectedInput)throw new RecoveryError('EXTRACTION_REQUIRED');
 let row=operation,entry=(row.steps as Record<string,Record<string,unknown>>)[step];
 if(entry&&canonicalJson(entry.input)!==canonicalJson(expectedInput))throw new RecoveryError('DOCUMENT_SOURCE_CHANGED','UNKNOWN');
 if(entry?.state==='complete'){await deps.verify(auth,row);return row;}
 if(!entry&&recover)return row; // restore never starts work
 if(!entry){
  if(step==='upload'||!deps.canRun(step)||!deps.perform)throw new RecoveryError('DOCUMENT_DRIVER_UNAVAILABLE');
  if(operation.state!=='reserved')throw new RecoveryError('OPERATION_FROZEN');
  const claim=deps.randomUUID(),input=expectedInput;
  row=await deps.call(auth,id,'claim',{step,claim_id:claim,input});entry=(row.steps as Record<string,Record<string,unknown>>)[step];
  if(row.claimed!==true)return row;
  if(!entry||entry.claim_id!==claim||entry.state!=='running'||canonicalJson(entry.input)!==canonicalJson(expectedInput)||canonicalJson((row.draft as {file:unknown}).file)!==canonicalJson(draft.file))throw new RecoveryError('DOCUMENT_TICKET_CHANGED','UNKNOWN');
 }else if(!recover)return row; // running/unknown/failed never silently re-execute
 const claim=entry.claim_id as string;
 if(entry.state==='failed')return row;
 let output:unknown;
 try{
  if(recover){output=step==='upload'?await deps.verify(auth,row):await deps.lookup?.(auth,row,step,claim);if(!output)throw new RecoveryError('PROVIDER_RESULT_UNCONFIRMED','UNKNOWN');}
  else{await deps.verify(auth,row);output=await deps.perform!(auth,row,step,claim);}
  output=validateDocumentStepOutput(step,output,draft.file,{operation_id:id,claim_id:claim,input:expectedInput});
  if(step==='extraction'&&(output as Record<string,unknown>).text_sha256!==await sourceHash((output as Record<string,unknown>).text as string))throw new RecoveryError('DOCUMENT_SOURCE_CHANGED','UNKNOWN');
 }catch(error){
  const known=error instanceof RecoveryError?error:new RecoveryError('DOCUMENT_STEP_UNCONFIRMED','UNKNOWN');
  // A read failure after an uncertain upload is not proof of a failed write.
  const state=known.outcome==='UNKNOWN'||recover?'unknown':'failed';
  return await deps.finish(auth,id,step,claim,state,null,/^[A-Z_]{1,64}$/.test(known.code)?known.code:'DOCUMENT_STEP_UNCONFIRMED');
 }
 return await deps.finish(auth,id,step,claim,'complete',output,null);
};}
