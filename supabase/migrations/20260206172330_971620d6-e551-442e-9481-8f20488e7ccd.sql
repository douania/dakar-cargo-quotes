-- Phase 17C: Allow quotation_documents to exist without legacy quotation_history reference
-- Documents created via quotation_versions use quotation_version_id as primary link
ALTER TABLE public.quotation_documents ALTER COLUMN quotation_id DROP NOT NULL;
ALTER TABLE public.quotation_documents ALTER COLUMN root_quotation_id DROP NOT NULL;