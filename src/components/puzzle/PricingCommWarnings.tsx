/**
 * PRICING-GUARD + P2-D: Communication warnings before manual pricing.
 * Displays an amber alert listing open partner requests, pending partner facts,
 * and unclosed client gaps. Purely informational — does not block.
 *
 * P2-D: Migrated from 3 local HEAD queries to useCockpitState (single source).
 */

import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useCockpitState } from '@/hooks/useCockpitState';

interface PricingCommWarningsProps {
  caseId: string;
}

export function PricingCommWarnings({ caseId }: PricingCommWarningsProps) {
  const { data } = useCockpitState(caseId);

  if (!data) return null;
  const { openPartnerRequests, pendingPartnerFacts, openClientGaps } = data;
  const total = openPartnerRequests + pendingPartnerFacts + openClientGaps;
  if (total === 0) return null;

  const items: string[] = [];
  if (openPartnerRequests > 0) items.push(`${openPartnerRequests} demande(s) partenaire(s) non clôturée(s)`);
  if (pendingPartnerFacts > 0) items.push(`${pendingPartnerFacts} fait(s) partenaire(s) à valider`);
  if (openClientGaps > 0) items.push(`${openClientGaps} clarification(s) client non close(s)`);

  return (
    <Alert className="mt-3 border-amber-300 bg-amber-50 dark:bg-amber-950/30">
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <AlertDescription>
        <p className="font-medium text-sm mb-1">Ce pricing a été calculé alors que certaines communications sont encore en cours.</p>
        <ul className="list-disc list-inside text-sm space-y-0.5">
          {items.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
