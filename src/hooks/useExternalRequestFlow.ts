import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// P2.1: Pricing-critical fact keys that should trigger a rerun
const PRICING_CRITICAL_KEYS = new Set([
  "cargo.freight_cost",
  "cargo.freight_rate_per_kg",
  "cargo.origin_charges",
  "cargo.pre_carriage_cost",
]);

export function useExternalRequestFlow(caseId: string | undefined) {
  const queryClient = useQueryClient();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["external-requests", caseId] });
    queryClient.invalidateQueries({ queryKey: ["external-responses", caseId] });
    queryClient.invalidateQueries({ queryKey: ["external-response-facts", caseId] });
  };

  // P2.1: Send a draft request to the partner
  const sendRequest = useMutation({
    mutationFn: async (requestId: string) => {
      const { data, error } = await supabase.functions.invoke("send-external-quote-request", {
        body: { case_id: caseId, request_id: requestId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      if (data?.idempotent) {
        toast.info("Demande déjà envoyée");
      } else {
        toast.success("Demande partenaire envoyée — brouillon email créé");
      }
      invalidateAll();
    },
    onError: (err: Error) => {
      toast.error("Erreur d'envoi: " + err.message);
    },
  });

  // P2.3: Rerun pricing after critical fact validation
  const rerunPricing = useMutation({
    mutationFn: async () => {
      if (!caseId) throw new Error("case_id is required");
      const { data, error } = await supabase.functions.invoke("run-pricing", {
        body: { case_id: caseId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success("Pricing relancé avec les nouveaux faits");
      queryClient.invalidateQueries({ queryKey: ["pricing-runs", caseId] });
    },
    onError: (err: Error) => {
      toast.error("Erreur pricing: " + err.message);
    },
  });

  // P2.3: Validate fact + optionally trigger pricing rerun
  const validateFactAndRerun = useMutation({
    mutationFn: async (params: { factId: string; factKey: string }) => {
      const { data, error } = await supabase.functions.invoke("validate-partner-fact", {
        body: { fact_id: params.factId, action: "validate" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return { ...data, factKey: params.factKey };
    },
    onSuccess: (data) => {
      toast.success("Fait validé et injecté dans le dossier");
      invalidateAll();

      // Auto-trigger pricing if fact is pricing-critical
      if (data.factKey && PRICING_CRITICAL_KEYS.has(data.factKey)) {
        toast.info("Fait pricing critique détecté — relance du pricing…");
        rerunPricing.mutate();
      }
    },
    onError: (err: Error) => {
      toast.error("Erreur de validation: " + err.message);
    },
  });

  return {
    sendRequest,
    rerunPricing,
    validateFactAndRerun,
    isPricingRerunning: rerunPricing.isPending,
  };
}
