/**
 * P2-D Lot 2 — Single point of truth for the scope gate.
 *
 * Reads useServiceScope (shared cache) + minimal facts (7 keys)
 * and returns hasCriticalUnconfirmed via qualifyScope().
 *
 * Does NOT read quote_cases.status — status gating stays in each consumer.
 * Adds 1 lightweight facts query (7 keys, staleTime 60s, shared via React Query).
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useServiceScope } from "@/hooks/useServiceScope";
import { qualifyScope } from "@/lib/scopeQualification";

/** The exact fact keys consumed by qualifyScope() SERVICE_DEFS */
const SCOPE_FACT_KEYS = [
  "routing.transport_mode",
  "routing.origin_port",
  "routing.destination_port",
  "cargo.hs_code",
  "cargo.value",
  "routing.destination_city",
  "routing.final_destination",
] as const;

export function useQualifiedScopeGate(caseId: string | undefined) {
  const { data: serviceScope, isLoading: scopeLoading } = useServiceScope(caseId);

  const { data: factsMap, isLoading: factsLoading } = useQuery({
    queryKey: ["scope-gate-facts", caseId],
    enabled: !!caseId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_facts")
        .select("fact_key, value_text")
        .eq("case_id", caseId!)
        .eq("is_current", true)
        .in("fact_key", [...SCOPE_FACT_KEYS]);

      if (error) throw error;

      const map: Record<string, string | null> = {};
      for (const row of data ?? []) {
        map[row.fact_key] = row.value_text;
      }
      return map;
    },
  });

  const isLoading = scopeLoading || factsLoading;

  if (isLoading || !factsMap) {
    return { hasCriticalUnconfirmed: false, isLoading };
  }

  const qualified = qualifyScope({
    serviceScope: serviceScope ?? null,
    facts: factsMap,
    caseStatus: "", // not used for hasCriticalUnconfirmed
  });

  return {
    hasCriticalUnconfirmed: qualified.hasCriticalUnconfirmed,
    isLoading: false,
  };
}
