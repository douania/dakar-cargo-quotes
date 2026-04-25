-- ═══════════════════════════════════════════════════════════════════════
-- Lot 2 — G8 : Injection temporaire routing.destination_city='VELINGARA'
-- Cible : case 29b96eec-2b85-489f-937e-0da8190c9787 (non-Aksa, sans client.code)
--
-- Stratégie id-safe : capture + AFFICHAGE du baseline_fact_id à coller
-- manuellement dans le script 04. Aucune table temporaire.
-- ═══════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

\echo ''
\echo '── ÉTAPE 1 : baseline_fact_id (À NOTER pour le script 04) ──'
SELECT
  id            AS baseline_fact_id,
  value_text    AS baseline_value,
  is_current,
  created_at    AS baseline_created_at,
  source_type   AS baseline_source_type
FROM quote_facts
WHERE case_id    = '29b96eec-2b85-489f-937e-0da8190c9787'
  AND fact_key   = 'routing.destination_city'
  AND is_current = true;

\echo ''
\echo '── ÉTAPE 2 : ASSERT baseline conforme (1 ligne, Kolda) ──'
WITH baseline AS (
  SELECT value_text
  FROM quote_facts
  WHERE case_id    = '29b96eec-2b85-489f-937e-0da8190c9787'
    AND fact_key   = 'routing.destination_city'
    AND is_current = true
)
SELECT
  1 / CASE
    WHEN COUNT(*) = 1
     AND BOOL_AND(value_text = 'Kolda')
    THEN 1
    ELSE 0
  END AS assert_baseline_ok
FROM baseline;

\echo ''
\echo '── ÉTAPE 3 : injection VELINGARA (marquée smoke test) ──'
SELECT public.supersede_fact(
  p_case_id        => '29b96eec-2b85-489f-937e-0da8190c9787'::uuid,
  p_fact_key       => 'routing.destination_city',
  p_fact_category  => 'routing',
  p_value_text     => 'VELINGARA',
  p_source_type    => 'manual_input',
  p_source_excerpt => '[LOT2-G8 SMOKE TEST INJECTION - to be reverted]',
  p_confidence     => 1.0
) AS injected_fact_id;

\echo ''
\echo '── ÉTAPE 4 : preuve post-injection (lecture seule) ──'
SELECT id, value_text, is_current, source_excerpt
FROM quote_facts
WHERE case_id   = '29b96eec-2b85-489f-937e-0da8190c9787'
  AND fact_key  = 'routing.destination_city'
ORDER BY created_at DESC
LIMIT 5;
-- ATTENDU : VELINGARA is_current=true, Kolda (baseline) is_current=false.
