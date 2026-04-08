/**
 * COCKPIT-4: Case Action Plan — checklist ordonnée des étapes dossier
 *
 * Composant autonome (propres queries, staleTime 30s).
 * Lecture seule, aucune mutation.
 * 8 étapes max, compactes, orientées pilotage.
 *
 * Logique skip : étapes 3/4 masquées seulement si aucune demande/gap
 * n'a JAMAIS existé (totalCount === 0), pas si tout est simplement clôturé.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, AlertCircle, ListChecks } from "lucide-react";

/** Explicit status hierarchy — no naive string comparison */
const STATUS_ORDER: Record<string, number> = {
  INTAKE: 0,
  NEW_THREAD: 1,
  RFQ_DETECTED: 2,
  FACTS_PARTIAL: 3,
  NEED_INFO: 4,
  READY_TO_PRICE: 5,
  DECISIONS_PENDING: 6,
  DECISIONS_COMPLETE: 7,
  ACK_READY_FOR_PRICING: 8,
  PRICING_RUNNING: 9,
  PRICED_DRAFT: 10,
  HUMAN_REVIEW: 11,
  QUOTED_VERSIONED: 12,
  SENT: 13,
  ACCEPTED: 14,
  REJECTED: 15,
  ARCHIVED: 16,
};

function statusAtLeast(current: string, threshold: string): boolean {
  return (STATUS_ORDER[current] ?? -1) >= (STATUS_ORDER[threshold] ?? 999);
}

function statusAbove(current: string, threshold: string): boolean {
  return (STATUS_ORDER[current] ?? -1) > (STATUS_ORDER[threshold] ?? 999);
}

type StepStatus = "done" | "current" | "pending" | "blocked" | "skipped";

interface Step {
  id: string;
  label: string;
  status: StepStatus;
}

interface CaseActionPlanProps {
  caseId: string;
}

