/**
 * COCKPIT-11 — Scope fournisseur multi-postes détecté.
 * Composant lecture seule. Affiche les blocs du scope dérivé des facts + signal texte.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { derivePartnerRequestScope, type PartnerScopeItem } from "@/lib/partnerRequestScope";
import { Badge } from "@/components/ui/badge";
import { Layers, CheckCircle2, AlertCircle } from "lucide-react";

interface Props {
  caseId: string;
  threadId?: string | null;
}

const CONFIDENCE_STYLE: Record<string, { label: string; className: string }> = {
  high: { label: "Élevée", className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  medium: { label: "Moyenne", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  low: { label: "Faible", className: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
};

export function PartnerScopeCard({ caseId, threadId }: Props) {
  // 1. Facts structured (primary source)
  const { data: factsMap = {} } = useQuery({
    queryKey: ["partner-scope-facts", caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_facts")
        .select("fact_key, value_text")
        .eq("case_id", caseId)
        .eq("is_current", true)
        .in("fact_key", [
          "routing.transport_mode", "routing.origin_port", "routing.destination_port",
          "routing.origin_country", "routing.destination_country", "routing.destination_city",
          "routing.final_destination", "routing.incoterm",
          "cargo.description", "cargo.articles_detail", "cargo.container_type",
          "cargo.container_count", "cargo.weight_kg", "cargo.volume_cbm",
          "cargo.fcl_lcl", "cargo.hs_code",
        ]);
      if (error) throw error;
      const map: Record<string, string | null> = {};
      for (const row of data ?? []) map[row.fact_key] = row.value_text;
      return map;
    },
    staleTime: 30_000,
  });

  // 2. Latest client email text (complementary signal only)
  const { data: latestClientText } = useQuery({
    queryKey: ["partner-scope-client-text", caseId, threadId],
    enabled: !!threadId,
    queryFn: async () => {
      // Get latest non-internal email from the thread as complementary signal
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
  });

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
        {scope.map((item) => (
          <ScopeBlock key={item.purpose} item={item} />
        ))}
      </div>
    </div>
  );
}

function ScopeBlock({ item }: { item: PartnerScopeItem }) {
  const conf = CONFIDENCE_STYLE[item.confidence];
  return (
    <div className="border rounded-md p-2 bg-background space-y-1">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-xs font-medium">{item.label}</span>
        <Badge className={`text-[9px] ${conf.className}`}>
          {conf.label}
        </Badge>
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
