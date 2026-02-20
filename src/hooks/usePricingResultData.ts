/**
 * Phase 12: usePricingResultData hook
 * Loads the latest successful pricing run and quotation versions for a case
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface DutyBreakdownItem {
  article_index: number;
  hs_code: string;
  caf: number;
  dd_rate: number; dd_amount: number;
  surtaxe_rate: number; surtaxe_amount: number;
  rs_rate: number; rs_amount: number;
  tin_rate: number; tin_amount: number;
  tci_rate: number; tci_amount: number;
  pcs_rate: number; pcs_amount: number;
  pcc_rate: number; pcc_amount: number;
  cosec_rate: number; cosec_amount: number;
  promad_rate?: number; promad_amount?: number;
  base_tva: number;
  tva_rate: number; tva_amount: number;
  total_duties: number;
}

export interface PricingRun {
  id: string;
  run_number: number;
  status: string;
  total_ht: number | null;
  total_ttc: number | null;
  currency: string | null;
  tariff_lines: any[] | null;
  tariff_sources: any[] | null;
  outputs_json: { duty_breakdown?: DutyBreakdownItem[]; [key: string]: any } | null;
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
        .select('id, run_number, status, total_ht, total_ttc, currency, tariff_lines, tariff_sources, outputs_json, created_at, completed_at')
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
          outputs_json: (typeof data.outputs_json === 'object' && data.outputs_json !== null && !Array.isArray(data.outputs_json))
            ? data.outputs_json as PricingRun['outputs_json']
            : null,
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
