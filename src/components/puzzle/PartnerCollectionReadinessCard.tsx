/**
 * COCKPIT-9 Phase 1: Partner collection sufficiency verdict.
 * Read-only. Two queries only: requests + facts.
 * Verdicts: neutral / insufficient / in_progress / sufficient.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PackageSearch, CheckCircle2, AlertTriangle, XCircle, Minus } from 'lucide-react';

interface Props {
  caseId: string;
}

interface RequestRow {
  id: string;
  status: string;
}

interface FactRow {
  request_id: string;
  validation_status: string;
}

/**
 * Statuses that indicate a request has entered "response phase" or beyond.
 * A request is "exploitable" if it has one of these statuses AND has no
 * pending (proposed) facts — OR is already closed.
 */
const RESPONSE_PHASE_STATUSES = new Set([
  'response_received',
  'response_analyzed',
  'partially_validated',
  'facts_validated',
  'closed',
]);

type CollectionVerdict = 'neutral' | 'insufficient' | 'in_progress' | 'sufficient';

export function PartnerCollectionReadinessCard({ caseId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['partner-collection-readiness', caseId],
    staleTime: 30_000,
    enabled: !!caseId,
    queryFn: async () => {
      const [reqResult, factsResult] = await Promise.all([
        supabase
          .from('external_quote_requests')
          .select('id, status')
          .eq('case_id', caseId),
        supabase
          .from('external_quote_response_facts')
          .select('request_id, validation_status')
          .eq('case_id', caseId),
      ]);

      const requests = (reqResult.data ?? []) as unknown as RequestRow[];
      const facts = (factsResult.data ?? []) as unknown as FactRow[];

      const total = requests.length;
      if (total === 0) {
        return { verdict: 'neutral' as CollectionVerdict, total: 0, exploitable: 0, openCount: 0, pendingFacts: 0, summary: '' };
      }

      // Build per-request pending facts count
      const pendingByRequest = new Map<string, number>();
      let totalPending = 0;
      for (const f of facts) {
        if (f.validation_status === 'proposed') {
          pendingByRequest.set(f.request_id, (pendingByRequest.get(f.request_id) ?? 0) + 1);
          totalPending++;
        }
      }

      let exploitable = 0;
      let openCount = 0;

      for (const r of requests) {
        if (r.status === 'closed') {
          exploitable++;
          continue;
        }

        // Open request
        openCount++;

        if (RESPONSE_PHASE_STATUSES.has(r.status) && (pendingByRequest.get(r.id) ?? 0) === 0) {
          exploitable++;
        }
      }

      // Determine verdict (conservative)
      let verdict: CollectionVerdict;
      if (exploitable === 0) {
        verdict = 'insufficient';
      } else if (openCount > 0 || totalPending > 0) {
        verdict = 'in_progress';
      } else {
        verdict = 'sufficient';
      }

      // Build summary
      const parts: string[] = [];
      parts.push(`${exploitable} exploitable${exploitable > 1 ? 's' : ''}`);
      if (openCount > 0) parts.push(`${openCount} ouverte${openCount > 1 ? 's' : ''}`);
      if (totalPending > 0) parts.push(`${totalPending} fait(s) à valider`);
      const summary = parts.join(' · ');

      return { verdict, total, exploitable, openCount, pendingFacts: totalPending, summary };
    },
  });

  if (isLoading || !data) return null;

  const { verdict, summary } = data;

  const config: Record<CollectionVerdict, {
    icon: React.ReactNode;
    label: string;
    badgeClass: string;
    detail: string;
  }> = {
    neutral: {
      icon: <Minus className="h-4 w-4 text-muted-foreground" />,
      label: 'Direct',
      badgeClass: 'bg-muted text-muted-foreground',
      detail: 'Aucune collecte partenaire — pricing direct possible.',
    },
    insufficient: {
      icon: <XCircle className="h-4 w-4 text-destructive" />,
      label: 'Insuffisante',
      badgeClass: 'bg-destructive/10 text-destructive',
      detail: summary,
    },
    in_progress: {
      icon: <AlertTriangle className="h-4 w-4 text-amber-600" />,
      label: 'En cours',
      badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
      detail: summary,
    },
    sufficient: {
      icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
      label: 'Suffisante',
      badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
      detail: summary,
    },
  };

  const c = config[verdict];

  return (
    <Card className="border-border/50 mb-3">
      <CardContent className="py-3 px-4 space-y-2">
        <div className="flex items-center gap-3">
          <PackageSearch className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium text-muted-foreground">Collecte partenaires</span>
          {c.icon}
          <Badge className={`${c.badgeClass} text-xs font-medium`}>{c.label}</Badge>
          <span className="text-xs text-muted-foreground ml-auto">{c.detail}</span>
        </div>
        {verdict !== 'neutral' && (
          <div className="flex items-center gap-2 pl-7">
            <span className="text-xs text-muted-foreground">Offre retenue :</span>
            <span className="text-xs text-muted-foreground/70 italic">Sélection requise</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
