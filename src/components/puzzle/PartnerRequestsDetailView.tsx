/**
 * COCKPIT-7B + 9P2: Detailed view per partner / per purpose.
 * Read-only display + "Retenir" action button.
 * Badge hierarchy: selected > closed > facts_proposed > response > sent > to_confirm > draft
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Users, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { useState } from 'react';
import { RESPONSE_PHASE_STATUSES } from '@/lib/cockpitStatusConstants';

interface Props {
  caseId: string;
}

interface RequestRow {
  id: string;
  partner_name: string;
  purpose: string;
  purpose_detail: string | null;
  related_lot_index: number | null;
  status: string;
  email_sent_at: string | null;
  is_selected: boolean;
  selected_at: string | null;
  created_at: string;
}

interface FactRow {
  request_id: string;
  validation_status: string;
}

/**
 * P2-B: closed is an exploitable terminal state, NOT a response phase.
 * Matches computeCollectionVerdict logic from cockpitStatusConstants.
 */
function isExploitable(status: string, proposedFacts: number): boolean {
  if (status === 'closed') return true;
  return RESPONSE_PHASE_STATUSES.has(status) && proposedFacts === 0;
}

type VisualStatus = {
  label: string;
  className: string;
  priority: number;
};

function deriveVisualStatus(
  status: string,
  emailSentAt: string | null,
  proposedFacts: number,
): VisualStatus {
  if (status === 'closed') {
    return { label: 'Clôturée', className: 'bg-muted text-muted-foreground', priority: 1 };
  }
  if (proposedFacts > 0) {
    return {
      label: 'Faits proposés',
      className: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
      priority: 2,
    };
  }
  if (['response_received', 'response_analyzed', 'partially_validated', 'facts_validated'].includes(status)) {
    return {
      label: 'Réponse reçue',
      className: 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200',
      priority: 3,
    };
  }
  if (status === 'sent' && emailSentAt) {
    return {
      label: 'Envoyée',
      className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
      priority: 4,
    };
  }
  if (status === 'sent' && !emailSentAt) {
    return {
      label: 'À confirmer',
      className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      priority: 5,
    };
  }
  return { label: 'Brouillon', className: 'bg-muted text-muted-foreground', priority: 6 };
}

export function PartnerRequestsDetailView({ caseId }: Props) {
  const queryClient = useQueryClient();
  const [selectingId, setSelectingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['partner-requests-detail', caseId],
    staleTime: 30_000,
    queryFn: async () => {
      const [reqResult, factsResult] = await Promise.all([
        supabase
          .from('external_quote_requests')
          .select('id, partner_name, purpose, purpose_detail, related_lot_index, status, email_sent_at, is_selected, selected_at, created_at')
          .eq('case_id', caseId)
          .order('created_at', { ascending: false }),
        supabase
          .from('external_quote_response_facts')
          .select('request_id, validation_status')
          .eq('case_id', caseId),
      ]);

      const requests = (reqResult.data ?? []) as unknown as RequestRow[];
      const facts = (factsResult.data ?? []) as unknown as FactRow[];

      const factsByRequest = new Map<string, { total: number; proposed: number }>();
      for (const f of facts) {
        const entry = factsByRequest.get(f.request_id) ?? { total: 0, proposed: 0 };
        entry.total++;
        if (f.validation_status === 'proposed') entry.proposed++;
        factsByRequest.set(f.request_id, entry);
      }

      return { requests, factsByRequest };
    },
    enabled: !!caseId,
  });

  const handleSelect = async (requestId: string) => {
    setSelectingId(requestId);
    try {
      const { data: result, error } = await supabase.functions.invoke('select-partner-request', {
        body: { case_id: caseId, request_id: requestId },
      });

      if (error) {
        toast.error("Erreur lors de la sélection");
        return;
      }

      if (result?.error) {
        toast.error(result.error);
        return;
      }

      toast.success(`Offre ${result?.partner_name ?? ''} retenue`);
      queryClient.invalidateQueries({ queryKey: ['partner-requests-detail', caseId] });
      queryClient.invalidateQueries({ queryKey: ['partner-collection-readiness', caseId] });
      queryClient.invalidateQueries({ queryKey: ['pricing-readiness', caseId] });
      queryClient.invalidateQueries({ queryKey: ['next-action-banner', caseId] });
      // P1-A: unified cockpit state
      queryClient.invalidateQueries({ queryKey: ['cockpit-state', caseId] });
    } finally {
      setSelectingId(null);
    }
  };

  if (isLoading || !data || data.requests.length === 0) return null;

  const { requests, factsByRequest } = data;

  return (
    <TooltipProvider>
      <Card className="border-border/50">
        <CardContent className="px-4 py-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-1">
            <Users className="h-4 w-4" />
            Détail par partenaire
          </div>

          {requests.map((req) => {
            const factsInfo = factsByRequest.get(req.id) ?? { total: 0, proposed: 0 };
            const visual = deriveVisualStatus(req.status, req.email_sent_at, factsInfo.proposed);
            const exploitable = isExploitable(req.status, factsInfo.proposed);
            const relativeDate = formatDistanceToNow(new Date(req.created_at), {
              addSuffix: true,
              locale: fr,
            });

            return (
              <div
                key={req.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border/40 px-3 py-2 text-sm"
              >
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{req.partner_name}</span>
                    {req.is_selected && (
                      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 text-[10px] px-1.5 py-0">
                        <CheckCircle2 className="h-3 w-3 mr-0.5" />
                        Retenue
                      </Badge>
                    )}
                    {req.related_lot_index != null && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        Lot {req.related_lot_index}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {req.purpose_detail ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="truncate cursor-help">{req.purpose}</span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p>{req.purpose_detail}</p>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="truncate">{req.purpose}</span>
                    )}
                    <span>·</span>
                    <span className="whitespace-nowrap">{relativeDate}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {factsInfo.total > 0 && (
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {factsInfo.total} fait{factsInfo.total > 1 ? 's' : ''}
                      {factsInfo.proposed > 0 && (
                        <span className="text-orange-600 dark:text-orange-400">
                          {' '}· {factsInfo.proposed} à valider
                        </span>
                      )}
                    </span>
                  )}
                  <Badge className={`${visual.className} text-[10px] font-normal whitespace-nowrap`}>
                    {visual.label}
                  </Badge>
                  {exploitable && !req.is_selected && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-6 px-2"
                      disabled={selectingId !== null}
                      onClick={() => handleSelect(req.id)}
                    >
                      {selectingId === req.id ? '…' : 'Retenir'}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
