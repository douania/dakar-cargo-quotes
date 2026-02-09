
-- Phase PRICING V2: Constraints, index, and seed for pricing_customs_tiers
-- Convention: percent = taux réel (0.5 = 0,5%), formule: caf * percent / 100
-- Convention: min_value inclusif, max_value EXCLUSIF

-- 1. CHECK constraints
ALTER TABLE pricing_customs_tiers
ADD CONSTRAINT pricing_customs_tiers_mode_chk
CHECK (mode IN ('AIR','SEA','ROAD'));

ALTER TABLE pricing_customs_tiers
ADD CONSTRAINT pricing_customs_tiers_basis_chk
CHECK (basis IN ('CAF','WEIGHT'));

-- CTO correction 1: percent safety (0-20% max)
ALTER TABLE pricing_customs_tiers
ADD CONSTRAINT pricing_customs_tiers_percent_chk
CHECK (percent IS NULL OR (percent >= 0 AND percent <= 20));

-- CTO correction 2: range integrity (min < max when max is not null)
ALTER TABLE pricing_customs_tiers
ADD CONSTRAINT pricing_customs_tiers_range_chk
CHECK (max_value IS NULL OR min_value < max_value);

-- 2. Performance index for tier lookup
CREATE INDEX idx_customs_tiers_lookup
ON pricing_customs_tiers(mode, basis, min_value, max_value)
WHERE active = true;

-- 3. Seed initial CAF-based tiers
-- AIR – CAF based (max_value is EXCLUSIVE)
INSERT INTO pricing_customs_tiers
(mode, basis, min_value, max_value, price, percent, min_price, max_price, currency, active)
VALUES
('AIR','CAF',0,5000000,NULL,0.8,150000,400000,'XOF',true),
('AIR','CAF',5000000,20000000,NULL,0.6,200000,600000,'XOF',true),
('AIR','CAF',20000000,NULL,NULL,0.5,300000,NULL,'XOF',true),
-- SEA – CAF based (max_value is EXCLUSIVE)
('SEA','CAF',0,10000000,NULL,0.5,250000,800000,'XOF',true),
('SEA','CAF',10000000,50000000,NULL,0.4,300000,1200000,'XOF',true),
('SEA','CAF',50000000,NULL,NULL,0.3,400000,NULL,'XOF',true);
