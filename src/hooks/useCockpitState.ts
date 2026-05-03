/**
 * P1-A + P2-A — Unified cockpit state hook.
 * Single React Query hook returning counts, flags, booleans.
 * No full rows, no detailed previews — strictly synthetic.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  TERMINAL_STATUSES,
  RESPONSE_PHASE_STATUSES,
  computeCollectionVerdict,
  type CollectionVerdict,
} from "@/lib/cockpitStatusConstants";

export interface CockpitState {
  // Case
  status: string;
  isTerminal: boolean;

  // Gaps
  blockingGapsCount: number;

  // Partner requests
  totalPartnerRequests: number;
  draftPartnerRequests: number;
  unsentPartnerRequests: number; // sent && !email_sent_at
  sentConfirmedPartnerRequests: number; // sent && email_sent_at
  openPartnerRequests: number; // != closed
  closedPartnerRequests: number;
  responsePhaseRequests: number;
  hasExploitableRequests: boolean;
  hasSelectedPartner: boolean;
  selectedPartnerName: string | null;
  exploitablePartnerRequests: number;
  collectionVerdict: CollectionVerdict;

  // Partner facts
  pendingPartnerFacts: number;
  /** Per-request pending fact counts (for verdict calculation) */
  pendingFactsByRequestId: ReadonlyMap<string, number>;

  // Client gaps
  totalClientGaps: number;
  /** Active client gap requests (drafted + sent + answered) — used for action plan visibility */
  activeClientGaps: number;
  draftedClientGaps: number;
  answeredClientGaps: number;
  openClientGaps: number; // drafted + sent + answered

  // Version pipeline
  hasSelectedVersion: boolean;
  selectedVersionId: string | null;
  hasPdf: boolean;
  hasDraftEmail: boolean;
}

