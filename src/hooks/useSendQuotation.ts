/**
 * Phase 19A: Hook for sending a quotation
 * 
 * Pattern: useQuery (load data) + useMutation (send action)
 * CTO corrections: C1-A (caseId keys), C1-B (canSend with FSM), C2 (no thread_ref)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface SendQuotationData {
  ownerDraft: {
    id: string;
    subject: string;
    to_addresses: string[];
    status: string | null;
    sent_at: string | null;
    quotation_version_id: string | null;
  } | null;
  selectedVersion: {
    id: string;
    version_number: number;
    status: string;
    snapshot: any;
  } | null;
  caseStatus: string | null;
}

export function useSendQuotation(caseId: string | undefined) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<SendQuotationData>({
    queryKey: ['send-quotation-data', caseId],
    enabled: !!caseId,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Parallel fetches: draft, version, case status
      const [draftResult, versionResult, caseResult] = await Promise.all([
        // C2: minimal filter - created_by + status, no thread_ref dependency
        supabase
          .from('email_drafts')
          .select('id, subject, to_addresses, status, sent_at, quotation_version_id')
          .eq('created_by', user.id)
          .in('status', ['draft', 'sent'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),

        supabase
          .from('quotation_versions')
          .select('id, version_number, status, snapshot')
          .eq('case_id', caseId!)
          .eq('is_selected', true)
          .limit(1)
          .maybeSingle(),

        // CTO micro-correction: fetch case status
        supabase
          .from('quote_cases')
          .select('status')
          .eq('id', caseId!)
          .maybeSingle(),
      ]);

      return {
        ownerDraft: draftResult.data ?? null,
        selectedVersion: versionResult.data ?? null,
        caseStatus: caseResult.data?.status ?? null,
      };
    },
  });

  const ownerDraft = data?.ownerDraft ?? null;
  const selectedVersion = data?.selectedVersion ?? null;
  const caseStatus = data?.caseStatus ?? null;

  // C1-B: strict canSend with FSM guard
  const canSend = !!ownerDraft
    && !!selectedVersion
    && ownerDraft.status !== 'sent'
    && caseStatus === 'QUOTED_VERSIONED';

  const isSent = ownerDraft?.status === 'sent' || caseStatus === 'SENT';
  const sentAt = ownerDraft?.sent_at ?? null;

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!caseId || !ownerDraft || !selectedVersion) {
        throw new Error('Missing required data for sending');
      }

      const { data, error } = await supabase.functions.invoke('send-quotation', {
        body: {
          case_id: caseId,
          version_id: selectedVersion.id,
          draft_id: ownerDraft.id,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Send failed');

      return data;
    },
    onSuccess: (data) => {
      // C1-A: invalidate with caseId-based key + broad quote-case
      queryClient.invalidateQueries({ queryKey: ['send-quotation-data', caseId] });
      queryClient.invalidateQueries({ queryKey: ['quote-case'], exact: false });

      if (data.idempotent) {
        toast.info('Devis déjà envoyé', {
          description: `Envoyé le ${new Date(data.sent_at).toLocaleDateString('fr-FR')}`,
        });
      } else {
        toast.success('Devis envoyé avec succès');
      }

      // Debug only - not visible to end user
      if (data.correlation_id) {
        console.log('[send-quotation] correlation_id:', data.correlation_id);
      }
    },
    onError: (error) => {
      console.error('[send-quotation] Error:', error);
      toast.error('Erreur lors de l\'envoi', {
        description: error instanceof Error ? error.message : 'Erreur inconnue',
      });
    },
  });

  return {
    ownerDraft,
    selectedVersion,
    caseStatus,
    canSend,
    isSent,
    sentAt,
    sendMutation,
    isLoading,
  };
}
