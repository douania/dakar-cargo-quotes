import React, { useMemo, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FileText,
  Loader2,
  AlertCircle,
  HelpCircle,
  ArrowLeft,
  Paperclip,
  History,
  Puzzle,
  
  RefreshCw,
  Play,
  Pencil,
  Check,
  X,
  Calculator,
  Clock,
  CheckCircle,
  Copy,
  Mail,
  Send,
  Anchor,
  Printer,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TASK_STATUS_COLORS } from "@/features/quotation/constants";
import {
  SELECT_FACT_OPTIONS,
  MULTI_LOT_AMBIGUOUS_FACTS,
  CLIENT_RESOLVABLE_GAP_KEYS,
  EDITABLE_FACT_KEYS,
  NUMERIC_FACT_KEYS,
  CATEGORY_LABELS,
  STATUS_LABELS,
} from "./case-view/constants";
import type { PricingPrecheck } from "./case-view/types";
import { mapSourceType, toFactPayload } from "./case-view/helpers";
import { FactHistoryPopover } from "./case-view/FactHistoryPopover";
import { MainLayout } from "@/components/layout/MainLayout";
import CaseDocumentsTab from "@/components/case/CaseDocumentsTab";
import { PricingLaunchPanel } from "@/components/puzzle/PricingLaunchPanel";
import { PricingResultPanel } from "@/components/puzzle/PricingResultPanel";
import { QuotationVersionCard } from "@/components/puzzle/QuotationVersionCard";
import { SendQuotationPanel } from "@/components/puzzle/SendQuotationPanel";
import { MultiRequestLinesPanel } from "@/components/puzzle/MultiRequestLinesPanel";
import { CaseUnderstandingPanel } from "@/components/case/CaseUnderstandingPanel";
import { CommunicationSummaryCard } from "@/components/case/CommunicationSummaryCard";
import { CaseActionPlan } from "@/components/case/CaseActionPlan";
import { NextActionBanner } from "@/components/case/NextActionBanner";
import { ReadyActionsPanel } from "@/components/case/ReadyActionsPanel";
import { DecisionSupportPanel } from "@/components/puzzle/DecisionSupportPanel";
import { ExternalRequestsPanel } from "@/components/puzzle/ExternalRequestsPanel";
import { PricingCommWarnings } from "@/components/puzzle/PricingCommWarnings";
import { PricingReadinessCard } from "@/components/puzzle/PricingReadinessCard";
import { PartnerCollectionReadinessCard } from "@/components/puzzle/PartnerCollectionReadinessCard";
import { PartnerRequestsSummary } from "@/components/puzzle/PartnerRequestsSummary";
import { PartnerRequestsDetailView } from "@/components/puzzle/PartnerRequestsDetailView";
import { ServiceOverridePanel } from "./case-view/ServiceOverridePanel";

