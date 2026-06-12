/**
 * COCKPIT-8 Phase 1: Next action priority banner.
 * Read-only synthesis: shows the single most important action + main blocker.
 *
 * P1-A: Migrated to useCockpitState + cockpitStatusConstants.
 */

import { useCockpitState } from "@/hooks/useCockpitState";
import { TERMINAL_STATUSES, statusBelow } from "@/lib/cockpitStatusConstants";
import { useQualifiedScopeGate } from "@/hooks/useQualifiedScopeGate";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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

const EXPORT_SEA_FREIGHT_PARTNER_GAP_KEY = "pricing.sea_freight_partner_quote_required";

/* ─── UI-P1-PARTNER-REQUEST-STATE-LABEL-1 ───
 * Pure helper: maps the real state of the freight_rate partner request(s)
 * to the UI action shown for the SEA_FREIGHT blocking gap.
 * Shared with ReadyActionsPanel to avoid label divergence. */

export type SeaFreightPartnerActionKind =
  | "prepare"
  | "confirm_send"
  | "waiting"
  | "process_response"
  | "validate_facts"
  | "verify";

export interface FreightRateRequestLite {
  status: string | null;
  email_sent_at: string | null;
  purpose?: string | null;
}

export interface SeaFreightPartnerActionSpec {
  kind: SeaFreightPartnerActionKind;
  title: string;
  status: "to_prepare" | "ready_to_send" | "waiting_response" | "to_execute";
  nextStep: string;
  reason: string;
}

/* Most advanced state wins when several freight_rate requests exist. */
function freightRequestRank(r: FreightRateRequestLite): number {
  switch (r.status) {
    case "response_received":
    case "response_analyzed":
      return 6;
    case "partially_validated":
      return 5;
    case "sent":
      return r.email_sent_at ? 4 : 3;
    case "draft":
      return 2;
    case "facts_validated":
    case "closed":
      return 1;
    default:
      return 0;
  }
}

export function computeSeaFreightPartnerAction(
  requests: FreightRateRequestLite[],
): SeaFreightPartnerActionSpec {
  const freightRequests = requests.filter((r) =>
    r.purpose === undefined ? true : r.purpose === "freight_rate",
  );

  if (freightRequests.length === 0) {
    return {
      kind: "prepare",
      title: "Préparer la demande partenaire freight_rate",
      status: "to_prepare",
      nextStep: "Créer une demande freight_rate puis l'envoyer au partenaire",
      reason: "Gap bloquant : offre maritime partenaire requise",
    };
  }

  const best = freightRequests.reduce((a, b) =>
    freightRequestRank(b) > freightRequestRank(a) ? b : a,
  );
  const bestRank = freightRequestRank(best);

  // Unknown status only → prefer a verification action over "Préparer".
  if (bestRank === 0) {
    return {
      kind: "verify",
      title: "Vérifier la cohérence de l'offre partenaire freight_rate",
      status: "to_execute",
      nextStep: "Relancer l'analyse ou vérifier pourquoi le gap partenaire reste ouvert",
      reason: "Gap bloquant encore ouvert malgré une demande partenaire finalisée",
    };
  }

  switch (best.status) {
    case "draft":
      return {
        kind: "prepare",
        title: "Préparer la demande partenaire freight_rate",
        status: "to_prepare",
        nextStep: "Compléter puis confirmer l'envoi aux partenaires",
        reason: "Gap bloquant : offre maritime partenaire requise",
      };
    case "sent":
      return best.email_sent_at
        ? {
            kind: "waiting",
            title: "En attente de réponse partenaire freight_rate",
            status: "waiting_response",
            nextStep: "Attendre la réponse du partenaire",
            reason: "Demande freight_rate envoyée — réponse partenaire attendue",
          }
        : {
            kind: "confirm_send",
            title: "Confirmer l'envoi de la demande partenaire freight_rate",
            status: "ready_to_send",
            nextStep: "Confirmer l'envoi, puis attendre la réponse partenaire",
            reason: "Demande freight_rate préparée mais envoi non confirmé",
          };
    case "response_received":
    case "response_analyzed":
      return {
        kind: "process_response",
        title: "Traiter la réponse partenaire freight_rate",
        status: "to_execute",
        nextStep: "Analyser puis valider ou rejeter les faits proposés",
        reason: "Réponse partenaire reçue — faits à traiter",
      };
    case "partially_validated":
      return {
        kind: "validate_facts",
        title: "Valider les faits partenaire restants",
        status: "to_execute",
        nextStep: "Terminer la validation des faits partenaire",
        reason: "Faits partenaire partiellement validés",
      };
    case "facts_validated":
    case "closed":
    default:
      return {
        kind: "verify",
        title: "Vérifier la cohérence de l'offre partenaire freight_rate",
        status: "to_execute",
        nextStep: "Relancer l'analyse ou vérifier pourquoi le gap partenaire reste ouvert",
        reason: "Gap bloquant encore ouvert malgré une demande partenaire finalisée",
      };
  }
}

