import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  History, 
  TrendingUp, 
  TrendingDown, 
  Minus,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Calendar,
  MapPin,
  Package,
  DollarSign
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface HistoricalRate {
  id: string;
  name: string;
  category: string;
  data: {
    service?: string;
    montant?: number;
    devise?: string;
    unit?: string;
    origine?: string;
    destination?: string;
    type_conteneur?: string;
    type_marchandise?: string;
    client?: string;
    project?: string;
  };
  source_id?: string;
  source_type?: string;
  created_at: string;
  is_validated: boolean;
  matching_criteria?: {
    origin?: string;
    destination?: string;
    container_type?: string;
    cargo_type?: string;
    service?: string;
    year?: string;
  };
}

interface GroupedHistoricalData {
  year: string;
  origin?: string;
  destination?: string;
  containerTypes: string[];
  cargoType?: string;
  client?: string;
  project?: string;
  rates: Array<{
    service: string;
    amount: number;
    currency: string;
    unit?: string;
  }>;
  sourceEmailId?: string;
  createdAt: string;
}

interface RateEvolution {
  service: string;
  oldAmount: number;
  newAmount: number;
  percentChange: number;
  period: string;
}

interface HistoricalRateRemindersProps {
  origin?: string;
  destination?: string;
  containerTypes?: string[];
  cargoType?: string;
  className?: string;
}

async function fetchHistoricalReferences(
  origin?: string,
  destination?: string,
  containerTypes?: string[],
  cargoType?: string
): Promise<{ references: GroupedHistoricalData[], evolutions: RateEvolution[] }> {
  const { data, error } = await supabase.functions.invoke('data-admin', {
    body: { 
      action: 'find_historical_references',
      data: { origin, destination, containerTypes, cargoType }
    }
  });
  
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Erreur');
  
  return {
    references: data.references || [],
    evolutions: data.evolutions || []
  };
}

