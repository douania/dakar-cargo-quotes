import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface ExternalRequest {
  id: string;
  case_id: string;
  partner_name: string;
  partner_email: string | null;
  purpose: string;
  purpose_detail: string | null;
  status: string;
  related_lot_index: number | null;
  sent_at: string | null;
  due_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExternalResponse {
  id: string;
  request_id: string;
  case_id: string;
  source_email_id: string | null;
  raw_excerpt: string | null;
  status: string;
  received_at: string;
  analyzed_at: string | null;
  created_at: string;
}

export interface ExternalResponseFact {
  id: string;
  response_id: string;
  request_id: string;
  case_id: string;
  fact_key: string;
  proposed_value_text: string | null;
  proposed_value_number: number | null;
  currency: string | null;
  confidence: number;
  source_excerpt: string | null;
  validation_status: string;
  validated_by: string | null;
  validated_at: string | null;
  injected_fact_id: string | null;
  created_at: string;
}

export function useExternalRequests(caseId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["external-requests", caseId];

  const { data: requests = [], isLoading: loadingRequests } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!caseId) return [];
      const { data, error } = await supabase
        .from("external_quote_requests" as any)
        .select("*")
        .eq("case_id", caseId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as ExternalRequest[];
    },
    enabled: !!caseId,
  });

  const { data: responses = [], isLoading: loadingResponses } = useQuery({
    queryKey: ["external-responses", caseId],
    queryFn: async () => {
      if (!caseId) return [];
      const { data, error } = await supabase
        .from("external_quote_responses" as any)
        .select("*")
        .eq("case_id", caseId)
        .order("received_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as ExternalResponse[];
    },
    enabled: !!caseId,
  });

  const { data: facts = [], isLoading: loadingFacts } = useQuery({
    queryKey: ["external-response-facts", caseId],
    queryFn: async () => {
      if (!caseId) return [];
      const { data, error } = await supabase
        .from("external_quote_response_facts" as any)
        .select("*")
        .eq("case_id", caseId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as ExternalResponseFact[];
    },
    enabled: !!caseId,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ["external-responses", caseId] });
    queryClient.invalidateQueries({ queryKey: ["external-response-facts", caseId] });
  };

  const createRequest = useMutation({
    mutationFn: async (params: {
      partner_name: string;
      partner_email?: string;
      purpose: string;
      purpose_detail?: string;
      related_lot_index?: number;
    }) => {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id || null;
      const { data, error } = await supabase
        .from("external_quote_requests" as any)
        .insert({
          case_id: caseId,
          partner_name: params.partner_name,
          partner_email: params.partner_email || null,
          purpose: params.purpose,
          purpose_detail: params.purpose_detail || null,
          related_lot_index: params.related_lot_index ?? null,
          created_by: userId,
          status: "draft",
        } as any)
        .select("id")
        .single();
      if (error) throw error;
      const result = data as unknown as { id: string };

      // Emit external_request_created timeline event
      if (result?.id && caseId) {
        await supabase
          .from("case_timeline_events" as any)
          .insert({
            case_id: caseId,
            event_type: "external_request_created",
            actor_type: "operator",
            actor_user_id: userId,
            new_value: `Demande partenaire: ${params.partner_name} (${params.purpose})`,
            event_data: {
              request_id: result.id,
              partner_name: params.partner_name,
              purpose: params.purpose,
              related_lot_index: params.related_lot_index ?? null,
            },
          } as any);
      }
      return result;
    },
    onSuccess: () => {
      toast.success("Demande partenaire créée");
      invalidateAll();
    },
    onError: (err: Error) => {
      toast.error("Erreur: " + err.message);
    },
  });



  const triggerAnalysis = useMutation({
    mutationFn: async (params: { request_id: string; email_id: string }) => {
      const { data, error } = await supabase.functions.invoke("analyze-partner-response", {
        body: { case_id: caseId, request_id: params.request_id, email_id: params.email_id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      if (data?.idempotent) {
        toast.info("Analyse déjà effectuée");
      } else {
        toast.success(`${data?.facts_count || 0} fait(s) extraits de la réponse partenaire`);
      }
      invalidateAll();
    },
    onError: (err: Error) => {
      toast.error("Erreur d'analyse: " + err.message);
    },
  });

  const validateFact = useMutation({
    mutationFn: async (factId: string) => {
      const { data, error } = await supabase.functions.invoke("validate-partner-fact", {
        body: { fact_id: factId, action: "validate" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success("Fait validé et injecté dans le dossier");
      invalidateAll();
    },
    onError: (err: Error) => {
      toast.error("Erreur de validation: " + err.message);
    },
  });

  const rejectFact = useMutation({
    mutationFn: async (factId: string) => {
      const { data, error } = await supabase.functions.invoke("validate-partner-fact", {
        body: { fact_id: factId, action: "reject" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.info("Fait rejeté");
      invalidateAll();
    },
    onError: (err: Error) => {
      toast.error("Erreur: " + err.message);
    },
  });

  // P1-1: Timeline event for closing request
  const closeRequest = useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase
        .from("external_quote_requests" as any)
        .update({ status: "closed" } as any)
        .eq("id", requestId);
      if (error) throw error;

      // Timeline event with dedupe_key
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id || null;
      const req = requests.find((r) => r.id === requestId);
      await supabase
        .from("case_timeline_events" as any)
        .insert({
          case_id: caseId,
          event_type: "manual_action",
          actor_type: "operator",
          actor_user_id: userId,
          new_value: `Demande partenaire clôturée: ${req?.partner_name || requestId}`,
          event_data: {
            dedupe_key: `external_request_closed:${requestId}`,
            action_code: "PARTNER_REQUEST_CLOSED",
            status: "done",
            request_id: requestId,
            partner_name: req?.partner_name || null,
          },
        } as any);
    },
    onSuccess: () => {
      toast.info("Demande clôturée");
      invalidateAll();
    },
  });

  return {
    requests,
    responses,
    facts,
    isLoading: loadingRequests || loadingResponses || loadingFacts,
    createRequest,
    markAsSent,
    triggerAnalysis,
    validateFact,
    rejectFact,
    closeRequest,
    invalidateAll,
  };
}
