
ALTER TABLE public.external_quote_requests
  ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS email_draft_id UUID NULL REFERENCES public.email_drafts(id);

CREATE INDEX IF NOT EXISTS idx_external_quote_requests_email_draft_id
  ON public.external_quote_requests(email_draft_id);

COMMENT ON COLUMN public.external_quote_requests.email_sent_at IS 'Timestamp of actual email transmission (NULL = draft only, no real send yet). Filled by COM-1A when SMTP transport succeeds.';
COMMENT ON COLUMN public.external_quote_requests.email_draft_id IS 'FK to email_drafts — links the request to its generated email draft for traceability.';
