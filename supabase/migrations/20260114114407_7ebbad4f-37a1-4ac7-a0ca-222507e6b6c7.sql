-- ===========================================================
-- MIGRATION: Système de Cotation Mali Complet
-- Phase 1: Nouvelles tables + Phase 2: Données tarifaires
-- ===========================================================

-- ==============================
-- 1. TABLE tariff_documents
-- ==============================
CREATE TABLE IF NOT EXISTS public.tariff_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  document_type TEXT NOT NULL,
  filename TEXT NOT NULL,
  storage_path TEXT,
  version TEXT,
  effective_date DATE,
  expiry_date DATE,
  is_current BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.tariff_documents ENABLE ROW LEVEL SECURITY;

-- Public read access for tariff documents
CREATE POLICY "Tariff documents are viewable by everyone" 
ON public.tariff_documents FOR SELECT USING (true);

-- Insert initial document references
INSERT INTO tariff_documents (provider, document_type, filename, effective_date, notes)
VALUES
  ('HAPAG_LLOYD', 'LOCAL_CHARGES', 'hapag_lloyd_local_charges.pdf', '2023-03-23', 'Frais locaux Dakar Import/Export/Transit'),
  ('ONE', 'LOCAL_CHARGES', 'one_line_local_charges.pdf', '2024-10-19', 'ONE Line Dakar tariffs'),
  ('DP_WORLD', 'PORT_TARIFFS', 'DPW_TARIFS_2025_0001.pdf', '2025-01-01', 'Tarifs officiels DP World Dakar 2025'),
  ('DPW', 'LANDSIDE_TARIFF', 'dpw_dakar_landside_tariff_2015.pdf', '2015-01-01', 'Barème landside'),
  ('TALEB', 'QUOTATION_REFERENCE', 'Tiakabougou_inland_delivery_quote.xlsx', '2024-10-01', 'Cotation référence Mali - Taleb');

-- ==============================
-- 2. TABLE border_clearing_rates
-- ==============================
CREATE TABLE IF NOT EXISTS public.border_clearing_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corridor TEXT NOT NULL,
  country TEXT NOT NULL,
  charge_code TEXT NOT NULL,
  charge_name TEXT NOT NULL,
  calculation_method TEXT DEFAULT 'PER_CNT',
  amount_20ft NUMERIC,
  amount_40ft NUMERIC,
  currency TEXT DEFAULT 'XOF',
  source_document TEXT,
  effective_date DATE,
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookup
CREATE INDEX idx_border_clearing_corridor ON public.border_clearing_rates(corridor, country, is_active);

-- Enable RLS
ALTER TABLE public.border_clearing_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Border clearing rates are viewable by everyone" 
ON public.border_clearing_rates FOR SELECT USING (true);

-- Insert Mali border clearing rates (Kidira-Diboli corridor)
INSERT INTO border_clearing_rates (corridor, country, charge_code, charge_name, amount_20ft, amount_40ft, source_document, effective_date, notes)
VALUES
  ('KIDIRA_DIBOLI', 'MALI', 'TS_KIDIRA', 'Ts Kidira / Ts Diboli', 15000, 15000, 'Taleb_Tiakabougou_Quote_2024', '2024-10-01', 'Frais de transit frontière sénégalaise'),
  ('KIDIRA_DIBOLI', 'MALI', 'TRIE_CARNET', 'TRIE Carnet', 7500, 7500, 'Taleb_Tiakabougou_Quote_2024', '2024-10-01', 'Carnet de transit international'),
  ('KIDIRA_DIBOLI', 'MALI', 'SCANNER', 'Scanner Frontière', 30000, 30000, 'Taleb_Tiakabougou_Quote_2024', '2024-10-01', 'Passage scanner frontière'),
  ('KIDIRA_DIBOLI', 'MALI', 'RI_RS', 'RI RS', 7000, 7000, 'Taleb_Tiakabougou_Quote_2024', '2024-10-01', 'Redevance informatique'),
  ('KIDIRA_DIBOLI', 'MALI', 'MALI_BORDER', 'Mali Border Clearing Fees', 50000, 75000, 'Taleb_Tiakabougou_Quote_2024', '2024-10-01', 'Dédouanement côté malien'),
  ('KIDIRA_DIBOLI', 'MALI', 'CUSTOMS_ESCORT_SN', 'Customs Escort Senegal', 75000, 75000, 'Taleb_Tiakabougou_Quote_2024', '2024-10-01', 'Escorte douanière sénégalaise');

