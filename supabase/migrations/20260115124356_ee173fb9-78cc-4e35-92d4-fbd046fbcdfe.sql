-- Table pour stocker les clauses CGV différenciées par destination
CREATE TABLE public.quotation_clauses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_type TEXT NOT NULL, -- 'SENEGAL_IMPORT', 'MALI_TRANSIT', 'BURKINA_TRANSIT', 'ALL'
  clause_code TEXT NOT NULL,
  clause_title TEXT NOT NULL,
  clause_content TEXT NOT NULL,
  is_warning BOOLEAN DEFAULT false,
  is_exclusion BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index pour recherche rapide
CREATE INDEX idx_quotation_clauses_destination ON public.quotation_clauses(destination_type, is_active);

-- Enable RLS
ALTER TABLE public.quotation_clauses ENABLE ROW LEVEL SECURITY;

-- Policy lecture publique (données de référence)
CREATE POLICY "Quotation clauses are readable by all" 
ON public.quotation_clauses 
FOR SELECT 
USING (true);

-- Trigger updated_at
CREATE TRIGGER update_quotation_clauses_updated_at
BEFORE UPDATE ON public.quotation_clauses
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- CLAUSES MALI TRANSIT
-- =====================================================

INSERT INTO public.quotation_clauses (destination_type, clause_code, clause_title, clause_content, is_warning, is_exclusion, sort_order) VALUES
-- Délais et franchises
('MALI_TRANSIT', 'TRANSIT_TIME', 'Transit Time', 'Transit estimé: 15-18 jours depuis arrivée navire Dakar.', false, false, 1),
('MALI_TRANSIT', 'DEMURRAGE_FREE', 'Franchise Demurrage', 'Demander 21 jours au booking (standard armateur: 10 jours). Au-delà: surestaries applicables.', true, false, 2),
('MALI_TRANSIT', 'STORAGE_FREE', 'Franchise Magasinage DPW', '21 jours depuis arrivée navire (transit TRIE). Au-delà: frais magasinage DPW applicables.', false, false, 3),
('MALI_TRANSIT', 'MERCHANT_HAULAGE', 'Merchant Haulage', '23 jours gate out full → gate in empty Dakar.', false, false, 4),

-- Détention COC (WARNING)
('MALI_TRANSIT', 'DETENTION_COC_20', 'Détention COC 20''', '€23/jour + Addcom (MSC 5.5%, Maersk 2.8%, autres 2.8%). Délai A/R estimé: 8-13 jours.', true, false, 5),
('MALI_TRANSIT', 'DETENTION_COC_40', 'Détention COC 40''', '€39/jour + Addcom (MSC 5.5%, Maersk 2.8%, autres 2.8%). Délai A/R estimé: 8-13 jours.', true, false, 6),

-- Caution COC (WARNING)
('MALI_TRANSIT', 'CAUTION_COC', 'Caution Conteneur COC', '20'': $3,200 USD | 40'': $5,100 USD\nAlternative broker: €150 (20'') / €250 (40'')\nMaersk/Safmarine: Dispensé de caution', true, false, 7),

-- SOC Recommendation
('MALI_TRANSIT', 'SOC_RECOMMENDATION', 'Recommandation SOC', 'Pour éviter detention + caution COC, nous recommandons l''utilisation de conteneurs SOC (Shipper Owned Container). Économie potentielle: 300k-600k FCFA/conteneur.', false, false, 8),

-- Truck detention
('MALI_TRANSIT', 'TRUCK_DETENTION', 'Immobilisation Camion', '48h franchise (frontière Moussala, Kati, site). Au-delà: €38.11/jour (~25,000 FCFA/jour).', false, false, 9),

-- Sécurité
('MALI_TRANSIT', 'SECURITY_FORCE_MAJEURE', 'Force Majeure / Sécurité', 'Retards liés à la situation sécuritaire régionale non imputables à SODATRA. Surcharge sécurité incluse dans le transport.', true, false, 10),

