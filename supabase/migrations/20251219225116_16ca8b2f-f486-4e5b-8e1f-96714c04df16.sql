-- Corriger la table imo_classes avec une clé composite
DROP TABLE IF EXISTS public.imo_classes;

CREATE TABLE public.imo_classes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  class_code varchar(5) NOT NULL,
  division varchar(5),
  name_fr varchar(100) NOT NULL,
  name_en varchar(100) NOT NULL,
  description text,
  -- Surcharges et contraintes
  port_surcharge_percent numeric(5,2) NOT NULL DEFAULT 0,
  storage_surcharge_percent numeric(5,2) NOT NULL DEFAULT 0,
  requires_segregation boolean NOT NULL DEFAULT false,
  requires_special_storage boolean NOT NULL DEFAULT false,
  max_stacking_height integer,
  -- Documentation
  requires_msds boolean NOT NULL DEFAULT true,
  requires_imo_declaration boolean NOT NULL DEFAULT true,
  placard_required boolean NOT NULL DEFAULT true,
  examples text[],
  handling_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(class_code, division)
);

INSERT INTO public.imo_classes (class_code, division, name_fr, name_en, port_surcharge_percent, storage_surcharge_percent, requires_segregation, requires_special_storage, examples, handling_notes) VALUES
('1', '1.1', 'Matières et objets explosibles', 'Explosives', 100, 150, true, true, ARRAY['Dynamite', 'Détonateurs', 'Feux d''artifice'], 'Stockage séparé obligatoire - Zone dédiée DPW'),
('1', '1.4', 'Explosibles faible risque', 'Explosives minor risk', 50, 75, true, false, ARRAY['Munitions sportives', 'Cartouches'], 'Ventilation requise'),
('2', '2.1', 'Gaz inflammables', 'Flammable gases', 75, 100, true, true, ARRAY['Propane', 'Butane', 'Aérosols'], 'Éloigner des sources de chaleur'),
('2', '2.2', 'Gaz non inflammables', 'Non-flammable gases', 25, 30, false, false, ARRAY['Azote', 'CO2', 'Argon'], 'Ventilation requise'),
('2', '2.3', 'Gaz toxiques', 'Toxic gases', 100, 150, true, true, ARRAY['Chlore', 'Ammoniac'], 'EPI obligatoire - Zone isolée'),
('3', NULL, 'Liquides inflammables', 'Flammable liquids', 50, 75, true, false, ARRAY['Essence', 'Peintures', 'Solvants', 'Alcools'], 'Bac de rétention obligatoire'),
('4', '4.1', 'Matières solides inflammables', 'Flammable solids', 50, 60, true, false, ARRAY['Allumettes', 'Soufre', 'Celluloid'], 'Éviter friction et chocs'),
('4', '4.2', 'Matières auto-inflammables', 'Spontaneously combustible', 75, 100, true, true, ARRAY['Charbon actif', 'Phosphore'], 'Surveillance température'),
('4', '4.3', 'Matières hydroréactives', 'Dangerous when wet', 100, 150, true, true, ARRAY['Sodium', 'Carbure de calcium'], 'Stockage au sec impératif'),
('5', '5.1', 'Matières comburantes', 'Oxidizing substances', 50, 75, true, false, ARRAY['Nitrate d''ammonium', 'Peroxyde'], 'Séparer des matières combustibles'),
('5', '5.2', 'Peroxydes organiques', 'Organic peroxides', 100, 150, true, true, ARRAY['Peroxydes de kétone'], 'Température contrôlée obligatoire'),
('6', '6.1', 'Matières toxiques', 'Toxic substances', 50, 75, true, false, ARRAY['Pesticides', 'Arsenic', 'Cyanures'], 'EPI obligatoire'),
('6', '6.2', 'Matières infectieuses', 'Infectious substances', 100, 150, true, true, ARRAY['Échantillons médicaux', 'Déchets médicaux'], 'Triple emballage - Traçabilité'),
('7', NULL, 'Matières radioactives', 'Radioactive material', 200, 300, true, true, ARRAY['Isotopes médicaux', 'Sources industrielles'], 'Autorisation AIEA - Contrôle dosimétrique'),
('8', NULL, 'Matières corrosives', 'Corrosive substances', 50, 60, true, false, ARRAY['Acide sulfurique', 'Soude caustique', 'Batteries'], 'Bac de rétention - Neutralisant disponible'),
('9', NULL, 'Matières dangereuses diverses', 'Miscellaneous dangerous goods', 25, 30, false, false, ARRAY['Batteries lithium', 'Moteurs', 'Amiante'], 'Selon fiche produit');

-- Enable RLS
ALTER TABLE public.imo_classes ENABLE ROW LEVEL SECURITY;

-- Public read policy
CREATE POLICY "imo_classes_public_read" ON public.imo_classes FOR SELECT USING (true);