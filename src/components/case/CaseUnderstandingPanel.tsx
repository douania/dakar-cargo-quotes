import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, HelpCircle, Brain, Clock, AlertTriangle, MessageSquare, Compass, Lightbulb } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

// ── Types for timeline events ──
interface TimelineEvent {
  id: string;
  event_type: string;
  event_data: Record<string, unknown> | null;
  related_email_id: string | null;
  created_at: string | null;
}

interface CaseUnderstandingPanelProps {
  events: TimelineEvent[];
}

// ── Scope indicator icon ──
function ScopeIcon({ value }: { value: unknown }) {
  if (value === true)
    return <CheckCircle className="h-4 w-4 text-primary inline mr-1" />;
  if (value === false)
    return <XCircle className="h-4 w-4 text-destructive inline mr-1" />;
  return <HelpCircle className="h-4 w-4 text-muted-foreground inline mr-1" />;
}

function scopeLabel(value: unknown): string {
  if (value === true) return "oui";
  if (value === false) return "non";
  return "incertain";
}

const SHIPMENT_LABELS: Record<string, string> = {
  import: "Import",
  export: "Export",
  transit: "Transit",
  unknown: "Inconnu",
};

const CONFIDENCE_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  high: "default",
  medium: "secondary",
  low: "destructive",
};

// ── V2: Hypothesis labels ──
const TRANSPORT_MODE_LABELS: Record<string, string> = {
  sea_lcl: "Maritime LCL",
  sea_fcl: "Maritime FCL",
  air: "Aérien",
  road: "Route",
  multimodal: "Multimodal",
  unknown: "Inconnu",
};

const SCOPE_LABELS: Record<string, string> = {
  quote_transport_only: "Transport seul",
  quote_full_landed: "Rendu complet",
  customs_only: "Douane seul",
  document_only: "Documentation",
  unknown: "Inconnu",
};

