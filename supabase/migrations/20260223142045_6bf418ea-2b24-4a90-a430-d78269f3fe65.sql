-- P1-C: Add unique partial index on root_message_id (no duplicates confirmed via pre-check)
-- Keep existing non-unique index temporarily for safety
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_threads_root_message_id_unique
  ON email_threads(root_message_id)
  WHERE root_message_id IS NOT NULL;