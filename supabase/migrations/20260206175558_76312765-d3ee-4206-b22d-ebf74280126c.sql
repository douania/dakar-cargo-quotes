ALTER TABLE public.email_drafts
ADD CONSTRAINT email_drafts_version_fk
FOREIGN KEY (quotation_version_id)
REFERENCES public.quotation_versions(id)
ON DELETE SET NULL;