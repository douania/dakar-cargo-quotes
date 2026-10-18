import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { AuthResult } from './auth.ts';
import { prepareCommercialQuote, reviseCommercialPreparation, type CommercialAction, type CommercialPreparation } from './commercial-preparation.ts';
import { composeCommercialSnapshot } from './commercial-snapshot.ts';
import { respondOk } from './runtime.ts';

export const commercialUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export function commercialClients(auth: AuthResult) {
  const url=Deno.env.get('SUPABASE_URL')!;
  return {user:createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{auth:{persistSession:false},global:{headers:{Authorization:`Bearer ${auth.token}`}}}),
    service:createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}})};
}
export function commercialError(error: {code?: string;message?: string} | null): never {
  const message=error?.message ?? 'Commercial operation unavailable';
  throw Object.assign(new Error(message),{status:error?.code==='42501'?403:['40001','PT409'].includes(error?.code??'')?409:400});
}
export async function readCommercial(auth: AuthResult,caseId: string) {
  const {user}=commercialClients(auth);
  const result=await user.rpc('commercial_read',{p_case_id:caseId});
  if(result.error) commercialError(result.error);
  const state=result.data;
  if(!state?.available) return state;
  const draft: CommercialPreparation=state.draft ?? prepareCommercialQuote(caseId,state.source_version_id,state.snapshot);
  let air=null;
  if(draft.lines.some(line=>line.supplier)) {
    const r=await user.rpc('air_tariff_read',{p_case_id:caseId});
    if(r.error) commercialError(r.error);
    air=r.data;
  }
  return {...state,draft,air};
}
interface CommercialSaveRequest {
 case_id:string;source_version_id:string;operation_id:string;parent_id:string|null;source_hash:string;context_hash:string;
 operations:Array<{operation_id:string;action:CommercialAction}>;
}
export async function saveCommercial(auth: AuthResult,body: CommercialSaveRequest) {
  const {service}=commercialClients(auth);
  if(!commercialUuid(body.case_id)||!commercialUuid(body.source_version_id)||!commercialUuid(body.operation_id)
    || (body.parent_id!==null&&!commercialUuid(body.parent_id)) || !Array.isArray(body.operations) || !body.operations.length || body.operations.length>100
    || body.operations.some(e=>!commercialUuid(e.operation_id)||!e.action||typeof e.action.reason!=='string')) throw new Error('Commercial request invalid');
  const guard=await service.rpc('commercial_actor_guard',{p_actor:auth.user.id,p_case:body.case_id});
  if(guard.error) commercialError(guard.error);
  const existing=await service.from('quote_commercial_revisions').select('*').eq('id',body.operation_id).maybeSingle();
  if(existing.error) commercialError(existing.error);
  let draft: CommercialPreparation;
  if(existing.data) draft=existing.data.draft;
  else {
    const state=await readCommercial(auth,body.case_id);
    if(!state?.available||state.source_version_id!==body.source_version_id||state.head_id!==body.parent_id||state.source_hash!==body.source_hash||state.context_hash!==body.context_hash) commercialError({code:'40001',message:'Source ou révision modifiée ; actualisez après avoir conservé votre saisie.'});
    draft=state.draft;
    if(draft.events.length+body.operations.length>1000) throw new Error('Historique maximal atteint ; nouvelle base requise');
    const seen=new Set<string>();
    for(const operation of body.operations) {
      if(seen.has(operation.operation_id)||draft.events.some(e=>e.operation_id===operation.operation_id)) throw new Error('Identifiant de décision déjà utilisé');
      seen.add(operation.operation_id);
      draft=reviseCommercialPreparation(draft,operation.action as CommercialAction,{expected_revision:draft.revision,operation_id:operation.operation_id,
        actor_id:auth.user.id,occurred_at:new Date().toISOString(),air:state.air,air_case_id:body.case_id});
    }
    // Validate a usable immutable client snapshot before accepting the revision.
    composeCommercialSnapshot(draft,body.operation_id);
  }
  const saved=await service.rpc('commercial_store',{p_id:body.operation_id,p_case:body.case_id,p_source:body.source_version_id,p_parent:body.parent_id,
    p_actor:auth.user.id,p_source_hash:body.source_hash,p_context_hash:body.context_hash,p_request:body.operations,p_draft:draft});
  if(saved.error) commercialError(saved.error);
  return saved.data;
}
export async function generateCommercialVersion(auth: AuthResult,caseId: unknown,revisionId: unknown,correlationId: string): Promise<Response> {
  if(!commercialUuid(caseId)||!commercialUuid(revisionId)) throw new Error('Révision commerciale requise');
  const {service}=commercialClients(auth);
  const guard=await service.rpc('commercial_actor_guard',{p_actor:auth.user.id,p_case:caseId});
  if(guard.error) commercialError(guard.error);
  const read=await service.from('quote_commercial_revisions').select('id,case_id,draft').eq('id',revisionId).eq('case_id',caseId).single();
  if(read.error||!read.data) commercialError(read.error);
  const snapshot=composeCommercialSnapshot(read.data.draft,revisionId);
  const result=await service.rpc('commercial_create_version',{p_revision:revisionId,p_actor:auth.user.id,p_snapshot:snapshot});
  if(result.error) commercialError(result.error);
  const value=result.data;
  return respondOk({...value,case_id:caseId,commercial_revision_id:revisionId,total_ht:value.snapshot.totals.total_ht,total_ttc:value.snapshot.totals.total_ttc,currency:'XOF'},correlationId);
}
