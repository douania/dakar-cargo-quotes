-- Table des Incoterms ICC 2020
CREATE TABLE IF NOT EXISTS public.incoterms_reference (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code VARCHAR(3) NOT NULL UNIQUE,
  name_en VARCHAR(100) NOT NULL,
  name_fr VARCHAR(100) NOT NULL,
  group_name VARCHAR(20) NOT NULL CHECK (group_name IN ('E', 'F', 'C', 'D')),
  transfer_risk_point VARCHAR(200) NOT NULL,
  transport_modes VARCHAR(50) NOT NULL CHECK (transport_modes IN ('any', 'sea_inland_waterway')),
  seller_pays_transport BOOLEAN NOT NULL DEFAULT false,
  seller_pays_insurance BOOLEAN NOT NULL DEFAULT false,
  seller_pays_export_customs BOOLEAN NOT NULL DEFAULT true,
  buyer_pays_import_customs BOOLEAN NOT NULL DEFAULT true,
  seller_pays_loading BOOLEAN NOT NULL DEFAULT false,
  seller_pays_unloading BOOLEAN NOT NULL DEFAULT false,
  caf_calculation_method VARCHAR(100),
  notes_fr TEXT,
  notes_en TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.incoterms_reference ENABLE ROW LEVEL SECURITY;

-- Public read policy
CREATE POLICY "incoterms_reference_public_read" ON public.incoterms_reference
  FOR SELECT USING (true);

-- Insert 11 Incoterms ICC 2020
INSERT INTO public.incoterms_reference (code, name_en, name_fr, group_name, transfer_risk_point, transport_modes, seller_pays_transport, seller_pays_insurance, seller_pays_export_customs, buyer_pays_import_customs, seller_pays_loading, seller_pays_unloading, caf_calculation_method, notes_fr, notes_en)
VALUES
  ('EXW', 'Ex Works', 'À l''usine', 'E', 'À l''usine du vendeur', 'any', false, false, false, true, false, false, 'FOB + Fret + Assurance', 'Le vendeur met la marchandise à disposition. Tous les risques et frais sont à la charge de l''acheteur.', 'Seller makes goods available. All risks and costs are on buyer.'),
  ('FCA', 'Free Carrier', 'Franco transporteur', 'F', 'À la remise au transporteur désigné', 'any', false, false, true, true, true, false, 'Valeur déclarée + Fret + Assurance', 'Vendeur livre au transporteur désigné par l''acheteur. Risque transféré à la remise.', 'Seller delivers to carrier named by buyer. Risk transfers on delivery.'),
  ('FAS', 'Free Alongside Ship', 'Franco le long du navire', 'F', 'Le long du navire au port d''embarquement', 'sea_inland_waterway', false, false, true, true, false, false, 'Valeur + Fret + Assurance', 'Maritime uniquement. Risque transféré quand la marchandise est placée le long du navire.', 'Sea only. Risk transfers when goods placed alongside ship.'),
  ('FOB', 'Free On Board', 'Franco à bord', 'F', 'À bord du navire au port d''embarquement', 'sea_inland_waterway', false, false, true, true, true, false, 'FOB + Fret + Assurance', 'Maritime uniquement. Risque transféré quand la marchandise passe le bastingage.', 'Sea only. Risk transfers when goods pass ship rail.'),
  ('CFR', 'Cost and Freight', 'Coût et fret', 'C', 'À bord du navire au port d''embarquement', 'sea_inland_waterway', true, false, true, true, true, false, 'CFR + Assurance (C&F)', 'Vendeur paie le fret. Risque transféré à l''embarquement. Assurance à charge acheteur.', 'Seller pays freight. Risk transfers at loading. Insurance on buyer.'),
  ('CIF', 'Cost Insurance and Freight', 'Coût assurance et fret', 'C', 'À bord du navire au port d''embarquement', 'sea_inland_waterway', true, true, true, true, true, false, 'Valeur CIF déclarée', 'Vendeur paie fret + assurance (clause C minimum). Risque transféré à l''embarquement.', 'Seller pays freight + insurance (clause C min). Risk transfers at loading.'),
  ('CPT', 'Carriage Paid To', 'Port payé jusqu''à', 'C', 'À la remise au premier transporteur', 'any', true, false, true, true, true, false, 'CPT + Assurance', 'Vendeur paie le transport jusqu''à destination. Risque transféré au premier transporteur.', 'Seller pays carriage to destination. Risk transfers to first carrier.'),
  ('CIP', 'Carriage and Insurance Paid To', 'Port payé assurance comprise jusqu''à', 'C', 'À la remise au premier transporteur', 'any', true, true, true, true, true, false, 'Valeur CIP déclarée', 'Vendeur paie transport + assurance tous risques. Risque transféré au premier transporteur.', 'Seller pays carriage + all risks insurance. Risk transfers to first carrier.'),
  ('DAP', 'Delivered at Place', 'Rendu au lieu de destination', 'D', 'Au lieu de destination convenu (non déchargé)', 'any', true, false, true, true, true, false, 'Valeur déclarée (vendeur assume transport)', 'Vendeur livre au lieu convenu, prêt à être déchargé. Dédouanement import à charge acheteur.', 'Seller delivers at place, ready for unloading. Import clearance on buyer.'),
  ('DPU', 'Delivered at Place Unloaded', 'Rendu au lieu de destination déchargé', 'D', 'Au lieu de destination convenu (déchargé)', 'any', true, false, true, true, true, true, 'Valeur déclarée (vendeur assume transport + déchargement)', 'Vendeur livre déchargé au lieu convenu. Seul Incoterm avec déchargement vendeur.', 'Seller delivers unloaded at place. Only Incoterm with seller unloading.'),
  ('DDP', 'Delivered Duty Paid', 'Rendu droits acquittés', 'D', 'Au lieu de destination convenu (dédouané import)', 'any', true, false, true, false, true, true, 'Valeur DDP déclarée (tous frais inclus)', 'Vendeur assume tous les frais et risques, y compris dédouanement import. Maximum obligation vendeur.', 'Seller bears all costs and risks including import clearance. Maximum seller obligation.')
ON CONFLICT (code) DO NOTHING;

-- Table des spécifications conteneurs ISO
CREATE TABLE IF NOT EXISTS public.container_specifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type_code VARCHAR(10) NOT NULL UNIQUE,
  type_name_en VARCHAR(50) NOT NULL,
  type_name_fr VARCHAR(50) NOT NULL,
  length_ft INTEGER NOT NULL,
  external_length_m DECIMAL(5,2) NOT NULL,
  external_width_m DECIMAL(5,2) NOT NULL,
  external_height_m DECIMAL(5,2) NOT NULL,
  internal_length_m DECIMAL(5,2) NOT NULL,
  internal_width_m DECIMAL(5,2) NOT NULL,
  internal_height_m DECIMAL(5,2) NOT NULL,
  door_width_m DECIMAL(5,2) NOT NULL,
  door_height_m DECIMAL(5,2) NOT NULL,
  max_payload_kg INTEGER NOT NULL,
  tare_weight_kg INTEGER NOT NULL,
  max_gross_weight_kg INTEGER NOT NULL,
  internal_volume_cbm DECIMAL(6,2) NOT NULL,
  is_refrigerated BOOLEAN DEFAULT false,
  is_high_cube BOOLEAN DEFAULT false,
  is_open_top BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.container_specifications ENABLE ROW LEVEL SECURITY;

-- Public read policy
CREATE POLICY "container_specifications_public_read" ON public.container_specifications
  FOR SELECT USING (true);

-- Insert standard container specs
INSERT INTO public.container_specifications (type_code, type_name_en, type_name_fr, length_ft, external_length_m, external_width_m, external_height_m, internal_length_m, internal_width_m, internal_height_m, door_width_m, door_height_m, max_payload_kg, tare_weight_kg, max_gross_weight_kg, internal_volume_cbm, is_refrigerated, is_high_cube, is_open_top)
VALUES
  ('20DV', '20ft Dry Van', 'Conteneur 20 pieds sec', 20, 6.06, 2.44, 2.59, 5.90, 2.35, 2.39, 2.34, 2.28, 28180, 2230, 30410, 33.1, false, false, false),
  ('40DV', '40ft Dry Van', 'Conteneur 40 pieds sec', 40, 12.19, 2.44, 2.59, 12.03, 2.35, 2.39, 2.34, 2.28, 26680, 3750, 30430, 67.6, false, false, false),
  ('40HC', '40ft High Cube', 'Conteneur 40 pieds High Cube', 40, 12.19, 2.44, 2.90, 12.03, 2.35, 2.69, 2.34, 2.58, 26460, 3970, 30430, 76.2, false, true, false),
  ('45HC', '45ft High Cube', 'Conteneur 45 pieds High Cube', 45, 13.72, 2.44, 2.90, 13.56, 2.35, 2.69, 2.34, 2.58, 25600, 4800, 30400, 85.7, false, true, false),
  ('20RF', '20ft Reefer', 'Conteneur 20 pieds frigorifique', 20, 6.06, 2.44, 2.59, 5.45, 2.29, 2.27, 2.29, 2.26, 27400, 3010, 30410, 28.3, true, false, false),
  ('40RF', '40ft Reefer', 'Conteneur 40 pieds frigorifique', 40, 12.19, 2.44, 2.59, 11.56, 2.29, 2.25, 2.29, 2.24, 26780, 3650, 30430, 59.6, true, false, false),
  ('40RH', '40ft Reefer High Cube', 'Conteneur 40 pieds frigo High Cube', 40, 12.19, 2.44, 2.90, 11.56, 2.29, 2.55, 2.29, 2.54, 26280, 4150, 30430, 67.5, true, true, false),
  ('20OT', '20ft Open Top', 'Conteneur 20 pieds toit ouvert', 20, 6.06, 2.44, 2.59, 5.90, 2.35, 2.35, 2.34, 2.23, 28120, 2290, 30410, 32.6, false, false, true),
  ('40OT', '40ft Open Top', 'Conteneur 40 pieds toit ouvert', 40, 12.19, 2.44, 2.59, 12.03, 2.35, 2.35, 2.34, 2.23, 26630, 3800, 30430, 66.4, false, false, true),
  ('20FR', '20ft Flat Rack', 'Conteneur 20 pieds flat rack', 20, 6.06, 2.44, 2.59, 5.94, 2.35, 2.35, 2.35, 2.35, 27700, 2710, 30410, 32.8, false, false, false),
  ('40FR', '40ft Flat Rack', 'Conteneur 40 pieds flat rack', 40, 12.19, 2.44, 2.59, 12.13, 2.40, 2.14, 2.40, 2.14, 39200, 5700, 44900, 62.2, false, false, false)
ON CONFLICT (type_code) DO NOTHING;