/**
 * COCKPIT-7A: Synthetic view of partner requests — "Expected vs Received"
 * Read-only, no mutations. Two queries: requests + facts.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ClipboardList } from 'lucide-react';

interface PartnerRequestsSummaryProps {
  caseId: string;
}

interface RequestRow {
  id: string;
  status: string;
  email_sent_at: string | null;
}

export function PartnerRequestsSummary({ caseId }: PartnerRequestsSummaryProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['partner-requests-summary', caseId],
    staleTime: 30_000,
    queryFn: async () => {
      const [reqResult, factsResult] = await Promise.all([
        supabase
          .from('external_quote_requests')
          .select('id, status, email_sent_at')
          .eq('case_id', caseId),
        supabase
          .from('external_quote_response_facts')
          .select('id', { count: 'exact', head: true })
          .eq('case_id', caseId)
          .eq('validation_status', 'proposed'),
      ]);

      const requests = (reqResult.data ?? []) as unknown as RequestRow[];
      const pendingFacts = factsResult.count ?? 0;

      let drafts = 0;
      let toConfirm = 0;
      let sentConfirmed = 0;
      let responseReceived = 0;
      let closed = 0;

      for (const r of requests) {
        if (r.status === 'draft') {
          drafts++;
        } else if (r.status === 'sent' && !r.email_sent_at) {
          toConfirm++;
        } else if (r.status === 'sent' && r.email_sent_at) {
          sentConfirmed++;
        } else if (r.status === 'closed') {
          closed++;
        } else {
          // response_received, response_analyzed, partially_validated, facts_validated
          responseReceived++;
        }
      }

      return {
        total: requests.length,
        drafts,
        toConfirm,
        sentConfirmed,
        responseReceived,
        pendingFacts,
        closed,
      };
    },
    enabled: !!caseId,
  });

  if (isLoading || !data || data.total === 0) return null;

  const { total, drafts, toConfirm, sentConfirmed, responseReceived, pendingFacts, closed } = data;
  const progressPct = total > 0 ? Math.round((closed / total) * 100) : 0;

  const counters: { label: string; value: number; className: string }[] = [
    { label: 'Brouillons', value: drafts, className: 'bg-muted text-muted-foreground' },
    { label: 'À confirmer', value: toConfirm, className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
    { label: 'Envoyées', value: sentConfirmed, className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200' },
    { label: 'Réponses reçues', value: responseReceived, className: 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200' },
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
