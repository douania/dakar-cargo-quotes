/**
 * COCKPIT-4B: Case Action Plan — checklist ordonnée orientée communication réelle
 *
 * Composant autonome (propres queries, staleTime 30s).
 * Lecture seule, aucune mutation.
 * 12 étapes max, décomposant les boucles partenaire et client.
 *
 * Logique skip : étapes partenaires masquées si totalPartnerRequests === 0,
 * étapes client masquées si totalClientGaps === 0.
 *
 * Étape 4 "Confirmer l'envoi" est honnête : done seulement si email_sent_at
 * est renseigné, avec note COM-1A si pending.
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
type StepGroup = "communication" | "consolidation";

interface Step {
  id: string;
  label: string;
  status: StepStatus;
  note?: string;
  group: StepGroup;
}

interface CaseActionPlanProps {
  caseId: string;
}

export function CaseActionPlan({ caseId }: CaseActionPlanProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["case-action-plan", caseId],
    staleTime: 30_000,
    queryFn: async () => {
      // Batch 1: core case data
      const [caseResult, gapsResult, eqrOpenResult, eqrTotalResult, factsProposedResult] =
        await Promise.all([
          supabase.from("quote_cases").select("status").eq("id", caseId).single(),
          supabase.from("quote_gaps").select("id", { count: "exact", head: true }).eq("case_id", caseId).eq("is_blocking", true).eq("status", "open"),
          // openPartnerRequests: tout sauf closed (aligné COCKPIT-2/COCKPIT-3)
          supabase.from("external_quote_requests").select("id", { count: "exact", head: true }).eq("case_id", caseId).neq("status", "closed"),
          supabase.from("external_quote_requests").select("id", { count: "exact", head: true }).eq("case_id", caseId),
          supabase.from("external_quote_response_facts").select("id", { count: "exact", head: true }).eq("case_id", caseId).eq("validation_status", "proposed"),
        ]);

      // Batch 2: client gaps + versions + COCKPIT-4B specific counts
      const [
        clientGapsOpenResult,
        clientGapsTotalResult,
        versionResult,
        draftPartnerResult,
        unsentPartnerResult,
        draftedClientGapsResult,
      ] = await Promise.all([
        supabase.from("client_gap_requests").select("id", { count: "exact", head: true }).eq("case_id", caseId).in("status", ["drafted", "sent", "answered"] as string[]),
        supabase.from("client_gap_requests").select("id", { count: "exact", head: true }).eq("case_id", caseId),
        supabase.from("quotation_versions").select("id, is_selected").eq("case_id", caseId),
        // Étape 3: demandes partenaires encore en brouillon
        supabase.from("external_quote_requests").select("id", { count: "exact", head: true }).eq("case_id", caseId).eq("status", "draft"),
        // Étape 4: demandes marquées sent mais sans preuve d'envoi réel
        supabase.from("external_quote_requests").select("id", { count: "exact", head: true }).eq("case_id", caseId).eq("status", "sent").is("email_sent_at", null),
        // Étape 6: clarifications client encore en brouillon
        supabase.from("client_gap_requests").select("id", { count: "exact", head: true }).eq("case_id", caseId).eq("status", "drafted"),
      ]);

      const versions = versionResult.data ?? [];
      const selectedVersionId = versions.find((v: any) => v.is_selected)?.id;
      const hasVersion = !!selectedVersionId;

      // Check PDF and draft only if we have a version
      let hasPdf = false;
      let hasDraft = false;
      if (selectedVersionId) {
        const [pdfResult, draftResult] = await Promise.all([
          supabase.from("quotation_documents").select("id", { count: "exact", head: true }).eq("quotation_version_id", selectedVersionId).eq("document_type", "pdf"),
          supabase.from("email_drafts").select("id", { count: "exact", head: true }).eq("quotation_version_id", selectedVersionId).eq("status", "draft"),
        ]);
        hasPdf = (pdfResult.count ?? 0) > 0;
        hasDraft = (draftResult.count ?? 0) > 0;
      }

      return {
        status: (caseResult.data?.status as string) ?? "INTAKE",
        blockingGapsCount: gapsResult.count ?? 0,
        openPartnerRequests: eqrOpenResult.count ?? 0,
        totalPartnerRequests: eqrTotalResult.count ?? 0,
        pendingPartnerFacts: factsProposedResult.count ?? 0,
        openClientGaps: clientGapsOpenResult.count ?? 0,
        totalClientGaps: clientGapsTotalResult.count ?? 0,
        draftPartnerRequests: draftPartnerResult.count ?? 0,
        unsentPartnerRequests: unsentPartnerResult.count ?? 0,
        draftedClientGaps: draftedClientGapsResult.count ?? 0,
        hasVersion,
        hasPdf,
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
    draftPartnerRequests,
    unsentPartnerRequests,
    draftedClientGaps,
    hasVersion,
    hasPdf,
    hasDraft,
  } = data;

  // Build 12 steps
  const allSteps: Step[] = [];

  // 1. Analyser la demande client
  allSteps.push({
    id: "analyze",
    label: "Analyser la demande client",
    status: statusAbove(status, "INTAKE") ? "done" : "current",
    group: "communication",
  });

  // 2. Résoudre les gaps bloquants
  allSteps.push({
    id: "gaps",
    label: "Résoudre les gaps bloquants",
    status: blockingGapsCount === 0 ? "done" : "blocked",
    group: "communication",
  });

  // 3. Préparer les demandes partenaires
  // done = plus aucun brouillon partenaire à compléter (toutes les demandes sont au moins en status sent ou au-delà)
  if (totalPartnerRequests > 0) {
    allSteps.push({
      id: "prepare-partners",
      label: "Préparer les demandes partenaires",
      status: draftPartnerRequests === 0 ? "done" : "pending",
      group: "communication",
    });
  }

  // 4. Confirmer l'envoi des demandes partenaires
  // done = aucune request sent avec email_sent_at IS NULL
  // Honnête : ne prétend pas que l'app sait envoyer avant COM-1A
  if (totalPartnerRequests > 0) {
    const allSentConfirmed = unsentPartnerRequests === 0 && draftPartnerRequests === 0;
    allSteps.push({
      id: "confirm-partner-send",
      label: "Confirmer l'envoi des demandes",
      status: allSentConfirmed ? "done" : "pending",
      note: !allSentConfirmed && unsentPartnerRequests > 0
        ? "Envoi réel confirmé après activation COM-1A"
        : undefined,
      group: "communication",
    });
  }

  // 5. Traiter les réponses partenaires
  // openPartnerRequests = tout sauf closed (aligné COCKPIT-2/COCKPIT-3)
  if (totalPartnerRequests > 0) {
    const partnerResponsesDone = openPartnerRequests === 0 && pendingPartnerFacts === 0;
    allSteps.push({
      id: "treat-partner-responses",
      label: "Traiter les réponses partenaires",
      status: partnerResponsesDone ? "done" : "pending",
      group: "communication",
    });
  }

  // 6. Envoyer les clarifications client
  // done = aucun client_gap en status drafted
  if (totalClientGaps > 0) {
    allSteps.push({
      id: "send-client-clarifications",
      label: "Envoyer les clarifications client",
      status: draftedClientGaps === 0 ? "done" : "pending",
      group: "communication",
    });
  }

  // 7. Analyser les réponses client
  // done = aucun client gap ouvert (drafted, sent, answered)
  if (totalClientGaps > 0) {
    allSteps.push({
      id: "analyze-client-responses",
      label: "Analyser les réponses client",
      status: openClientGaps === 0 ? "done" : "pending",
      group: "communication",
    });
  }

  // 8. Lancer le pricing
  allSteps.push({
    id: "pricing",
    label: "Lancer le pricing",
    status: statusAtLeast(status, "PRICED_DRAFT") ? "done" : "pending",
    group: "consolidation",
  });

  // 9. Créer la version
  allSteps.push({
    id: "version",
    label: "Créer la version",
    status: hasVersion ? "done" : "pending",
    group: "consolidation",
  });

  // 10. Exporter le PDF
  allSteps.push({
    id: "pdf",
    label: "Exporter le PDF",
    status: hasPdf ? "done" : "pending",
    group: "consolidation",
  });

  // 11. Préparer l'email client
  allSteps.push({
    id: "prepare-email",
    label: "Préparer l'email client",
    status: hasDraft ? "done" : "pending",
    group: "consolidation",
  });

  // 12. Marquer l'envoi client
  allSteps.push({
    id: "send",
    label: "Marquer l'envoi client",
    status: ["SENT", "ACCEPTED", "REJECTED"].includes(status)
      ? "done"
      : "pending",
    group: "consolidation",
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

        {/* COCKPIT-6: Operational counters */}
        {(draftPartnerRequests > 0 || unsentPartnerRequests > 0 || pendingPartnerFacts > 0 || draftedClientGaps > 0 || blockingGapsCount > 0) && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {draftPartnerRequests > 0 && (
              <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700 bg-amber-50">
                {draftPartnerRequests} à préparer
              </Badge>
            )}
            {unsentPartnerRequests > 0 && (
              <Badge variant="outline" className="text-[10px] border-orange-300 text-orange-700 bg-orange-50">
                {unsentPartnerRequests} envois à confirmer
              </Badge>
            )}
            {pendingPartnerFacts > 0 && (
              <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-700 bg-blue-50">
                {pendingPartnerFacts} faits à valider
              </Badge>
            )}
            {draftedClientGaps > 0 && (
              <Badge variant="outline" className="text-[10px] border-purple-300 text-purple-700 bg-purple-50">
                {draftedClientGaps} clarifications à envoyer
              </Badge>
            )}
            {blockingGapsCount > 0 && (
              <Badge variant="outline" className="text-[10px] border-red-300 text-red-700 bg-red-50">
                {blockingGapsCount} gaps bloquants
              </Badge>
            )}
          </div>
        )}

        {(["communication", "consolidation"] as const).map((group) => {
          const groupSteps = steps.filter((s) => s.group === group);
          if (groupSteps.length === 0) return null;
          return (
            <div key={group} className="space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground/60 pt-1.5 pb-0.5">
                {group === "communication" ? "Communication" : "Consolidation commerciale"}
              </div>
              {groupSteps.map((step) => (
                <div key={step.id}>
                  <div
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
                  {step.note && step.status !== "done" && (
                    <div className="ml-6 text-[10px] text-muted-foreground/50 italic">
                      {step.note}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
