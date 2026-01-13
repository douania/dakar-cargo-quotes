import { useState } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  History, 
  TrendingUp, 
  MapPin, 
  Package, 
  Building2,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Lightbulb,
  ArrowRight,
  Sparkles,
  Brain,
  Loader2
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSimilarQuotations, getSuggestedTariffs } from '@/hooks/useQuotationHistory';
import { useTariffSuggestions } from '@/hooks/useTariffSuggestions';
import { cn } from '@/lib/utils';

interface TariffLine {
  service: string;
  amount: number;
  currency: string;
  unit?: string;
}

interface SimilarQuotationsPanelProps {
  destination?: string;
  cargoType?: string;
  clientCompany?: string;
  requestedServices?: string[];
  onApplyTariff?: (service: string, amount: number, currency: string) => void;
}

export function SimilarQuotationsPanel({
  destination,
  cargoType,
  clientCompany,
  requestedServices = [],
  onApplyTariff,
}: SimilarQuotationsPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [showAllLines, setShowAllLines] = useState<string | null>(null);
  
  const { data: similarQuotations, isLoading: isLoadingQuotations } = useSimilarQuotations(
    destination,
    cargoType,
    clientCompany
  );
  
  // Fallback to learned_knowledge tariffs
  const { data: knowledgeTariffs, isLoading: isLoadingKnowledge } = useTariffSuggestions(
    destination,
    cargoType
  );
  
  const isLoading = isLoadingQuotations || isLoadingKnowledge;
  const hasQuotations = similarQuotations && similarQuotations.length > 0;
  const hasTariffs = knowledgeTariffs && knowledgeTariffs.length > 0;
  
  // Don't render if no data available
  if (!isLoading && !hasQuotations && !hasTariffs) {
    return null;
  }
  
  // Get suggested tariffs for requested services (from quotation history)
  const suggestedTariffs = hasQuotations ? getSuggestedTariffs(similarQuotations, requestedServices) : new Map();
  
  const formatCurrency = (amount: number, currency: string) => {
    // Clean currency code - extract only the currency part
    const cleanCurrency = currency?.split(/[\s(]/)[0]?.toUpperCase() || 'FCFA';
    
    if (cleanCurrency === 'FCFA' || cleanCurrency === 'XOF') {
      return new Intl.NumberFormat('fr-FR').format(amount) + ' FCFA';
    }
    
    try {
      return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cleanCurrency }).format(amount);
    } catch {
      // Fallback if currency code is still invalid
      return new Intl.NumberFormat('fr-FR').format(amount) + ` ${cleanCurrency}`;
    }
  };
  
  const formatDate = (dateStr: string) => {
    try {
      return format(new Date(dateStr), 'dd MMM yyyy', { locale: fr });
    } catch {
      return dateStr;
    }
  };

  const totalCount = (similarQuotations?.length || 0) + (knowledgeTariffs?.length || 0);
  
  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CardHeader className="pb-2">
          <CollapsibleTrigger asChild>
            <div className="flex items-center justify-between cursor-pointer">
              <CardTitle className="text-base flex items-center gap-2 text-amber-600">
                <Sparkles className="h-4 w-4" />
                Suggestions tarifaires {isLoading ? '' : `(${totalCount})`}
                {isLoading && <Loader2 className="h-3 w-3 animate-spin" />}
              </CardTitle>
              {expanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </CollapsibleTrigger>
          <CardDescription>
            Tarifs basés sur l'historique et les connaissances
          </CardDescription>
        </CardHeader>
        
        <CollapsibleContent>
          <CardContent className="space-y-4">
            {/* Knowledge-based tariff suggestions */}
            {hasTariffs && (
              <div className="space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Brain className="h-4 w-4 text-primary" />
                  Tarifs des connaissances
                </p>
                <div className="grid gap-2">
                  {knowledgeTariffs.slice(0, 5).map((tariff) => (
                    <div 
                      key={tariff.sourceId}
                      className="flex items-center justify-between p-2 rounded-lg bg-background border"
                    >
                      <div>
                        <p className="text-sm font-medium">{tariff.service}</p>
                        <p className="text-xs text-muted-foreground">
                          {tariff.source} {tariff.isValidated && '✓'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="font-mono">
                          {formatCurrency(tariff.amount, tariff.currency)}
                        </Badge>
                        <Badge 
                          variant="outline" 
                          className={cn(
                            "text-xs",
                            tariff.confidence > 0.7 
                              ? "border-green-500/50 text-green-600" 
                              : "border-amber-500/50 text-amber-600"
                          )}
                        >
                          {Math.round(tariff.confidence * 100)}%
                        </Badge>
                        {onApplyTariff && (
                          <Button 
                            size="sm" 
                            variant="ghost"
                            className="h-6 px-2"
                            onClick={() => onApplyTariff(tariff.service, tariff.amount, tariff.currency)}
                          >
                            <ArrowRight className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {hasTariffs && hasQuotations && <Separator />}

            {/* Suggested tariffs for requested services */}
            {suggestedTariffs.size > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-amber-500" />
                  Tarifs suggérés (historique)
                </p>
                <div className="grid gap-2">
                  {Array.from(suggestedTariffs.entries()).map(([service, data]) => (
                    <div 
                      key={service}
                      className="flex items-center justify-between p-2 rounded-lg bg-background border"
                    >
                      <div>
                        <p className="text-sm font-medium">{service}</p>
                        <p className="text-xs text-muted-foreground">{data.source}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="font-mono">
                          {formatCurrency(data.suggested, data.currency)}
                        </Badge>
                        <Badge 
                          variant="outline" 
                          className={cn(
                            "text-xs",
                            data.confidence > 0.7 
                              ? "border-green-500/50 text-green-600" 
                              : "border-amber-500/50 text-amber-600"
                          )}
                        >
                          {Math.round(data.confidence * 100)}%
                        </Badge>
                        {onApplyTariff && (
                          <Button 
                            size="sm" 
                            variant="ghost"
                            className="h-6 px-2"
                            onClick={() => onApplyTariff(service, data.suggested, data.currency)}
                          >
                            <ArrowRight className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            <Separator />
            
            {/* Similar quotations list */}
            {hasQuotations && (
              <ScrollArea className="max-h-[400px]">
                <div className="space-y-3">
                  {similarQuotations.map((sq) => (
                    <div 
                      key={sq.quotation.id}
                      className="p-3 rounded-lg border bg-background"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs gap-1">
                            <MapPin className="h-3 w-3" />
                            {sq.quotation.route_destination}
                          </Badge>
                          <Badge variant="secondary" className="text-xs gap-1">
                            <Package className="h-3 w-3" />
                            {sq.quotation.cargo_type}
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(sq.quotation.created_at)}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-2 mb-2 text-sm">
                        {sq.quotation.client_company && (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Building2 className="h-3 w-3" />
                            {sq.quotation.client_company}
                          </span>
                        )}
                        {sq.quotation.incoterm && (
                          <Badge variant="outline" className="text-xs">
                            {sq.quotation.incoterm}
                          </Badge>
                        )}
                      </div>
                      
                      {/* Match reasons */}
                      <div className="flex flex-wrap gap-1 mb-2">
                        {sq.matchReasons.map((reason, i) => (
                          <Badge 
                            key={i} 
                            variant="outline" 
                            className="text-xs bg-amber-500/10 border-amber-500/30"
                          >
                            {reason}
                          </Badge>
                        ))}
                      </div>
                      
                      {/* Tariff lines preview */}
                      {sq.quotation.tariff_lines && sq.quotation.tariff_lines.length > 0 && (
                        <Collapsible 
                          open={showAllLines === sq.quotation.id}
                          onOpenChange={(open) => setShowAllLines(open ? sq.quotation.id : null)}
                        >
                          <div className="space-y-1 mt-2">
                            {sq.quotation.tariff_lines.slice(0, 3).map((line, i) => (
                              <div 
                                key={i}
                                className="flex items-center justify-between text-xs"
                              >
                                <span className="text-muted-foreground truncate flex-1">
                                  {line.service}
                                </span>
                                <span className="font-mono ml-2">
                                  {formatCurrency(line.amount, line.currency)}
                                </span>
                              </div>
                            ))}
                            
                            <CollapsibleContent>
                              {sq.quotation.tariff_lines.slice(3).map((line, i) => (
                                <div 
                                  key={i + 3}
                                  className="flex items-center justify-between text-xs"
                                >
                                  <span className="text-muted-foreground truncate flex-1">
                                    {line.service}
                                  </span>
                                  <span className="font-mono ml-2">
                                    {formatCurrency(line.amount, line.currency)}
                                  </span>
                                </div>
                              ))}
                            </CollapsibleContent>
                            
                            {sq.quotation.tariff_lines.length > 3 && (
                              <CollapsibleTrigger asChild>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-6 w-full text-xs text-muted-foreground"
                                >
                                  {showAllLines === sq.quotation.id ? (
                                    <>Réduire <ChevronUp className="h-3 w-3 ml-1" /></>
                                  ) : (
                                    <>+{sq.quotation.tariff_lines.length - 3} lignes <ChevronDown className="h-3 w-3 ml-1" /></>
                                  )}
                                </Button>
                              </CollapsibleTrigger>
                            )}
                          </div>
                        </Collapsible>
                      )}
                      
                      {/* Total */}
                      {sq.quotation.total_amount && (
                        <div className="flex items-center justify-between mt-2 pt-2 border-t text-sm">
                          <span className="font-medium">Total</span>
                          <span className="font-mono font-bold">
                            {formatCurrency(sq.quotation.total_amount, sq.quotation.total_currency || 'FCFA')}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
