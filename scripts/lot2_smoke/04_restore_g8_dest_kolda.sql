-- ═══════════════════════════════════════════════════════════════════════════
-- Lot 2 — G8 : Restauration id-safe transactionnelle (sans DO $$, sans NULLIF)
--
-- ⚠️ AVANT EXÉCUTION : remplacer le placeholder ci-dessous par l'UUID
--    affiché par le script 03 à l'étape 1 (champ baseline_fact_id).
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  COLLER ICI l'UUID baseline_fact_id capturé par le script 03      ║
-- ╚═══════════════════════════════════════════════════════════════════╝
\set baseline_fact_id '<<<PASTE_BASELINE_FACT_ID_HERE>>>'

BEGIN;

-- ── ÉTAPE 0 : ASSERT — placeholder remplacé et UUID syntaxiquement valide
--    Le cast ::uuid échoue si le placeholder n'a pas été remplacé.
SELECT :'baseline_fact_id'::uuid AS baseline_fact_id_parsed;

-- ── ÉTAPE 1 : ASSERT — l'ID existe et appartient au bon (case, fact, valeur)
--    1 / CASE ... ELSE 0 END → division par zéro réelle si l'assertion échoue,
--    déclenchée par ON_ERROR_STOP, qui rollback la transaction.
WITH baseline AS (
  SELECT id, case_id, fact_key, value_text
  FROM quote_facts
  WHERE id = :'baseline_fact_id'::uuid
)
SELECT
  1 / CASE
    WHEN COUNT(*) = 1
     AND BOOL_AND(case_id    = '29b96eec-2b85-489f-937e-0da8190c9787'::uuid)
     AND BOOL_AND(fact_key   = 'routing.destination_city')
     AND BOOL_AND(value_text = 'Kolda')
    THEN 1
    ELSE 0
  END AS assert_baseline_id_ok
FROM baseline;

-- ── ÉTAPE 2 : suppression EXCLUSIVE de la ligne smoke test
--    (triple filtre : case_id + fact_key + source_excerpt marqueur unique)
DELETE FROM quote_facts
WHERE case_id        = '29b96eec-2b85-489f-937e-0da8190c9787'
  AND fact_key       = 'routing.destination_city'
  AND source_excerpt = '[LOT2-G8 SMOKE TEST INJECTION - to be reverted]';

-- ── ÉTAPE 3 : réactivation EXCLUSIVE par id strict (double sécurité)
UPDATE quote_facts
SET is_current = true,
    updated_at = now()
WHERE id        = :'baseline_fact_id'::uuid
  AND case_id   = '29b96eec-2b85-489f-937e-0da8190c9787'
  AND fact_key  = 'routing.destination_city';

-- ── ÉTAPE 4 : ASSERT final (1 ligne courante = Kolda, et = baseline_fact_id)
WITH current_fact AS (
  SELECT id, value_text
  FROM quote_facts
  WHERE case_id    = '29b96eec-2b85-489f-937e-0da8190c9787'
    AND fact_key   = 'routing.destination_city'
    AND is_current = true
)
SELECT
  1 / CASE
    WHEN COUNT(*) = 1
     AND BOOL_AND(id         = :'baseline_fact_id'::uuid)
     AND BOOL_AND(value_text = 'Kolda')
    THEN 1
    ELSE 0
  END AS assert_restore_ok
FROM current_fact;

-- ── ÉTAPE 5 : preuve restauration (lecture seule)
SELECT id, value_text, is_current
FROM quote_facts
WHERE case_id    = '29b96eec-2b85-489f-937e-0da8190c9787'
  AND fact_key   = 'routing.destination_city'
  AND is_current = true;

COMMIT;