-- Paiement
('MALI_TRANSIT', 'PAYMENT_TERMS', 'Conditions de Paiement', '80% avant arrivée navire\n10% après passage frontière (TRIE)\n10% sur POD (Proof of Delivery)', false, false, 11),

-- EXCLUSIONS MALI
('MALI_TRANSIT', 'EXCL_BL_CHARGES', 'BL Charges', '€100 par BL (à régler à l''armateur)', false, true, 20),
('MALI_TRANSIT', 'EXCL_PREIMPORT', 'Pre-import / ENS', '€300 (déclaration anticipée)', false, true, 21),
('MALI_TRANSIT', 'EXCL_PVI', 'PVI (Programme Vérification Import)', '0.75% FOB - à régler à COTECNA/BIVAC', false, true, 22),
('MALI_TRANSIT', 'EXCL_INSURANCE_MALI', 'Assurance Mali', '0.15% CIF minimum - obligatoire', false, true, 23),
('MALI_TRANSIT', 'EXCL_ROAD_TAX', 'Road Tax Mali', '0.25% CIF - taxe routière malienne', false, true, 24),
('MALI_TRANSIT', 'EXCL_CUSTOMS_DUTIES', 'Droits et Taxes Douane Mali', 'Selon HS code et valeur CIF - non inclus', false, true, 25),
('MALI_TRANSIT', 'EXCL_STORAGE_EXCESS', 'Surestaries/Magasinage', 'Au-delà des franchises négociées', false, true, 26),

-- =====================================================
-- CLAUSES SENEGAL IMPORT
-- =====================================================

('SENEGAL_IMPORT', 'STORAGE_FREE', 'Franchise Magasinage PAD', '10 jours calendaires depuis arrivée navire. Au-delà: frais DPW applicables.', false, false, 1),
('SENEGAL_IMPORT', 'DEMURRAGE_FREE', 'Franchise Surestaries', '10 jours depuis arrivée navire (selon armateur). Demander extension si nécessaire.', false, false, 2),
('SENEGAL_IMPORT', 'DETENTION', 'Détention Conteneur', '48h après sortie port. 20'' @€27/jour, 40'' @€45/jour + Addcom armateur.', false, false, 3),
('SENEGAL_IMPORT', 'TRUCK_DETENTION', 'Immobilisation Camion', '24h franchise livraison. Au-delà: 100,000 FCFA/jour.', false, false, 4),
('SENEGAL_IMPORT', 'PAYMENT_TERMS', 'Conditions de Paiement', '100% avant dédouanement ou selon accord client.', false, false, 5),

-- EXCLUSIONS SENEGAL
('SENEGAL_IMPORT', 'EXCL_BL_CHARGES', 'BL Charges', '€100 par BL (à régler à l''armateur)', false, true, 20),
('SENEGAL_IMPORT', 'EXCL_PVI', 'PVI (Programme Vérification Import)', '0.75% FOB - COTECNA', false, true, 21),
('SENEGAL_IMPORT', 'EXCL_CUSTOMS_DUTIES', 'Droits et Taxes Douane', 'Selon régime douanier et HS code', false, true, 22),
('SENEGAL_IMPORT', 'EXCL_STORAGE_EXCESS', 'Surestaries/Magasinage', 'Au-delà des 10 jours franchise', false, true, 23),

-- =====================================================
-- CLAUSES COMMUNES (ALL)
-- =====================================================

('ALL', 'VALIDITY', 'Validité Offre', '30 jours à compter de la date d''émission.', false, false, 50),
('ALL', 'FUEL_CLAUSE', 'Clause Carburant', 'Tarifs basés sur prix gasoil de référence. Ajustement possible si variation >5%.', false, false, 51),
('ALL', 'FORCE_MAJEURE', 'Force Majeure', 'Grèves, intempéries, blocages portuaires, situations sécuritaires non imputables.', false, false, 52);