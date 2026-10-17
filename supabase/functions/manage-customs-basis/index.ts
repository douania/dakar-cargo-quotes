import { requireUser } from '../_shared/auth.ts';
import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { commercialClients, commercialError } from '../_shared/commercial-service.ts';
import { assessCustomsDecision, customsBasisSnapshot, customsProposals, customsRow, type CustomsContext } from '../_shared/customs-basis.ts';
import { parseCustomsCommand } from './domain.ts';
import { assertDocumentarySources, customsSourceGroups } from '../_shared/customs-source-proposals.ts';

export async function handleCustomsBasis(req: Request): Promise<Response> {
  const cors=handleCors(req);if(cors)return cors;
  const auth=await requireUser(req);if(auth instanceof Response)return auth;
  const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});
  try {
    if(req.method!=='POST')return reply({error:{message:'Méthode refusée'}},405);
    const raw=await req.text();if(raw.length>16000)throw new Error('Demande trop volumineuse');
    const command=parseCustomsCommand(JSON.parse(raw));
    const {user,service}=commercialClients(auth);
    const read=await user.rpc('customs_basis_read',{p_case:command.case_id});
    if(read.error)commercialError(read.error);
    const state=customsRow(read.data),context=state.context as CustomsContext,head=customsRow(state.head);
    const current=head.id&&head.context_hash===state.context_hash;
    const proposals=customsProposals(context);
    if(command.action==='read')return reply({context_hash:state.context_hash,head:state.head,can_write:state.can_write,
      scope:context.scope,proposals,source_groups:customsSourceGroups(proposals),excluded_attachments:context.attachments.length-proposals.length,profiles:context.profiles.map(p=>({code:p.code_normalized,label:p.description,status:p.tax_profile_status})),
      regimes:context.regimes.map(r=>({code:r.code,name:r.name})),basis:current?customsBasisSnapshot(head,context):null,
      assessment:head.id?(current?assessCustomsDecision(head.decision as Parameters<typeof assessCustomsDecision>[0],context):{eligible:false,reason:'Les sources ont changé ; relisez et retenez une nouvelle décision'}):null});
    if(state.can_write!==true)throw Object.assign(new Error('Écriture de ce dossier refusée'),{status:403});
    // Existing operations replay against their immutable stored context, even after source edits.
    const previous=await user.from('quote_customs_basis').select('id').eq('id',command.id).eq('case_id',command.case_id).maybeSingle();
    if(previous.error)commercialError(previous.error);
    if(!previous.data)assertDocumentarySources(command.decision!.source_attachment_ids,context);
    // A replay is resolved by SQL first, even when source context has since changed.
    const saved=await service.rpc('customs_basis_store',{p_actor:auth.user.id,p_case:command.case_id,p_id:command.id,
      p_parent:command.parent_id,p_context_hash:command.context_hash,p_decision:command.decision});
    if(saved.error)commercialError(saved.error);
    // Re-read the immutable stored context for exact replay; never recalculate proof on new pieces.
    const stored=await service.from('quote_customs_basis').select('*').eq('id',command.id).eq('case_id',command.case_id).single();
    if(stored.error)commercialError(stored.error);
    return reply({basis:customsBasisSnapshot(stored.data,stored.data.context)});
  }catch(error){const e=error as Error&{status?:number};return reply({error:{message:e.message}},e.status??400);}
}
if(import.meta.main)Deno.serve(handleCustomsBasis);
