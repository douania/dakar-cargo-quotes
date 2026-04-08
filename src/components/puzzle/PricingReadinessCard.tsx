/**
 * COCKPIT-7C: Pricing readiness verdict card.
 * Read-only synthesis: Ready / Provisional / Incomplete / Neutral.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertTriangle, XCircle, Minus } from 'lucide-react';

interface PricingReadinessCardProps {
  caseId: string;
}

interface RequestRow {
  id: string;
  status: string;
}

type Verdict = 'ready' | 'provisional' | 'incomplete' | 'neutral';

export function PricingReadinessCard({ caseId }: PricingReadinessCardProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['pricing-readiness', caseId],
    staleTime: 30_000,
    queryFn: async () => {
      const [reqResult, factsResult] = await Promise.all([
        supabase
          .from('external_quote_requests')
          .select('id, status')
          .eq('case_id', caseId),
        supabase
          .from('external_quote_response_facts')
          .select('id', { count: 'exact', head: true })
          .eq('case_id', caseId)
          .eq('validation_status', 'proposed'),
      ]);

      const requests = (reqResult.data ?? []) as unknown as RequestRow[];
      const pendingFacts = factsResult.count ?? 0;

      const total = requests.length;
      let closed = 0;
      let responsePhase = 0; // requests that have moved beyond "sent"

      for (const r of requests) {
        if (r.status === 'closed') {
          closed++;
        } else if (
          ['response_received', 'response_analyzed', 'partially_validated', 'facts_validated'].includes(r.status)
        ) {
          responsePhase++;
        }
      }

      const open = total - closed;

      return { total, closed, open, responsePhase, pendingFacts };
    },
    enabled: !!caseId,
  });

  if (isLoading || !data) return null;

  const { total, closed, open, responsePhase, pendingFacts } = data;

  // Determine verdict
  let verdict: Verdict;
  if (total === 0) {
    verdict = 'neutral';
  } else if (open === 0 && pendingFacts === 0) {
    verdict = 'ready';
  } else if (closed === 0 && responsePhase === 0 && pendingFacts === 0) {
    // Requests exist but nothing exploitable yet
    verdict = 'incomplete';
  } else {
    verdict = 'provisional';
  }

  const config: Record<Verdict, {
    icon: React.ReactNode;
    label: string;
    badgeClass: string;
    summary: string;
  }> = {
    ready: {
      icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
      label: 'Prêt',
      badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
      summary: `${closed}/${total} clôturées · 0 fait à valider`,
    },
    provisional: {
      icon: <AlertTriangle className="h-4 w-4 text-amber-600" />,
      label: 'Provisoire',
      badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
      summary: `${closed}/${total} clôturées${pendingFacts > 0 ? ` · ${pendingFacts} fait(s) à valider` : ''}`,
    },
    incomplete: {
      icon: <XCircle className="h-4 w-4 text-destructive" />,
      label: 'Incomplet',
      badgeClass: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      summary: `${total} demande(s) lancée(s) · aucune réponse exploitable`,
    },
    neutral: {
      icon: <Minus className="h-4 w-4 text-muted-foreground" />,
      label: 'Direct',
      badgeClass: 'bg-muted text-muted-foreground',
      summary: 'Aucune sollicitation partenaire — pricing direct possible.',
    },
  };

  const c = config[verdict];

  return (
    <Card className="border-border/50 mb-3">
      <CardContent className="py-3 px-4 flex items-center gap-3">
        {c.icon}
        <Badge className={`${c.badgeClass} text-xs font-medium`}>{c.label}</Badge>
        <span className="text-xs text-muted-foreground">{c.summary}</span>
      </CardContent>
    </Card>
  );
}
