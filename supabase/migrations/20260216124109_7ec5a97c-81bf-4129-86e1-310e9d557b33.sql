
-- Table case_documents
CREATE TABLE public.case_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.quote_cases(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER,
  uploaded_by UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_case_documents_case_id ON public.case_documents(case_id);

ALTER TABLE public.case_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "case_documents_select" ON public.case_documents
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "case_documents_insert" ON public.case_documents
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = uploaded_by);

CREATE POLICY "case_documents_delete" ON public.case_documents
  FOR DELETE TO authenticated USING (auth.uid() = uploaded_by);

-- Bucket privé
INSERT INTO storage.buckets (id, name, public)
VALUES ('case-documents', 'case-documents', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "case_docs_storage_select" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'case-documents');

CREATE POLICY "case_docs_storage_insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'case-documents');

CREATE POLICY "case_docs_storage_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'case-documents');
