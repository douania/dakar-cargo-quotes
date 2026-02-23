
-- ============================================================
-- Remediation legacy email_threads (root_message_id IS NULL)
-- Version CTO-safe : non destructive, idempotente
-- ============================================================

-- Étape 1 : Recalcul email_count + first/last dates
-- pour tous les threads legacy où au moins une valeur diverge
UPDATE email_threads t
SET
  email_count = sub.actual_count,
  first_message_at = COALESCE(sub.first_at, t.first_message_at),
  last_message_at = COALESCE(sub.last_at, t.last_message_at),
  updated_at = now()
FROM (
  SELECT
    e.thread_ref,
    COUNT(*)::int AS actual_count,
    MIN(e.sent_at) FILTER (WHERE e.sent_at IS NOT NULL) AS first_at,
    MAX(e.sent_at) FILTER (WHERE e.sent_at IS NOT NULL) AS last_at
  FROM emails e
  WHERE e.thread_ref IS NOT NULL
  GROUP BY e.thread_ref
) sub
WHERE t.id = sub.thread_ref
  AND t.root_message_id IS NULL
  AND (
    t.email_count IS DISTINCT FROM sub.actual_count
    OR t.first_message_at IS DISTINCT FROM sub.first_at
    OR t.last_message_at IS DISTINCT FROM sub.last_at
  );

-- Étape 2 : Safety net non destructif pour orphelins legacy
-- (threads sans aucun email lié → email_count = 0, pas de DELETE)
UPDATE email_threads t
SET
  email_count = 0,
  updated_at = now()
WHERE t.root_message_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM emails e WHERE e.thread_ref = t.id
  )
  AND t.email_count IS DISTINCT FROM 0;
