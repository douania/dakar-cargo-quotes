/** Optional inactive intake-ticket bridge. No new parser/model or retry policy. */
import {createClient} from 'jsr:@supabase/supabase-js@2';
import {decodeRecoveryOperation,verifyIntakeFile,sha256Bytes,uuid,RecoveryError} from '../manual-intake/prepare.generated.js';
type Auth={token:string;user:{id:string}};
export interface IntakeTicketContext {auth:Auth;id:string;claim:string;step:'extraction'|'analysis';operation:Record<string,unknown>;started:boolean;file:File;source?:{text:string;payload:Record<string,unknown>;claim_id:string;text_sha256:string}}
const client=(token:string)=>createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{auth:{persistSession:false},global:{headers:{Authorization:`Bearer ${token}`}}});
const service=()=>createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
export const ticketResponse=(row:unknown)=>Response.json({ok:true,data:row});
export const ticketUnknown=()=>Response.json({ok:false,error:{code:'PROVIDER_RESULT_UNCONFIRMED',outcome:'UNKNOWN'}},{status:503});
export const ticketFailure=(error:unknown)=>error instanceof RecoveryError?Response.json({ok:false,error:{code:error.code,outcome:error.outcome}},{status:error.outcome==='UNKNOWN'?503:409}):ticketUnknown();
export async function openIntakeTicket(auth:Auth,raw:unknown,step:'extraction'|'analysis'):Promise<IntakeTicketContext>{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new RecoveryError('DOCUMENT_TICKET_INVALID');const t=raw as Record<string,unknown>;
 if(!uuid(t.operation_id)||!uuid(t.claim_id)||Object.keys(t).some(k=>!['operation_id','claim_id'].includes(k)))throw new RecoveryError('DOCUMENT_TICKET_INVALID');
 const user=client(auth.token),read=await user.rpc('manual_intake_operation',{p_id:t.operation_id,p_action:'read',p_payload:{}});if(read.error)throw new RecoveryError('DOCUMENT_READ_UNCONFIRMED','UNKNOWN');
 const row=decodeRecoveryOperation(read.data,t.operation_id,auth.user.id);if(!row.found||!row.draft.file||!row.steps[step]||row.steps[step].claim_id!==t.claim_id)throw new RecoveryError('DOCUMENT_TICKET_INVALID');
 const descriptor=row.draft.file;let stored:Blob|null=null;
 await verifyIntakeFile({read:async(path:string)=>{const r=await user.storage.from('case-documents').download(path);stored=r.data;return r;}},descriptor);
 if(!stored)throw new RecoveryError('FILE_READ_UNCONFIRMED','UNKNOWN');
 const context:IntakeTicketContext={auth,id:t.operation_id as string,claim:t.claim_id as string,step,operation:row as unknown as Record<string,unknown>,started:false,file:new File([stored],descriptor.name,{type:descriptor.mime})};
 if(step==='analysis'){
  const r=await service().rpc('manual_intake_document_source',{p_id:context.id,p_actor:auth.user.id,p_step:'extraction'});if(r.error)throw new RecoveryError('EXTRACTION_UNCONFIRMED','UNKNOWN');const src=r.data;
  if(!src||src.operation_id!==context.id||src.file_sha256!==descriptor.sha256||src.claim_id!==row.steps.extraction?.claim_id||src.archive_id!==row.steps.extraction?.output?.archive_id||typeof src.text!=='string'||src.text_sha256!==row.steps.extraction?.output?.text_sha256||await sha256Bytes(new TextEncoder().encode(src.text).buffer)!==src.text_sha256||!src.payload||!Array.isArray(src.payload.tags))throw new RecoveryError('DOCUMENT_SOURCE_CHANGED','UNKNOWN');
  context.source=src;
 }
 const begin=await service().rpc('manual_intake_document_begin',{p_id:context.id,p_actor:auth.user.id,p_step:step,p_claim:context.claim});
 // A lost begin ACK never authorizes a provider call by later observation.
 if(begin.error||!begin.data||typeof begin.data.started!=='boolean')throw new RecoveryError('DISPATCH_UNCONFIRMED','UNKNOWN');
 const confirmed=decodeRecoveryOperation(begin.data.operation,context.id,auth.user.id);if(!confirmed.found||confirmed.steps[step]?.claim_id!==context.claim)throw new RecoveryError('DISPATCH_UNCONFIRMED','UNKNOWN');
 context.operation=confirmed as unknown as Record<string,unknown>;context.started=begin.data.started;return context;
}
export async function completeIntakeTicket(context:IntakeTicketContext,text:string|null,caseText:string|null,payload:Record<string,unknown>):Promise<Response>{
 // A JS case-prefix may end in half of an astral pair. Preserve the full
 // standalone archive; retain exact prefix evidence privately and mark the
 // legacy case projection unavailable instead of poisoning the whole archive.
 if(context.step==='extraction'&&caseText!==null&&/[\uD800-\uDBFF]$/.test(caseText)){
  payload={...payload,case_text_status:'legacy_prefix_invalid_utf16',case_text_prefix:caseText.slice(0,-1)};caseText=null;
 }
 const r=await service().rpc('manual_intake_document_complete',{p_id:context.id,p_actor:context.auth.user.id,p_step:context.step,p_claim:context.claim,p_text:text,p_case_text:caseText,p_payload:payload});
 if(r.error)return ticketUnknown();const row=decodeRecoveryOperation(r.data,context.id,context.auth.user.id);if(!row.found||row.steps[context.step]?.state!=='complete')return ticketUnknown();return ticketResponse(row);
}
