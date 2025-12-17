-- Add indexes for performance optimization

-- Index on emails for common queries
CREATE INDEX IF NOT EXISTS idx_emails_thread_id ON emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_emails_from_address ON emails(from_address);
CREATE INDEX IF NOT EXISTS idx_emails_sent_at ON emails(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_config_id ON emails(email_config_id);

-- Index on learned_knowledge for filtering
CREATE INDEX IF NOT EXISTS idx_learned_knowledge_category ON learned_knowledge(category);
CREATE INDEX IF NOT EXISTS idx_learned_knowledge_validated ON learned_knowledge(is_validated);
CREATE INDEX IF NOT EXISTS idx_learned_knowledge_confidence ON learned_knowledge(confidence);

-- Index on email_attachments
CREATE INDEX IF NOT EXISTS idx_email_attachments_email_id ON email_attachments(email_id);

-- Index on documents
CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at DESC);