-- ═══════════════════════════════════════════════════════════════════════════
-- Lot 2 — G6 : Injection temporaire client.code='AKSA_ENERGY'
-- Cible : case 03ccf66d-df20-47a1-875d-93133ee79020 (Kolda, DAP_PROJECT_IMPORT)
-- ═══════════════════════════════════════════════════════════════════════════
-- AVANT : il n'existe AUCUN fact client.code (vérifié 2026-04-25).
-- APRES restauration : aucun fact client.code ne doit subsister sur ce case.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Snapshot baseline (pour preuve)
SELECT 'BASELINE' AS phase, case_id, fact_key, value_text, is_current
FROM quote_facts
WHERE case_id = '03ccf66d-df20-47a1-875d-93133ee79020'
  AND fact_key = 'client.code';

-- 2) Injection via supersede_fact (utilise la fonction officielle, marquée test)
SELECT public.supersede_fact(
  p_case_id          => '03ccf66d-df20-47a1-875d-93133ee79020'::uuid,
  p_fact_key         => 'client.code',
  p_fact_category    => 'client',
  p_value_text       => 'AKSA_ENERGY',
  p_source_type      => 'manual_input',
  p_source_excerpt   => '[LOT2-G6 SMOKE TEST INJECTION - to be reverted]',
  p_confidence       => 1.0
) AS injected_fact_id;

-- 3) Vérification post-injection
SELECT 'POST_INJECTION' AS phase, case_id, fact_key, value_text, is_current, source_excerpt
FROM quote_facts
WHERE case_id = '03ccf66d-df20-47a1-875d-93133ee79020'
  AND fact_key = 'client.code'
ORDER BY created_at DESC;
