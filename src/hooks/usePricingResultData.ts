/**
 * Phase 12: usePricingResultData hook
 * Loads the latest successful pricing run and quotation versions for a case
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface PricingRun {
  id: string;
  run_number: number;
  status: string;
  total_ht: number | null;
  total_ttc: number | null;
  currency: string | null;
  tariff_lines: any[] | null;
  tariff_sources: any[] | null;
  created_at: string | null;
  completed_at: string | null;
}

export interface QuotationVersion {
  id: string;
  version_number: number;
  status: string;
  is_selected: boolean;
  snapshot: any;
  created_at: string;
  created_by: string | null;
}

interface UsePricingResultDataReturn {
  pricingRun: PricingRun | null;
  versions: QuotationVersion[];
  isLoading: boolean;
  error: string | null;
  refetchVersions: () => Promise<void>;
  refetchPricingRun: () => Promise<void>;
}

export function usePricingResultData(caseId: string | undefined): UsePricingResultDataReturn {
  const [pricingRun, setPricingRun] = useState<PricingRun | null>(null);
  const [versions, setVersions] = useState<QuotationVersion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPricingRun = useCallback(async () => {
    if (!caseId) return;

    try {
      const { data, error: fetchError } = await supabase
        .from('pricing_runs')
        .select('id, run_number, status, total_ht, total_ttc, currency, tariff_lines, tariff_sources, created_at, completed_at')
        .eq('case_id', caseId)
        .eq('status', 'success')
        .order('run_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fetchError) throw fetchError;
      if (data) {
        setPricingRun({
          ...data,
          tariff_lines: Array.isArray(data.tariff_lines) ? data.tariff_lines : [],
          tariff_sources: Array.isArray(data.tariff_sources) ? data.tariff_sources : [],
        });
      } else {
        setPricingRun(null);
      }
    } catch (err) {
      console.error('Error loading pricing run:', err);
      setError(err instanceof Error ? err.message : 'Failed to load pricing run');
    }
  }, [caseId]);

  const loadVersions = useCallback(async () => {
    if (!caseId) return;

    try {
      const { data, error: fetchError } = await supabase
        .from('quotation_versions')
        .select('id, version_number, status, is_selected, snapshot, created_at, created_by')
        .eq('case_id', caseId)
        .order('version_number', { ascending: false });

      if (fetchError) throw fetchError;
      setVersions(data || []);
    } catch (err) {
      console.error('Error loading versions:', err);
      setError(err instanceof Error ? err.message : 'Failed to load versions');
    }
  }, [caseId]);

  const loadData = useCallback(async () => {
    if (!caseId) {
      setPricingRun(null);
      setVersions([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await Promise.all([loadPricingRun(), loadVersions()]);
    } finally {
      setIsLoading(false);
    }
  }, [caseId, loadPricingRun, loadVersions]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const refetchVersions = useCallback(async () => {
    await loadVersions();
  }, [loadVersions]);

  const refetchPricingRun = useCallback(async () => {
    await loadPricingRun();
  }, [loadPricingRun]);

  return {
    pricingRun,
    versions,
    isLoading,
    error,
    refetchVersions,
    refetchPricingRun,
  };
}
