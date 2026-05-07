-- PAD-NST-2E-B — Import contrôlé de 88 règles candidates
-- Généré par pad_nst_2e_import.py
-- Méthode unique : migration data-only transactionnelle
-- AUCUNE règle TIER-C, AUCUNE validated, AUCUNE requires_operator_validation=false

DO $$
DECLARE
  v_count INTEGER;
  v_bad_status INTEGER;
  v_bad_validation INTEGER;
  v_bad_active INTEGER;
  v_bad_evidence INTEGER;
  v_min_conf NUMERIC;
  v_max_conf NUMERIC;
BEGIN

  -- Vérifier que la table est vide avant import
  SELECT count(*) INTO v_count FROM public.pad_nst_recommendation_rules;
  IF v_count != 0 THEN
    RAISE EXCEPTION 'Table non vide avant import: % lignes existantes', v_count;
  END IF;

  -- Rule 1/88: division|01|P05
  INSERT INTO public.pad_nst_recommendation_rules (
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
  INSERT INTO public.pad_nst_recommendation_rules (
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
  INSERT INTO public.pad_nst_recommendation_rules (
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
  INSERT INTO public.pad_nst_recommendation_rules (
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
  INSERT INTO public.pad_nst_recommendation_rules (
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
  INSERT INTO public.pad_nst_recommendation_rules (
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
  INSERT INTO public.pad_nst_recommendation_rules (
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
  INSERT INTO public.pad_nst_recommendation_rules (
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
  INSERT INTO public.pad_nst_recommendation_rules (
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
  INSERT INTO public.pad_nst_recommendation_rules (
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
  INSERT INTO public.pad_nst_recommendation_rules (
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
  INSERT INTO public.pad_nst_recommendation_rules (
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
  INSERT INTO public.pad_nst_recommendation_rules (
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
  INSERT INTO public.pad_nst_recommendation_rules (
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
  INSERT INTO public.pad_nst_recommendation_rules (
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
  INSERT INTO public.pad_nst_recommendation_rules (
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
  INSERT INTO public.pad_nst_recommendation_rules (
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
  INSERT INTO public.pad_nst_recommendation_rules (
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
  INSERT INTO public.pad_nst_recommendation_rules (
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
  INSERT INTO public.pad_nst_recommendation_rules (
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
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '01.2', 'T02',
    0.5, 'expert_rule',
    'candidate', 'Pommes de terre -> T02 : produit agricole frais, classe marchandises generales en l''absence d''alias PAD specifique. Pas de categorie PAD dediee aux tubercules. | [AUDIT-R1] Produit agricole frais sans catégorie PAD dédiée. T02 par défaut acceptable.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 22/88: group|01.3|T03
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '01.3', 'T03',
    0.5, 'expert_rule',
    'candidate', 'Betteraves sucrieres -> T03 : T03 = acides, sucres et matieres premieres. La betterave sucriere est une matiere premiere pour le sucre. | [AUDIT-R1] Betterave sucrière = matière première pour le sucre. T03 ''sucres et matières premières'' pertinent. Confidence baissée car betterave brute rare à Dakar.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T03 = ''Acides, sucres et matieres premieres''', true, true
  );

  -- Rule 23/88: group|01.4|T02
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '01.4', 'T02',
    0.5, 'expert_rule',
    'candidate', 'Fruits et legumes frais -> T02 : marchandises generales. Pas de categorie PAD specifique aux fruits/legumes frais. | [AUDIT-R1] Fruits/légumes frais : marchandises générales. Pas de PAD dédié. Acceptable.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 24/88: group|01.5|T04
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '01.5', 'T04',
    0.8, 'expert_rule',
    'candidate', 'Produits forestiers et bois d''exploitation -> T04 : T04 = bois et produits divers. Match direct entre bois brut et le label PAD T04. | [AUDIT-R1] Match direct : label PAD T04 = ''Bois et produits divers''. Produits forestiers = bois brut.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T04 = ''Bois et produits divers''', true, true
  );

  -- Rule 25/88: group|01.7|T03
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '01.7', 'T03',
    0.55, 'expert_rule',
    'candidate', 'Autres substances d''origine vegetale -> T03 : matieres premieres vegetales (caoutchouc naturel, coton brut, fibres). T03 = acides, sucres et matieres premieres. | [AUDIT-R1] Matières premières végétales (coton brut, fibres). T03 ''matières premières'' pertinent.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 26/88: group|01.B|P05
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '01.B', 'P05',
    0.8, 'expert_rule',
    'candidate', 'Poissons et produits de la peche -> P05 : P05 = produits de peche non denommes ailleurs. Match direct entre le groupe NST et la famille PAD peche. Des sous-categories plus precises (P01-P04) existent pour crustaces, thonides, etc. | [AUDIT-R1] Match direct : P05 = ''Produits de pêche non dénommés ailleurs''. Poissons et produits de la pêche → P05.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Labels PAD P01-P05 = familles de produits de peche', true, true
  );

  -- Rule 27/88: group|02.1|T07
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '02.1', 'T07',
    0.8, 'expert_rule',
    'candidate', 'Charbon et lignite -> T07 : T07 = clinker, farine, charbon, sable et vracs pondereux. Le charbon est explicitement dans le label T07. | [AUDIT-R1] Match direct : label PAD T07 cite ''charbon''. Charbon et lignite → T07.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T07 = ''Clinker, farine, charbon, sable et vracs pondereux''', true, true
  );

  -- Rule 28/88: group|02.2|T11
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '02.2', 'T11',
    0.85, 'expert_rule',
    'candidate', 'Petrole brut -> T11 : T11 = petrole brut, essences, bitumes, hydrocarbures raffines. ''Petrole brut'' est explicitement dans le label T11. Match direct. | [AUDIT-R1] Match direct : label PAD T11 cite ''Pétrole brut''. Correspondance explicite.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T11 = ''Petrole brut, essences, bitumes, hydrocarbures raffines''', true, true
  );

  -- Rule 29/88: group|02.3|T06
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '02.3', 'T06',
    0.55, 'expert_rule',
    'candidate', 'Gaz naturel -> T06 : T06 = gasoil, fuel oil, diesel, butane en vrac, phosphates. Le butane est un gaz dans T06. Ambiguite car le gaz naturel n''est pas explicitement nomme, mais T06 couvre les hydrocarbures en vrac. | [AUDIT-R1] T06 cite ''butane en vrac''. Le gaz naturel n''est pas explicitement nommé mais T06 couvre les hydrocarbures en vrac gazeux. Ambiguïté documentée.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T06 = ''Gasoil, fuel oil, diesel, butane en vrac, phosphates''', true, true
  );

  -- Rule 30/88: group|03.1|T03
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '03.1', 'T03',
    0.75, 'expert_rule',
    'candidate', 'Minerais de fer -> T03 : T03 = acides, sucres et matieres premieres. Les minerais de fer sont des matieres premieres brutes. | [AUDIT-R1] Minerais de fer = matières premières brutes. T03 ''matières premières'' pertinent.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T03 = ''Acides, sucres et matieres premieres''', true, true
  );

  -- Rule 31/88: group|03.2|T03
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '03.2', 'T03',
    0.6, 'expert_rule',
    'candidate', 'Minerais de metaux non ferreux -> T03 : matieres premieres brutes. Meme raisonnement que 03.1 mais confidence legerement inferieure car les minerais non ferreux sont plus varies. | [AUDIT-R1] Minerais non ferreux = matières premières. Même logique que 03.1 avec confidence légèrement inférieure car plus variés.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 32/88: group|03.3|T06
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '03.3', 'T06',
    0.5, 'expert_rule',
    'candidate', 'Mineraux fertilisants -> T06 : T06 mentionne aussi ''phosphates''. Conflit PAD : les phosphates apparaissent dans T06 ET T08. Validation operateur obligatoire pour arbitrer. | [AUDIT-R1] CONFLIT T06/T08 pour phosphates. T06 cite ''phosphates'' mais T08 aussi. Confidence baissée. Validation opérateur obligatoire pour arbitrer.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T06 = ''Gasoil, fuel oil, diesel, butane en vrac, phosphates''', true, true
  );

  -- Rule 33/88: group|03.3|T08
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '03.3', 'T08',
    0.6, 'expert_rule',
    'candidate', 'Mineraux fertilisants -> T08 : T08 = attapulgite, phosphates, ferrailles, tourteaux, cellulose. Les phosphates sont explicitement dans le label T08. Match direct. | [AUDIT-R1] CONFLIT T06/T08 : T08 cite aussi ''phosphates''. T08 semble plus pertinent car les phosphates y sont listés avec d''autres minéraux fertilisants. Priorité T08 > T06 recommandée.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T08 = ''Attapulgite, phosphates, ferrailles, tourteaux, cellulose''', true, true
  );

  -- Rule 34/88: group|03.4|T10
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '03.4', 'T10',
    0.8, 'expert_rule',
    'candidate', 'Sel -> T10 : T10 = sel de production locale. Match direct entre sel et le label T10. Note : T10 precise ''production locale'', ce qui peut ne pas convenir pour du sel importe. Confidence moyenne car restriction possible. | [AUDIT-R1] Match direct : T10 = ''Sel de production locale''. Note : T10 précise ''production locale'', peut ne pas convenir pour sel importé. Validation opérateur recommandée.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T10 = ''Sel de production locale''', true, true
  );

  -- Rule 35/88: group|03.5|T07
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '03.5', 'T07',
    0.8, 'expert_rule',
    'candidate', 'Pierre, sable, gravier, argile -> T07 : T07 = clinker, farine, charbon, sable et vracs pondereux. Le sable est explicitement dans le label T07. Les granulats et materiaux de carriere sont des vracs pondereux. | [AUDIT-R1] Match direct : T07 cite ''sable et vracs pondéreux''. Pierre, sable, gravier → T07.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T07 = ''Clinker, farine, charbon, sable et vracs pondereux''', true, true
  );

  -- Rule 36/88: group|04.1|T02
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '04.1', 'T02',
    0.55, 'expert_rule',
    'candidate', 'Viandes, peaux brutes, produits carnes -> T02 : marchandises generales. Denrees alimentaires transformees classees en marchandises generales. | [AUDIT-R1] Viandes et produits carnés : marchandises générales. Flux réel à Dakar (viande importée). T02 acceptable.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 37/88: group|04.2|P05
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '04.2', 'P05',
    0.75, 'expert_rule',
    'candidate', 'Poissons transformes et conserves -> P05 : P05 = produits de peche NDA. Les produits de peche transformes restent dans la famille PAD peche. | [AUDIT-R1] Poissons transformés et conservés → P05. Les produits de pêche transformés restent dans la famille PAD pêche.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Labels PAD P01-P05', true, true
  );

  -- Rule 38/88: group|04.3|T02
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '04.3', 'T02',
    0.55, 'expert_rule',
    'candidate', 'Fruits et legumes transformes -> T02 : marchandises generales. Conserves et produits alimentaires transformes. | [AUDIT-R1] Fruits/légumes transformés (conserves). Marchandises générales. Flux réel à Dakar.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 39/88: group|04.4|T02
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '04.4', 'T02',
    0.55, 'expert_rule',
    'candidate', 'Huiles et graisses animales et vegetales -> T02 : marchandises generales. Huiles alimentaires en conteneur. | [AUDIT-R1] Huiles alimentaires en conteneur. T02 par défaut. Flux important à Dakar (huile de palme, arachide).', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 40/88: group|04.5|T02
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '04.5', 'T02',
    0.5, 'expert_rule',
    'candidate', 'Produits laitiers et creme glacee -> T02 : marchandises generales. Denrees alimentaires refrigerees. | [AUDIT-R1] Produits laitiers : marchandises générales réfrigérées. Flux réel à Dakar (lait en poudre).', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 41/88: group|04.6|T05
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '04.6', 'T05',
    0.8, 'expert_rule',
    'candidate', 'Farines, amidons, aliments pour animaux -> T05 : T05 = cereales, ciment, riz et produits assimiles. Les farines sont des produits cerealiers transformes, directement dans la famille T05. | [AUDIT-R1] Match direct : T05 = ''Céréales, ciment, riz et produits assimilés''. Farines = produits céréaliers transformés.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T05 = ''Cereales, ciment, riz et produits assimiles''', true, true
  );

  -- Rule 42/88: group|04.6|T07
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '04.6', 'T07',
    0.5, 'expert_rule',
    'candidate', 'Farines -> T07 : T07 = clinker, farine, charbon, sable et vracs pondereux. La farine est explicitement dans le label T07 pour les vracs. Conflit avec T05 : depend si vrac (T07) ou conditionne (T05). Validation operateur necessaire. | [AUDIT-R1] CONFLIT T05/T07 pour farine : T07 cite ''farine'' pour le vrac. Dépend du conditionnement (vrac → T07, conditionné → T05). Confidence baissée. Validation opérateur nécessaire.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T07 = ''Clinker, farine, charbon, sable et vracs pondereux''', true, true
  );

  -- Rule 43/88: group|04.7|T01
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '04.7', 'T01',
    0.5, 'expert_rule',
    'candidate', 'Boissons -> T01 : T01 = biens de valeur. Des alias PAD existants classent ''boissons alcoolisees'' sous T01. Ambiguite pour les boissons non alcoolisees qui pourraient relever de T02. | [AUDIT-R1] T01 pertinent pour boissons alcoolisées (alias PAD existant). Confidence baissée car ne couvre que la composante alcool du groupe.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Alias PAD existant : ''boissons alcoolisees sauf vin 13'' -> T01', true, true
  );

  -- Rule 44/88: group|04.7|T02
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '04.7', 'T02',
    0.5, 'expert_rule',
    'candidate', 'Boissons non alcoolisees -> T02 : marchandises generales. Les boissons non alcoolisees (eau, jus) sont des marchandises generales. Candidate secondaire, depend du type de boisson. | [AUDIT-R1] T02 pertinent pour boissons non alcoolisées (eau, jus). Conflit T01/T02 documenté : dépend du type de boisson.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 45/88: group|04.8|T01
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '04.8', 'T01',
    0.45, 'expert_rule',
    'candidate', 'Tabac, cigarettes -> T01 : T01 = biens de valeur. Un alias PAD existant classe ''autre tabac, cigarettes, cigares'' sous T01. Candidate secondaire pour la composante tabac du groupe. | [AUDIT-R1] T01 pertinent uniquement pour tabac/cigarettes (alias PAD). Confidence baissée car très partiel.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Alias PAD existant : ''autre tabac cigarettes cigares et filtres'' -> T01', true, true
  );

  -- Rule 46/88: group|04.8|T02
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '04.8', 'T02',
    0.55, 'expert_rule',
    'candidate', 'Autres produits alimentaires et tabac -> T02 : marchandises generales. Les denrees alimentaires diverses et le tabac sont classes marchandises generales. | [AUDIT-R1] T02 pour denrées alimentaires diverses et tabac. Candidat principal. Flux réel à Dakar.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 47/88: group|05.1|T12
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '05.1', 'T12',
    0.6, 'expert_rule',
    'candidate', 'Textiles -> T12 : T12 = materiaux et produits manufactures. Les textiles manufactures (tissus, fils) sont des produits manufactures au sens PAD. | [AUDIT-R1] Textiles manufacturés → T12 produits manufacturés. Pertinent.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 48/88: group|05.2|T12
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '05.2', 'T12',
    0.6, 'expert_rule',
    'candidate', 'Vetements et fourrures -> T12 : produits manufactures. Les vetements sont des produits finis manufactures. | [AUDIT-R1] Vêtements → T12 produits manufacturés. Flux réel à Dakar (friperie).', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 49/88: group|05.3|T12
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '05.3', 'T12',
    0.6, 'expert_rule',
    'candidate', 'Cuir et articles en cuir -> T12 : produits manufactures. Les articles en cuir (sacs, chaussures) sont des produits manufactures. | [AUDIT-R1] Articles en cuir → T12 produits manufacturés. Acceptable.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 50/88: group|06.1|T04
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '06.1', 'T04',
    0.85, 'expert_rule',
    'candidate', 'Produits en bois et liege (hors meubles) -> T04 : T04 = bois et produits divers. Match direct entre bois et le label PAD T04. | [AUDIT-R1] Match direct : T04 = ''Bois et produits divers''. Produits en bois → T04.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T04 = ''Bois et produits divers''', true, true
  );

  -- Rule 51/88: group|06.2|T04
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '06.2', 'T04',
    0.75, 'expert_rule',
    'candidate', 'Pate a papier, papier et produits en papier -> T04 : T04 = bois et produits divers. Le papier derive du bois. Ambiguite possible avec T12 pour les produits en papier tres transformes. | [AUDIT-R1] Pâte à papier, papier → T04 ''Bois et produits divers''. Le papier dérive du bois.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 52/88: group|06.3|T12
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '06.3', 'T12',
    0.55, 'expert_rule',
    'candidate', 'Imprimes et medias enregistres -> T12 : produits manufactures. Les imprimes sont des produits manufactures finis. Pourraient aussi relever de T01 (biens de valeur) si haute valeur. | [AUDIT-R1] Imprimés et médias enregistrés → T12 produits manufacturés. Acceptable.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 53/88: group|07.1|T07
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '07.1', 'T07',
    0.8, 'expert_rule',
    'candidate', 'Coke, briquettes, combustibles solides -> T07 : T07 = clinker, farine, charbon, sable et vracs pondereux. Le coke et les combustibles solides sont des vracs pondereux. | [AUDIT-R1] Coke, briquettes, combustibles solides → T07 vracs pondéreux. T07 cite ''charbon''.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T07', true, true
  );

  -- Rule 54/88: group|07.2|T06
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '07.2', 'T06',
    0.55, 'expert_rule',
    'candidate', 'Produits petroliers liquides raffines -> T06 : T06 = gasoil, fuel oil, diesel. Le gasoil et le diesel sont des produits petroliers raffines liquides. Conflit T06/T11 : T06 couvre les carburants courants en vrac, T11 couvre les hydrocarbures raffines au sens large. | [AUDIT-R1] CONFLIT T06/T11 : T06 = carburants courants en vrac (gasoil, fuel oil), T11 = hydrocarbures raffinés au sens large. T06 pertinent si carburants courants. Candidat secondaire.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T06 = ''Gasoil, fuel oil, diesel, butane en vrac, phosphates''', true, true
  );

  -- Rule 55/88: group|07.2|T11
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '07.2', 'T11',
    0.85, 'nstr_bridge_inferred',
    'candidate', 'Produits petroliers liquides raffines -> T11 : T11 = petrole brut, essences, bitumes, hydrocarbures raffines. Match direct. Le pont NSTR->NST2007 (76 mappings pour division 07) confirme que les codes NSTR petroliers historiques convergent vers NST 07.2, et le label PAD T11 couvre explicitement les produits petroliers raffines. | [AUDIT-R1] NSTR bridge vérifié : 37 mappings NSTR pour le groupe 07.2 (pas 76 comme cité dans le manifeste — 76 est le total division 07). T11 cite ''essences, bitumes, hydrocarbures raffinés''. Match direct confirmé par bridge NSTR. Note : le manifeste citait le total division (76), corrigé ici au group-level (37).', 'nstr_nst2007_mappings (DB table, 9776 non-quarantined rows)',
    '76 mappings NSTR division 07 + label PAD T11', true, true
  );

  -- Rule 56/88: group|07.3|T06
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '07.3', 'T06',
    0.8, 'expert_rule',
    'candidate', 'Produits petroliers gazeux, liquefies ou comprimes -> T06 : T06 = gasoil, fuel oil, diesel, butane en vrac. Le butane est un gaz petrolier liquefie, explicitement dans T06. | [AUDIT-R1] T06 cite ''butane en vrac''. Produits pétroliers gazeux/liquéfiés → T06. Match direct.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T06 = ''Gasoil, fuel oil, diesel, butane en vrac, phosphates''', true, true
  );

  -- Rule 57/88: group|07.4|T11
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '07.4', 'T11',
    0.8, 'expert_rule',
    'candidate', 'Produits petroliers solides ou cireux -> T11 : T11 = petrole brut, essences, bitumes, hydrocarbures raffines. Les bitumes (solides/cireux) sont explicitement dans le label T11. | [AUDIT-R1] T11 cite ''bitumes''. Produits pétroliers solides/cireux → T11.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T11', true, true
  );

  -- Rule 58/88: group|08.1|T03
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '08.1', 'T03',
    0.8, 'expert_rule',
    'candidate', 'Produits chimiques mineraux de base -> T03 : T03 = acides, sucres et matieres premieres. Les acides (sulfurique, chlorhydrique) sont des chimiques mineraux de base, explicitement dans le label T03. | [AUDIT-R1] T03 cite ''Acides''. Produits chimiques minéraux de base (acides) → T03. Match direct.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T03 = ''Acides, sucres et matieres premieres''', true, true
  );

  -- Rule 59/88: group|08.2|T03
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '08.2', 'T03',
    0.6, 'expert_rule',
    'candidate', 'Produits chimiques organiques de base -> T03 : matieres premieres chimiques. Les solvants, alcools industriels sont des matieres premieres. Ambiguite possible avec T12 pour les produits chimiques finis. | [AUDIT-R1] Chimie organique de base → T03 matières premières chimiques. Pertinent mais ambiguïté avec T12 pour produits finis.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 60/88: group|08.3|T08
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '08.3', 'T08',
    0.65, 'expert_rule',
    'candidate', 'Composes azotes et engrais -> T08 : T08 = attapulgite, phosphates, ferrailles, tourteaux, cellulose. Les engrais chimiques et composes azotes se rapprochent des phosphates/mineraux de T08. | [AUDIT-R1] Engrais azotés → T08. T08 couvre phosphates et produits fertilisants. Pertinent. Flux réel au Sénégal (ICS).', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T08', true, true
  );

  -- Rule 61/88: group|08.4|T03
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '08.4', 'T03',
    0.55, 'expert_rule',
    'candidate', 'Plastiques de base et caoutchouc synthetique en formes primaires -> T03 : T03 = matieres premieres. Les resines, granules plastiques bruts sont des matieres premieres industrielles. | [AUDIT-R1] CONFLIT T03/T12 : granulés plastiques bruts = matière première (T03) vs plaques/films semi-finis (T12). Dépend du degré de transformation. Validation opérateur nécessaire.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 62/88: group|08.4|T12
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '08.4', 'T12',
    0.45, 'expert_rule',
    'candidate', 'Plastiques de base -> T12 : T12 = materiaux et produits manufactures. Si le plastique est sous forme semi-finie (plaques, films), il peut relever de T12. Conflit 08.4 : T03 (matiere premiere brute) vs T12 (semi-fini). Validation operateur necessaire. | [AUDIT-R1] T12 secondaire pour plastiques semi-finis. Confidence baissée car T03 est prioritaire pour les formes primaires.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 63/88: group|08.5|T01
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '08.5', 'T01',
    0.6, 'expert_rule',
    'candidate', 'Produits pharmaceutiques et parachemiques -> T01 : T01 = biens de valeur. Les medicaments sont des produits de haute valeur. Alias PAD pertinents sous T01. Ambiguite avec T02 pour les produits parachemiques courants. | [AUDIT-R1] Produits pharmaceutiques = biens de valeur → T01. Flux réel à Dakar. Pertinent.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 64/88: group|08.6|T12
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '08.6', 'T12',
    0.75, 'expert_rule',
    'candidate', 'Produits en caoutchouc ou plastique -> T12 : T12 = materiaux et produits manufactures. Les pneus, tuyaux PVC, articles plastiques finis sont des produits manufactures. | [AUDIT-R1] Produits en caoutchouc/plastique finis (pneus, tuyaux) → T12 produits manufacturés. Flux réel à Dakar.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 65/88: group|09.1|T12
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '09.1', 'T12',
    0.6, 'expert_rule',
    'candidate', 'Verre, ceramique, porcelaine -> T12 : T12 = materiaux et produits manufactures. Les produits en verre et ceramique sont des produits manufactures. | [AUDIT-R1] Verre, céramique, porcelaine → T12 produits manufacturés. Pertinent.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 66/88: group|09.2|T05
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '09.2', 'T05',
    0.85, 'expert_rule',
    'candidate', 'Ciment, chaux, platre -> T05 : T05 = cereales, ciment, riz et produits assimiles. Le ciment est explicitement dans le label T05. Match direct. | [AUDIT-R1] Match direct : T05 cite ''ciment''. CONFLIT T05/T07 documenté : ciment fini → T05, clinker/vrac → T07. Candidat primaire pour ciment conditionné.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T05 = ''Cereales, ciment, riz et produits assimiles''', true, true
  );

  -- Rule 67/88: group|09.2|T07
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '09.2', 'T07',
    0.55, 'expert_rule',
    'candidate', 'Ciment -> T07 : T07 = clinker, farine, charbon, sable et vracs pondereux. Le clinker (matiere premiere du ciment) est dans T07. Conflit T05/T07 : depend si ciment fini (T05) ou clinker/vrac (T07). Validation operateur necessaire. | [AUDIT-R1] CONFLIT T05/T07 : T07 cite ''clinker''. Candidat si clinker ou ciment en vrac. Secondaire derrière T05 pour ciment fini.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T07', true, true
  );

  -- Rule 68/88: group|09.3|T07
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '09.3', 'T07',
    0.55, 'expert_rule',
    'candidate', 'Materiaux de construction en vrac -> T07 : T07 = vracs pondereux. Si les materiaux sont en vrac (graviers, agregats), ils relevent de T07. Candidate secondaire, depend du conditionnement. | [AUDIT-R1] Matériaux de construction en vrac (graviers, agrégats) → T07. Dépend du conditionnement.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 69/88: group|09.3|T12
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '09.3', 'T12',
    0.6, 'expert_rule',
    'candidate', 'Autres materiaux de construction manufactures -> T12 : T12 = materiaux et produits manufactures. Carrelage, briques, tuiles sont des materiaux de construction manufactures. | [AUDIT-R1] Carrelage, briques, tuiles → T12 matériaux de construction manufacturés. Pertinent.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 70/88: group|10.1|T14
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '10.1', 'T14',
    0.85, 'nstr_bridge_inferred',
    'candidate', 'Fer, acier de base, ferro-alliages et produits de premiere transformation -> T14 : T14 = fil machine et feuillard. Les produits siderurgiques de premiere transformation (barres, billettes, fil machine) correspondent directement a T14. Le pont NSTR->NST2007 (1039 mappings pour division 10) confirme la convergence des codes NSTR siderurgiques historiques vers NST 10.1. | [AUDIT-R1] Match direct : T14 = ''Fil machine et feuillard''. NSTR bridge vérifié : 348 mappings NSTR pour le groupe 10.1 (pas 1039 — 1039 est le total division 10). Produits sidérurgiques de première transformation → T14. Note manifeste corrigée.', 'nstr_nst2007_mappings (DB table, 9776 non-quarantined rows)',
    '1039 mappings NSTR division 10 + label PAD T14', true, true
  );

  -- Rule 71/88: group|10.2|T12
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '10.2', 'T12',
    0.6, 'expert_rule',
    'candidate', 'Metaux non ferreux et produits derives -> T12 : T12 = materiaux et produits manufactures. Les metaux non ferreux transformes (aluminium, cuivre en plaques/fils) sont des materiaux manufactures. | [AUDIT-R1] Métaux non ferreux transformés (aluminium, cuivre) → T12 matériaux manufacturés. Pertinent.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 72/88: group|10.3|T12
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '10.3', 'T12',
    0.75, 'expert_rule',
    'candidate', 'Tubes, tuyaux, profiles creux -> T12 : T12 = materiaux et produits manufactures. Les tubes et profiles metalliques sont des produits manufactures. | [AUDIT-R1] Tubes, tuyaux, profilés creux → T12 produits manufacturés. Flux réel à Dakar.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 73/88: group|10.4|T12
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '10.4', 'T12',
    0.75, 'expert_rule',
    'candidate', 'Produits metalliques structurels -> T12 : T12 = materiaux et produits manufactures. Les charpentes, pylones, structures metalliques sont des materiaux manufactures. | [AUDIT-R1] Charpentes, pylônes, structures métalliques → T12. Flux réel à Dakar.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 74/88: group|10.5|T12
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '10.5', 'T12',
    0.6, 'expert_rule',
    'candidate', 'Chaudieres, quincaillerie, armes, autres produits metalliques -> T12 : produits manufactures. Ambiguite avec T01 pour les armes (biens de valeur). Confidence moyenne. | [AUDIT-R1] Chaudières, quincaillerie → T12 produits manufacturés. Candidat principal pour le groupe.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 75/88: group|11.1|T09
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '11.1', 'T09',
    0.8, 'expert_rule',
    'candidate', 'Machines agricoles et forestieres -> T09 : T09 = tracteurs, vehicules industriels et materiel de transport. Les tracteurs agricoles sont explicitement dans le label T09. Match direct. | [AUDIT-R1] Match direct : T09 cite ''Tracteurs''. Machines agricoles → T09.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T09 = ''Tracteurs, vehicules industriels et materiel de transport''', true, true
  );

  -- Rule 76/88: group|11.2|T01
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '11.2', 'T01',
    0.6, 'expert_rule',
    'candidate', 'Appareils menagers (electromenager blanc) -> T01 : T01 = biens de valeur, electronique, informatique et mobilier. L''electromenager est un bien de valeur. Ambiguite possible avec T12 pour les petits appareils courants. | [AUDIT-R1] Électroménager → T01 biens de valeur. Flux réel à Dakar. Ambiguïté avec T12 pour petits appareils.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T01', true, true
  );

  -- Rule 77/88: group|11.3|T01
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '11.3', 'T01',
    0.85, 'expert_rule',
    'candidate', 'Machines de bureau et ordinateurs -> T01 : T01 = biens de valeur, electronique, informatique et mobilier. L''informatique est explicitement dans le label T01. Alias PAD existants : ''mat informatique ordinateurs''. Match direct fort. | [AUDIT-R1] Match direct : T01 cite ''informatique''. Alias PAD : ''mat informatique ordinateurs'' → T01.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T01 + alias PAD ''mat informatique ordinateurs'' -> T01', true, true
  );

  -- Rule 78/88: group|11.4|T01
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '11.4', 'T01',
    0.6, 'expert_rule',
    'candidate', 'Machines et appareils electriques NDA -> T01 : T01 = electronique. Les appareils electriques sont assimiles a l''electronique au sens PAD. Ambiguite avec T12 pour les equipements electriques industriels. | [AUDIT-R1] Appareils électriques → T01 ''électronique''. Ambiguïté avec T12 pour équipements industriels.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 79/88: group|11.5|T01
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '11.5', 'T01',
    0.8, 'expert_rule',
    'candidate', 'Composants electroniques, appareils d''emission/transmission -> T01 : T01 = biens de valeur, electronique. Les composants electroniques sont des biens de valeur. | [AUDIT-R1] Composants électroniques → T01 ''électronique''. Match direct.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T01', true, true
  );

  -- Rule 80/88: group|11.6|T01
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '11.6', 'T01',
    0.85, 'expert_rule',
    'candidate', 'TV, radio, appareils audio/video -> T01 : T01 = biens de valeur, electronique. Alias PAD existants : ''electrophones chaines hifi'', ''magnetophones magnetoscopes tv''. Match direct. | [AUDIT-R1] TV, radio, audio/vidéo → T01. Alias PAD confirmés : ''electrophones chaines hifi'', ''magnetophones magnetoscopes tv''.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Alias PAD : ''electrophones chaines hifi'' -> T01, ''magnetophones magnetoscopes tv'' -> T01', true, true
  );

  -- Rule 81/88: group|11.7|T01
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '11.7', 'T01',
    0.8, 'expert_rule',
    'candidate', 'Instruments medicaux, de precision, optiques, horlogerie -> T01 : T01 = biens de valeur. Alias PAD existants : ''horlogerie'', ''instruments de mesure'', ''appareils scientifiques''. Match direct. | [AUDIT-R1] Instruments médicaux, optiques, horlogerie → T01 biens de valeur. Alias PAD : ''horlogerie'', ''instruments de mesure''.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Alias PAD : ''horlogerie'' -> T01, ''instruments de mesure'' -> T01', true, true
  );

  -- Rule 82/88: group|11.8|T09
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '11.8', 'T09',
    0.55, 'expert_rule',
    'candidate', 'Autres machines, machines-outils et pieces -> T09 : T09 = vehicules industriels et materiel de transport. Les machines-outils industrielles se rapprochent du materiel industriel de T09. | [AUDIT-R1] Machines-outils industrielles → T09. Pertinent mais confidence ajustée car le groupe est hétérogène.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 83/88: group|12.1|T09
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '12.1', 'T09',
    0.85, 'nstr_bridge_inferred',
    'candidate', 'Produits de l''industrie automobile -> T09 : T09 = tracteurs, vehicules industriels et materiel de transport. Les vehicules automobiles correspondent directement a T09. Le pont NSTR->NST2007 (312 mappings pour division 12) confirme la convergence des codes NSTR transport vers NST 12.1. | [AUDIT-R1] Match direct : T09 = ''Tracteurs, véhicules industriels et matériel de transport''. NSTR bridge vérifié : 164 mappings NSTR pour le groupe 12.1 (pas 312 — 312 est le total division 12). Note manifeste corrigée.', 'nstr_nst2007_mappings (DB table, 9776 non-quarantined rows)',
    '312 mappings NSTR division 12 + label PAD T09', true, true
  );

  -- Rule 84/88: group|12.2|T09
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '12.2', 'T09',
    0.8, 'expert_rule',
    'candidate', 'Autres materiels de transport -> T09 : T09 = materiel de transport. Les navires, avions, wagons, remorques sont du materiel de transport. | [AUDIT-R1] Navires, avions, wagons, remorques → T09 matériel de transport.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T09', true, true
  );

  -- Rule 85/88: group|13.1|T01
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '13.1', 'T01',
    0.8, 'expert_rule',
    'candidate', 'Meubles -> T01 : T01 = biens de valeur, electronique, informatique et mobilier. Le mobilier est explicitement dans le label T01. Match direct. | [AUDIT-R1] Match direct : T01 cite ''mobilier''. Meubles → T01.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Label PAD T01 = ''Biens de valeur, electronique, informatique et mobilier''', true, true
  );

  -- Rule 86/88: group|13.2|T01
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '13.2', 'T01',
    0.45, 'expert_rule',
    'candidate', 'Produits manufactures de valeur -> T01 : T01 = biens de valeur. Certains articles (bijouterie vraie, instruments de musique) sont classes T01 par alias PAD existants. Candidate secondaire, depend du produit exact. | [AUDIT-R1] T01 pertinent uniquement pour bijouterie vraie, instruments de musique (alias PAD). Trop partiel. Confidence baissée.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Alias PAD : ''bijouterie sauf bijouterie fantaisie'' -> T01, ''instruments de musique'' -> T01', true, true
  );

  -- Rule 87/88: group|13.2|T12
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '13.2', 'T12',
    0.6, 'expert_rule',
    'candidate', 'Autres produits manufactures -> T12 : T12 = materiaux et produits manufactures. Les produits manufactures divers (jouets, articles de sport, bijouterie fantaisie) relevent de T12. | [AUDIT-R1] Produits manufacturés divers (jouets, articles de sport) → T12. Candidat principal pour le groupe.', 'PAD_NST_RECOMMENDATION_ENGINE.md',
    'Section 6 — Rapprochement indicatif NST -> familles PAD (lignes 412-433)', true, true
  );

  -- Rule 88/88: group|14.2|T08
  INSERT INTO public.pad_nst_recommendation_rules (
    nst_level, nst_code, pad_category, confidence, evidence_level,
    validation_status, notes, source_document, source_reference,
    requires_operator_validation, is_active
  ) VALUES (
    'group', '14.2', 'T08',
    0.6, 'nstr_bridge_inferred',
    'candidate', 'Autres dechets et matieres premieres secondaires -> T08 : T08 = attapulgite, phosphates, ferrailles, tourteaux, cellulose. Les ferrailles (matiere premiere secondaire) sont explicitement dans T08. Le pont NSTR->NST2007 (118 mappings pour division 14) confirme la convergence des codes NSTR dechets/ferrailles vers NST 14.2. | [AUDIT-R1] T08 cite ''ferrailles''. NSTR bridge vérifié : 117 mappings NSTR pour le groupe 14.2 (pas 118 — 118 est le total division 14, incluant 1 mapping pour 14.1). Note manifeste corrigée. Matières premières secondaires/ferrailles → T08.', 'nstr_nst2007_mappings (DB table, 9776 non-quarantined rows)',
    '118 mappings NSTR division 14 + label PAD T08', true, true
  );

  -- ============ CONTRÔLES POST-IMPORT ============

  -- Contrôle 1: count total = 88
  SELECT count(*) INTO v_count FROM public.pad_nst_recommendation_rules;
  IF v_count != 88 THEN
    RAISE EXCEPTION 'ECHEC: count total = %, attendu 88', v_count;
  END IF;

  -- Contrôle 2: aucune validated
  SELECT count(*) INTO v_bad_status FROM public.pad_nst_recommendation_rules WHERE validation_status != 'candidate';
  IF v_bad_status != 0 THEN
    RAISE EXCEPTION 'ECHEC: % règles avec validation_status != candidate', v_bad_status;
  END IF;

  -- Contrôle 3: aucune requires_operator_validation = false
  SELECT count(*) INTO v_bad_validation FROM public.pad_nst_recommendation_rules WHERE requires_operator_validation = false;
  IF v_bad_validation != 0 THEN
    RAISE EXCEPTION 'ECHEC: % règles avec requires_operator_validation = false', v_bad_validation;
  END IF;

  -- Contrôle 4: aucune is_active = false
  SELECT count(*) INTO v_bad_active FROM public.pad_nst_recommendation_rules WHERE is_active = false;
  IF v_bad_active != 0 THEN
    RAISE EXCEPTION 'ECHEC: % règles avec is_active = false', v_bad_active;
  END IF;

  -- Contrôle 5: evidence_level strict
  SELECT count(*) INTO v_bad_evidence FROM public.pad_nst_recommendation_rules
    WHERE evidence_level NOT IN ('expert_rule', 'nstr_bridge_inferred');
  IF v_bad_evidence != 0 THEN
    RAISE EXCEPTION 'ECHEC: % règles avec evidence_level invalide', v_bad_evidence;
  END IF;

  -- Contrôle 6: confidence range
  SELECT min(confidence), max(confidence) INTO v_min_conf, v_max_conf FROM public.pad_nst_recommendation_rules;
  IF v_min_conf != 0.45 OR v_max_conf != 0.85 THEN
    RAISE EXCEPTION 'ECHEC: confidence range %-%, attendu 0.45-0.85', v_min_conf, v_max_conf;
  END IF;

  RAISE NOTICE 'PAD-NST-2E-B: 88 règles importées avec succès, tous contrôles OK';
END $$;
