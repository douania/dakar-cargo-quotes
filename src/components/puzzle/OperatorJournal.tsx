/**
 * Phase 8.4 — Journal opérateur (traçabilité humaine)
 * 
 * Affiche les événements du dossier depuis case_timeline_events
 * - N'influence PAS l'IA
 * - N'est PAS utilisé pour l'apprentissage
 * - Sert uniquement à l'audit et à la confiance
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Clock, ChevronDown, ChevronUp, User, Bot, FileText, AlertCircle, CheckCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';

interface TimelineEvent {
  id: string;
  event_type: string;
  actor_type: string | null;
  event_data: Record<string, unknown> | null;
  previous_value: string | null;
  new_value: string | null;
  created_at: string;
}

interface Props {
  caseId: string | undefined;
  maxEvents?: number;
}

// Labels pour les types d'événements
const EVENT_TYPE_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  status_changed: { label: 'Changement de statut', icon: <FileText className="h-3 w-3" /> },
  fact_added: { label: 'Fait ajouté', icon: <CheckCircle className="h-3 w-3" /> },
  fact_updated: { label: 'Fait mis à jour', icon: <FileText className="h-3 w-3" /> },
  gap_created: { label: 'Lacune identifiée', icon: <AlertCircle className="h-3 w-3" /> },
  gap_resolved: { label: 'Lacune résolue', icon: <CheckCircle className="h-3 w-3" /> },
  puzzle_analyzed: { label: 'Puzzle analysé', icon: <Bot className="h-3 w-3" /> },
  pricing_run: { label: 'Cotation calculée', icon: <FileText className="h-3 w-3" /> },
  email_received: { label: 'Email reçu', icon: <FileText className="h-3 w-3" /> },
  human_override: { label: 'Action opérateur', icon: <User className="h-3 w-3" /> },
};

function formatEventDescription(event: TimelineEvent): string {
  const { event_type, previous_value, new_value, event_data } = event;

  switch (event_type) {
    case 'status_changed':
      return `${previous_value || '?'} → ${new_value || '?'}`;
    case 'puzzle_analyzed':
      if (event_data) {
        const data = event_data as Record<string, number>;
        return `${data.source_count || 0} source / ${data.context_count || 0} contexte`;
      }
      return 'Analyse terminée';
    case 'gap_created':
      return new_value || 'Nouvelle lacune';
    case 'gap_resolved':
      return new_value || 'Lacune résolue';
    default:
      return new_value || event_type;
  }
}

export function OperatorJournal({ caseId, maxEvents = 20 }: Props) {
  const [isOpen, setIsOpen] = useState(false);

  const { data: events, isLoading } = useQuery({
    queryKey: ['case-timeline', caseId],
    queryFn: async () => {
      if (!caseId) return [];

      const { data, error } = await supabase
        .from('case_timeline_events')
        .select('id, event_type, actor_type, event_data, previous_value, new_value, created_at')
        .eq('case_id', caseId)
        .order('created_at', { ascending: false })
        .limit(maxEvents);

      if (error) throw error;
      return (data || []) as TimelineEvent[];
    },
    enabled: !!caseId,
    staleTime: 30000,
  });

  if (!caseId) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground flex items-center gap-2">
        <Clock className="h-4 w-4 animate-pulse" />
        Chargement du journal...
      </div>
    );
  }

  if (!events || events.length === 0) {
    return null;
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="w-full">
        <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors">
          <div className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">Journal opérateur</span>
            <Badge variant="secondary" className="text-xs">
              {events.length} événement{events.length > 1 ? 's' : ''}
            </Badge>
          </div>
          {isOpen ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <ScrollArea className="max-h-48 mt-2">
          <div className="space-y-2 p-2">
            {events.map((event) => {
              const eventConfig = EVENT_TYPE_LABELS[event.event_type] || {
                label: event.event_type,
                icon: <FileText className="h-3 w-3" />,
              };

              return (
                <div key={event.id} className="flex items-start gap-3 text-xs">
                  <span className="text-muted-foreground whitespace-nowrap">
                    {format(new Date(event.created_at), 'dd/MM HH:mm', { locale: fr })}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {event.actor_type === 'human' ? (
                      <User className="h-3 w-3 text-blue-500" />
                    ) : (
                      <Bot className="h-3 w-3 text-purple-500" />
                    )}
                    {eventConfig.icon}
                  </div>
                  <div className="flex-1">
                    <span className="text-muted-foreground">{eventConfig.label}</span>
                    <span className="mx-1">—</span>
                    <span>{formatEventDescription(event)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CollapsibleContent>
    </Collapsible>
  );
}
