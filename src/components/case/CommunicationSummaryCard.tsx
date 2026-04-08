/**
 * COCKPIT-3: Communication summary widget (case-level)
 * 
 * Displays a compact overview of communication status:
 * - Open partner requests (everything except closed)
 * - Pending partner facts (proposed, not yet validated)
 * - Open client gaps (drafted, sent, answered)
 * 
 * Same filters as COCKPIT-2 (useSendQuotation safeguards).
 * Read-only, no mutations. staleTime 30s.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, Users, FileQuestion, CheckCircle2 } from 'lucide-react';

interface CommunicationSummaryCardProps {
  caseId: string;
}

interface OpenPartnerRequest {
  id: string;
  partner_name: string | null;
  status: string;
  purpose: string | null;
}

export function CommunicationSummaryCard({ caseId }: CommunicationSummaryCardProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['communication-summary', caseId],
    staleTime: 30_000,
    queryFn: async () => {
      const [eqrResult, factsResult, gapsResult] = await Promise.all([
        supabase
          .from('external_quote_requests')
          .select('id, partner_name, status, purpose')
          .eq('case_id', caseId)
          .neq('status', 'closed'),

        supabase
          .from('external_quote_response_facts')
          .select('id', { count: 'exact', head: true })
          .eq('case_id', caseId)
          .eq('validation_status', 'proposed'),

        supabase
          .from('client_gap_requests')
          .select('id', { count: 'exact', head: true })
          .eq('case_id', caseId)
          .in('status', ['drafted', 'sent', 'answered']),
      ]);

      return {
        openRequests: (eqrResult.data ?? []) as OpenPartnerRequest[],
        pendingFactsCount: factsResult.count ?? 0,
        openGapsCount: gapsResult.count ?? 0,
      };
    },
  });

  if (isLoading || !data) return null;

  const { openRequests, pendingFactsCount, openGapsCount } = data;
  const totalWarnings = openRequests.length + pendingFactsCount + openGapsCount;
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
            {openRequests.length > 0 && (
              <div className="flex items-start gap-2">
                <Users className="h-3.5 w-3.5 mt-0.5 text-amber-600 shrink-0" />
                <div>
                  <span className="font-medium text-foreground">
                    {openRequests.length} demande{openRequests.length > 1 ? 's' : ''} partenaire ouverte{openRequests.length > 1 ? 's' : ''}
                  </span>
                  <div className="mt-0.5 space-y-0.5">
                    {openRequests.slice(0, 3).map((req) => (
                      <div key={req.id} className="text-muted-foreground">
                        {req.partner_name || '—'} · {req.purpose || '—'} · <span className="italic">{req.status}</span>
                      </div>
                    ))}
                    {openRequests.length > 3 && (
                      <div className="text-muted-foreground italic">+{openRequests.length - 3} autre{openRequests.length - 3 > 1 ? 's' : ''}</div>
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
