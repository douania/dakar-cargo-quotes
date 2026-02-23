
ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS root_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_email_threads_root_message_id
  ON email_threads(root_message_id);
