import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { customsResponse, validateCustomsDecision, type CustomsDecision, type CustomsBasisSnapshot, type CustomsSourceProposal, type CustomsSourceGroup } from '@/lib/customsBasis';
interface State {context_hash:string;head:{id:string;context_hash:string;decision:CustomsDecision}|null;basis?:CustomsBasisSnapshot|null;can_write:boolean;proposals:CustomsSourceProposal[];source_groups?:CustomsSourceGroup[];excluded_attachments?:number;scope?:{request_lines?:Array<{id:string;line_index:number;line_label:string|null}>};profiles?:Array<{code:string;label:string;status:string}>;regimes:Array<{code:string;name:string}>;assessment:{eligible:boolean;reason:string}|null}
const invoke=async(name:string,body:unknown)=>customsResponse(await supabase.functions.invoke(name,{body}));
const sourceDate=(v:string|null|undefined)=>v&&Number.isFinite(Date.parse(v))?new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short',timeZone:'UTC'}).format(new Date(v))+' UTC':'non précisée';
export function CustomsBasisReview({caseId,isLocked,onCalculated}:{caseId:string;isLocked:boolean;onCalculated:()=>void}) {
  const [state,setState]=useState<State|null>(null),[caf,setCaf]=useState(''),[hs,setHs]=useState(''),[regime,setRegime]=useState('');
  const [valuation,setValuation]=useState(''),[note,setNote]=useState(''),[estimated,setEstimated]=useState(true),[sources,setSources]=useState<string[]>([]);
  const [attested,setAttested]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [saved,setSaved]=useState<CustomsBasisSnapshot|null>(null);
  const mounted=useRef(true),working=useRef(false),dirty=useRef(false),attempt=useRef<Record<string,unknown>|null>(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const change=()=>{dirty.current=true;attempt.current=null;setAttested(false);setSaved(null);setNotice('');};
  const run=async(task:()=>Promise<void>)=>{if(working.current)return;working.current=true;setBusy(true);setError('');try{await task();}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Opération indisponible');}finally{working.current=false;if(mounted.current)setBusy(false);}};
  const read=()=>run(async()=>{
    const value=await invoke('manage-customs-basis',{action:'read',case_id:caseId}) as unknown as State;
    if(!Array.isArray(value.proposals)||!Array.isArray(value.regimes)||typeof value.context_hash!=='string')throw new Error('Réponse de lecture invalide');
    if(!mounted.current)return;
    if(!state||!dirty.current){const d=value.head?.decision;setCaf(d?String(d.caf_xof):'');setHs(d?.hs_digits??'');
      setRegime(d?.regime_code??'');setValuation(d?.valuation_basis??'');setNote(d?.note??'');setEstimated(d?.commitment!=='confirmed');setSources(d?d.source_attachment_ids.filter(id=>value.proposals.some(p=>p.attachment_id===id)):[]);}
    setState(value);setAttested(false);attempt.current=null;setSaved(dirty.current?null:value.basis??null);setNotice('Pièces relues. Les montants FOC restent déclaratifs ; aucune valeur douanière n’a été choisie automatiquement.');
  });
  const adopt=()=>run(async()=>{
    if(!state||!attested||isLocked||!state.can_write)throw new Error('Revue et attestation requises');
    if(!attempt.current){if(!/^\d+(?:[.,]\d{1,2})?$/.test(caf.trim()))throw new Error('Saisissez une CAF positive en FCFA, sans conversion implicite.');
      if(sources.some(id=>!state.proposals.some(p=>p.attachment_id===id&&p.can_select!==false)))throw new Error('Relisez les pièces : une source sélectionnée est absente ou ambiguë.');
      const decision=validateCustomsDecision({source_attachment_ids:sources,caf_xof:Number(caf.replace(',','.')),valuation_basis:valuation,hs_digits:hs,regime_code:regime,exemptions_reviewed:true,commitment:estimated?'estimated':'confirmed',note});
      attempt.current={action:'adopt',case_id:caseId,id:crypto.randomUUID(),parent_id:state.head?.id??null,context_hash:state.context_hash,decision};}
    const result=await invoke('manage-customs-basis',attempt.current),basis=result.basis as CustomsBasisSnapshot;
    if(!basis?.id||basis.case_id!==caseId)throw new Error('Réponse de sauvegarde invalide');
    const reread=await invoke('manage-customs-basis',{action:'read',case_id:caseId}) as unknown as State;
    if(!mounted.current)return;
    dirty.current=false;setState(reread);setSaved(basis);setNotice(reread.head?.id===basis.id&&reread.context_hash===basis.context_hash?'Bases enregistrées et relues. '+basis.assessment.reason:'Décision enregistrée ; une nouvelle source ou décision exige une nouvelle revue.');
  });
  const calculate=()=>run(async()=>{if(!saved?.assessment.eligible||state?.head?.id!==saved.id||state.context_hash!==saved.context_hash||isLocked)throw new Error('Bases de calcul à revoir');
    const result=await invoke('run-pricing',{case_id:caseId,allow_provisional:true,customs_basis_id:saved.id});
    if(typeof result.pricing_run_id!=='string'||!result.pricing_run_id)throw new Error('Réponse de calcul non enregistrée ou incomplète');
    if(mounted.current){setNotice('Calcul enregistré. Créez une nouvelle version pour figer ces bases et son PDF.');onCalculated();}});
  const writable=!!state?.can_write&&!isLocked&&!busy;
  return <details className="mt-3 rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Bases douanières et valeur FOC</summary>
    <div className="mt-3 space-y-4" aria-busy={busy}>
      <p className="text-sm text-muted-foreground">Relisez les pièces, puis retenez les bases en une seule décision. Un poste non justifié reste à confirmer.</p>
      <Button variant="outline" disabled={busy} onClick={read}>{state?'Relire les pièces et les décisions':'Lire les propositions depuis les pièces'}</Button>
      {state&&<><div className="space-y-2" aria-label="Pièces douanières proposées">
        <p className="text-sm text-muted-foreground">Pièces pertinentes identifiées automatiquement ci-dessous. Leur préparation ne valide ni valeur douanière ni classement fiscal. La date, le courriel et les références sont des indices à vérifier ; une pièce ancienne n'est pas automatiquement remplacée.</p>
        {state.source_groups?.map((group,i)=><div key={i} className="space-y-2 rounded border p-3 text-sm">
          <p>Pièces proposées{group.reference?` pour la référence ${group.reference}`:' sans référence d’envoi établie'} : {group.attachment_ids.map(id=>state.proposals.find(p=>p.attachment_id===id)?.filename).join(', ')}.</p>
          {!group.recommended&&<p>Écarts à arbitrer dans le HS retenu, la CAF et leurs justifications. Poids et dimensions restent à valider dans les données du lot.</p>}
          <Button type="button" variant="outline" disabled={!writable} onClick={()=>{change();setSources(group.attachment_ids);if(group.hs_declared)setHs(group.hs_declared);}}>{group.recommended?'Préparer avec ces pièces proposées':'Examiner ces pièces ensemble'}</Button>
          <p className="text-xs text-muted-foreground">Cette action prépare les sources{group.hs_declared?' et le HS documentaire':''}. La CAF, sa justification et l'attestation restent à compléter avant toute adoption.</p>
        </div>)}
        {!!state.excluded_attachments&&<p className="text-sm text-muted-foreground">{state.excluded_attachments} pièce(s) sans preuve documentaire exploitable écartée(s), notamment logos et fichiers temporaires.</p>}
        {state.scope?.request_lines?.map(l=><p key={l.id} className="text-sm">Lot {l.line_index} : {l.line_label??'désignation non précisée'}. Le rattachement des pièces à ce lot reste à vérifier.</p>)}
        {!state.proposals.length&&<p className="text-sm">Aucune proposition documentaire exploitable. Les bases restent à confirmer.</p>}
        {state.proposals.map(p=><div key={p.attachment_id} className="space-y-2 rounded border p-3 text-sm [overflow-wrap:anywhere]">
          <label className="flex items-center gap-2"><Checkbox disabled={!writable||p.can_select===false} checked={sources.includes(p.attachment_id)} onCheckedChange={v=>{change();setSources(a=>v===true?[...a,p.attachment_id]:a.filter(id=>id!==p.attachment_id));}}/>{p.filename}</label>
          {!!p.reasons?.length&&<ul aria-label={`Motifs de proposition pour ${p.filename}`} className="space-y-1 text-muted-foreground">{p.reasons.map((reason,i)=><li key={i}>{reason}</li>)}</ul>}
          <p className="text-xs text-muted-foreground">Courriel : {p.email_subject??'objet non précisé'} · envoyé le {sourceDate(p.email_sent_at)} · reçu le {sourceDate(p.email_received_at)}</p>
          <p className="text-xs text-muted-foreground">Source courriel : {p.email_id??'non précisée'} · pièce : {p.attachment_id}</p>
          {p.email_excerpt&&<blockquote className="border-l-2 pl-3 whitespace-pre-wrap">{p.email_excerpt}</blockquote>}
          {(p.documents??[{...p,document_index:null,document_type:null,document_date:null,reference:null,page_range:null}]).map((d,i)=><div key={i} className="space-y-1 border-t pt-2">
            <p>Document {d.document_index===null?'':d.document_index+1} : {d.document_type??'type non précisé'}{d.page_range?` · pages ${d.page_range}`:''} · date documentaire : {d.document_date??'non précisée'} · référence : {d.reference??'non précisée'}</p>
            <p>{d.nonCommercial?'Facture non commerciale / FOC : valeur déclarée à examiner.':'Pièce documentaire.'} HS déclaré : {d.hsDeclared??'non précisé'}.</p>
            <ul>{d.money.map((m,j)=><li key={j}>{({FOB:'FOB',freight:'Fret',insurance:'Assurance',total:'Total déclaré'} as Record<string,string>)[m.kind]??m.kind} : {m.amount.toLocaleString('fr-FR')} {m.currency??'devise non précisée'}</li>)}</ul>
            {d.hsDeclared&&/^(?:\d{6}|\d{8}|\d{10})$/.test(d.hsDeclared.replace(/[.\s]/g,''))&&<Button type="button" variant="outline" size="sm" disabled={!writable||p.can_select===false||!sources.includes(p.attachment_id)} onClick={()=>{change();setHs(d.hsDeclared!.replace(/[.\s]/g,''));}}>Reprendre ce HS déclaré</Button>}
          </div>)}
          {!!p.issues?.length&&<ul aria-label={`Points à vérifier pour ${p.filename}`} className="space-y-1 text-sm">{p.issues.map((issue,i)=><li key={i}>{issue}</li>)}</ul>}
          {p.can_select===false&&<p>Pièce à examiner séparément avant toute retenue : son contexte ne permet pas une sélection fiable.</p>}
        </div>)}</div>
      <div className="text-sm"><p className="font-medium">Profils fiscaux disponibles</p><ul>{state.profiles?.map(p=><li key={p.code}>{p.code} — {p.label} : {p.status==='verified'?'preuve fiscale vérifiée à contrôler pour le régime retenu':p.status==='legacy'?'profil historique à revérifier':'fiscalité à confirmer'}</li>)}</ul><p className="text-muted-foreground">La seule égalité des taux ne justifie pas un profil commun. Sans preuve applicable, les droits et taxes restent réservés.</p></div>
      <form noValidate className="space-y-3" onSubmit={e=>{e.preventDefault();void adopt();}}>
        <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor={`caf-${caseId}`}>CAF retenue, fret et assurance compris (FCFA)</Label><Input id={`caf-${caseId}`} inputMode="decimal" value={caf} disabled={!writable} onChange={e=>{change();setCaf(e.target.value);}}/></div>
        <div><Label htmlFor={`hs-${caseId}`}>Code HS retenu pour cette base</Label><Input id={`hs-${caseId}`} value={hs} disabled={!writable} onChange={e=>{change();setHs(e.target.value.replace(/[.\s]/g,''));}}/><p className="text-xs text-muted-foreground">Six ou huit chiffres : classement national encore à confirmer, estimation uniquement.</p></div></div>
        <div><Label htmlFor={`regime-${caseId}`}>Régime douanier retenu</Label><Select value={regime} disabled={!writable} onValueChange={v=>{change();setRegime(v);}}><SelectTrigger id={`regime-${caseId}`}><SelectValue placeholder="Choisir le régime justifié"/></SelectTrigger><SelectContent>{state.regimes.map(r=><SelectItem key={r.code} value={r.code}>{r.code} — {r.name}</SelectItem>)}</SelectContent></Select></div>
        <div><Label htmlFor={`valuation-${caseId}`}>Justification interne de la valeur FOC et de la conversion en FCFA</Label><Textarea className="resize-none min-h-24" id={`valuation-${caseId}`} value={valuation} disabled={!writable} onChange={e=>{change();setValuation(e.target.value);}}/></div>
        <div><Label htmlFor={`note-${caseId}`}>Note interne de la décision</Label><Textarea className="resize-none min-h-24" id={`note-${caseId}`} value={note} disabled={!writable} onChange={e=>{change();setNote(e.target.value);}}/><p className="text-xs text-muted-foreground">En cas d'écarts entre pièces du même envoi, expliquez ici les éléments retenus et écartés. La justification et cette note sont historisées et restent internes. Le PDF reprend la CAF, le régime, le classement et les réserves.</p></div>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={estimated} disabled={!writable} onCheckedChange={v=>{change();setEstimated(v===true);}}/>Bases estimatives et révisables</label>
        <label className="flex items-start gap-2 text-sm"><Checkbox checked={attested} disabled={!writable} onCheckedChange={v=>setAttested(v===true)}/>J’ai revu la valeur, sa conversion et les sources, le classement, le régime et les exonérations. Aucun titre d’exonération n’est retenu.</label>
        {!state.can_write&&<p className="text-sm">Lecture seule : la retenue de ces bases nécessite les droits d’écriture de ce dossier.</p>}
        {isLocked&&<p className="text-sm">Dossier verrouillé : les bases ne peuvent plus être modifiées.</p>}
        <Button type="submit" disabled={!writable||!attested}>Retenir les bases douanières</Button>
      </form>
      {(saved||state.assessment)&&<p className="text-sm">{saved?.assessment.reason??state.assessment?.reason}</p>}
      <Button disabled={!writable||!saved?.assessment.eligible||state.head?.id!==saved.id||state.context_hash!==saved.context_hash} onClick={calculate}>Calculer avec ces bases</Button>
      </>}
      {notice&&<p role="status" className="text-sm">{notice}</p>}{error&&<p role="alert" className="text-sm text-destructive">{error} Votre saisie est conservée ; relisez les pièces en cas de conflit.</p>}
    </div>
  </details>;
}
