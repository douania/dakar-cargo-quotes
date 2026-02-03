/**
 * Hook Phase 8 — Récupération du quote_case et ses gaps bloquants
 * 
 * Lecture seule pour affichage dans BlockingGapsPanel
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface BlockingGap {
  id: string;
  gap_key: string;
  gap_category: string;
  question_fr: string | null;
  is_blocking: boolean;
  status: string;
  created_at: string;
}

export interface QuoteCaseData {
  id: string;
  thread_id: string;
  status: string;
  request_type: string | null;
  priority: string | null;
  puzzle_completeness: number | null;
  created_at: string;
  updated_at: string;
}

export interface QuoteCaseWithGaps {
  quoteCase: QuoteCaseData | null;
  blockingGaps: BlockingGap[];
  allGaps: BlockingGap[];
  isLoading: boolean;
  error: Error | null;
}

export function useQuoteCaseData(threadId: string | undefined): QuoteCaseWithGaps {
  // Query le quote_case associé au thread
  const { data: quoteCase, isLoading: isLoadingCase, error: errorCase } = useQuery({
    queryKey: ['quote-case', threadId],
    queryFn: async () => {
      if (!threadId) return null;
      
      const { data, error } = await supabase
        .from('quote_cases')
        .select('id, thread_id, status, request_type, priority, puzzle_completeness, created_at, updated_at')
        .eq('thread_id', threadId)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    enabled: !!threadId,
    staleTime: 30000,
  });

  // Query les gaps du quote_case
  const { data: gaps, isLoading: isLoadingGaps, error: errorGaps } = useQuery({
    queryKey: ['quote-gaps', quoteCase?.id],
    queryFn: async () => {
      if (!quoteCase?.id) return [];
      
      const { data, error } = await supabase
        .from('quote_gaps')
        .select('id, gap_key, gap_category, question_fr, is_blocking, status, created_at')
        .eq('case_id', quoteCase.id)
        .order('is_blocking', { ascending: false })
        .order('created_at', { ascending: true });
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!quoteCase?.id,
    staleTime: 30000,
  });

  const blockingGaps = (gaps || []).filter(g => g.is_blocking && g.status === 'open');

  return {
    quoteCase: quoteCase || null,
    blockingGaps,
    allGaps: gaps || [],
    isLoading: isLoadingCase || isLoadingGaps,
    error: errorCase || errorGaps || null,
  };
}

/**
 * Détermine le tag d'usage d'un thread
 * - Apprentissage : puzzle complété, pas de quote_case actif
 * - Cotation active : quote_case en cours de traitement
 * - Historique : quote_case terminé (SENT, ARCHIVED)
 */
export type ThreadUsageType = 'apprentissage' | 'cotation_active' | 'historique' | null;

const ACTIVE_STATUSES = [
  'NEW_THREAD', 'RFQ_DETECTED', 'FACTS_PARTIAL', 'NEED_INFO',
  'READY_TO_PRICE', 'PRICING_RUNNING', 'PRICED_DRAFT', 'HUMAN_REVIEW'
];

const ARCHIVED_STATUSES = ['SENT', 'ARCHIVED'];

export function getThreadUsageType(
  quoteCaseStatus: string | null | undefined,
  hasPuzzleCompleted: boolean
): ThreadUsageType {
  if (quoteCaseStatus) {
    if (ARCHIVED_STATUSES.includes(quoteCaseStatus)) {
      return 'historique';
    }
    if (ACTIVE_STATUSES.includes(quoteCaseStatus)) {
      return 'cotation_active';
    }
  }
  
  if (hasPuzzleCompleted) {
    return 'apprentissage';
  }
  
  return null;
}
