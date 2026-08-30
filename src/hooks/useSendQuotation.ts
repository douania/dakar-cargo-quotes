/**
 * Phase 19A: Hook for sending a quotation (P0 Hardening)
 * 
 * Pattern: useQuery (load data) + useMutation (send action)
 * CTO corrections: C1-A (caseId keys), C1-B (canSend with FSM), C2 (no thread_ref)
 * P0 Hardening: hasPdf best-effort only (not in canSend due to RLS visibility)
 * COCKPIT-2: Communication safeguards (warnings, not blocking)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface OpenPartnerRequest {
  id: string;
  status: string;
  partner_name: string | null;
  purpose: string | null;
}

interface PendingPartnerFact {
  id: string;
  fact_key: string;
  validation_status: string;
}

interface OpenClientGap {
  id: string;
  gap_key: string;
  status: string;
}

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
  openPartnerRequests: OpenPartnerRequest[];
  pendingPartnerFacts: PendingPartnerFact[];
  openClientGaps: OpenClientGap[];
}

export function useSendQuotation(caseId: string | undefined) {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, isFetching } = useQuery<SendQuotationData>({
    queryKey: ['send-quotation-data', caseId],
    enabled: !!caseId,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Step 1: fetch version + case status + communication safeguards in parallel
      const [versionResult, caseResult, eqrResult, factsResult, gapsResult] = await Promise.all([
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

        // COCKPIT-2: open partner requests (everything except closed)
        supabase
          .from('external_quote_requests')
          .select('id, status, partner_name, purpose')
          .eq('case_id', caseId!)
          .neq('status', 'closed'),

        // COCKPIT-2: pending partner facts (proposed = not yet validated)
        supabase
          .from('external_quote_response_facts')
          .select('id, fact_key, validation_status')
          .eq('case_id', caseId!)
          .eq('validation_status', 'proposed'),

        // COCKPIT-2: open client gaps (drafted, sent, or answered = not yet resolved)
        supabase
          .from('client_gap_requests')
          .select('id, gap_key, status')
          .eq('case_id', caseId!)
          .in('status', ['drafted', 'sent', 'answered']),
      ]);

      // Critical fields (selected version, case status, owner draft) must not be
      // trusted from a Supabase error response: {data:null,error} resolves rather
      // than rejecting, so a silent version/status mismatch would otherwise slip
      // through canSend. PDF/communication-warning reads stay best-effort by design
      // (informational only, never part of canSend).
      if (versionResult.error) throw versionResult.error;
      if (caseResult.error) throw caseResult.error;

      const selectedVersion = versionResult.data ?? null;

      // Step 2: fetch draft + PDF in parallel (only if version exists)
      let ownerDraft: SendQuotationData['ownerDraft'] = null;
      let latestPdf: SendQuotationData['latestPdf'] = null;

      if (selectedVersion) {
        const [draftResult, pdfResult] = await Promise.all([
          supabase
            .from('email_drafts')
            .select('id, subject, to_addresses, status, sent_at, quotation_version_id, body_text, body_html, ai_generated')
            .eq('quotation_version_id', selectedVersion.id)
            .in('status', ['draft', 'sent'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),

          supabase
            .from('quotation_documents')
            .select('id, file_path, created_at')
            .eq('quotation_version_id', selectedVersion.id)
            .eq('document_type', 'pdf')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

        if (draftResult.error) throw draftResult.error;

        ownerDraft = draftResult.data ?? null;
        latestPdf = pdfResult.data ?? null;
      }

      return {
        ownerDraft,
        selectedVersion,
        caseStatus: caseResult.data?.status ?? null,
        latestPdf,
        openPartnerRequests: (eqrResult.data ?? []) as OpenPartnerRequest[],
        pendingPartnerFacts: (factsResult.data ?? []) as PendingPartnerFact[],
        openClientGaps: (gapsResult.data ?? []) as OpenClientGap[],
      };
    },
  });

  const ownerDraft = data?.ownerDraft ?? null;
  const selectedVersion = data?.selectedVersion ?? null;
  const caseStatus = data?.caseStatus ?? null;
  const latestPdf = data?.latestPdf ?? null;
  const openPartnerRequests = data?.openPartnerRequests ?? [];
  const pendingPartnerFacts = data?.pendingPartnerFacts ?? [];
  const openClientGaps = data?.openClientGaps ?? [];

  // Derived flags
  const hasRecipient = (ownerDraft?.to_addresses?.length ?? 0) > 0;
  const hasSubject = !!(ownerDraft?.subject?.trim());
  const hasBody = !!(ownerDraft?.body_text?.trim() || ownerDraft?.body_html?.trim());
  // hasPdf is informational only — NOT used in canSend (RLS visibility issue in multi-operator)
  const hasPdf = !!latestPdf;

  // COCKPIT-2: communication warnings (informational, NOT blocking canSend)
  const hasCommunicationWarnings =
    openPartnerRequests.length > 0 ||
    pendingPartnerFacts.length > 0 ||
    openClientGaps.length > 0;

  // canSend: strict guards WITHOUT hasPdf (backend enforces PDF presence)
  // canSend is NOT affected by communication warnings (operator discretion)
  const canSend = !!ownerDraft
    && !!selectedVersion
    && !isError && !isFetching
    && ownerDraft.status !== 'sent'
    && caseStatus === 'QUOTED_VERSIONED'
    && hasRecipient && hasSubject && hasBody;

  const isSent = ownerDraft?.status === 'sent';
  const isCaseSent = caseStatus === 'SENT' || caseStatus === 'ACCEPTED' || caseStatus === 'REJECTED';
  const sentAt = ownerDraft?.sent_at ?? null;

  // Recheck the live cache at action time as well as disabling UI buttons. A
  // handler captured before selection starts must not act on the old version.
  const canActOnSelection = () => {
    const state = queryClient.getQueryState<SendQuotationData>(['send-quotation-data', caseId]);
    return !!caseId && !!selectedVersion
      && queryClient.isMutating({ mutationKey: ['select-quotation-version', caseId], exact: true }) === 0
      && state?.status === 'success' && state.fetchStatus === 'idle' && !state.isInvalidated
      && state.data?.selectedVersion?.id === selectedVersion.id
      && state.data?.ownerDraft?.id === ownerDraft?.id;
  };

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!caseId || !ownerDraft || !selectedVersion || !canSend || !canActOnSelection()) {
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
      // P1-A: unified cockpit state
      queryClient.invalidateQueries({ queryKey: ['cockpit-state', caseId] });

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
    isCaseSent,
    sentAt,
    sendMutation,
    isLoading,
    isError,
    isFetching,
    canActOnSelection,
    // P0 Hardening flags
    hasPdf,
    hasRecipient,
    hasSubject,
    hasBody,
    // A4 flag
    aiGenerated: ownerDraft?.ai_generated ?? false,
    // COCKPIT-2: communication safeguards
    openPartnerRequests,
    pendingPartnerFacts,
    openClientGaps,
    hasCommunicationWarnings,
  };
}