-- ==============================
-- 3. TABLE destination_terminal_rates
-- ==============================
CREATE TABLE IF NOT EXISTS public.destination_terminal_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  terminal_name TEXT NOT NULL,
  country TEXT NOT NULL,
  charge_code TEXT NOT NULL,
  charge_name TEXT NOT NULL,
  calculation_method TEXT,
  rate_per_tonne NUMERIC,
  rate_per_truck NUMERIC,
  rate_fixed NUMERIC,
  rate_per_cnt NUMERIC,
  currency TEXT DEFAULT 'XOF',
  source_document TEXT,
  effective_date DATE,
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookup
CREATE INDEX idx_destination_terminal ON public.destination_terminal_rates(terminal_name, country, is_active);

-- Enable RLS
ALTER TABLE public.destination_terminal_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Destination terminal rates are viewable by everyone" 
ON public.destination_terminal_rates FOR SELECT USING (true);

-- Insert Mali destination terminal rates
INSERT INTO destination_terminal_rates (terminal_name, country, charge_code, charge_name, calculation_method, rate_per_tonne, rate_per_truck, rate_fixed, rate_per_cnt, currency, source_document, effective_date, notes)
VALUES
  -- SDV Kati Terminal
  ('SDV_KATI', 'MALI', 'KATI_PER_TON', 'Kati Fees per ton', 'PER_TONNE', 997, NULL, NULL, NULL, 'XOF', 'Taleb_Tiakabougou_Quote_2024', '2024-10-01', '€1.52 × 656 = 997 XOF'),
  ('SDV_KATI', 'MALI', 'KATI_PER_TRUCK', 'Kati Fees per truck', 'PER_TRUCK', NULL, 7080, NULL, NULL, 'XOF', 'Taleb_Tiakabougou_Quote_2024', '2024-10-01', '€10.79 × 656 = 7,080 XOF'),
  ('SDV_KATI', 'MALI', 'PDI_RS_RI', 'PDI - RS - RI', 'PER_CNT', NULL, NULL, NULL, 17000, 'XOF', 'Taleb_Tiakabougou_Quote_2024', '2024-10-01', 'Redevances informatiques'),
  ('SDV_KATI', 'MALI', 'ECOR_DOUANE', 'Ecor Douane', 'PER_CNT', NULL, NULL, NULL, 25000, 'XOF', 'Taleb_Tiakabougou_Quote_2024', '2024-10-01', 'Ecor de douane'),
  ('SDV_KATI', 'MALI', 'ACCORD_SORTIE', 'Accord sortie', 'PER_CNT', NULL, NULL, NULL, 19000, 'XOF', 'Taleb_Tiakabougou_Quote_2024', '2024-10-01', 'Accord de sortie terminal'),
  ('SDV_KATI', 'MALI', 'TS_BRIGADE', 'Ts Brigade', 'PER_CNT', NULL, NULL, NULL, 100000, 'XOF', 'Taleb_Tiakabougou_Quote_2024', '2024-10-01', 'Frais brigade'),
  ('SDV_KATI', 'MALI', 'MALIAN_CLEARING_AGENT', 'Malian Clearing Agent', 'PER_CNT', NULL, NULL, NULL, 25000, 'XOF', 'Taleb_Tiakabougou_Quote_2024', '2024-10-01', 'Honoraires transitaire malien'),
  
  -- Mali Shipper Council (Conseil Malien des Chargeurs)
  ('MALI_SHIPPER_COUNCIL', 'MALI', 'DM_LV', 'DM/LV (Conseil Malien des Chargeurs)', 'FIXED', NULL, NULL, 15000, NULL, 'XOF', 'Taleb_Tiakabougou_Quote_2024', '2024-10-01', 'Frais fixe par dossier'),
  ('MALI_SHIPPER_COUNCIL', 'MALI', 'CMC', 'CMC', 'PER_CNT', NULL, NULL, NULL, 10000, 'XOF', 'Taleb_Tiakabougou_Quote_2024', '2024-10-01', 'Conseil Malien des Chargeurs par conteneur'),
  ('MALI_SHIPPER_COUNCIL', 'MALI', 'EMASE', 'EMASE', 'PER_TONNE', 505, NULL, NULL, NULL, 'XOF', 'Taleb_Tiakabougou_Quote_2024', '2024-10-01', '€0.77 × 656 = 505 XOF/tonne');

