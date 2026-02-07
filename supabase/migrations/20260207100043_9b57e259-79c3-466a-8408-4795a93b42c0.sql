
-- Phase M1.4.3: Create tariff_category_rules table
CREATE TABLE public.tariff_category_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_code varchar NOT NULL,
  category_name text NOT NULL,
  match_patterns text[] NOT NULL DEFAULT '{}',
  priority integer NOT NULL DEFAULT 10,
  carrier varchar DEFAULT 'ALL',
  is_active boolean DEFAULT true,
  source_document varchar NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- RLS: public read (same pattern as other reference tables)
ALTER TABLE public.tariff_category_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tariff_category_rules_public_read"
ON public.tariff_category_rules
FOR SELECT
USING (true);

-- Seed 7 bilingual rules (FR+EN)
INSERT INTO public.tariff_category_rules (category_code, category_name, match_patterns, priority, carrier, source_document, notes) VALUES
('T09', 'Véhicules, Machines, Équipements', ARRAY['vehicle','truck','tractor','machine','generator','transformer','power plant','vehicule','camion','tracteur','generateur','transformateur','centrale'], 10, 'ALL', 'Hapag-Lloyd tariff classification rules -- TO_VERIFY', 'Catégorie prioritaire: équipements lourds et véhicules'),
('T01', 'Boissons, Chimie, Accessoires', ARRAY['drink','beverage','chemical','pump','valve','accessory','boisson','chimique','pompe','vanne','accessoire'], 20, 'ALL', 'Hapag-Lloyd tariff classification rules -- TO_VERIFY', 'Produits chimiques, boissons et accessoires industriels'),
('T05', 'Céréales, Ciment, Engrais', ARRAY['cereal','wheat','rice','cement','fertilizer','cereale','ble','riz','ciment','engrais','farine','flour'], 30, 'ALL', 'Hapag-Lloyd tariff classification rules -- TO_VERIFY', 'Produits agricoles et matériaux de construction en vrac'),
('T14', 'Produits métallurgiques', ARRAY['steel','iron','metal','pipe','tube','beam','rebar','acier','fer','tuyau','poutre','metallurg','armature'], 40, 'ALL', 'Hapag-Lloyd tariff classification rules -- TO_VERIFY', 'Produits sidérurgiques et métallurgiques'),
('T07', 'Textiles, Matériaux construction', ARRAY['textile','fabric','building material','cotton','tile','tissu','coton','brique','carrelage','materiau'], 50, 'ALL', 'Hapag-Lloyd tariff classification rules -- TO_VERIFY', 'Textiles et matériaux de construction finis'),
('T12', 'Produits divers', ARRAY['mixed','general','various','divers','melange','assorted'], 60, 'ALL', 'Hapag-Lloyd tariff classification rules -- TO_VERIFY', 'Catégorie fourre-tout pour marchandises non classifiées'),
('T02', 'Catégorie générale (défaut)', ARRAY[]::text[], 999, 'ALL', 'Hapag-Lloyd tariff classification rules -- TO_VERIFY', 'Appliquée si aucune autre catégorie ne correspond');
