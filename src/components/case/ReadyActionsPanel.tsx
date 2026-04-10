/**
 * ORCH-ACTION-1 — ReadyActionsPanel
 * Executable action items ordered by priority with inline drafts,
 * mutation buttons, and deterministic "next step" sequencing.
 *
 * Reuses the same priority hierarchy as NextActionBanner.computeAction()
 * to avoid a divergent second engine.
 */

import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toFactPayload } from "@/pages/case-view/helpers";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertTriangle,
  ArrowRight,
  Calculator,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Loader2,
  Mail,
  Send,
  ShieldCheck,
  Search,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

/* ─── Types ─── */

type ActionKey =
  | "blocking_gap"
  | "drafted_client_gap"
  | "open_client_gap"
  | "draft_partner"
  | "unsent_partner"
  | "pending_facts"
  | "select_partner"
  | "launch_pricing"
  | "create_version"
  | "apply_facts";

interface ReadyAction {
  type: "client" | "partner" | "internal";
  actionKey: ActionKey;
  priority: "now" | "next" | "waiting" | "later";
  title: string;
  reason: string;
  message?: string;
  target?: string;
  gapKey?: string;
  status:
    | "to_prepare"
    | "ready_to_send"
    | "sent"
    | "waiting_response"
    | "to_execute";
  nextStep?: string;
  icon: React.ReactNode;
  color: string;
}

/* ─── Navigation targets by actionKey ─── */
const ACTION_SCROLL_TARGETS: Partial<Record<ActionKey, string>> = {
  draft_partner: "section-external-requests",
  unsent_partner: "section-external-requests",
  pending_facts: "section-external-requests",
  select_partner: "section-partner-detail",
  launch_pricing: "section-pricing",
  create_version: "section-version",
  apply_facts: "section-reply-analysis",
};

const ACTION_NAV_LABELS: Partial<Record<ActionKey, string>> = {
  draft_partner: "Voir les demandes",
  unsent_partner: "Voir les envois",
  pending_facts: "Voir les faits à valider",
  select_partner: "Voir les offres",
  launch_pricing: "Aller au pricing",
  create_version: "Aller à la version",
  apply_facts: "Voir les faits proposés",
};

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ─── Status hierarchy (P1-A: imported from shared constants) ─── */
import {
  STATUS_ORDER,
  TERMINAL_STATUSES as TERMINAL,
  statusBelow,
} from "@/lib/cockpitStatusConstants";

/* ─── Next-step table (deterministic, no AI) ─── */
const NEXT_STEPS: Record<string, string> = {
  blocking_gap: "À réception de la réponse client, relancer l'analyse puis le pricing",
  drafted_client_gap: "Attendre la réponse du client",
  open_client_gap: "Traiter la réponse puis relancer l'analyse",
  draft_partner: "Préparer et confirmer l'envoi aux partenaires",
  unsent_partner: "Confirmer l'envoi, puis attendre les réponses",
  pending_facts: "Après validation, relancer le pricing",
  apply_facts: "Valider ou rejeter chaque fait, puis relancer l'analyse",
  select_partner: "Sélectionner l'offre, puis relancer le pricing",
  launch_pricing: "Créer la version du devis",
  create_version: "Exporter le PDF",
  export_pdf: "Préparer l'email client",
  prepare_email: "Envoyer le devis au client",
  mark_sent: "Attendre le retour client",
};

/* ─── Status labels ─── */
const STATUS_LABELS: Record<string, string> = {
  to_prepare: "À préparer",
  ready_to_send: "Prêt à envoyer",
  sent: "Envoyé",
  waiting_response: "En attente de réponse",
  to_execute: "À exécuter",
};

const STATUS_COLORS: Record<string, string> = {
  to_prepare: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  ready_to_send: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  sent: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  waiting_response: "bg-muted text-muted-foreground",
  to_execute: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
};

const TYPE_LABELS: Record<string, string> = {
  client: "Client",
  partner: "Partenaire",
  internal: "Interne",
};

const TYPE_COLORS: Record<string, string> = {
  client: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  partner: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  internal: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
};

/* ─── Component ─── */

