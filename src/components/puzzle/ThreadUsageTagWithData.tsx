/**
 * Phase 8.3 — Wrapper pour ThreadUsageTag avec données lazy-loaded
 * 
 * Query le quote_case et puzzle_job pour déterminer le type d'usage
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ThreadUsageTag } from './ThreadUsageTag';
import { getThreadUsageType, type ThreadUsageType } from '@/hooks/useQuoteCaseData';

interface Props {
  threadId: string;
  size?: 'sm' | 'default';
}

export function ThreadUsageTagWithData({ threadId, size = 'sm' }: Props) {
  // Query quote_case status for this thread
  const { data: quoteCase } = useQuery({
    queryKey: ['thread-quote-case-status', threadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quote_cases')
        .select('status')
        .eq('thread_id', threadId)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    staleTime: 60000, // 1 minute cache
  });

  // Query if puzzle job completed for this thread
  const { data: puzzleJob } = useQuery({
    queryKey: ['thread-puzzle-job-status', threadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('puzzle_jobs')
        .select('status')
        .eq('thread_id', threadId)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    staleTime: 60000, // 1 minute cache
  });

  const usageType = getThreadUsageType(
    quoteCase?.status || null,
    puzzleJob?.status === 'completed'
  );

  if (!usageType) {
    return null;
  }

  return <ThreadUsageTag usageType={usageType} size={size} />;
}
