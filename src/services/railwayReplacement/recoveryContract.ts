/** Recovery wire contract; no IO, browser persistence or actor supplied to SQL. */
import { boundedJson, type ManualIntakeForm } from './manualIntakeCommand';
import type { prepareDurableIntake } from './durableIntake';
import { object, decodeIntakeRequest, decodeIntakeResponse } from './contracts';
export class RecoveryError extends Error {
  constructor(readonly code: string, readonly outcome: 'BLOCKED'|'UNKNOWN' = 'BLOCKED') { super(`Reprise intake : ${code} (${outcome})`); }
}
export const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '['+value.map(canonicalJson).join(',')+']';
  if (value !== null && typeof value === 'object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJson((value as Record<string,unknown>)[k])).join(',')+'}';
  return JSON.stringify(value);
}
export interface IntakeFileDescriptor { document_id: string; name: string; mime: string; size: number; sha256: string; path: string }
export interface RecoveryDraft { form: ManualIntakeForm; file: IntakeFileDescriptor | null }
export type RecoveryState = 'reserved'|'prepared'|'committed'|'abandoned';
export interface RecoveryStep { dispatch_authorized?:boolean; claim_id: string; state: 'running'|'complete'|'failed'|'unknown'; input: Record<string,unknown>; output: Record<string,unknown>|null; error_code: string|null }
export interface FrozenIntake { expected_revision: number; body: {version:1;case_id:string}&ManualIntakeForm; command: ReturnType<typeof prepareDurableIntake>; classifier_version: 'railway-c34c6dc-native-v1' }
export interface RecoveryOperation { found: true; operation_id: string; actor_user_id: string; access?:{viewer_user_id:string;case_id:string|null;can_write:boolean}|null; state: RecoveryState; revision: number; draft: RecoveryDraft; prepared: FrozenIntake|null; prepared_hash: string|null; receipt: unknown; document_receipt: Record<string,unknown>|null; steps: Partial<Record<'upload'|'extraction'|'analysis',RecoveryStep>>; document_result?:Record<string,unknown>; claimed?:boolean }
const extensions = ['pdf','xlsx','xls','jpg','jpeg','png','csv'];
export function validateFileDescriptor(raw: unknown, operationId: string): IntakeFileDescriptor {
  const f=object(raw,'RECOVERY_FILE_REQUIRED');
  if (!uuid(f.document_id) || typeof f.name !== 'string' || !f.name || f.name.length>255 || !extensions.includes(f.name.split('.').pop()!.toLowerCase()) || typeof f.mime!=='string' || f.mime.length>128 || !Number.isInteger(f.size) || (f.size as number)<1 || (f.size as number)>10*1024*1024 || typeof f.sha256!=='string' || !/^[a-f0-9]{64}$/.test(f.sha256)) throw new RecoveryError('FILE_DESCRIPTOR_INVALID');
  if (f.path!==`${operationId}/${f.document_id}-${f.name.replace(/[^\w.-]/g,'_')}` || Object.keys(f).some(k=>!['document_id','name','mime','size','sha256','path'].includes(k))) throw new RecoveryError('FILE_DESCRIPTOR_INVALID');
  return f as unknown as IntakeFileDescriptor;
}
export function validateRecoveryDraft(raw: unknown, id: string): RecoveryDraft {
  const draft=object(raw,'RECOVERY_DRAFT_REQUIRED'),form=object(draft.form,'RECOVERY_FORM_REQUIRED');
  if (Object.keys(draft).some(k=>!['form','file'].includes(k)) || Object.keys(form).some(k=>!['request','analysis','has_extracted_document'].includes(k)) || typeof form.has_extracted_document!=='boolean') throw new RecoveryError('DRAFT_INVALID');
  const request=decodeIntakeRequest(form.request);boundedJson(form);
  if(Object.keys(request).some(k=>!['source','client_name','client_email','customer_ref'].includes(k)) || Object.keys(object(request.source,'SOURCE_REQUIRED')).some(k=>!['type','text'].includes(k)))throw new RecoveryError('DRAFT_INVALID');
  if(form.analysis!==null)object(form.analysis,'ANALYSIS_REQUIRED');
  if(form.analysis!==null&&!form.has_extracted_document)throw new RecoveryError('DRAFT_PROVENANCE_INVALID');
  return {form:structuredClone(form) as unknown as ManualIntakeForm,file:draft.file===null?null:validateFileDescriptor(draft.file,id)};
}
export function decodeRecoveryOperation(raw:unknown,id:string,actor:string):RecoveryOperation|{found:false;operation_id:string} {
 const row=object(raw,'RECOVERY_RECEIPT_REQUIRED');
 if(row.operation_id!==id||typeof row.found!=='boolean')throw new RecoveryError('RECOVERY_RECEIPT_INVALID','UNKNOWN');
 if(row.found===false)return {found:false,operation_id:id};
 if(!uuid(row.actor_user_id))throw new RecoveryError('RECOVERY_RECEIPT_INVALID','UNKNOWN');
 if(row.access!==undefined&&row.access!==null){
  const access=object(row.access,'RECOVERY_ACCESS_REQUIRED');
  if(access.viewer_user_id!==actor||typeof access.can_write!=='boolean'||(access.case_id!==null&&access.case_id!==id)||Object.keys(access).some(k=>!['viewer_user_id','case_id','can_write'].includes(k)))
   throw new RecoveryError('ACTOR_CHANGED','UNKNOWN');
  if((row.state==='committed')!==(access.case_id===id)||row.actor_user_id!==actor&&access.case_id!==id)
   throw new RecoveryError('RECOVERY_ACCESS_INVALID','UNKNOWN');
 }else if(row.actor_user_id!==actor)throw new RecoveryError('ACTOR_CHANGED','UNKNOWN');
 if(!['reserved','prepared','committed','abandoned'].includes(row.state as string)||!Number.isInteger(row.revision)||(row.revision as number)<1)throw new RecoveryError('RECOVERY_RECEIPT_INVALID','UNKNOWN');
 if(row.state!=='abandoned')validateRecoveryDraft(row.draft,id);const steps=object(row.steps,'RECOVERY_STEPS_REQUIRED');
 for(const [name,value] of Object.entries(steps)){const step=object(value,'RECOVERY_STEP_REQUIRED');if(!['upload','extraction','analysis'].includes(name)||!uuid(step.claim_id)||!['running','complete','failed','unknown'].includes(step.state as string))throw new RecoveryError('RECOVERY_STEP_INVALID','UNKNOWN');object(step.input,'RECOVERY_STEP_INPUT_REQUIRED');if(step.output!==null)object(step.output,'RECOVERY_STEP_OUTPUT_REQUIRED');}
 if(row.prepared!==null){const p=object(row.prepared,'FROZEN_REQUIRED'),body=object(p.body,'FROZEN_BODY_REQUIRED'),c=object(p.command,'FROZEN_COMMAND_REQUIRED');
  if(body.case_id!==id||body.version!==1||c.p_case_id!==id||c.p_operation_key!==`intake:${id}:v1`||canonicalJson(c.p_source_request)!==canonicalJson(body.request)||typeof row.prepared_hash!=='string'||!/^[a-f0-9]{64}$/.test(row.prepared_hash)||p.classifier_version!=='railway-c34c6dc-native-v1')throw new RecoveryError('FROZEN_RECEIPT_INVALID','UNKNOWN');
  decodeIntakeResponse({...object(c.p_classification,'CLASSIFICATION_REQUIRED'),success:true,case_id:id,status:'INTAKE'});
 }
 if(['prepared','committed'].includes(row.state as string)&&row.prepared===null)throw new RecoveryError('FROZEN_RECEIPT_INVALID','UNKNOWN');
 if(row.state==='committed'&&row.receipt===null)throw new RecoveryError('RECOVERY_RECEIPT_INVALID','UNKNOWN');
 if(row.document_result!==undefined){const r=object(row.document_result,'DOCUMENT_RESULT_REQUIRED'),entry=object(steps[r.step as string],'DOCUMENT_STEP_REQUIRED'),output=object(entry.output,'DOCUMENT_OUTPUT_REQUIRED');if(entry.state!=='complete'||r.operation_id!==id||r.claim_id!==entry.claim_id||r.archive_id!==output.archive_id||r.file_sha256!==output.file_sha256||r.text_sha256!==output.text_sha256||r.payload_sha256!==output.payload_sha256)throw new RecoveryError('DOCUMENT_RESULT_CHANGED','UNKNOWN');}

 return row as unknown as RecoveryOperation;
}
