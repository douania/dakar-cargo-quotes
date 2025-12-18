-- Add category and keywords columns for AI regime suggestion
ALTER TABLE public.customs_regimes 
ADD COLUMN IF NOT EXISTS category VARCHAR(1) DEFAULT 'C',
ADD COLUMN IF NOT EXISTS keywords TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS use_case TEXT;

-- Update regime descriptions and add keywords for intelligent matching
-- C1XX - Mise à la consommation suite importation directe
UPDATE public.customs_regimes SET 
  category = 'C',
  name = 'MISE A LA CONSOMMATION EN SUITE IMPORTATION DIRECTE PNP',
  use_case = 'Importation définitive de produits non pétroliers pour mise en consommation locale',
  keywords = ARRAY['importation', 'directe', 'consommation', 'PNP', 'standard', 'normale', 'régime commun']
WHERE code = '1700';

UPDATE public.customs_regimes SET 
  category = 'C',
  name = 'MISE CONSOMMATION AVEC RESTITUTION DE DROITS PERÇUS PRIME AB',
  use_case = 'Importation avec restitution de droits pour réexportation',
  keywords = ARRAY['restitution', 'droits', 'prime', 'AB']
WHERE code = '1701';

UPDATE public.customs_regimes SET 
  category = 'C',
  name = 'MISE A LA CONSOMMATION DE PNP (DRAWBACK) SUITE IMP.DIRECTE',
  use_case = 'Régime drawback pour importation de matières premières transformées puis réexportées',
  keywords = ARRAY['drawback', 'transformation', 'réexportation', 'matières premières']
WHERE code = '1702';

UPDATE public.customs_regimes SET 
  category = 'C',
  name = 'MISE CONSOMMATION SUITE IMPORT DIRECTE DONS AIDES A L''ETAT',
  use_case = 'Dons et aides destinés à l''État sénégalais',
  keywords = ARRAY['dons', 'aides', 'état', 'gouvernement', 'humanitaire']
WHERE code = '1711';

UPDATE public.customs_regimes SET 
  category = 'C',
  name = 'MISE CONSOMMATION SUITE IMPORT DIRECTE DONS A CROIX ROUGE',
  use_case = 'Dons pour la Croix-Rouge et œuvres de bienfaisance',
  keywords = ARRAY['croix-rouge', 'bienfaisance', 'humanitaire', 'ONG', 'charitable']
WHERE code = '1712';

UPDATE public.customs_regimes SET 
  category = 'C',
  name = 'MISE CONSOMMATION DONS AIDES A CARACTERE SOCIAL PNP',
  use_case = 'Dons à caractère social ou culturel',
  keywords = ARRAY['social', 'culturel', 'dons', 'aides', 'ONG']
WHERE code = '1713';

UPDATE public.customs_regimes SET 
  category = 'C',
  name = 'MISE CONSOMMATION FRANCHISE EXCEPTIONNELLE SUITE IMP DIRECTE',
  use_case = 'Franchise exceptionnelle accordée par décision spéciale',
  keywords = ARRAY['franchise', 'exceptionnelle', 'exonération', 'spéciale']
WHERE code = '1721';

UPDATE public.customs_regimes SET 
  category = 'C',
  name = 'FRANCHISE CONDITIONNELLE SUITE IMPORTATION DIRECTE DE PNP',
  use_case = 'Franchise conditionnelle avec engagement spécifique',
  keywords = ARRAY['franchise', 'conditionnelle', 'engagement']
WHERE code = '1722';

UPDATE public.customs_regimes SET 
  category = 'C',
  name = 'DEMENAGEMENTS',
  use_case = 'Effets de déménagement pour particuliers',
  keywords = ARRAY['déménagement', 'effets personnels', 'particulier', 'retour', 'expatrié']
WHERE code = '1723';

UPDATE public.customs_regimes SET 
  category = 'C',
  name = 'EFFETS PERSONNELS',
  use_case = 'Effets personnels des voyageurs',
  keywords = ARRAY['effets personnels', 'voyageur', 'particulier', 'bagages']
WHERE code = '1724';

UPDATE public.customs_regimes SET 
  category = 'C',
  name = 'REIMPORTATION MARCH.SENEGAL DEFECT.OU NON CONF A COMMANDE',
  use_case = 'Réimportation de marchandises défectueuses ou non conformes',
  keywords = ARRAY['réimportation', 'défectueux', 'non conforme', 'retour', 'réclamation']
WHERE code = '1725';

UPDATE public.customs_regimes SET 
  category = 'C',
  name = 'DECLARATION ENLEVEMENT SPECIAL (D.E.S) YOFF',
  use_case = 'Déclaration enlèvement spécial aéroport Yoff',
  keywords = ARRAY['DES', 'aéroport', 'Yoff', 'enlèvement', 'spécial', 'aérien']
WHERE code = '1726';

