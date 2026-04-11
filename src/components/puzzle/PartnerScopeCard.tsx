/**
 * COCKPIT-11 + P2-D — Scope fournisseur multi-postes détecté.
 * P2-D: Consomme useServiceScope + qualifyScope.
 *
 * Règles de surface (information) :
 *   confirmed    → affichage normal
 *   unconfirmed  → badge "non confirmé", style normal
 *   out_of_scope → visible mais secondaire (muted, badge "hors périmètre")
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { derivePartnerRequestScope, type PartnerScopeItem } from "@/lib/partnerRequestScope";
import { buildFactMapWithSynthetics } from "@/lib/extractContainerSynthetics";
import { Badge } from "@/components/ui/badge";
import { Layers, CheckCircle2 } from "lucide-react";
import { useServiceScope } from "@/hooks/useServiceScope";
import { qualifyScope, isServiceOutOfScope } from "@/lib/scopeQualification";
import { useMemo } from "react";

interface Props {
  caseId: string;
  threadId?: string | null;
}

const CONFIDENCE_STYLE: Record<string, { label: string; className: string }> = {
  high: { label: "Élevée", className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  medium: { label: "Moyenne", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  low: { label: "Faible", className: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
};

/** Map purpose → service for scope qualification lookup */
const PURPOSE_TO_SERVICE: Record<string, string> = {
  freight_rate: "freight",
  air_tariff: "freight",
  origin_charges: "customs",
  stuffing_factory: "customs",
  stuffing_port_cfs: "customs",
};

export function PartnerScopeCard({ caseId, threadId }: Props) {
  const { data: serviceScope } = useServiceScope(caseId);
  const freightScope = serviceScope?.freightScope ?? undefined;

  // Facts structured (primary source)
  const { data: factsMap = {} } = useQuery({
    queryKey: ["partner-scope-facts", caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_facts")
        .select("fact_key, value_text, value_number, value_json")
        .eq("case_id", caseId)
        .eq("is_current", true)
        .in("fact_key", [
          "routing.transport_mode", "routing.origin_port", "routing.destination_port",
          "routing.origin_country", "routing.destination_country", "routing.destination_city",
          "routing.final_destination", "routing.incoterm",
          "cargo.description", "cargo.articles_detail", "cargo.container_type",
          "cargo.container_count", "cargo.weight_kg", "cargo.volume_cbm",
          "cargo.fcl_lcl", "cargo.containers", "cargo.hs_code",
        ]);
      if (error) throw error;
      return buildFactMapWithSynthetics(data ?? []);
    },
    staleTime: 30_000,
  });

  // Latest client email text (complementary signal only)
  const { data: latestClientText } = useQuery({
    queryKey: ["partner-scope-client-text", caseId, threadId],
    enabled: !!threadId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("emails")
        .select("body_text")
        .eq("thread_id", threadId!)
        .not("from_address", "ilike", "%sodatra%")
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.body_text ?? undefined;
    },
    staleTime: 60_000,
  });

  const scope = derivePartnerRequestScope({
    facts: factsMap,
    latestClientEmailText: latestClientText,
    freightScope,
  });

  // P2-D: qualified scope for visual rules
  const qualifiedScopeResult = useMemo(
    () => qualifyScope({
      serviceScope: serviceScope ?? null,
      facts: factsMap,
      caseStatus: "INTAKE", // ScopeCard doesn't need status-based gating
    }),
    [serviceScope, factsMap],
  );

  if (scope.length === 0) return null;

  return (
    <div className="border rounded-lg p-3 bg-muted/30 space-y-2">
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Scope fournisseur détecté
        </span>
        <Badge variant="secondary" className="text-[10px]">
          {scope.length} {scope.length === 1 ? "bloc" : "blocs"}
        </Badge>
      </div>

      <div className="space-y-2">
        {scope.map((item) => {
          const relatedService = PURPOSE_TO_SERVICE[item.purpose] ?? "freight";
          const qItem = qualifiedScopeResult.items.find((i) => i.service === relatedService);
          const qualification = qItem?.qualification ?? "unconfirmed";

          return (
            <ScopeBlock key={item.purpose} item={item} qualification={qualification} />
          );
        })}
      </div>
    </div>
  );
}

function ScopeBlock({ item, qualification }: { item: PartnerScopeItem; qualification: string }) {
  const conf = CONFIDENCE_STYLE[item.confidence];
  const isOutOfScope = qualification === "out_of_scope";
  const isUnconfirmed = qualification === "unconfirmed";

  return (
    <div className={`border rounded-md p-2 bg-background space-y-1 ${isOutOfScope ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-2">
        <CheckCircle2 className={`h-3.5 w-3.5 shrink-0 ${isOutOfScope ? "text-muted-foreground" : "text-primary"}`} />
        <span className={`text-xs font-medium ${isOutOfScope ? "text-muted-foreground" : ""}`}>{item.label}</span>
        <Badge className={`text-[9px] ${conf.className}`}>
          {conf.label}
        </Badge>
        {isOutOfScope && (
          <Badge variant="outline" className="text-[9px] px-1 py-0 border-muted-foreground/30 text-muted-foreground">
            hors périmètre
          </Badge>
        )}
        {isUnconfirmed && !isOutOfScope && (
          <Badge variant="outline" className="text-[9px] px-1 py-0 border-muted-foreground/30 text-muted-foreground">
            non confirmé
          </Badge>
        )}
      </div>
      <ul className="ml-6 space-y-0.5">
        {item.requiredItems.map((ri) => (
          <li key={ri} className="text-[11px] text-muted-foreground flex items-start gap-1">
            <span className="text-muted-foreground/50 mt-0.5">·</span>
            {ri}
          </li>
        ))}
      </ul>
    </div>
  );
}
