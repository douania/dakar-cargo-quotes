import { isObsoletePadDraft } from '@/lib/padGapReview';

type HistoryEvent = { id: string; case_id?: string; event_type: string; event_data: unknown; created_at: string };
/** Existing case-permitted messages only; no requests, storage, copy or send action. */
export function ClientGapDraftHistory({caseId,events,currentKeys}:{caseId:string;events:HistoryEvent[];currentKeys:string[]}) {
  const seen=new Set<string>();
  const drafts=events.flatMap(event=>{
    if(event.case_id!==caseId || event.event_type!=='output_generated' || seen.has(event.id))return [];
    const data=event.event_data as Record<string,unknown>|null;
    const draft=data?.draft_reply as {subject?:unknown;body?:unknown}|undefined;
    if(data?.kind!=='reply_draft_v1' || !isObsoletePadDraft(data,currentKeys) || typeof draft?.subject!=='string' || typeof draft.body!=='string')return [];
    seen.add(event.id);return [{id:event.id,subject:draft.subject,body:draft.body,date:event.created_at}];
  });
  if(!drafts.length)return null;
  return <details id="section-client-gap-history" className="mb-4 min-w-0 rounded-lg border p-3">
    <summary tabIndex={0} className="cursor-pointer text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Brouillons antérieurs chargés ({drafts.length})</summary>
    <p className="my-3 text-sm text-muted-foreground">Ces messages sont conservés en lecture seule. Ils ne sont pas proposés pour un nouvel envoi. Utilisez « Générer brouillon client » pour préparer une demande actualisée.</p>
    <ul className="space-y-3">{drafts.map(draft=>{
      const date=new Date(draft.date);const valid=!Number.isNaN(date.getTime());
      return <li key={draft.id} className="min-w-0 space-y-2 rounded-lg bg-muted p-4">
        <p className="break-words text-sm font-semibold">{draft.subject}</p>
        <p className="text-xs text-muted-foreground">{valid?<time dateTime={date.toISOString()}>{date.toLocaleString('fr-FR',{timeZone:'UTC',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})} UTC</time>:'Date non disponible'}</p>
        <pre className="whitespace-pre-wrap break-words font-sans text-sm text-muted-foreground">{draft.body}</pre>
      </li>;
    })}</ul>
  </details>;
}
