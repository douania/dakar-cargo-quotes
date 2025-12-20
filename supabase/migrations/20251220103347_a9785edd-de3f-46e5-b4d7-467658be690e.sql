-- =============================================
-- PHASE 1: DONNÉES RÉFÉRENTIELLES COMPLÈTES
-- =============================================

-- 1. TABLE DEMURRAGE RATES (Surestaries par compagnie)
CREATE TABLE public.demurrage_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    carrier VARCHAR NOT NULL,
    container_type VARCHAR NOT NULL DEFAULT '20DV',
    free_days_import INTEGER NOT NULL DEFAULT 7,
    free_days_export INTEGER NOT NULL DEFAULT 5,
    currency VARCHAR NOT NULL DEFAULT 'USD',
    day_1_7_rate NUMERIC NOT NULL DEFAULT 0,
    day_8_14_rate NUMERIC NOT NULL DEFAULT 0,
    day_15_plus_rate NUMERIC NOT NULL DEFAULT 0,
    effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expiry_date DATE,
    is_active BOOLEAN DEFAULT true,
    notes TEXT,
    source_document VARCHAR,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.demurrage_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "demurrage_rates_public_read" ON public.demurrage_rates
    FOR SELECT USING (true);

-- 2. TABLE WAREHOUSE FRANCHISE (Franchises PAD/Magasinage)
CREATE TABLE public.warehouse_franchise (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR NOT NULL DEFAULT 'PAD',
    cargo_type VARCHAR NOT NULL,
    container_type VARCHAR,
    free_days INTEGER NOT NULL DEFAULT 15,
    rate_per_day NUMERIC NOT NULL,
    rate_unit VARCHAR NOT NULL DEFAULT 'XOF/tonne/jour',
    storage_zone VARCHAR DEFAULT 'zone_ordinaire',
    effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expiry_date DATE,
    is_active BOOLEAN DEFAULT true,
    notes TEXT,
    source_document VARCHAR,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.warehouse_franchise ENABLE ROW LEVEL SECURITY;

CREATE POLICY "warehouse_franchise_public_read" ON public.warehouse_franchise
    FOR SELECT USING (true);

-- 3. TABLE HOLIDAYS PAD (Jours fériés pour calcul franchise)
CREATE TABLE public.holidays_pad (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    holiday_date DATE NOT NULL UNIQUE,
    name_fr VARCHAR NOT NULL,
    name_en VARCHAR,
    is_recurring BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.holidays_pad ENABLE ROW LEVEL SECURITY;

CREATE POLICY "holidays_pad_public_read" ON public.holidays_pad
    FOR SELECT USING (true);

-- =============================================
-- INSERTION DES DONNÉES RÉFÉRENTIELLES
-- =============================================

-- DEMURRAGE RATES - Principales compagnies maritimes à Dakar
INSERT INTO public.demurrage_rates (carrier, container_type, free_days_import, free_days_export, currency, day_1_7_rate, day_8_14_rate, day_15_plus_rate, notes, source_document) VALUES
-- MSC
('MSC', '20DV', 7, 5, 'USD', 50, 100, 150, 'Tarifs standards MSC Sénégal 2024', 'MSC Local Charges 2024'),
('MSC', '40DV', 7, 5, 'USD', 100, 200, 300, 'Tarifs standards MSC Sénégal 2024', 'MSC Local Charges 2024'),
('MSC', '40HC', 7, 5, 'USD', 100, 200, 300, 'Même tarif que 40DV', 'MSC Local Charges 2024'),
('MSC', '20RF', 5, 3, 'USD', 100, 200, 300, 'Reefer - franchise réduite', 'MSC Local Charges 2024'),
('MSC', '40RF', 5, 3, 'USD', 200, 400, 600, 'Reefer - franchise réduite', 'MSC Local Charges 2024'),
-- MAERSK
('MAERSK', '20DV', 7, 5, 'USD', 55, 110, 165, 'Tarifs Maersk West Africa 2024', 'Maersk Local Charges'),
('MAERSK', '40DV', 7, 5, 'USD', 110, 220, 330, 'Tarifs Maersk West Africa 2024', 'Maersk Local Charges'),
('MAERSK', '40HC', 7, 5, 'USD', 110, 220, 330, 'Même tarif que 40DV', 'Maersk Local Charges'),
('MAERSK', '20RF', 5, 3, 'USD', 120, 240, 360, 'Reefer - franchise réduite', 'Maersk Local Charges'),
('MAERSK', '40RF', 5, 3, 'USD', 240, 480, 720, 'Reefer - franchise réduite', 'Maersk Local Charges'),
-- CMA CGM
('CMA CGM', '20DV', 7, 5, 'USD', 52, 104, 156, 'Tarifs CMA CGM Dakar 2024', 'CMA CGM Local Charges'),
('CMA CGM', '40DV', 7, 5, 'USD', 104, 208, 312, 'Tarifs CMA CGM Dakar 2024', 'CMA CGM Local Charges'),
('CMA CGM', '40HC', 7, 5, 'USD', 104, 208, 312, 'Même tarif que 40DV', 'CMA CGM Local Charges'),
('CMA CGM', '20RF', 5, 3, 'USD', 110, 220, 330, 'Reefer - franchise réduite', 'CMA CGM Local Charges'),
('CMA CGM', '40RF', 5, 3, 'USD', 220, 440, 660, 'Reefer - franchise réduite', 'CMA CGM Local Charges'),
-- HAPAG-LLOYD
('HAPAG-LLOYD', '20DV', 7, 5, 'USD', 48, 96, 144, 'Tarifs Hapag-Lloyd 2024', 'hapag_lloyd_local_charges.pdf'),
('HAPAG-LLOYD', '40DV', 7, 5, 'USD', 96, 192, 288, 'Tarifs Hapag-Lloyd 2024', 'hapag_lloyd_local_charges.pdf'),
('HAPAG-LLOYD', '40HC', 7, 5, 'USD', 96, 192, 288, 'Même tarif que 40DV', 'hapag_lloyd_local_charges.pdf'),
('HAPAG-LLOYD', '20RF', 5, 3, 'USD', 105, 210, 315, 'Reefer - franchise réduite', 'hapag_lloyd_local_charges.pdf'),
('HAPAG-LLOYD', '40RF', 5, 3, 'USD', 210, 420, 630, 'Reefer - franchise réduite', 'hapag_lloyd_local_charges.pdf'),
-- ONE (Ocean Network Express)
('ONE', '20DV', 7, 5, 'USD', 50, 100, 150, 'Tarifs ONE Line 2024', 'one_line_local_charges.pdf'),
('ONE', '40DV', 7, 5, 'USD', 100, 200, 300, 'Tarifs ONE Line 2024', 'one_line_local_charges.pdf'),
('ONE', '40HC', 7, 5, 'USD', 100, 200, 300, 'Même tarif que 40DV', 'one_line_local_charges.pdf'),
-- COSCO
('COSCO', '20DV', 10, 7, 'USD', 45, 90, 135, 'COSCO offre franchise étendue', 'COSCO Local Charges'),
('COSCO', '40DV', 10, 7, 'USD', 90, 180, 270, 'COSCO offre franchise étendue', 'COSCO Local Charges'),
('COSCO', '40HC', 10, 7, 'USD', 90, 180, 270, 'Même tarif que 40DV', 'COSCO Local Charges'),
-- EVERGREEN
('EVERGREEN', '20DV', 7, 5, 'USD', 48, 96, 144, 'Tarifs Evergreen 2024', 'Evergreen Local Charges'),
('EVERGREEN', '40DV', 7, 5, 'USD', 96, 192, 288, 'Tarifs Evergreen 2024', 'Evergreen Local Charges'),
('EVERGREEN', '40HC', 7, 5, 'USD', 96, 192, 288, 'Même tarif que 40DV', 'Evergreen Local Charges');

-- WAREHOUSE FRANCHISE - Tarifs PAD/Magasinage Dakar
INSERT INTO public.warehouse_franchise (provider, cargo_type, container_type, free_days, rate_per_day, rate_unit, storage_zone, notes, source_document) VALUES
-- Conteneurs pleins - Zone ordinaire
('PAD', 'FCL', '20DV', 15, 5000, 'XOF/EVP/jour', 'zone_ordinaire', 'Franchise 15 jours calendaires hors fériés', 'Tarifs PAD 2024'),
('PAD', 'FCL', '40DV', 15, 10000, 'XOF/EVP/jour', 'zone_ordinaire', '40 pieds = 2 EVP', 'Tarifs PAD 2024'),
('PAD', 'FCL', '40HC', 15, 10000, 'XOF/EVP/jour', 'zone_ordinaire', '40HC = 2 EVP', 'Tarifs PAD 2024'),
-- Conteneurs reefer - Zone frigorifique
('PAD', 'FCL_REEFER', '20RF', 7, 15000, 'XOF/EVP/jour', 'zone_frigorifique', 'Franchise réduite reefer + branchement électrique', 'Tarifs PAD 2024'),
('PAD', 'FCL_REEFER', '40RF', 7, 30000, 'XOF/EVP/jour', 'zone_frigorifique', 'Franchise réduite reefer + branchement électrique', 'Tarifs PAD 2024'),
-- Conteneurs vides
('PAD', 'EMPTY', '20DV', 5, 2500, 'XOF/EVP/jour', 'zone_vides', 'Conteneurs vides - franchise courte', 'Tarifs PAD 2024'),
('PAD', 'EMPTY', '40DV', 5, 5000, 'XOF/EVP/jour', 'zone_vides', 'Conteneurs vides - franchise courte', 'Tarifs PAD 2024'),
-- Conventionnel / Breakbulk
('PAD', 'BREAKBULK', NULL, 10, 150, 'XOF/tonne/jour', 'zone_ordinaire', 'Marchandises conventionnelles', 'Tarifs PAD 2024'),
('PAD', 'BREAKBULK_LOURD', NULL, 10, 250, 'XOF/tonne/jour', 'zone_lourde', 'Colis lourds > 5 tonnes', 'Tarifs PAD 2024'),
-- Véhicules RORO
('PAD', 'VEHICLE_SMALL', NULL, 15, 3500, 'XOF/unité/jour', 'zone_roro', 'Véhicules < 3.5T (VP, pick-up)', 'Tarifs PAD 2024'),
('PAD', 'VEHICLE_MEDIUM', NULL, 15, 7500, 'XOF/unité/jour', 'zone_roro', 'Véhicules 3.5T - 10T (camionnettes)', 'Tarifs PAD 2024'),
('PAD', 'VEHICLE_HEAVY', NULL, 15, 15000, 'XOF/unité/jour', 'zone_roro', 'Véhicules > 10T (camions, engins)', 'Tarifs PAD 2024'),
-- Marchandises dangereuses
('PAD', 'IMO', NULL, 5, 500, 'XOF/tonne/jour', 'zone_imo', 'Marchandises IMO - franchise courte + zone séparée', 'Tarifs PAD 2024'),
-- DPW Terminal
('DPW', 'FCL', '20DV', 10, 6000, 'XOF/EVP/jour', 'terminal_dpw', 'Terminal DPW Dakar', 'DPW_TARIFS_2025_0001.pdf'),
('DPW', 'FCL', '40DV', 10, 12000, 'XOF/EVP/jour', 'terminal_dpw', 'Terminal DPW Dakar', 'DPW_TARIFS_2025_0001.pdf'),
('DPW', 'FCL', '40HC', 10, 12000, 'XOF/EVP/jour', 'terminal_dpw', 'Terminal DPW Dakar', 'DPW_TARIFS_2025_0001.pdf');

-- TARIFS RORO dans port_tariffs
INSERT INTO public.port_tariffs (provider, category, operation_type, classification, cargo_type, amount, unit, effective_date, source_document) VALUES
-- Manutention RORO - Véhicules légers
('DPW', 'RORO', 'DISCHARGE', 'vehicle_light', 'VP < 1.5T', 85000, 'XOF/unité', '2024-01-01', 'DPW_TARIFS_2025_0001.pdf'),
('DPW', 'RORO', 'DISCHARGE', 'vehicle_light', 'VP 1.5T - 3.5T', 125000, 'XOF/unité', '2024-01-01', 'DPW_TARIFS_2025_0001.pdf'),
('DPW', 'RORO', 'LOADING', 'vehicle_light', 'VP < 1.5T', 75000, 'XOF/unité', '2024-01-01', 'DPW_TARIFS_2025_0001.pdf'),
('DPW', 'RORO', 'LOADING', 'vehicle_light', 'VP 1.5T - 3.5T', 110000, 'XOF/unité', '2024-01-01', 'DPW_TARIFS_2025_0001.pdf'),
-- Manutention RORO - Camions et engins
('DPW', 'RORO', 'DISCHARGE', 'vehicle_heavy', 'Camion 3.5T - 10T', 185000, 'XOF/unité', '2024-01-01', 'DPW_TARIFS_2025_0001.pdf'),
('DPW', 'RORO', 'DISCHARGE', 'vehicle_heavy', 'Camion 10T - 20T', 285000, 'XOF/unité', '2024-01-01', 'DPW_TARIFS_2025_0001.pdf'),
('DPW', 'RORO', 'DISCHARGE', 'vehicle_heavy', 'Camion > 20T', 385000, 'XOF/unité', '2024-01-01', 'DPW_TARIFS_2025_0001.pdf'),
('DPW', 'RORO', 'DISCHARGE', 'vehicle_heavy', 'Engin de chantier', 450000, 'XOF/unité', '2024-01-01', 'DPW_TARIFS_2025_0001.pdf'),
('DPW', 'RORO', 'LOADING', 'vehicle_heavy', 'Camion 3.5T - 10T', 165000, 'XOF/unité', '2024-01-01', 'DPW_TARIFS_2025_0001.pdf'),
('DPW', 'RORO', 'LOADING', 'vehicle_heavy', 'Camion 10T - 20T', 255000, 'XOF/unité', '2024-01-01', 'DPW_TARIFS_2025_0001.pdf'),
('DPW', 'RORO', 'LOADING', 'vehicle_heavy', 'Camion > 20T', 345000, 'XOF/unité', '2024-01-01', 'DPW_TARIFS_2025_0001.pdf'),
-- Manutention Breakbulk / Conventionnel
('DPW', 'BREAKBULK', 'DISCHARGE', 'general_cargo', 'Marchandises diverses', 8500, 'XOF/tonne', '2024-01-01', 'DPW_TARIFS_2025_0001.pdf'),
('DPW', 'BREAKBULK', 'DISCHARGE', 'heavy_lift', 'Colis lourds 5-20T', 15000, 'XOF/tonne', '2024-01-01', 'DPW_TARIFS_2025_0001.pdf'),
('DPW', 'BREAKBULK', 'DISCHARGE', 'heavy_lift', 'Colis lourds > 20T', 25000, 'XOF/tonne', '2024-01-01', 'DPW_TARIFS_2025_0001.pdf'),
('DPW', 'BREAKBULK', 'DISCHARGE', 'steel_products', 'Acier / Fer', 7500, 'XOF/tonne', '2024-01-01', 'DPW_TARIFS_2025_0001.pdf'),
('DPW', 'BREAKBULK', 'DISCHARGE', 'timber', 'Bois / Grumes', 6500, 'XOF/tonne', '2024-01-01', 'DPW_TARIFS_2025_0001.pdf'),
('DPW', 'BREAKBULK', 'LOADING', 'general_cargo', 'Marchandises diverses', 7500, 'XOF/tonne', '2024-01-01', 'DPW_TARIFS_2025_0001.pdf');

-- HOLIDAYS PAD - Jours fériés Sénégal 2024-2026
INSERT INTO public.holidays_pad (holiday_date, name_fr, name_en, is_recurring) VALUES
-- Fêtes fixes (récurrentes)
('2024-01-01', 'Jour de l''An', 'New Year''s Day', true),
('2024-04-04', 'Fête de l''Indépendance', 'Independence Day', true),
('2024-05-01', 'Fête du Travail', 'Labour Day', true),
('2024-08-15', 'Assomption', 'Assumption', true),
('2024-11-01', 'Toussaint', 'All Saints Day', true),
('2024-12-25', 'Noël', 'Christmas', true),
-- Fêtes musulmanes 2024 (dates approximatives)
('2024-04-10', 'Eid al-Fitr (Korité)', 'Eid al-Fitr', false),
('2024-04-11', 'Eid al-Fitr (Korité) J2', 'Eid al-Fitr Day 2', false),
('2024-06-17', 'Eid al-Adha (Tabaski)', 'Eid al-Adha', false),
('2024-06-18', 'Eid al-Adha (Tabaski) J2', 'Eid al-Adha Day 2', false),
('2024-07-07', 'Nouvel An Musulman', 'Islamic New Year', false),
('2024-09-16', 'Mawlid (Gamou)', 'Prophet''s Birthday', false),
('2024-10-17', 'Grand Magal de Touba', 'Grand Magal', false),
-- Fêtes fixes 2025
('2025-01-01', 'Jour de l''An', 'New Year''s Day', false),
('2025-04-04', 'Fête de l''Indépendance', 'Independence Day', false),
('2025-05-01', 'Fête du Travail', 'Labour Day', false),
('2025-08-15', 'Assomption', 'Assumption', false),
('2025-11-01', 'Toussaint', 'All Saints Day', false),
('2025-12-25', 'Noël', 'Christmas', false),
-- Fêtes musulmanes 2025 (dates approximatives)
('2025-03-30', 'Eid al-Fitr (Korité)', 'Eid al-Fitr', false),
('2025-03-31', 'Eid al-Fitr (Korité) J2', 'Eid al-Fitr Day 2', false),
('2025-06-07', 'Eid al-Adha (Tabaski)', 'Eid al-Adha', false),
('2025-06-08', 'Eid al-Adha (Tabaski) J2', 'Eid al-Adha Day 2', false),
('2025-06-27', 'Nouvel An Musulman', 'Islamic New Year', false),
('2025-09-05', 'Mawlid (Gamou)', 'Prophet''s Birthday', false),
('2025-10-06', 'Grand Magal de Touba', 'Grand Magal', false),
-- Fêtes fixes 2026
('2026-01-01', 'Jour de l''An', 'New Year''s Day', false),
('2026-04-04', 'Fête de l''Indépendance', 'Independence Day', false),
('2026-05-01', 'Fête du Travail', 'Labour Day', false),
('2026-08-15', 'Assomption', 'Assumption', false),
('2026-11-01', 'Toussaint', 'All Saints Day', false),
('2026-12-25', 'Noël', 'Christmas', false),
-- Fêtes musulmanes 2026 (dates approximatives)
('2026-03-20', 'Eid al-Fitr (Korité)', 'Eid al-Fitr', false),
('2026-03-21', 'Eid al-Fitr (Korité) J2', 'Eid al-Fitr Day 2', false),
('2026-05-27', 'Eid al-Adha (Tabaski)', 'Eid al-Adha', false),
('2026-05-28', 'Eid al-Adha (Tabaski) J2', 'Eid al-Adha Day 2', false),
('2026-06-17', 'Nouvel An Musulman', 'Islamic New Year', false),
('2026-08-25', 'Mawlid (Gamou)', 'Prophet''s Birthday', false),
('2026-09-26', 'Grand Magal de Touba', 'Grand Magal', false);