export function CaseUnderstandingPanel({ events }: CaseUnderstandingPanelProps) {
  // ── Existing: service_scope_v1 + case_reasoning_v1 ──
  const { scope, reasoning, analysisDate } = useMemo(() => {
    const scopeEvents = events
      .filter((e) => e.event_type === "service_scope_v1" && e.event_data)
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

    const reasoningEvents = events
      .filter((e) => e.event_type === "case_reasoning_v1" && e.event_data)
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

    if (scopeEvents.length === 0 && reasoningEvents.length === 0) {
      return { scope: null, reasoning: null, analysisDate: null };
    }

    for (const s of scopeEvents) {
      const matchingReasoning = reasoningEvents.find(
        (r) => r.related_email_id && r.related_email_id === s.related_email_id
      );
      if (matchingReasoning) {
        return {
          scope: s.event_data,
          reasoning: matchingReasoning.event_data,
          analysisDate: s.created_at,
        };
      }
    }

    return {
      scope: scopeEvents[0]?.event_data ?? null,
      reasoning: reasoningEvents[0]?.event_data ?? null,
      analysisDate: scopeEvents[0]?.created_at ?? reasoningEvents[0]?.created_at ?? null,
    };
  }, [events]);

  // ── V2: thread_intent_v1 enriched data ──
  const intentV2 = useMemo(() => {
    const intentEvents = events
      .filter((e) => e.event_type === "thread_intent_v1" && e.event_data)
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

    if (intentEvents.length === 0) return null;

    const latestEvent = intentEvents[0];
    const ed = latestEvent.event_data as Record<string, unknown>;
    const intent = (ed?.["intent"] as Record<string, unknown>) ?? {};

    // Only show V2 sections if we have the enriched fields
    if (!intent["request_summary"] && !intent["transport_mode_hypothesis"]) return null;

    return {
      request_summary: typeof intent["request_summary"] === "string" ? intent["request_summary"] : null,
      transport_mode_hypothesis: typeof intent["transport_mode_hypothesis"] === "string"
        ? intent["transport_mode_hypothesis"] : "unknown",
      incoterm_hypothesis: typeof intent["incoterm_hypothesis"] === "string"
        ? intent["incoterm_hypothesis"] : "unknown",
      shipment_scope_hypothesis: typeof intent["shipment_scope_hypothesis"] === "string"
        ? intent["shipment_scope_hypothesis"] : "unknown",
      contradiction_flags: Array.isArray(intent["contradiction_flags"])
        ? (intent["contradiction_flags"] as string[]) : [],
      missing_business_questions: Array.isArray(intent["missing_business_questions"])
        ? (intent["missing_business_questions"] as string[]) : [],
      operator_guidance: Array.isArray(intent["operator_guidance"])
        ? (intent["operator_guidance"] as string[]) : [],
      confidence: typeof ed["confidence"] === "number"
        ? (ed["confidence"] as number)
        : (typeof intent["confidence"] === "number" ? intent["confidence"] as number : null),
      date: latestEvent.created_at,
    };
  }, [events]);

  // ── V2: case_coherence_v1 data ──
  const coherence = useMemo(() => {
    const coherenceEvents = events
      .filter((e) => e.event_type === "case_coherence_v1" && e.event_data)
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

    if (coherenceEvents.length === 0) return null;

    const ed = coherenceEvents[0].event_data as Record<string, unknown>;

    return {
      summary: typeof ed["summary"] === "string" ? ed["summary"] : null,
      contradiction_flags: Array.isArray(ed["contradiction_flags"])
        ? (ed["contradiction_flags"] as Array<Record<string, unknown>>) : [],
      warnings: Array.isArray(ed["warnings"])
        ? (ed["warnings"] as Array<Record<string, unknown>>) : [],
      derived_candidates: Array.isArray(ed["derived_candidates"])
        ? (ed["derived_candidates"] as Array<Record<string, unknown>>) : [],
      suggested_client_questions: Array.isArray(ed["suggested_client_questions"])
        ? (ed["suggested_client_questions"] as string[]) : [],
      operator_guidance: Array.isArray(ed["operator_guidance"])
        ? (ed["operator_guidance"] as string[]) : [],
      false_blocker_candidates: Array.isArray(ed["false_blocker_candidates"])
        ? (ed["false_blocker_candidates"] as Array<Record<string, unknown>>) : [],
      date: coherenceEvents[0].created_at,
    };
  }, [events]);

  // ── Merge contradiction flags from intent + coherence (deduplicated) ──
  const allContradictions = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{ code: string; message_fr: string; severity: string }> = [];

    // From coherence (structured objects)
    for (const c of coherence?.contradiction_flags ?? []) {
      const code = typeof c["code"] === "string" ? c["code"] : "";
      if (code && !seen.has(code)) {
        seen.add(code);
        result.push({
          code,
          message_fr: typeof c["message_fr"] === "string" ? c["message_fr"] : code,
          severity: typeof c["severity"] === "string" ? c["severity"] : "warning",
        });
      }
    }

    // From intent (string array)
    for (const flag of intentV2?.contradiction_flags ?? []) {
      if (!seen.has(flag)) {
        seen.add(flag);
        result.push({ code: flag, message_fr: flag.replace(/_/g, " "), severity: "warning" });
      }
    }

    return result;
  }, [intentV2, coherence]);

  // ── Merge suggested questions (deduplicated) ──
  const allQuestions = useMemo(() => {
    const set = new Set<string>();
    for (const q of intentV2?.missing_business_questions ?? []) set.add(q);
    for (const q of coherence?.suggested_client_questions ?? []) set.add(q);
    return Array.from(set);
  }, [intentV2, coherence]);

  // ── Merge operator guidance (deduplicated) ──
  const allGuidance = useMemo(() => {
    const set = new Set<string>();
    for (const g of intentV2?.operator_guidance ?? []) set.add(g);
    for (const g of coherence?.operator_guidance ?? []) set.add(g);
    return Array.from(set);
  }, [intentV2, coherence]);

  // Nothing to show at all
  const hasExistingScope = scope || reasoning;
  const hasV2Data = intentV2 || coherence;
  if (!hasExistingScope && !hasV2Data) return null;

  const shipmentType = typeof scope?.shipment_type === "string"
    ? scope.shipment_type
    : "unknown";
  const confidence = typeof scope?.confidence === "string"
    ? scope.confidence
    : "low";
  const summary = typeof reasoning?.summary === "string"
    ? reasoning.summary
    : null;

  return (
    <div className="space-y-4 mb-6">
      {/* ── Existing: Scope + Reasoning card ── */}
      {hasExistingScope && (
        <Card className="border-border/60">
          <CardHeader className="pb-3 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Brain className="h-4 w-4 text-primary" />
                Compréhension du dossier
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant={CONFIDENCE_VARIANTS[confidence] ?? "outline"} className="text-xs">
                  {confidence}
                </Badge>
                {analysisDate && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Analyse générée {formatDistanceToNow(new Date(analysisDate), { addSuffix: true, locale: fr })}
                  </span>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-2">
              <div>
                <span className="text-muted-foreground text-xs">Type</span>
                <p className="font-medium">{SHIPMENT_LABELS[shipmentType] ?? shipmentType}</p>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">Fret principal</span>
                <p className="font-medium">
                  <ScopeIcon value={scope?.freight_scope} />
                  {scope?.freight_scope === true
                    ? "dans notre scope"
                    : scope?.freight_scope === false
                      ? "hors scope"
                      : scopeLabel(scope?.freight_scope)}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">Douane</span>
                <p className="font-medium">
                  <ScopeIcon value={scope?.customs_scope} />
                  {scopeLabel(scope?.customs_scope)}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">Transit intérieur</span>
                <p className="font-medium">
                  <ScopeIcon value={scope?.transit_scope} />
                  {scopeLabel(scope?.transit_scope)}
                </p>
              </div>
            </div>
            {summary && (
              <p className="text-xs text-muted-foreground mt-1 italic leading-relaxed">{summary}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── V2: Contradictions ── */}
      {allContradictions.length > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Incohérences détectées
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0 space-y-2">
            {allContradictions.map((c) => (
              <div key={c.code} className="flex items-start gap-2">
                <Badge variant="destructive" className="text-xs shrink-0 mt-0.5">
                  {c.code.replace(/_/g, " ")}
                </Badge>
                <span className="text-xs text-muted-foreground">{c.message_fr}</span>
              </div>
            ))}
            {(coherence?.warnings ?? []).map((w) => (
              <div key={String(w["code"])} className="flex items-start gap-2">
                <Badge variant="outline" className="text-xs shrink-0 mt-0.5 border-amber-500/50 text-amber-700">
                  {String(w["code"]).replace(/_/g, " ")}
                </Badge>
                <span className="text-xs text-muted-foreground">{String(w["message_fr"])}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── V2: Suggested Questions ── */}
      {allQuestions.length > 0 && (
        <Card className="border-border/60">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              Questions suggérées pour le client
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0">
            <ul className="space-y-1.5">
              {allQuestions.map((q, i) => (
                <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                  <span className="text-primary font-medium shrink-0">•</span>
                  {q}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ── V2: Operator Guidance ── */}
      {allGuidance.length > 0 && (
        <Card className="border-border/60">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              Guidance opérateur
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0">
            <ul className="space-y-1.5">
              {allGuidance.map((g, i) => (
                <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                  <span className="text-amber-500 font-medium shrink-0">→</span>
                  {g}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ── V2: AI Hypotheses ── */}
      {intentV2 && (
        <Card className="border-border/60">
          <CardHeader className="pb-2 pt-3 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Compass className="h-4 w-4 text-primary" />
                Hypothèses IA
              </CardTitle>
              {intentV2.confidence !== null && (
                <Badge variant="outline" className="text-xs">
                  confiance {Math.round(intentV2.confidence * 100)}%
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0">
            {intentV2.request_summary && (
              <p className="text-xs text-muted-foreground italic mb-2">{intentV2.request_summary}</p>
            )}
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground text-xs">Mode transport</span>
                <p className="font-medium text-xs">
                  {TRANSPORT_MODE_LABELS[intentV2.transport_mode_hypothesis] ?? intentV2.transport_mode_hypothesis}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">Incoterm</span>
                <p className="font-medium text-xs">{intentV2.incoterm_hypothesis}</p>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">Scope</span>
                <p className="font-medium text-xs">
                  {SCOPE_LABELS[intentV2.shipment_scope_hypothesis] ?? intentV2.shipment_scope_hypothesis}
                </p>
              </div>
            </div>
            {/* V2: Derived candidates from coherence */}
            {(coherence?.derived_candidates ?? []).length > 0 && (
              <div className="mt-3 pt-2 border-t border-border/40">
                <span className="text-xs font-medium text-muted-foreground">Faits dérivables</span>
                {(coherence?.derived_candidates ?? []).map((d) => (
                  <div key={String(d["fact_key"])} className="mt-1 flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      {String(d["fact_key"])}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{String(d["explanation_fr"])}</span>
                  </div>
                ))}
              </div>
            )}
            {/* V2: False blocker candidates */}
            {(coherence?.false_blocker_candidates ?? []).length > 0 && (
              <div className="mt-2 pt-2 border-t border-border/40">
                <span className="text-xs font-medium text-amber-600">Gaps potentiellement résolvables</span>
                {(coherence?.false_blocker_candidates ?? []).map((fb) => (
                  <div key={String(fb["gap_key"])} className="mt-1 flex items-center gap-2">
                    <Badge variant="outline" className="text-xs border-amber-500/50">
                      {String(fb["gap_key"])}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{String(fb["message_fr"])}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── V2: Coherence summary (if no intent V2 but coherence exists) ── */}
      {!intentV2 && coherence?.summary && (
        <Card className="border-border/60">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              Diagnostic de cohérence
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0">
            <p className="text-xs text-muted-foreground">{coherence.summary}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
