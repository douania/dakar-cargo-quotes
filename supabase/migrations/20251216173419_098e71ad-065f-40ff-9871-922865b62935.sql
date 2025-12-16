-- Table pour stocker les documents uploadés et analysés
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename VARCHAR(255) NOT NULL,
  file_type VARCHAR(50) NOT NULL,
  file_size INTEGER,
  content_text TEXT,
  extracted_data JSONB,
  source VARCHAR(50) DEFAULT 'upload',
  email_subject TEXT,
  email_from TEXT,
  email_date TIMESTAMPTZ,
  tags TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table pour stocker les configurations IMAP
CREATE TABLE email_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  host VARCHAR(255) NOT NULL,
  port INTEGER NOT NULL DEFAULT 993,
  username VARCHAR(255) NOT NULL,
  password_encrypted TEXT NOT NULL,
  use_ssl BOOLEAN DEFAULT TRUE,
  folder VARCHAR(100) DEFAULT 'INBOX',
  last_sync_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour recherche full-text
CREATE INDEX idx_documents_content ON documents USING gin(to_tsvector('french', COALESCE(content_text, '')));
CREATE INDEX idx_documents_filename ON documents(filename);
CREATE INDEX idx_documents_source ON documents(source);
CREATE INDEX idx_documents_created ON documents(created_at DESC);

-- Enable RLS
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_configs ENABLE ROW LEVEL SECURITY;

-- Public read for documents (since no auth)
CREATE POLICY "documents_public_read" ON documents FOR SELECT USING (true);
CREATE POLICY "documents_public_insert" ON documents FOR INSERT WITH CHECK (true);
CREATE POLICY "documents_public_update" ON documents FOR UPDATE USING (true);
CREATE POLICY "documents_public_delete" ON documents FOR DELETE USING (true);

CREATE POLICY "email_configs_public_read" ON email_configs FOR SELECT USING (true);
CREATE POLICY "email_configs_public_insert" ON email_configs FOR INSERT WITH CHECK (true);
CREATE POLICY "email_configs_public_update" ON email_configs FOR UPDATE USING (true);
CREATE POLICY "email_configs_public_delete" ON email_configs FOR DELETE USING (true);

-- Storage bucket for documents
INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', true);

-- Storage policies
CREATE POLICY "documents_storage_public_read" ON storage.objects FOR SELECT USING (bucket_id = 'documents');
CREATE POLICY "documents_storage_public_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'documents');
CREATE POLICY "documents_storage_public_delete" ON storage.objects FOR DELETE USING (bucket_id = 'documents');