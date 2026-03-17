-- P1-3: Indexes for case_id-based UI queries on external quote tables
CREATE INDEX IF NOT EXISTS idx_ext_resp_case_received ON public.external_quote_responses(case_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ext_resp_facts_case_created ON public.external_quote_response_facts(case_id, created_at DESC);