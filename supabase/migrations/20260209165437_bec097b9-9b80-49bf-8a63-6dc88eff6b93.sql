
-- Phase PRICING V1: 3 tables + CHECK constraints + seed data

-- Table A: pricing_service_catalogue
CREATE TABLE public.pricing_service_catalogue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_code text UNIQUE NOT NULL,
  service_name text NOT NULL,
  unit_type text NOT NULL,
  pricing_mode text NOT NULL DEFAULT 'FIXED',
  base_price numeric NOT NULL DEFAULT 0,
  min_price numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'XOF',
  active boolean NOT NULL DEFAULT true,
  mode_scope text NULL,
  description text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pricing_service_catalogue_mode_chk CHECK (pricing_mode IN ('FIXED', 'UNIT_RATE', 'PERCENTAGE'))
);

ALTER TABLE public.pricing_service_catalogue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_catalogue_read" ON public.pricing_service_catalogue
  FOR SELECT TO authenticated USING (true);

-- Table B: pricing_customs_tiers (Phase V2, structure only)
CREATE TABLE public.pricing_customs_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL,
  basis text NOT NULL,
  min_value numeric NULL,
  max_value numeric NULL,
  min_weight_kg numeric NULL,
  max_weight_kg numeric NULL,
  price numeric NULL,
  percent numeric NULL,
  min_price numeric NULL,
  max_price numeric NULL,
  currency text NOT NULL DEFAULT 'XOF',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pricing_customs_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customs_tiers_read" ON public.pricing_customs_tiers
  FOR SELECT TO authenticated USING (true);

-- Table C: pricing_modifiers
CREATE TABLE public.pricing_modifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modifier_code text UNIQUE NOT NULL,
  label text NOT NULL,
  type text NOT NULL,
  value numeric NOT NULL,
  applies_to text[] NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pricing_modifiers_type_chk CHECK (type IN ('FIXED', 'PERCENT'))
);

ALTER TABLE public.pricing_modifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "modifiers_read" ON public.pricing_modifiers
  FOR SELECT TO authenticated USING (true);

-- Seed: pricing_service_catalogue (NO AIR_* with base_price=0)
INSERT INTO public.pricing_service_catalogue (service_code, service_name, unit_type, pricing_mode, base_price, min_price, currency, description) VALUES
  ('CUSTOMS_DAKAR', 'Déclaration import Dakar', 'per_file', 'FIXED', 350000, 250000, 'XOF', 'Frais de déclaration en douane import au port de Dakar'),
  ('CUSTOMS_EXPORT', 'Déclaration export', 'per_file', 'FIXED', 300000, 200000, 'XOF', 'Frais de déclaration en douane export'),
  ('AGENCY', 'Frais agence import', 'per_file', 'FIXED', 200000, 150000, 'XOF', 'Honoraires transitaire import standard'),
  ('AGENCY_TRANSIT', 'Frais agence transit', 'per_file', 'FIXED', 250000, 200000, 'XOF', 'Honoraires transitaire pour dossier transit'),
  ('SURVEY', 'Expertise', 'per_file', 'FIXED', 500000, 300000, 'XOF', 'Frais expertise / survey');

-- Seed: pricing_modifiers
INSERT INTO public.pricing_modifiers (modifier_code, label, type, value, applies_to) VALUES
  ('URGENT', 'Majoration urgence', 'PERCENT', 25, NULL),
  ('REGULARISATION', 'Régularisation après livraison', 'FIXED', 150000, NULL),
  ('CLIENT_PREMIUM', 'Client premium', 'PERCENT', -10, NULL);
