/**
 * COCKPIT-4B: Case Action Plan — checklist ordonnée orientée communication réelle
 *
 * P1-A: Migrated to useCockpitState + cockpitStatusConstants.
 * Composant autonome, lecture seule, aucune mutation.
 * 12 étapes max, décomposant les boucles partenaire et client.
 */

import { useState } from "react";
import { useCockpitState } from "@/hooks/useCockpitState";
import { statusAtLeast, statusAbove } from "@/lib/cockpitStatusConstants";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { CheckCircle2, Circle, AlertCircle, ListChecks, ChevronDown } from "lucide-react";

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
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useCockpitState(caseId);

  if (isLoading || !data) return null;

  const {
    status,
    blockingGapsCount,
    openPartnerRequests,
    totalPartnerRequests,
    pendingPartnerFacts,
    openClientGaps,
    activeClientGaps,
    draftPartnerRequests,
    unsentPartnerRequests,
    draftedClientGaps,
    answeredClientGaps = 0,
    hasSelectedVersion,
    hasPdf,
    hasDraftEmail,
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
  if (totalPartnerRequests > 0) {
    allSteps.push({
      id: "prepare-partners",
      label: "Préparer les demandes partenaires",
      status: draftPartnerRequests === 0 ? "done" : "pending",
      group: "communication",
    });
  }

  // 4. Confirmer l'envoi des demandes partenaires
  if (totalPartnerRequests > 0) {
    const allSentConfirmed = unsentPartnerRequests === 0 && draftPartnerRequests === 0;
    allSteps.push({
      id: "confirm-partner-send",
      label: "Confirmer l'envoi des demandes",
      status: allSentConfirmed ? "done" : "pending",
      note: !allSentConfirmed && unsentPartnerRequests > 0
        ? "Confirmation manuelle disponible — COM-1A automatisera l'envoi"
        : undefined,
      group: "communication",
    });
  }

  // 5. Traiter les réponses partenaires
  if (totalPartnerRequests > 0) {
    const partnerResponsesDone = openPartnerRequests === 0 && pendingPartnerFacts === 0;
    allSteps.push({
      id: "treat-partner-responses",
      label: "Traiter les réponses partenaires",
      status: partnerResponsesDone ? "done" : "pending",
      group: "communication",
    });
  }

  // 6. Envoyer les clarifications client — only show if active (not cancelled/validated)
  if (activeClientGaps > 0) {
    allSteps.push({
      id: "send-client-clarifications",
      label: "Envoyer les clarifications client",
      status: draftedClientGaps === 0 ? "done" : "pending",
      group: "communication",
    });
  }

  // 7. Analyser les réponses client — only show if active gaps remain
  if (activeClientGaps > 0) {
    allSteps.push({
      id: "analyze-client-responses",
      label: "Analyser les réponses client",
      status: openClientGaps === 0 ? "done" : "pending",
      note: answeredClientGaps > 0
        ? `${answeredClientGaps} réponse${answeredClientGaps > 1 ? 's' : ''} client à analyser`
        : undefined,
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
    status: hasSelectedVersion ? "done" : "pending",
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
    status: hasDraftEmail ? "done" : "pending",
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
        {(draftPartnerRequests > 0 || unsentPartnerRequests > 0 || pendingPartnerFacts > 0 || draftedClientGaps > 0 || blockingGapsCount > 0 || answeredClientGaps > 0) && (
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
            {answeredClientGaps > 0 && (
              <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700 bg-emerald-50">
                {answeredClientGaps} réponse{answeredClientGaps > 1 ? 's' : ''} client à traiter
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
