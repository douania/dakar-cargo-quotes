-- ═══════════════════════════════════════════════════════════════════════════
-- Lot 2 — G8 : Restauration destination = 'Kolda'
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Suppression du fact injecté par le test
DELETE FROM quote_facts
WHERE case_id = '29b96eec-2b85-489f-937e-0da8190c9787'
  AND fact_key = 'routing.destination_city'
  AND source_excerpt = '[LOT2-G8 SMOKE TEST INJECTION - to be reverted]';

-- 2) Réactiver l'ancien fact Kolda (le plus récent restant)
WITH latest AS (
  SELECT id FROM quote_facts
  WHERE case_id = '29b96eec-2b85-489f-937e-0da8190c9787'
    AND fact_key = 'routing.destination_city'
  ORDER BY created_at DESC
  LIMIT 1
)
UPDATE quote_facts SET is_current = true WHERE id IN (SELECT id FROM latest);

-- 3) Vérification : doit retrouver Kolda is_current
SELECT 'POST_RESTORE_G8' AS phase, value_text, is_current
FROM quote_facts
WHERE case_id = '29b96eec-2b85-489f-937e-0da8190c9787'
  AND fact_key = 'routing.destination_city'
  AND is_current = true;
-- ATTENDU : 'Kolda', is_current = true
