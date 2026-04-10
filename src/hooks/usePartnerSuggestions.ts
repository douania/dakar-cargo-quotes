// COM-2A — Hook for partner response suggestions
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface PartnerSuggestion {
  id: string;
  case_id: string;
  request_id: string;
  suggested_email_id: string;
  score: number;
  confidence_level: "high" | "medium" | "low";
  reasons: string[];
  suggestion_status: "pending" | "accepted" | "rejected";
  created_at: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
}

export function usePartnerSuggestions(caseId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["partner-response-suggestions", caseId];

  const { data: suggestions = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!caseId) return [];
      const { data, error } = await supabase
        .from("partner_response_suggestions")
        .select("*")
        .eq("case_id", caseId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as PartnerSuggestion[];
    },
    enabled: !!caseId,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ["external-requests", caseId] });
    queryClient.invalidateQueries({ queryKey: ["external-responses", caseId] });
    queryClient.invalidateQueries({ queryKey: ["external-response-facts", caseId] });
    // P1-A: unified cockpit state
    queryClient.invalidateQueries({ queryKey: ["cockpit-state", caseId] });
  };

  const scanSuggestions = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("auto-match-partner-responses", {
        body: { action: "scan", case_id: caseId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      const count = data?.suggestions?.length ?? 0;
      if (count > 0) {
        toast.success(`${count} suggestion(s) trouvée(s)`);
      } else {
        toast.info("Aucune nouvelle suggestion");
      }
      invalidateAll();
    },
    onError: (err: Error) => {
      toast.error("Erreur scan: " + err.message);
    },
  });

  const confirmSuggestion = useMutation({
    mutationFn: async (suggestionId: string) => {
      const { data, error } = await supabase.functions.invoke("auto-match-partner-responses", {
        body: { action: "confirm", case_id: caseId, suggestion_id: suggestionId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      if (data?.idempotent) {
        toast.info("Suggestion déjà confirmée");
      } else {
        const factsCount = data?.analyze_result?.facts_count ?? 0;
        toast.success(`Suggestion confirmée — ${factsCount} fait(s) extraits`);
      }
      invalidateAll();
    },
    onError: (err: Error) => {
      toast.error("Erreur confirmation: " + err.message);
    },
  });

  const rejectSuggestion = useMutation({
    mutationFn: async (suggestionId: string) => {
      const { data, error } = await supabase.functions.invoke("auto-match-partner-responses", {
        body: { action: "reject", case_id: caseId, suggestion_id: suggestionId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.info("Suggestion rejetée");
      invalidateAll();
    },
    onError: (err: Error) => {
      toast.error("Erreur rejet: " + err.message);
    },
  });

  // Helpers
  const pendingSuggestions = suggestions.filter((s) => s.suggestion_status === "pending");
  const getSuggestionsForRequest = (requestId: string) =>
    suggestions.filter((s) => s.request_id === requestId);
  const getPendingForRequest = (requestId: string) =>
    suggestions.filter((s) => s.request_id === requestId && s.suggestion_status === "pending");

  return {
    suggestions,
    pendingSuggestions,
    isLoading,
    scanSuggestions,
    confirmSuggestion,
    rejectSuggestion,
    getSuggestionsForRequest,
    getPendingForRequest,
    invalidateAll,
  };
}
