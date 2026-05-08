-- PAD-NST-2E-B-R2 — Migration corrective finale
-- Généré automatiquement par pad_nst_2e_b_r2_corrective.py
-- NE PAS MODIFIER MANUELLEMENT
-- Sources : pad_nst_2e_rule_candidates.csv + pad_nst_2e_audit_results.csv
-- Filtres : action NOT IN (defer, remove), audit_tier IN (TIER-A, TIER-B)
-- Règles générées : 88

DO $$
DECLARE
  v_expected INTEGER;
  v_count INTEGER;
  v_bad_status INTEGER;
  v_bad_validation INTEGER;
  v_bad_active INTEGER;
  v_bad_evidence INTEGER;
  v_min_conf NUMERIC;
  v_max_conf NUMERIC;
  v_extra INTEGER;
  v_missing INTEGER;
BEGIN

  -- ============ PHASE 1: TABLE TEMPORAIRE expected_rules ============

  CREATE TEMP TABLE expected_rules (
    nst_level text NOT NULL,
    nst_code text NOT NULL,
    pad_category text NOT NULL,
    confidence numeric NOT NULL,
    evidence_level text NOT NULL,
    validation_status text NOT NULL,
    notes text,
    source_document text,
    source_reference text,
    requires_operator_validation boolean NOT NULL,
    is_active boolean NOT NULL
  ) ON COMMIT DROP;

  -- Rule 1/88: division|01|P05
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'division', '01', 'P05',
    0.5, 'expert_rule',
    'candidate', 'Division 01 inclut ''fish and other fishing products'' (groupe 01.B). P05 = produits de peche NDA, categorie par defaut pour la peche non specifiee. Conflit avec T02/T03/T05 pour les produits agricoles non-peche. | [AUDIT-R1] P05 pertinent uniquement pour le sous-groupe peche (01.B). La division est trop large pour un seul PAD. Conserver comme candidat secondaire peche.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 2/88: division|02|T07
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'division', '02', 'T07',
    0.5, 'expert_rule',
    'candidate', 'Division 02 inclut charbon et lignite (02.1). T07 = clinker, farine, charbon, sable et vracs pondereux. Le charbon est explicitement dans le label T07. Candidate secondaire derriere T11 pour les hydrocarbures liquides. | [AUDIT-R1] T07 pertinent pour le charbon (02.1) mais pas pour le pétrole (02.2) ni le gaz (02.3). Division trop hétérogène. Conserver comme candidat secondaire charbon.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 3/88: division|02|T11
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'division', '02', 'T11',
    0.55, 'expert_rule',
    'candidate', 'Division 02 = charbon, petrole brut, gaz naturel. T11 = petrole brut, essences, bitumes, hydrocarbures raffines. Le petrole brut (02.2) correspond directement a T11. Le charbon (02.1) pourrait relever de T07 (charbon, vracs pondereux). Confidence moyenne car charbon et gaz creent une ambiguite. | [AUDIT-R1] T11 pertinent pour pétrole brut (02.2) mais pas pour charbon (02.1). Les groupes 02.x ont des règles plus précises. Conserver car le pétrole domine le trafic.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 4/88: division|03|T03
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'division', '03', 'T03',
    0.5, 'expert_rule',
    'candidate', 'Division 03 = minerais metalliques, produits miniers. T03 = acides, sucres et matieres premieres. Les minerais sont des matieres premieres brutes. Ambiguite avec T08 (phosphates, ferrailles) pour certains minerais specifiques. | [AUDIT-R1] T03 ''matières premières'' pertinent pour minerais (03.1, 03.2) mais la division inclut aussi sel (T10), sable (T07), phosphates (T08). Trop large.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 5/88: division|03|T08
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'division', '03', 'T08',
    0.45, 'expert_rule',
    'candidate', 'Division 03 inclut les mineraux fertilisants (03.3) et le sel (03.4). T08 = attapulgite, phosphates, ferrailles, tourteaux, cellulose. Les phosphates et mineraux fertilisants correspondent a T08. Candidate secondaire. | [AUDIT-R1] T08 pertinent pour phosphates (03.3) uniquement. Confidence baissée car secondaire au niveau division. Les groupes 03.x sont plus précis.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 6/88: division|04|T02
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'division', '04', 'T02',
    0.5, 'expert_rule',
    'candidate', 'Division 04 = produits alimentaires, boissons, tabac. T02 = marchandises generales. Les denrees alimentaires transformees sont classees marchandises generales dans la pratique PAD Dakar. Ambiguite avec T01 pour les boissons alcoolisees (alias PAD existant sous T01) et T05 pour les farines/cereales transformees. | [AUDIT-R1] T02 par défaut pour les denrées alimentaires transformées. Ambiguïté avec T01 (boissons alcoolisées), T05 (farines/céréales). Accepté comme candidat principal par défaut.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 7/88: division|05|T12
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'division', '05', 'T12',
    0.55, 'expert_rule',
    'candidate', 'Division 05 = textiles, cuir. T12 = materiaux et produits manufactures. Les textiles et articles en cuir sont des produits manufactures au sens PAD. Ambiguite possible avec T02 (marchandises generales) pour les textiles bruts. | [AUDIT-R1] T12 pertinent pour textiles et cuir manufacturés. Confidence acceptable au niveau division. Cohérent avec les règles group-level 05.x→T12.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 8/88: division|06|T04
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'division', '06', 'T04',
    0.75, 'expert_rule',
    'candidate', 'Division 06 = bois, liege, papier. T04 = bois et produits divers. Le bois et ses derives correspondent directement au label T04. Confidence raisonnable car le label PAD est explicite. | [AUDIT-R1] Match direct : label PAD T04 = ''Bois et produits divers''. Division 06 = bois, liège, papier. Le bois est explicitement dans le label T04.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 9/88: division|07|T11
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'division', '07', 'T11',
    0.75, 'expert_rule',
    'candidate', 'Division 07 = coke et produits petroliers raffines. T11 = petrole brut, essences, bitumes, hydrocarbures raffines. Correspondance directe entre produits petroliers raffines et le label T11. Meilleur match division-level du manifeste. | [AUDIT-R1] Match direct : label PAD T11 = ''Pétrole brut, essences, bitumes, hydrocarbures raffinés''. Division 07 = produits pétroliers raffinés. Correspondance explicite.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 10/88: division|08|T03
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'division', '08', 'T03',
    0.45, 'expert_rule',
    'candidate', 'Division 08 = chimie, plastiques, caoutchouc, combustible nucleaire. T03 = acides, sucres et matieres premieres. Les produits chimiques de base (acides) correspondent a T03. Forte ambiguite : la division couvre aussi les plastiques (T12), les engrais (T08), les produits pharmaceutiques (T02). | [AUDIT-R1] T03 pertinent pour chimie de base (08.1) mais la division couvre aussi plastiques (T12), engrais (T08), pharma (T01). Confidence baissée car trop hétérogène.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 11/88: division|09|T05
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'division', '09', 'T05',
    0.45, 'expert_rule',
    'candidate', 'Division 09 inclut ciment, chaux, platre (09.2). T05 = cereales, ciment, riz et produits assimiles. Le ciment est explicitement dans le label T05. Candidate secondaire, depend du produit exact. | [AUDIT-R1] T05 pertinent pour ciment fini (09.2) mais pas pour verre/céramique. Confidence baissée. Le conflit T05/T07 pour le ciment doit être résolu au group-level.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 12/88: division|09|T07
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'division', '09', 'T07',
    0.55, 'expert_rule',
    'candidate', 'Division 09 = produits mineraux non metalliques. T07 = clinker, farine, charbon, sable et vracs pondereux. Le ciment (09.2), le sable, le clinker sont dans T07. Ambiguite avec T12 pour les produits mineraux manufactures (verre, ceramique). | [AUDIT-R1] T07 pertinent pour clinker, sable, matériaux de carrière. Plus large que T05 pour cette division. Conflit ciment/clinker documenté.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 13/88: division|10|T12
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'division', '10', 'T12',
    0.5, 'expert_rule',
    'candidate', 'Division 10 inclut les produits metalliques fabriques (10.3-10.5). T12 = materiaux et produits manufactures. Les tubes, profiles, produits metalliques structurels sont des produits manufactures. Candidate secondaire. | [AUDIT-R1] T12 pertinent pour produits métalliques fabriqués (10.3-10.5). Accepté comme candidat secondaire derrière T14.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 14/88: division|10|T14
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'division', '10', 'T14',
    0.7, 'expert_rule',
    'candidate', 'Division 10 = metaux de base, produits metalliques. T14 = fil machine et feuillard. Les produits de premiere transformation (10.1) correspondent a T14. Ambiguite avec T12 pour les produits metalliques fabriques et T08 pour les ferrailles. | [AUDIT-R1] Match direct : label PAD T14 = ''Fil machine et feuillard''. Division 10 = métaux de base. Le fil machine est un produit de première transformation.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 15/88: division|11|T01
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'division', '11', 'T01',
    0.55, 'expert_rule',
    'candidate', 'Division 11 = machines, equipements, informatique, electronique. T01 = biens de valeur, electronique, informatique et mobilier. L''informatique et l''electronique sont explicitement dans le label T01. Ambiguite avec T09 pour les machines industrielles et T12 pour les appareils menagers. | [AUDIT-R1] T01 pertinent pour informatique et électronique (11.3-11.7) mais pas pour machines industrielles (11.1, 11.8). Division hétérogène.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 16/88: division|12|T09
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'division', '12', 'T09',
    0.75, 'expert_rule',
    'candidate', 'Division 12 = materiel de transport. T09 = tracteurs, vehicules industriels et materiel de transport. Correspondance directe entre ''transport equipment'' et le label T09. | [AUDIT-R1] Match direct : label PAD T09 = ''Tracteurs, véhicules industriels et matériel de transport''. Division 12 = matériel de transport.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 17/88: division|13|T01
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'division', '13', 'T01',
    0.7, 'expert_rule',
    'candidate', 'Division 13 = meubles et autres produits manufactures. T01 = biens de valeur, electronique, informatique et mobilier. Le mobilier est explicitement dans le label T01. Ambiguite avec T12 pour les ''autres produits manufactures''. | [AUDIT-R1] Match direct : label PAD T01 mentionne ''mobilier''. Division 13 = meubles et autres produits manufacturés.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 18/88: division|13|T12
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'division', '13', 'T12',
    0.5, 'expert_rule',
    'candidate', 'Division 13 inclut ''other manufactured goods'' (13.2). T12 = materiaux et produits manufactures. Les produits manufactures divers relevent de T12. Candidate secondaire. | [AUDIT-R1] T12 pertinent pour ''autres produits manufacturés'' (13.2). Candidat secondaire cohérent.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 19/88: division|14|T08
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'division', '14', 'T08',
    0.5, 'expert_rule',
    'candidate', 'Division 14 = matieres premieres secondaires, dechets. T08 = attapulgite, phosphates, ferrailles, tourteaux, cellulose. Les ferrailles et dechets metalliques secondaires correspondent a T08. Ambiguite car les dechets municipaux (14.1) ne correspondent a aucune categorie PAD claire. | [AUDIT-R1] T08 ferrailles pertinent pour matières premières secondaires mais pas pour déchets municipaux. Confidence baissée.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 20/88: group|01.1|T05
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '01.1', 'T05',
    0.85, 'expert_rule',
    'candidate', 'Cereales -> T05 : le label PAD T05 mentionne explicitement ''cereales, ciment, riz''. Match direct entre le groupe NST et le label PAD. | [AUDIT-R1] Map direct PAD T05 ''Céréales''.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T05 = ''Cereales, ciment, riz et produits assimiles''', true, true
  );

END $$;