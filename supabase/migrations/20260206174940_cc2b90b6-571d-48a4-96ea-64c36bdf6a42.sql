ALTER TABLE public.email_drafts
  ADD COLUMN quotation_version_id uuid NULL
  REFERENCES public.quotation_versions(id) ON DELETE SET NULL;