/**
 * Phase PROVISIONAL-SCENARIO-QUOTES-UI-1A — Panneau LECTURE SEULE.
 *
 * Affiche les hypothèses opérateur enregistrées dans
 * public.quote_scenario_assumptions pour le dossier courant.
 *
 * Doctrine (docs/PROVISIONAL_SCENARIO_QUOTES.md) :
 *   - hypothèse ≠ fact ; ce panneau ne confirme/ne promeut jamais rien ;
 *   - aucune écriture (insert/update/upsert/delete/rpc/functions.invoke) ;
 *   - n'affiche jamais source_refs/metadata en JSON brut bruyant ;
 *   - promoted_fact_id = simple référence informative,
 *     PAS une promotion automatique.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Lightbulb, Link2 } from "lucide-react";

type QuoteScenarioAssumption =
  Database["public"]["Tables"]["quote_scenario_assumptions"]["Row"];

interface QuoteScenarioAssumptionsPanelProps {
  caseId: string;
}

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  client_confirmed: "Confirmée client",
  refuted: "Réfutée",
  superseded: "Remplacée",
  promoted_to_fact: "Promue en fact",
};

const RISK_LABELS: Record<string, string> = {
  low: "Risque faible",
  medium: "Risque moyen",
  high: "Risque élevé",
};

const RISK_CLASSES: Record<string, string> = {
  low: "bg-emerald-100 text-emerald-800 border-emerald-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  high: "bg-red-100 text-red-800 border-red-200",
};

function formatLocalDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function errorMessage(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    return typeof m === "string" ? m : null;
  }
  return null;
}

// Détection de "présence" sans dump JSON bruyant (source_refs = array, metadata = object).
const hasArrayItems = (v: unknown): boolean => Array.isArray(v) && v.length > 0;
const hasObjectKeys = (v: unknown): boolean =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length > 0;

export function QuoteScenarioAssumptionsPanel({ caseId }: QuoteScenarioAssumptionsPanelProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["quote-scenario-assumptions", caseId],
    staleTime: 60_000,
    enabled: !!caseId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_scenario_assumptions")
        .select(
          "id, scope_key, statement, basis, assumption_type, status, risk_level, client_visible, gap_key, assumed_fact_key, source_type, source_refs, metadata, promoted_fact_id, superseded_by_assumption_id, created_at, updated_at",
        )
        .eq("case_id", caseId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as QuoteScenarioAssumption[];
    },
  });

  if (isLoading) {
    return (
      <Card className="mb-6 border-border/50">
        <CardContent className="py-3 px-4 text-xs text-muted-foreground">
          Chargement des hypothèses…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    const message = errorMessage(error);
    return (
      <Alert className="mb-6">
        <AlertDescription className="text-xs">
          <span className="font-medium">Hypothèses indisponibles</span>
          {message ? <span className="text-muted-foreground"> — {message}</span> : null}
        </AlertDescription>
      </Alert>
    );
  }

  const assumptions = data ?? [];
  // Intégration visuelle : panneau avancé/rare → on n'affiche rien si aucune hypothèse
  // (cohérent avec le bloc "Clarifications client" voisin qui se masque à vide).
  if (assumptions.length === 0) return null;

  return (
    <Card className="mb-6 border-violet-200 bg-violet-50/30">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-violet-600" />
          Hypothèses opérateur
          <Badge variant="secondary" className="text-[10px] ml-1">
            {assumptions.length}
          </Badge>
        </CardTitle>
        <p className="text-[11px] text-muted-foreground mt-1">
          Lecture seule — ces éléments sont des hypothèses, pas des facts confirmés.
        </p>
      </CardHeader>
      <CardContent className="py-2 px-4">
        <div className="space-y-2">
          {assumptions.map((a) => {
            const statusLabel = STATUS_LABELS[a.status] ?? a.status;
            const riskLabel = RISK_LABELS[a.risk_level] ?? a.risk_level;
            const riskClass = RISK_CLASSES[a.risk_level] ?? "bg-muted text-muted-foreground";
            const showSources = hasArrayItems(a.source_refs);
            const showMetadata = hasObjectKeys(a.metadata);

            return (
              <div
                key={a.id}
                className="rounded-md border border-border/60 bg-background/60 p-2.5 text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px]">
                      {a.scope_key}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {a.assumption_type}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
                    <Badge variant="outline" className="text-[10px]">
                      {statusLabel}
                    </Badge>
                    <Badge variant="outline" className={`text-[10px] ${riskClass}`}>
                      {riskLabel}
                    </Badge>
                    {a.promoted_fact_id ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] bg-blue-50 text-blue-700 border-blue-200"
                        title="Référence informative vers un fact lié — pas une promotion automatique."
                      >
                        <Link2 className="h-3 w-3 mr-1" />
                        Fact lié
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <p className="mt-1.5 text-foreground">{a.statement}</p>
                {a.basis ? (
                  <p className="mt-1 text-muted-foreground">
                    <span className="font-medium">Base : </span>
                    {a.basis}
                  </p>
                ) : null}

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {a.gap_key ? (
                    <span>
                      Gap : <span className="font-mono">{a.gap_key}</span>
                    </span>
                  ) : null}
                  {a.assumed_fact_key ? (
                    <span>
                      Fait anticipé : <span className="font-mono">{a.assumed_fact_key}</span>
                    </span>
                  ) : null}
                  <span>Visible client : {a.client_visible ? "oui" : "non"}</span>
                  <span>Source : {a.source_type}</span>
                  {showSources ? <span>Sources disponibles</span> : null}
                  {showMetadata ? <span>Métadonnées disponibles</span> : null}
                  <span>{formatLocalDate(a.created_at)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