-- ==============================
-- 4. TARIFS DPW MANQUANTS
-- ==============================
INSERT INTO port_tariffs (provider, category, operation_type, classification, cargo_type, amount, unit, source_document, effective_date, is_active)
VALUES
  -- Relevage (repositionnement conteneur)
  ('DP_WORLD', 'RELEVAGE', 'TRANSIT', 'Standard 20 pieds', 'CONTENEUR_20', 36560, 'FCFA/EVP', 'Taleb_Quote_2024', '2024-10-01', true),
  ('DP_WORLD', 'RELEVAGE', 'TRANSIT', 'Standard 40 pieds', 'CONTENEUR_40', 73120, 'FCFA/CNT', 'Taleb_Quote_2024', '2024-10-01', true),
  
  -- Redevance Variables (PAD)
  ('PAD', 'REDEVANCE_VARIABLE', 'TRANSIT', 'Standard 20 pieds', 'CONTENEUR_20', 9183, 'FCFA/EVP', 'Taleb_Quote_2024', '2024-10-01', true),
  ('PAD', 'REDEVANCE_VARIABLE', 'TRANSIT', 'Standard 40 pieds', 'CONTENEUR_40', 18366, 'FCFA/CNT', 'Taleb_Quote_2024', '2024-10-01', true),
  
  -- Port Tax
  ('PAD', 'PORT_TAX', 'TRANSIT', 'Conteneur léger <15t', 'CONTENEUR_20', 11308, 'FCFA/EVP', 'Taleb_Quote_2024', '2024-10-01', true),
  ('PAD', 'PORT_TAX', 'TRANSIT', 'Conteneur standard 15-25t', 'CONTENEUR_40', 16962, 'FCFA/CNT', 'Taleb_Quote_2024', '2024-10-01', true)
ON CONFLICT DO NOTHING;

