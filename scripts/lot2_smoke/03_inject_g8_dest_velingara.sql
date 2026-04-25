-- ═══════════════════════════════════════════════════════════════════════════
-- Lot 2 — G8 : Injection temporaire routing.destination_city='VELINGARA'
-- Cible : case 29b96eec-2b85-489f-937e-0da8190c9787 (non-Aksa, sans client.code)
--
-- Objectif : forcer une destination uniquement présente dans les lignes
-- génériques to_confirm (Velingara) → doit produire TO_CONFIRM, aucun Aksa.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Snapshot baseline
SELECT 'BASELINE_G8' AS phase, value_text
FROM quote_facts
WHERE case_id = '29b96eec-2b85-489f-937e-0da8190c9787'
  AND fact_key = 'routing.destination_city'
  AND is_current = true;
-- Baseline attendue : 'Kolda'

-- 2) Injection
SELECT public.supersede_fact(
  p_case_id        => '29b96eec-2b85-489f-937e-0da8190c9787'::uuid,
  p_fact_key       => 'routing.destination_city',
  p_fact_category  => 'routing',
  p_value_text     => 'VELINGARA',
  p_source_type    => 'manual_input',
  p_source_excerpt => '[LOT2-G8 SMOKE TEST INJECTION - to be reverted]',
  p_confidence     => 1.0
) AS injected_fact_id;

-- 3) Vérification
SELECT 'POST_INJECTION_G8' AS phase, value_text, is_current
FROM quote_facts
WHERE case_id = '29b96eec-2b85-489f-937e-0da8190c9787'
  AND fact_key = 'routing.destination_city'
ORDER BY created_at DESC LIMIT 5;
