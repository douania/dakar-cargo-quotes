/**
 * Phase 19A: Hook for sending a quotation (P0 Hardening)
 * 
 * Pattern: useQuery (load data) + useMutation (send action)
 * CTO corrections: C1-A (caseId keys), C1-B (canSend with FSM), C2 (no thread_ref)
 * P0 Hardening: hasPdf best-effort only (not in canSend due to RLS visibility)
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
    body_text: string | null;
    body_html: string | null;
    ai_generated: boolean | null;
  } | null;
  selectedVersion: {
    id: string;
    version_number: number;
    status: string;
    snapshot: any;
  } | null;
  caseStatus: string | null;
  latestPdf: { id: string; file_path: string; created_at: string } | null;
}

export function useSendQuotation(caseId: string | undefined) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<SendQuotationData>({
    queryKey: ['send-quotation-data', caseId],
    enabled: !!caseId,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Step 1: fetch version + case status in parallel
      const [versionResult, caseResult] = await Promise.all([
        supabase
          .from('quotation_versions')
          .select('id, version_number, status, snapshot')
          .eq('case_id', caseId!)
          .eq('is_selected', true)
          .limit(1)
          .maybeSingle(),

        supabase
          .from('quote_cases')
          .select('status')
          .eq('id', caseId!)
          .maybeSingle(),
      ]);

      const selectedVersion = versionResult.data ?? null;

      // Step 2: fetch draft + PDF in parallel (only if version exists)
      let ownerDraft: SendQuotationData['ownerDraft'] = null;
      let latestPdf: SendQuotationData['latestPdf'] = null;

      if (selectedVersion) {
        const [draftResult, pdfResult] = await Promise.all([
          // Draft scoped strictly by quotation_version_id
          supabase
            .from('email_drafts')
            .select('id, subject, to_addresses, status, sent_at, quotation_version_id, body_text, body_html, ai_generated')
            .eq('quotation_version_id', selectedVersion.id)
            .in('status', ['draft', 'sent'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),

          // Best-effort PDF query (may return null due to RLS on quotation_documents)
          supabase
            .from('quotation_documents')
            .select('id, file_path, created_at')
            .eq('quotation_version_id', selectedVersion.id)
            .eq('document_type', 'pdf')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

        ownerDraft = draftResult.data ?? null;
        latestPdf = pdfResult.data ?? null;
      }

      return {
        ownerDraft,
        selectedVersion,
        caseStatus: caseResult.data?.status ?? null,
        latestPdf,
      };
    },
  });

  const ownerDraft = data?.ownerDraft ?? null;
  const selectedVersion = data?.selectedVersion ?? null;
  const caseStatus = data?.caseStatus ?? null;
  const latestPdf = data?.latestPdf ?? null;

  // Derived flags
  const hasRecipient = (ownerDraft?.to_addresses?.length ?? 0) > 0;
  const hasSubject = !!(ownerDraft?.subject?.trim());
  const hasBody = !!(ownerDraft?.body_text?.trim() || ownerDraft?.body_html?.trim());
  // hasPdf is informational only — NOT used in canSend (RLS visibility issue in multi-operator)
  const hasPdf = !!latestPdf;

  // canSend: strict guards WITHOUT hasPdf (backend enforces PDF presence)
  const canSend = !!ownerDraft
    && !!selectedVersion
    && ownerDraft.status !== 'sent'
    && caseStatus === 'QUOTED_VERSIONED'
    && hasRecipient && hasSubject && hasBody;

  const isSent = ownerDraft?.status === 'sent';
  const isCaseSent = caseStatus === 'SENT';
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
      if (!data?.ok) {
        throw new Error(data?.error?.message || 'Send failed');
      }

      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['send-quotation-data', caseId] });
      queryClient.invalidateQueries({ queryKey: ['quote-case'], exact: false });

      if (data.idempotent) {
        toast.info('Devis déjà marqué comme envoyé', {
          description: `Marqué le ${new Date(data.sent_at).toLocaleDateString('fr-FR')}`,
        });
      } else {
        toast.success('Devis marqué comme envoyé');
      }

      if (data.correlation_id) {
        console.log('[send-quotation] correlation_id:', data.correlation_id);
      }
    },
    onError: (error) => {
      console.error('[send-quotation] Error:', error);
      toast.error('Erreur lors du marquage d\'envoi', {
        description: error instanceof Error ? error.message : 'Erreur inconnue',
      });
    },
  });

  return {
    ownerDraft,
    selectedVersion,
    caseStatus,
    latestPdf,
    canSend,
    isSent,
    sentAt,
    sendMutation,
    isLoading,
    // P0 Hardening flags
    hasPdf,
    hasRecipient,
    hasSubject,
    hasBody,
  };
}
