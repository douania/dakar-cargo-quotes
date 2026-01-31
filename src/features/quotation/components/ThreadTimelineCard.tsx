/**
 * UI COMPONENT — FROZEN (Phase 3B.4)
 * - Ne pas modifier sans ouvrir une nouvelle phase
 * - Logique métier volontairement absente
 * - Toute évolution = nouvelle phase (3B.x)
 */
import { memo } from 'react';
import { History, ChevronUp, ChevronDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { isInternalEmail, getEmailSenderName } from '@/features/quotation/utils/parsing';
import type { ThreadEmail, QuotationOffer } from '@/features/quotation/types';

interface ThreadTimelineCardProps {
  threadEmails: ThreadEmail[];
  selectedEmailId: string | null;
  quotationOffers: QuotationOffer[];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onSelectEmail: (email: ThreadEmail) => void;
  formatDate: (date: string | null) => string;
}

// Skeleton loader pour état de chargement (future-proof)
function ThreadTimelineSkeleton() {
  return (
    <Card className="border-ocean/30 bg-ocean/5 animate-pulse">
      <CardHeader className="pb-2">
        <div className="h-4 w-48 bg-muted rounded" />
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="w-3 h-3 rounded-full bg-muted mt-1.5" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-1/3 bg-muted rounded" />
              <div className="h-3 w-2/3 bg-muted rounded" />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export const ThreadTimelineCard = memo(function ThreadTimelineCard({
  threadEmails,
  selectedEmailId,
  quotationOffers,
  expanded,
  onExpandedChange,
  onSelectEmail,
  formatDate,
}: ThreadTimelineCardProps) {
  // Skeleton si données non chargées (future-proof)
  if (!threadEmails) {
    return <ThreadTimelineSkeleton />;
  }

  // Condition d'affichage conservée STRICTEMENT
  if (threadEmails.length <= 1) {
    return null;
  }

  return (
    <Collapsible open={expanded} onOpenChange={onExpandedChange}>
      <Card className="border-ocean/30 bg-ocean/5">
        <CardHeader className="pb-2">
          <CollapsibleTrigger asChild>
            <div
              className="flex items-center justify-between cursor-pointer"
              role="button"
              tabIndex={0}
              aria-expanded={expanded}
              aria-label="Afficher l'historique du fil"
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onExpandedChange(!expanded);
                }
              }}
            >
              <CardTitle className="text-base flex items-center gap-2">
                <History className="h-4 w-4 text-ocean" />
                Historique du fil ({threadEmails.length} échanges)
              </CardTitle>
              {expanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="pt-0">
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-3 top-0 bottom-0 w-px bg-border" />
              
              <div className="space-y-2">
                {threadEmails.map((email, index) => {
                  const isInternal = isInternalEmail(email.from_address);
                  const isOffer = quotationOffers.some(o => o.email.id === email.id);
                  
                  return (
                    <div 
                      key={email.id} 
                      className={cn(
                        "relative pl-8 py-2 rounded-lg transition-colors cursor-pointer",
                        "focus:outline-none focus:ring-2 focus:ring-ocean/40",
                        email.id === selectedEmailId 
                          ? "bg-ocean/10 border border-ocean/30" 
                          : "hover:bg-muted/50",
                        isOffer && "border-l-2 border-l-green-500"
                      )}
                      onClick={() => onSelectEmail(email)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectEmail(email);
                        }
                      }}
                    >
                      {/* Timeline dot */}
                      <div className={cn(
                        "absolute left-1.5 top-4 w-3 h-3 rounded-full border-2",
                        index === 0 
                          ? "bg-primary border-primary"
                          : isOffer
                          ? "bg-green-500 border-green-500"
                          : isInternal
                          ? "bg-ocean border-ocean"
                          : email.id === selectedEmailId
                          ? "bg-ocean border-ocean"
                          : "bg-muted border-muted-foreground/30"
                      )} />
                      
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm truncate">
                              {getEmailSenderName(email.from_address)}
                            </span>
                            {index === 0 && (
                              <Badge variant="outline" className="text-xs">
                                Original
                              </Badge>
                            )}
                            {isOffer && (
                              <Badge className="text-xs bg-green-500/20 text-green-600 border-green-500/30">
                                Offre
                              </Badge>
                            )}
                            {isInternal && !isOffer && (
                              <Badge variant="outline" className="text-xs text-ocean">
                                Interne
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {email.subject}
                          </p>
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(email.sent_at || email.received_at)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
});
