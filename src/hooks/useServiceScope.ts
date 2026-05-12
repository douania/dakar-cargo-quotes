/**
 * P2-D Lot 1 — Lightweight hook for reading the latest service_scope_v1 event.
 * Single query, replaces 2-3 duplicate queries across PartnerSuggestionPanel,
 * PartnerScopeCard, and CaseUnderstandingPanel.
 *
 * v5 — Returns null instead of undefined to satisfy TanStack Query
 * (queryFn must not resolve to undefined).
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ServiceScope {
  freightScope: boolean | null;
  customsScope: boolean | null;
  transitScope: boolean | null;
  documentScope: boolean | null;
}

export function useServiceScope(caseId: string | undefined) {
  return useQuery<ServiceScope | null>({
    queryKey: ["service-scope", caseId],
    enabled: !!caseId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("case_timeline_events")
        .select("event_data")
        .eq("case_id", caseId!)
        .eq("event_type", "service_scope_v1")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data?.event_data) return null;

      const ed = data.event_data as Record<string, unknown>;
      const scope = ed?.["scope"] as Record<string, unknown> | undefined;
      if (!scope) return null;

      const toBoolOrNull = (v: unknown): boolean | null =>
        typeof v === "boolean" ? v : null;

      return {
        freightScope: toBoolOrNull(scope["freight_scope"]),
        customsScope: toBoolOrNull(scope["customs_scope"]),
        transitScope: toBoolOrNull(scope["transit_scope"]),
        documentScope: toBoolOrNull(scope["document_scope"]),
      };
    },
  });
}
