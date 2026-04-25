-- ═══════════════════════════════════════════════════════════════════════════
-- Lot 2 — Harness lecture des preuves smoke G6/G7/G8/G9
-- À exécuter APRÈS que les 4 runs aient été déclenchés.
-- ═══════════════════════════════════════════════════════════════════════════

\echo ''
\echo '════════════ G6 : 03ccf66d (Kolda) — attendu : ligne TRUCKING servie depuis Aksa ════════════'
WITH latest AS (
  SELECT id, created_at, run_number, tariff_lines
  FROM pricing_runs
  WHERE case_id = '03ccf66d-df20-47a1-875d-93133ee79020'
  ORDER BY created_at DESC LIMIT 1
)
SELECT
  l.run_number,
  l.created_at,
  ln->>'description'  AS description,
  ln->>'amount'       AS amount,
  ln->'source'->>'type'      AS source_type,
  ln->'source'->>'reference' AS source_ref,
  ln->'canonical'->>'service_key' AS service_key,
  ln->>'category'     AS category
FROM latest l, jsonb_array_elements(l.tariff_lines) ln
WHERE (ln->'canonical'->>'service_key') ~* 'TRUCK|ON_CARRIAGE|TRANSPORT|LOCAL'
   OR (ln->>'description')              ~* 'truck|transport|livraison|carriage|kolda'
   OR (ln->>'category')                 ~* 'transport|truck|carriage';

\echo ''
\echo '════════════ G7 : 29b96eec (Kolda, no client.code) — attendu : TO_CONFIRM, aucun Aksa ════════════'
WITH latest AS (
  SELECT id, created_at, run_number, tariff_lines
  FROM pricing_runs
  WHERE case_id = '29b96eec-2b85-489f-937e-0da8190c9787'
  ORDER BY created_at DESC LIMIT 1
)
SELECT
  l.run_number,
  l.created_at,
  ln->>'description'  AS description,
  ln->>'amount'       AS amount,
  ln->'source'->>'type'      AS source_type,
  ln->'source'->>'reference' AS source_ref,
  ln->'canonical'->>'service_key' AS service_key
FROM latest l, jsonb_array_elements(l.tariff_lines) ln
WHERE (ln->'canonical'->>'service_key') ~* 'TRUCK|ON_CARRIAGE|TRANSPORT|LOCAL'
   OR (ln->>'description')              ~* 'truck|transport|livraison|carriage|kolda'
   OR (ln->'source'->>'type')           = 'TO_CONFIRM';

\echo ''
\echo '════════════ G8 : 29b96eec (forcé Velingara) — attendu : TO_CONFIRM strict ════════════'
\echo '(Identique requête G7 — exécuter après injection Velingara)'

\echo ''
\echo '════════════ G9 : 01c3fbbc (AIR_IMPORT_DAP, Frankfurt) — attendu : pas de transport local ════════════'
WITH latest AS (
  SELECT id, created_at, run_number, tariff_lines, total_ht
  FROM pricing_runs
  WHERE case_id = '01c3fbbc-9176-4e9a-b376-9def3bcf0091'
  ORDER BY created_at DESC LIMIT 1
)
SELECT
  l.run_number,
  l.created_at,
  l.total_ht,
  COUNT(*) FILTER (WHERE (ln->'canonical'->>'service_key') ~* 'TRUCK|ON_CARRIAGE') AS local_transport_lines_count,
  COUNT(*) AS total_lines_count
FROM latest l, jsonb_array_elements(l.tariff_lines) ln
GROUP BY l.run_number, l.created_at, l.total_ht;

\echo ''
\echo '════════════ Anti-fuite Aksa : aucune ligne servie depuis Aksa pour les non-Aksa ════════════'
WITH suspect AS (
  SELECT pr.case_id, pr.run_number, pr.created_at, ln
  FROM pricing_runs pr,
       jsonb_array_elements(pr.tariff_lines) ln
  WHERE pr.case_id IN (
    '29b96eec-2b85-489f-937e-0da8190c9787',
    '01c3fbbc-9176-4e9a-b376-9def3bcf0091'
  )
  AND pr.created_at > '2026-04-25 11:00:00'
)
SELECT case_id, run_number, ln->>'description' AS desc, ln->'source'->>'reference' AS ref
FROM suspect
WHERE (ln->'source'->>'reference') ~* 'aksa'
   OR (ln->>'description')         ~* 'aksa';
-- ATTENDU : 0 ligne
