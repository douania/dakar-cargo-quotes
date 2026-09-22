/**
 * COCKPIT-8 Phase 1: Next action priority banner.
 * Read-only synthesis: shows the single most important action + main blocker.
 *
 * P1-A: Migrated to useCockpitState + cockpitStatusConstants.
 */

import { useCockpitState } from "@/hooks/useCockpitState";
import { useQualifiedScopeGate } from "@/hooks/useQualifiedScopeGate";
import { selectPilotageAction, type PilotageActionKind } from "@/pages/case-view/presentation";
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

/* ─── Component ─── */
export function NextActionBanner({ caseId }: Props) {
  const { data, isLoading } = useCockpitState(caseId);
  const { hasCriticalUnconfirmed } = useQualifiedScopeGate(caseId);

  if (isLoading || !data) return null;

  const result = selectPilotageAction(data, hasCriticalUnconfirmed, data.seaFreightAction);
  if (!result) return null;

  const iconMap: Record<PilotageActionKind, React.ReactNode> = {
    sea_freight: result.seaFreightKind === "waiting" ? <Clock className="h-4 w-4 text-amber-600" /> : <Search className="h-4 w-4 text-amber-600" />,
    pad_review: <Search className="h-4 w-4 text-amber-600" />,
    blocking_gap: <AlertTriangle className="h-4 w-4 text-destructive" />,
    draft_partner: <FileText className="h-4 w-4 text-amber-600" />,
    unsent_partner: <Send className="h-4 w-4 text-amber-600" />,
    pending_partner_fact: <ShieldCheck className="h-4 w-4 text-amber-600" />,
    draft_client_gap: <Mail className="h-4 w-4 text-blue-600" />,
    open_client_gap: <Search className="h-4 w-4 text-blue-600" />,
    select_partner: <CheckCircle2 className="h-4 w-4 text-amber-600" />,
    unlock_pricing: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
    confirm_scope: <CircleDashed className="h-4 w-4 text-amber-600" />,
    launch_pricing: <Calculator className="h-4 w-4 text-emerald-600" />,
    create_version: <FileText className="h-4 w-4 text-blue-600" />,
    export_pdf: <FileText className="h-4 w-4 text-blue-600" />,
    prepare_email: <Mail className="h-4 w-4 text-blue-600" />,
    mark_sent: <ArrowRight className="h-4 w-4 text-emerald-600" />,
  };

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
          {iconMap[result.kind]}
          <span className="text-sm font-medium">Action prioritaire</span>
          <Badge className={`${colorMap[result.tone]} text-xs font-medium`}>
            {result.label}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground ml-6">
          Blocage principal : {result.blocker}
        </p>
      </CardContent>
    </Card>
  );
}
