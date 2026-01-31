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

export function ThreadTimelineCard({
  threadEmails,
  selectedEmailId,
  quotationOffers,
  expanded,
  onExpandedChange,
  onSelectEmail,
  formatDate,
}: ThreadTimelineCardProps) {
  // Condition d'affichage conservée STRICTEMENT
  if (threadEmails.length <= 1) {
    return null;
  }

  return (
    <Collapsible open={expanded} onOpenChange={onExpandedChange}>
      <Card className="border-ocean/30 bg-ocean/5">
        <CardHeader className="pb-2">
          <CollapsibleTrigger asChild>
            <div className="flex items-center justify-between cursor-pointer">
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
                        email.id === selectedEmailId 
                          ? "bg-ocean/10 border border-ocean/30" 
                          : "hover:bg-muted/50",
                        isOffer && "border-l-2 border-l-green-500"
                      )}
                      onClick={() => onSelectEmail(email)}
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
}
