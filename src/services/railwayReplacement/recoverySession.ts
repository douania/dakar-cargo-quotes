/** Explicit inactive session. Only an opaque UUID enters the navigation reference.
 * Source/receipt recovery is an admitted server read; never browser persistence.
 * A missing row is not permission to recreate it. No automatic retry or fallback. */
import { RecoveryError, canonicalJson, uuid, type RecoveryOperation, type RecoveryDraft } from './recoveryContract';
import type { RecoveryGateway } from './recoveryClient';
import type { ManualIntakeForm } from './manualIntakeCommand';
import { validateDurableIntakeReceipt } from './durableIntake';
import {describeIntakeFile} from './intakeDocument';
import {createRecoveryUploader,type IntakeUploadPort} from './recoveryUpload';
import {validateRecoveryDraft} from './recoveryContract';
export interface IntakeReference { read():string|null; write(id:string|null):void }
export function createRecoverySession(gateway:RecoveryGateway,reference:IntakeReference,randomUUID:()=>string,storage?:IntakeUploadPort) {
 let id=reference.read(),actor:string|undefined,row:RecoveryOperation|undefined,busy=false;
 let unresolved=id!==null,needsRead=id!==null,epoch=0;let context:number|undefined;
 function current(){if(context!==undefined&&context!==epoch)throw new RecoveryError('OPERATION_CONTEXT_CHANGED','UNKNOWN');}
 if(id!==null&&!uuid(id))throw new RecoveryError('OPERATION_ID_INVALID');
 async function identity(){current();const identityValue=await gateway.identity();current();if(actor&&identityValue!==actor){row=undefined;needsRead=true;throw new RecoveryError('ACTOR_CHANGED','UNKNOWN');}actor=identityValue;return identityValue;}
 async function call(action:string,payload:Record<string,unknown>={}){
  await identity();current();const result=await gateway.call(id!,action,payload);current();await identity();current();
  if(!result.found){row=undefined;needsRead=true;throw new RecoveryError('OPERATION_NOT_FOUND','UNKNOWN');}
  row=result;return result;
 }
 async function exclusive<T>(task:()=>Promise<T>):Promise<T>{if(busy)throw new RecoveryError('SUBMISSION_IN_PROGRESS');busy=true;context=epoch;try{return await task();}finally{context=undefined;busy=false;}}
 function receipt(current:RecoveryOperation){if(!current.prepared)throw new RecoveryError('FROZEN_RECEIPT_INVALID','UNKNOWN');return validateDurableIntakeReceipt(current.prepared.command,current.receipt);}
 function requireWrite(){if(row?.access?.can_write===false)throw new RecoveryError('READ_ONLY');}
 function allocate(){if(!id){const next=randomUUID();if(!uuid(next))throw new RecoveryError('OPERATION_ID_INVALID');reference.write(next);if(reference.read()!==next)throw new RecoveryError('REFERENCE_NOT_SAVED');id=next;}}
 function documentReceipt(value:RecoveryOperation){const f=value.draft.file,r=value.document_receipt;if(f&&(!r||r.case_id!==id||r.document_id!==f.document_id||r.storage_path!==f.path||r.sha256!==f.sha256||!['extracted','not_requested','unconfirmed_legacy_prefix_utf16'].includes(r.extraction_status as string)))throw new RecoveryError('DOCUMENT_LINK_UNCONFIRMED','UNKNOWN');}
 async function save(form:ManualIntakeForm,file:RecoveryDraft['file']){const draft=validateRecoveryDraft({form,file},id!);if(!row)await call('reserve',{draft});else if(row.state==='reserved'&&canonicalJson(row.draft)!==canonicalJson(draft))await call('save',{expected_revision:row.revision,draft});else if(canonicalJson(row.draft)!==canonicalJson(draft))throw new RecoveryError('FROZEN_INTAKE_CONFLICT');}
 const guardedGateway:RecoveryGateway={identity,call:async(_id,action,payload)=>{current();if(_id!==id)throw new RecoveryError('OPERATION_CONTEXT_CHANGED','UNKNOWN');return call(action,payload);}};
 return {
  operationId:()=>id,
  isLocked:()=>busy||needsRead||row?.access?.can_write===false||Boolean(row&&(row.state!=='reserved'||Object.values(row.steps).some(s=>s?.state==='unknown'||s?.state==='running'))),
  current:()=>row?structuredClone(row):null,
  async document(form:ManualIntakeForm,file:File|null,prefill:(analysis:Record<string,unknown>,preview:string)=>ManualIntakeForm){return exclusive(async()=>{
   if(needsRead)throw new RecoveryError('EXPLICIT_RECOVERY_REQUIRED','UNKNOWN');
   try{
    await identity();current();requireWrite();allocate();unresolved=true;
    const descriptor=file?await describeIntakeFile(file,id!,row?.draft.file?.document_id??randomUUID()):row?.draft.file;current();
    if(!descriptor)throw new RecoveryError('FILE_REQUIRED');
    if(row?.draft.file&&canonicalJson(row.draft.file)!==canonicalJson(descriptor))throw new RecoveryError('FILE_CHANGED');
    await save(form,descriptor);current();
    if(row!.state!=='reserved')throw new RecoveryError('OPERATION_FROZEN');
    if(row!.steps.upload?.state!=='complete'){
     if(row!.steps.upload)await call('recover_step',{step:'upload'});
     else {if(!file||!storage)throw new RecoveryError('FILE_OR_UPLOAD_PORT_REQUIRED');await createRecoveryUploader(guardedGateway,{put(actor,path,bytes,options){current();return storage.put(actor,path,bytes,options,current);}},randomUUID)(id!,file,descriptor);current();}
    }
    if(row!.steps.upload?.state!=='complete')throw new RecoveryError('UPLOAD_UNCONFIRMED','UNKNOWN');
    for(const step of ['extraction','analysis'] as const){
     const existing=row!.steps[step];
     if(existing?.state!=='complete'){
      if(existing&&(existing.state!=='running'||existing.dispatch_authorized===true))throw new RecoveryError('DOCUMENT_STEP_UNCONFIRMED','UNKNOWN');
      await call('step',{step});
     }
     if(row!.steps[step]?.state!=='complete')throw new RecoveryError('DOCUMENT_STEP_UNCONFIRMED','UNKNOWN');
    }
    const extraction=(await call('document_result',{step:'extraction'})).document_result!;
    const analysis=(await call('document_result',{step:'analysis'})).document_result!;
    if(typeof extraction.text_preview!=='string'||!analysis.analysis||typeof analysis.analysis!=='object'||Array.isArray(analysis.analysis))throw new RecoveryError('DOCUMENT_RESULT_CHANGED','UNKNOWN');
    const next=prefill(analysis.analysis as Record<string,unknown>,extraction.text_preview);current();
    await save(next,descriptor);current();needsRead=false;return {form:structuredClone(next),operation:structuredClone(row!)};
   }catch(error){unresolved=id!==null;needsRead=id!==null;throw error;}
  });},
  hasUnresolved:()=>unresolved,
  // Call on auth-provider actor changes before showing a different session.
  clearSensitive(){epoch++;row=undefined;actor=undefined;needsRead=id!==null;unresolved=id!==null;},
  async restore(){return exclusive(async()=>{if(!id)throw new RecoveryError('OPERATION_REFERENCE_REQUIRED');const saved=await call('read');current();
   if(saved.state==='committed'){receipt(saved);if(saved.document_receipt)documentReceipt(saved);}
   unresolved=!['committed','abandoned'].includes(saved.state)||Boolean(saved.draft.file&&!saved.document_receipt);needsRead=false;
   return structuredClone(saved);
  });},
  async abandon(){return exclusive(async()=>{if(!id)throw new RecoveryError('OPERATION_REFERENCE_REQUIRED');requireWrite();unresolved=true;const saved=await call('abandon');current();if(saved.state!=='abandoned')throw new RecoveryError('ABANDON_UNCONFIRMED','UNKNOWN');needsRead=false;unresolved=false;row=undefined;});},
  startNew(){if(busy||unresolved)throw new RecoveryError('PREVIOUS_INTAKE_UNCONFIRMED','UNKNOWN');reference.write(null);id=null;row=undefined;actor=undefined;needsRead=false;},
  async submit(form:ManualIntakeForm){return exclusive(async()=>{
   if(needsRead)throw new RecoveryError('EXPLICIT_RECOVERY_REQUIRED','UNKNOWN');
   requireWrite();const draft=structuredClone({form,file:row?.draft.file??null});
   await identity();current();
   allocate();
   // Capture before any asynchronous request; subsequent edits cannot change intent.
   const previousUnresolved=unresolved;unresolved=true;
   try{
    if(!row)await call('reserve',{draft});
    if(row!.state==='abandoned')throw new RecoveryError('OPERATION_ABANDONED');
    if(row!.state==='reserved'&&canonicalJson(row!.draft)!==canonicalJson(draft))await call('save',{expected_revision:row!.revision,draft});
    if(row!.state!=='reserved'&&canonicalJson(row!.draft.form)!==canonicalJson(draft.form))throw new RecoveryError('FROZEN_INTAKE_CONFLICT');
    if(row!.state==='reserved')await call('prepare',{expected_revision:row!.revision});
    if(row!.state==='prepared')await call('commit');
    if(row!.state!=='committed')throw new RecoveryError('COMMIT_UNCONFIRMED','UNKNOWN');
    if(row!.draft.file&&!row!.document_receipt)await call('link');
    current();documentReceipt(row!);const result=receipt(row!);unresolved=false;return result;
   }catch(error){
    // Even a later confirmed refusal cannot erase an earlier uncertain write.
    // Once an ID was reserved, resolve by read or explicit fenced abandonment.
    unresolved=previousUnresolved||id!==null;needsRead=true;
    if(error instanceof RecoveryError&&['ACTOR_CHANGED','AUTH_REQUIRED','AUTH_UNAVAILABLE'].includes(error.code))row=undefined;
    throw error;
   }
  });},
 };
}
export type RecoverySession=ReturnType<typeof createRecoverySession>;
/** Router adapter: only changes one opaque parameter; preserves other routing state. */
export function intakeUrlReference(read:()=>URL,write:(url:URL)=>void):IntakeReference {
 return {read:()=>read().searchParams.get('intake_operation'),write(id){const url=new URL(read());if(id===null)url.searchParams.delete('intake_operation');else {if(!uuid(id))throw new RecoveryError('OPERATION_ID_INVALID');url.searchParams.set('intake_operation',id);}write(url);}};
}
