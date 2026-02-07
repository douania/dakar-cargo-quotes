-- Phase A1: Add AIR_HANDLING and AIR_FREIGHT quantity rules with KG basis
INSERT INTO service_quantity_rules (service_key, quantity_basis, default_unit, requires_fact_key, notes)
VALUES
  ('AIR_HANDLING', 'KG', 'kg', 'cargo.chargeable_weight_kg', 
   'Tarif au kg chargeable = max(poids brut, vol*167). IATA volumetric factor.'),
  ('AIR_FREIGHT', 'KG', 'kg', 'cargo.chargeable_weight_kg', 
   'Fret aerien au kg chargeable.')
ON CONFLICT (service_key) DO UPDATE SET
  quantity_basis = EXCLUDED.quantity_basis,
  default_unit = EXCLUDED.default_unit,
  requires_fact_key = EXCLUDED.requires_fact_key,
  notes = EXCLUDED.notes;