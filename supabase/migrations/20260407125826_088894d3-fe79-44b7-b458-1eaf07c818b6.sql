-- P7: Insert service_quantity_rules for 6 export service codes
INSERT INTO service_quantity_rules (service_key, quantity_basis, default_unit, requires_fact_key)
VALUES
  ('THC_EXPORT', 'EVP', 'EVP', 'cargo.containers'),
  ('DOCUMENTATION_BL', 'FLAT', 'BL', NULL),
  ('VGM_WEIGHING', 'EVP', 'EVP', 'cargo.containers'),
  ('STUFFING_FACTORY', 'EVP', 'EVP', 'cargo.containers'),
  ('STUFFING_CFS', 'EVP', 'EVP', 'cargo.containers'),
  ('EMPTY_REPO', 'EVP', 'EVP', 'cargo.containers')
ON CONFLICT (service_key) DO NOTHING;

-- P7: Insert pricing_service_catalogue placeholders (FIXED at 0, tarif à confirmer)
INSERT INTO pricing_service_catalogue (service_code, service_name, unit_type, pricing_mode, base_price, min_price, currency, mode_scope, description)
VALUES
  ('THC_EXPORT', 'THC export (Terminal Handling)', 'EVP', 'FIXED', 0, 0, 'XOF', NULL, 'Tarif à confirmer'),
  ('DOCUMENTATION_BL', 'Documentation / B/L fees', 'BL', 'FIXED', 0, 0, 'XOF', NULL, 'Tarif à confirmer'),
  ('VGM_WEIGHING', 'VGM / Pesée conteneur', 'EVP', 'FIXED', 0, 0, 'XOF', NULL, 'Tarif à confirmer'),
  ('STUFFING_FACTORY', 'Empotage usine', 'EVP', 'FIXED', 0, 0, 'XOF', NULL, 'Tarif à confirmer'),
  ('STUFFING_CFS', 'Empotage CFS / port', 'EVP', 'FIXED', 0, 0, 'XOF', NULL, 'Tarif à confirmer'),
  ('EMPTY_REPO', 'Repositionnement conteneur vide', 'EVP', 'FIXED', 0, 0, 'XOF', NULL, 'Tarif à confirmer')
ON CONFLICT (service_code) DO NOTHING;