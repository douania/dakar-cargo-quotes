import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface TariffLine {
  service: string;
  description?: string;
  amount: number;
  currency: string;
  unit?: string;
}

interface QuotationHistory {
  id: string;
  route_origin: string | null;
  route_port: string;
  route_destination: string;
  route_hash: string | null;
  cargo_type: string;
  container_types: string[] | null;
  client_name: string | null;
  client_company: string | null;
  partner_company: string | null;
  project_name: string | null;
  incoterm: string | null;
  tariff_lines: TariffLine[];
  total_amount: number | null;
  total_currency: string | null;
  margin_percent: number | null;
  created_at: string;
}

interface SimilarQuotation {
  quotation: QuotationHistory;
  relevanceScore: number;
  matchReasons: string[];
}

export function useQuotationHistory() {
  return useQuery({
    queryKey: ['quotation-history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quotation_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (error) throw error;
      
      return (data || []).map(item => ({
        ...item,
        tariff_lines: (item.tariff_lines as any) || [],
      })) as QuotationHistory[];
    },
  });
}

// --- Phase S1: Transport mode categorizer for hard exclusion ---
const modeCategory = (mode: string | undefined | null): string | null => {
  if (!mode) return null;
  const m = mode.toUpperCase();
  if (m.includes('AIR')) return 'AIR';
  if (m.includes('SEA') || m.includes('FCL') || m.includes('LCL') || m.includes('CONTAINER') || m.includes('BREAKBULK') || m.includes('BREAK')) return 'SEA';
  if (m.includes('ROAD') || m.includes('TRUCK')) return 'ROAD';
  return null;
};

export function useSimilarQuotations(
  destination: string | undefined,
  cargoType: string | undefined,
  clientCompany: string | undefined,
  transportMode?: string
) {
  const { data: allQuotations } = useQuotationHistory();
  
  return useQuery({
    queryKey: ['similar-quotations', destination, cargoType, clientCompany],
    queryFn: async (): Promise<SimilarQuotation[]> => {
      if (!allQuotations || !destination) return [];
      
      const results: SimilarQuotation[] = [];
      const destinationLower = destination.toLowerCase();
      const cargoLower = cargoType?.toLowerCase() || '';
      const clientLower = clientCompany?.toLowerCase() || '';
      
      const inputModeCategory = modeCategory(transportMode);

      for (const quotation of allQuotations) {
        // --- Phase S1: Hard exclusion filters ---
        // Hard filter 1: incompatible transport mode -> skip
        if (inputModeCategory) {
          const quotModeCategory = modeCategory(quotation.cargo_type);
          if (quotModeCategory && quotModeCategory !== inputModeCategory) {
            continue;
          }
        }

        let score = 0;
        const matchReasons: string[] = [];
        
        // Check destination match
        const quotDestLower = quotation.route_destination.toLowerCase();
        if (quotDestLower === destinationLower) {
          score += 50;
          matchReasons.push('Même destination');
        } else if (quotDestLower.includes(destinationLower) || destinationLower.includes(quotDestLower)) {
          score += 30;
          matchReasons.push('Destination similaire');
        }
        
        // Check cargo type match
        if (cargoLower && quotation.cargo_type.toLowerCase() === cargoLower) {
          score += 30;
          matchReasons.push('Même type de cargo');
        }
        
        // Check client match
        if (clientLower && quotation.client_company?.toLowerCase() === clientLower) {
          score += 20;
          matchReasons.push('Même client');
        } else if (clientLower && quotation.client_company?.toLowerCase().includes(clientLower)) {
          score += 10;
          matchReasons.push('Client similaire');
        }
        
        // Recency bonus - quotations from last 30 days get a boost
        const daysSinceCreation = (Date.now() - new Date(quotation.created_at).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceCreation < 30) {
          score += 10;
          matchReasons.push('Récent');
        }
        
        // Only include if there's some relevance
        if (score >= 30 && quotation.tariff_lines.length > 0) {
          results.push({
            quotation,
            relevanceScore: score,
            matchReasons,
          });
        }
      }
      
      // Sort by relevance score descending
      return results.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, 5);
    },
    enabled: !!allQuotations && !!destination,
  });
}

// Helper to calculate average tariff for a service across quotations
export function calculateAverageTariff(
  quotations: QuotationHistory[],
  serviceName: string
): { average: number; min: number; max: number; currency: string; count: number } | null {
  const matchingLines: TariffLine[] = [];
  const serviceNameLower = serviceName.toLowerCase();
  
  for (const q of quotations) {
    for (const line of q.tariff_lines) {
      if (line.service.toLowerCase().includes(serviceNameLower) ||
          serviceNameLower.includes(line.service.toLowerCase())) {
        matchingLines.push(line);
      }
    }
  }
  
  if (matchingLines.length === 0) return null;
  
  // Group by currency
  const fcfaLines = matchingLines.filter(l => l.currency === 'FCFA');
  const eurLines = matchingLines.filter(l => l.currency === 'EUR');
  
  // Use the most common currency
  const lines = fcfaLines.length >= eurLines.length ? fcfaLines : eurLines;
  if (lines.length === 0) return null;
  
  const amounts = lines.map(l => l.amount);
  const average = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  
  return {
    average: Math.round(average),
    min: Math.min(...amounts),
    max: Math.max(...amounts),
    currency: lines[0].currency,
    count: lines.length,
  };
}

// Get suggested tariffs based on historical data
export function getSuggestedTariffs(
  similarQuotations: SimilarQuotation[],
  serviceNames: string[]
): Map<string, { suggested: number; currency: string; source: string; confidence: number }> {
  const suggestions = new Map();
  
  if (similarQuotations.length === 0) return suggestions;
  
  // Get all quotations sorted by relevance
  const quotations = similarQuotations.map(sq => sq.quotation);
  
  for (const serviceName of serviceNames) {
    const serviceNameLower = serviceName.toLowerCase();
    
    // Find matching tariffs from most relevant quotations
    for (const sq of similarQuotations) {
      for (const line of sq.quotation.tariff_lines) {
        if (line.service.toLowerCase().includes(serviceNameLower) ||
            serviceNameLower.includes(line.service.toLowerCase())) {
          
          suggestions.set(serviceName, {
            suggested: line.amount,
            currency: line.currency,
            source: `Cotation ${sq.quotation.route_destination} (${new Date(sq.quotation.created_at).toLocaleDateString('fr-FR')})`,
            confidence: sq.relevanceScore / 100,
          });
          break; // Use the most relevant match
        }
      }
      if (suggestions.has(serviceName)) break;
    }
    
    // If no direct match, try calculating average
    if (!suggestions.has(serviceName)) {
      const avg = calculateAverageTariff(quotations, serviceName);
      if (avg) {
        suggestions.set(serviceName, {
          suggested: avg.average,
          currency: avg.currency,
          source: `Moyenne de ${avg.count} cotations similaires`,
          confidence: 0.6,
        });
      }
    }
  }
  
  return suggestions;
}