UPDATE public.customs_regimes SET 
  category = 'C',
  name = 'FRANCHISE TOTALE AU TITRE DU CODE DES INVESTISSEMENTS',
  use_case = 'Investissement agréé avec franchise totale',
  keywords = ARRAY['investissement', 'code investissement', 'franchise totale', 'agréé', 'exonération']
WHERE code = '1731';

UPDATE public.customs_regimes SET 
  category = 'C',
  name = 'IAL - IMPORTATION AVANT LIQUIDATION',
  use_case = 'Importation avant liquidation pour entreprises en difficulté',
  keywords = ARRAY['IAL', 'liquidation', 'entreprise']
WHERE code = '1732';

UPDATE public.customs_regimes SET 
  category = 'C',
  name = 'REGIME STABILISE',
  use_case = 'Régime fiscal stabilisé pour investisseurs',
  keywords = ARRAY['stabilisé', 'fiscal', 'investissement', 'convention']
WHERE code = '1733';

UPDATE public.customs_regimes SET 
  category = 'C',
  name = 'EXONERATION PARTIELLE TVA SUITE IMPORTATION DIRECTE PNP',
  use_case = 'Exonération partielle de TVA uniquement',
  keywords = ARRAY['TVA', 'exonération partielle', 'taxe']
WHERE code = '1734';

UPDATE public.customs_regimes SET 
  category = 'C',
  name = 'SUSPENSION PROVISOIRE DES DROITS ET TAXES',
  use_case = 'Suspension temporaire des droits pour situation exceptionnelle',
  keywords = ARRAY['suspension', 'provisoire', 'temporaire', 'crise']
WHERE code = '1738';

UPDATE public.customs_regimes SET 
  category = 'C',
  name = 'MISE A CONSOMMATION DS LE CADRE NOUVEAU CODE INVESTISSEMENT',
  use_case = 'Nouveau code des investissements 2021',
  keywords = ARRAY['nouveau code', 'investissement', '2021', 'agréé']
WHERE code = '1739';

UPDATE public.customs_regimes SET 
  category = 'C',
  name = 'PRIVILEGE DIPLOMATIQUE',
  use_case = 'Franchise diplomatique pour ambassades et missions',
  keywords = ARRAY['diplomatique', 'ambassade', 'mission', 'consul', 'immunité']
WHERE code = '1740';

UPDATE public.customs_regimes SET 
  category = 'C',
  name = 'LIQUIDATION SUPPLEMENTAIRE',
  use_case = 'Régularisation de droits insuffisamment perçus',
  keywords = ARRAY['liquidation', 'supplémentaire', 'régularisation', 'redressement']
WHERE code = '1790';

-- C2XX - Mise à la consommation PP (Produits Pétroliers)
UPDATE public.customs_regimes SET 
  category = 'C',
  name = 'MISE A LA CONSOMMATION SUITE IMPORT DIRECTE COMMUN PP',
  use_case = 'Importation directe de produits pétroliers',
  keywords = ARRAY['pétrole', 'pétrolier', 'carburant', 'hydrocarbures', 'PP']
WHERE code = '2001';

UPDATE public.customs_regimes SET 
  category = 'C',
  name = 'MISE A LA CONSOMMATION SUITE IMPORT.DIRECTE DE PP/AVAL SAR',
  use_case = 'Produits pétroliers raffinerie SAR',
  keywords = ARRAY['SAR', 'raffinerie', 'pétrole', 'pétrolier']
WHERE code = '2002';

-- C3XX - Suite entrepôt
UPDATE public.customs_regimes SET 
  category = 'C',
  name = 'MISE A LA CONSOMMATION EN SUITE D''ENTREPOT PNP',
  use_case = 'Sortie d''entrepôt pour mise à la consommation',
  keywords = ARRAY['entrepôt', 'stockage', 'sortie', 'PNP']
WHERE code = '3000';

UPDATE public.customs_regimes SET 
  category = 'C',
  name = 'MISE A LA CONSOMMATION EN SUITE D''ENTREPOT APRES AT',
  use_case = 'Sortie entrepôt après admission temporaire',
  keywords = ARRAY['entrepôt', 'admission temporaire', 'AT', 'transformation']
WHERE code = '3002';

-- S - Régimes suspensifs
UPDATE public.customs_regimes SET 
  category = 'S',
  name = 'TRANSIT ORDINAIRE SUITE IMPORTATION DIRECTE',
  use_case = 'Transit vers pays tiers (Mali, Burkina, etc.)',
  keywords = ARRAY['transit', 'passage', 'Mali', 'Burkina', 'corridor', 'tiers']
WHERE code = '1110';

UPDATE public.customs_regimes SET 
  category = 'S',
  name = 'TRANSIT INTERNATIONAL (TRIE)',
  use_case = 'Transit international routier interétatique',
  keywords = ARRAY['TRIE', 'international', 'routier', 'interétatique', 'transit']
