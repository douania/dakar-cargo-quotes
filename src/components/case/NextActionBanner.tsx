/**
 * COCKPIT-8 Phase 1: Next action priority banner.
 * Read-only synthesis: shows the single most important action + main blocker.
 * Uses explicit STATUS_ORDER — no naive string comparison.
 */

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

/* ─── Status hierarchy (same as CaseActionPlan) ─── */
const STATUS_ORDER: Record<string, number> = {
  INTAKE: 0, NEW_THREAD: 1, RFQ_DETECTED: 2, FACTS_PARTIAL: 3, NEED_INFO: 4,
  READY_TO_PRICE: 5, DECISIONS_PENDING: 6, DECISIONS_COMPLETE: 7,
  ACK_READY_FOR_PRICING: 8, PRICING_RUNNING: 9, PRICED_DRAFT: 10,
  HUMAN_REVIEW: 11, QUOTED_VERSIONED: 12, SENT: 13, ACCEPTED: 14,
  REJECTED: 15, ARCHIVED: 16,
};
function statusBelow(current: string, threshold: string): boolean {
  return (STATUS_ORDER[current] ?? -1) < (STATUS_ORDER[threshold] ?? 999);
}

const TERMINAL = new Set(["SENT", "ACCEPTED", "REJECTED", "ARCHIVED"]);

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
  const { data, isLoading } = useQuery({
    queryKey: ["next-action-banner", caseId],
    staleTime: 30_000,
    enabled: !!caseId,
    queryFn: async () => {
      const [
        caseRes, gapsRes, reqRes, factsRes, clientGapsRes, versionsRes,
      ] = await Promise.all([
        supabase.from("quote_cases").select("status").eq("id", caseId).maybeSingle(),
        supabase.from("quote_gaps").select("id", { count: "exact", head: true })
          .eq("case_id", caseId).eq("is_blocking", true).eq("status", "open"),
        supabase.from("external_quote_requests").select("id, status, email_sent_at, is_selected")
          .eq("case_id", caseId),
        supabase.from("external_quote_response_facts").select("id", { count: "exact", head: true })
          .eq("case_id", caseId).eq("validation_status", "proposed"),
        supabase.from("client_gap_requests").select("id, status")
          .eq("case_id", caseId).in("status", ["drafted", "sent", "answered"] as unknown as string[]),
        supabase.from("quotation_versions").select("id")
          .eq("case_id", caseId).eq("is_selected", true).limit(1),
      ]);

      const status = caseRes.data?.status ?? "INTAKE";
      const blockingGaps = gapsRes.count ?? 0;
      const requests = reqRes.data ?? [];
      const pendingFacts = factsRes.count ?? 0;
      const clientGaps = clientGapsRes.data ?? [];
      const hasSelectedVersion = (versionsRes.data?.length ?? 0) > 0;

      const draftRequests = requests.filter(r => r.status === "draft").length;
      const unsentRequests = requests.filter(r => r.status === "sent" && !r.email_sent_at).length;
      const hasSelectedPartner = requests.some(r => r.is_selected);
      const hasExploitableRequests = requests.some(r =>
        ["response_received", "response_analyzed", "partially_validated", "facts_validated", "closed"].includes(r.status)
      );

      const draftedClientGaps = clientGaps.filter(g => g.status === "drafted").length;
      const openClientGaps = clientGaps.filter(g => g.status === "sent" || g.status === "answered").length;

      // Lazy queries only if version exists
      let hasPdf = false;
      let hasDraftEmail = false;
      if (hasSelectedVersion) {
        const versionId = versionsRes.data![0].id;
        const pdfRes = await supabase.from("quotation_documents")
          .select("id", { count: "exact", head: true })
          .eq("quotation_version_id", versionId).eq("document_type", "pdf");
        const emailRes = await supabase.from("email_drafts")
          .select("id", { count: "exact", head: true })
          .eq("quotation_version_id", versionId).eq("status", "draft");
        hasPdf = (pdfRes.count ?? 0) > 0;
        hasDraftEmail = (emailRes.count ?? 0) > 0;
      }

      return {
        status, blockingGaps, draftRequests, unsentRequests, pendingFacts,
        draftedClientGaps, openClientGaps, hasSelectedVersion, hasPdf,
        hasDraftEmail, hasSelectedPartner, hasExploitableRequests,
        totalRequests: requests.length,
      };
    },
  });

  if (isLoading || !data) return null;

  const result = computeAction(data);
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
  status: string; blockingGaps: number; draftRequests: number;
  unsentRequests: number; pendingFacts: number; draftedClientGaps: number;
  openClientGaps: number; hasSelectedVersion: boolean; hasPdf: boolean;
  hasDraftEmail: boolean; hasSelectedPartner: boolean; hasExploitableRequests: boolean;
  totalRequests: number;
}): ActionResult | null {

  // Terminal
  if (TERMINAL.has(d.status)) return null;

  // 1 — Blocking gaps
  if (d.blockingGaps > 0) return {
    action: `Résoudre ${d.blockingGaps} gap(s) bloquant(s)`,
    blocker: `${d.blockingGaps} gap(s) bloquant(s)`,
    icon: <AlertTriangle className="h-4 w-4 text-destructive" />,
    color: "red",
  };

  // 2 — Draft partner requests
  if (d.draftRequests > 0) return {
    action: `Préparer ${d.draftRequests} demande(s) partenaire(s)`,
    blocker: "Demandes non préparées",
    icon: <FileText className="h-4 w-4 text-amber-600" />,
    color: "amber",
  };

  // 3 — Unsent partner requests
  if (d.unsentRequests > 0) return {
    action: `Confirmer l'envoi de ${d.unsentRequests} demande(s)`,
    blocker: "Envois non confirmés",
    icon: <Send className="h-4 w-4 text-amber-600" />,
    color: "amber",
  };

  // 4 — Pending partner facts
  if (d.pendingFacts > 0) return {
    action: `Valider ${d.pendingFacts} fait(s) partenaire(s)`,
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
  if (d.totalRequests > 0 && d.hasExploitableRequests && !d.hasSelectedPartner) return {
    action: "Retenir une offre partenaire",
    blocker: "Sélection commerciale non faite",
    icon: <CheckCircle2 className="h-4 w-4 text-amber-600" />,
    color: "amber",
  };

  // 8 — Launch pricing
  if (statusBelow(d.status, "PRICED_DRAFT")) return {
    action: "Lancer le pricing",
    blocker: "Aucun blocage majeur",
    icon: <Calculator className="h-4 w-4 text-emerald-600" />,
    color: "emerald",
  };

  // 8 — Create version
  if (!d.hasSelectedVersion) return {
    action: "Créer la version du devis",
    blocker: "Version non créée",
    icon: <FileText className="h-4 w-4 text-blue-600" />,
    color: "blue",
  };

  // 9 — Export PDF
  if (!d.hasPdf) return {
    action: "Exporter le PDF",
    blocker: "PDF non généré",
    icon: <FileText className="h-4 w-4 text-blue-600" />,
    color: "blue",
  };

  // 10 — Prepare client email
  if (!d.hasDraftEmail) return {
    action: "Préparer l'email client",
    blocker: "Brouillon non créé",
    icon: <Mail className="h-4 w-4 text-blue-600" />,
    color: "blue",
  };

  // 11 — Mark sent
  if (d.status !== "SENT") return {
    action: "Marquer l'envoi client",
    blocker: "Envoi non confirmé",
    icon: <ArrowRight className="h-4 w-4 text-emerald-600" />,
    color: "emerald",
  };

  // Fallback (shouldn't reach here because SENT is terminal)
  return null;
}
