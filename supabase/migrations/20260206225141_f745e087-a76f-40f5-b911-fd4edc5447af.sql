
-- =====================================================
-- M1.3.1: Create sodatra_fee_rules table
-- =====================================================
CREATE TABLE public.sodatra_fee_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fee_code text NOT NULL,
  transport_mode text NOT NULL DEFAULT 'ALL',
  calculation_method text NOT NULL,
  base_amount numeric NOT NULL DEFAULT 0,
  min_amount numeric,
  max_amount numeric,
  rate_percent numeric,
  value_factor numeric DEFAULT 1.0,
  complexity_factors jsonb DEFAULT '{}',
  currency text NOT NULL DEFAULT 'XOF',
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  expiry_date date,
  is_active boolean DEFAULT true,
  source_document text,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.sodatra_fee_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sodatra_fee_rules_public_read"
  ON public.sodatra_fee_rules FOR SELECT
  USING (true);

-- Seed data from existing hardcoded values in quotation-rules.ts
INSERT INTO public.sodatra_fee_rules (fee_code, transport_mode, calculation_method, base_amount, min_amount, max_amount, rate_percent, value_factor, complexity_factors, notes) VALUES
  ('DEDOUANEMENT', 'maritime', 'VALUE_BASED', 0, 75000, 500000, 0.004, 0.6, '{"imo": 0.3, "oog": 0.25, "transit": 0.2, "reefer": 0.15}', 'Base: 0.4% valeur CAF × 0.6 × complexité'),
  ('DEDOUANEMENT', 'aerien', 'VALUE_BASED', 0, 75000, 500000, 0.004, 0.6, '{"imo": 0.3, "oog": 0.25, "transit": 0.2, "reefer": 0.15}', 'Base: 0.4% valeur CAF × 0.6 × complexité'),
  ('DEDOUANEMENT', 'routier', 'VALUE_BASED', 0, 75000, 500000, 0.004, 0.6, '{"imo": 0.3, "oog": 0.25, "transit": 0.2, "reefer": 0.15}', 'Base: 0.4% valeur CAF × 0.6 × complexité'),
  ('OUVERTURE_DOSSIER', 'maritime', 'FIXED', 25000, NULL, NULL, NULL, NULL, '{}', 'Forfait fixe'),
  ('OUVERTURE_DOSSIER', 'aerien', 'FIXED', 20000, NULL, NULL, NULL, NULL, '{}', 'Forfait fixe'),
  ('OUVERTURE_DOSSIER', 'routier', 'FIXED', 15000, NULL, NULL, NULL, NULL, '{}', 'Forfait fixe'),
  ('DOCUMENTATION', 'ALL', 'FIXED', 15000, NULL, NULL, NULL, NULL, '{}', 'Forfait fixe par dossier'),
  ('SUIVI', 'ALL', 'PER_CONTAINER', 35000, 35000, NULL, NULL, NULL, '{}', '35000 FCFA par conteneur'),
  ('SUIVI_TONNE', 'ALL', 'PER_TONNE', 3000, 35000, NULL, NULL, NULL, '{}', '3000 FCFA par tonne (si pas de conteneurs)'),
  ('COMMISSION', 'ALL', 'PERCENT_DEBOURS', 0, 25000, NULL, 0.05, NULL, '{}', '5% des débours douaniers');

-- =====================================================
-- M1.3.2: Create delivery_zones table
-- =====================================================
CREATE TABLE public.delivery_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_code text NOT NULL UNIQUE,
  zone_name text NOT NULL,
  country text NOT NULL DEFAULT 'SN',
  multiplier numeric NOT NULL DEFAULT 1.0,
  distance_from_port_km integer NOT NULL DEFAULT 0,
  additional_days integer DEFAULT 0,
  requires_special_permit boolean DEFAULT false,
  example_cities text[] DEFAULT '{}',
  is_transit boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.delivery_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "delivery_zones_public_read"
  ON public.delivery_zones FOR SELECT
  USING (true);

-- Seed 12 zones from DELIVERY_ZONES hardcoded constant
INSERT INTO public.delivery_zones (zone_code, zone_name, country, multiplier, distance_from_port_km, additional_days, requires_special_permit, example_cities, is_transit) VALUES
  ('DAKAR', 'Dakar Centre', 'SN', 1.0, 0, 0, false, ARRAY['Plateau', 'Médina', 'Fann', 'Point E', 'Almadies'], false),
  ('DAKAR_BANLIEUE', 'Banlieue Dakar', 'SN', 1.15, 25, 0, false, ARRAY['Pikine', 'Guédiawaye', 'Rufisque', 'Thiaroye', 'Keur Massar'], false),
  ('THIES_REGION', 'Région Thiès', 'SN', 1.3, 70, 1, false, ARRAY['Thiès', 'Mbour', 'Tivaouane', 'Diamniadio'], false),
  ('DIOURBEL', 'Région Diourbel', 'SN', 1.5, 150, 1, false, ARRAY['Diourbel', 'Touba', 'Mbacké', 'Bambey'], false),
  ('KAOLACK', 'Région Kaolack', 'SN', 1.6, 200, 1, false, ARRAY['Kaolack', 'Fatick', 'Nioro du Rip', 'Kaffrine'], false),
  ('SAINT_LOUIS', 'Région Saint-Louis', 'SN', 1.8, 270, 2, false, ARRAY['Saint-Louis', 'Richard-Toll', 'Louga', 'Dagana'], false),
  ('ZIGUINCHOR', 'Casamance', 'SN', 2.0, 450, 3, true, ARRAY['Ziguinchor', 'Kolda', 'Sédhiou', 'Bignona'], false),
  ('TAMBACOUNDA', 'Région Est', 'SN', 2.2, 500, 3, true, ARRAY['Tambacounda', 'Kédougou', 'Bakel', 'Matam'], false),
  ('MALI', 'Mali Transit', 'ML', 3.0, 1200, 5, true, ARRAY['Bamako', 'Kayes', 'Sikasso', 'Mopti'], true),
  ('MAURITANIE', 'Mauritanie Transit', 'MR', 2.8, 800, 4, true, ARRAY['Nouakchott', 'Rosso', 'Atar'], true),
  ('GUINEE', 'Guinée Transit', 'GN', 2.5, 700, 4, true, ARRAY['Conakry', 'Labé', 'Kankan'], true),
  ('GAMBIE', 'Gambie Transit', 'GM', 1.8, 300, 2, true, ARRAY['Banjul', 'Serekunda'], true);
