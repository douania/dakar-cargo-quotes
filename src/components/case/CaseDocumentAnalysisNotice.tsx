import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { readCaseDocumentInventory } from '@/lib/documentExtraction';
import { readableSourceAvailable, type DocumentAnalysisInventory } from '../../../supabase/functions/_shared/case-document-analysis';

export function DocumentAnalysisChoice({inventory,busy,onAnalyze}:{inventory:DocumentAnalysisInventory;busy:boolean;onAnalyze:()=>void}) {
  const excluded = inventory.documents.filter(d=>!d.readable);
  const available = readableSourceAvailable(inventory);
  return <div className="mt-3 space-y-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
    <p>Ces documents manuels restent conservés sans texte exploitable. Leur contenu ne sera pas pris en compte.</p>
    <details>
      <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Voir les {excluded.length} documents exclus</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">{excluded.map(d=><li key={d.id} className="break-words">{d.name} — texte non disponible</li>)}</ul>
    </details>
    <p>{inventory.documents.filter(d=>d.readable).length} document(s) manuel(s) lisible(s), {inventory.readable_email_count} courriel(s) lisible(s).
      {' '}L’analyse restera incomplète jusqu’à la lecture et la réanalyse de toutes les pièces manuelles.</p>
    {!available && <p role="status">Aucune source lisible disponible. Reprenez l’extraction ou ajoutez une version lisible du document.</p>}
    <Button type="button" variant="outline" className="min-h-10 h-auto cursor-pointer whitespace-normal text-left"
      disabled={busy || !available || inventory.latest?.state === 'pending'} aria-busy={busy} onClick={onAnalyze}>
      {busy ? 'Analyse en cours…' : 'Analyser les sources lisibles'}
    </Button>
  </div>;
}

export function CaseDocumentAnalysisNotice({caseId,onReview}:{caseId:string;onReview?:()=>void}) {
  const read = useQuery({
    queryKey:['case-document-analysis',caseId],
    queryFn:()=>readCaseDocumentInventory(supabase.functions.invoke.bind(supabase.functions),caseId),
    refetchInterval:30_000,
  });
  const frame='mb-4 min-h-12 space-y-2 rounded-lg border border-border p-4 text-sm';
  if(read.isError) return <div className={frame} role="alert">
    <p>La lecture des documents manuels n’a pas pu être vérifiée. Aucun résultat complet n’est confirmé.</p>
    <Button type="button" variant="outline" size="sm" onClick={()=>void read.refetch()}>Actualiser la couverture documentaire</Button>
  </div>;
  if(!read.data) return <p className={frame} role="status">Vérification des documents manuels…</p>;
  const inventory=read.data,latest=inventory.latest;
  if(!latest && !inventory.documents.length) return null;
  const incomplete=!latest || latest.state !== 'complete' || latest.sources_changed;
  const date=latest?.completed_at || latest?.created_at;
  return <section className={frame} aria-label="Couverture des documents manuels">
    <p role="status" className="font-medium">{latest?.state === 'pending' ? 'Analyse documentaire en cours ou résultat non confirmé.' :
      latest?.state === 'failed' ? 'Analyse documentaire non finalisée. Les pièces et les faits restent à vérifier.' :
      incomplete ? 'Analyse documentaire incomplète.' : 'Analyse des documents manuels confirmée.'}</p>
    <p>{inventory.documents.filter(d=>d.readable).length} sur {inventory.documents.length} document(s) manuel(s) disposent de texte lisible.
      {' '}{incomplete ? 'Cette lecture partielle ne confirme pas un dossier complet ni un devis ferme.' : 'Cette confirmation concerne la lecture des documents manuels ; les autres réserves du dossier restent applicables.'}</p>
    {latest?.sources_changed && <p>Les sources ont changé depuis cette analyse. Actualisez puis relancez l’analyse.</p>}
    {date && Number.isFinite(Date.parse(date)) && <p className="text-muted-foreground">Enregistré le {new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short',timeZone:'UTC'}).format(new Date(date))} UTC.</p>}
    {!!latest?.documents.some(d=>!d.readable) && <details>
      <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Documents exclus lors de cette analyse</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">{latest.documents.filter(d=>!d.readable).map(d=><li key={d.id} className="break-words">{d.name} — texte non disponible</li>)}</ul>
    </details>}
    <div className="flex flex-wrap gap-2">
      {onReview && <Button type="button" variant="outline" size="sm" onClick={onReview}>Consulter les documents</Button>}
      <Button type="button" variant="ghost" size="sm" disabled={read.isFetching} onClick={()=>void read.refetch()}>Actualiser la couverture documentaire</Button>
    </div>
  </section>;
}