-- ==============================
-- 5. TARIFS THD/THO HAPAG-LLOYD PAR CATÉGORIE
-- ==============================
INSERT INTO port_tariffs (provider, category, operation_type, classification, cargo_type, amount, unit, source_document, effective_date, is_active)
VALUES
  -- THD Import par catégorie tarifaire
  ('HAPAG_LLOYD', 'THD', 'IMPORT', 'T01 - Drinks, Chemicals, Equipment', 'GENERAL', 19239, 'FCFA/TONNE', 'hapag_lloyd_local_charges.pdf', '2023-03-23', true),
  ('HAPAG_LLOYD', 'THD', 'IMPORT', 'T02 - Animals, Groceries, Metals', 'GENERAL', 9678, 'FCFA/TONNE', 'hapag_lloyd_local_charges.pdf', '2023-03-23', true),
  ('HAPAG_LLOYD', 'THD', 'IMPORT', 'T03 - Sugar, Oilseeds, Chemicals', 'GENERAL', 1416, 'FCFA/TONNE', 'hapag_lloyd_local_charges.pdf', '2023-03-23', true),
  ('HAPAG_LLOYD', 'THD', 'IMPORT', 'T04 - Vegetables, Fruits, Wood', 'GENERAL', 3069, 'FCFA/TONNE', 'hapag_lloyd_local_charges.pdf', '2023-03-23', true),
  ('HAPAG_LLOYD', 'THD', 'IMPORT', 'T05 - Cereals, Food, Cement', 'GENERAL', 1180, 'FCFA/TONNE', 'hapag_lloyd_local_charges.pdf', '2023-03-23', true),
  ('HAPAG_LLOYD', 'THD', 'IMPORT', 'T06 - Oil Products, Hydrocarbons', 'GENERAL', 885, 'FCFA/TONNE', 'hapag_lloyd_local_charges.pdf', '2023-03-23', true),
  ('HAPAG_LLOYD', 'THD', 'IMPORT', 'T07 - Textiles, Coal, Building Mat.', 'GENERAL', 484, 'FCFA/TONNE', 'hapag_lloyd_local_charges.pdf', '2023-03-23', true),
  ('HAPAG_LLOYD', 'THD', 'IMPORT', 'T08 - Animal Food, Scrap Iron', 'GENERAL', 1062, 'FCFA/TONNE', 'hapag_lloyd_local_charges.pdf', '2023-03-23', true),
  ('HAPAG_LLOYD', 'THD', 'IMPORT', 'T09 - Vehicles, Tractors, Machines', 'GENERAL', 4367, 'FCFA/TONNE', 'hapag_lloyd_local_charges.pdf', '2023-03-23', true),
  ('HAPAG_LLOYD', 'THD', 'IMPORT', 'T10 - Salt, Pyrites, Sulphur', 'GENERAL', 779, 'FCFA/TONNE', 'hapag_lloyd_local_charges.pdf', '2023-03-23', true),
  ('HAPAG_LLOYD', 'THD', 'IMPORT', 'T11 - Crude Oil, Ores, Chemicals', 'GENERAL', 1770, 'FCFA/TONNE', 'hapag_lloyd_local_charges.pdf', '2023-03-23', true),
  ('HAPAG_LLOYD', 'THD', 'IMPORT', 'T12 - Mixed Products', 'GENERAL', 4780, 'FCFA/TONNE', 'hapag_lloyd_local_charges.pdf', '2023-03-23', true),
  ('HAPAG_LLOYD', 'THD', 'IMPORT', 'T13 - Special Transactions', 'GENERAL', 11803, 'FCFA/TONNE', 'hapag_lloyd_local_charges.pdf', '2023-03-23', true),
  ('HAPAG_LLOYD', 'THD', 'IMPORT', 'T14 - Metallurgical Products', 'GENERAL', 4072, 'FCFA/TONNE', 'hapag_lloyd_local_charges.pdf', '2023-03-23', true),
  -- Périssables
  ('HAPAG_LLOYD', 'THD', 'IMPORT', 'P01 - Perishable Food Stuff', 'PERISHABLE', 28100, 'FCFA/TONNE', 'hapag_lloyd_local_charges.pdf', '2023-03-23', true),
  ('HAPAG_LLOYD', 'THD', 'IMPORT', 'P02 - Perishable Food Stuff', 'PERISHABLE', 2325, 'FCFA/TONNE', 'hapag_lloyd_local_charges.pdf', '2023-03-23', true),
  ('HAPAG_LLOYD', 'THD', 'IMPORT', 'P03 - Perishable Food Stuff', 'PERISHABLE', 13000, 'FCFA/TONNE', 'hapag_lloyd_local_charges.pdf', '2023-03-23', true),
  ('HAPAG_LLOYD', 'THD', 'IMPORT', 'P04 - Perishable Food Stuff', 'PERISHABLE', 1850, 'FCFA/TONNE', 'hapag_lloyd_local_charges.pdf', '2023-03-23', true),
  ('HAPAG_LLOYD', 'THD', 'IMPORT', 'P05 - Perishable Food Stuff', 'PERISHABLE', 3350, 'FCFA/TONNE', 'hapag_lloyd_local_charges.pdf', '2023-03-23', true)
ON CONFLICT DO NOTHING;

