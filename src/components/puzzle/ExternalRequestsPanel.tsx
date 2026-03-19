import React, { useState } from "react";
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
    markAsSent,
    triggerAnalysis,
    validateFact,
    rejectFact,
    closeRequest,
  } = useExternalRequests(caseId);

  const { sendRequest, validateFactAndRerun, isPricingRerunning } = useExternalRequestFlow(caseId);

  const [showForm, setShowForm] = useState(false);
  const [expandedRequests, setExpandedRequests] = useState<Set<string>>(new Set());
  const [analysisTarget, setAnalysisTarget] = useState<{ requestId: string; emailId: string } | null>(null);
  const [editingEmail, setEditingEmail] = useState<Record<string, string>>({});
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
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowForm(!showForm)}
          >
            <Plus className="h-3 w-3 mr-1" />
            Nouvelle demande
          </Button>
        </div>
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

        {requests.map((req) => {
          const isExpanded = expandedRequests.has(req.id);
          const reqResponses = getResponsesForRequest(req.id);
          const reqFacts = getFactsForRequest(req.id);
          const proposedFacts = reqFacts.filter((f) => f.validation_status === "proposed");

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
                      Demande créée automatiquement suite à un gap fret bloquant. Complétez le nom du partenaire puis marquez comme envoyée.
                    </div>
                  )}
                  {req.purpose_detail && (
                    <p className="text-sm text-muted-foreground whitespace-pre-line">{req.purpose_detail}</p>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 flex-wrap">
                    {req.status === "draft" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => { e.stopPropagation(); markAsSent.mutate(req.id); }}
                        disabled={markAsSent.isPending}
                      >
                        <Send className="h-3 w-3 mr-1" />
                        Marquer envoyée
                      </Button>
                    )}
                    {/* Fix 1: Trigger analysis — available when request is sent or response_received */}
                    {["sent", "response_received"].includes(req.status) && threadEmails.length > 0 && (
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <Select
                          value={analysisTarget?.requestId === req.id ? analysisTarget.emailId : ""}
                          onValueChange={(emailId) => setAnalysisTarget({ requestId: req.id, emailId })}
                        >
                          <SelectTrigger className="h-8 w-[220px] text-xs">
                            <SelectValue placeholder="Choisir un email…" />
                          </SelectTrigger>
                          <SelectContent>
                            {threadEmails.map((e) => (
                              <SelectItem key={e.id} value={e.id} className="text-xs">
                                {e.from_address.split("@")[0]} — {(e.subject || "(sans sujet)").slice(0, 40)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            !analysisTarget || analysisTarget.requestId !== req.id || triggerAnalysis.isPending
                          }
                          onClick={() => {
                            if (analysisTarget && analysisTarget.requestId === req.id) {
                              triggerAnalysis.mutate(
                                { request_id: req.id, email_id: analysisTarget.emailId },
                                { onSuccess: () => setAnalysisTarget(null) }
                              );
                            }
                          }}
                        >
                          {triggerAnalysis.isPending && analysisTarget?.requestId === req.id ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <Search className="h-3 w-3 mr-1" />
                          )}
                          Analyser
                        </Button>
                      </div>
                    )}
                    {req.status !== "closed" && req.status !== "facts_validated" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => { e.stopPropagation(); closeRequest.mutate(req.id); }}
                      >
                        <X className="h-3 w-3 mr-1" />
                        Clôturer
                      </Button>
                    )}
                  </div>

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

                  {/* Proposed facts */}
                  {reqFacts.length > 0 && (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Faits extraits ({reqFacts.length})
                        </p>
                        {reqFacts.map((fact) => (
                          <div
                            key={fact.id}
                            className="flex items-center gap-2 text-sm bg-background border rounded p-2"
                          >
                            <Badge
                              className={VALIDATION_COLORS[fact.validation_status] || ""}
                              variant="secondary"
                            >
                              {fact.validation_status === "proposed" ? "Proposé" :
                               fact.validation_status === "validated" ? "Validé" : "Rejeté"}
                            </Badge>
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
                                  onClick={() => validateFact.mutate(fact.id)}
                                  disabled={validateFact.isPending}
                                >
                                  <Check className="h-3.5 w-3.5" />
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
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