export function useCockpitState(caseId: string | undefined) {
  return useQuery<CockpitState>({
    queryKey: ["cockpit-state", caseId],
    staleTime: 30_000,
    enabled: !!caseId,
    queryFn: async (): Promise<CockpitState> => {
      // Batch 1: all independent counts/selects
      const [
        caseRes,
        gapsRes,
        allOpenGapsRes,
        reqRes,
        factsRes,
        clientGapKeyRes,
        clientGapDraftedKeyRes,
        clientGapsTotalRes,
        versionsRes,
      ] = await Promise.all([
        supabase
          .from("quote_cases")
          .select("status")
          .eq("id", caseId!)
          .maybeSingle(),
        supabase
          .from("quote_gaps")
          .select("id", { count: "exact", head: true })
          .eq("case_id", caseId!)
          .eq("is_blocking", true)
          .eq("status", "open"),
        // All open gaps (not just blocking) — needed for client gap intersection
        supabase
          .from("quote_gaps")
          .select("gap_key")
          .eq("case_id", caseId!)
          .eq("status", "open"),
        supabase
          .from("external_quote_requests")
          .select("id, status, email_sent_at, is_selected, partner_name")
          .eq("case_id", caseId!),
        supabase
          .from("external_quote_response_facts")
          .select("request_id")
          .eq("case_id", caseId!)
          .eq("validation_status", "proposed"),
        // P1-CGR: fetch gap_key + status instead of count HEAD
        supabase
          .from("client_gap_requests")
          .select("gap_key, status")
          .eq("case_id", caseId!)
          .in("status", ["drafted", "sent", "answered"] as string[]),
        supabase
          .from("client_gap_requests")
          .select("gap_key")
          .eq("case_id", caseId!)
          .eq("status", "drafted"),
        supabase
          .from("client_gap_requests")
          .select("id", { count: "exact", head: true })
          .eq("case_id", caseId!),
        supabase
          .from("quotation_versions")
          .select("id, is_selected")
          .eq("case_id", caseId!),
      ]);

      const status = (caseRes.data?.status as string) ?? "INTAKE";
      const blockingGapsCount = gapsRes.count ?? 0;
      const totalClientGaps = clientGapsTotalRes.count ?? 0;

      // P1-CGR-FINAL: intersection with open gaps for true "active" count
      const openGapKeys = new Set(
        (allOpenGapsRes.data ?? []).map((g: { gap_key: string }) => g.gap_key),
      );
      const clientGapRows = (clientGapKeyRes.data ?? []) as Array<{ gap_key: string; status: string }>;
      const activeClientGapRows = clientGapRows.filter((r) => openGapKeys.has(r.gap_key));
      const activeClientGaps = activeClientGapRows.length;
      const openClientGaps = activeClientGaps; // aligned: active = gap still open
      const draftedClientGapRows = (clientGapDraftedKeyRes.data ?? []) as Array<{ gap_key: string }>;
      const draftedClientGaps = draftedClientGapRows.filter((r) => openGapKeys.has(r.gap_key)).length;
      const answeredClientGaps = activeClientGapRows.filter((r) => r.status === "answered").length;

      // P2-A: build per-request pending facts map
      const factsRows = (factsRes.data ?? []) as Array<{ request_id: string }>;
      const pendingFactsByRequestId = new Map<string, number>();
      let pendingPartnerFacts = 0;
      for (const f of factsRows) {
        pendingFactsByRequestId.set(
          f.request_id,
          (pendingFactsByRequestId.get(f.request_id) ?? 0) + 1,
        );
        pendingPartnerFacts++;
      }

      // Derive partner request signals from rows
      const requests = (reqRes.data ?? []) as Array<{
        id: string;
        status: string;
        email_sent_at: string | null;
        is_selected: boolean;
        partner_name: string | null;
      }>;
      const totalPartnerRequests = requests.length;
      let draftPartnerRequests = 0;
      let unsentPartnerRequests = 0;
      let sentConfirmedPartnerRequests = 0;
      let closedPartnerRequests = 0;
      let responsePhaseRequests = 0;
      let hasSelectedPartner = false;
      let selectedPartnerName: string | null = null;

      for (const r of requests) {
        if (r.status === "draft") draftPartnerRequests++;
        if (r.status === "sent" && !r.email_sent_at) unsentPartnerRequests++;
        if (r.status === "sent" && r.email_sent_at) sentConfirmedPartnerRequests++;
        if (r.status === "closed") closedPartnerRequests++;
        if (RESPONSE_PHASE_STATUSES.has(r.status)) responsePhaseRequests++;
        if (r.is_selected) {
          hasSelectedPartner = true;
          selectedPartnerName = r.partner_name;
        }
      }

      const openPartnerRequests = totalPartnerRequests - closedPartnerRequests;
      const hasExploitableRequests =
        requests.some(
          (r) => RESPONSE_PHASE_STATUSES.has(r.status) || r.status === "closed",
        );

      // P2-A: collection verdict
      const verdictResult = computeCollectionVerdict(requests, pendingFactsByRequestId);

      // Version pipeline (lazy PDF/draft only if version exists)
      const versions = (versionsRes.data ?? []) as Array<{
        id: string;
        is_selected: boolean;
      }>;
      const selectedVersion = versions.find((v) => v.is_selected);
      const hasSelectedVersion = !!selectedVersion;
      const selectedVersionId = selectedVersion?.id ?? null;

      let hasPdf = false;
      let hasDraftEmail = false;

      if (selectedVersionId) {
        const [pdfRes, emailRes] = await Promise.all([
          supabase
            .from("quotation_documents")
            .select("id", { count: "exact", head: true })
            .eq("quotation_version_id", selectedVersionId)
            .eq("document_type", "pdf"),
          supabase
            .from("email_drafts")
            .select("id", { count: "exact", head: true })
            .eq("quotation_version_id", selectedVersionId)
            .eq("status", "draft"),
        ]);
        hasPdf = (pdfRes.count ?? 0) > 0;
        hasDraftEmail = (emailRes.count ?? 0) > 0;
      }

      return {
        status,
        isTerminal: TERMINAL_STATUSES.has(status),
        blockingGapsCount,
        totalPartnerRequests,
        draftPartnerRequests,
        unsentPartnerRequests,
        sentConfirmedPartnerRequests,
        openPartnerRequests,
        closedPartnerRequests,
        responsePhaseRequests,
        hasExploitableRequests,
        hasSelectedPartner,
        selectedPartnerName,
        exploitablePartnerRequests: verdictResult.exploitable,
        collectionVerdict: verdictResult.verdict,
        pendingPartnerFacts,
        pendingFactsByRequestId,
        totalClientGaps,
        activeClientGaps,
        draftedClientGaps,
        answeredClientGaps,
        openClientGaps,
        hasSelectedVersion,
        selectedVersionId,
        hasPdf,
        hasDraftEmail,
      };
    },
  });
}
