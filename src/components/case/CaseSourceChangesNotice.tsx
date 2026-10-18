import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { changesAfterRun, readCaseSourceChanges } from '@/lib/caseSourceChanges';

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
  const title = changes.later.length > 0 ? 'Nouvelles sources à examiner' : 'Couverture des sources à vérifier';
  return <section aria-label={overview ? 'Évolution des sources du dossier' : 'Sources de cette version'} className={`${border} space-y-2 text-sm [overflow-wrap:anywhere]`}>
    <p className="font-medium" role={changes.later.length ? 'alert' : 'note'}>{title}</p>
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
