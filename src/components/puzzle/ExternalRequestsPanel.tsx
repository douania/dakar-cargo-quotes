import React, { useState } from "react";
import { toast } from "@/hooks/use-toast";
import {
  getNextAction,
  NEXT_ACTION_LABELS,
  NEXT_ACTION_COLORS,
} from "@/features/external-requests/utils/getNextAction";
import { suggestPartnerResponse } from "@/features/external-requests/utils/suggestPartnerResponse";
import { reviewPartnerFact, type FactReviewLevel } from "@/features/external-requests/utils/reviewPartnerFact";
import { getRequestCloseLoopState, type RequestCloseLoopState } from "@/features/external-requests/utils/getRequestCloseLoopState";
import { getThreadEmailSignals } from "@/features/external-requests/utils/getThreadEmailSignals";
import { getThreadContextSummary } from "@/features/external-requests/utils/getThreadContextSummary";
import { getThreadInteractionSignals } from "@/features/external-requests/utils/getThreadInteractionSignals";
import { getThreadConsolidationGroups } from "@/features/external-requests/utils/getThreadConsolidationGroups";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  AlertCircle,
  Send,
  Plus,
  Check,
  X,
  Loader2,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Package,
  Search,
  RefreshCw,
  Radar,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import {
  useExternalRequests,
  type ExternalRequest,
  type ExternalResponse,
  type ExternalResponseFact,
} from "@/hooks/useExternalRequests";
import { useExternalRequestFlow } from "@/hooks/useExternalRequestFlow";
import { usePartnerSuggestions, type PartnerSuggestion } from "@/hooks/usePartnerSuggestions";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  response_received: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  response_analyzed: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  partially_validated: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  facts_validated: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  closed: "bg-muted text-muted-foreground",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  sent: "Envoyée",
  response_received: "Réponse reçue",
  response_analyzed: "Analysée",
  partially_validated: "Validation partielle",
  facts_validated: "Faits validés",
  closed: "Clôturée",
};

const PURPOSE_OPTIONS = [
  { value: "origin_charges", label: "Frais d'origine" },
  { value: "freight_rate", label: "Taux de fret" },
  { value: "air_tariff", label: "Tarif aérien" },
  { value: "pre_carriage", label: "Pré-acheminement" },
  { value: "documentation", label: "Documentation" },
  { value: "general", label: "Autre / Général" },
];

