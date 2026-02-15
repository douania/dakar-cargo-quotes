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
  EyeOff
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

interface ExtractedData {
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

interface QuotationRequest {
  id: string;
  subject: string;
  from_address: string;
  received_at: string;
  body_text?: string;
  extracted_data: ExtractedData | null;
  thread_id?: string;
  attachmentCount?: number;
}

interface QuotationRequestCardProps {
  request: QuotationRequest;
  onProcess: (id: string) => void;
}

export function QuotationRequestCard({ request, onProcess }: QuotationRequestCardProps) {
  const [expanded, setExpanded] = useState(false);
  const extractedData = request.extracted_data || {};
  
  const formatDate = (dateStr: string) => {
    try {
      return format(new Date(dateStr), "dd MMM 'à' HH:mm", { locale: fr });
    } catch {
      return '-';
    }
  };

  // Calculate completeness
  const requiredFields = ['cargo', 'origin', 'incoterm'];
  const filledFields = requiredFields.filter(f => extractedData[f as keyof ExtractedData]);
  const completeness = Math.round((filledFields.length / requiredFields.length) * 100);
  
  const getCompletenessColor = () => {
    if (completeness >= 80) return 'text-green-500';
    if (completeness >= 50) return 'text-amber-500';
    return 'text-red-500';
  };

  const getMissingFields = () => {
    const missing: string[] = [];
    if (!extractedData.cargo) missing.push('Marchandise');
    if (!extractedData.origin) missing.push('Origine');
    if (!extractedData.incoterm) missing.push('Incoterm');
    if (!extractedData.destination) missing.push('Destination');
    return missing;
  };

  const missingFields = getMissingFields();

  // Email body preview
  const decodedText = extractPlainTextFromMime(request.body_text || '') || '';
  const cleanText = decodedText.replace(/\s+/g, ' ').trim();
  const preview = cleanText.slice(0, 200);
  const isTruncated = cleanText.length > 200;

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
                    {request.subject || 'Sans sujet'}
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-sm text-muted-foreground truncate">
                      {request.from_address}
                    </span>
                    {request.attachmentCount && request.attachmentCount > 0 && (
                      <Badge variant="outline" className="text-xs px-1.5 py-0">
                        <Paperclip className="h-3 w-3 mr-1" />
                        {request.attachmentCount}
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
                    {formatDate(request.received_at)}
                  </div>
                </div>
              </div>

              {/* Extracted Info Pills */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {extractedData.company && (
                  <Badge variant="secondary" className="text-xs bg-secondary/50">
                    <User className="h-3 w-3 mr-1" />
                    {extractedData.company}
                  </Badge>
                )}
                {extractedData.cargo && (
                  <Badge variant="secondary" className="text-xs bg-secondary/50">
                    <Package className="h-3 w-3 mr-1" />
                    {extractedData.cargo.substring(0, 30)}{extractedData.cargo.length > 30 ? '...' : ''}
                  </Badge>
                )}
                {extractedData.origin && (
                  <Badge variant="secondary" className="text-xs bg-secondary/50">
                    <MapPin className="h-3 w-3 mr-1" />
                    {extractedData.origin}
                  </Badge>
                )}
                {extractedData.incoterm && (
                  <Badge variant="outline" className="text-xs border-primary/30 text-primary">
                    {extractedData.incoterm}
                  </Badge>
                )}
                {extractedData.container_type && (
                  <Badge variant="outline" className="text-xs">
                    {extractedData.container_type}
                  </Badge>
                )}
              </div>

              {/* Always-visible email snippet */}
              {cleanText && (
                <p className="text-sm text-muted-foreground mb-1 overflow-hidden text-ellipsis whitespace-nowrap">
                  {cleanText.slice(0, 120)}{cleanText.length > 120 ? '…' : ''}
                </p>
              )}

              {/* Alerts */}
              {missingFields.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-amber-500">
                  <AlertTriangle className="h-3 w-3" />
                  <span>Manquant: {missingFields.join(', ')}</span>
                </div>
              )}

              {/* Collapsible email body preview */}
              <CollapsibleContent>
                <div className="mt-3 text-sm text-muted-foreground bg-muted/30 p-3 rounded-md">
                  {cleanText
                    ? `${preview}${isTruncated ? '…' : ''}`
                    : 'Aucun contenu disponible'}
                </div>
              </CollapsibleContent>
            </div>

            {/* Right: Action & Status */}
            <div className="flex flex-col items-end gap-2 shrink-0">
              {/* Completeness indicator */}
              <div className="flex items-center gap-1.5">
                {completeness >= 80 ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : completeness >= 50 ? (
                  <HelpCircle className="h-4 w-4 text-amber-500" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                )}
                <span className={cn("text-sm font-medium", getCompletenessColor())}>
                  {completeness}%
                </span>
              </div>
              
              <Button 
                size="sm" 
                onClick={() => onProcess(request.id)}
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
