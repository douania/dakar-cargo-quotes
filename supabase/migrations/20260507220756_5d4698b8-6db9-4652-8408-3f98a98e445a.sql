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
    'candidate', 'Cereales -> T05 : le label PAD T05 mentionne explicitement ''cereales, ciment, riz''. Match direct entre le groupe NST et le label PAD. | [AUDIT-R1] Match direct : label PAD T05 = ''Céréales, ciment, riz et produits assimilés''. Céréales explicitement nommées.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T05 = ''Cereales, ciment, riz et produits assimiles''', true, true
  );

  -- Rule 21/88: group|01.2|T02
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '01.2', 'T02',
    0.5, 'expert_rule',
    'candidate', 'Pommes de terre -> T02 : produit agricole frais, classe marchandises generales en l''absence d''alias PAD specifique. Pas de categorie PAD dediee aux tubercules. | [AUDIT-R1] Produit agricole frais sans catégorie PAD dédiée. T02 par défaut acceptable.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 22/88: group|01.3|T03
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '01.3', 'T03',
    0.5, 'expert_rule',
    'candidate', 'Legumes et fruits frais -> T03 : matieres premieres agricoles fraiches. T03 = acides, sucres et matieres premieres, inclut les produits agricoles bruts non transformes. | [AUDIT-R1] T03 ''matières premières'' acceptable pour fruits/légumes frais mais confiance faible. Pas de catégorie PAD dédiée produits frais.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 23/88: group|01.4|T02
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '01.4', 'T02',
    0.55, 'expert_rule',
    'candidate', 'Fleurs et plantes -> T02 : marchandises generales. Pas de categorie PAD dediee aux plantes. T02 est le classement par defaut pour les produits agricoles non-cereales/non-peche. | [AUDIT-R1] Produit agricole sans catégorie PAD dédiée. T02 par défaut cohérent.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 24/88: group|01.5|T04
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '01.5', 'T04',
    0.8, 'expert_rule',
    'candidate', 'Bois brut -> T04 : le label PAD T04 mentionne ''bois et produits divers''. Le bois brut non transforme correspond directement a T04. | [AUDIT-R1] Match direct : label PAD T04 = ''Bois et produits divers''. Bois brut explicitement couvert.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 25/88: group|01.6|T02
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '01.6', 'T02',
    0.55, 'expert_rule',
    'candidate', 'Animaux vivants -> T02 : pas de categorie PAD specifique pour le betail. T02 marchandises generales par defaut. | [AUDIT-R1] Animaux vivants sans catégorie PAD dédiée. T02 par défaut acceptable. Confidence modérée.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 26/88: group|01.7|T03
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '01.7', 'T03',
    0.55, 'expert_rule',
    'candidate', 'Fibres textiles brutes -> T03 : matieres premieres textiles non transformees. T03 = acides, sucres et matieres premieres, inclut les matieres premieres brutes. | [AUDIT-R1] Fibres textiles brutes sont des matières premières. T03 pertinent. Confiance modérée.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 27/88: group|01.A|T06
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '01.A', 'T06',
    0.8, 'nstr_bridge_inferred',
    'candidate', 'Oilseeds and oleaginous fruits -> T06 : NSTR bridge 01.A maps to oleagineux. T06 = arachides, oleagineux. Match direct via NSTR correspondance. | [AUDIT-R1] Match direct via pont NSTR : oléagineux → T06 = ''Arachides, oléagineux''. Correspondance explicite.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'NSTR bridge: 01.A oleagineux -> T06', true, true
  );

  -- Rule 28/88: group|01.B|P05
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '01.B', 'P05',
    0.8, 'expert_rule',
    'candidate', 'Poissons et crustaces -> P05 : le label PAD P05 = ''produits de peche NDA''. Correspondance directe entre produits de la peche et P05. | [AUDIT-R1] Match direct : label PAD P05 = ''Produits de pêche NDA''. Correspondance explicite.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD P05 = ''Produits de peche NDA''', true, true
  );

  -- Rule 29/88: group|02.1|T07
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '02.1', 'T07',
    0.8, 'expert_rule',
    'candidate', 'Charbon et lignite -> T07 : le label PAD T07 mentionne ''charbon'' explicitement. Match direct. | [AUDIT-R1] Match direct : label PAD T07 = ''Clinker, farine, charbon, sable et vracs pondéreux''. Charbon explicitement nommé.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T07 = ''Clinker, farine, charbon, sable et vracs pondereux''', true, true
  );

  -- Rule 30/88: group|02.2|T11
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '02.2', 'T11',
    0.85, 'expert_rule',
    'candidate', 'Petrole brut -> T11 : le label PAD T11 mentionne ''petrole brut'' explicitement. Match direct parfait. | [AUDIT-R1] Match direct parfait : label PAD T11 = ''Pétrole brut, essences, bitumes, hydrocarbures raffinés''. Pétrole brut explicitement nommé.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T11 = ''Petrole brut, essences, bitumes, hydrocarbures raffines''', true, true
  );

  -- Rule 31/88: group|02.3|T06
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '02.3', 'T06',
    0.55, 'expert_rule',
    'candidate', 'Gaz naturel -> T06 : rapprochement indirect. T06 = arachides, oleagineux. Le gaz naturel n''a pas de categorie PAD dediee. T06 pourrait couvrir les huiles/gaz naturels par extension semantique. | [AUDIT-R1] T06 rapprochement faible pour gaz naturel. Enrichir les notes pour indiquer que le gaz naturel manque de catégorie PAD.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 32/88: group|03.1|T03
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '03.1', 'T03',
    0.75, 'expert_rule',
    'candidate', 'Minerais de fer -> T03 : minerai brut = matiere premiere. T03 = acides, sucres et matieres premieres. Les minerais metalliques sont des matieres premieres de base. | [AUDIT-R1] Minerai de fer = matière première. T03 pertinent. Confiance relevée.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 33/88: group|03.2|T03
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '03.2', 'T03',
    0.7, 'expert_rule',
    'candidate', 'Minerais non ferreux -> T03 : minerais bruts = matieres premieres. Meme logique que 03.1 pour les minerais de fer. | [AUDIT-R1] Même logique que 03.1. Minerais non ferreux = matières premières.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 34/88: group|03.3|T06
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '03.3', 'T06',
    0.5, 'expert_rule',
    'candidate', 'Mineraux pour chimie et engrais -> T06 : rapprochement par extension. Les mineraux fertilisants incluent les phosphates naturels. T08 serait plus precis pour les phosphates mais T06 est propose comme alternative. | [AUDIT-R1] T06 rapprochement faible. T08 (phosphates) serait plus précis. Confiance ajustée à la baisse.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 35/88: group|03.4|T10
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '03.4', 'T10',
    0.85, 'expert_rule',
    'candidate', 'Sel -> T10 : le label PAD T10 mentionne ''sel'' explicitement. Match direct. | [AUDIT-R1] Match direct : label PAD T10 = ''Sel, soufre et produits chimiques''. Sel explicitement nommé.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T10 = ''Sel, soufre et produits chimiques''', true, true
  );

  -- Rule 36/88: group|03.5|T07
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '03.5', 'T07',
    0.8, 'expert_rule',
    'candidate', 'Sable, gravier, argile -> T07 : le label PAD T07 mentionne ''sable'' explicitement. Les materiaux de carriere correspondent directement a T07. | [AUDIT-R1] Match direct : label PAD T07 = ''Clinker, farine, charbon, sable et vracs pondéreux''. Sable explicitement nommé.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T07 = ''Clinker, farine, charbon, sable et vracs pondereux''', true, true
  );

  -- Rule 37/88: group|04.1|T02
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '04.1', 'T02',
    0.6, 'expert_rule',
    'candidate', 'Viandes et produits carnes -> T02 : denrees alimentaires transformees classees marchandises generales. Pas de categorie PAD dediee aux viandes. | [AUDIT-R1] Denrées alimentaires transformées. T02 par défaut acceptable.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 38/88: group|04.2|P05
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '04.2', 'P05',
    0.75, 'expert_rule',
    'candidate', 'Poissons transformes -> P05 : produits de la peche transformes. P05 = produits de peche NDA. Les conserves et poissons transformes restent dans la famille peche. | [AUDIT-R1] Produits de la pêche transformés restent dans P05 ''Produits de pêche NDA''. Cohérent.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD P05 = ''Produits de peche NDA''', true, true
  );

  -- Rule 39/88: group|04.3|T02
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '04.3', 'T02',
    0.6, 'expert_rule',
    'candidate', 'Fruits et legumes transformes -> T02 : produits alimentaires transformes classes marchandises generales. | [AUDIT-R1] Produits alimentaires transformés. T02 par défaut acceptable.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 40/88: group|04.4|T06
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '04.4', 'T06',
    0.8, 'nstr_bridge_inferred',
    'candidate', 'Huiles et graisses vegetales et animales -> T06 : NSTR bridge maps huiles vegetales to T06 oleagineux. Le label PAD T06 = ''arachides, oleagineux'' couvre les huiles. | [AUDIT-R1] Match via pont NSTR : huiles végétales → T06 ''Arachides, oléagineux''. Correspondance directe.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'NSTR bridge: huiles vegetales -> T06 oleagineux', true, true
  );

  -- Rule 41/88: group|04.5|T02
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '04.5', 'T02',
    0.5, 'expert_rule',
    'candidate', 'Produits laitiers -> T02 : denrees alimentaires transformees classees marchandises generales. Pas de categorie PAD specifique pour les produits laitiers. | [AUDIT-R1] Produits laitiers = denrées transformées. T02 par défaut. Confiance modérée.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 42/88: group|04.6|T05
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '04.6', 'T05',
    0.8, 'expert_rule',
    'candidate', 'Farines et produits amylaces -> T05 : le label PAD T05 mentionne ''farine'' dans ''clinker, farine'' (T07) mais aussi ''cereales, ciment, riz'' pour les produits cerealiers transformes. La farine est un produit cerealier transforme. | [AUDIT-R1] La farine est un produit céréalier transformé. T05 ''Céréales, ciment, riz et produits assimilés'' est le bon classement. Match direct.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T05 = ''Cereales, ciment, riz et produits assimiles''', true, true
  );

  -- Rule 43/88: group|04.6|T07
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '04.6', 'T07',
    0.5, 'expert_rule',
    'candidate', 'Farines et produits amylaces -> T07 : le label PAD T07 mentionne ''farine'' dans ''clinker, farine, charbon, sable''. Ambiguite car T07 couvre surtout les vracs pondereux industriels. Candidate secondaire. | [AUDIT-R1] T07 mentionne ''farine'' mais contexte industriel (clinker, charbon). Confiance ajustée à la baisse. Candidat secondaire.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T07 = ''Clinker, farine, charbon, sable et vracs pondereux''', true, true
  );

  -- Rule 44/88: group|04.7|T01
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '04.7', 'T01',
    0.5, 'expert_rule',
    'candidate', 'Boissons alcoolisees -> T01 : les alias PAD existants classent les vins et spiritueux sous T01 ''biens de valeur''. Les boissons alcoolisees sont des produits a valeur elevee. | [AUDIT-R1] Vins et spiritueux classés ''biens de valeur'' T01 via alias PAD existants. Confiance ajustée.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Alias PAD: vins et spiritueux -> T01', true, true
  );

  -- Rule 45/88: group|04.7|T02
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '04.7', 'T02',
    0.5, 'expert_rule',
    'candidate', 'Boissons alcoolisees -> T02 : alternative a T01. Les boissons peuvent aussi etre classees marchandises generales selon le volume et la valeur. | [AUDIT-R1] Alternative T02 acceptable pour boissons en vrac ou à faible valeur. Confiance identique à T01.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 46/88: group|04.8|T01
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '04.8', 'T01',
    0.45, 'expert_rule',
    'candidate', 'Tabac -> T01 : le tabac est un produit a valeur elevee, taxe, qui pourrait relever de T01 ''biens de valeur''. Rapprochement indicatif. | [AUDIT-R1] Tabac = produit à valeur élevée et taxé. T01 ''biens de valeur'' plausible mais confiance ajustée.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 47/88: group|04.8|T02
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '04.8', 'T02',
    0.55, 'expert_rule',
    'candidate', 'Tabac -> T02 : alternative. Le tabac en vrac ou transforme peut etre classe marchandises generales. | [AUDIT-R1] Tabac en vrac = marchandises générales T02. Confiance légèrement supérieure à T01.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 48/88: group|05.1|T12
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '05.1', 'T12',
    0.7, 'expert_rule',
    'candidate', 'Vetements et articles en fourrure -> T12 : produits textiles manufactures. T12 = materiaux et produits manufactures. Les vetements sont des produits manufactures finis. | [AUDIT-R1] Vêtements = produits manufacturés finis. T12 pertinent.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 49/88: group|05.2|T12
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '05.2', 'T12',
    0.6, 'expert_rule',
    'candidate', 'Chaussures -> T12 : produits manufactures finis. Meme logique que les vetements (05.1). | [AUDIT-R1] Chaussures = produits manufacturés finis. Même logique que 05.1.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 50/88: group|05.3|T12
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '05.3', 'T12',
    0.6, 'expert_rule',
    'candidate', 'Cuir et articles en cuir -> T12 : produits manufactures. Les articles en cuir (maroquinerie) sont des produits manufactures finis. | [AUDIT-R1] Articles en cuir = produits manufacturés. T12 pertinent.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 51/88: group|06.1|T04
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '06.1', 'T04',
    0.85, 'expert_rule',
    'candidate', 'Bois scies et rabotes -> T04 : match direct avec le label PAD T04 ''bois et produits divers''. Le bois transforme (planches, chevrons) est le coeur de T04. | [AUDIT-R1] Match direct : label PAD T04 = ''Bois et produits divers''. Bois scié est le cœur de T04.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T04 = ''Bois et produits divers''', true, true
  );

  -- Rule 52/88: group|06.2|T04
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '06.2', 'T04',
    0.8, 'expert_rule',
    'candidate', 'Panneaux et contreplaque -> T04 : derives du bois, meme famille que 06.1. T04 = bois et produits divers. | [AUDIT-R1] Dérivés du bois = T04. Même famille que 06.1.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T04 = ''Bois et produits divers''', true, true
  );

  -- Rule 53/88: group|06.3|T12
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '06.3', 'T12',
    0.55, 'expert_rule',
    'candidate', 'Papier et carton -> T12 : produits manufactures a base de cellulose. T12 = materiaux et produits manufactures. Le papier transforme est un produit manufacture. | [AUDIT-R1] Papier/carton = produit manufacturé. T12 acceptable. Confiance modérée.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 54/88: group|07.1|T07
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '07.1', 'T07',
    0.8, 'expert_rule',
    'candidate', 'Coke -> T07 : le coke est un combustible solide assimile au charbon. T07 = clinker, farine, charbon, sable. Le coke est dans la meme famille que le charbon (vracs pondereux). | [AUDIT-R1] Coke = combustible solide assimilé au charbon. T07 mentionne ''charbon''. Match direct par assimilation.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T07, charbon -> coke par assimilation', true, true
  );

  -- Rule 55/88: group|07.2|T06
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '07.2', 'T06',
    0.55, 'expert_rule',
    'candidate', 'Produits petroliers raffines -> T06 : les huiles minerales raffinées pourraient etre rapprochees de T06 par extension. Cependant T11 est plus precis. Candidate secondaire. | [AUDIT-R1] T06 rapprochement faible pour produits pétroliers. T11 est plus précis. Enrichir pour indiquer T11 comme principal.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 56/88: group|07.2|T11
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '07.2', 'T11',
    0.85, 'expert_rule',
    'candidate', 'Produits petroliers raffines -> T11 : match direct avec le label PAD T11 ''hydrocarbures raffines''. Les essences, gazole, bitumes sont explicitement couverts. | [AUDIT-R1] Match direct : label PAD T11 = ''hydrocarbures raffinés''. Essences, gazole, bitumes explicitement couverts.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T11 = ''Petrole brut, essences, bitumes, hydrocarbures raffines''', true, true
  );

  -- Rule 57/88: group|07.3|T06
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '07.3', 'T06',
    0.8, 'expert_rule',
    'candidate', 'Combustible nucleaire -> T06 : rapprochement par defaut. Le combustible nucleaire n''a pas de categorie PAD dediee. T06 est utilise comme categorie de repli. | [AUDIT-R1] Pas de catégorie PAD dédiée pour le nucléaire. T06 comme repli par défaut. Confiance maintenue.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 58/88: group|07.4|T11
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '07.4', 'T11',
    0.8, 'expert_rule',
    'candidate', 'Biocombustibles -> T11 : les biocarburants sont assimiles aux hydrocarbures. T11 = petrole brut, essences, bitumes, hydrocarbures raffines. Les biocarburants sont des substituts directs. | [AUDIT-R1] Biocarburants assimilés aux hydrocarbures. T11 pertinent par assimilation directe.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 59/88: group|08.1|T10
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '08.1', 'T10',
    0.85, 'expert_rule',
    'candidate', 'Produits chimiques de base -> T10 : le label PAD T10 mentionne ''produits chimiques''. Les acides, bases, produits chimiques industriels correspondent a T10. | [AUDIT-R1] Match direct : label PAD T10 = ''Sel, soufre et produits chimiques''. Produits chimiques explicitement nommés.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T10 = ''Sel, soufre et produits chimiques''', true, true
  );

  -- Rule 60/88: group|08.2|T03
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '08.2', 'T03',
    0.6, 'expert_rule',
    'candidate', 'Engrais et produits azotes -> T03 : les engrais sont des matieres premieres chimiques. T03 = acides, sucres et matieres premieres. Ambiguite avec T08 (phosphates). | [AUDIT-R1] Engrais = matières premières chimiques. T03 acceptable. Confiance modérée.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 61/88: group|08.3|T08
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '08.3', 'T08',
    0.65, 'expert_rule',
    'candidate', 'Matieres plastiques de base -> T08 : les matieres plastiques brutes sont des matieres premieres industrielles. T08 = attapulgite, phosphates, ferrailles, tourteaux, cellulose. La cellulose et les polymeres bruts relevent de T08. | [AUDIT-R1] Matières plastiques brutes = matières premières industrielles. T08 pertinent via cellulose/polymères.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 62/88: group|08.4|T03
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '08.4', 'T03',
    0.55, 'expert_rule',
    'candidate', 'Caoutchouc synthetique et naturel -> T03 : matiere premiere brute. T03 = acides, sucres et matieres premieres. Le caoutchouc naturel est une matiere premiere agricole. | [AUDIT-R1] Caoutchouc naturel = matière première brute. T03 pertinent. Enrichir pour distinguer caoutchouc naturel (T03) vs synthétique (T12).', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 63/88: group|08.4|T12
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '08.4', 'T12',
    0.45, 'expert_rule',
    'candidate', 'Caoutchouc synthetique -> T12 : le caoutchouc synthetique est un produit manufacture. T12 = materiaux et produits manufactures. Candidate secondaire. | [AUDIT-R1] Caoutchouc synthétique = produit manufacturé. T12 comme candidat secondaire. Confiance ajustée.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 64/88: group|08.5|T01
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '08.5', 'T01',
    0.7, 'expert_rule',
    'candidate', 'Produits pharmaceutiques -> T01 : les medicaments sont des biens de valeur. T01 = biens de valeur, electronique, informatique et mobilier. Les produits pharmaceutiques sont des biens a haute valeur ajoutee. | [AUDIT-R1] Produits pharmaceutiques = biens de valeur à haute valeur ajoutée. T01 pertinent.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 65/88: group|08.6|T12
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '08.6', 'T12',
    0.75, 'expert_rule',
    'candidate', 'Peintures, savons, produits d''entretien -> T12 : produits chimiques manufactures. T12 = materiaux et produits manufactures. Les peintures et detergents sont des produits manufactures finis. | [AUDIT-R1] Peintures, savons = produits chimiques manufacturés finis. T12 pertinent.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 66/88: group|09.1|T12
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '09.1', 'T12',
    0.65, 'expert_rule',
    'candidate', 'Verre et produits en verre -> T12 : produits manufactures mineraux. T12 = materiaux et produits manufactures. Les bouteilles, vitres, verrerie sont des produits manufactures. | [AUDIT-R1] Verre = produit manufacturé minéral. T12 pertinent.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 67/88: group|09.2|T07
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '09.2', 'T07',
    0.55, 'expert_rule',
    'candidate', 'Ciment, chaux, platre -> T07 : le ciment est un vrac pondereux. T07 = clinker, farine, charbon, sable. Le clinker (matiere premiere du ciment) est explicitement dans T07. Ambiguite avec T05 qui mentionne aussi le ciment. | [AUDIT-R1] Ciment/clinker = vrac pondéreux. T07 pertinent mais conflit T05/T07 pour ciment fini. Enrichir notes.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T07 = ''Clinker, farine, charbon, sable et vracs pondereux''', true, true
  );

  -- Rule 68/88: group|09.3|T07
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '09.3', 'T07',
    0.55, 'expert_rule',
    'candidate', 'Ceramiques et produits refractaires -> T07 : les materiaux refractaires sont des produits mineraux pondereux. T07 couvre les vracs pondereux et materiaux de construction. Ambiguite avec T12 pour les ceramiques fines. | [AUDIT-R1] Matériaux réfractaires = minéraux pondéreux. T07 pertinent pour céramiques industrielles. Confiance modérée.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 69/88: group|10.1|T14
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '10.1', 'T14',
    0.85, 'expert_rule',
    'candidate', 'Fer et acier de base -> T14 : match direct avec le label PAD T14 ''fil machine et feuillard''. Les produits siderurgiques de premiere transformation (billettes, barres, profiles) sont le coeur de T14. | [AUDIT-R1] Match direct : label PAD T14 = ''Fil machine et feuillard''. Fer/acier de base = cœur de T14.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T14 = ''Fil machine et feuillard''', true, true
  );

  -- Rule 70/88: group|10.2|T12
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '10.2', 'T12',
    0.6, 'expert_rule',
    'candidate', 'Metaux non ferreux -> T12 : les metaux non ferreux transformes (aluminium, cuivre en feuilles/barres) sont des materiaux manufactures. T12 = materiaux et produits manufactures. | [AUDIT-R1] Métaux non ferreux transformés = matériaux manufacturés. T12 pertinent.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 71/88: group|10.3|T12
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '10.3', 'T12',
    0.7, 'expert_rule',
    'candidate', 'Produits metalliques structurels -> T12 : structures metalliques, reservoirs, chaudieres = produits manufactures. T12 = materiaux et produits manufactures. | [AUDIT-R1] Structures métalliques = produits manufacturés. T12 pertinent.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 72/88: group|10.4|T14
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '10.4', 'T14',
    0.75, 'nstr_bridge_inferred',
    'candidate', 'Fils et cables metalliques -> T14 : NSTR bridge maps fils/cables to T14. T14 = fil machine et feuillard. Les fils et cables sont dans la meme famille que le fil machine. | [AUDIT-R1] Match via pont NSTR : fils/câbles → T14 ''Fil machine et feuillard''. Même famille industrielle.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'NSTR bridge: fils et cables -> T14', true, true
  );

  -- Rule 73/88: group|10.5|T12
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '10.5', 'T12',
    0.65, 'expert_rule',
    'candidate', 'Quincaillerie et outillage -> T12 : produits metalliques manufactures finis. T12 = materiaux et produits manufactures. La quincaillerie et l''outillage sont des produits manufactures de petite taille. | [AUDIT-R1] Quincaillerie/outillage = produits manufacturés finis. T12 pertinent.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 74/88: group|11.1|T09
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '11.1', 'T09',
    0.7, 'expert_rule',
    'candidate', 'Moteurs et turbines -> T09 : les moteurs industriels sont du materiel de transport/equipement lourd. T09 = tracteurs, vehicules industriels et materiel de transport. Les moteurs sont des composants de materiel de transport. | [AUDIT-R1] Moteurs industriels = composants de matériel de transport. T09 pertinent.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 75/88: group|11.2|T01
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '11.2', 'T01',
    0.6, 'expert_rule',
    'candidate', 'Ordinateurs et equipements informatiques -> T01 : le label PAD T01 mentionne ''informatique'' explicitement. Match direct. | [AUDIT-R1] Match direct : label PAD T01 = ''biens de valeur, électronique, informatique et mobilier''. Informatique explicitement nommée.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T01 = ''Biens de valeur, electronique, informatique et mobilier''', true, true
  );

  -- Rule 76/88: group|11.3|T01
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '11.3', 'T01',
    0.8, 'expert_rule',
    'candidate', 'Materiel electrique -> T01 : equipements electriques = biens de valeur. T01 = biens de valeur, electronique, informatique et mobilier. L''electronique est explicitement dans le label. | [AUDIT-R1] Matériel électrique = biens de valeur. T01 mentionne ''électronique''. Correspondance directe.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T01 = ''Biens de valeur, electronique, informatique et mobilier''', true, true
  );

  -- Rule 77/88: group|11.4|T01
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '11.4', 'T01',
    0.8, 'expert_rule',
    'candidate', 'Appareils medicaux et de precision -> T01 : instruments de precision = biens de haute valeur. T01 = biens de valeur. Les appareils medicaux sont des equipements a forte valeur ajoutee. | [AUDIT-R1] Appareils médicaux et de précision = biens de haute valeur. T01 pertinent.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 78/88: group|11.5|T09
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '11.5', 'T09',
    0.65, 'expert_rule',
    'candidate', 'Machines industrielles -> T09 : les machines industrielles sont des equipements lourds. T09 = tracteurs, vehicules industriels. Les machines de production sont assimilees aux equipements industriels. | [AUDIT-R1] Machines industrielles = équipements lourds. T09 pertinent par assimilation.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 79/88: group|11.6|T09
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '11.6', 'T09',
    0.7, 'expert_rule',
    'candidate', 'Machines agricoles -> T09 : les tracteurs et machines agricoles sont explicitement dans le label T09 ''tracteurs, vehicules industriels''. Match direct. | [AUDIT-R1] Match direct : label PAD T09 = ''Tracteurs, véhicules industriels''. Machines agricoles/tracteurs explicitement couverts.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T09 = ''Tracteurs, vehicules industriels et materiel de transport''', true, true
  );

  -- Rule 80/88: group|11.7|T01
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '11.7', 'T01',
    0.8, 'expert_rule',
    'candidate', 'Appareils menagers -> T01 : les appareils electromenagers sont des biens de valeur. T01 = biens de valeur, electronique, informatique et mobilier. Les gros electromenagers sont des biens de valeur importes. | [AUDIT-R1] Appareils ménagers = biens de valeur importés. T01 pertinent.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 81/88: group|11.8|T09
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '11.8', 'T09',
    0.6, 'nstr_bridge_inferred',
    'candidate', 'Armes et munitions -> T09 : NSTR bridge maps armement to materiel de transport/vehicules. T09 = tracteurs, vehicules industriels et materiel de transport. Les vehicules militaires et armement sont assimiles au materiel de transport. | [AUDIT-R1] Armement assimilé au matériel de transport via pont NSTR. T09 pertinent.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'NSTR bridge: armement -> T09 materiel de transport', true, true
  );

  -- Rule 82/88: group|12.1|T09
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '12.1', 'T09',
    0.85, 'expert_rule',
    'candidate', 'Vehicules automobiles -> T09 : match direct avec le label PAD T09 ''vehicules industriels et materiel de transport''. Les vehicules sont le coeur de T09. | [AUDIT-R1] Match direct : label PAD T09 = ''Tracteurs, véhicules industriels et matériel de transport''. Véhicules = cœur de T09.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T09 = ''Tracteurs, vehicules industriels et materiel de transport''', true, true
  );

  -- Rule 83/88: group|12.2|T09
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '12.2', 'T09',
    0.8, 'expert_rule',
    'candidate', 'Autre materiel de transport -> T09 : navires, aeronefs, materiel ferroviaire = materiel de transport. T09 couvre tout le materiel de transport. | [AUDIT-R1] Navires, aéronefs, matériel ferroviaire = matériel de transport. T09 pertinent.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T09 = ''Tracteurs, vehicules industriels et materiel de transport''', true, true
  );

  -- Rule 84/88: group|13.1|T01
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '13.1', 'T01',
    0.8, 'expert_rule',
    'candidate', 'Meubles -> T01 : le label PAD T01 mentionne ''mobilier'' explicitement. Match direct entre meubles et T01. | [AUDIT-R1] Match direct : label PAD T01 = ''biens de valeur, électronique, informatique et mobilier''. Mobilier explicitement nommé.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T01 = ''Biens de valeur, electronique, informatique et mobilier''', true, true
  );

  -- Rule 85/88: group|13.2|T01
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '13.2', 'T01',
    0.45, 'expert_rule',
    'candidate', 'Autres produits manufactures (bijoux, instruments de musique, etc.) -> T01 : les bijoux et instruments sont des biens de valeur. Confidence faible car la categorie est tres heterogene. | [AUDIT-R1] Catégorie hétérogène. T01 ''biens de valeur'' plausible pour bijoux mais confiance ajustée.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 86/88: group|14.1|T08
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '14.1', 'T08',
    0.5, 'expert_rule',
    'candidate', 'Dechets municipaux -> T08 : les dechets recyclables contiennent des ferrailles. T08 = attapulgite, phosphates, ferrailles, tourteaux, cellulose. La cellulose (papier) et les ferrailles sont des dechets recyclables. | [AUDIT-R1] Déchets municipaux → ferrailles/cellulose recyclables. T08 pertinent par défaut.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 87/88: group|14.2|T08
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '14.2', 'T08',
    0.65, 'expert_rule',
    'candidate', 'Matieres premieres secondaires -> T08 : ferrailles, metaux recycles, papier recycle. T08 = attapulgite, phosphates, ferrailles, tourteaux, cellulose. Les ferrailles et la cellulose recyclee correspondent a T08. | [AUDIT-R1] Ferrailles et matières recyclées = T08. Correspondance directe.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- Rule 88/88: group|15.1|T02
  INSERT INTO expected_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '15.1', 'T02',
    0.55, 'expert_rule',
    'candidate', 'Courrier et colis -> T02 : les envois postaux sont classes marchandises generales. T02 = marchandises generales. Les colis et courrier commercial relevent de T02 par defaut. | [AUDIT-R1] Courrier/colis = marchandises générales. T02 par défaut acceptable.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD', true, true
  );

  -- ============ PHASE 2: CONTRÔLES SUR expected_rules ============

  -- Contrôle E1: count expected_rules = 88
  SELECT count(*) INTO v_expected FROM expected_rules;
  IF v_expected != 88 THEN
    RAISE EXCEPTION 'ECHEC E1: expected_rules count = %, attendu 88', v_expected;
  END IF;

  -- Contrôle E2: aucun validation_status != candidate dans expected
  SELECT count(*) INTO v_bad_status FROM expected_rules WHERE validation_status != 'candidate';
  IF v_bad_status != 0 THEN
    RAISE EXCEPTION 'ECHEC E2: % expected avec validation_status != candidate', v_bad_status;
  END IF;

  -- Contrôle E3: aucun requires_operator_validation = false dans expected
  SELECT count(*) INTO v_bad_validation FROM expected_rules WHERE requires_operator_validation = false;
  IF v_bad_validation != 0 THEN
    RAISE EXCEPTION 'ECHEC E3: % expected avec requires_operator_validation = false', v_bad_validation;
  END IF;

  -- Contrôle E4: evidence_level strict dans expected
  SELECT count(*) INTO v_bad_evidence FROM expected_rules
    WHERE evidence_level NOT IN ('expert_rule', 'nstr_bridge_inferred');
  IF v_bad_evidence != 0 THEN
    RAISE EXCEPTION 'ECHEC E4: % expected avec evidence_level invalide', v_bad_evidence;
  END IF;

  -- Contrôle E5: confidence range dans expected
  SELECT min(confidence), max(confidence) INTO v_min_conf, v_max_conf FROM expected_rules;
  IF v_min_conf != 0.45 OR v_max_conf != 0.85 THEN
    RAISE EXCEPTION 'ECHEC E5: expected confidence range %-%, attendu 0.45-0.85', v_min_conf, v_max_conf;
  END IF;

  -- ============ PHASE 3: PURGE + IMPORT ============

  DELETE FROM public.pad_nst_recommendation_rules;

  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  )
  SELECT
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  FROM expected_rules;

  -- ============ PHASE 4: CONTRÔLES TABLE FINALE ============

  -- Contrôle F1: count final = 88
  SELECT count(*) INTO v_count FROM public.pad_nst_recommendation_rules;
  IF v_count != 88 THEN
    RAISE EXCEPTION 'ECHEC F1: count final = %, attendu 88', v_count;
  END IF;

  -- Contrôle F2: aucune validation_status != candidate
  SELECT count(*) INTO v_bad_status FROM public.pad_nst_recommendation_rules WHERE validation_status != 'candidate';
  IF v_bad_status != 0 THEN
    RAISE EXCEPTION 'ECHEC F2: % avec validation_status != candidate', v_bad_status;
  END IF;

  -- Contrôle F3: aucune requires_operator_validation = false
  SELECT count(*) INTO v_bad_validation FROM public.pad_nst_recommendation_rules WHERE requires_operator_validation = false;
  IF v_bad_validation != 0 THEN
    RAISE EXCEPTION 'ECHEC F3: % avec requires_operator_validation = false', v_bad_validation;
  END IF;

  -- Contrôle F4: aucune is_active = false
  SELECT count(*) INTO v_bad_active FROM public.pad_nst_recommendation_rules WHERE is_active = false;
  IF v_bad_active != 0 THEN
    RAISE EXCEPTION 'ECHEC F4: % avec is_active = false', v_bad_active;
  END IF;

  -- Contrôle F5: evidence_level strict
  SELECT count(*) INTO v_bad_evidence FROM public.pad_nst_recommendation_rules
    WHERE evidence_level NOT IN ('expert_rule', 'nstr_bridge_inferred');
  IF v_bad_evidence != 0 THEN
    RAISE EXCEPTION 'ECHEC F5: % avec evidence_level invalide', v_bad_evidence;
  END IF;

  -- Contrôle F6: confidence range
  SELECT min(confidence), max(confidence) INTO v_min_conf, v_max_conf FROM public.pad_nst_recommendation_rules;
  IF v_min_conf != 0.45 OR v_max_conf != 0.85 THEN
    RAISE EXCEPTION 'ECHEC F6: confidence range %-%, attendu 0.45-0.85', v_min_conf, v_max_conf;
  END IF;

  -- ============ PHASE 5: ÉGALITÉ EXACTE expected_rules ↔ table finale ============

  -- Contrôle EQ1: règles en base absentes de expected_rules = 0
  SELECT count(*) INTO v_extra FROM (
    SELECT nst_level, nst_code, pad_category, confidence, evidence_level,
           validation_status, requires_operator_validation, is_active
    FROM public.pad_nst_recommendation_rules
    EXCEPT
    SELECT nst_level, nst_code, pad_category, confidence, evidence_level,
           validation_status, requires_operator_validation, is_active
    FROM expected_rules
  ) AS extra;
  IF v_extra != 0 THEN
    RAISE EXCEPTION 'ECHEC EQ1: % règles en base absentes de expected_rules', v_extra;
  END IF;

  -- Contrôle EQ2: règles expected absentes de la table finale = 0
  SELECT count(*) INTO v_missing FROM (
    SELECT nst_level, nst_code, pad_category, confidence, evidence_level,
           validation_status, requires_operator_validation, is_active
    FROM expected_rules
    EXCEPT
    SELECT nst_level, nst_code, pad_category, confidence, evidence_level,
           validation_status, requires_operator_validation, is_active
    FROM public.pad_nst_recommendation_rules
  ) AS missing;
  IF v_missing != 0 THEN
    RAISE EXCEPTION 'ECHEC EQ2: % règles expected absentes de la table finale', v_missing;
  END IF;

  RAISE NOTICE 'PAD-NST-2E-B-R2: 88 règles importées, égalité exacte confirmée, tous contrôles OK';
END $$;