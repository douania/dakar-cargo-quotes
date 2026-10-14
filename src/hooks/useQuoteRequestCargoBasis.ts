import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { buildRequestCargoBasis } from "../../supabase/functions/_shared/quotation-cargo-basis";

/** One cache owner for current request lines; saved quotation bases never use it. */
export function useQuoteRequestCargoBasis(caseId: string | undefined) {
  const query = useQuery({
    queryKey: ["quote-request-lines", caseId],
    queryFn: async () => {
      const { data, error, count } = await supabase.from("quote_request_lines")
        .select("*", { count: "exact" }).eq("case_id", caseId!)
        .order("line_index", { ascending: true });
      if (error) throw error;
      if (count === null || count !== (data?.length ?? 0)) throw new Error("Lignes de demande incomplètes : actualisez le dossier.");
      const lines = data ?? [];
      return { lines, cargoBasis: buildRequestCargoBasis(lines) };
    },
    enabled: !!caseId,
    staleTime: 60000,
  });
  return { lines: query.data?.lines ?? [], cargoBasis: query.data?.cargoBasis ?? buildRequestCargoBasis([]), isLoading: query.isLoading, isError: query.isError };
}