export function ReadyActionsPanel({ caseId }: { caseId: string }) {
  const queryClient = useQueryClient();
  const [isAskingClient, setIsAskingClient] = useState(false);
  const [isMarkingSent, setIsMarkingSent] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0);

  /* ── Consolidated data query ── */
  const { data, isLoading } = useQuery({
    queryKey: ["ready-actions-panel", caseId],
    staleTime: 30_000,
    enabled: !!caseId,
    queryFn: async () => {
      const [caseRes, gapsRes, clientGapsRes, reqRes, factsRes, versionsRes, currentFactsRes] =
        await Promise.all([
          supabase
            .from("quote_cases")
            .select("status")
            .eq("id", caseId)
            .maybeSingle(),
          supabase
            .from("quote_gaps")
            .select("id, gap_key, gap_category, question_fr, is_blocking, status")
            .eq("case_id", caseId)
            .eq("status", "open")
            .order("is_blocking", { ascending: false }),
          supabase
            .from("client_gap_requests" as any)
            .select("id, gap_key, status, sent_at, draft_subject, draft_body")
            .eq("case_id", caseId)
            .order("created_at", { ascending: false }),
          supabase
            .from("external_quote_requests")
            .select("id, status, email_sent_at, is_selected")
            .eq("case_id", caseId),
          supabase
            .from("external_quote_response_facts")
            .select("id", { count: "exact", head: true })
            .eq("case_id", caseId)
            .eq("validation_status", "proposed"),
          supabase
            .from("quotation_versions")
            .select("id")
            .eq("case_id", caseId)
            .eq("is_selected", true)
            .limit(1),
          supabase
            .from("quote_facts")
            .select("fact_key, value_text, value_number")
            .eq("case_id", caseId)
            .eq("is_current", true),
        ]);

      const status = caseRes.data?.status ?? "INTAKE";
      const gaps = gapsRes.data ?? [];
      const clientGaps = (clientGapsRes.data ?? []) as any[];
      const requests = reqRes.data ?? [];
      const pendingFacts = factsRes.count ?? 0;
      const hasSelectedVersion = (versionsRes.data?.length ?? 0) > 0;

      // Also fetch existing drafts from timeline events
      const { data: draftEvents } = await supabase
        .from("case_timeline_events")
        .select("event_data")
        .eq("case_id", caseId)
        .eq("event_type", "output_generated")
        .order("created_at", { ascending: false })
        .limit(10);

      const drafts = (draftEvents ?? [])
        .filter((e: any) => e.event_data?.kind === "reply_draft_v1" || e.event_data?.output_type === "reply_draft_v1")
        .map((e: any) => e.event_data);

      // P0-B: detect unapplied reply_analysis facts — same logic as isFactAlreadyApplied() in CaseView
      const replyAnalysis = (draftEvents ?? []).find(
        (e: any) => e.event_data?.kind === "reply_analysis_v1"
      );
      const raData = replyAnalysis?.event_data as Record<string, any> | null;
      const raAnalysis = raData?.analysis as Record<string, any> | null;
      const proposedFacts: unknown[] = Array.isArray(raAnalysis?.proposed_facts)
        ? raAnalysis.proposed_facts
        : [];
      const currentFacts = currentFactsRes.data ?? [];
      const unappliedFacts = proposedFacts.filter((f: any) => {
        const payload = toFactPayload(f);
        if (!payload) return false;
        return !currentFacts.some((existing: any) => {
          if (existing.fact_key !== payload.fact_key) return false;
          if (payload.value_number !== null)
            return Number(existing.value_number) === Number(payload.value_number);
          if (payload.value_text !== null)
            return String(existing.value_text ?? "").trim() === payload.value_text;
          return false;
        });
      });
      const hasProposedFacts = unappliedFacts.length > 0;

      return {
        status,
        gaps,
        clientGaps,
        requests,
        pendingFacts,
        hasSelectedVersion,
        drafts,
        hasProposedFacts,
      };
    },
  });

  /* ── Build actions list ── */
  const actions = useMemo<ReadyAction[]>(() => {
    if (!data) return [];
    const { status, gaps, clientGaps, requests, pendingFacts, hasSelectedVersion, drafts, hasProposedFacts } = data;

    if (TERMINAL.has(status)) return [];

    const result: ReadyAction[] = [];
    let priorityIdx = 0;
    const getPriority = () => (priorityIdx++ === 0 ? "now" as const : "next" as const);

    // 1 — Blocking gaps with client question
    const blockingGaps = gaps.filter((g: any) => g.is_blocking);
    if (blockingGaps.length > 0) {
      for (const gap of blockingGaps) {
        const gapRequest = clientGaps.find((r: any) => r.gap_key === gap.gap_key);
        const hasDraft = drafts.some((d: any) =>
          d?.dedupe_key?.includes(gap.gap_key) ||
          d?.body?.includes(gap.gap_key)
        );
        const gapStatus = gapRequest?.status;

        let actionStatus: ReadyAction["status"] = "to_prepare";
        if (gapStatus === "sent") actionStatus = "waiting_response";
        else if (gapStatus === "drafted" || hasDraft) actionStatus = "ready_to_send";
        else if (gapStatus === "answered") actionStatus = "waiting_response";

        result.push({
          type: "client",
          actionKey: "blocking_gap",
          priority: getPriority(),
          title: gap.question_fr || `Résoudre le gap ${gap.gap_key}`,
          reason: `Gap bloquant : ${gap.gap_category ?? gap.gap_key}`,
          message: gap.question_fr ?? undefined,
          target: "Client",
          gapKey: gap.gap_key,
          status: actionStatus,
          nextStep: NEXT_STEPS.blocking_gap,
          icon: <AlertTriangle className="h-4 w-4 text-destructive" />,
          color: "red",
        });
      }
    }

    // 2 — Drafted client gap requests (not yet sent)
    const draftedGaps = clientGaps.filter(
      (r: any) => r.status === "drafted" && !blockingGaps.some((g: any) => g.gap_key === r.gap_key)
    );
    if (draftedGaps.length > 0) {
      result.push({
        type: "client",
        actionKey: "drafted_client_gap",
        priority: getPriority(),
        title: `Envoyer ${draftedGaps.length} clarification(s) client`,
        reason: "Clarifications prêtes mais non envoyées",
        message: draftedGaps[0]?.draft_body ?? undefined,
        target: "Client",
        status: "ready_to_send",
        nextStep: NEXT_STEPS.drafted_client_gap,
        icon: <Mail className="h-4 w-4 text-blue-600" />,
        color: "blue",
      });
    }

    // 3 — Open client gaps (sent, awaiting answer)
    const sentClientGaps = clientGaps.filter((r: any) => r.status === "sent" || r.status === "answered");
    if (sentClientGaps.length > 0 && result.length < 4) {
      result.push({
        type: "client",
        actionKey: "open_client_gap",
        priority: result.length === 0 ? "now" : "waiting",
        title: `${sentClientGaps.length} clarification(s) en attente de réponse client`,
        reason: "Réponses client attendues",
        status: "waiting_response",
        nextStep: NEXT_STEPS.open_client_gap,
        icon: <Search className="h-4 w-4 text-blue-600" />,
        color: "blue",
      });
    }

    // 4 — Draft partner requests
    const draftRequests = requests.filter((r: any) => r.status === "draft");
    if (draftRequests.length > 0 && result.length < 4) {
      result.push({
        type: "partner",
        actionKey: "draft_partner",
        priority: getPriority(),
        title: `Préparer ${draftRequests.length} demande(s) partenaire(s)`,
        reason: "Demandes non préparées",
        target: "Partenaires",
        status: "to_prepare",
        nextStep: NEXT_STEPS.draft_partner,
        icon: <FileText className="h-4 w-4 text-amber-600" />,
        color: "amber",
      });
    }

    // 5 — Unsent partner requests
    const unsentRequests = requests.filter(
      (r: any) => r.status === "sent" && !r.email_sent_at
    );
    if (unsentRequests.length > 0 && result.length < 4) {
      result.push({
        type: "partner",
        actionKey: "unsent_partner",
        priority: getPriority(),
        title: `Confirmer l'envoi de ${unsentRequests.length} demande(s)`,
        reason: "Envois non confirmés",
        target: "Partenaires",
        status: "ready_to_send",
        nextStep: NEXT_STEPS.unsent_partner,
        icon: <Send className="h-4 w-4 text-amber-600" />,
        color: "amber",
      });
    }

    // 6 — Pending partner facts
    if (pendingFacts > 0 && result.length < 4) {
      result.push({
        type: "partner",
        actionKey: "pending_facts",
        priority: getPriority(),
        title: `Valider ${pendingFacts} fait(s) partenaire(s)`,
        reason: "Faits partenaires à valider",
        status: "to_execute",
        nextStep: NEXT_STEPS.pending_facts,
        icon: <ShieldCheck className="h-4 w-4 text-amber-600" />,
        color: "amber",
      });
    }

    // 7 — Select partner offer
    const hasExploitable = requests.some((r: any) =>
      ["response_received", "response_analyzed", "partially_validated", "facts_validated", "closed"].includes(r.status)
    );
    const hasSelected = requests.some((r: any) => r.is_selected);
    if (requests.length > 0 && hasExploitable && !hasSelected && result.length < 4) {
      result.push({
        type: "partner",
        actionKey: "select_partner",
        priority: getPriority(),
        title: "Retenir une offre partenaire",
        reason: "Sélection commerciale non faite",
        status: "to_execute",
        nextStep: NEXT_STEPS.select_partner,
        icon: <CheckCircle2 className="h-4 w-4 text-amber-600" />,
        color: "amber",
      });
    }

    // 8 — Internal sequencing actions (ORCH-SYNC-2: blocked while blocking gaps exist)
    const hasBlockingGaps = blockingGaps.length > 0;

    if (!hasBlockingGaps && statusBelow(status, "PRICED_DRAFT") && result.length < 4) {
      result.push({
        type: "internal",
        actionKey: "launch_pricing",
        priority: getPriority(),
        title: "Lancer le pricing",
        reason: "Aucun blocage majeur",
        status: "to_execute",
        nextStep: NEXT_STEPS.launch_pricing,
        icon: <Calculator className="h-4 w-4 text-emerald-600" />,
        color: "emerald",
      });
    }

    if (!hasBlockingGaps && !hasSelectedVersion && !statusBelow(status, "PRICED_DRAFT") && result.length < 4) {
      result.push({
        type: "internal",
        actionKey: "create_version",
        priority: getPriority(),
        title: "Créer la version du devis",
        reason: "Version non créée",
        status: "to_execute",
        nextStep: NEXT_STEPS.create_version,
        icon: <FileText className="h-4 w-4 text-blue-600" />,
        color: "blue",
      });
    }

    // P0-B: CTA navigation vers faits proposés par analyse réponse client
    if (hasProposedFacts && result.length < 5) {
      result.push({
        type: "client",
        actionKey: "apply_facts",
        priority: "next",
        title: "Faits proposés par l'IA à valider",
        reason: "L'analyse de la réponse client a extrait des faits à vérifier",
        status: "to_execute",
        nextStep: NEXT_STEPS.apply_facts,
        icon: <FileText className="h-4 w-4 text-accent" />,
        color: "blue",
      });
    }

    return result;
  }, [data]);

  /* ── Mutations ── */

  async function handleAskClient() {
    if (!caseId || isAskingClient) return;
    setIsAskingClient(true);
    try {
      // 1. Sync gap actions
      const { error: syncErr } = await supabase.functions.invoke(
        "sync-gap-client-actions",
        { body: { case_id: caseId } }
      );
      if (syncErr) throw syncErr;

      // 2. Find the open action
      const { data: actionRows } = await supabase
        .from("case_timeline_events")
        .select("id, event_data")
        .eq("case_id", caseId)
        .eq("event_type", "manual_action")
        .order("created_at", { ascending: false })
        .limit(50);

      const openAction = (actionRows ?? []).find((row: any) => {
        const ed = row.event_data as Record<string, unknown> | null;
        return (
          ed?.["action_code"] === "REQUEST_CLIENT_INFO_FOR_GAPS" &&
          ed?.["status"] === "open"
        );
      });

      if (!openAction) {
        toast.error("Impossible de retrouver l'action client.");
        return;
      }

      const dedupeKey = (openAction.event_data as Record<string, unknown>)?.[
        "dedupe_key"
      ] as string;
      if (!dedupeKey) {
        toast.error("Action trouvée mais dedupe_key manquant.");
        return;
      }

      // 3. Generate draft
      const { data: draftData, error: draftErr } =
        await supabase.functions.invoke("generate-reply-draft", {
          body: { case_id: caseId, action_dedupe_key: dedupeKey },
        });
      if (draftErr) throw draftErr;

      if (draftData?.ok) {
        toast.success(
          draftData.idempotent
            ? "Brouillon déjà disponible"
            : "Brouillon de demande client généré"
        );
      } else {
        toast.error(`Erreur: ${draftData?.error ?? "Génération échouée"}`);
      }
    } catch (e: any) {
      toast.error(`Erreur: ${e?.message ?? "unknown"}`);
    } finally {
      setIsAskingClient(false);
      invalidateAll();
    }
  }

  async function handleMarkSent() {
    if (!caseId || isMarkingSent) return;
    const draftedKeys = (data?.clientGaps ?? [])
      .filter((r: any) => r.status === "drafted")
      .map((r: any) => r.gap_key as string);
    if (draftedKeys.length === 0) {
      toast.info("Aucune clarification en brouillon");
      return;
    }
    setIsMarkingSent(true);
    try {
      const { data: res, error } = await supabase.functions.invoke(
        "mark-client-gap-request-sent",
        { body: { case_id: caseId, gap_keys: draftedKeys } }
      );
      if (error) throw error;
      if (res?.ok) {
        toast.success(
          `${res.updated} clarification(s) marquée(s) comme envoyée(s)`
        );
      }
    } catch (e: any) {
      toast.error(`Erreur: ${e?.message ?? "unknown"}`);
    } finally {
      setIsMarkingSent(false);
      invalidateAll();
    }
  }

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["ready-actions-panel", caseId] });
    queryClient.invalidateQueries({ queryKey: ["next-action-banner", caseId] });
    queryClient.invalidateQueries({ queryKey: ["case-gaps", caseId] });
    queryClient.invalidateQueries({ queryKey: ["client-gap-requests", caseId] });
    queryClient.invalidateQueries({ queryKey: ["case-timeline", caseId] });
    queryClient.invalidateQueries({ queryKey: ["case-action-plan", caseId] });
    // P1-A: unified cockpit state
    queryClient.invalidateQueries({ queryKey: ["cockpit-state", caseId] });
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(
      () => toast.success("Copié dans le presse-papiers"),
      () => toast.error("Impossible de copier")
    );
  }

  /* ── Render ── */

  if (isLoading || !data || actions.length === 0) return null;

  return (
    <Card className="border-border/50 mb-4">
      <CardContent className="py-4 px-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <ArrowRight className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">
            Actions à exécuter ({actions.length})
          </span>
        </div>

        {actions.map((action, idx) => (
          <Collapsible
            key={idx}
            open={expandedIdx === idx}
            onOpenChange={(open) => setExpandedIdx(open ? idx : null)}
          >
            <div className="rounded-lg border border-border/50 overflow-hidden">
              <CollapsibleTrigger className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-2 flex-wrap">
                  {action.icon}
                  <Badge
                    className={`text-[10px] font-medium ${TYPE_COLORS[action.type]}`}
                  >
                    {TYPE_LABELS[action.type]}
                  </Badge>
                  <Badge
                    className={`text-[10px] font-medium ${STATUS_COLORS[action.status]}`}
                  >
                    {STATUS_LABELS[action.status]}
                  </Badge>
                  {action.priority === "now" && (
                    <Badge className="text-[10px] bg-destructive/10 text-destructive font-semibold">
                      Maintenant
                    </Badge>
                  )}
                  <span className="text-sm font-medium flex-1 min-w-0 truncate">
                    {action.title}
                  </span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                      expandedIdx === idx ? "rotate-180" : ""
                    }`}
                  />
                </div>
              </CollapsibleTrigger>

              <CollapsibleContent>
                <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border/30">
                  {/* Reason */}
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">Pourquoi :</span>{" "}
                    {action.reason}
                  </p>

                  {/* Message block */}
                  {action.message && (
                    <div className="bg-muted/40 rounded-md p-2.5 text-xs leading-relaxed whitespace-pre-wrap border border-border/20">
                      {action.message}
                    </div>
                  )}

                  {/* Action buttons — strictly conditional */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Generate draft: only for blocking gaps without draft/sent status */}
                    {action.type === "client" &&
                      action.gapKey &&
                      action.status === "to_prepare" && (
                        <Button
                          size="sm"
                          variant="default"
                          className="h-7 text-xs"
                          disabled={isAskingClient}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAskClient();
                          }}
                        >
                          {isAskingClient ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <Mail className="h-3 w-3 mr-1" />
                          )}
                          Générer brouillon client
                        </Button>
                      )}

                    {/* Copy message */}
                    {action.message && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(action.message!);
                        }}
                      >
                        <Copy className="h-3 w-3 mr-1" />
                        Copier
                      </Button>
                    )}

                    {/* Mark sent: only for ready_to_send client actions */}
                    {action.type === "client" &&
                      action.status === "ready_to_send" && (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 text-xs"
                          disabled={isMarkingSent}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMarkSent();
                          }}
                        >
                          {isMarkingSent ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <Check className="h-3 w-3 mr-1" />
                          )}
                          Marquer envoyé
                        </Button>
                      )}

                    {/* Navigation button — for actions delegated to specialized panels */}
                    {ACTION_SCROLL_TARGETS[action.actionKey] && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          scrollToSection(ACTION_SCROLL_TARGETS[action.actionKey]!);
                        }}
                      >
                        <ArrowRight className="h-3 w-3 mr-1" />
                        {ACTION_NAV_LABELS[action.actionKey] ?? "Voir"}
                      </Button>
                    )}
                  </div>

                  {/* Next step */}
                  {action.nextStep && (
                    <p className="text-[11px] text-muted-foreground italic">
                      Prochaine étape : {action.nextStep}
                    </p>
                  )}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        ))}
      </CardContent>
    </Card>
  );
}
