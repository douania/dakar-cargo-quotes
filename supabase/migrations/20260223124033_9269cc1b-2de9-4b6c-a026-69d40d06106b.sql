
-- Suppression des 3 dossiers orphelins "Client inconnu"
-- FK cascade gère quote_facts, quote_gaps, pricing_runs, case_timeline_events, decision_proposals, operator_decisions, quotation_versions
-- quote_service_pricing est NO ACTION mais les 3 dossiers n'ont 0 rows liées (vérifié)

DELETE FROM quote_cases
WHERE id IN (
  '0f23304a-e30e-4c2d-a3e2-b9f4e34ded4b',
  'e5dbb910-be76-4ef1-8c41-f4b07339edfe',
  '91921bb4-fd19-4df4-ae38-31d6a20f194b'
);
