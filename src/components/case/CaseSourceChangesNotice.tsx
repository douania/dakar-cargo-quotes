import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { changesAfterRun, readCaseSourceChanges, unresolvedSourceRevisions } from '@/lib/caseSourceChanges';

const valueLabel = (value: unknown) => value == null ? 'Non renseigné' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const dateLabel = (date: string | null) => date && Number.isFinite(Date.parse(date)) ? new Intl.DateTimeFormat('fr-FR', {dateStyle:'short',timeStyle:'short',timeZone:'UTC'}).format(new Date(date)) + ' UTC' : 'date inconnue';
const reasons: Record<string,string> = {
  newer_verified_declaration:'Déclaration plus récente vérifiée', initial_source_attestation:'Source initiale attestée',
  explicit_own_source:'Déclaration dans le texte propre du courriel', older_verified_declaration:'Déclaration antérieure conservée dans l’historique',
  same_source_and_value:'Même source et même valeur', protected_value_unchanged:'Valeur protégée inchangée',
  manual_or_validated_fact:'Fait manuel ou validé conservé', current_source_not_orderable:'Ordre des sources non établi',
  sources_or_values_incomparable:'Sources ou valeurs contradictoires', same_message_body_changed:'Contenu du même courriel modifié',
  same_source_contradictory_values:'Valeurs contradictoires dans une même source', unresolved_prior_source_conflict:'Conflit antérieur à résoudre',
  explicit_manual_successor:'Décision manuelle enregistrée', current_value_not_comparable:'Valeur actuelle non comparable',
};

export function CaseSourceChangesNotice({ caseId, runId, overview = false, refreshToken, onReview }: {
  caseId: string; runId?: string | null; overview?: boolean; refreshToken?: number; onReview?: () => void;
}) {
  const read = useQuery({
    queryKey: ['case-source-changes', caseId, refreshToken],
    queryFn: () => readCaseSourceChanges(caseId),
    refetchInterval: 30_000,
  });
  const border = overview ? 'mb-4 rounded-lg border p-4' : 'mt-2 rounded border p-3';
  if (read.isError) return <div role="alert" className={`${border} text-sm`}>
    <p>Vérification des nouvelles sources indisponible. La couverture de ce devis reste à vérifier.</p>
    <Button variant="outline" size="sm" onClick={() => void read.refetch()}>Réessayer les sources</Button>
  </div>;
  if (!read.data || read.isFetching) return <p role="status" className={`${border} text-sm`}>Vérification des nouvelles sources…</p>;
  const data = read.data;
  const selectedRunId = overview ? data.runs[0]?.id : runId;
  const changes = changesAfterRun(data, selectedRunId);
  const conflicts = unresolvedSourceRevisions(data.revisions);
  const title = changes.later.length > 0 ? 'Nouvelles sources à examiner' : 'Couverture des sources à vérifier';
  return <section aria-label={overview ? 'Évolution des sources du dossier' : 'Sources de cette version'} className={`${border} space-y-2 text-sm [overflow-wrap:anywhere]`}>
    <p className="font-medium" role={changes.later.length ? 'alert' : 'note'}>{title}</p>
    {conflicts.length > 0 && <p role="alert">{conflicts.length} correction(s) en conflit. Confirmez les faits concernés dans le dossier avant un nouveau calcul ; les valeurs manuelles ou validées sont conservées.</p>}
    {changes.revisions.length > 0 && <p role="alert">Des faits ont été actualisés après ce calcul. Ce devis est à réexaminer ; son contenu enregistré est conservé.</p>}
    {!changes.comparable && data.revisions.some(r => ['applied','confirmed'].includes(r.status)) && <p role="alert">Des faits ont été actualisés. Consultez leur historique avant le prochain calcul.</p>}
    {data.revisions.length > 0 && <details>
      <summary className="cursor-pointer">Historique des corrections de faits ({data.revisions.length})</summary>
      <ul className="mt-2 space-y-3">
        {data.revisions.map(r => <li key={r.id} className="border-l-2 border-border pl-3">
          <p className="font-medium">{r.key} — {r.status === 'applied' ? 'Actualisé, non validé' : r.status === 'confirmed' ? 'Confirmé par une source, non validé' : r.status === 'resolved' ? 'Résolu par décision manuelle' : ['conflict','protected'].includes(r.status) ? 'Conflit enregistré' : 'Valeur conservée'}</p>
          {['conflict','protected'].includes(r.status) ? <div>
            <p>Valeur conservée : {valueLabel(r.oldValue)}</p>
            <ul>{r.proposals.map((p,index) => <li key={index}>Proposition : {valueLabel(p.value)} · Courriel {p.emailId ?? 'non établi'}{p.excerpt && <blockquote className="text-muted-foreground">{p.excerpt}</blockquote>}</li>)}</ul>
          </div> : ['ignored','unchanged'].includes(r.status) ? <p>Valeur conservée : {valueLabel(r.oldValue)} · {r.status === 'ignored' ? 'Proposition ignorée' : 'Déclaration'} : {valueLabel(r.newValue)}</p> : <p>{valueLabel(r.oldValue)} → {valueLabel(r.newValue)}</p>}
          <p>{reasons[r.reason] ?? 'Preuve de source à examiner'} · Enregistré le {dateLabel(r.at)}</p>
          {r.emailId && <p>Courriel {r.emailId} · Date de source : {dateLabel(r.sentAt)}</p>}
          {r.excerpt && <blockquote className="mt-1 text-muted-foreground">{r.excerpt}</blockquote>}
          {r.status === 'resolved' && <p>Saisie manuelle{r.manualExcerpt ? ` : ${r.manualExcerpt}` : ''}</p>}
        </li>)}
      </ul>
    </details>}
    {changes.later.length > 0 && <p>
      {changes.later.length} source(s) enregistrée(s) après le début du {overview ? 'dernier calcul' : 'calcul de cette version'}. Vérifiez leur effet avant de réutiliser le devis.
    </p>}
    {!changes.comparable && <p>Le calcul de référence ou sa date n'est pas disponible ; comparaison impossible.</p>}
    {changes.comparable && changes.later.length === 0 && <p>Aucune source enregistrée après ce calcul n'a été trouvée dans les sources accessibles. Leur prise en compte n'est pas démontrée.</p>}
    {changes.undated > 0 && <p>{changes.undated} source(s) sans date exploitable.</p>}
    <p className="text-muted-foreground">Les corrections, documents tardifs, citations anciennes et rattachements historiques doivent être relus. Cet affichage ne confirme ni leur analyse ni leur couverture par le devis.</p>
    <details>
      <summary className="cursor-pointer">Voir les sources {changes.comparable ? 'enregistrées après ce calcul' : 'disponibles'}</summary>
      <ul className="mt-2 space-y-1">
        {(changes.comparable ? changes.later : data.sources).map(source => <li key={`${source.kind}:${source.id}`}>
          {source.kind === 'email' ? 'Courriel' : source.kind === 'attachment' ? 'Pièce jointe' : 'Document'} : {source.label} — {source.recordedAt && Number.isFinite(Date.parse(source.recordedAt)) ? new Date(source.recordedAt).toLocaleString('fr-FR') : 'date inconnue'}
        </li>)}
      </ul>
    </details>
    <div className="flex flex-wrap gap-2">
      {onReview && <Button variant="outline" size="sm" onClick={onReview}>Examiner les sources</Button>}
      <Button variant="ghost" size="sm" onClick={() => void read.refetch()}>Actualiser les sources</Button>
    </div>
  </section>;
}