/* ─── Component ─── */
export function NextActionBanner({ caseId }: Props) {
  const { data, isLoading } = useCockpitState(caseId);
  const { hasCriticalUnconfirmed } = useQualifiedScopeGate(caseId);
  const { data: bannerData } = useQuery({
    queryKey: ["next-action-banner", caseId],
    staleTime: 30_000,
    enabled: !!caseId,
    queryFn: async () => {
      const [gapsRes, reqRes] = await Promise.all([
        supabase
          .from("quote_gaps")
          .select("gap_key")
          .eq("case_id", caseId)
          .eq("status", "open")
          .eq("is_blocking", true),
        supabase
          .from("external_quote_requests")
          .select("status, email_sent_at, purpose")
          .eq("case_id", caseId),
      ]);

      if (gapsRes.error) throw gapsRes.error;
      return {
        blockingGaps: gapsRes.data ?? [],
        requests: (reqRes.data ?? []) as FreightRateRequestLite[],
      };
    },
  });

  const blockingGapKeys = bannerData?.blockingGaps.map((g) => g.gap_key) ?? [];
  const hasOnlySeaFreightPartnerBlockingGap =
    blockingGapKeys.length === 1 &&
    blockingGapKeys[0] === EXPORT_SEA_FREIGHT_PARTNER_GAP_KEY;

  if (isLoading || !data) return null;

  const seaFreightSpec = hasOnlySeaFreightPartnerBlockingGap
    ? computeSeaFreightPartnerAction(bannerData?.requests ?? [])
    : null;

  const result = computeAction(data, hasCriticalUnconfirmed, seaFreightSpec);
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
}, hasCriticalUnconfirmed: boolean, seaFreightSpec: SeaFreightPartnerActionSpec | null): ActionResult | null {

  // Terminal
  if (TERMINAL_STATUSES.has(d.status)) return null;

  // 1 — Blocking gaps
  // UI-P1-PARTNER-REQUEST-STATE-LABEL-1: label reflects the real freight_rate request state.
  if (seaFreightSpec) {
    const iconMap: Record<SeaFreightPartnerActionKind, React.ReactNode> = {
      prepare: <FileText className="h-4 w-4 text-amber-600" />,
      confirm_send: <Send className="h-4 w-4 text-amber-600" />,
      waiting: <Clock className="h-4 w-4 text-amber-600" />,
      process_response: <ShieldCheck className="h-4 w-4 text-amber-600" />,
      validate_facts: <ShieldCheck className="h-4 w-4 text-amber-600" />,
      verify: <Search className="h-4 w-4 text-amber-600" />,
    };
    return {
      action: seaFreightSpec.title,
      blocker: seaFreightSpec.reason,
      icon: iconMap[seaFreightSpec.kind],
      color: "amber",
    };
  }

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

  if (statusBelow(d.status, "PRICED_DRAFT")) return null;

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
