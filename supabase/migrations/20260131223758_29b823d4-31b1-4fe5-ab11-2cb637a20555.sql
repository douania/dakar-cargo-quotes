-- Phase 5C : Table de suivi des documents PDF générés

CREATE TABLE IF NOT EXISTS quotation_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id UUID NOT NULL REFERENCES quotation_history(id) ON DELETE CASCADE,
  root_quotation_id UUID NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('pdf', 'excel')),
  file_path TEXT NOT NULL,
  file_size INTEGER,
  file_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Index pour recherche rapide
CREATE INDEX IF NOT EXISTS idx_quotation_documents_quotation_id
ON quotation_documents(quotation_id);

CREATE INDEX IF NOT EXISTS idx_quotation_documents_root
ON quotation_documents(root_quotation_id);

-- RLS (Amendement 3 Phase 5D appliqué)
ALTER TABLE quotation_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quotation_documents_select" ON quotation_documents
FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE POLICY "quotation_documents_insert" ON quotation_documents
FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);