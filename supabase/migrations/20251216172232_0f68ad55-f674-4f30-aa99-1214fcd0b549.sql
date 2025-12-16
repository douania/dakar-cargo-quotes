-- Table des codes du Système Harmonisé (TEC UEMOA/CEDEAO)
CREATE TABLE hs_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(15) NOT NULL UNIQUE,
  code_normalized VARCHAR(10) NOT NULL,
  
  -- Droits de douane et taxes communautaires
  dd DECIMAL(5,2) NOT NULL DEFAULT 0,
  surtaxe DECIMAL(5,2) DEFAULT 0,
  rs DECIMAL(5,2) NOT NULL DEFAULT 1,
  pcs DECIMAL(5,2) NOT NULL DEFAULT 0.8,
  pcc DECIMAL(5,2) NOT NULL DEFAULT 0.5,
  cosec DECIMAL(5,2) NOT NULL DEFAULT 0.4,
  uemoa DECIMAL(5,2) DEFAULT 5,
  
  -- Taxes intérieures
  tin DECIMAL(5,2) DEFAULT 0,
  tva DECIMAL(5,2) NOT NULL DEFAULT 18,
  tev DECIMAL(5,2) DEFAULT 0,
  ta DECIMAL(5,2) DEFAULT 0,
  
  -- Taxes spéciales
  t_past DECIMAL(5,2) DEFAULT 0,
  t_para DECIMAL(5,2) DEFAULT 0,
  t_conj DECIMAL(5,2) DEFAULT 0,
  t_ciment DECIMAL(5,2) DEFAULT 0,
  ref DECIMAL(15,2) DEFAULT 0,
  
  -- Flags
  bic BOOLEAN DEFAULT TRUE,
  mercurialis BOOLEAN DEFAULT FALSE,
  
  -- Métadonnées
  description TEXT,
  chapter INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour recherche rapide
CREATE INDEX idx_hs_codes_code ON hs_codes(code);
CREATE INDEX idx_hs_codes_normalized ON hs_codes(code_normalized);
CREATE INDEX idx_hs_codes_chapter ON hs_codes(chapter);
CREATE INDEX idx_hs_codes_dd ON hs_codes(dd);

-- Table des taux de taxes généraux (modifiables)
CREATE TABLE tax_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  rate DECIMAL(5,2) NOT NULL,
  base_calculation TEXT NOT NULL,
  applies_to TEXT,
  exemptions TEXT,
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insertion des taux de taxes actuels
INSERT INTO tax_rates (code, name, rate, base_calculation, applies_to, exemptions, effective_date) VALUES
('RS', 'Redevance Statistique', 1.0, 'Valeur CAF', 'Toutes importations', NULL, '2024-01-01'),
('PCS', 'Prélèvement Communautaire de Solidarité', 0.8, 'Valeur CAF', 'Toutes importations', NULL, '2024-01-01'),
('PCC', 'Prélèvement CEDEAO', 0.5, 'Valeur CAF', 'Importations hors CEDEAO', 'Produits originaires CEDEAO', '2024-01-01'),
('COSEC', 'Conseil Sénégalais des Chargeurs', 0.4, 'Valeur CAF', 'Toutes importations maritimes', NULL, '2024-01-01'),
('PROMAD', 'Programme Modernisation Douanes', 2.0, 'Valeur CAF', 'Si applicable', 'Riz, blé, médicaments', '2024-01-01'),
('TVA', 'Taxe sur la Valeur Ajoutée', 18.0, 'CAF + DD + RS + Taxes Int.', 'Standard', 'Produits exonérés (cat. 0)', '2024-01-01'),
('BIC', 'Acompte Bénéfice Industriel et Commercial', 3.0, 'CAF + DD + RS + Taxes Int.', 'Importateurs non CGE', 'Entreprises CGE', '2024-01-01');

-- Enable RLS
ALTER TABLE hs_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_rates ENABLE ROW LEVEL SECURITY;

-- Policies for public read access (these are reference tables)
CREATE POLICY "hs_codes_public_read" ON hs_codes FOR SELECT USING (true);
CREATE POLICY "tax_rates_public_read" ON tax_rates FOR SELECT USING (true);

-- Enable realtime for updates
ALTER PUBLICATION supabase_realtime ADD TABLE hs_codes;
ALTER PUBLICATION supabase_realtime ADD TABLE tax_rates;