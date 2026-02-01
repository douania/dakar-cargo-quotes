/**
 * Hook pour gérer le cycle de vie draft/sent d'un devis
 * Phase 5D — Amendements CTO intégrés
 * Phase 6B — Edge Function pour bypass RLS + gestion erreurs explicite
 */
import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { QuotationStatus } from '@/features/quotation/domain/types';
import type { Json } from '@/integrations/supabase/types';

export interface DraftQuotation {
  id: string;
  version: number;
  status: QuotationStatus;
  parent_quotation_id: string | null;
  root_quotation_id: string | null;
}

interface SaveDraftParams {
  route_origin?: string | null;
  route_port: string;
  route_destination: string;
  cargo_type: string;
  container_types?: string[];
  client_name?: string | null;
  client_company?: string | null;
  partner_company?: string | null;
  project_name?: string | null;
  incoterm?: string | null;
  tariff_lines: Array<{
    service: string;
    description?: string;
    amount: number;
    currency: string;
    unit?: string;
  }>;
  total_amount: number;
  total_currency: string;
  source_email_id?: string | null;
  regulatory_info?: Record<string, unknown> | null;
}

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-quotation-draft`;
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Helper to call Edge Function with timeout
 */
async function callEdgeFunction(
  payload: Record<string, unknown>,
  accessToken: string
): Promise<{ success: boolean; draft?: DraftQuotation; action?: string; error?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || `HTTP ${response.status}`);
    }

    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Délai dépassé, veuillez réessayer');
    }
    throw error;
  }
}

export function useQuotationDraft() {
  const [currentDraft, setCurrentDraft] = useState<DraftQuotation | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  /**
   * Sauvegarder ou mettre à jour un draft via Edge Function
   */
  const saveDraft = useCallback(async (params: SaveDraftParams): Promise<DraftQuotation | null> => {
    setIsSaving(true);
    try {
      // Vérifier session active
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError || !session) {
        toast.error('Session expirée, veuillez vous reconnecter');
        return null;
      }

      // Build payload
      const payload = {
        route_origin: params.route_origin,
        route_port: params.route_port,
        route_destination: params.route_destination,
        cargo_type: params.cargo_type,
        container_types: params.container_types,
        client_name: params.client_name,
        client_company: params.client_company,
        partner_company: params.partner_company,
        project_name: params.project_name,
        incoterm: params.incoterm,
        tariff_lines: params.tariff_lines,
        total_amount: params.total_amount,
        total_currency: params.total_currency,
        source_email_id: params.source_email_id,
        regulatory_info: params.regulatory_info ?? null,
      };

      // Si on a déjà un draft, on fait une UPDATE directe (pas bloquée par RLS)
      if (currentDraft) {
        const { data, error } = await supabase
          .from('quotation_history')
          .update({
            ...payload,
            tariff_lines: payload.tariff_lines as unknown as Json,
            regulatory_info: (payload.regulatory_info ?? null) as Json,
            status: 'draft',
            updated_at: new Date().toISOString(),
          })
          .eq('id', currentDraft.id)
          .select('id, version, status, parent_quotation_id, root_quotation_id')
          .single();

        if (error) throw error;
        setCurrentDraft(data as unknown as DraftQuotation);
        return data as unknown as DraftQuotation;
      }

      // Nouveau draft → Edge Function (bypass RLS INSERT)
      const result = await callEdgeFunction(payload, session.access_token);

      if (!result.success || !result.draft) {
        throw new Error(result.error || 'Échec création brouillon');
      }

      setCurrentDraft(result.draft);
      return result.draft;

    } catch (error) {
      console.error('Error saving draft:', error);
      const message = error instanceof Error ? error.message : 'Erreur sauvegarde brouillon';
      toast.error(message);
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [currentDraft]);

  /**
   * Marquer comme envoyé (transition draft → sent)
   */
  const markAsSent = useCallback(async (): Promise<boolean> => {
    if (!currentDraft) {
      toast.error('Aucun brouillon à envoyer');
      return false;
    }

    if (currentDraft.status !== 'draft') {
      toast.error('Ce devis a déjà été envoyé');
      return false;
    }

    try {
      const { error } = await supabase
        .from('quotation_history')
        .update({ status: 'sent', updated_at: new Date().toISOString() } as any)
        .eq('id', currentDraft.id);

      if (error) throw error;

      setCurrentDraft({ ...currentDraft, status: 'sent' });
      toast.success('Devis marqué comme envoyé');
      return true;
    } catch (error) {
      console.error('Error marking as sent:', error);
      toast.error('Erreur mise à jour statut');
      return false;
    }
  }, [currentDraft]);

  /**
   * Créer une nouvelle version (révision) via Edge Function
   */
  const createRevision = useCallback(async (params: SaveDraftParams): Promise<DraftQuotation | null> => {
    if (!currentDraft) {
      return saveDraft(params);
    }

    setIsSaving(true);
    try {
      // Vérifier session active
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError || !session) {
        toast.error('Session expirée, veuillez vous reconnecter');
        return null;
      }

      // Build payload with revision info
      const payload = {
        route_origin: params.route_origin,
        route_port: params.route_port,
        route_destination: params.route_destination,
        cargo_type: params.cargo_type,
        container_types: params.container_types,
        client_name: params.client_name,
        client_company: params.client_company,
        partner_company: params.partner_company,
        project_name: params.project_name,
        incoterm: params.incoterm,
        tariff_lines: params.tariff_lines,
        total_amount: params.total_amount,
        total_currency: params.total_currency,
        source_email_id: params.source_email_id,
        regulatory_info: params.regulatory_info ?? null,
        // Revision-specific fields
        action: 'create_revision',
        parent_quotation_id: currentDraft.id,
        current_version: currentDraft.version,
      };

      const result = await callEdgeFunction(payload, session.access_token);

      if (!result.success || !result.draft) {
        throw new Error(result.error || 'Échec création révision');
      }

      setCurrentDraft(result.draft);
      toast.success(`Révision v${result.draft.version} créée`);
      return result.draft;

    } catch (error) {
      console.error('Error creating revision:', error);
      const message = error instanceof Error ? error.message : 'Erreur création révision';
      toast.error(message);
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [currentDraft, saveDraft]);

  /**
   * Réinitialiser le draft courant
   */
  const resetDraft = useCallback(() => {
    setCurrentDraft(null);
  }, []);

  return {
    currentDraft,
    isSaving,
    saveDraft,
    markAsSent,
    createRevision,
    resetDraft,
    setCurrentDraft,
  };
}
