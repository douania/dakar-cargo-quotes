/**
 * Phase M3.2 — Hook to load historical suggestions from pricing_runs.engine_response
 * Reads only the latest successful pricing run's engine_response for a given case.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { HistoricalSuggestions } from '@/features/quotation/types';

export function useHistoricalSuggestions(caseId: string | undefined) {
  const [suggestions, setSuggestions] = useState<HistoricalSuggestions | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    if (!caseId) {
      setSuggestions(null);
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('pricing_runs')
        .select('engine_response')
        .eq('case_id', caseId)
        .eq('status', 'success')
        .order('run_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      const response = data?.engine_response as Record<string, unknown> | null;
      const hs = response?.historical_suggestions as HistoricalSuggestions | undefined;

      if (hs && Array.isArray(hs.suggested_lines) && hs.suggested_lines.length > 0) {
        setSuggestions(hs);
      } else {
        setSuggestions(null);
      }
    } catch (err) {
      console.error('[useHistoricalSuggestions] Error:', err);
      setSuggestions(null);
    } finally {
      setIsLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    load();
  }, [load]);

  return { suggestions, isLoading, refetch: load };
}
