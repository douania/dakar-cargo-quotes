/**
 * Hook pour gérer le cycle de vie draft/sent d'un devis
 * Phase 5D — Amendements CTO intégrés
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

export function useQuotationDraft() {
  const [currentDraft, setCurrentDraft] = useState<DraftQuotation | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  /**
   * Sauvegarder ou mettre à jour un draft
   * AMENDEMENT 2 : Idempotent par source_email_id
   */
  const saveDraft = useCallback(async (params: SaveDraftParams): Promise<DraftQuotation | null> => {
    setIsSaving(true);
    try {
      // Build DB-compatible payload (cast regulatory_info to Json)
      const dbPayload = {
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
        tariff_lines: params.tariff_lines as unknown as Json,
        total_amount: params.total_amount,
        total_currency: params.total_currency,
        source_email_id: params.source_email_id,
        regulatory_info: (params.regulatory_info ?? null) as Json,
      };

      // AMENDEMENT 2 : Vérifier s'il existe déjà un draft pour cet email
      if (params.source_email_id && !currentDraft) {
        const { data: existingDraft, error: searchError } = await supabase
          .from('quotation_history')
          .select('id, version, status, parent_quotation_id, root_quotation_id')
          .eq('source_email_id', params.source_email_id)
          .eq('status', 'draft')
          .maybeSingle();

        if (searchError) throw searchError;

        if (existingDraft) {
          // Réutiliser le draft existant
          const draft = existingDraft as unknown as DraftQuotation;
          setCurrentDraft(draft);
          // Mettre à jour le draft existant
          const { data, error } = await supabase
            .from('quotation_history')
            .update({
              ...dbPayload,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingDraft.id)
            .select('id, version, status, parent_quotation_id, root_quotation_id')
            .single();

          if (error) throw error;
          setCurrentDraft(data as unknown as DraftQuotation);
          return data as unknown as DraftQuotation;
        }
      }

      if (currentDraft) {
        // Mise à jour du draft actuel
        const { data, error } = await supabase
          .from('quotation_history')
          .update({
            ...dbPayload,
            status: 'draft',
            updated_at: new Date().toISOString(),
          })
          .eq('id', currentDraft.id)
          .select('id, version, status, parent_quotation_id, root_quotation_id')
          .single();

        if (error) throw error;
        setCurrentDraft(data as unknown as DraftQuotation);
        return data as unknown as DraftQuotation;
      } else {
        // Nouveau draft (v1)
        const { data, error } = await supabase
          .from('quotation_history')
          .insert({
            ...dbPayload,
            version: 1,
            status: 'draft',
            root_quotation_id: null,
            parent_quotation_id: null,
          } as any)
          .select('id, version, status, parent_quotation_id, root_quotation_id')
          .single();

        if (error) throw error;

        // Pour v1, root_quotation_id = id (self-reference)
        const { error: updateError } = await supabase
          .from('quotation_history')
          .update({ root_quotation_id: data.id } as any)
          .eq('id', data.id);

        if (updateError) throw updateError;

        const draft = { ...data, root_quotation_id: data.id } as unknown as DraftQuotation;
        setCurrentDraft(draft);
        return draft;
      }
    } catch (error) {
      console.error('Error saving draft:', error);
      toast.error('Erreur sauvegarde brouillon');
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
   * Créer une nouvelle version (révision)
   * AMENDEMENT 1 : root_quotation_id conservé
   */
  const createRevision = useCallback(async (params: SaveDraftParams): Promise<DraftQuotation | null> => {
    if (!currentDraft) {
      return saveDraft(params);
    }

    setIsSaving(true);
    try {
      // AMENDEMENT 1 : root = root du parent OU id du parent si v1
      const rootId = currentDraft.root_quotation_id ?? currentDraft.id;

      const dbPayload = {
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
        tariff_lines: params.tariff_lines as unknown as Json,
        total_amount: params.total_amount,
        total_currency: params.total_currency,
        source_email_id: params.source_email_id,
        regulatory_info: (params.regulatory_info ?? null) as Json,
      };

      const { data, error } = await supabase
        .from('quotation_history')
        .insert({
          ...dbPayload,
          version: currentDraft.version + 1,
          parent_quotation_id: currentDraft.id,
          root_quotation_id: rootId,
          status: 'draft',
        } as any)
        .select('id, version, status, parent_quotation_id, root_quotation_id')
        .single();

      if (error) throw error;
      setCurrentDraft(data as unknown as DraftQuotation);
      toast.success(`Révision v${(data as any).version} créée`);
      return data as unknown as DraftQuotation;
    } catch (error) {
      console.error('Error creating revision:', error);
      toast.error('Erreur création révision');
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