export function HistoricalRateReminders({
  origin,
  destination,
  containerTypes,
  cargoType,
  className
}: HistoricalRateRemindersProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showAllRates, setShowAllRates] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['historical-references', origin, destination, containerTypes?.join(','), cargoType],
    queryFn: () => fetchHistoricalReferences(origin, destination, containerTypes, cargoType),
    enabled: !!(destination || origin),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const references = data?.references || [];
  const evolutions = data?.evolutions || [];

  const formatCurrency = (amount: number, currency: string = 'EUR') => {
    if (currency === 'EUR' || currency === '€') {
      return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
    } else if (currency === 'USD' || currency === '$') {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
    } else if (currency === 'XOF' || currency === 'FCFA') {
      return new Intl.NumberFormat('fr-FR').format(amount) + ' FCFA';
    }
    return `${amount} ${currency}`;
  };

  const formatDate = (dateStr: string) => {
    try {
      return format(new Date(dateStr), 'MMM yyyy', { locale: fr });
    } catch {
      return dateStr;
    }
  };

  const getTrendIcon = (percentChange: number) => {
    if (percentChange > 5) return <TrendingUp className="h-3 w-3 text-red-500" />;
    if (percentChange < -5) return <TrendingDown className="h-3 w-3 text-green-500" />;
    return <Minus className="h-3 w-3 text-muted-foreground" />;
  };

  const getTrendColor = (percentChange: number) => {
    if (percentChange > 5) return 'text-red-500';
    if (percentChange < -5) return 'text-green-500';
    return 'text-muted-foreground';
  };

  // Don't render if no search criteria
  if (!destination && !origin) {
    return null;
  }

  const displayedReferences = showAllRates ? references : references.slice(0, 3);

  return (
    <Card className={cn("border-blue-200/50 bg-gradient-to-br from-blue-50/30 to-background", className)}>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/20 transition-colors pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-blue-500" />
                <span>Références historiques</span>
                {references.length > 0 && (
                  <Badge variant="secondary" className="ml-2 text-xs bg-blue-100 text-blue-700">
                    {references.length}
                  </Badge>
                )}
              </div>
              {isExpanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-4">
                <div className="animate-pulse text-sm text-muted-foreground">
                  Recherche dans l'historique...
                </div>
              </div>
            ) : error ? (
              <div className="text-sm text-destructive py-2">
                Erreur de chargement des références
              </div>
            ) : references.length === 0 ? (
              <div className="text-sm text-muted-foreground py-2 text-center">
                Aucune référence historique pour cette route
              </div>
            ) : (
              <ScrollArea className="max-h-[400px]">
                <div className="space-y-3">
                  {/* Evolution Summary */}
                  {evolutions.length > 0 && (
                    <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                      <div className="flex items-center gap-2 mb-2">
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Évolution des tarifs</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {evolutions.slice(0, 4).map((evo, idx) => (
                          <div key={idx} className="flex items-center justify-between text-xs">
                            <span className="truncate">{evo.service}</span>
                            <div className={cn("flex items-center gap-1", getTrendColor(evo.percentChange))}>
                              {getTrendIcon(evo.percentChange)}
                              <span>
                                {evo.percentChange > 0 ? '+' : ''}{evo.percentChange.toFixed(0)}%
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                      {evolutions.length > 4 && (
                        <div className="text-xs text-muted-foreground mt-1">
                          +{evolutions.length - 4} autres services
                        </div>
                      )}
                    </div>
                  )}

                  {/* Historical References */}
                  {displayedReferences.map((ref, idx) => (
                    <div 
                      key={idx} 
                      className="p-3 rounded-lg border border-border/50 bg-card/50 hover:bg-card/80 transition-colors"
                    >
                      {/* Header with date and route */}
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-3.5 w-3.5 text-blue-500" />
                          <span className="text-sm font-medium">
                            {formatDate(ref.createdAt)}
                          </span>
                          {ref.year && (
                            <Badge variant="outline" className="text-xs">
                              {ref.year}
                            </Badge>
                          )}
                        </div>
                        {ref.sourceEmailId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => window.open(`/quotation/${ref.sourceEmailId}`, '_blank')}
                          >
                            <ExternalLink className="h-3 w-3 mr-1" />
                            Voir
                          </Button>
                        )}
                      </div>

                      {/* Route info */}
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                        <MapPin className="h-3 w-3" />
                        <span>
                          {ref.origin || 'Origine'} → {ref.destination || destination}
                        </span>
                        {ref.containerTypes.length > 0 && (
                          <>
                            <span className="mx-1">•</span>
                            <Package className="h-3 w-3" />
                            <span>{ref.containerTypes.join(', ')}</span>
                          </>
                        )}
                      </div>

                      {/* Client/Project info */}
                      {(ref.client || ref.project) && (
                        <div className="text-xs text-muted-foreground mb-2">
                          {ref.client && <span className="font-medium">{ref.client}</span>}
                          {ref.client && ref.project && <span> - </span>}
                          {ref.project && <span>{ref.project}</span>}
                        </div>
                      )}

                      {/* Rates */}
                      <div className="space-y-1">
                        {ref.rates.slice(0, 5).map((rate, rateIdx) => (
                          <div 
                            key={rateIdx}
                            className="flex items-center justify-between text-sm"
                          >
                            <div className="flex items-center gap-2">
                              <DollarSign className="h-3 w-3 text-green-600" />
                              <span className="text-muted-foreground">{rate.service}</span>
                            </div>
                            <span className="font-medium text-blue-600">
                              {formatCurrency(rate.amount, rate.currency)}
                              {rate.unit && (
                                <span className="text-xs text-muted-foreground ml-1">
                                  /{rate.unit}
                                </span>
                              )}
                            </span>
                          </div>
                        ))}
                        {ref.rates.length > 5 && (
                          <div className="text-xs text-muted-foreground text-center pt-1">
                            +{ref.rates.length - 5} autres postes
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Show more button */}
                  {references.length > 3 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs"
                      onClick={() => setShowAllRates(!showAllRates)}
                    >
                      {showAllRates 
                        ? 'Afficher moins' 
                        : `Voir ${references.length - 3} autres références`
                      }
                    </Button>
                  )}
                </div>
              </ScrollArea>
            )}

            {/* Info note */}
            <div className="mt-3 pt-3 border-t border-border/50">
              <p className="text-xs text-muted-foreground flex items-start gap-2">
                <span className="text-blue-500">💡</span>
                <span>
                  Ces tarifs sont <strong>informatifs</strong>. Utilisez les tarifs officiels (DPW, PAD) pour le calcul final.
                </span>
              </p>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
