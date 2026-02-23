
-- Suppression conditionnelle des 16 orphelins legacy
-- Conditions : aucun email lié, aucun quote_case, aucun puzzle_job
DELETE FROM email_threads t
WHERE t.root_message_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM emails e WHERE e.thread_ref = t.id)
  AND NOT EXISTS (SELECT 1 FROM quote_cases qc WHERE qc.thread_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM puzzle_jobs pj WHERE pj.thread_id = t.id);
