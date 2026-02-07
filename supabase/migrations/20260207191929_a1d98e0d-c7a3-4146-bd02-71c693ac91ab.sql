-- M3.7 P0-4: Idempotent audit for quote_service_pricing
ALTER TABLE public.quote_service_pricing
  ADD CONSTRAINT uq_qsp_case_service_line
  UNIQUE (case_id, service_line_id);