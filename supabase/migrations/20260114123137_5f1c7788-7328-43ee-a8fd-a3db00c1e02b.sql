-- =============================================
-- SYSTÈME DE TARIFICATION TRANSPORT MALI INTELLIGENT
-- =============================================

-- 1. Table des zones de transport Mali avec distances et niveaux de sécurité
CREATE TABLE public.mali_transport_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_name TEXT NOT NULL,
  region TEXT NOT NULL,
  country TEXT DEFAULT 'MALI',
  distance_from_dakar_km INTEGER NOT NULL,
  estimated_transit_days NUMERIC(3,1),
  security_level TEXT DEFAULT 'MEDIUM' CHECK (security_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  security_surcharge_percent INTEGER DEFAULT 0,
  route_description TEXT,
  alternative_route TEXT,
  alternative_route_km INTEGER,
  is_accessible BOOLEAN DEFAULT true,
  last_security_update TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index pour recherche rapide par nom de zone
CREATE INDEX idx_mali_zones_name ON public.mali_transport_zones USING gin(to_tsvector('french', zone_name));
CREATE INDEX idx_mali_zones_region ON public.mali_transport_zones(region);

-- 2. Table de suivi des prix du carburant
CREATE TABLE public.fuel_price_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country TEXT NOT NULL,
  fuel_type TEXT DEFAULT 'DIESEL',
  price_per_liter NUMERIC(10,2) NOT NULL,
  currency TEXT DEFAULT 'XOF',
  source TEXT,
  recorded_date DATE NOT NULL,
  is_crisis_price BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_fuel_prices_country_date ON public.fuel_price_tracking(country, recorded_date DESC);

-- 3. Table des alertes sécuritaires
CREATE TABLE public.security_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country TEXT NOT NULL,
  affected_zones TEXT[],
  alert_level TEXT NOT NULL CHECK (alert_level IN ('WARNING', 'CRITICAL', 'BLOCKED')),
  alert_type TEXT CHECK (alert_type IN ('SECURITY', 'FUEL_SHORTAGE', 'ROAD_BLOCKED', 'STRIKE', 'WEATHER', 'OTHER')),
  title TEXT NOT NULL,
  description TEXT,
  recommended_action TEXT,
  source_url TEXT,
  effective_from DATE NOT NULL,
  effective_until DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_security_alerts_active ON public.security_alerts(country, is_active) WHERE is_active = true;

-- 4. Table des formules de tarification transport
CREATE TABLE public.transport_rate_formula (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corridor TEXT NOT NULL,
  container_type TEXT NOT NULL,
  base_rate_per_km NUMERIC(10,2) NOT NULL,
  fixed_costs NUMERIC(12,2) DEFAULT 0,
  fuel_reference_price NUMERIC(10,2),
  includes_return BOOLEAN DEFAULT true,
  effective_date DATE NOT NULL,
  expiry_date DATE,
  source TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_transport_formula_corridor ON public.transport_rate_formula(corridor, container_type, is_active);

-- =============================================
-- DONNÉES INITIALES
-- =============================================

-- Zones Mali avec distances depuis Dakar
INSERT INTO public.mali_transport_zones (zone_name, region, distance_from_dakar_km, estimated_transit_days, security_level, security_surcharge_percent, route_description, is_accessible) VALUES
  ('Kayes', 'Kayes', 700, 1.5, 'LOW', 0, 'Dakar → Tambacounda → Kidira → Diboli → Kayes', true),
  ('Kéniéba', 'Kayes', 850, 2.0, 'LOW', 5, 'Via Kayes, zone minière', true),
  ('Kita', 'Kayes', 950, 2.0, 'LOW', 5, 'Via Kayes → Kita', true),
  ('Bamako', 'Bamako', 1353, 2.5, 'MEDIUM', 15, 'Dakar → Kidira → Diboli → Kayes → Bamako (RN1)', true),
  ('Kati', 'Koulikoro', 1370, 2.5, 'MEDIUM', 15, 'Via Bamako + 17km nord', true),
  ('Koulikoro', 'Koulikoro', 1410, 3.0, 'MEDIUM', 15, 'Via Bamako → Koulikoro (60km)', true),
  ('Sirakoro', 'Koulikoro', 1450, 3.0, 'MEDIUM', 20, 'Via Bamako → Kati → Sirakoro', true),
  ('Tiakadougou', 'Koulikoro', 1480, 3.0, 'MEDIUM', 20, 'Via Bamako → Kati → Tiakadougou', true),
  ('Ségou', 'Ségou', 1580, 3.5, 'HIGH', 35, 'Via Bamako → Ségou (235km) - Zone sensible JNIM', true),
  ('Niono', 'Ségou', 1700, 4.0, 'HIGH', 40, 'Via Ségou → Niono - Office du Niger', true),
  ('Sikasso', 'Sikasso', 1750, 4.0, 'LOW', 10, 'Via Bamako → Bougouni → Sikasso - Sud Mali stable', true),
  ('Koutiala', 'Sikasso', 1650, 3.5, 'MEDIUM', 20, 'Via Bamako → Koutiala', true),
  ('Mopti', 'Mopti', 1900, 4.5, 'CRITICAL', 50, 'Via Ségou → Mopti - ZONE TRÈS DANGEREUSE', true),
  ('Djenné', 'Mopti', 1850, 4.5, 'CRITICAL', 50, 'Via Mopti - Zone patrimoine UNESCO à risque', true),
  ('Tombouctou', 'Tombouctou', 2200, 5.0, 'CRITICAL', 75, 'Nord Mali - DÉCONSEILLÉ - Convois militaires requis', false),
  ('Gao', 'Gao', 2400, 5.5, 'CRITICAL', 100, 'Nord-Est Mali - TRÈS DANGEREUX - Non recommandé', false),
  ('Kidal', 'Kidal', 2700, 6.0, 'CRITICAL', 100, 'Extrême Nord - INACCESSIBLE pour transport commercial', false);

-- Routes alternatives pour zones à risque
UPDATE public.mali_transport_zones 
SET alternative_route = 'Via Côte d''Ivoire: Abidjan → Bouaké → Sikasso → Bamako',
    alternative_route_km = 1800
WHERE region IN ('Ségou', 'Mopti');

-- Prix carburant historique et actuel
INSERT INTO public.fuel_price_tracking (country, fuel_type, price_per_liter, source, recorded_date, is_crisis_price, notes) VALUES
  ('SENEGAL', 'DIESEL', 755, 'Prix pompe officiel', '2024-01-01', false, 'Prix subventionné Sénégal'),
  ('SENEGAL', 'DIESEL', 760, 'Prix pompe officiel', '2025-01-01', false, 'Légère hausse'),
  ('MALI', 'DIESEL', 775, 'globalpetrolprices.com', '2024-01-01', false, 'Prix normal'),
  ('MALI', 'DIESEL', 780, 'globalpetrolprices.com', '2024-06-01', false, 'Prix stable'),
  ('MALI', 'DIESEL', 850, 'Estimation marché noir', '2024-11-01', true, 'Début blocage JNIM - pénurie partielle'),
  ('MALI', 'DIESEL', 950, 'Témoignages transporteurs', '2024-11-15', true, 'Pic de crise carburant'),
  ('MALI', 'DIESEL', 820, 'Estimation marché', '2025-01-01', false, 'Retour progressif à la normale');

-- Alertes sécuritaires actives
INSERT INTO public.security_alerts (country, affected_zones, alert_level, alert_type, title, description, recommended_action, source_url, effective_from, is_active) VALUES
  ('MALI', ARRAY['Mopti', 'Ségou', 'Gao', 'Tombouctou', 'Kidal', 'Djenné', 'Niono'], 'CRITICAL', 'SECURITY', 
   'Présence active groupes armés (JNIM/ISGS)', 
   'Les groupes jihadistes JNIM et ISGS maintiennent une présence active dans le centre et nord du Mali. Attaques régulières sur les axes routiers.',
   'Éviter le transport vers ces zones. Si nécessaire: convoi sécurisé, assurance renforcée, délais majorés.',
   'https://www.gov.uk/foreign-travel-advice/mali',
   '2024-01-01', true),
  
  ('MALI', ARRAY['Mopti', 'Ségou', 'Tombouctou', 'Gao'], 'WARNING', 'FUEL_SHORTAGE', 
   'Pénuries carburant sporadiques - Nord/Centre Mali', 
   'Blocages intermittents des approvisionnements en carburant par des groupes armés. Prix locaux peuvent doubler.',
   'Prévoir surcharge carburant 15-25%, confirmer disponibilité avant départ.',
   NULL,
   '2024-11-01', true),

  ('MALI', ARRAY['Kayes', 'Bamako', 'Kati', 'Koulikoro', 'Sirakoro', 'Tiakadougou'], 'WARNING', 'SECURITY', 
   'Vigilance renforcée - Axe Dakar-Bamako', 
   'Axe principal relativement sûr mais incidents isolés possibles. Voyage de nuit déconseillé.',
   'Privilégier convois de jour, éviter arrêts prolongés, informer du planning.',
   NULL,
   '2024-06-01', true);

-- Formules de tarification transport Dakar-Mali (basées sur historique Taleb)
INSERT INTO public.transport_rate_formula (corridor, container_type, base_rate_per_km, fixed_costs, fuel_reference_price, includes_return, effective_date, source, notes, is_active) VALUES
  -- Conteneurs 20 pieds
  ('DAKAR_MALI', '20DV', 1850, 150000, 755, true, '2024-10-01', 'Analyse historique Taleb', 'Base: ~2,600,000 pour Bamako (1350km)', true),
  ('DAKAR_MALI', '20RF', 2100, 200000, 755, true, '2024-10-01', 'Estimation', 'Reefer: +15% pour groupe froid', true),
  
  -- Conteneurs 40 pieds standard
  ('DAKAR_MALI', '40DV', 1950, 180000, 755, true, '2024-10-01', 'Analyse historique Taleb', 'Base: ~2,800,000 pour Bamako', true),
  ('DAKAR_MALI', '40HC', 1950, 180000, 755, true, '2024-10-01', 'Analyse historique Taleb', 'High Cube même tarif que 40DV', true),
  ('DAKAR_MALI', '40RF', 2200, 250000, 755, true, '2024-10-01', 'Estimation', 'Reefer 40: +15% groupe froid', true),
  
  -- Conteneurs spéciaux
  ('DAKAR_MALI', '40OT', 2200, 250000, 755, true, '2024-10-01', 'Estimation', 'Open Top: +15% manutention spéciale', true),
  ('DAKAR_MALI', '40FR', 2400, 300000, 755, true, '2024-10-01', 'Estimation', 'Flat Rack: +25% arrimage spécial', true),
  ('DAKAR_MALI', '20OT', 2000, 200000, 755, true, '2024-10-01', 'Estimation', 'Open Top 20: +10% manutention', true),

  -- Corridor alternatif via Abidjan (référence)
  ('ABIDJAN_MALI', '40HC', 1600, 250000, 800, true, '2024-10-01', 'Estimation marché', 'Alternative via Côte d''Ivoire si Sénégal bloqué', true);

-- Trigger pour mise à jour automatique du timestamp
CREATE OR REPLACE FUNCTION update_mali_zones_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_mali_zones_timestamp
BEFORE UPDATE ON public.mali_transport_zones
FOR EACH ROW EXECUTE FUNCTION update_mali_zones_timestamp();

-- RLS Policies (lecture publique, écriture admin)
ALTER TABLE public.mali_transport_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fuel_price_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_rate_formula ENABLE ROW LEVEL SECURITY;

-- Policies de lecture pour tous
CREATE POLICY "Allow public read mali_transport_zones" ON public.mali_transport_zones FOR SELECT USING (true);
CREATE POLICY "Allow public read fuel_price_tracking" ON public.fuel_price_tracking FOR SELECT USING (true);
CREATE POLICY "Allow public read security_alerts" ON public.security_alerts FOR SELECT USING (true);
CREATE POLICY "Allow public read transport_rate_formula" ON public.transport_rate_formula FOR SELECT USING (true);

-- Policies d'écriture (service role uniquement pour l'instant)
CREATE POLICY "Allow service insert mali_transport_zones" ON public.mali_transport_zones FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service update mali_transport_zones" ON public.mali_transport_zones FOR UPDATE USING (true);
CREATE POLICY "Allow service insert fuel_price_tracking" ON public.fuel_price_tracking FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service insert security_alerts" ON public.security_alerts FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service update security_alerts" ON public.security_alerts FOR UPDATE USING (true);
CREATE POLICY "Allow service insert transport_rate_formula" ON public.transport_rate_formula FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service update transport_rate_formula" ON public.transport_rate_formula FOR UPDATE USING (true);