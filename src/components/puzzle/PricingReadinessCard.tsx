/**
 * COCKPIT-7C: Pricing readiness verdict card.
 * Read-only synthesis: Ready / Provisional / Incomplete / Neutral.
 *
 * P1-A: Migrated to useCockpitState + cockpitStatusConstants.
 * Verdict logic remains local (presentation).
 */

import { useCockpitState } from '@/hooks/useCockpitState';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertTriangle, XCircle, Minus } from 'lucide-react';

interface PricingReadinessCardProps {
  caseId: string;
}

type Verdict = 'ready' | 'provisional' | 'incomplete' | 'neutral';

export function PricingReadinessCard({ caseId }: PricingReadinessCardProps) {
  const { data, isLoading } = useCockpitState(caseId);

  if (isLoading || !data) return null;

  const {
    totalPartnerRequests,
    closedPartnerRequests,
    openPartnerRequests,
    responsePhaseRequests,
    pendingPartnerFacts,
    hasSelectedPartner,
  } = data;

  // Determine verdict
  let verdict: Verdict;
  if (totalPartnerRequests === 0) {
    verdict = 'neutral';
  } else if (openPartnerRequests === 0 && pendingPartnerFacts === 0) {
    verdict = 'ready';
  } else if (closedPartnerRequests === 0 && responsePhaseRequests === 0 && pendingPartnerFacts === 0) {
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
      summary: `${closedPartnerRequests}/${totalPartnerRequests} clôturées · 0 fait à valider`,
    },
    provisional: {
      icon: <AlertTriangle className="h-4 w-4 text-amber-600" />,
      label: 'Provisoire',
      badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
      summary: `${closedPartnerRequests}/${totalPartnerRequests} clôturées${pendingPartnerFacts > 0 ? ` · ${pendingPartnerFacts} fait(s) à valider` : ''}`,
    },
    incomplete: {
      icon: <XCircle className="h-4 w-4 text-destructive" />,
      label: 'Incomplet',
      badgeClass: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      summary: `${totalPartnerRequests} demande(s) lancée(s) · aucune réponse exploitable`,
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
      <CardContent className="py-3 px-4 space-y-1">
        <div className="flex items-center gap-3">
          {c.icon}
          <Badge className={`${c.badgeClass} text-xs font-medium`}>{c.label}</Badge>
          <span className="text-xs text-muted-foreground">{c.summary}</span>
        </div>
        {verdict === 'ready' && totalPartnerRequests > 0 && !hasSelectedPartner && (
          <p className="text-xs text-muted-foreground/70 italic pl-7">
            Sélection partenaire requise
          </p>
        )}
      </CardContent>
    </Card>
  );
}
