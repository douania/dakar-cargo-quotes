import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface TariffKnowledge {
  id: string;
  name: string;
  description: string;
  data: {
    montant?: number;
    devise?: string;
    unit?: string;
    service?: string;
    destination?: string;
    type_transport?: string;
    origin?: string;
    [key: string]: unknown;
  };
  category: string;
  confidence: number;
  is_validated: boolean;
  source_type: string;
}

interface TariffSuggestion {
  service: string;
  amount: number;
  currency: string;
  unit?: string;
  confidence: number;
  source: string;
  sourceId: string;
  isValidated: boolean;
}

export function useTariffSuggestions(
  destination?: string,
  cargoType?: string,
  service?: string
) {
  return useQuery({
    queryKey: ['tariff-suggestions', destination, cargoType, service],
    queryFn: async (): Promise<TariffSuggestion[]> => {
      // Search for tariffs in learned_knowledge
      const { data, error } = await supabase.functions.invoke('data-admin', {
        body: { 
          action: 'search_tariffs', 
          data: { destination, cargoType, service } 
        }
      });

      if (error) {
        console.error('Error fetching tariff suggestions:', error);
        return [];
      }

      if (!data?.success || !data?.tariffs) {
        return [];
      }

      return data.tariffs as TariffSuggestion[];
    },
    enabled: !!(destination || cargoType || service),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useKnowledgeSearch(query: string, categories?: string[]) {
  return useQuery({
    queryKey: ['knowledge-search', query, categories],
    queryFn: async () => {
      if (!query || query.length < 2) return [];

      const { data, error } = await supabase.functions.invoke('data-admin', {
        body: { 
          action: 'search', 
          data: { query, categories } 
        }
      });

      if (error) {
        console.error('Error searching knowledge:', error);
        return [];
      }

      return data?.results || [];
    },
    enabled: query.length >= 2,
    staleTime: 30 * 1000, // 30 seconds
  });
}

export function usePopulateQuotationHistory() {
  return async () => {
    const { data, error } = await supabase.functions.invoke('data-admin', {
      body: { action: 'populate_quotation_history' }
    });

    if (error) throw error;
    return data;
  };
}

export function useAnalyzeAllExcel() {
  return async () => {
    const { data, error } = await supabase.functions.invoke('data-admin', {
      body: { action: 'analyze_all_excel' }
    });

    if (error) throw error;
    return data;
  };
}

// Search for local transport rates
export function useTransportRates(destination?: string, containerType?: string, cargoCategory?: string) {
  return useQuery({
    queryKey: ['transport-rates', destination, containerType, cargoCategory],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('data-admin', {
        body: { 
          action: 'get_transport_rates', 
          data: { destination, containerType, cargoCategory } 
        }
      });

      if (error) {
        console.error('Error fetching transport rates:', error);
        return [];
      }

      return data?.rates || [];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Search for a specific transport rate for quotation
export function useSearchTransportRate(destination?: string, containerType?: string, cargoCategory?: string) {
  return useQuery({
    queryKey: ['transport-rate-search', destination, containerType, cargoCategory],
    queryFn: async () => {
      if (!destination) return null;
      
      const { data, error } = await supabase.functions.invoke('data-admin', {
        body: { 
          action: 'search_transport_rate', 
          data: { destination, containerType, cargoCategory } 
        }
      });

      if (error) {
        console.error('Error searching transport rate:', error);
        return null;
      }

      return data?.rate || null;
    },
    enabled: !!destination,
    staleTime: 5 * 60 * 1000,
  });
}

// Force re-analyze a specific attachment
export function useReanalyzeAttachment() {
  return async (attachmentId: string) => {
    const { data, error } = await supabase.functions.invoke('analyze-attachments', {
      body: { attachmentId }
    });

    if (error) throw error;
    return data;
  };
}
