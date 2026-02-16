
-- Correctif 2: Contrainte UNIQUE pour idempotence du stockage final
ALTER TABLE public.case_documents
ADD CONSTRAINT case_documents_case_id_file_name_unique UNIQUE (case_id, file_name);
