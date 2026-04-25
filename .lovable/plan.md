# Plan — Réécriture id-safe G8 (transactionnelle, sans DO $$ avec variables psql)

## Objectif

Corriger uniquement le script 04 G8 selon votre dernière directive : éviter les blocs `DO $$ ... $$` qui consomment des variables psql `:'baseline_fact_id'` (substitution non fiable en dollar-quoted), passer en transactionnel `BEGIN/COMMIT` avec `\set ON_ERROR_STOP on`, et exprimer les assertions en SQL pur via `CASE WHEN ... THEN 1 ELSE 1/0 END`.

Le script 03 reste validé. Les scripts 01, 02, 05 restent inchangés.

Garanties statiques mesurées 2026-04-25 :
- baseline `29b96eec` / `routing.destination_city` = `aa764a42-e3dc-46e5-839a-5831a890aa69` → `Kolda` → `is_current=true` (1 ligne unique).

---

## Fichier 1 — `scripts/lot2_smoke/03_inject_g8_dest_velingara.sql`

```sql
-- ═══════════════════════════════════════════════════════════════════════
-- Lot 2 — G8 : Injection temporaire routing.destination_city='VELINGARA'
-- Cible : case 29b96eec-2b85-489f-937e-0da8190c9787
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
  SELECT id, value_text
  FROM quote_facts
  WHERE case_id    = '29b96eec-2b85-489f-937e-0da8190c9787'
    AND fact_key   = 'routing.destination_city'
    AND is_current = true
)
SELECT
  CASE
    WHEN COUNT(*) = 1 AND MAX(value_text) = 'Kolda' THEN 1
    ELSE 1 / 0
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
```

---

## Fichier 2 — `scripts/lot2_smoke/04_restore_g8_dest_kolda.sql`

```sql
-- ═══════════════════════════════════════════════════════════════════════
-- Lot 2 — G8 : Restauration id-safe transactionnelle (sans DO $$)
--
-- ⚠️ AVANT EXÉCUTION : remplacer le placeholder ci-dessous par l'UUID
--    affiché par le script 03 à l'étape 1 (champ baseline_fact_id).
-- ═══════════════════════════════════════════════════════════════════════

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
WITH baseline AS (
  SELECT id, case_id, fact_key, value_text
  FROM quote_facts
  WHERE id = :'baseline_fact_id'::uuid
)
SELECT
  CASE
    WHEN COUNT(*) = 1
     AND MAX(case_id)    = '29b96eec-2b85-489f-937e-0da8190c9787'::uuid
     AND MAX(fact_key)   = 'routing.destination_city'
     AND MAX(value_text) = 'Kolda'
    THEN 1
    ELSE 1 / 0
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
  CASE
    WHEN COUNT(*) = 1
     AND MAX(id)         = :'baseline_fact_id'::uuid
     AND MAX(value_text) = 'Kolda'
    THEN 1
    ELSE 1 / 0
  END AS assert_restore_ok
FROM current_fact;

-- ── ÉTAPE 5 : preuve restauration
SELECT id, value_text, is_current
FROM quote_facts
WHERE case_id    = '29b96eec-2b85-489f-937e-0da8190c9787'
  AND fact_key   = 'routing.destination_city'
  AND is_current = true;

COMMIT;
```

---

## Garanties

| Risque | Mitigation |
|--------|------------|
| Suppression d'un vrai fact métier | Triple filtre case_id + fact_key + source_excerpt marqueur unique |
| Restauration d'une mauvaise version | Réactivation par id strict, double-vérifié case_id + fact_key |
| Baseline incorrecte avant injection | Assertion SQL `1/0` en script 03 |
| Placeholder oublié | `:'baseline_fact_id'::uuid` échoue → `ON_ERROR_STOP` → rollback BEGIN |
| UUID mal collé (autre case/fact/valeur) | Assertion SQL bloquante avant DELETE/UPDATE |
| Substitution psql dans DO $$ | Évitée — uniquement dans SQL standard |
| Échec partiel | `BEGIN/COMMIT` + `ON_ERROR_STOP on` → rollback global |
| Heuristique created_at pour décision | Aucune (uniquement pour affichage de preuve en script 03) |

## Fichiers modifiés

- `scripts/lot2_smoke/03_inject_g8_dest_velingara.sql` (réécriture complète + `ON_ERROR_STOP`)
- `scripts/lot2_smoke/04_restore_g8_dest_kolda.sql` (réécriture complète, transactionnel sans `DO $$`)

## Fichiers non touchés

- `scripts/lot2_smoke/01_inject_aksa_g6.sql`
- `scripts/lot2_smoke/02_restore_aksa_g6.sql`
- `scripts/lot2_smoke/05_validate_results.sql`
- Aucun code applicatif, aucune migration, aucune edge function.

## Étapes d'exécution post-validation

1. Application des deux fichiers (mode build).
2. Vous lancez la séquence des 10 étapes du `LOT_2_REPORT.md §7`.
3. Je finalise les verdicts G6–G9 dans `LOT_2_REPORT.md` à partir de la sortie de `05_validate_results.sql`.