-- ==============================
-- 6. CARRIER BILLING TEMPLATES - TRANSIT
-- ==============================
INSERT INTO carrier_billing_templates (carrier, charge_code, charge_name, calculation_method, default_amount, currency, operation_type, invoice_type, invoice_sequence, is_active, notes)
VALUES
  -- Frais génériques Transit (tous armateurs)
  ('GENERIC', 'CEF', 'Control Equipment Fees', 'PER_CNT', 15138, 'XOF', 'TRANSIT', 'PORT_CHARGES', 1, true, 'Frais contrôle équipement - Transit Mali'),
  ('GENERIC', 'PCD', 'Port Charges Destination', 'PER_CNT', 14652, 'XOF', 'TRANSIT', 'PORT_CHARGES', 1, true, 'Frais portuaires destination'),
  ('GENERIC', 'ORBUS', 'Orbus Fee', 'PER_CNT', 4500, 'XOF', 'TRANSIT', 'PORT_CHARGES', 1, true, 'Contribution ORBUS'),
  ('GENERIC', 'TRANSIT_COC_20', 'In Transit Fees COC 20ft', 'PER_CNT', 100000, 'XOF', 'TRANSIT', 'PORT_CHARGES', 1, true, 'Frais transit COC par 20 pieds'),
  ('GENERIC', 'TRANSIT_COC_40', 'In Transit Fees COC 40ft', 'PER_CNT', 200000, 'XOF', 'TRANSIT', 'PORT_CHARGES', 1, true, 'Frais transit COC par 40 pieds'),
  ('GENERIC', 'ISPS', 'ISPS Fee', 'PER_CNT', 5805, 'XOF', 'TRANSIT', 'PORT_CHARGES', 1, true, 'International Ship and Port Facility Security'),
  
  -- Hapag-Lloyd Transit
  ('HAPAG_LLOYD', 'XPV_20', 'Port Dues Transit 20ft', 'PER_CNT', 11000, 'XOF', 'TRANSIT', 'PORT_CHARGES', 1, true, 'Redevance port transit 20 pieds'),
  ('HAPAG_LLOYD', 'XPV_40', 'Port Dues Transit 40ft', 'PER_CNT', 16500, 'XOF', 'TRANSIT', 'PORT_CHARGES', 1, true, 'Redevance port transit 40 pieds'),
  ('HAPAG_LLOYD', 'XAO', 'EDO Transit', 'PER_TEU', 4500, 'XOF', 'TRANSIT', 'DOCUMENTATION', 2, true, 'Bon livraison électronique transit'),
  ('HAPAG_LLOYD', 'TXI', 'Tax Import', 'PER_BL', 25000, 'XOF', 'IMPORT', 'PORT_CHARGES', 1, true, 'Taxe import par BL'),
  ('HAPAG_LLOYD', 'ETD_20', 'Equipment Transfer 20ft', 'PER_CNT', 90000, 'XOF', 'IMPORT', 'PORT_CHARGES', 1, true, 'Transfert équipement 20 pieds'),
  ('HAPAG_LLOYD', 'ETD_40', 'Equipment Transfer 40ft', 'PER_CNT', 150000, 'XOF', 'IMPORT', 'PORT_CHARGES', 1, true, 'Transfert équipement 40 pieds'),
  ('HAPAG_LLOYD', 'PSX_20', 'Port Tax Transit Export 20ft', 'PER_CNT', 4500, 'XOF', 'EXPORT', 'PORT_CHARGES', 1, true, 'Taxe port transit export 20 pieds'),
  ('HAPAG_LLOYD', 'PSX_40', 'Port Tax Transit Export 40ft', 'PER_CNT', 9000, 'XOF', 'EXPORT', 'PORT_CHARGES', 1, true, 'Taxe port transit export 40 pieds'),
  
  -- ONE Line
  ('ONE', 'DOF', 'Delivery Order Fees', 'PER_BL', 18000, 'XOF', 'IMPORT', 'DOCUMENTATION', 1, true, 'Frais bon de livraison - TVA 18%'),
  ('ONE', 'COLL', 'Collection Fees', 'PERCENTAGE', 2.8, 'XOF', 'IMPORT', 'DOCUMENTATION', 1, true, 'Commission sur fret et taxes port - TVA 18%'),
  ('ONE', 'MNF', 'Manifest Fees', 'PER_BL', 600, 'XOF', 'IMPORT', 'DOCUMENTATION', 1, true, 'Frais manifeste ONE vessels only'),
  ('ONE', 'TBL', 'BL Stamp', 'PER_CNT', 10000, 'XOF', 'IMPORT', 'DOCUMENTATION', 1, true, 'Timbre BL'),
  ('ONE', 'TSS_IMP', 'Terminal Security Surcharge', 'PER_CNT', 25000, 'XOF', 'IMPORT', 'PORT_CHARGES', 1, true, 'Supplément sécurité terminal import'),
  ('ONE', 'CMF', 'Container Management Fee', 'PER_CONTAINER', 115000, 'XOF', 'IMPORT', 'PORT_CHARGES', 1, true, 'Frais gestion conteneur'),
  ('ONE', 'DG_HANDLING', 'DG Container Handling', 'PER_CONTAINER', 5000, 'XOF', 'IMPORT', 'PORT_CHARGES', 1, true, 'Manutention DG - TVA 18%')