const VALIDATION_COLORS: Record<string, string> = {
  proposed: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  validated: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

interface Props {
  caseId: string;
  threadId?: string | null;
}

export function ExternalRequestsPanel({ caseId, threadId }: Props) {
  const {
    requests,
    responses,
    facts,
    isLoading,
    createRequest,
    triggerAnalysis,
    rejectFact,
    closeRequest,
  } = useExternalRequests(caseId);

  const { sendRequest, validateFactAndRerun, isPricingRerunning } = useExternalRequestFlow(caseId);

  const {
    pendingSuggestions,
    scanSuggestions,
    confirmSuggestion,
    rejectSuggestion,
    getPendingForRequest,
    getSuggestionsForRequest,
  } = usePartnerSuggestions(caseId);

  const [showForm, setShowForm] = useState(false);
  const [expandedRequests, setExpandedRequests] = useState<Set<string>>(new Set());
  const [analysisTarget, setAnalysisTarget] = useState<{ requestId: string; emailId: string } | null>(null);
  const [editingEmail, setEditingEmail] = useState<Record<string, string>>({});
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [expandedThreadIds, setExpandedThreadIds] = useState<Set<string>>(new Set());
  const [validatingFactId, setValidatingFactId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    partner_name: "",
    partner_email: "",
    purpose: "",
    purpose_detail: "",
    related_lot_index: undefined as number | undefined,
  });

  // Load thread emails for the analysis dropdown
  const { data: threadEmails = [] } = useQuery({
    queryKey: ["thread-emails-for-analysis", threadId],
    queryFn: async () => {
      if (!threadId) return [];
      const { data, error } = await supabase
        .from("emails")
        .select("id, subject, from_address, received_at")
        .eq("thread_ref", threadId)
        .order("received_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as Array<{ id: string; subject: string | null; from_address: string; received_at: string | null }>;
    },
    enabled: !!threadId,
  });

  const toggleExpanded = (id: string) => {
    setExpandedRequests((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = () => {
    if (!formData.partner_name || !formData.purpose) return;
    createRequest.mutate(formData, {
      onSuccess: () => {
        setFormData({ partner_name: "", partner_email: "", purpose: "", purpose_detail: "", related_lot_index: undefined });
        setShowForm(false);
      },
    });
  };

  const getResponsesForRequest = (requestId: string): ExternalResponse[] =>
    responses.filter((r) => r.request_id === requestId);

  const getFactsForRequest = (requestId: string): ExternalResponseFact[] =>
    facts.filter((f) => f.request_id === requestId);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <ExternalLink className="h-4 w-4" />
            Demandes partenaires
            {requests.length > 0 && (
              <Badge variant="secondary" className="ml-1">{requests.length}</Badge>
            )}
            {isPricingRerunning && (
              <Badge variant="outline" className="ml-1 animate-pulse">
                <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                Pricing…
              </Badge>
            )}
          </CardTitle>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => scanSuggestions.mutate()}
              disabled={scanSuggestions.isPending}
            >
              {scanSuggestions.isPending ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Radar className="h-3 w-3 mr-1" />
              )}
              Scanner
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowForm(!showForm)}
            >
              <Plus className="h-3 w-3 mr-1" />
              Nouvelle demande
            </Button>
          </div>
        </div>
        {pendingSuggestions.length > 0 && (
          <div className="flex items-center gap-1.5 mt-1">
            <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">
              {pendingSuggestions.length} suggestion(s) en attente
            </Badge>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Create form */}
        {showForm && (
          <div className="border rounded-lg p-3 space-y-3 bg-muted/50">
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Nom du partenaire"
                value={formData.partner_name}
                onChange={(e) => setFormData({ ...formData, partner_name: e.target.value })}
              />
              <Input
                placeholder="Email (optionnel)"
                value={formData.partner_email}
                onChange={(e) => setFormData({ ...formData, partner_email: e.target.value })}
              />
            </div>
            <Select
              value={formData.purpose}
              onValueChange={(v) => setFormData({ ...formData, purpose: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Objet de la demande" />
              </SelectTrigger>
              <SelectContent>
                {PURPOSE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Textarea
                placeholder="Détails supplémentaires (optionnel)"
                value={formData.purpose_detail}
                onChange={(e) => setFormData({ ...formData, purpose_detail: e.target.value })}
                rows={2}
              />
              <Input
                type="number"
                min={1}
                placeholder="Lot #"
                className="w-20 h-8"
                value={formData.related_lot_index ?? ""}
                onChange={(e) => setFormData({
                  ...formData,
                  related_lot_index: e.target.value ? parseInt(e.target.value, 10) : undefined,
                })}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
                Annuler
              </Button>
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={!formData.partner_name || !formData.purpose || createRequest.isPending}
              >
                {createRequest.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                Créer
              </Button>
            </div>
          </div>
        )}

        {/* Request list */}
        {requests.length === 0 && !showForm && (
          <p className="text-sm text-muted-foreground text-center py-4">
            Aucune demande partenaire pour ce dossier.
          </p>
        )}

        {(() => {
          const usedEmailIds = responses.map((r) => r.source_email_id).filter(Boolean) as string[];
          return requests.map((req) => {
          const isExpanded = expandedRequests.has(req.id);
          const reqResponses = getResponsesForRequest(req.id);
          const reqFacts = getFactsForRequest(req.id);
          const proposedFacts = reqFacts.filter((f) => f.validation_status === "proposed");
          const nextAction = getNextAction({
            status: req.status,
            responsesCount: reqResponses.length,
            proposedFactsCount: proposedFacts.length,
            lastUpdateAt: req.updated_at ?? req.created_at,
          });

          const suggestion = ["sent", "response_received"].includes(req.status)
            ? suggestPartnerResponse(req, threadEmails, usedEmailIds)
            : null;

          const closeLoop = getRequestCloseLoopState(req.status, reqFacts, isPricingRerunning);

          const activeEmailId =
            analysisTarget?.requestId === req.id ? analysisTarget.emailId : null;

          const derivedEmailId =
            activeEmailId ?? (suggestion?.bestEmailId ?? "");

          return (
            <div key={req.id} className="border rounded-lg overflow-hidden">
              {/* Request header */}
              <div
                className="flex items-center gap-2 p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => toggleExpanded(req.id)}
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0 flex items-center gap-1.5">
                  <span className="font-medium text-sm">{req.partner_name}</span>
                  {req.created_by === null && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-300 text-blue-700 dark:border-blue-600 dark:text-blue-300">
                      Système
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground ml-1">
                    {PURPOSE_OPTIONS.find((o) => o.value === req.purpose)?.label || req.purpose}
                  </span>
                </div>
                <Badge className={STATUS_COLORS[req.status] || ""} variant="secondary">
                  {STATUS_LABELS[req.status] || req.status}
                </Badge>
                <Badge className={`text-[10px] ${NEXT_ACTION_COLORS[nextAction]}`} variant="secondary">
                  {NEXT_ACTION_LABELS[nextAction]}
                </Badge>
                {proposedFacts.length > 0 && (
                  <Badge variant="destructive" className="text-xs">
                    {proposedFacts.length} à valider
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatDistanceToNow(new Date(req.created_at), { addSuffix: true, locale: fr })}
                </span>
              </div>

              {/* Expanded content */}
              {isExpanded && (
                <div className="border-t p-3 space-y-3">
                  {/* Details */}
                  {req.created_by === null && req.status === "draft" && (
                    <div className="flex items-start gap-2 p-2 rounded bg-blue-50 dark:bg-blue-950/30 text-xs text-blue-700 dark:text-blue-300">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      Demande créée automatiquement suite à un gap fret bloquant. Renseignez l'email du partenaire puis cliquez sur Envoyer.
                    </div>
                  )}
                  {req.purpose_detail && (
                    <p className="text-sm text-muted-foreground whitespace-pre-line">{req.purpose_detail}</p>
                  )}

                  {/* COM-2A: Suggestion banners */}
                  {(() => {
                    const reqSuggestions = getSuggestionsForRequest(req.id);
                    const pending = reqSuggestions.filter((s) => s.suggestion_status === "pending");
                    const accepted = reqSuggestions.filter((s) => s.suggestion_status === "accepted");
                    const rejected = reqSuggestions.filter((s) => s.suggestion_status === "rejected");
                    if (reqSuggestions.length === 0) return null;
                    return (
                      <div className="space-y-1.5">
                        {pending.map((s) => {
                          const matchedEmail = threadEmails.find((e) => e.id === s.suggested_email_id);
                          return (
                            <div key={s.id} className="flex items-center gap-2 p-2 rounded border border-primary/20 bg-primary/5 text-xs">
                              <Radar className="h-3.5 w-3.5 text-primary shrink-0" />
                              <div className="flex-1 min-w-0">
                                <span className="font-medium">Suggestion</span>
                                <Badge
                                  variant="outline"
                                  className={`ml-1.5 text-[10px] px-1.5 py-0 ${
                                    s.confidence_level === "high"
                                      ? "border-green-300 text-green-700 dark:border-green-600 dark:text-green-300"
                                      : s.confidence_level === "medium"
                                      ? "border-yellow-300 text-yellow-700 dark:border-yellow-600 dark:text-yellow-300"
                                      : "border-muted-foreground/30 text-muted-foreground"
                                  }`}
                                >
                                  {s.confidence_level === "high" ? "Forte" : s.confidence_level === "medium" ? "Moyenne" : "Faible"}
                                  {" "}({s.score})
                                </Badge>
                                {matchedEmail && (
                                  <span className="text-muted-foreground ml-1.5">
                                    {matchedEmail.from_address.split("@")[0]} — {(matchedEmail.subject || "(sans sujet)").slice(0, 35)}
                                  </span>
                                )}
                                {s.reasons.length > 0 && (
                                  <p className="text-[10px] text-muted-foreground mt-0.5">{s.reasons.slice(0, 2).join(" · ")}</p>
                                )}
                              </div>
                              <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 px-2 text-[10px]"
                                  disabled={confirmSuggestion.isPending}
                                  onClick={() => confirmSuggestion.mutate(s.id)}
                                >
                                  {confirmSuggestion.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3 mr-0.5" />}
                                  Confirmer
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 text-[10px]"
                                  disabled={rejectSuggestion.isPending}
                                  onClick={() => rejectSuggestion.mutate(s.id)}
                                >
                                  <X className="h-3 w-3 mr-0.5" />
                                  Rejeter
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                        {accepted.length > 0 && (
                          <div className="text-[10px] text-muted-foreground px-1">
                            {accepted.length} suggestion(s) confirmée(s)
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Actions */}
                  <div className="flex gap-2 flex-wrap items-end">
                    {req.status === "draft" && (
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <Input
                          type="email"
                          placeholder="Email partenaire"
                          className="h-8 w-[200px] text-xs"
                          value={editingEmail[req.id] ?? req.partner_email ?? ""}
                          onChange={(e) => setEditingEmail((prev) => ({ ...prev, [req.id]: e.target.value }))}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            sendingId !== null ||
                            !(editingEmail[req.id] ?? req.partner_email)
                          }
                          onClick={async () => {
                            setSendingId(req.id);
                            try {
                              if (editingEmail[req.id] && editingEmail[req.id] !== req.partner_email) {
                                const { error: emailSaveErr } = await supabase
                                  .from("external_quote_requests" as any)
                                  .update({ partner_email: editingEmail[req.id] } as any)
                                  .eq("id", req.id);
                                if (emailSaveErr) {
                                  toast({ title: "Erreur", description: "Impossible d'enregistrer l'email du partenaire : " + emailSaveErr.message, variant: "destructive" });
                                  return;
                                }
                              }
                              await sendRequest.mutateAsync(req.id);
                            } finally {
                              setSendingId(null);
                            }
                          }}
                        >
                          {sendingId === req.id ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <Send className="h-3 w-3 mr-1" />
                          )}
                          Envoyer
                        </Button>
                      </div>
                    )}
                    {/* Fix 1: Trigger analysis — available when request is sent or response_received */}
                    {["sent", "response_received"].includes(req.status) && threadEmails.length > 0 && (
                      <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <Select
                            value={derivedEmailId}
                            onValueChange={(emailId) => setAnalysisTarget({ requestId: req.id, emailId })}
                          >
                            <SelectTrigger className="h-8 w-[220px] text-xs">
                              <SelectValue placeholder="Choisir un email…" />
                            </SelectTrigger>
                            <SelectContent>
                              {threadEmails.map((e) => (
                                <SelectItem key={e.id} value={e.id} className="text-xs">
                                  {e.from_address.split("@")[0]} — {(e.subject || "(sans sujet)").slice(0, 40)}
                                  {suggestion?.bestEmailId === e.id ? " ★ Suggéré" : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {suggestion && suggestion.confidence !== "none" && (
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 ${
                                suggestion.confidence === "high"
                                  ? "border-green-300 text-green-700 dark:border-green-600 dark:text-green-300"
                                  : suggestion.confidence === "medium"
                                  ? "border-yellow-300 text-yellow-700 dark:border-yellow-600 dark:text-yellow-300"
                                  : "border-muted-foreground/30 text-muted-foreground"
                              }`}
                            >
                              {suggestion.confidence === "high" ? "Suggestion forte"
                                : suggestion.confidence === "medium" ? "Suggestion moyenne"
                                : "Suggestion faible"}
                            </Badge>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={triggerAnalysis.isPending || !derivedEmailId}
                            onClick={() => {
                              if (derivedEmailId) {
                                triggerAnalysis.mutate(
                                  { request_id: req.id, email_id: derivedEmailId },
                                  { onSuccess: () => setAnalysisTarget(null) }
                                );
                              }
                            }}
                          >
                            {triggerAnalysis.isPending && derivedEmailId ? (
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            ) : (
                              <Search className="h-3 w-3 mr-1" />
                            )}
                            Analyser
                          </Button>
                        </div>
                        {suggestion && suggestion.confidence !== "none" && suggestion.reasons.length > 0 && (
                          <p className="text-[10px] text-muted-foreground pl-1">
                            {suggestion.reasons.slice(0, 2).join(" · ")}
                          </p>
                        )}
                      </div>
                    )}
                    {/* P4.B — Thread Context Summary + P4.A — Thread Timeline */}
                    {["sent", "response_received"].includes(req.status) && (() => {
                      const emailSignals = getThreadEmailSignals(
                        req, threadEmails, usedEmailIds, suggestion?.bestEmailId ?? null
                      );
                      const threadContext = getThreadContextSummary(req, threadEmails, usedEmailIds);
                      const interactionSignals = getThreadInteractionSignals(req, threadEmails);
                      const consolidationGroups = getThreadConsolidationGroups(
                        req, threadEmails, usedEmailIds, suggestion?.bestEmailId ?? null
                      );

                      if (threadContext.totalEmails === 0 && emailSignals.length === 0) return null;

                      return (
                        <div className="border-t pt-2 mt-1 space-y-2">
                          {/* P4.B — Context summary */}
                          {threadContext.totalEmails > 0 && (
                            <div className="flex items-center gap-3 flex-wrap text-[10px] text-muted-foreground px-1">
                              {threadContext.emailsAfterSend > 0 && (
                                <span>{threadContext.emailsAfterSend} email{threadContext.emailsAfterSend > 1 ? "s" : ""} après envoi</span>
                              )}
                              {threadContext.analyzedCount > 0 && consolidationGroups.length === 0 && (
                                <span>{threadContext.analyzedCount} déjà analysé{threadContext.analyzedCount > 1 ? "s" : ""}</span>
                              )}
                              {threadContext.unanalyzedAfterSend > 0 && (
                                <span className="text-orange-600 dark:text-orange-400 font-medium">
                                  {threadContext.unanalyzedAfterSend} non analysé{threadContext.unanalyzedAfterSend > 1 ? "s" : ""}
                                </span>
                              )}
                              {threadContext.lastPartnerEmailAt && (() => {
                                const ts = new Date(threadContext.lastPartnerEmailAt).getTime();
                                if (isNaN(ts)) return null;
                                return (
                                  <span>
                                    Dernier email partenaire : {formatDistanceToNow(new Date(threadContext.lastPartnerEmailAt), { addSuffix: true, locale: fr })}
                                  </span>
                                );
                              })()}
                              {!threadContext.lastPartnerEmailAt && threadContext.totalEmails > 0 && (
                                <span className="italic">Aucun email partenaire détecté</span>
                              )}
                              {threadContext.silenceDays != null && threadContext.silenceDays >= 3 && (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] px-1 py-0 border-amber-300 text-amber-700 dark:border-amber-600 dark:text-amber-400"
                                >
                                  Silence partenaire : {threadContext.silenceDays} jours
                                </Badge>
                              )}
                            </div>
                          )}

                          {/* P4.C — Interaction pattern */}
                          {(interactionSignals.partnerMessagesAfterSend + interactionSignals.ourMessagesAfterSend > 0) && (
                            <p className="text-[10px] text-muted-foreground px-1">
                              {interactionSignals.lastMessageFrom === "us" && "Dernier message : nous"}
                              {interactionSignals.lastMessageFrom === "partner" && "Dernier message : partenaire"}
                              {interactionSignals.hasBackAndForth && " · Aller-retour détecté"}
                            </p>
                          )}

                          {/* P4.D — Consolidation groups */}
                          {consolidationGroups.length > 0 && (
                            <>
                              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                                Groupes d'emails
                              </p>
                              {consolidationGroups.map((group) => (
                                <div key={group.groupKey} className="border rounded p-1.5 space-y-1 bg-muted/30">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[10px] font-medium truncate max-w-[200px]">
                                      {group.label}
                                    </span>
                                    <Badge variant="outline" className="text-[9px] px-1 py-0">
                                      {group.emailCount} email{group.emailCount > 1 ? "s" : ""}
                                    </Badge>
                                    {group.hasSuggested && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 border-green-300 text-green-700 dark:border-green-600 dark:text-green-300">
                                        Suggéré
                                      </Badge>
                                    )}
                                    {group.hasUsed && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 border-muted-foreground/30 text-muted-foreground">
                                        Déjà analysé
                                      </Badge>
                                    )}
                                  </div>
                                  {group.emails.slice(0, 2).map((em) => {
                                    const emDateLabel = (() => {
                                      if (!em.receivedAt) return "Date inconnue";
                                      const ts = new Date(em.receivedAt).getTime();
                                      if (isNaN(ts)) return "Date inconnue";
                                      return formatDistanceToNow(new Date(em.receivedAt), { addSuffix: true, locale: fr });
                                    })();
                                    const isActive = em.emailId === activeEmailId;
                                    const isSuggested = activeEmailId == null && em.emailId === derivedEmailId;
                                    return (
                                      <div
                                        key={em.emailId}
                                        className={`flex items-center gap-1.5 px-1.5 py-1 rounded cursor-pointer transition-colors text-[11px] ${
                                          isActive
                                            ? "bg-accent/50 border border-accent"
                                            : isSuggested
                                            ? "bg-muted/80 border border-muted-foreground/20"
                                            : "hover:bg-muted/50"
                                        }`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setAnalysisTarget({ requestId: req.id, emailId: em.emailId });
                                        }}
                                      >
                                        <span className="font-medium">{em.fromShort}</span>
                                        <span className="text-muted-foreground truncate flex-1">{em.subjectShort}</span>
                                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">{emDateLabel}</span>
                                      </div>
                                    );
                                  })}
                                  {group.emailCount > 2 && (
                                    <p className="text-[10px] text-muted-foreground pl-1.5">
                                      +{group.emailCount - 2} autre{group.emailCount - 2 > 1 ? "s" : ""} email{group.emailCount - 2 > 1 ? "s" : ""}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </>
                          )}

                          {/* P4.F — Progressive disclosure toggle */}
                          {(consolidationGroups.length > 0 || emailSignals.length > 0) && (() => {
                            const isManuallyExpanded = expandedThreadIds.has(req.id);
                            const isFocusExpanded = activeEmailId != null;
                            const isThreadExpanded = isManuallyExpanded || isFocusExpanded;
                            return (
                              <>
                                {!isFocusExpanded && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedThreadIds((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(req.id)) {
                                          next.delete(req.id);
                                        } else {
                                          next.add(req.id);
                                        }
                                        return next;
                                      });
                                    }}
                                    className="text-xs text-muted-foreground hover:text-foreground transition-colors py-0.5"
                                  >
                                    {isManuallyExpanded ? "Masquer le détail" : "Voir le détail"}
                                  </button>
                                )}

                                {/* P4.A — Mini timeline (shown only when expanded) */}
                                {isThreadExpanded && (
                                  <>
                                    {activeEmailId && (
                                      <p className="text-[10px] text-muted-foreground px-1">
                                        Email sélectionné
                                      </p>
                                    )}
                                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                                      Emails du thread
                                    </p>
                                    {emailSignals.map((sig) => {
                                      const isActive = sig.emailId === activeEmailId;
                                      const isSuggested = activeEmailId == null && sig.emailId === derivedEmailId;
                                      const dateLabel = (() => {
                                        if (!sig.receivedAt) return "Date inconnue";
                                        const ts = new Date(sig.receivedAt).getTime();
                                        if (isNaN(ts)) return "Date inconnue";
                                        return formatDistanceToNow(new Date(sig.receivedAt), { addSuffix: true, locale: fr });
                                      })();
                                      return (
                                        <div
                                          key={sig.emailId}
                                          className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors text-xs ${
                                            isActive
                                              ? "bg-accent/50 border border-accent"
                                              : isSuggested
                                              ? "bg-muted/80 border border-muted-foreground/20"
                                              : "hover:bg-muted/50"
                                          }`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setAnalysisTarget({ requestId: req.id, emailId: sig.emailId });
                                          }}
                                        >
                                          <div className="flex-1 min-w-0">
                                            <span className="font-medium">{sig.fromShort}</span>
                                            <span className="text-muted-foreground ml-1.5 truncate">
                                              {sig.subjectShort}
                                            </span>
                                          </div>
                                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                            {dateLabel}
                                          </span>
                                          {sig.tags.length > 0 && (
                                            <div className="flex gap-0.5 shrink-0">
                                              {(consolidationGroups.length > 0
                                                ? sig.tags.filter(t => !["Suggéré", "Déjà analysé", "Partenaire"].includes(t))
                                                : sig.tags
                                              ).map((tag) => (
                                                <Badge
                                                  key={tag}
                                                  variant="outline"
                                                  className="text-[9px] px-1 py-0 leading-tight"
                                                >
                                                  {tag}
                                                </Badge>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      );
                    })()}
                    {req.status !== "closed" && req.status !== "facts_validated" && (
                      <Button
                        size="sm"
                        variant={closeLoop.state === "ready_to_close" ? "outline" : "ghost"}
                        className={closeLoop.state === "ready_to_close" ? "border-green-300 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-950/30" : ""}
                        onClick={(e) => { e.stopPropagation(); closeRequest.mutate(req.id); }}
                      >
                        <X className="h-3 w-3 mr-1" />
                        Clôturer
                      </Button>
                    )}
                  </div>

                  {/* Close-loop status */}
                  {closeLoop.state !== "in_progress" && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 ${
                          closeLoop.state === "already_closed"
                            ? "border-muted-foreground/30 text-muted-foreground"
                            : closeLoop.state === "awaiting_validation"
                            ? "border-orange-300 text-orange-700 dark:border-orange-600 dark:text-orange-300"
                            : closeLoop.state === "pricing_rerunning"
                            ? "border-blue-300 text-blue-700 dark:border-blue-600 dark:text-blue-300"
                            : "border-green-300 text-green-700 dark:border-green-600 dark:text-green-300"
                        }`}
                      >
                        {closeLoop.state === "pricing_rerunning" && (
                          <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" />
                        )}
                        {closeLoop.label}
                      </Badge>
                      {closeLoop.reasons.length > 0 && (
                        <span className="text-[10px] text-muted-foreground">
                          {closeLoop.reasons.slice(0, 2).join(" · ")}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Responses */}
                  {reqResponses.length > 0 && (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Réponses ({reqResponses.length})
                        </p>
                        {reqResponses.map((resp) => (
                          <div key={resp.id} className="text-xs bg-muted/50 rounded p-2">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className="text-xs">
                                {resp.status}
                              </Badge>
                              <span className="text-muted-foreground">
                                {formatDistanceToNow(new Date(resp.received_at), { addSuffix: true, locale: fr })}
                              </span>
                            </div>
                            {resp.raw_excerpt && (
                              <p className="text-muted-foreground line-clamp-2">{resp.raw_excerpt}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {/* M15b: Zero-facts feedback — response analyzed but no exploitable facts */}
                  {reqResponses.length > 0 && reqFacts.length === 0 && 
                   ["response_analyzed", "closed"].includes(req.status) && (
                    <div className="flex items-start gap-2 p-2 rounded bg-orange-50 dark:bg-orange-950/30 text-xs text-orange-700 dark:text-orange-300">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      Aucun fait exploitable n'a été extrait de cette réponse partenaire. Vérifiez le contenu de l'email ou relancez une analyse sur un autre email.
                    </div>
                  )}

                  {/* Proposed facts */}
                  {reqFacts.length > 0 && (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Faits extraits ({reqFacts.length})
                        </p>
                        {reqFacts.map((fact) => {
                          const siblingFacts = reqFacts.filter(
                            (f) => f.fact_key === fact.fact_key && f.id !== fact.id,
                          );
                          const review = fact.validation_status === "proposed"
                            ? reviewPartnerFact(fact, siblingFacts)
                            : null;

                          const REVIEW_COLORS: Record<FactReviewLevel, string> = {
                            strong: "bg-green-100 text-green-800",
                            medium: "bg-yellow-100 text-yellow-800",
                            weak: "bg-gray-100 text-gray-700",
                            conflict: "bg-red-100 text-red-800",
                          };

                          return (
                            <div key={fact.id} className="space-y-1">
                              <div className="flex items-center gap-2 text-sm bg-background border rounded p-2">
                                <Badge
                                  className={VALIDATION_COLORS[fact.validation_status] || ""}
                                  variant="secondary"
                                >
                                  {fact.validation_status === "proposed" ? "Proposé" :
                                   fact.validation_status === "validated" ? "Validé" : "Rejeté"}
                                </Badge>
                                {review && (
                                  <Badge className={REVIEW_COLORS[review.level]}>
                                    {review.label}
                                  </Badge>
                                )}
                                <code className="text-xs font-mono">{fact.fact_key}</code>
                                <span className="flex-1 truncate">
                                  {fact.proposed_value_number != null
                                    ? `${fact.proposed_value_number}${fact.currency ? ` ${fact.currency}` : ""}`
                                    : fact.proposed_value_text || "—"}
                                </span>
                                {fact.confidence != null && (
                                  <span className="text-xs text-muted-foreground">
                                    {Math.round(fact.confidence * 100)}%
                                  </span>
                                )}
                                {fact.validation_status === "proposed" && (
                                  <div className="flex gap-1">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                                      onClick={async () => {
                                        setValidatingFactId(fact.id);
                                        try {
                                          await validateFactAndRerun.mutateAsync({ factId: fact.id, factKey: fact.fact_key });
                                        } finally {
                                          setValidatingFactId(null);
                                        }
                                      }}
                                      disabled={validatingFactId !== null}
                                    >
                                      {validatingFactId === fact.id ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Check className="h-3.5 w-3.5" />
                                      )}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                      onClick={() => rejectFact.mutate(fact.id)}
                                      disabled={rejectFact.isPending}
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                )}
                              </div>
                              {review && review.reasons.length > 0 && (
                                <p className="text-[10px] text-muted-foreground pl-2">
                                  {review.reasons.slice(0, 2).join(" · ")}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        });
        })()}
      </CardContent>
    </Card>
  );
}
