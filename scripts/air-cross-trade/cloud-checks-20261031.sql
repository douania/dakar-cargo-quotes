-- Observed Cloud metadata, 2026-10-31, SELECT-only preflight.
-- Fixture ONLY: never applied to Lovable. This mirrors the checks relevant to this increment,
-- not a claim that the whole Cloud schema is replicated.
ALTER TABLE public.quote_facts ALTER COLUMN source_type SET NOT NULL;
ALTER TABLE public.quote_facts ALTER COLUMN fact_category SET NOT NULL;
ALTER TABLE public.quote_facts ALTER COLUMN fact_category DROP DEFAULT;
ALTER TABLE public.quote_facts ADD CONSTRAINT quote_facts_source_type_check CHECK(source_type=ANY(ARRAY['email_body','email_subject','attachment_pdf','attachment_excel','attachment_image','manual_input','ai_extraction','ai_assumption','quotation_engine','attachment_extracted','operator','document_regex','hs_resolution','known_contact_match','partner_response']::text[]));
ALTER TABLE public.quote_facts ADD CONSTRAINT quote_facts_fact_category_check CHECK(fact_category=ANY(ARRAY['cargo','routing','timing','pricing','documents','contacts','other','service','regulatory','carrier','survey','customs','transport']::text[]));
ALTER TABLE public.quote_facts ADD CONSTRAINT quote_facts_confidence_check CHECK(confidence>=0 AND confidence<=1);
ALTER TABLE public.quote_gaps ADD CONSTRAINT quote_gaps_status_check CHECK(status=ANY(ARRAY['open','pending_response','resolved','waived']::text[]));
ALTER TABLE public.client_gap_requests ADD CONSTRAINT client_gap_requests_status_check CHECK(status=ANY(ARRAY['drafted','sent','answered','validated','cancelled']::text[]));
ALTER TABLE public.pricing_runs ADD CONSTRAINT pricing_runs_status_check CHECK(status=ANY(ARRAY['pending','running','success','failed','superseded','blocked']::text[]));
ALTER TABLE public.pricing_runs ALTER COLUMN inputs_json SET NOT NULL;
ALTER TABLE public.pricing_runs ALTER COLUMN facts_snapshot SET NOT NULL;
ALTER TABLE public.quotation_versions ADD COLUMN scenario_pricing_run_id uuid;
ALTER TABLE public.quotation_versions ADD CONSTRAINT quotation_versions_status_check CHECK(status=ANY(ARRAY['draft','approved','superseded']::text[]));
ALTER TABLE public.quotation_versions ADD CONSTRAINT quotation_versions_source_shape CHECK((source_kind='canonical' AND pricing_run_id IS NOT NULL AND scenario_pricing_run_id IS NULL AND version_number>0) OR (source_kind='scenario' AND pricing_run_id IS NULL AND scenario_pricing_run_id IS NOT NULL AND version_number<0 AND is_selected=false AND status='draft'));
ALTER TABLE public.pricing_rate_cards ALTER COLUMN source SET DEFAULT 'internal';
ALTER TABLE public.pricing_rate_cards ADD CONSTRAINT pricing_rate_cards_source_check CHECK(source=ANY(ARRAY['internal','official','historical']::text[]));
ALTER TABLE public.quote_request_lines ADD COLUMN line_index integer NOT NULL;
ALTER TABLE public.quote_request_lines ADD CONSTRAINT quote_request_lines_case_id_line_index_key UNIQUE(case_id,line_index);