WHERE code = '1120';

UPDATE public.customs_regimes SET 
  category = 'S',
  name = 'ENTREE EN ENTREPOT FICTIF PRIVE',
  use_case = 'Stockage sous douane en entrepôt privé',
  keywords = ARRAY['entrepôt', 'privé', 'stockage', 'suspensif']
WHERE code = '3300';

UPDATE public.customs_regimes SET 
  category = 'S',
  name = 'ENTREE EN ENTREPOT PUBLIC',
  use_case = 'Stockage sous douane en entrepôt public',
  keywords = ARRAY['entrepôt', 'public', 'stockage', 'MTTA']
WHERE code = '3310';

UPDATE public.customs_regimes SET 
  category = 'S',
  name = 'ENTREE EN ENTREPOT INDUSTRIEL',
  use_case = 'Entrepôt industriel pour transformation',
  keywords = ARRAY['entrepôt', 'industriel', 'transformation', 'usine']
WHERE code = '3320';

UPDATE public.customs_regimes SET 
  category = 'S',
  name = 'ADMISSION TEMPORAIRE SPECIALE',
  use_case = 'Admission temporaire pour ouvraison ou transformation',
  keywords = ARRAY['admission temporaire', 'AT', 'ouvraison', 'transformation', 'perfectionnement']
WHERE code = '5010';

UPDATE public.customs_regimes SET 
  category = 'S',
  name = 'ADMISSION TEMPORAIRE EXCEPTIONNELLE',
  use_case = 'Admission temporaire pour matériel ou équipement',
  keywords = ARRAY['admission temporaire', 'exceptionnelle', 'matériel', 'équipement', 'chantier']
WHERE code = '5020';

UPDATE public.customs_regimes SET 
  category = 'S',
  name = 'AT POUR PERFECTIONNEMENT ACTIF',
  use_case = 'Transformation de matières premières pour réexportation',
  keywords = ARRAY['perfectionnement actif', 'transformation', 'export', 'matières premières']
WHERE code = '5030';

UPDATE public.customs_regimes SET 
  category = 'S',
  name = 'IMPORTATION TEMPORAIRE',
  use_case = 'Importation temporaire de biens réexportés en l''état',
  keywords = ARRAY['importation temporaire', 'réexportation', 'exposition', 'foire', 'salon']
WHERE code = '6000';

UPDATE public.customs_regimes SET 
  category = 'S',
  name = 'ENTREE EN ZES SUITE IMPORTATION DIRECTE',
  use_case = 'Zone économique spéciale',
  keywords = ARRAY['ZES', 'zone économique', 'spéciale', 'Diamniadio']
WHERE code = '7000';

UPDATE public.customs_regimes SET 
  category = 'S',
  name = 'ENTREE EN ZONE FRANCHE INDUSTRIELLE',
  use_case = 'Zone franche industrielle de Dakar',
  keywords = ARRAY['zone franche', 'ZFID', 'industrielle', 'Dakar']
WHERE code = '9330';

UPDATE public.customs_regimes SET 
  category = 'S',
  name = 'ENTREE EN ENTREPRISE FRANCHE D''EXPORTATION',
  use_case = 'Entreprise franche exportatrice',
  keywords = ARRAY['entreprise franche', 'EFE', 'exportation', 'franche']
WHERE code = '9351';

-- R - Réexportation
UPDATE public.customs_regimes SET 
  category = 'R',
  name = 'REEXPORTATION EN SUITE DE DEPOT',
  use_case = 'Réexportation de marchandises non dédouanées',
  keywords = ARRAY['réexportation', 'dépôt', 'retour']
WHERE code = '1000';

UPDATE public.customs_regimes SET 
  category = 'R',
  name = 'REEXPORTATION SUITE ENTREPOT',
  use_case = 'Réexportation depuis entrepôt sous douane',
  keywords = ARRAY['réexportation', 'entrepôt', 'transit']
WHERE code = '3080';

-- E - Exportation  
UPDATE public.customs_regimes SET 
  category = 'E',
  name = 'EXPORTATION SIMPLE SORTIE SANS RESTITUTION',
  use_case = 'Export définitif de produits sénégalais',
  keywords = ARRAY['exportation', 'sortie', 'définitive', 'sénégalais', 'origine']
WHERE code = '1100';

UPDATE public.customs_regimes SET 
  category = 'E',
  name = 'EXPORTATION EN DRAWBACK',
  use_case = 'Exportation avec remboursement des droits sur intrants',
  keywords = ARRAY['drawback', 'remboursement', 'intrants', 'export']
WHERE code = '1102';

UPDATE public.customs_regimes SET 
  category = 'E',
  name = 'EXPORTATION TEMPORAIRE',
  use_case = 'Exportation temporaire pour réparation ou exposition',
  keywords = ARRAY['exportation temporaire', 'réparation', 'exposition', 'retour']
WHERE code = '8000';