export default function CaseView() {
  const { caseId } = useParams<{ caseId: string }>();
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);
  const [isServiceScopeAnalyzing, setIsServiceScopeAnalyzing] = React.useState(false);
  const [editingFactId, setEditingFactId] = React.useState<string | null>(null);
  const [editValue, setEditValue] = React.useState("");
  const [isSavingFact, setIsSavingFact] = React.useState(false);
  const [dismissedSuggestions, setDismissedSuggestions] = React.useState<string[]>([]);
  const [isApplyingSuggestion, setIsApplyingSuggestion] = React.useState(false);
  const [isApplyingIntent, setIsApplyingIntent] = React.useState(false);
  const [closingActionKey, setClosingActionKey] = useState<string | null>(null);
  const [generatingDraftKey, setGeneratingDraftKey] = useState<string | null>(null);
  // ── Gap inline resolution state ──
  const [gapInputs, setGapInputs] = React.useState<Record<string, string>>({});
  const [savingGapKey, setSavingGapKey] = React.useState<string | null>(null);
  const [askingClientForGaps, setAskingClientForGaps] = useState(false);
  const [isMarkingSent, setIsMarkingSent] = useState(false);
  const [pricingRefreshToken, setPricingRefreshToken] = useState(0);
  const navigate = useNavigate();

  // ── Fetch quote_cases ──
  const {
    data: caseData,
    isLoading: caseLoading,
    error: caseError,
    refetch: refetchCase,
  } = useQuery({
    queryKey: ["case-view", caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_cases")
        .select("*")
        .eq("id", caseId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!caseId,
  });

  // ── Fetch quote_facts (current only) ──
  const { data: facts = [], refetch: refetchFacts } = useQuery({
    queryKey: ["case-facts", caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_facts")
        .select("*")
        .eq("case_id", caseId!)
        .eq("is_current", true)
        .order("fact_category")
        .order("fact_key");
      if (error) throw error;
      return data;
    },
    enabled: !!caseId,
  });

  // ── Fetch timeline events ──
  const { data: events = [], refetch: refetchEvents } = useQuery({
    queryKey: ["case-timeline", caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("case_timeline_events")
        .select("*")
        .eq("case_id", caseId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!caseId,
  });

  // ── Fetch documents count ──
  const { data: documentsCount = 0 } = useQuery({
    queryKey: ["case-documents-count", caseId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("case_documents")
        .select("id", { count: "exact", head: true })
        .eq("case_id", caseId!);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!caseId,
  });

  // ── Fetch open gaps (source de vérité directe) ──
  const { data: gaps = [], refetch: refetchGaps } = useQuery({
    queryKey: ["case-gaps", caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_gaps")
        .select("id, gap_key, gap_category, question_fr, is_blocking, status")
        .eq("case_id", caseId!)
        .eq("status", "open")
        .order("is_blocking", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!caseId,
    staleTime: 30000,
  });

  // ── CL1: Fetch client_gap_requests ──
  const { data: clientGapRequests = [], refetch: refetchGapRequests } = useQuery({
    queryKey: ["client-gap-requests", caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_gap_requests" as any)
        .select("id, gap_key, status, sent_at, matched_fact_key, created_at")
        .eq("case_id", caseId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!caseId,
    staleTime: 30000,
  });

  // P1a — Multi-lot line count (lightweight count query)
  const { data: multiLotLineCount = 0 } = useQuery({
    queryKey: ["quote-request-lines-count", caseId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("quote_request_lines" as any)
        .select("*", { count: "exact", head: true })
        .eq("case_id", caseId!);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!caseId,
    staleTime: 60000,
  });
  const isMultiLot = multiLotLineCount >= 2;

  // ── M9b: Output pipeline stepper data ──
  const isPipelineVisible = caseData && ['PRICED_DRAFT', 'HUMAN_REVIEW', 'QUOTED_VERSIONED', 'SENT', 'ACCEPTED', 'REJECTED'].includes(caseData.status);
  const isTerminalOutcome = caseData && ['ACCEPTED', 'REJECTED'].includes(caseData.status);
  const isPostSentLocked = caseData && ['SENT', 'ACCEPTED', 'REJECTED'].includes(caseData.status);
  const { data: pipelineStepperData } = useQuery({
    queryKey: ["pipeline-stepper", caseId],
    queryFn: async () => {
      // Fetch selected version
      const { data: version } = await supabase
        .from("quotation_versions")
        .select("id")
        .eq("case_id", caseId!)
        .eq("is_selected", true)
        .limit(1)
        .maybeSingle();

      if (!version) return { hasVersion: false, hasPdf: false, hasDraft: false };

      // Fetch PDF + draft in parallel
      const [pdfResult, draftResult] = await Promise.all([
        supabase
          .from("quotation_documents")
          .select("id")
          .eq("quotation_version_id", version.id)
          .eq("document_type", "pdf")
          .limit(1)
          .maybeSingle(),
        supabase
          .from("email_drafts")
          .select("id")
          .eq("quotation_version_id", version.id)
          .in("status", ["draft", "sent"])
          .limit(1)
          .maybeSingle(),
      ]);

      return {
        hasVersion: true,
        hasPdf: !!pdfResult.data,
        hasDraft: !!draftResult.data,
      };
    },
    enabled: !!caseId && !!isPipelineVisible,
    staleTime: 15000,
  });

  // PRICING-GUARD: provisional pricing detection (open comm loops)
  const { data: pricingCommCounts } = useQuery({
    queryKey: ['pricing-provisional-check', caseId],
    staleTime: 30_000,
    queryFn: async () => {
      const [eqr, facts, gaps] = await Promise.all([
        supabase.from('external_quote_requests').select('id', { count: 'exact', head: true }).eq('case_id', caseId!).neq('status', 'closed'),
        supabase.from('external_quote_response_facts').select('id', { count: 'exact', head: true }).eq('case_id', caseId!).eq('validation_status', 'proposed'),
        supabase.from('client_gap_requests' as any).select('id', { count: 'exact', head: true }).eq('case_id', caseId!).in('status', ['drafted', 'sent', 'answered'] as string[]),
      ]);
      return (eqr.count ?? 0) + (facts.count ?? 0) + (gaps.count ?? 0);
    },
    enabled: !!caseId && !!isPipelineVisible,
  });
  const pricingIsProvisional = (pricingCommCounts ?? 0) > 0;

  const blockingGaps = gaps.filter((g: any) => g.is_blocking);
  const nonBlockingOpenGaps = gaps.filter((g: any) => !g.is_blocking);
  const displayedGapsCount = gaps.length || (caseData?.gaps_count ?? 0);
  const hasArticlesDetail = facts.some((f: any) => f.fact_key === "cargo.articles_detail");

  function handleRefresh() {
    refetchCase();
    refetchFacts();
    refetchEvents();
    refetchGaps();
    refetchGapRequests();
  }

  // ── CL1: Mark client gap requests as sent ──
  async function markClientGapRequestsSent(gapKeys?: string[]) {
    if (!caseId || isMarkingSent) return;
    // If specific gap keys provided, use them; otherwise fallback to all drafted
    const keysToSend = gapKeys ?? (clientGapRequests as any[])
      .filter((r: any) => r.status === "drafted")
      .map((r: any) => r.gap_key as string);
    if (keysToSend.length === 0) {
      toast.info("Aucune clarification en brouillon à marquer");
      return;
    }
    setIsMarkingSent(true);
    try {
      const { data, error } = await supabase.functions.invoke("mark-client-gap-request-sent", {
        body: { case_id: caseId, gap_keys: keysToSend },
      });
      if (error) throw error;
      if (data?.ok) {
        toast.success(`${data.updated} clarification(s) marquée(s) comme envoyée(s)`);
        refetchGapRequests();
      } else {
        toast.error("Erreur lors du marquage");
      }
    } catch (e: any) {
      toast.error(`Erreur: ${e?.message ?? "unknown"}`);
    } finally {
      setIsMarkingSent(false);
    }
  }

  async function handleAnalyzeServiceScope() {
    if (!caseId || isServiceScopeAnalyzing) return;

    setIsServiceScopeAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-service-scope", {
        body: { case_id: caseId },
      });

      if (error) throw error;

      if (data?.ok === false) {
        toast.error("Analyse impossible pour ce dossier");
        return;
      }

      await refetchEvents();
    } catch (err) {
      console.error("[Phase2] analyze-service-scope failed:", err);
      toast.error("Analyse impossible pour ce dossier");
    } finally {
      setIsServiceScopeAnalyzing(false);
    }
  }

  // ── C3/P1: Apply proposed facts from reply_analysis_v1 ──
  const [applyingFactKey, setApplyingFactKey] = useState<string | null>(null);




  function isFactAlreadyApplied(f: Record<string, unknown>): boolean {
    const payload = toFactPayload(f);
    if (!payload) return false;
    return facts.some((existing: any) => {
      if (existing.fact_key !== payload.fact_key) return false;
      if (payload.value_number !== null) {
        return Number(existing.value_number) === Number(payload.value_number);
      }
      if (payload.value_text !== null) {
        return String(existing.value_text ?? "").trim() === payload.value_text;
      }
      return false;
    });
  }

  async function applyProposedFact(f: Record<string, unknown>) {
    const payload = toFactPayload(f);
    if (!payload || !payload.fact_key) return;

    setApplyingFactKey(payload.fact_key);
    try {
      const body: Record<string, unknown> = {
        case_id: caseId,
        fact_key: payload.fact_key,
        value_text: payload.value_text,
        value_number: payload.value_number,
      };
      if (payload.value_json != null) {
        body.value_json = payload.value_json;
      }

      const { data, error } = await supabase.functions.invoke("set-case-fact", { body });
      if (error) throw error;
      if (data?.ok === false) {
        throw new Error(data?.error || "set-case-fact a échoué");
      }

      toast.success(`Fact appliqué : ${payload.fact_key}`);
      handleRefresh();
    } catch (e: any) {
      toast.error(`Impossible d'appliquer ${payload.fact_key} : ${e.message}`);
    } finally {
      setApplyingFactKey(null);
    }
  }

  // ── Phase 15.8.2: Async helper for build-case-puzzle ──
  async function runBuildCasePuzzleAsync(
    targetCaseId: string,
    opts?: { force_refresh?: boolean; force_articles_detail?: boolean }
  ): Promise<Record<string, unknown>> {
    const { data: startData, error: startErr } = await supabase.functions.invoke("build-case-puzzle", {
      body: { case_id: targetCaseId, ...opts, mode: "start" },
    });
    if (startErr) throw startErr;
    const jobId = startData?.job_id;
    if (!jobId) throw new Error("No job_id returned");
    if (startData.status === "already_running") {
      // Poll existing job
    }

    const deadline = Date.now() + 5 * 60_000;
    let delay = 3000;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, delay));
      try {
        const { data, error } = await supabase.functions.invoke("build-case-puzzle", {
          body: { job_id: jobId, mode: "poll" },
        });
        if (error) { delay = Math.min(delay * 2, 30_000); continue; }
        if (data.status === "completed") return (data.final_result as Record<string, unknown>) || {};
        if (data.status === "failed") throw new Error(data.error_message || "Job failed");
        if (data.status === "cancelled") throw new Error("Job cancelled");
        if (data.is_stale && data.can_resume) {
          await supabase.functions.invoke("build-case-puzzle", { body: { job_id: jobId, mode: "tick" } });
        }
        delay = 3000;
      } catch (e: unknown) {
        if (e instanceof Error && (e.message.includes("Job failed") || e.message.includes("cancelled"))) throw e;
        delay = Math.min(delay * 2, 30_000);
      }
    }
    throw new Error("Timeout (5 min)");
  }

  async function handleLaunchAnalysis() {
    if (!caseId || isAnalyzing) return;
    setIsAnalyzing(true);
    try {
      await runBuildCasePuzzleAsync(caseId);
      // P0-E: sync gap-based client actions after puzzle refresh (best-effort)
      try {
        await supabase.functions.invoke("sync-gap-client-actions", {
          body: { case_id: caseId },
        });
      } catch (syncErr) {
        console.warn("[P0-E] sync-gap-client-actions:", syncErr);
      }

      // Phase 16: Trigger intent analysis after puzzle (non-blocking, per-email anti-doublon)
      try {
        if (caseData?.thread_id) {
          // Find the latest email in the thread
          const { data: latestEmail } = await supabase
            .from("emails")
            .select("id")
            .eq("thread_ref", caseData.thread_id)
            .order("received_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (latestEmail) {
            // Check if this specific email already has an intent classification
            const intentAlreadyPresent = (events ?? []).some(
              (e: any) =>
                e.event_type === "thread_intent_v1" &&
                e.related_email_id === latestEmail.id
            );

            if (!intentAlreadyPresent) {
              await supabase.functions.invoke("analyze-thread-event", {
                body: { email_id: latestEmail.id },
              });
            }
          }
        }
      } catch (intentErr) {
        console.warn("[Phase16] Intent analysis (non-blocking):", intentErr);
      }

      // V2: Coherence analysis (non-blocking, best-effort)
      try {
        if (caseData?.thread_id) {
          const { data: latestEmailForCoherence } = await supabase
            .from("emails")
            .select("id")
            .eq("thread_ref", caseData.thread_id)
            .order("received_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          await supabase.functions.invoke("analyze-case-coherence", {
            body: { case_id: caseId, related_email_id: latestEmailForCoherence?.id ?? null },
          });
        }
      } catch (coherenceErr) {
        console.warn("[V2] analyze-case-coherence (non-blocking):", coherenceErr);
      }

      toast.success("Analyse terminée avec succès");
      setPricingRefreshToken(t => t + 1);
      handleRefresh();
    } catch (err) {
      toast.error("Erreur lors de l'analyse : " + (err as Error).message);
    } finally {
      setIsAnalyzing(false);
    }
  }

  // ── Open actions (append-only: group by dedupe_key, keep latest, filter open) ──
  // ACTION-SYNC-1: cross-reference with real open gaps to exclude resolved actions
  const openActions = useMemo(() => {
    const byKey = new Map<string, any>();
    for (const e of events ?? []) {
      if (e.event_type !== "manual_action") continue;
      const ed = e.event_data as Record<string, unknown> | null;
      const key = ed?.["dedupe_key"] as string | undefined;
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, e); // first = latest (events are desc)
    }

    // Build set of currently open gap keys from quote_gaps (source of truth)
    const openGapKeys = new Set(gaps.map((g: any) => g.gap_key as string));

    return Array.from(byKey.values()).filter((e: any) => {
      const ed = e.event_data as Record<string, unknown> | null;
      const status = (ed?.["status"] as string) ?? "open";
      if (status !== "open") return false;

      // If the action references specific gap keys, check if at least one is still open
      const requestedGapKeys = Array.isArray(ed?.["requested_gap_keys"])
        ? (ed["requested_gap_keys"] as unknown[]).filter((x): x is string => typeof x === "string")
        : [];

      if (requestedGapKeys.length > 0) {
        return requestedGapKeys.some((k) => openGapKeys.has(k));
      }

      // No gap keys referenced — keep the action visible
      return true;
    });
  }, [events, gaps]);

  // ── Done actions (append-only: group by dedupe_key, keep latest, filter done) ──
  const doneActions = useMemo(() => {
    const byKey = new Map<string, any>();
    for (const e of events ?? []) {
      if (e.event_type !== "manual_action") continue;
      const ed = e.event_data as Record<string, unknown> | null;
      const key = ed?.["dedupe_key"] as string | undefined;
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, e);
    }
    return Array.from(byKey.values())
      .filter((e: any) => {
        const status = ((e.event_data as Record<string, unknown> | null)?.["status"] as string) ?? "open";
        return status === "done";
      })
      .sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));
  }, [events]);

  // ── Drafts indexed by source action dedupe_key ──
  const draftsByActionKey = useMemo(() => {
    const map = new Map<string, { subject: string; body: string; requestedGapKeys: string[] }>();
    for (const e of events ?? []) {
      if (e.event_type !== "output_generated") continue;
      const ed = e.event_data as Record<string, unknown> | null;
      if (ed?.["kind"] !== "reply_draft_v1") continue;
      const sourceKey = ed?.["source_action_dedupe_key"] as string | undefined;
      const draft = ed?.["draft_reply"] as { subject: string; body: string } | undefined;
      const requestedGapKeys = Array.isArray(ed?.["requested_gap_keys"])
        ? (ed["requested_gap_keys"] as unknown[]).filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        : [];
      if (sourceKey && draft) {
        map.set(sourceKey, { ...draft, requestedGapKeys });
      }
    }
   return map;
  }, [events]);

   // ── All drafts (visible even after action closed) ──
  const allDrafts = useMemo(() => {
    return (events ?? [])
      .filter(e => e.event_type === "output_generated" && (e.event_data as any)?.kind === "reply_draft_v1")
      .map(e => {
        const ed = e.event_data as Record<string, unknown>;
        const draftReply = (ed["draft_reply"] as any) ?? null;
        const subject = typeof draftReply?.subject === "string" ? draftReply.subject : null;
        const body = typeof draftReply?.body === "string" ? draftReply.body : null;
        if (!subject || !body) return null;
        const sourceKey = (ed["source_action_dedupe_key"] as string) ?? "";
        const sourceLabel = sourceKey.includes("REQUEST_CLIENT_INFO_FOR_GAPS") ? "Client" : "Réponse";
        return { id: e.id, draft: { subject, body }, createdAt: e.created_at, sourceLabel };
      })
      .filter(Boolean)
      .sort((a, b) => String(b!.createdAt).localeCompare(String(a!.createdAt))) as { id: string; draft: { subject: string; body: string }; createdAt: string; sourceLabel: string }[];
  }, [events]);

  async function closeAction(dedupeKey: string) {
    if (!caseId) return;
    setClosingActionKey(dedupeKey);
    try {
      const { data, error } = await supabase.functions.invoke("close-manual-action", {
        body: { case_id: caseId, dedupe_key: dedupeKey },
      });
      if (error) throw error;
      if (data?.ok) {
        toast.success(data.idempotent ? "Action déjà clôturée" : "Action clôturée");
        refetchEvents();
      } else {
        toast.error(`Erreur: ${data?.error ?? "Clôture échouée"}`);
      }
    } catch (e: any) {
      toast.error(`Erreur clôture: ${e?.message ?? "unknown"}`);
    } finally {
      setClosingActionKey(null);
    }
  }

  async function generateDraft(dedupeKey: string) {
    if (!caseId) return;
    setGeneratingDraftKey(dedupeKey);
    try {
      const { data, error } = await supabase.functions.invoke("generate-reply-draft", {
        body: { case_id: caseId, action_dedupe_key: dedupeKey },
      });
      if (error) throw error;
      if (data?.ok) {
        toast.success(data.idempotent ? "Brouillon déjà généré" : "Brouillon généré");
        refetchEvents();
      } else {
        toast.error(`Erreur: ${data?.error ?? "Génération échouée"}`);
      }
    } catch (e: any) {
      toast.error(`Erreur génération: ${e?.message ?? "unknown"}`);
    } finally {
      setGeneratingDraftKey(null);
    }
  }

  // ── P1: Ask client for all open client-resolvable gaps ──
  async function askClientForGaps() {
    if (!caseId || askingClientForGaps) return;
    setAskingClientForGaps(true);
    try {
      // 1. Sync gap-based action (idempotent)
      const { error: syncErr } = await supabase.functions.invoke("sync-gap-client-actions", {
        body: { case_id: caseId },
      });
      if (syncErr) throw syncErr;

      // 2. Direct DB lookup for the open REQUEST_CLIENT_INFO_FOR_GAPS action
      const { data: actionRows, error: lookupErr } = await supabase
        .from("case_timeline_events")
        .select("id, event_data")
        .eq("case_id", caseId)
        .eq("event_type", "manual_action")
        .order("created_at", { ascending: false })
        .limit(50);

      if (lookupErr) throw lookupErr;

      const openAction = (actionRows ?? []).find((row: any) => {
        const ed = row.event_data as Record<string, unknown> | null;
        return (
          ed?.["action_code"] === "REQUEST_CLIENT_INFO_FOR_GAPS" &&
          ed?.["status"] === "open"
        );
      });

      if (!openAction) {
        toast.error("Impossible de retrouver l'action de demande client pour les gaps ouverts.");
        return;
      }

      const dedupeKey = (openAction.event_data as Record<string, unknown>)?.["dedupe_key"] as string;
      if (!dedupeKey) {
        toast.error("Action trouvée mais dedupe_key manquant.");
        return;
      }

      // 3. Generate reply draft
      const { data: draftData, error: draftErr } = await supabase.functions.invoke("generate-reply-draft", {
        body: { case_id: caseId, action_dedupe_key: dedupeKey },
      });
      if (draftErr) throw draftErr;

      if (draftData?.ok) {
        toast.success(draftData.idempotent ? "Brouillon déjà disponible" : "Brouillon de demande client généré");
        refetchEvents();
      } else {
        toast.error(`Erreur: ${draftData?.error ?? "Génération échouée"}`);
      }
    } catch (e: any) {
      toast.error(`Erreur demande client: ${e?.message ?? "unknown"}`);
    } finally {
      setAskingClientForGaps(false);
    }
  }

  async function copyDraftToClipboard(draft: { subject: string; body: string }) {
    const text = `Subject: ${draft.subject}\n\n${draft.body}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Brouillon copié");
    } catch {
      toast.error("Impossible de copier (permissions navigateur)");
    }
  }

  const [isForceRefreshing, setIsForceRefreshing] = React.useState(false);

  async function handleForceRefreshArticles() {
    if (!caseId || isForceRefreshing) return;
    setIsForceRefreshing(true);
    try {
      await runBuildCasePuzzleAsync(caseId, { force_articles_detail: true });
      // P0-E: sync gap-based client actions after puzzle refresh (best-effort)
      try {
        await supabase.functions.invoke("sync-gap-client-actions", {
          body: { case_id: caseId },
        });
      } catch (syncErr) {
        console.warn("[P0-E] sync-gap-client-actions:", syncErr);
      }
      toast.success("Refresh articles forcé avec succès");
      handleRefresh();
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("403") || msg.includes("Forbidden")) {
        toast.error("Accès admin requis (ADMIN_EMAIL_ALLOWLIST)");
      } else {
        toast.error("Erreur : " + msg);
      }
    } finally {
      setIsForceRefreshing(false);
    }
  }

  const isLocked = caseData?.status === "PRICING_RUNNING";

   function startEdit(fact: any) {
    if (fact.fact_key === "cargo.articles_detail" && fact.value_json) {
      setEditingFactId(fact.id);
      setEditValue(JSON.stringify(fact.value_json, null, 2));
      return;
    }
    const currentValue =
      fact.value_text ||
      (fact.value_number != null ? String(fact.value_number) : "") ||
      (fact.value_json ? JSON.stringify(fact.value_json) : "");
    setEditingFactId(fact.id);
    setEditValue(currentValue);
  }

  function cancelEdit() {
    setEditingFactId(null);
    setEditValue("");
  }

  async function handleSaveFact(fact: any) {
    if (!caseId) {
      toast.error("Dossier invalide");
      return;
    }
    setIsSavingFact(true);
    try {
      const isNumeric = NUMERIC_FACT_KEYS.has(fact.fact_key);
      const payload: Record<string, unknown> = {
        case_id: caseId,
        fact_key: fact.fact_key,
      };

      // Special handling for cargo.articles_detail (JSON array)
      if (fact.fact_key === "cargo.articles_detail") {
        let parsed: any;
        try { parsed = JSON.parse(editValue); } catch {
          throw new Error("JSON invalide pour cargo.articles_detail");
        }
        if (!Array.isArray(parsed)) throw new Error("Doit être un tableau JSON");
        for (const item of parsed) {
          if (!item || typeof item !== 'object') throw new Error("Chaque élément doit être un objet");
          if (item.hs_code !== undefined && typeof item.hs_code !== 'string') throw new Error("hs_code doit être une chaîne");
          if (item.value !== undefined && (!Number.isFinite(item.value) || item.value < 0)) throw new Error("value doit être >= 0");
        }
        payload.value_json = parsed;
        payload.value_text = null;
        payload.value_number = null;
      } else if (isNumeric) {
        const num = Number(editValue);
        if (!Number.isFinite(num) || num < 0) {
          throw new Error("Valeur numérique invalide");
        }
        payload.value_number = num;
        payload.value_text = null;
      } else {
        if (!editValue || !editValue.trim()) {
          throw new Error("Valeur texte invalide");
        }
        payload.value_text = editValue.trim();
        payload.value_number = null;
      }

      const { error } = await supabase.functions.invoke("set-case-fact", {
        body: payload,
      });
      if (error) throw error;

      toast.success("Fait mis à jour");
      cancelEdit();
      handleRefresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsSavingFact(false);
    }
  }

  // ── Group facts by category ──
  const factsByCategory = facts.reduce<Record<string, typeof facts>>((acc, fact) => {
    const cat = fact.fact_category || "other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(fact);
    return acc;
  }, {});

  // ── Derived suggestions ──
  interface DerivedSuggestion {
    id: string;
    label: string;
    description: string;
    suggestedValue: number;
    unit: string;
    fact_key: string;
  }

  const derivedSuggestions = useMemo<DerivedSuggestion[]>(() => {
    const suggestions: DerivedSuggestion[] = [];
    const weightFact = facts.find((f) => f.fact_key === "cargo.weight_kg" && f.is_current);
    const countFact = facts.find((f) => f.fact_key === "cargo.container_count" && f.is_current);
    const perContainerFact = facts.find(
      (f) => f.fact_key === "cargo.weight_per_container_kg" && f.is_current
    );

    if (
      weightFact?.value_number != null &&
      countFact?.value_number != null &&
      countFact.value_number > 1 &&
      !perContainerFact
    ) {
      const avg = Math.round(weightFact.value_number / countFact.value_number);
      if (Number.isFinite(avg) && avg > 0) {
        suggestions.push({
          id: "weight_per_container",
          label: "Poids moyen par conteneur",
          description: `${weightFact.value_number.toLocaleString()} kg ÷ ${countFact.value_number} conteneurs`,
          suggestedValue: avg,
          unit: "kg",
          fact_key: "cargo.weight_per_container_kg",
        });
      }
    }
    return suggestions;
  }, [facts]);

  const visibleSuggestions = derivedSuggestions.filter(
    (s) => !dismissedSuggestions.includes(s.id)
  );

  async function applySuggestion(suggestion: DerivedSuggestion) {
    if (!caseId) {
      toast.error("Dossier invalide");
      return;
    }
    setIsApplyingSuggestion(true);
    try {
      const { error } = await supabase.functions.invoke("set-case-fact", {
        body: {
          case_id: caseId,
          fact_key: suggestion.fact_key,
          value_number: suggestion.suggestedValue,
        },
      });
      if (error) throw error;
      toast.success("Fait dérivé créé");
      setDismissedSuggestions((prev) =>
        prev.includes(suggestion.id) ? prev : [...prev, suggestion.id]
      );
      handleRefresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsApplyingSuggestion(false);
    }
  }

  // ── Derive client name from facts ──
  const clientFact = facts.find(
    (f) => f.fact_key === "contacts.client_name" || f.fact_key === "client_name"
  );
  const clientName = clientFact?.value_text || null;

  // ── Loading state ──
  if (caseLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  // ── Error state ──
  if (caseError || !caseData) {
    return (
      <MainLayout>
        <div className="container mx-auto py-8 px-4 max-w-4xl">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {(caseError as any)?.message || "Dossier introuvable"}
            </AlertDescription>
          </Alert>
          <Button variant="outline" onClick={() => navigate("/intake")} className="mt-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Retour
          </Button>
        </div>
      </MainLayout>
    );
  }

  const completeness = caseData.puzzle_completeness ?? 0;

  return (
    <MainLayout>
      <div className="container mx-auto py-8 px-4 max-w-5xl case-print-root" data-print-date={new Date().toLocaleDateString('fr-FR')}>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Button variant="ghost" onClick={() => navigate("/intake")} className="mb-2 print:hidden">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Retour
            </Button>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <FileText className="h-6 w-6 text-primary" />
              Dossier {caseId?.slice(0, 8)}…
            </h1>
            {clientName && (
              <p className="text-muted-foreground">Client : {clientName}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-2 print:hidden">
              <Printer className="h-4 w-4" />
              Imprimer PDF
            </Button>
            <Badge className={TASK_STATUS_COLORS[caseData.status.toLowerCase()] || "bg-muted text-muted-foreground"}>
              {STATUS_LABELS[caseData.status] || caseData.status}
            </Badge>
            {caseData.request_type && (
              <Badge variant="outline">{caseData.request_type}</Badge>
            )}
            {/* Phase 16: Intent badge */}
            {(() => {
              const ie = events.find((e: any) => e.event_type === "thread_intent_v1");
              const iObj = (ie?.event_data as any)?.intent ?? null;
              const iType = iObj?.intent_type ?? (ie?.event_data as any)?.intent_type ?? null;
              const iReasoning = iObj?.reasoning ?? "";
              if (iType === "opportunity_check") {
                return (
                  <Badge className="bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200" title={iReasoning}>
                    💡 Opportunity Check
                  </Badge>
                );
              }
              if (iType === "general_inquiry") {
                return (
                  <Badge className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" title={iReasoning}>
                    ❓ Demande générale
                  </Badge>
                );
              }
              if (iType === "send_document") {
                return (
                  <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" title={iReasoning}>
                    📄 Envoi document
                  </Badge>
                );
              }
              return null;
            })()}
          </div>
        </div>

        {/* Info bar */}
        <Card className="mb-6">
          <CardContent className="py-4 flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Complétude</span>
                <div className="flex items-center gap-2">
                  <Progress value={completeness} className="w-32 h-2" />
                  <span className="text-sm font-semibold">{completeness}%</span>
                </div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Faits</span>
                <p className="text-sm font-semibold">{caseData.facts_count ?? facts.length}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Gaps</span>
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold">{displayedGapsCount}</p>
                  {blockingGaps.length > 0 && (
                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                      {blockingGaps.length} bloquant{blockingGaps.length > 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>
              </div>
              {caseData.priority && (
                <div>
                  <span className="text-xs text-muted-foreground">Priorité</span>
                  <p className="text-sm font-semibold capitalize">{caseData.priority}</p>
                </div>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Rafraîchir
            </Button>
          </CardContent>
        </Card>

        {/* ── Thread Intent Display ── */}
        {(() => {
          const latestIntentEvent = events.find((e: any) => e.event_type === "thread_intent_v1") ?? null;
          const intentObj = (latestIntentEvent?.event_data as any)?.intent ?? null;
          const intentType = intentObj?.intent_type ?? (latestIntentEvent?.event_data as any)?.intent_type ?? null;
          const intentConfidence = intentObj?.confidence ?? (latestIntentEvent?.event_data as any)?.confidence ?? null;
          const intentRisk = intentObj?.risk_level ?? (latestIntentEvent?.event_data as any)?.risk_level ?? null;

          const applyIntentToCase = async () => {
            if (!caseId || !latestIntentEvent?.id) {
              toast.error("Aucun intent à appliquer");
              return;
            }
            setIsApplyingIntent(true);
            try {
              const { data, error } = await supabase.functions.invoke("apply-thread-intent-v1", {
                body: { case_id: caseId, intent_event_id: latestIntentEvent.id },
              });
              if (error) throw error;
              if (data?.ok) {
                toast.success(`Intent appliqué : ${data.applied_count} action(s) créée(s), ${data.skipped_count} ignorée(s)`);
                refetchEvents();
              } else {
                toast.error(`Erreur : ${data?.error ?? "Apply intent échoué"}`);
              }
            } catch (e: any) {
              toast.error(`Erreur apply intent : ${e?.message ?? "unknown"}`);
            } finally {
              setIsApplyingIntent(false);
            }
          };

          return latestIntentEvent ? (
            <Card className="mb-6 border-accent/30 bg-accent/5">
              <CardContent className="py-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Badge variant="secondary">Intent : {intentType ?? "—"}</Badge>
                  {intentConfidence != null && (
                    <span className="text-xs text-muted-foreground">
                      Confiance : {Math.round(intentConfidence * 100)}%
                    </span>
                  )}
                  {intentRisk && (
                    <Badge variant={intentRisk === "high" ? "destructive" : "outline"} className="text-[10px]">
                      Risque : {intentRisk}
                    </Badge>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={applyIntentToCase}
                  disabled={isApplyingIntent}
                >
                  {isApplyingIntent ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Play className="mr-2 h-3 w-3" />}
                  Appliquer intent
                </Button>
              </CardContent>
            </Card>
          ) : (
            <p className="text-xs text-muted-foreground mb-4">Aucun intent analysé</p>
          );
        })()}

        {/* ── Open Actions (C2/P0.3) — hidden for active dossiers (ORCH-SYNC-2) ── */}
        {['SENT', 'ACCEPTED', 'REJECTED', 'ARCHIVED'].includes(caseData.status) && (
        <Card className="mb-6">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              Actions
              {openActions.length > 0 && (
                <Badge variant="secondary" className="text-[10px] ml-1">{openActions.length}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="py-2 px-4">
            {openActions.length === 0 ? (
              <p className="text-xs text-muted-foreground">Aucune action ouverte</p>
            ) : (
              <div className="space-y-3">
                {openActions.map((action: any) => {
                  const ed = action.event_data as Record<string, unknown> | null;
                   const dedupeKey = ed?.["dedupe_key"] as string;
                   const actionCode = ed?.["action_code"] as string | undefined;
                  const isPrepareReply = actionCode === "PREPARE_CLIENT_REPLY_DRAFT" || actionCode === "REQUEST_CLIENT_INFO_FOR_GAPS";
                  const existingDraft = draftsByActionKey.get(dedupeKey);

                  return (
                    <div key={dedupeKey} className="border rounded p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {(ed?.["title_fr"] as string) ?? actionCode ?? "Action"}
                          </p>
                          {ed?.["description_fr"] && (
                            <p className="text-xs text-muted-foreground truncate">{ed["description_fr"] as string}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 ml-2 shrink-0">
                          {isPrepareReply && !existingDraft && (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={generatingDraftKey === dedupeKey}
                              onClick={() => generateDraft(dedupeKey)}
                            >
                              {generatingDraftKey === dedupeKey ? (
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              ) : (
                                <Mail className="mr-1 h-3 w-3" />
                              )}
                              Générer brouillon
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={closingActionKey === dedupeKey}
                            onClick={() => closeAction(dedupeKey)}
                          >
                            {closingActionKey === dedupeKey ? (
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            ) : (
                              <Check className="mr-1 h-3 w-3" />
                            )}
                            Marquer comme fait
                          </Button>
                        </div>
                      </div>

                      {/* Draft display */}
                      {existingDraft && (
                        <div className="bg-muted rounded p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold text-muted-foreground">Brouillon généré</p>
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2"
                                onClick={() => copyDraftToClipboard(existingDraft)}
                              >
                                <Copy className="mr-1 h-3 w-3" />
                                Copier
                              </Button>
                              {/* CL1: Mark as sent — scoped to this draft's gap_keys only */}
                              {actionCode === "REQUEST_CLIENT_INFO_FOR_GAPS" && existingDraft?.requestedGapKeys?.length > 0 && (() => {
                                const draftGapKeys = existingDraft.requestedGapKeys;
                                const hasDraftedForTheseGaps = (clientGapRequests as any[]).some(
                                  (r: any) => r.status === "drafted" && draftGapKeys.includes(r.gap_key)
                                );
                                return hasDraftedForTheseGaps ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2"
                                    onClick={() => markClientGapRequestsSent(draftGapKeys)}
                                    disabled={isMarkingSent}
                                  >
                                    {isMarkingSent ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Send className="mr-1 h-3 w-3" />}
                                    Envoyé
                                  </Button>
                                ) : null;
                              })()}
                            </div>
                          </div>
                          <p className="text-sm font-medium">{existingDraft.subject}</p>
                          <pre className="text-sm whitespace-pre-wrap font-sans text-muted-foreground">{existingDraft.body}</pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Actions clôturées ── */}
        {doneActions.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <CardTitle className="text-lg">Actions clôturées</CardTitle>
                <Badge variant="secondary">{doneActions.length}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-1">
              {doneActions.slice(0, 10).map((action: any) => {
                const ed = action.event_data as Record<string, unknown>;
                const label = (ed["title_fr"] as string) ?? (ed["action_code"] as string) ?? "Action";
                const createdAt = action.created_at ? new Date(action.created_at).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
                return (
                  <div key={action.id} className="flex items-center gap-2 py-1">
                    <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                    <span className="text-sm">{label}</span>
                    {createdAt && <span className="text-xs text-muted-foreground ml-auto">{createdAt}</span>}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* M27b: CL1 tracking moved — single instance near gaps (line ~2147) */}

        {/* ── Analyse dernière réponse client (C3/P0) ── */}
        {(() => {
          const replyAnalysisEvent = events.find((e: any) => {
            if (e.event_type !== "output_generated") return false;
            const ed = e.event_data as Record<string, unknown> | null;
            return ed?.["kind"] === "reply_analysis_v1";
          }) ?? null;

          if (!replyAnalysisEvent) return null;

          const ed = replyAnalysisEvent.event_data as Record<string, unknown> | null;
          const analysis = (ed?.["analysis"] ?? null) as Record<string, unknown> | null;
          if (!analysis) return null;

          const proposedFacts = Array.isArray(analysis["proposed_facts"]) ? analysis["proposed_facts"] as Record<string, unknown>[] : [];
          const openQuestions = Array.isArray(analysis["open_questions"]) ? analysis["open_questions"] as string[] : [];
          const readyToPrice = Boolean(analysis["ready_to_price"]);
          const replyRecommended = Boolean(analysis["reply_recommended"]);

          const displayValue = (f: Record<string, unknown>) => {
            if (typeof f["value_text"] === "string" && f["value_text"]) return f["value_text"];
            if (typeof f["value_num"] === "number") return String(f["value_num"]);
            if (f["value_json"] != null) return JSON.stringify(f["value_json"]).slice(0, 200);
            return "—";
          };

          return (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-accent" />
                  <CardTitle className="text-lg">Analyse dernière réponse client</CardTitle>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant={readyToPrice ? "default" : "secondary"}>
                    {readyToPrice ? "Prêt à chiffrer" : "Infos incomplètes"}
                  </Badge>
                  {replyRecommended && (
                    <Badge variant="outline">Réponse recommandée</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {proposedFacts.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-1">Faits proposés ({proposedFacts.length})</p>
                    <div className="space-y-1">
                    {proposedFacts.slice(0, 10).map((f, i) => {
                        const alreadyApplied = isFactAlreadyApplied(f);
                        const factKey = String(f["fact_key"] ?? "").trim();
                        const isApplying = applyingFactKey === factKey;
                        return (
                          <div key={i} className="flex items-center gap-2 text-sm">
                            <Badge variant="outline" className="text-[10px] shrink-0">
                              {factKey}
                            </Badge>
                            <span className="truncate">{displayValue(f)}</span>
                            {typeof f["confidence"] === "number" && (
                              <span className="text-xs text-muted-foreground shrink-0">
                                {Math.round((f["confidence"] as number) * 100)}%
                              </span>
                            )}
                            <span className="ml-auto shrink-0">
                              {alreadyApplied ? (
                                <Badge variant="secondary" className="text-[10px]">✓ Appliqué</Badge>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 text-xs"
                                  disabled={isApplying}
                                  onClick={() => applyProposedFact(f)}
                                >
                                  {isApplying ? <Loader2 className="h-3 w-3 animate-spin" /> : "Insérer"}
                                </Button>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {openQuestions.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-1">Questions ouvertes</p>
                    <ul className="list-disc list-inside text-sm text-muted-foreground space-y-0.5">
                      {openQuestions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })()}

        {allDrafts.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-accent" />
                <CardTitle className="text-lg">Brouillons de réponse</CardTitle>
                <Badge variant="secondary">{allDrafts.length}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {allDrafts.map(d => (
                <div key={d.id} className="bg-muted rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">{d.draft.subject}</p>
                      <Badge variant="outline" className={`text-[10px] shrink-0 ${d.sourceLabel === "Client" ? "bg-blue-100 text-blue-800 border-blue-300" : "bg-accent/20 text-accent-foreground border-accent/30"}`}>
                        {d.sourceLabel}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{new Date(d.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        onClick={() => copyDraftToClipboard(d.draft)}
                      >
                        <Copy className="mr-1 h-3 w-3" />
                        Copier
                      </Button>
                    </div>
                  </div>
                  <pre className="text-sm whitespace-pre-wrap font-sans text-muted-foreground">{d.draft.body}</pre>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Shared gap save handler — extracted to avoid duplication */}
        {(() => {
          // P0: Extracted saveGapAnswer with allowAutoPricing flag
          const saveGapAnswer = async (g: any, allowAutoPricing: boolean, rawOverride?: string) => {
            if (!caseId) return;
            const raw = rawOverride ?? gapInputs[g.gap_key] ?? "";
            const isNumeric = NUMERIC_FACT_KEYS.has(g.gap_key);
            setSavingGapKey(g.gap_key);
            try {
              const payload: Record<string, unknown> = {
                case_id: caseId,
                fact_key: g.gap_key,
              };
              if (isNumeric) {
                const num = Number(raw);
                if (!Number.isFinite(num) || num <= 0 || (g.gap_key === "cargo.pieces_count" && !Number.isInteger(num))) {
                  throw new Error(g.gap_key === "cargo.pieces_count" ? "Entier positif requis" : "Nombre positif requis");
                }
                payload.value_number = num;
                payload.value_text = null;
              } else {
                if (!raw.trim()) throw new Error("Valeur requise");
                payload.value_text = raw.trim();
                payload.value_number = null;
              }
              const { error } = await supabase.functions.invoke("set-case-fact", { body: payload });
              if (error) throw error;
              toast.success(`${g.gap_key} enregistré`);
              setGapInputs((prev) => { const n = { ...prev }; delete n[g.gap_key]; return n; });
              // Relancer build-case-puzzle et attendre la fin avant refresh
              if (caseId) {
                try {
                  await runBuildCasePuzzleAsync(caseId);
                } catch (e) {
                  console.warn("[saveGapAnswer] build-case-puzzle:", e);
                }
              }
              await handleRefresh();

              // ── Auto-pricing si plus aucun gap bloquant (uniquement pour gaps bloquants) ──
              if (allowAutoPricing && caseId && !isLocked && caseData?.status !== "SENT" && caseData?.status !== "ARCHIVED" && caseData?.status !== "PRICING_RUNNING") {
                try {
                  const { data: updatedGaps } = await supabase
                    .from("quote_gaps")
                    .select("id")
                    .eq("case_id", caseId)
                    .eq("status", "open")
                    .eq("is_blocking", true);

                  const noBlockingGaps = !updatedGaps || updatedGaps.length === 0;

                  if (noBlockingGaps) {
                    // PRICING-GUARD: check open communication loops before auto-pricing
                    const [eqrOpenCheck, factsProposedCheck, clientGapsOpenCheck] = await Promise.all([
                      supabase.from("external_quote_requests").select("id", { count: "exact", head: true }).eq("case_id", caseId).neq("status", "closed"),
                      supabase.from("external_quote_response_facts").select("id", { count: "exact", head: true }).eq("case_id", caseId).eq("validation_status", "proposed"),
                      supabase.from("client_gap_requests" as any).select("id", { count: "exact", head: true }).eq("case_id", caseId).in("status", ["drafted", "sent", "answered"] as string[]),
                    ]);
                    const openCommCount = (eqrOpenCheck.count ?? 0) + (factsProposedCheck.count ?? 0) + (clientGapsOpenCheck.count ?? 0);
                    if (openCommCount > 0) {
                      toast.info("Boucle communication en cours — pricing automatique reporté.");
                      setPricingRefreshToken(t => t + 1);
                      await handleRefresh();
                      return;
                    }

                    const { data: recentRun } = await supabase
                      .from("pricing_runs")
                      .select("status")
                      .eq("case_id", caseId)
                      .order("created_at", { ascending: false })
                      .limit(1)
                      .maybeSingle();

                    if (recentRun?.status !== "running" && recentRun?.status !== "success") {
                      toast.info("Tous les gaps résolus — lancement automatique du pricing…");
                      const { data: pricingResult, error: pricingError } = await supabase.functions.invoke("run-pricing", {
                        body: { case_id: caseId },
                      });
                      if (pricingError || pricingResult?.pricing_blockers?.length > 0) {
                        const reason = pricingResult?.message || pricingError?.message || 'Pricing bloqué';
                        console.warn("[auto-pricing] blocked or failed:", reason);
                        toast.warning(reason);
                      } else {
                        toast.success("Pricing lancé automatiquement");
                      }
                      setPricingRefreshToken(t => t + 1);
                      await handleRefresh();
                    }
                  }
                } catch (e) {
                  console.warn("[saveGapAnswer] auto run-pricing failed:", e);
                }
              }
            } catch (err) {
              toast.error((err as Error).message);
            } finally {
              setSavingGapKey(null);
            }
          };

          const renderGapRow = (g: any, allowAutoPricing: boolean, textColorClass = "text-foreground") => {
            const isEditable = EDITABLE_FACT_KEYS.has(g.gap_key);
            const isNumeric = NUMERIC_FACT_KEYS.has(g.gap_key);
            const isSaving = savingGapKey === g.gap_key;
            const selectOptions = SELECT_FACT_OPTIONS[g.gap_key];

            return (
              <li key={g.id} className={`flex items-center gap-2 text-sm ${textColorClass}`}>
                <span className="flex-1">{g.question_fr || g.gap_key}</span>
                {isEditable && !isLocked && (
                  <div className="flex items-center gap-1.5">
                    {selectOptions ? (
                      <Select
                        value={gapInputs[g.gap_key] || ""}
                        onValueChange={(val) => {
                          setGapInputs((prev) => ({ ...prev, [g.gap_key]: val }));
                          saveGapAnswer(g, allowAutoPricing, val);
                        }}
                        disabled={isSaving}
                      >
                        <SelectTrigger className="h-8 w-40 text-foreground bg-background">
                          <SelectValue placeholder="Choisir…" />
                        </SelectTrigger>
                        <SelectContent>
                          {selectOptions.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        type={isNumeric ? "number" : "text"}
                        placeholder={isNumeric ? "ex: 12" : "Saisir…"}
                        className="h-8 w-32 text-foreground bg-background"
                        value={gapInputs[g.gap_key] || ""}
                        onChange={(e) => setGapInputs((prev) => ({ ...prev, [g.gap_key]: e.target.value }))}
                        onKeyDown={(e) => e.key === "Enter" && saveGapAnswer(g, allowAutoPricing)}
                        disabled={isSaving}
                        min={isNumeric ? 1 : undefined}
                      />
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8 px-2"
                      onClick={() => saveGapAnswer(g, allowAutoPricing)}
                      disabled={isSaving || !(gapInputs[g.gap_key] || "").trim()}
                    >
                      {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    </Button>
                  </div>
                )}
              </li>
            );
          };

          return (
            <>
              <div className="mb-3 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAnalyzeServiceScope}
                  disabled={isServiceScopeAnalyzing || !caseId || !caseData?.thread_id}
                >
                  {isServiceScopeAnalyzing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Comprendre le périmètre
                </Button>
              </div>

              {/* Phase 1: Service scope understanding panel */}
              <CaseUnderstandingPanel events={events as any} />
              {/* Blocking gaps alert */}
              {blockingGaps.length > 0 && (
                <Alert variant="destructive" className="mb-6">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <p className="font-semibold mb-2">
                      {blockingGaps.length} gap{blockingGaps.length > 1 ? 's' : ''} bloquant{blockingGaps.length > 1 ? 's' : ''}
                    </p>
                    <ul className="space-y-3">
                      {blockingGaps.map((g: any) => renderGapRow(g, true, "text-red-800"))}
                    </ul>
                    {!isLocked && blockingGaps.some((g: any) => CLIENT_RESOLVABLE_GAP_KEYS.has(g.gap_key)) && (
                      <div className="mt-3 pt-3 border-t border-destructive/20 flex justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs"
                          onClick={() => askClientForGaps()}
                          disabled={askingClientForGaps}
                          title="Génère un brouillon pour tous les gaps client-résolvables ouverts du dossier"
                        >
                          {askingClientForGaps ? (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          ) : (
                            <Mail className="mr-1 h-3 w-3" />
                          )}
                          Préparer une demande client (tous les gaps ouverts)
                        </Button>
                      </div>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {/* P0: Non-blocking open gaps — visible only when all blocking gaps are resolved */}
              {nonBlockingOpenGaps.length > 0 && blockingGaps.length === 0 && (
                <Alert className="mb-6 border-blue-200 bg-blue-50">
                  <HelpCircle className="h-4 w-4 text-blue-600" />
                  <AlertDescription>
                    <p className="font-semibold mb-2 text-blue-800">
                      {nonBlockingOpenGaps.length} question{nonBlockingOpenGaps.length > 1 ? 's' : ''} ouverte{nonBlockingOpenGaps.length > 1 ? 's' : ''} (non bloquante{nonBlockingOpenGaps.length > 1 ? 's' : ''})
                    </p>
                    <ul className="space-y-3">
                      {nonBlockingOpenGaps.map((g: any) => renderGapRow(g, false, "text-blue-800"))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
            </>
          );
        })()}

        {/* Phase CL1: Client clarifications tracking — positioned right after gaps for visual continuity */}
        {caseId && (clientGapRequests as any[]).length > 0 && (
          <Card className="mb-6 border-blue-200 bg-blue-50/30">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Mail className="h-4 w-4 text-blue-600" />
                Clarifications client
                <Badge variant="secondary" className="text-[10px] ml-1">
                  {(clientGapRequests as any[]).length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="py-2 px-4">
              <div className="space-y-1.5">
                {(clientGapRequests as any[]).map((req: any) => {
                  const statusConfig: Record<string, { label: string; icon: string; className: string }> = {
                    drafted: { label: "Brouillon", icon: "📝", className: "bg-muted text-muted-foreground" },
                    sent: { label: "Envoyée", icon: "📤", className: "bg-blue-100 text-blue-800" },
                    answered: { label: "Réponse détectée", icon: "📩", className: "bg-amber-100 text-amber-800" },
                    validated: { label: "Validée", icon: "✅", className: "bg-green-100 text-green-800" },
                    cancelled: { label: "Annulée", icon: "❌", className: "bg-muted text-muted-foreground" },
                  };
                  const cfg = statusConfig[req.status] || statusConfig.drafted;
                  const gap = gaps.find((g: any) => g.gap_key === req.gap_key);
                  const questionLabel = gap?.question_fr || req.gap_key;

                  return (
                    <div key={req.id} className="flex items-center gap-2 text-sm py-1">
                      <span>{cfg.icon}</span>
                      <span className="flex-1 truncate">{questionLabel}</span>
                      <Badge variant="outline" className={`text-[10px] shrink-0 ${cfg.className}`}>
                        {cfg.label}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* P1.1: Multi-request lines panel */}
        {caseId && <MultiRequestLinesPanel caseId={caseId} />}

        {/* Action Panel — visible for actionable statuses */}
        {['INTAKE', 'FACTS_PARTIAL', 'NEED_INFO', 'READY_TO_PRICE', 'DECISIONS_PENDING', 'DECISIONS_COMPLETE', 'ACK_READY_FOR_PRICING'].includes(caseData.status) && (
          <Card className="mb-6 border-primary/30 bg-primary/5">
            <CardContent className="py-4 flex items-center justify-between">
              <div>
                <h3 className="font-semibold">
                  {['READY_TO_PRICE', 'DECISIONS_PENDING', 'DECISIONS_COMPLETE', 'ACK_READY_FOR_PRICING'].includes(caseData.status)
                    ? 'Relancer l\'analyse'
                    : 'Dossier prêt à analyser'}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {['READY_TO_PRICE', 'DECISIONS_PENDING', 'DECISIONS_COMPLETE', 'ACK_READY_FOR_PRICING'].includes(caseData.status)
                    ? 'Prend en compte les nouveaux documents et extracteurs déployés'
                    : `${documentsCount} document(s) uploadé(s) — ${facts?.length ?? 0} fait(s) extrait(s)`}
                </p>
              </div>
              <Button
                onClick={handleLaunchAnalysis}
                disabled={isAnalyzing || (documentsCount === 0 && (!facts || facts.length === 0)) || caseData.status === 'PRICING_RUNNING'}
              >
                {isAnalyzing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                {['READY_TO_PRICE', 'DECISIONS_PENDING', 'DECISIONS_COMPLETE', 'ACK_READY_FOR_PRICING'].includes(caseData.status)
                  ? 'Relancer l\'analyse'
                  : 'Lancer l\'analyse'}
              </Button>
              {hasArticlesDetail && (
                <Button
                  variant="outline"
                  onClick={handleForceRefreshArticles}
                  disabled={isForceRefreshing || isAnalyzing || (documentsCount === 0 && (!facts || facts.length === 0)) || caseData.status === 'PRICING_RUNNING'}
                >
                  {isForceRefreshing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Admin — Forcer refresh articles
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Phase 9.4: DecisionSupportPanel — workflow decisions → ACK */}
        {['DECISIONS_PENDING', 'DECISIONS_COMPLETE'].includes(caseData.status) && (
          <div className="mb-6">
            <DecisionSupportPanel caseId={caseId!} />
          </div>
        )}

        {/* COCKPIT-8: Next action priority banner */}
        {caseId && <NextActionBanner caseId={caseId} />}

        {/* ORCH-ACTION-1: Ready actions panel */}
        {caseId && <ReadyActionsPanel caseId={caseId} />}

        {/* COCKPIT-4: Case Action Plan */}
        {caseId && (
          <div className="mb-6">
            <CaseActionPlan caseId={caseId} />
          </div>
        )}

        {/* COCKPIT-3: Communication summary widget */}
        {caseId && (
          <div className="mb-6">
            <CommunicationSummaryCard caseId={caseId} />
          </div>
        )}

        {/* COCKPIT-7A: Partner requests summary */}
        {caseId && (
          <div className="mb-4">
            <PartnerRequestsSummary caseId={caseId} />
          </div>
        )}

        {/* COCKPIT-7B: Detail per partner / purpose */}
        {caseId && (
          <div className="mb-4">
            <PartnerRequestsDetailView caseId={caseId} />
          </div>
        )}

        {/* Phase EQ1: External partner requests panel */}
        {caseId && (
          <div className="mb-6">
            <ExternalRequestsPanel caseId={caseId} threadId={caseData?.thread_id} />
          </div>
        )}



        {/* Derived Suggestions Panel — before pricing pipeline for optimal timing */}
        {visibleSuggestions.length > 0 && !isLocked && (
          <Card className="mb-6 border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700">
            <CardHeader className="py-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Calculator className="h-4 w-4 text-amber-600" />
                Suggestions intelligentes
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              {visibleSuggestions.map((suggestion) => (
                <div
                  key={suggestion.id}
                  className="flex items-center justify-between p-3 rounded-md bg-background border"
                >
                  <div>
                    <p className="font-medium text-sm">{suggestion.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {suggestion.description} ={" "}
                      <strong>
                        {suggestion.suggestedValue.toLocaleString()} {suggestion.unit}
                      </strong>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => applySuggestion(suggestion)}
                      disabled={isApplyingSuggestion}
                    >
                      {isApplyingSuggestion ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <Check className="mr-1 h-3 w-3" />
                      )}
                      Créer le fait dérivé
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setDismissedSuggestions((prev) =>
                          prev.includes(suggestion.id) ? prev : [...prev, suggestion.id]
                        )
                      }
                    >
                      Ignorer
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Pricing Launch Panel — visible for pricing-eligible statuses */}
        {['READY_TO_PRICE', 'ACK_READY_FOR_PRICING', 'PRICED_DRAFT', 'HUMAN_REVIEW'].includes(caseData.status) && (() => {
          // ── P2: compute pricing prechecks (mirror run-pricing coherence checks) ──
          // P4: Skip global prechecks for multi-lot — run-pricing resolves per-line
          const prechecks: PricingPrecheck[] = [];

          if (!isMultiLot) {
            const getFact = (key: string) => facts.find((f: any) => f.fact_key === key && f.is_current);

            const pkg = String(getFact("service.package")?.value_text ?? "").trim().toUpperCase();
            const incoterm = String(getFact("routing.incoterm")?.value_text ?? "").trim().toUpperCase();
            const scopeWantsDuties = pkg.endsWith("_DDP") || pkg === "DDP" || incoterm === "DDP";

            if (!pkg) {
              prechecks.push({
                code: "SERVICE_PACKAGE_REQUIRED",
                key: "service.package",
                label: "Package de services requis avant pricing"
              });
            }

            if (scopeWantsDuties) {
              const rawHs = String(getFact("cargo.hs_code")?.value_text ?? "");
              const hsCandidates = rawHs.split(/[;,]/).map(c => c.trim().replace(/\D/g, "")).filter(Boolean);
              const firstValid10 = hsCandidates.find(c => c.length === 10);
              const hsDigits = firstValid10 || rawHs.replace(/\D/g, "");
              if (!hsDigits || hsDigits.length !== 10) {
                prechecks.push({ code: "HS_CODE_REQUIRED", key: "cargo.hs_code", label: "Code HS 10 chiffres requis avant pricing" });
              }

              const hasExemption = !!String(getFact("regulatory.exemption_title")?.value_text ?? "").trim();
              const hasRegime = !!String(getFact("customs.regime_code")?.value_text ?? "").trim();
              if (hasExemption && !hasRegime) {
                prechecks.push({ code: "REGIME_REQUIRED_FOR_EXEMPTION", key: "customs.regime_code", label: "Régime douanier requis : exonération détectée" });
              }

              const resolveFactRaw = (f: any) => {
                if (!f) return undefined;
                return f.value_json ?? f.value_number ?? f.value_text;
              };
              const resolveFreightCost = (f: any): number | undefined => {
                const raw = resolveFactRaw(f);
                if (raw == null) return undefined;
                const n = Number(String(raw).trim().replace(/\s/g, "").replace(/,/g, "."));
                return Number.isFinite(n) && n > 0 ? n : undefined;
              };
              const resolveCargoValue = (f: any): number | undefined => {
                const raw = resolveFactRaw(f);
                if (raw == null) return undefined;
                const n = Number(raw);
                return Number.isFinite(n) && n > 0 ? n : undefined;
              };

              const isFobType = ["FOB", "FCA", "FAS", "EXW"].includes(incoterm);
              if (isFobType) {
                if (!resolveFreightCost(getFact("cargo.freight_cost"))) {
                  prechecks.push({ code: "FREIGHT_REQUIRED_FOR_FOB", key: "cargo.freight_cost", label: "Montant fret requis pour incoterm FOB/FCA/FAS/EXW" });
                }
              }

              if (!resolveCargoValue(getFact("cargo.value"))) {
                prechecks.push({ code: "CARGO_VALUE_REQUIRED", key: "cargo.value", label: "Valeur marchandise requise avant pricing" });
              }
            }
          }

          return (
            <div className="mb-6">
              <PartnerCollectionReadinessCard caseId={caseId!} />
              <PricingReadinessCard caseId={caseId!} />
              <PricingLaunchPanel
                caseId={caseId!}
                onComplete={handleRefresh}
                isRerun={['PRICED_DRAFT', 'HUMAN_REVIEW'].includes(caseData.status)}
                blockedByIntent={(() => {
                  const intentEvents = events
                    .filter((e: any) => e.event_type === "thread_intent_v1")
                    .sort((a: any, b: any) =>
                      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                    );
                  const ie = intentEvents[0];
                  if (!ie) return undefined;
                  const iObj = (ie?.event_data as any)?.intent ?? null;
                  const pricingGate = iObj?.pricing_gate ?? (ie?.event_data as any)?.pricing_gate;
                  if (pricingGate === false) {
                    return iObj?.intent_type ?? (ie?.event_data as any)?.intent_type ?? "blocked";
                  }
                  return undefined;
                })()}
                pricingPrechecks={prechecks}
              />
              {/* PRICING-GUARD: Communication warnings — queried locally */}
              <PricingCommWarnings caseId={caseId!} />
            </div>
          );
        })()}

        {/* M9b: Output pipeline stepper — read-only progression indicator */}
        {isPipelineVisible && (() => {
          const steps = [
            { label: "Pricing", done: true },
            { label: "Version", done: pipelineStepperData?.hasVersion ?? false },
            { label: "PDF", done: pipelineStepperData?.hasPdf ?? false },
            { label: "Brouillon", done: pipelineStepperData?.hasDraft ?? false },
            { label: "Envoyé", done: ['SENT', 'ACCEPTED', 'REJECTED'].includes(caseData.status) },
          ];
          return (
            <div className="mb-4 flex items-center gap-1 px-1">
              {steps.map((step, i) => (
                <React.Fragment key={step.label}>
                  <div className="flex items-center gap-1.5">
                    {step.done ? (
                      <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                    ) : (
                      <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 shrink-0" />
                    )}
                    <span className={`text-xs font-medium whitespace-nowrap ${step.done ? 'text-green-700' : 'text-muted-foreground'}`}>
                      {step.label}
                    </span>
                  </div>
                  {i < steps.length - 1 && (
                    <div className={`flex-1 h-px min-w-4 ${step.done ? 'bg-green-400' : 'bg-muted-foreground/20'}`} />
                  )}
                </React.Fragment>
              ))}
            </div>
          );
        })()}

        {/* PAD Reference Card — from current dossier facts */}
        {(() => {
          const padCatFact = facts.find((f: any) => f.fact_key === 'cargo.pad_category' && f.is_current);
          const padRateFact = facts.find((f: any) => f.fact_key === 'cargo.pad_rate_fcfa_per_ton' && f.is_current);
          const padCategory = padCatFact?.value_text ?? null;
          const padRate = padRateFact?.value_number ?? null;

          if (!padCategory) return null;

          return (
            <div className="mb-4 flex items-start gap-3 p-3 bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <Anchor className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-blue-800 dark:text-blue-200">Référence PAD dossier</p>
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  Catégorie {padCategory}
                  {padRate != null ? ` · ${new Intl.NumberFormat('fr-FR').format(padRate)} FCFA/t` : ' · Montant non résolu'}
                </p>
                <p className="text-xs text-blue-600/70 dark:text-blue-400/70 mt-0.5">Source officielle</p>
              </div>
            </div>
          );
        })()}

        {/* Pricing Result Panel — visible after pricing */}
        {['PRICED_DRAFT', 'HUMAN_REVIEW', 'QUOTED_VERSIONED', 'SENT', 'ACCEPTED', 'REJECTED'].includes(caseData.status) && (
          <div className="mb-6">
            <PricingResultPanel caseId={caseId!} isLocked={!!isPostSentLocked} refreshToken={pricingRefreshToken} isProvisional={pricingIsProvisional} />
          </div>
        )}

        {/* Phase 12: Quotation versions */}
        {['PRICED_DRAFT', 'HUMAN_REVIEW', 'QUOTED_VERSIONED', 'SENT', 'ACCEPTED', 'REJECTED'].includes(caseData.status) && (
          <div className="mb-6">
            <QuotationVersionCard caseId={caseId!} isLocked={!!isPostSentLocked} />
          </div>
        )}

        {/* Phase 19A: Send quotation */}
        {['QUOTED_VERSIONED', 'SENT', 'ACCEPTED', 'REJECTED'].includes(caseData.status) && (
          <div className="mb-6">
            <SendQuotationPanel caseId={caseId!} />
          </div>
        )}

        {/* A1: Commercial outcome banner */}
        {isTerminalOutcome && (
          <Alert className={`mb-6 ${caseData.status === 'ACCEPTED' ? 'border-green-500 bg-green-50 dark:bg-green-950/20' : 'border-red-500 bg-red-50 dark:bg-red-950/20'}`}>
            <AlertDescription className="flex items-center gap-2">
              {caseData.status === 'ACCEPTED' ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <span className="font-medium text-green-700 dark:text-green-400">Devis accepté par le client</span>
                </>
              ) : (
                <>
                  <X className="h-5 w-5 text-red-600" />
                  <span className="font-medium text-red-700 dark:text-red-400">Devis refusé par le client</span>
                </>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* A1: Commercial outcome buttons — only when SENT */}
        {caseData.status === 'SENT' && (
          <div className="mb-6 flex gap-3">
            <Button
              variant="outline"
              className="border-green-500 text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950/20"
              onClick={async () => {
                try {
                  const { data, error } = await supabase.functions.invoke('close-commercial-outcome', {
                    body: { case_id: caseId, outcome: 'ACCEPTED' },
                  });
                  if (error) throw error;
                  if (!data?.ok) throw new Error(data?.error?.message || 'Échec');
                  if (data.data?.idempotent) {
                    toast.info('Devis déjà marqué comme accepté');
                  } else {
                    toast.success('Devis marqué comme accepté');
                  }
                  // Refresh case data
                  window.location.reload();
                } catch (err) {
                  toast.error('Erreur', { description: err instanceof Error ? err.message : 'Erreur inconnue' });
                }
              }}
            >
              <Check className="h-4 w-4 mr-2" />
              Client a accepté
            </Button>
            <Button
              variant="outline"
              className="border-red-500 text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/20"
              onClick={async () => {
                try {
                  const { data, error } = await supabase.functions.invoke('close-commercial-outcome', {
                    body: { case_id: caseId, outcome: 'REJECTED' },
                  });
                  if (error) throw error;
                  if (!data?.ok) throw new Error(data?.error?.message || 'Échec');
                  if (data.data?.idempotent) {
                    toast.info('Devis déjà marqué comme refusé');
                  } else {
                    toast.success('Devis marqué comme refusé');
                  }
                  window.location.reload();
                } catch (err) {
                  toast.error('Erreur', { description: err instanceof Error ? err.message : 'Erreur inconnue' });
                }
              }}
            >
              <X className="h-4 w-4 mr-2" />
              Client a refusé
            </Button>
          </div>
        )}



        {/* Tabs */}
        <Tabs defaultValue="facts" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="facts" className="flex items-center gap-2">
              <Puzzle className="h-4 w-4" />
              Faits ({facts.length})
            </TabsTrigger>
            <TabsTrigger value="documents" className="flex items-center gap-2">
              <Paperclip className="h-4 w-4" />
              Documents
            </TabsTrigger>
            <TabsTrigger value="timeline" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              Timeline ({events.length})
            </TabsTrigger>
          </TabsList>

          {/* Facts Tab */}
          <TabsContent value="facts">
            {Object.keys(factsByCategory).length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center space-y-3">
                  <p className="text-muted-foreground">
                    {documentsCount === 0
                      ? "Aucun document uploadé. Ajoutez un document dans l'onglet Documents pour commencer."
                      : "Aucun fait extrait pour le moment."}
                  </p>
                  {documentsCount > 0 && (
                    <Button
                      onClick={handleLaunchAnalysis}
                      disabled={isAnalyzing || isLocked}
                      size="sm"
                    >
                      {isAnalyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Puzzle className="mr-2 h-4 w-4" />}
                      Lancer l'analyse
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {Object.entries(factsByCategory).map(([category, catFacts]) => (
                  <Card key={category}>
                    <CardHeader className="py-3">
                      <CardTitle className="text-base">
                        {CATEGORY_LABELS[category] || category}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-1/3">Clé</TableHead>
                            <TableHead>Valeur</TableHead>
                            <TableHead className="w-24">Confiance</TableHead>
                            <TableHead className="w-20">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {catFacts.map((fact) => {
                            const isEditing = editingFactId === fact.id;
                            const displayValue = (() => {
                              if (fact.fact_key === "cargo.articles_detail" && Array.isArray(fact.value_json)) {
                                const articles = fact.value_json as any[];
                                const hsCount = new Set(articles.map((a: any) => a.hs_code).filter(Boolean)).size;
                                return `${articles.length} article(s) — ${hsCount} HS`;
                              }
                              return fact.value_text ||
                                (fact.value_number != null ? String(fact.value_number) : null) ||
                                (fact.value_json ? JSON.stringify(fact.value_json) : "—");
                            })();

                            return (
                              <TableRow key={fact.id}>
                                <TableCell className="font-mono text-xs">
                                  {fact.fact_key}
                                </TableCell>
                                <TableCell>
                                  {isEditing ? (
                                    SELECT_FACT_OPTIONS[fact.fact_key] ? (
                                      <Select value={editValue} onValueChange={setEditValue}>
                                        <SelectTrigger className="h-8">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {SELECT_FACT_OPTIONS[fact.fact_key].map((opt) => (
                                            <SelectItem key={opt.value} value={opt.value}>
                                              {opt.label}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    ) : fact.fact_key === "cargo.articles_detail" ? (
                                      <Textarea
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Escape") cancelEdit();
                                          // No save on Enter — needed for JSON newlines
                                        }}
                                        className="h-32 font-mono text-xs"
                                        autoFocus
                                      />
                                    ) : (
                                      <Input
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") handleSaveFact(fact);
                                          if (e.key === "Escape") cancelEdit();
                                        }}
                                        className="h-8"
                                        autoFocus
                                      />
                                    )
                                  ) : (
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span>{displayValue}</span>
                                      {fact.source_type === "manual_input" && (
                                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                          Opérateur
                                        </Badge>
                                      )}
                                      {isMultiLot && MULTI_LOT_AMBIGUOUS_FACTS.has(fact.fact_key) && (
                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-400 text-amber-600">
                                          ⚠ Multi-lot
                                        </Badge>
                                      )}
                                    </div>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {fact.confidence != null ? (
                                    <Badge
                                      variant="outline"
                                      className={
                                        fact.confidence >= 0.8
                                          ? "border-green-500 text-green-700"
                                          : fact.confidence >= 0.5
                                          ? "border-yellow-500 text-yellow-700"
                                          : "border-red-500 text-red-700"
                                      }
                                    >
                                      {Math.round(fact.confidence * 100)}%
                                    </Badge>
                                  ) : (
                                    "—"
                                  )}
                                </TableCell>
                                <TableCell>
                                  {isEditing ? (
                                    <div className="flex gap-1">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        onClick={() => handleSaveFact(fact)}
                                        disabled={isSavingFact}
                                      >
                                        {isSavingFact ? (
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                          <Check className="h-3 w-3" />
                                        )}
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        onClick={cancelEdit}
                                        disabled={isSavingFact}
                                      >
                                        <X className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  ) : (
                                    <div className="flex gap-1">
                                      {EDITABLE_FACT_KEYS.has(fact.fact_key) && !isLocked && (
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7"
                                          onClick={() => startEdit(fact)}
                                        >
                                          <Pencil className="h-3 w-3" />
                                        </Button>
                                      )}
                                      <FactHistoryPopover caseId={caseId!} factKey={fact.fact_key} />
                                    </div>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Service Override Panel */}
            <ServiceOverridePanel
              facts={facts}
              caseId={caseId!}
              isLocked={isLocked}
              onSaved={handleRefresh}
            />
          </TabsContent>

          {/* Documents Tab */}
          <TabsContent value="documents">
            {caseId && <CaseDocumentsTab caseId={caseId} />}
          </TabsContent>

          {/* Timeline Tab */}
          <TabsContent value="timeline">
            <Card>
              <CardHeader>
                <CardTitle>Historique des événements</CardTitle>
              </CardHeader>
              <CardContent>
                {events.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    Aucun événement enregistré.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-auto">
                    {events.map((event) => (
                      <div
                        key={event.id}
                        className="flex items-start gap-3 p-3 bg-muted rounded text-sm"
                      >
                        <div className="text-muted-foreground whitespace-nowrap">
                          {event.created_at
                            ? new Date(event.created_at).toLocaleString()
                            : ""}
                        </div>
                        <Badge variant="outline" className="shrink-0">
                          {event.event_type}
                        </Badge>
                        {event.new_value && (
                          <span className="text-xs text-muted-foreground truncate">
                            {event.new_value}
                          </span>
                        )}
                        {event.event_data && (
                          <code className="text-xs text-muted-foreground">
                            {JSON.stringify(event.event_data)}
                          </code>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
