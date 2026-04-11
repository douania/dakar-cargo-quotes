/**
 * COCKPIT-7A: Synthetic view of partner requests — "Expected vs Received"
 * P2-A: Migrated to consume useCockpitState (shared query, no internal fetch).
 */

import { useCockpitState } from '@/hooks/useCockpitState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ClipboardList } from 'lucide-react';

interface PartnerRequestsSummaryProps {
  caseId: string;
}

export function PartnerRequestsSummary({ caseId }: PartnerRequestsSummaryProps) {
  const { data, isLoading } = useCockpitState(caseId);

  if (isLoading || !data || data.totalPartnerRequests === 0) return null;

  const {
    totalPartnerRequests: total,
    draftPartnerRequests: drafts,
    unsentPartnerRequests: toConfirm,
    sentConfirmedPartnerRequests: sentConfirmed,
    responsePhaseRequests,
    pendingPartnerFacts: pendingFacts,
    closedPartnerRequests: closed,
  } = data;

  const progressPct = total > 0 ? Math.round((closed / total) * 100) : 0;

  const counters: { label: string; value: number; className: string }[] = [
    { label: 'Brouillons', value: drafts, className: 'bg-muted text-muted-foreground' },
    { label: 'À confirmer', value: toConfirm, className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
    { label: 'Envoyées', value: sentConfirmed, className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200' },
    { label: 'En phase réponse', value: responsePhaseRequests, className: 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200' },
    { label: 'Faits à valider', value: pendingFacts, className: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' },
    { label: 'Clôturées', value: closed, className: 'bg-muted text-muted-foreground' },
  ];

  return (
    <Card className="border-border/50">
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2 font-medium">
            <ClipboardList className="h-4 w-4" />
            Demandes partenaires
            <Badge variant="outline" className="ml-1 text-xs">{total}</Badge>
          </CardTitle>
          {total > 0 && (
            <span className="text-xs text-muted-foreground">{closed}/{total} clôturées</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0 space-y-3">
        {total > 1 && (
          <Progress value={progressPct} className="h-2" />
        )}
        <div className="flex flex-wrap gap-2">
          {counters
            .filter((c) => c.value > 0)
            .map((c) => (
              <Badge key={c.label} className={`${c.className} text-xs font-normal`}>
                {c.value} {c.label.toLowerCase()}
              </Badge>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}
