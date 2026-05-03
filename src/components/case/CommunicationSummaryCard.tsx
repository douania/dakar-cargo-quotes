/**
 * COCKPIT-3 + P2-B: Communication summary widget (case-level)
 * 
 * Displays a compact overview of communication status:
 * - Open partner requests (preview rows from local mini-query)
 * - Pending partner facts (from useCockpitState)
 * - Open client gaps (from useCockpitState)
 * 
 * P2-B: counts consumed from useCockpitState to eliminate redundant queries.
 * Only the preview rows (partner_name, purpose, status) use a local query.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCockpitState } from '@/hooks/useCockpitState';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, Users, FileQuestion, CheckCircle2 } from 'lucide-react';

interface CommunicationSummaryCardProps {
  caseId: string;
}

interface OpenRequestPreview {
  id: string;
  partner_name: string | null;
  status: string;
  purpose: string | null;
}

export function CommunicationSummaryCard({ caseId }: CommunicationSummaryCardProps) {
  const { data: cockpit } = useCockpitState(caseId);

  // Mini-query locale : preview rows uniquement (colonnes minimales, demandes ouvertes, limit 4)
  const { data: previewRows } = useQuery({
    queryKey: ['communication-preview-rows', caseId],
    staleTime: 30_000,
    enabled: !!caseId,
    queryFn: async () => {
      const { data } = await supabase
        .from('external_quote_requests')
        .select('id, partner_name, status, purpose')
        .eq('case_id', caseId)
        .neq('status', 'closed')
        .limit(4);
      return (data ?? []) as OpenRequestPreview[];
    },
  });

  if (!cockpit) return null;

  const { openPartnerRequests, pendingPartnerFacts: pendingFactsCount, openClientGaps: openGapsCount, answeredClientGaps = 0 } = cockpit;
  const rows = previewRows ?? [];
  const nonAnsweredClientGaps = Math.max(0, openGapsCount - answeredClientGaps);
  const totalWarnings = openPartnerRequests + pendingFactsCount + openGapsCount;
  const isComplete = totalWarnings === 0;

  return (
    <Card className="border-border/50">
      <CardContent className="py-3 px-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <MessageSquare className="h-4 w-4" />
            Communication
          </div>
          {isComplete ? (
            <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-200 hover:bg-emerald-500/15">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Complète
            </Badge>
          ) : (
            <Badge className="bg-amber-500/15 text-amber-700 border-amber-200 hover:bg-amber-500/15">
              {totalWarnings} point{totalWarnings > 1 ? 's' : ''} en attente
            </Badge>
          )}
        </div>

        {!isComplete && (
          <div className="space-y-1.5 text-xs text-muted-foreground">
            {openPartnerRequests > 0 && (
              <div className="flex items-start gap-2">
                <Users className="h-3.5 w-3.5 mt-0.5 text-amber-600 shrink-0" />
                <div>
                  <span className="font-medium text-foreground">
                    {openPartnerRequests} demande{openPartnerRequests > 1 ? 's' : ''} partenaire ouverte{openPartnerRequests > 1 ? 's' : ''}
                  </span>
                  <div className="mt-0.5 space-y-0.5">
                    {rows.slice(0, 3).map((req) => (
                      <div key={req.id} className="text-muted-foreground">
                        {req.partner_name || '—'} · {req.purpose || '—'} · <span className="italic">{req.status}</span>
                      </div>
                    ))}
                    {openPartnerRequests > 3 && (
                      <div className="text-muted-foreground italic">+{openPartnerRequests - 3} autre{openPartnerRequests - 3 > 1 ? 's' : ''}</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {pendingFactsCount > 0 && (
              <div className="flex items-center gap-2">
                <FileQuestion className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                <span>
                  <span className="font-medium text-foreground">{pendingFactsCount}</span> fait{pendingFactsCount > 1 ? 's' : ''} partenaire à valider
                </span>
              </div>
            )}

            {openGapsCount > 0 && (
              <div className="flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                <span>
                  <span className="font-medium text-foreground">{openGapsCount}</span> clarification{openGapsCount > 1 ? 's' : ''} client non clôturée{openGapsCount > 1 ? 's' : ''}
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
