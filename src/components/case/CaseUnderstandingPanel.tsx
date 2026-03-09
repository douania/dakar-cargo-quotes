import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, HelpCircle, Brain, Clock } from "lucide-react";
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

export function CaseUnderstandingPanel({ events }: CaseUnderstandingPanelProps) {
  // Find the most recent pair with matching related_email_id
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

    // Try to find a matching pair on the same related_email_id
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

    // Fallback: use most recent of each (documented: may come from different emails)
    return {
      scope: scopeEvents[0]?.event_data ?? null,
      reasoning: reasoningEvents[0]?.event_data ?? null,
      analysisDate: scopeEvents[0]?.created_at ?? reasoningEvents[0]?.created_at ?? null,
    };
  }, [events]);

  if (!scope && !reasoning) return null;

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
    <Card className="mb-6 border-border/60">
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
  );
}