export function CaseActionPlan({ caseId }: CaseActionPlanProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["case-action-plan", caseId],
    staleTime: 30_000,
    queryFn: async () => {
      const [
        caseResult,
        gapsResult,
        eqrOpenResult,
        eqrTotalResult,
        factsProposedResult,
        clientGapsOpenResult,
        clientGapsTotalResult,
        versionResult,
        pdfResult,
        draftResult,
      ] = await Promise.all([
        supabase
          .from("quote_cases")
          .select("status")
          .eq("id", caseId)
          .single(),
        supabase
          .from("quote_gaps")
          .select("id", { count: "exact", head: true })
          .eq("case_id", caseId)
          .eq("is_blocking", true)
          .eq("status", "open"),
        supabase
          .from("external_quote_requests")
          .select("id", { count: "exact", head: true })
          .eq("case_id", caseId)
          .neq("status", "closed"),
        supabase
          .from("external_quote_requests")
          .select("id", { count: "exact", head: true })
          .eq("case_id", caseId),
        supabase
          .from("external_quote_response_facts")
          .select("id", { count: "exact", head: true })
          .eq("case_id", caseId)
          .eq("validation_status", "proposed"),
        supabase
          .from("client_gap_requests")
          .select("id", { count: "exact", head: true })
          .eq("case_id", caseId)
          .in("status", ["drafted", "sent", "answered"] as string[]),
        supabase
          .from("client_gap_requests")
          .select("id", { count: "exact", head: true })
          .eq("case_id", caseId),
        supabase
          .from("quotation_versions")
          .select("id", { count: "exact", head: true })
          .eq("case_id", caseId)
          .eq("is_selected", true),
        supabase
          .from("quotation_documents")
          .select("id", { count: "exact", head: true })
          .eq("case_id", caseId),
        supabase
          .from("email_drafts")
          .select("id, quotation_version_id")
          .eq("status", "draft")
          .not("quotation_version_id", "is", null),
      ]);

      // For drafts, filter client-side by case versions
      const caseVersionIds = versionResult.data ? [] : [];
      const hasDraft = (draftResult.data?.length ?? 0) > 0;

      return {
        status: (caseResult.data?.status as string) ?? "INTAKE",
        blockingGapsCount: gapsResult.count ?? 0,
        openPartnerRequests: eqrOpenResult.count ?? 0,
        totalPartnerRequests: eqrTotalResult.count ?? 0,
        pendingPartnerFacts: factsProposedResult.count ?? 0,
        openClientGaps: clientGapsOpenResult.count ?? 0,
        totalClientGaps: clientGapsTotalResult.count ?? 0,
        hasVersion: (versionResult.count ?? 0) > 0,
        hasPdf: (pdfResult.count ?? 0) > 0,
        hasDraft,
      };
    },
  });

  if (isLoading || !data) return null;

  const {
    status,
    blockingGapsCount,
    openPartnerRequests,
    totalPartnerRequests,
    pendingPartnerFacts,
    openClientGaps,
    totalClientGaps,
    hasVersion,
    hasPdf,
    hasDraft,
  } = data;

  // Build steps
  const allSteps: Step[] = [];

  // 1. Analyser le dossier
  allSteps.push({
    id: "analyze",
    label: "Analyser le dossier",
    status: statusAbove(status, "INTAKE") ? "done" : "current",
  });

  // 2. Résoudre les gaps bloquants
  allSteps.push({
    id: "gaps",
    label: "Résoudre les gaps bloquants",
    status: blockingGapsCount === 0 ? "done" : "blocked",
  });

  // 3. Demandes partenaires (skip if never existed)
  if (totalPartnerRequests > 0) {
    const partnerDone =
      openPartnerRequests === 0 && pendingPartnerFacts === 0;
    allSteps.push({
      id: "partners",
      label: "Demandes partenaires",
      status: partnerDone ? "done" : "pending",
    });
  }

  // 4. Clarifications client (skip if never existed)
  if (totalClientGaps > 0) {
    allSteps.push({
      id: "client-gaps",
      label: "Clarifications client",
      status: openClientGaps === 0 ? "done" : "pending",
    });
  }

  // 5. Lancer le pricing
  allSteps.push({
    id: "pricing",
    label: "Lancer le pricing",
    status: statusAtLeast(status, "PRICED_DRAFT") ? "done" : "pending",
  });

  // 6. Créer la version
  allSteps.push({
    id: "version",
    label: "Créer la version",
    status: hasVersion ? "done" : "pending",
  });

  // 7. Exporter le PDF
  allSteps.push({
    id: "pdf",
    label: "Exporter le PDF",
    status: hasPdf ? "done" : "pending",
  });

  // 8. Envoyer au client
  allSteps.push({
    id: "send",
    label: "Envoyer au client",
    status: ["SENT", "ACCEPTED", "REJECTED"].includes(status)
      ? "done"
      : "pending",
  });

  // Mark first non-done step as "current" (if not already blocked)
  let foundCurrent = false;
  const steps = allSteps.map((step) => {
    if (step.status === "done" || step.status === "skipped") return step;
    if (!foundCurrent) {
      foundCurrent = true;
      return { ...step, status: step.status === "blocked" ? "blocked" : "current" as StepStatus };
    }
    return step;
  });

  const doneCount = steps.filter((s) => s.status === "done").length;
  const totalCount = steps.length;

  const iconForStatus = (s: StepStatus) => {
    switch (s) {
      case "done":
        return <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />;
      case "current":
        return <Circle className="h-4 w-4 text-primary fill-primary/20 shrink-0" />;
      case "blocked":
        return <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />;
      default:
        return <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />;
    }
  };

  return (
    <Card className="border-border/50">
      <CardContent className="py-3 px-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <ListChecks className="h-4 w-4" />
            Plan d'actions
          </div>
          <Badge
            className={
              doneCount === totalCount
                ? "bg-emerald-500/15 text-emerald-700 border-emerald-200 hover:bg-emerald-500/15"
                : "bg-muted text-muted-foreground border-border hover:bg-muted"
            }
            variant="secondary"
          >
            {doneCount}/{totalCount} étapes
          </Badge>
        </div>

        <div className="space-y-1">
          {steps.map((step) => (
            <div
              key={step.id}
              className={`flex items-center gap-2 py-0.5 text-xs ${
                step.status === "done"
                  ? "text-muted-foreground line-through"
                  : step.status === "current"
                  ? "text-foreground font-medium"
                  : step.status === "blocked"
                  ? "text-amber-700 font-medium"
                  : "text-muted-foreground/60"
              }`}
            >
              {iconForStatus(step.status)}
              <span>{step.label}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
