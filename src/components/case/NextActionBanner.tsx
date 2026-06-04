/**
 * COCKPIT-8 Phase 1: Next action priority banner.
 * Read-only synthesis: shows the single most important action + main blocker.
 *
 * P1-A: Migrated to useCockpitState + cockpitStatusConstants.
 */

import { useCockpitState } from "@/hooks/useCockpitState";
import { TERMINAL_STATUSES, statusBelow } from "@/lib/cockpitStatusConstants";
import { useQualifiedScopeGate } from "@/hooks/useQualifiedScopeGate";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  Clock,
  FileText,
  Mail,
  Send,
  Calculator,
  Search,
  ShieldCheck,
} from "lucide-react";

/* ─── Types ─── */
interface Props { caseId: string }

interface ActionResult {
  action: string;
  blocker: string;
  icon: React.ReactNode;
  color: "amber" | "blue" | "emerald" | "red" | "muted";
}

/* ─── Component ─── */
export function NextActionBanner({ caseId }: Props) {
  const { data, isLoading } = useCockpitState(caseId);
  const { hasCriticalUnconfirmed } = useQualifiedScopeGate(caseId);

  if (isLoading || !data) return null;

  const result = computeAction(data, hasCriticalUnconfirmed);
  if (!result) return null;

  const colorMap: Record<string, string> = {
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
    blue: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
    red: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    muted: "bg-muted text-muted-foreground",
  };

  return (
    <Card className="border-border/50 mb-3">
      <CardContent className="py-3 px-4 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          {result.icon}
          <span className="text-sm font-medium">Action prioritaire</span>
          <Badge className={`${colorMap[result.color]} text-xs font-medium`}>
            {result.action}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground ml-6">
          Blocage principal : {result.blocker}
        </p>
      </CardContent>
    </Card>
  );
}

/* ─── Decision hierarchy — first match wins ─── */
function computeAction(d: {
  status: string; blockingGapsCount: number; draftPartnerRequests: number;
  unsentPartnerRequests: number; pendingPartnerFacts: number; draftedClientGaps: number;
  openClientGaps: number; hasSelectedVersion: boolean; hasPdf: boolean;
  hasDraftEmail: boolean; hasSelectedPartner: boolean; hasExploitableRequests: boolean;
  totalPartnerRequests: number;
}, hasCriticalUnconfirmed: boolean): ActionResult | null {

  // Terminal
  if (TERMINAL_STATUSES.has(d.status)) return null;

  // 1 — Blocking gaps
  if (d.blockingGapsCount > 0) return {
    action: `Résoudre ${d.blockingGapsCount} gap(s) bloquant(s)`,
    blocker: `${d.blockingGapsCount} gap(s) bloquant(s)`,
    icon: <AlertTriangle className="h-4 w-4 text-destructive" />,
    color: "red",
  };

  // 2 — Draft partner requests
  if (d.draftPartnerRequests > 0) return {
    action: `Préparer ${d.draftPartnerRequests} demande(s) partenaire(s)`,
    blocker: "Demandes non préparées",
    icon: <FileText className="h-4 w-4 text-amber-600" />,
    color: "amber",
  };

  // 3 — Unsent partner requests
  if (d.unsentPartnerRequests > 0) return {
    action: `Confirmer l'envoi de ${d.unsentPartnerRequests} demande(s)`,
    blocker: "Envois non confirmés",
    icon: <Send className="h-4 w-4 text-amber-600" />,
    color: "amber",
  };

  // 4 — Pending partner facts
  if (d.pendingPartnerFacts > 0) return {
    action: `Valider ${d.pendingPartnerFacts} fait(s) partenaire(s)`,
    blocker: "Faits partenaires à valider",
    icon: <ShieldCheck className="h-4 w-4 text-amber-600" />,
    color: "amber",
  };

  // 5 — Drafted client gaps
  if (d.draftedClientGaps > 0) return {
    action: `Envoyer ${d.draftedClientGaps} clarification(s) client`,
    blocker: "Clarifications non envoyées",
    icon: <Mail className="h-4 w-4 text-blue-600" />,
    color: "blue",
  };

  // 6 — Open client gaps
  if (d.openClientGaps > 0) return {
    action: `Traiter ${d.openClientGaps} réponse(s) client`,
    blocker: "Réponses client à traiter",
    icon: <Search className="h-4 w-4 text-blue-600" />,
    color: "blue",
  };

  // 7 — Select partner offer (if exploitable requests exist but none selected)
  if (d.totalPartnerRequests > 0 && d.hasExploitableRequests && !d.hasSelectedPartner) return {
    action: "Retenir une offre partenaire",
    blocker: "Sélection commerciale non faite",
    icon: <CheckCircle2 className="h-4 w-4 text-amber-600" />,
    color: "amber",
  };

  // 8 — Unlock pricing once decision support is complete.
  if (d.status === "DECISIONS_COMPLETE") {
    return {
      action: "Débloquer le pricing",
      blocker: "Décisions validées, confirmation pricing requise",
      icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
      color: "emerald",
    };
  }

  // 9 — Launch pricing (aligned with ReadyActionsPanel)
  if (d.status === "ACK_READY_FOR_PRICING") {
    if (hasCriticalUnconfirmed) {
      return {
        action: "Confirmer le périmètre du dossier",
        blocker: "Des services dans le scope restent insuffisamment qualifiés",
        icon: <CircleDashed className="h-4 w-4 text-amber-600" />,
        color: "amber",
      };
    }
    return {
      action: "Lancer le pricing",
      blocker: "Aucun blocage majeur",
      icon: <Calculator className="h-4 w-4 text-emerald-600" />,
      color: "emerald",
    };
  }

  // 10 — Create version
  if (!d.hasSelectedVersion && !statusBelow(d.status, "PRICED_DRAFT")) return {
    action: "Créer la version du devis",
    blocker: "Version non créée",
    icon: <FileText className="h-4 w-4 text-blue-600" />,
    color: "blue",
  };

  // 11 — Export PDF
  if (!d.hasPdf) return {
    action: "Exporter le PDF",
    blocker: "PDF non généré",
    icon: <FileText className="h-4 w-4 text-blue-600" />,
    color: "blue",
  };

  // 12 — Prepare client email
  if (!d.hasDraftEmail) return {
    action: "Préparer l'email client",
    blocker: "Brouillon non créé",
    icon: <Mail className="h-4 w-4 text-blue-600" />,
    color: "blue",
  };

  // 13 — Mark sent
  if (d.status !== "SENT") return {
    action: "Marquer l'envoi client",
    blocker: "Envoi non confirmé",
    icon: <ArrowRight className="h-4 w-4 text-emerald-600" />,
    color: "emerald",
  };

  // Fallback (shouldn't reach here because SENT is terminal)
  return null;
}