ON CONFLICT DO NOTHING;

-- ==============================
-- 7. TARIFS TRANSPORT MALI (learned_knowledge)
-- ==============================
INSERT INTO learned_knowledge (name, description, category, data, source_type, is_validated, matching_criteria)
VALUES
  ('Transport Dakar → Tiakadougou 20ft', 'Transport routier A/R conteneur 20 pieds vers site Mali (EDM)', 'tarif', 
   '{"service": "Transport local", "montant": 2600000, "devise": "XOF", "origine": "Port Dakar", "destination": "Tiakadougou, Mali", "container_type": "20DV", "weight_limit_tons": 24, "includes_return": true, "distance_km": 1409, "corridor": "South"}'::jsonb,
   'expert_quotation', true,
   '{"destination": "Mali", "container_type": "20", "cargo_category": "general"}'::jsonb),
   
  ('Transport Dakar → Tiakadougou 2x20ft', 'Transport routier A/R 2 conteneurs 20 pieds vers site Mali', 'tarif',
   '{"service": "Transport local", "montant": 3400000, "devise": "XOF", "origine": "Port Dakar", "destination": "Tiakadougou, Mali", "container_type": "2x20DV", "weight_limit_tons": 51, "includes_return": true}'::jsonb,
   'expert_quotation', true,
   '{"destination": "Mali", "container_type": "20", "quantity": 2}'::jsonb),
   
  ('Transport Dakar → Tiakadougou 40ft', 'Transport routier A/R conteneur 40 pieds vers site Mali', 'tarif',
   '{"service": "Transport local", "montant": 2600000, "devise": "XOF", "origine": "Port Dakar", "destination": "Tiakadougou, Mali", "container_type": "40HC", "weight_limit_tons": 30, "includes_return": true}'::jsonb,
   'expert_quotation', true,
   '{"destination": "Mali", "container_type": "40"}'::jsonb),
   
  ('Surcharge Sécurité Mali', 'Supplément transport dû aux problèmes sécuritaires (depuis Oct 2024)', 'surcharge',
   '{"montant_20ft": 650000, "montant_40ft": 650000, "devise": "XOF", "raison": "Ongoing Security issue", "date_debut": "2024-10-01", "applicable_routes": ["Dakar-Mali"]}'::jsonb,
   'expert_quotation', true, NULL),
   
  ('SN Clearing Fees Transit Mali', 'Honoraires dédouanement Sénégal pour transit Mali', 'tarif',
   '{"service": "Dédouanement", "montant": 50000, "devise": "XOF", "type": "transit", "destination_country": "Mali"}'::jsonb,
   'expert_quotation', true,
   '{"destination": "Mali", "service": "clearing"}'::jsonb)
ON CONFLICT DO NOTHING;