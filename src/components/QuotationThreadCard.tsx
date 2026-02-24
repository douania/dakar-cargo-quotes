import { useState } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { extractPlainTextFromMime } from '@/lib/email/extractPlainTextFromMime';
import {
  Clock,
  User,
  Package,
  MapPin,
  AlertTriangle,
  CheckCircle,
  HelpCircle,
  ArrowRight,
  Paperclip,
  Eye,
  EyeOff,
  MessageSquare,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

export interface MergedExtractedData {
  client?: string;
  company?: string;
  cargo?: string;
  origin?: string;
  destination?: string;
  incoterm?: string;
  container_type?: string;
  weight?: string;
  urgency?: string;
}

export interface ThreadGroup {
  groupKey: string;
  rootEmailId: string;
  latestEmailId: string;
  threadRef: string | null;
  threadId: string | null;
  subject: string;
  from_address: string;
  /** Date of latest email – used for sorting */
  lastActivityAt: string;
  /** Date of root visible email */
  rootReceivedAt: string;
  messageCount: number;
  attachmentCount: number;
  mergedExtractedData: MergedExtractedData;
  latestBodyText: string | null;
}

interface QuotationThreadCardProps {
  thread: ThreadGroup;
  onProcess: (rootEmailId: string) => void;
}

const REQUIRED_FIELDS: (keyof MergedExtractedData)[] = ['cargo', 'origin', 'incoterm'];

const FIELD_LABELS: Record<string, string> = {
  cargo: 'Marchandise',
  origin: 'Origine',
  incoterm: 'Incoterm',
  destination: 'Destination',
};

export function QuotationThreadCard({ thread, onProcess }: QuotationThreadCardProps) {
  const [expanded, setExpanded] = useState(false);
  const data = thread.mergedExtractedData;

  const formatDate = (dateStr: string) => {
    try {
      return format(new Date(dateStr), "dd MMM 'à' HH:mm", { locale: fr });
    } catch {
      return '-';
    }
  };

  // Completeness
  const filledFields = REQUIRED_FIELDS.filter(f => data[f]);
  const completeness = Math.round((filledFields.length / REQUIRED_FIELDS.length) * 100);

  const getCompletenessColor = () => {
    if (completeness >= 80) return 'text-green-500';
    if (completeness >= 50) return 'text-amber-500';
    return 'text-red-500';
  };

  const missingFields = [...REQUIRED_FIELDS, 'destination' as keyof MergedExtractedData]
    .filter(f => !data[f])
    .map(f => FIELD_LABELS[f] || f);

  // Latest email body preview
  const decodedText = extractPlainTextFromMime(thread.latestBodyText || '') || '';
  const cleanText = decodedText.replace(/\s+/g, ' ').trim();

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <Card className="border-border/50 bg-gradient-card hover:border-primary/30 transition-all duration-200 group">
        <CardContent className="p-4">
          <div className="flex items-start gap-4">
            {/* Left: Main info */}
            <div className="flex-1 min-w-0">
              {/* Header */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <h3 className="font-medium truncate text-foreground group-hover:text-primary transition-colors">
                    {thread.subject || 'Sans sujet'}
                  </h3>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-sm text-muted-foreground truncate">
                      {thread.from_address}
                    </span>
                    {thread.messageCount > 1 && (
                      <Badge variant="outline" className="text-xs px-1.5 py-0 border-primary/30 text-primary">
                        <MessageSquare className="h-3 w-3 mr-1" />
                        {thread.messageCount} msg
                      </Badge>
                    )}
                    {thread.attachmentCount > 0 && (
                      <Badge variant="outline" className="text-xs px-1.5 py-0">
                        <Paperclip className="h-3 w-3 mr-1" />
                        {thread.attachmentCount}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      {expanded ? (
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                  </CollapsibleTrigger>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatDate(thread.lastActivityAt)}
                  </div>
                </div>
              </div>

              {/* Extracted Info Pills */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {(data.company || data.client) && (
                  <Badge variant="secondary" className="text-xs bg-secondary/50">
                    <User className="h-3 w-3 mr-1" />
                    {data.company || data.client}
                  </Badge>
                )}
                {data.cargo && (
                  <Badge variant="secondary" className="text-xs bg-secondary/50">
                    <Package className="h-3 w-3 mr-1" />
                    {data.cargo.substring(0, 30)}{data.cargo.length > 30 ? '...' : ''}
                  </Badge>
                )}
                {data.origin && (
                  <Badge variant="secondary" className="text-xs bg-secondary/50">
                    <MapPin className="h-3 w-3 mr-1" />
                    {data.origin}
                  </Badge>
                )}
                {data.incoterm && (
                  <Badge variant="outline" className="text-xs border-primary/30 text-primary">
                    {data.incoterm}
                  </Badge>
                )}
                {data.container_type && (
                  <Badge variant="outline" className="text-xs">
                    {data.container_type}
                  </Badge>
                )}
              </div>

              {/* Always-visible latest email preview */}
              {cleanText && (
                <p className="text-sm text-muted-foreground mb-2 line-clamp-3">
                  {cleanText.slice(0, 300)}{cleanText.length > 300 ? '…' : ''}
                </p>
              )}

              {/* Alerts */}
              {missingFields.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-amber-500">
                  <AlertTriangle className="h-3 w-3" />
                  <span>Manquant: {missingFields.join(', ')}</span>
                </div>
              )}

              {/* Collapsible full body */}
              <CollapsibleContent>
                <div className="mt-3 text-sm text-muted-foreground bg-muted/30 p-3 rounded-md max-h-64 overflow-y-auto whitespace-pre-wrap">
                  {cleanText || 'Aucun contenu disponible'}
                </div>
              </CollapsibleContent>
            </div>

            {/* Right: Action & Status */}
            <div className="flex flex-col items-end gap-2 shrink-0">
              <div className="flex items-center gap-1.5">
                {completeness >= 80 ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : completeness >= 50 ? (
                  <HelpCircle className="h-4 w-4 text-amber-500" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                )}
                <span className={cn('text-sm font-medium', getCompletenessColor())}>
                  {completeness}%
                </span>
              </div>

              <Button
                size="sm"
                onClick={() => onProcess(thread.rootEmailId)}
                className="gap-1"
              >
                Traiter
                <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </Collapsible>
  );
}
