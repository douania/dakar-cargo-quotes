
-- ======================================================
-- Phase EQ1: External Quote Requests — 3 tables
-- ======================================================

-- 1. external_quote_requests
CREATE TABLE public.external_quote_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.quote_cases(id) ON DELETE CASCADE,
  partner_name TEXT NOT NULL,
  partner_email TEXT,
  purpose TEXT NOT NULL,
  purpose_detail TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  related_lot_index INT,
  sent_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT external_quote_requests_status_check CHECK (status IN ('draft', 'sent', 'response_received', 'response_analyzed', 'partially_validated', 'facts_validated', 'closed'))
);

CREATE INDEX idx_ext_req_case_status ON public.external_quote_requests(case_id, status);
CREATE INDEX idx_ext_req_case_created ON public.external_quote_requests(case_id, created_at DESC);

ALTER TABLE public.external_quote_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ext_req_select" ON public.external_quote_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY "ext_req_insert" ON public.external_quote_requests FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "ext_req_update" ON public.external_quote_requests FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER update_external_quote_requests_updated_at
  BEFORE UPDATE ON public.external_quote_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. external_quote_responses
CREATE TABLE public.external_quote_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.external_quote_requests(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES public.quote_cases(id) ON DELETE CASCADE,
  source_email_id UUID REFERENCES public.emails(id),
  raw_excerpt TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  analyzed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT external_quote_responses_status_check CHECK (status IN ('received', 'analyzed', 'reviewed')),
  CONSTRAINT external_quote_responses_unique_email UNIQUE (request_id, source_email_id)
);

CREATE INDEX idx_ext_resp_request_received ON public.external_quote_responses(request_id, received_at DESC);

ALTER TABLE public.external_quote_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ext_resp_select" ON public.external_quote_responses FOR SELECT TO authenticated USING (true);
CREATE POLICY "ext_resp_insert" ON public.external_quote_responses FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "ext_resp_update" ON public.external_quote_responses FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- 3. external_quote_response_facts
CREATE TABLE public.external_quote_response_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id UUID NOT NULL REFERENCES public.external_quote_responses(id) ON DELETE CASCADE,
  request_id UUID NOT NULL REFERENCES public.external_quote_requests(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES public.quote_cases(id) ON DELETE CASCADE,
  fact_key TEXT NOT NULL,
  proposed_value_text TEXT,
  proposed_value_number NUMERIC,
  currency TEXT,
  confidence NUMERIC NOT NULL DEFAULT 0.7,
  source_excerpt TEXT,
  validation_status TEXT NOT NULL DEFAULT 'proposed',
  validated_by UUID,
  validated_at TIMESTAMPTZ,
  injected_fact_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ext_resp_facts_validation_check CHECK (validation_status IN ('proposed', 'validated', 'rejected'))
);

CREATE INDEX idx_ext_resp_facts_request_status ON public.external_quote_response_facts(request_id, validation_status);
CREATE INDEX idx_ext_resp_facts_response ON public.external_quote_response_facts(response_id);

ALTER TABLE public.external_quote_response_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ext_facts_select" ON public.external_quote_response_facts FOR SELECT TO authenticated USING (true);
CREATE POLICY "ext_facts_insert" ON public.external_quote_response_facts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "ext_facts_update" ON public.external_quote_response_facts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- 4. Update CHECK constraints

-- Add 'partner_response' to quote_facts source_type
ALTER TABLE public.quote_facts DROP CONSTRAINT quote_facts_source_type_check;
ALTER TABLE public.quote_facts ADD CONSTRAINT quote_facts_source_type_check CHECK (source_type IN (
  'email_body', 'email_subject', 'attachment_pdf', 'attachment_excel', 'attachment_image',
  'manual_input', 'ai_extraction', 'ai_assumption', 'quotation_engine',
  'attachment_extracted', 'operator', 'document_regex', 'hs_resolution', 'known_contact_match',
  'partner_response'
));

-- Add 'external_request_created', 'external_response_analyzed' to event_type
ALTER TABLE public.case_timeline_events DROP CONSTRAINT case_timeline_events_event_type_check;
ALTER TABLE public.case_timeline_events ADD CONSTRAINT case_timeline_events_event_type_check CHECK (event_type IN (
  'case_created', 'status_changed', 'fact_added', 'fact_updated', 'fact_superseded',
  'gap_identified', 'gap_resolved', 'gap_waived', 'pricing_started', 'pricing_completed',
  'pricing_failed', 'output_generated', 'human_approved', 'human_rejected', 'sent',
  'archived', 'email_received', 'email_sent', 'attachment_analyzed', 'clarification_sent',
  'manual_action', 'status_rollback', 'fact_insert_failed', 'document_uploaded',
  'fact_injected_manual', 'assumption_applied', 'detection_corrected',
  'fact_injected_from_attachment', 'thread_intent_v1',
  'service_scope_v1', 'case_reasoning_v1', 'case_coherence_v1',
  'external_request_created', 'external_response_analyzed'
));
