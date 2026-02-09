
-- Phase PRICING V3.1: WEIGHT tiers for customs pricing

-- CTO Correction 1: Weight range constraint (handles NULLs correctly)
ALTER TABLE pricing_customs_tiers
ADD CONSTRAINT pricing_customs_tiers_weight_range_chk
CHECK (
  (min_weight_kg IS NULL AND max_weight_kg IS NULL)
  OR
  (min_weight_kg IS NOT NULL AND (max_weight_kg IS NULL OR min_weight_kg < max_weight_kg))
);

-- CTO Recommendation R1: WEIGHT tiers must have price NOT NULL
ALTER TABLE pricing_customs_tiers
ADD CONSTRAINT pricing_customs_tiers_weight_price_chk
CHECK (
  basis <> 'WEIGHT'
  OR price IS NOT NULL
);

-- Seed 3 AIR WEIGHT tiers
INSERT INTO pricing_customs_tiers
  (mode, basis, min_weight_kg, max_weight_kg, price, percent, min_price, max_price, currency, active)
VALUES
  ('AIR', 'WEIGHT', 0, 1000, 150000, NULL, 150000, NULL, 'XOF', true),
  ('AIR', 'WEIGHT', 1000, 5000, 300000, NULL, 300000, NULL, 'XOF', true),
  ('AIR', 'WEIGHT', 5000, NULL, 500000, NULL, 500000, NULL, 'XOF', true);

-- Seed 3 SEA WEIGHT tiers
INSERT INTO pricing_customs_tiers
  (mode, basis, min_weight_kg, max_weight_kg, price, percent, min_price, max_price, currency, active)
VALUES
  ('SEA', 'WEIGHT', 0, 5000, 200000, NULL, 200000, NULL, 'XOF', true),
  ('SEA', 'WEIGHT', 5000, 20000, 350000, NULL, 350000, NULL, 'XOF', true),
  ('SEA', 'WEIGHT', 20000, NULL, 500000, NULL, 500000, NULL, 'XOF', true);
