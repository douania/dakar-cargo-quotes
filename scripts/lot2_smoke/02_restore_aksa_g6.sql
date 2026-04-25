-- ═══════════════════════════════════════════════════════════════════════════
-- Lot 2 — G6 : Restauration après injection (suppression test fact)
-- ═══════════════════════════════════════════════════════════════════════════
-- Baseline = AUCUN fact client.code → restauration = supprimer toutes
-- les versions du fact créées par le test (identifiées via source_excerpt).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Suppression des facts injectés par le smoke test
DELETE FROM quote_facts
WHERE case_id = '03ccf66d-df20-47a1-875d-93133ee79020'
  AND fact_key = 'client.code'
  AND source_excerpt = '[LOT2-G6 SMOKE TEST INJECTION - to be reverted]';

-- 2) Vérification : aucun fact client.code ne doit subsister
SELECT 'POST_RESTORE' AS phase, case_id, fact_key, value_text, is_current
FROM quote_facts
WHERE case_id = '03ccf66d-df20-47a1-875d-93133ee79020'
  AND fact_key = 'client.code';
-- ATTENDU : 0 ligne
