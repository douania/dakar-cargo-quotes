/**
 * PRICING-GUARD: Communication warnings before manual pricing.
 * Displays an amber alert listing open partner requests, pending partner facts,
 * and unclosed client gaps. Purely informational — does not block.
 */

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';

interface PricingCommWarningsProps {
  caseId: string;
}

export function PricingCommWarnings({ caseId }: PricingCommWarningsProps) {
  const { data } = useQuery({
    queryKey: ['pricing-comm-warnings', caseId],
    staleTime: 30_000,
    queryFn: async () => {
      const [eqrOpen, factsPending, clientGapsOpen] = await Promise.all([
        supabase.from('external_quote_requests').select('id', { count: 'exact', head: true }).eq('case_id', caseId).neq('status', 'closed'),
        supabase.from('external_quote_response_facts').select('id', { count: 'exact', head: true }).eq('case_id', caseId).eq('validation_status', 'proposed'),
        supabase.from('client_gap_requests' as any).select('id', { count: 'exact', head: true }).eq('case_id', caseId).in('status', ['drafted', 'sent', 'answered'] as string[]),
      ]);
      return {
        openPartnerRequests: eqrOpen.count ?? 0,
        pendingPartnerFacts: factsPending.count ?? 0,
        openClientGaps: clientGapsOpen.count ?? 0,
      };
    },
    enabled: !!caseId,
  });

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
