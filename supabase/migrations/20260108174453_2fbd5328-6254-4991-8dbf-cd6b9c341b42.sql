-- =============================================
-- TABLES DE RÉFÉRENCE ÉQUIPEMENTS TRANSPORT AFRIQUE OUEST
-- Source: Documents MANUS AI
-- =============================================

-- 1. Réglementation transport UEMOA/CEDEAO/Sénégal
CREATE TABLE public.transport_regulations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  regulation_id TEXT NOT NULL UNIQUE,
  zone TEXT NOT NULL DEFAULT 'UEMOA',
  category TEXT NOT NULL,
  parameter TEXT NOT NULL,
  vehicle_type TEXT,
  min_value DECIMAL,
  max_value DECIMAL NOT NULL,
  unit TEXT NOT NULL,
  oog_trigger DECIMAL,
  action_if_exceeded TEXT,
  source_reference TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.transport_regulations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "transport_regulations_public_read" ON public.transport_regulations FOR SELECT USING (true);

-- 2. Types de véhicules (tracteurs et porteurs)
CREATE TABLE public.vehicle_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  config TEXT NOT NULL,
  axle_count INTEGER NOT NULL,
  wheel_count INTEGER,
  driven_wheels INTEGER,
  ptac_min_t DECIMAL,
  ptac_max_t DECIMAL,
  ptra_min_t DECIMAL,
  ptra_max_t DECIMAL,
  power_hp_min INTEGER,
  power_hp_max INTEGER,
  saddle_load_t DECIMAL,
  payload_t DECIMAL,
  usage_primary TEXT,
  terrain_type TEXT,
  is_available_senegal BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.vehicle_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vehicle_types_public_read" ON public.vehicle_types FOR SELECT USING (true);

-- 3. Types de remorques et semi-remorques
CREATE TABLE public.trailer_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trailer_id TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  type_name TEXT NOT NULL,
  subtype TEXT,
  axle_count_min INTEGER,
  axle_count_max INTEGER,
  length_m DECIMAL,
  length_extended_m DECIMAL,
  width_m DECIMAL,
  deck_height_m DECIMAL,
  internal_height_m DECIMAL,
  payload_min_t DECIMAL,
  payload_max_t DECIMAL,
  volume_m3 DECIMAL,
  container_compatible TEXT[],
  gooseneck_type TEXT,
  requires_escort_if_width_gt_m DECIMAL,
  requires_permit_if_weight_gt_t DECIMAL,
  usage_description TEXT,
  is_available_senegal BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.trailer_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trailer_types_public_read" ON public.trailer_types FOR SELECT USING (true);

-- 4. Équipements de levage
CREATE TABLE public.lifting_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  capacity_t DECIMAL NOT NULL,
  capacity_at_radius_t JSONB,
  boom_length_m DECIMAL,
  max_height_m DECIMAL,
  axle_count INTEGER,
  min_radius_m DECIMAL,
  stacking_height INTEGER,
  reach_rows INTEGER,
  origin_country TEXT,
  price_category TEXT,
  is_available_west_africa BOOLEAN DEFAULT true,
  is_available_port_dakar BOOLEAN,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.lifting_equipment ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lifting_equipment_public_read" ON public.lifting_equipment FOR SELECT USING (true);

-- 5. Coûts opérationnels Sénégal
CREATE TABLE public.operational_costs_senegal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_id TEXT NOT NULL UNIQUE,
  cost_type TEXT NOT NULL,
  name_fr TEXT NOT NULL,
  amount DECIMAL,
  unit TEXT NOT NULL,
  calculation_base TEXT,
  condition_text TEXT,
  min_amount DECIMAL,
  max_amount DECIMAL,
  source TEXT,
  is_active BOOLEAN DEFAULT true,
  effective_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.operational_costs_senegal ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operational_costs_senegal_public_read" ON public.operational_costs_senegal FOR SELECT USING (true);

-- 6. Marques de véhicules
CREATE TABLE public.vehicle_brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_name TEXT NOT NULL UNIQUE,
  origin_country TEXT,
  price_category TEXT,
  sav_availability TEXT,
  parts_availability TEXT,
  popular_models TEXT[],
  countries_present TEXT[],
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.vehicle_brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vehicle_brands_public_read" ON public.vehicle_brands FOR SELECT USING (true);

-- 7. Catégories de transport exceptionnel
CREATE TABLE public.exceptional_transport_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id TEXT NOT NULL UNIQUE,
  category_name TEXT NOT NULL,
  length_min_m DECIMAL,
  length_max_m DECIMAL,
  width_min_m DECIMAL,
  width_max_m DECIMAL,
  weight_min_t DECIMAL,
  weight_max_t DECIMAL,
  escort_type TEXT NOT NULL,
  authorization_required BOOLEAN DEFAULT true,
  estimated_escort_cost_fcfa INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.exceptional_transport_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exceptional_transport_categories_public_read" ON public.exceptional_transport_categories FOR SELECT USING (true);