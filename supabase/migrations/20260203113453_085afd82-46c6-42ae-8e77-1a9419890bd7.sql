-- Phase B & C: Add tracking columns for incremental puzzle and quotation continuity

-- B.1: Track which emails have been analyzed in each puzzle job
ALTER TABLE puzzle_jobs 
ADD COLUMN IF NOT EXISTS emails_analyzed_ids TEXT[] DEFAULT '{}';

COMMENT ON COLUMN puzzle_jobs.emails_analyzed_ids IS 
  'IDs des emails déjà analysés lors de ce job pour éviter re-traitement';

-- C.1: Track last email received for quote_case continuity
ALTER TABLE quote_cases 
ADD COLUMN IF NOT EXISTS last_email_seen_at TIMESTAMPTZ;

COMMENT ON COLUMN quote_cases.last_email_seen_at IS 
  'Timestamp du dernier email du thread vu par le système';

-- C.1: Index for efficient case lookup by thread and status
CREATE INDEX IF NOT EXISTS idx_quote_cases_thread_status 
ON quote_cases(thread_id, status);