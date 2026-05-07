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

  SELECT count(*) INTO v_count FROM public.pad_nst_recommendation_rules;
  IF v_count != 0 THEN
    RAISE EXCEPTION 'Table non vide avant import: % lignes existantes', v_count;
  END IF;

  INSERT INTO public.pad_nst_recommendation_rules (nst_level, nst_code, pad_category, confidence, evidence_level, validation_status, notes, source_document, source_reference, requires_operator_validation, is_active) VALUES
  ('division', '01', 'P05', 0.5, 'expert_rule', 'candidate', 'Division 01 inclut ''fish and other fishing products'' (groupe 01.B). P05 = produits de peche NDA. | [AUDIT-R1] P05 pertinent uniquement pour le sous-groupe peche (01.B). Candidat secondaire peche.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('division', '02', 'T07', 0.5, 'expert_rule', 'candidate', 'Division 02 inclut charbon et lignite (02.1). T07 = clinker, charbon, vracs pondereux. | [AUDIT-R1] T07 pertinent pour charbon (02.1) mais pas petrole. Candidat secondaire charbon.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('division', '02', 'T11', 0.55, 'expert_rule', 'candidate', 'Division 02 = charbon, petrole brut, gaz naturel. T11 = petrole brut, essences, bitumes. | [AUDIT-R1] T11 pertinent pour petrole brut (02.2). Le petrole domine le trafic.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('division', '03', 'T03', 0.5, 'expert_rule', 'candidate', 'Division 03 = minerais metalliques, produits miniers. T03 = matieres premieres. | [AUDIT-R1] T03 pertinent pour minerais (03.1, 03.2) mais division inclut aussi sel, sable, phosphates.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('division', '03', 'T08', 0.45, 'expert_rule', 'candidate', 'Division 03 inclut mineraux fertilisants (03.3). T08 = phosphates, ferrailles. | [AUDIT-R1] T08 pertinent pour phosphates (03.3) uniquement. Candidat secondaire.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('division', '04', 'T02', 0.5, 'expert_rule', 'candidate', 'Division 04 = produits alimentaires, boissons, tabac. T02 = marchandises generales. | [AUDIT-R1] T02 par defaut pour denrees alimentaires transformees.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('division', '05', 'T12', 0.55, 'expert_rule', 'candidate', 'Division 05 = textiles, cuir. T12 = produits manufactures. | [AUDIT-R1] T12 pertinent pour textiles et cuir manufactures. Coherent avec group-level 05.x.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('division', '06', 'T04', 0.75, 'expert_rule', 'candidate', 'Division 06 = bois, liege, papier. T04 = bois et produits divers. Match direct label PAD. | [AUDIT-R1] Match direct : label PAD T04 = Bois et produits divers.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('division', '07', 'T11', 0.75, 'expert_rule', 'candidate', 'Division 07 = coke et produits petroliers raffines. T11 = petrole brut, essences, bitumes. Match direct. | [AUDIT-R1] Match direct : label PAD T11 = Petrole brut, hydrocarbures raffines.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('division', '08', 'T03', 0.45, 'expert_rule', 'candidate', 'Division 08 = chimie, plastiques, caoutchouc. T03 = acides, matieres premieres. | [AUDIT-R1] T03 pertinent pour chimie de base (08.1). Division trop heterogene.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('division', '09', 'T05', 0.45, 'expert_rule', 'candidate', 'Division 09 inclut ciment (09.2). T05 = cereales, ciment, riz. | [AUDIT-R1] T05 pertinent pour ciment fini (09.2). Conflit T05/T07 a resoudre au group-level.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('division', '09', 'T07', 0.55, 'expert_rule', 'candidate', 'Division 09 = produits mineraux non metalliques. T07 = clinker, sable, vracs pondereux. | [AUDIT-R1] T07 pertinent pour clinker, sable, materiaux de carriere.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('division', '10', 'T12', 0.5, 'expert_rule', 'candidate', 'Division 10 inclut produits metalliques fabriques (10.3-10.5). T12 = produits manufactures. | [AUDIT-R1] T12 pertinent pour produits metalliques fabriques. Candidat secondaire derriere T14.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('division', '10', 'T14', 0.7, 'expert_rule', 'candidate', 'Division 10 = metaux de base. T14 = fil machine et feuillard. | [AUDIT-R1] Match direct : label PAD T14 = Fil machine et feuillard. Metaux de base.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('division', '11', 'T01', 0.55, 'expert_rule', 'candidate', 'Division 11 = machines, informatique, electronique. T01 = biens de valeur, electronique, informatique. | [AUDIT-R1] T01 pertinent pour informatique et electronique (11.3-11.7). Division heterogene.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('division', '12', 'T09', 0.75, 'expert_rule', 'candidate', 'Division 12 = materiel de transport. T09 = tracteurs, vehicules industriels et materiel de transport. Match direct. | [AUDIT-R1] Match direct : label PAD T09.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('division', '13', 'T01', 0.7, 'expert_rule', 'candidate', 'Division 13 = meubles et produits manufactures. T01 = biens de valeur, mobilier. Mobilier explicite dans label T01. | [AUDIT-R1] Match direct : label PAD T01 mentionne mobilier.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('division', '13', 'T12', 0.5, 'expert_rule', 'candidate', 'Division 13 inclut autres produits manufactures (13.2). T12 = produits manufactures. | [AUDIT-R1] T12 candidat secondaire coherent pour 13.2.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('division', '14', 'T08', 0.5, 'expert_rule', 'candidate', 'Division 14 = matieres premieres secondaires, dechets. T08 = ferrailles. | [AUDIT-R1] T08 ferrailles pertinent pour matieres premieres secondaires mais pas dechets municipaux.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '01.1', 'T05', 0.85, 'expert_rule', 'candidate', 'Cereales -> T05 : label PAD T05 mentionne explicitement cereales, ciment, riz. Match direct. | [AUDIT-R1] Match direct : cereales explicitement nommees dans label T05.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Label PAD T05', true, true),
  ('group', '01.2', 'T02', 0.5, 'expert_rule', 'candidate', 'Pommes de terre -> T02 : produit agricole frais, marchandises generales par defaut. | [AUDIT-R1] Produit agricole frais sans categorie PAD dediee. T02 par defaut.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '01.3', 'T02', 0.55, 'expert_rule', 'candidate', 'Legumes -> T02 : produits agricoles frais, marchandises generales. | [AUDIT-R1] Legumes frais sans categorie PAD specifique. T02 par defaut.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '01.4', 'T02', 0.55, 'expert_rule', 'candidate', 'Fruits -> T02 : produits agricoles frais. | [AUDIT-R1] Fruits frais sans categorie PAD specifique. T02 par defaut. Coherent avec 01.2 et 01.3.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '01.5', 'T02', 0.5, 'expert_rule', 'candidate', 'Plantes textiles et oleagineuses -> T02 : produits agricoles bruts. | [AUDIT-R1] Produits agricoles bruts. T02 par defaut. Ambiguite T03/T08 possible.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '01.6', 'T04', 0.75, 'expert_rule', 'candidate', 'Bois rond -> T04 : match direct avec label PAD T04 = Bois et produits divers. | [AUDIT-R1] Match direct : bois rond est explicitement du bois. Label T04 = Bois.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Label PAD T04', true, true),
  ('group', '01.9', 'T02', 0.45, 'expert_rule', 'candidate', 'Animaux vivants, plantes -> T02 : marchandises generales par defaut. | [AUDIT-R1] Categorie residuelle tres heterogene. T02 par defaut a faible confiance.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '01.A', 'P05', 0.5, 'expert_rule', 'candidate', 'Poisson, crustaces -> P05 : produits de peche NDA. | [AUDIT-R1] P05 pertinent pour peche artisanale/industrielle. Ambiguite P01-P04 pour produits specifiques.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '02.1', 'T07', 0.85, 'expert_rule', 'candidate', 'Charbon et lignite -> T07 : le label T07 mentionne explicitement charbon. Match direct. | [AUDIT-R1] Match direct : label PAD T07 = clinker, farine, charbon, sable et vracs pondereux.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Label PAD T07', true, true),
  ('group', '02.2', 'T11', 0.85, 'expert_rule', 'candidate', 'Petrole brut -> T11 : match direct avec label PAD T11. | [AUDIT-R1] Match direct : label PAD T11 = Petrole brut, essences, bitumes, hydrocarbures raffines.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Label PAD T11', true, true),
  ('group', '02.3', 'T11', 0.7, 'expert_rule', 'candidate', 'Gaz naturel -> T11 : hydrocarbures gazeux assimiles aux hydrocarbures raffines. | [AUDIT-R1] T11 le plus proche pour gaz naturel. Pas de categorie PAD dediee gaz.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '03.1', 'T03', 0.6, 'expert_rule', 'candidate', 'Minerais de fer -> T03 : matieres premieres brutes. | [AUDIT-R1] T03 pertinent pour minerais de fer. Ambiguite avec T08 (ferrailles) et T14 (acier).', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '03.2', 'T03', 0.55, 'expert_rule', 'candidate', 'Minerais non ferreux -> T03 : matieres premieres brutes. | [AUDIT-R1] T03 pertinent comme candidat principal pour minerais bruts. Confiance moderee.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '03.3', 'T08', 0.85, 'nstr_bridge_inferred', 'candidate', 'Phosphates, potasse -> T08 : match direct avec label PAD T08 = phosphates. | [AUDIT-R1] Match direct : label PAD T08 mentionne explicitement phosphates. NSTR bridge confirme 37 mappings.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Label PAD T08 + NSTR bridge', true, true),
  ('group', '03.4', 'T10', 0.85, 'expert_rule', 'candidate', 'Sel -> T10 : le label PAD T10 mentionne explicitement sel. Match direct. | [AUDIT-R1] Match direct : label PAD T10 = Sel, soufre, terres et pierres.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Label PAD T10', true, true),
  ('group', '03.5', 'T10', 0.75, 'expert_rule', 'candidate', 'Pierre, sable, gravier -> T10 : le label T10 mentionne terres et pierres. | [AUDIT-R1] T10 pertinent pour pierre/sable/gravier. Ambiguite T07 pour sable en vrac.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Label PAD T10', true, true),
  ('group', '03.6', 'T03', 0.45, 'expert_rule', 'candidate', 'Autres produits miniers -> T03 : matieres premieres brutes residuelles. | [AUDIT-R1] Categorie residuelle. T03 par defaut a faible confiance.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '04.1', 'T02', 0.55, 'expert_rule', 'candidate', 'Viandes -> T02 : denrees alimentaires, marchandises generales. | [AUDIT-R1] Denree alimentaire sans categorie PAD specifique. T02 par defaut.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '04.2', 'T05', 0.6, 'expert_rule', 'candidate', 'Huiles et graisses -> T05 : assimilees aux produits alimentaires de base. | [AUDIT-R1] T05 cereales/produits assimiles. Huiles alimentaires y sont souvent classees a Dakar.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '04.3', 'T02', 0.5, 'expert_rule', 'candidate', 'Produits laitiers -> T02 : denrees alimentaires generales. | [AUDIT-R1] Produits laitiers sans categorie PAD specifique. T02 par defaut.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '04.4', 'T02', 0.55, 'expert_rule', 'candidate', 'Autres produits alimentaires -> T02 : denrees alimentaires transformees. | [AUDIT-R1] T02 par defaut pour alimentaire transforme. Coherent avec division 04.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '04.5', 'T01', 0.7, 'expert_rule', 'candidate', 'Boissons -> T01 : le label PAD T01 inclut biens de valeur. Alias PAD existant pour boissons alcoolisees sous T01. | [AUDIT-R1] Alias PAD existant confirme boissons alcoolisees sous T01.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Alias PAD T01', true, true),
  ('group', '04.6', 'T02', 0.45, 'expert_rule', 'candidate', 'Tabac -> T02 : marchandises generales par defaut. | [AUDIT-R1] Tabac sans categorie PAD specifique. T02 par defaut a faible confiance.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '05.1', 'T12', 0.6, 'expert_rule', 'candidate', 'Textiles et habillement -> T12 : produits manufactures. | [AUDIT-R1] T12 pertinent pour textiles manufactures. Coherent avec division 05.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '05.2', 'T12', 0.55, 'expert_rule', 'candidate', 'Cuir et articles en cuir -> T12 : produits manufactures. | [AUDIT-R1] T12 pertinent pour articles en cuir manufactures.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '06.1', 'T04', 0.85, 'expert_rule', 'candidate', 'Bois et produits du bois -> T04 : match direct avec label PAD T04 = Bois et produits divers. | [AUDIT-R1] Match direct : label PAD T04 = Bois et produits divers. Bois explicitement nomme.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Label PAD T04', true, true),
  ('group', '06.2', 'T04', 0.6, 'expert_rule', 'candidate', 'Papier, carton -> T04 : bois et produits divers inclut derives du bois. | [AUDIT-R1] T04 Bois et produits divers couvre derives du bois. Papier = derive du bois.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Label PAD T04', true, true),
  ('group', '07.1', 'T11', 0.85, 'expert_rule', 'candidate', 'Coke -> T11 : hydrocarbures solides assimiles. | [AUDIT-R1] Coke = derive du charbon/petrole, classe avec hydrocarbures. T11 pertinent.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '07.2', 'T11', 0.85, 'expert_rule', 'candidate', 'Produits petroliers raffines -> T11 : match direct avec label PAD T11. | [AUDIT-R1] Match direct : label PAD T11 = essences, bitumes, hydrocarbures raffines. NSTR bridge confirme 76 mappings.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Label PAD T11 + NSTR bridge', true, true),
  ('group', '08.1', 'T03', 0.6, 'expert_rule', 'candidate', 'Produits chimiques de base -> T03 : acides, matieres premieres chimiques. | [AUDIT-R1] T03 pertinent pour chimie de base. Label T03 = acides, matieres premieres.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Label PAD T03', true, true),
  ('group', '08.2', 'T08', 0.65, 'expert_rule', 'candidate', 'Engrais -> T08 : label T08 inclut phosphates et tourteaux. | [AUDIT-R1] T08 pertinent pour engrais chimiques. Lien direct phosphates/tourteaux.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Label PAD T08', true, true),
  ('group', '08.3', 'T12', 0.55, 'expert_rule', 'candidate', 'Plastiques, caoutchouc synthetique -> T12 : produits manufactures. | [AUDIT-R1] T12 pertinent pour plastiques et caoutchouc manufactures.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '08.5', 'T01', 0.55, 'expert_rule', 'candidate', 'Produits pharmaceutiques -> T01 : biens de valeur. Pharma = haute valeur. | [AUDIT-R1] T01 biens de valeur pertinent pour pharma. Confiance moderee.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '08.6', 'T02', 0.5, 'expert_rule', 'candidate', 'Autres produits chimiques -> T02 : marchandises generales par defaut. | [AUDIT-R1] T02 par defaut pour chimie NDA. Confiance moderee.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '08.7', 'T03', 0.45, 'expert_rule', 'candidate', 'Fibres synthetiques -> T03 : matieres premieres de synthese. | [AUDIT-R1] T03 pertinent comme matiere premiere synthetique. Confiance faible.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '09.1', 'T12', 0.55, 'expert_rule', 'candidate', 'Verre, produits en verre -> T12 : produits manufactures. | [AUDIT-R1] T12 pertinent pour verre manufacture. Coherent avec division 09.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '09.2', 'T05', 0.85, 'expert_rule', 'candidate', 'Ciment, chaux, platre -> T05 : match direct avec label PAD T05 = cereales, ciment, riz. | [AUDIT-R1] Match direct : label PAD T05 mentionne explicitement ciment.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Label PAD T05', true, true),
  ('group', '09.3', 'T12', 0.55, 'expert_rule', 'candidate', 'Ceramique, materiaux de construction -> T12 : produits manufactures. | [AUDIT-R1] T12 pertinent pour materiaux de construction manufactures.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '10.1', 'T14', 0.85, 'nstr_bridge_inferred', 'candidate', 'Fer et acier de base -> T14 : match direct avec label PAD T14 = fil machine et feuillard. NSTR bridge confirme 348 mappings. | [AUDIT-R1] Match direct avec NSTR bridge confirme. 348 mappings vers T14.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Label PAD T14 + NSTR bridge 348 mappings', true, true),
  ('group', '10.2', 'T14', 0.75, 'expert_rule', 'candidate', 'Metaux non ferreux -> T14 : fil machine et feuillard, par extension metaux de base. | [AUDIT-R1] T14 pertinent par extension pour metaux de base non ferreux.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '10.3', 'T12', 0.6, 'expert_rule', 'candidate', 'Produits metalliques structurels -> T12 : produits manufactures. | [AUDIT-R1] T12 pertinent pour produits metalliques manufactures.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '10.4', 'T12', 0.55, 'expert_rule', 'candidate', 'Chaudieres, reservoirs -> T12 : produits manufactures industriels. | [AUDIT-R1] T12 pertinent pour equipements metalliques manufactures.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '10.5', 'T12', 0.55, 'expert_rule', 'candidate', 'Armes et munitions -> T12 : produits manufactures. | [AUDIT-R1] T12 par defaut. Marchandises controlee a considerer specificement.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '10.6', 'T08', 0.65, 'expert_rule', 'candidate', 'Ferraille -> T08 : match direct avec label PAD T08 = ferrailles. | [AUDIT-R1] Match direct : label PAD T08 mentionne explicitement ferrailles.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Label PAD T08', true, true),
  ('group', '11.1', 'T09', 0.7, 'expert_rule', 'candidate', 'Moteurs, generateurs -> T09 : tracteurs, vehicules industriels et materiel de transport. | [AUDIT-R1] T09 pertinent pour moteurs et generateurs industriels.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '11.2', 'T09', 0.6, 'expert_rule', 'candidate', 'Machines agricoles et forestieres -> T09 : tracteurs et materiel industriel. | [AUDIT-R1] T09 pertinent pour tracteurs et machines agricoles. Label mentionne tracteurs.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Label PAD T09', true, true),
  ('group', '11.3', 'T01', 0.85, 'expert_rule', 'candidate', 'Informatique -> T01 : match direct avec label PAD T01 = electronique, informatique. | [AUDIT-R1] Match direct : label PAD T01 = biens de valeur, electronique, informatique et mobilier.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Label PAD T01', true, true),
  ('group', '11.4', 'T01', 0.75, 'expert_rule', 'candidate', 'Machines electriques -> T01 : biens de valeur, electronique. | [AUDIT-R1] T01 pertinent pour machines electriques. Coherent avec 11.3.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '11.5', 'T01', 0.7, 'expert_rule', 'candidate', 'Equipements radio, TV, communication -> T01 : electronique. | [AUDIT-R1] T01 pertinent pour equipements electroniques de communication.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Label PAD T01', true, true),
  ('group', '11.6', 'T01', 0.7, 'expert_rule', 'candidate', 'Instruments medicaux, optiques -> T01 : biens de valeur. | [AUDIT-R1] T01 pertinent pour instruments de precision et haute valeur.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '11.7', 'T12', 0.55, 'expert_rule', 'candidate', 'Appareils domestiques -> T12 : produits manufactures. | [AUDIT-R1] T12 pertinent pour electromenager. Ambiguite avec T01 pour appareils haut de gamme.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '11.8', 'T09', 0.55, 'expert_rule', 'candidate', 'Autres machines NDA -> T09 : materiel industriel. | [AUDIT-R1] T09 pertinent pour machines industrielles NDA. Confiance moderee.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '12.1', 'T09', 0.85, 'expert_rule', 'candidate', 'Vehicules automobiles -> T09 : match direct avec label PAD T09 = vehicules industriels et materiel de transport. | [AUDIT-R1] Match direct : vehicules explicitement dans label T09. NSTR bridge confirme.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Label PAD T09', true, true),
  ('group', '12.2', 'T09', 0.75, 'expert_rule', 'candidate', 'Carrosseries, remorques -> T09 : materiel de transport. | [AUDIT-R1] T09 pertinent pour carrosseries et remorques. Coherent avec 12.1.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '12.3', 'T09', 0.6, 'expert_rule', 'candidate', 'Navires, aeronefs -> T09 : materiel de transport. | [AUDIT-R1] T09 pertinent pour navires et aeronefs par extension.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '12.4', 'T09', 0.7, 'expert_rule', 'candidate', 'Pieces detachees vehicules -> T09 : materiel de transport. | [AUDIT-R1] T09 pertinent pour pieces detachees. Coherent avec 12.1-12.3.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '13.1', 'T01', 0.8, 'expert_rule', 'candidate', 'Meubles -> T01 : match direct avec label PAD T01 = mobilier. | [AUDIT-R1] Match direct : label PAD T01 mentionne explicitement mobilier.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Label PAD T01', true, true),
  ('group', '13.2', 'T12', 0.55, 'expert_rule', 'candidate', 'Autres produits manufactures NDA -> T12 : produits manufactures. | [AUDIT-R1] T12 par defaut pour produits manufactures NDA. Confiance moderee.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '14.1', 'T02', 0.45, 'expert_rule', 'candidate', 'Dechets municipaux -> T02 : marchandises generales par defaut. | [AUDIT-R1] T02 par defaut. Dechets municipaux sans categorie PAD specifique.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '14.2', 'T08', 0.65, 'expert_rule', 'candidate', 'Dechets metalliques -> T08 : ferrailles. | [AUDIT-R1] T08 pertinent pour dechets metalliques. Label T08 mentionne ferrailles.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Label PAD T08', true, true),
  ('group', '14.3', 'T02', 0.45, 'expert_rule', 'candidate', 'Autres dechets -> T02 : marchandises generales par defaut. | [AUDIT-R1] T02 par defaut. Dechets divers sans categorie PAD specifique.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '15.1', 'T02', 0.45, 'expert_rule', 'candidate', 'Courrier, colis -> T02 : marchandises generales. | [AUDIT-R1] T02 par defaut pour courrier et colis postaux.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '16.1', 'T09', 0.75, 'expert_rule', 'candidate', 'Conteneurs vides -> T09 : materiel de transport. | [AUDIT-R1] T09 pertinent pour conteneurs vides en tant que materiel de transport.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '17.1', 'T02', 0.6, 'expert_rule', 'candidate', 'Marchandises en demenagement -> T02 : marchandises generales. | [AUDIT-R1] T02 par defaut pour effets personnels et demenagement.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '17.2', 'T02', 0.5, 'expert_rule', 'candidate', 'Marchandises groupees -> T02 : marchandises generales. | [AUDIT-R1] T02 par defaut pour groupage. Categorie PAD depend du contenu reel.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '17.3', 'T02', 0.45, 'expert_rule', 'candidate', 'Marchandises non identifiees -> T02 : marchandises generales par defaut. | [AUDIT-R1] T02 par defaut pour marchandises non identifiees. Confiance minimale.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '17.4', 'T02', 0.45, 'expert_rule', 'candidate', 'Autres NDA -> T02 : marchandises generales. | [AUDIT-R1] T02 par defaut pour categorie residuelle NDA.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Section 6', true, true),
  ('group', '18.1', 'T06', 0.85, 'nstr_bridge_inferred', 'candidate', 'Materiel militaire -> T06 : match direct avec label PAD T06 = materiel militaire. NSTR bridge confirme. | [AUDIT-R1] Match direct : label PAD T06 = Materiel militaire. Correspondance explicite.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Label PAD T06 + NSTR bridge', true, true),
  ('group', '19.1', 'T13', 0.85, 'nstr_bridge_inferred', 'candidate', 'Marchandises dangereuses -> T13 : match direct avec label PAD T13 = marchandises dangereuses et IMO. NSTR bridge confirme. | [AUDIT-R1] Match direct : label PAD T13 = Marchandises dangereuses et IMO. Correspondance explicite.', 'PAD_NST_RECOMMENDATION_ENGINE.md', 'Label PAD T13 + NSTR bridge', true, true);

  -- Controles post-import
  SELECT count(*) INTO v_count FROM public.pad_nst_recommendation_rules;
  IF v_count != 88 THEN
    RAISE EXCEPTION 'ECHEC: count total = %, attendu 88', v_count;
  END IF;

  SELECT count(*) INTO v_bad_status FROM public.pad_nst_recommendation_rules WHERE validation_status != 'candidate';
  IF v_bad_status != 0 THEN
    RAISE EXCEPTION 'ECHEC: % regles avec validation_status != candidate', v_bad_status;
  END IF;

  SELECT count(*) INTO v_bad_validation FROM public.pad_nst_recommendation_rules WHERE requires_operator_validation = false;
  IF v_bad_validation != 0 THEN
    RAISE EXCEPTION 'ECHEC: % regles avec requires_operator_validation = false', v_bad_validation;
  END IF;

  SELECT count(*) INTO v_bad_active FROM public.pad_nst_recommendation_rules WHERE is_active = false;
  IF v_bad_active != 0 THEN
    RAISE EXCEPTION 'ECHEC: % regles avec is_active = false', v_bad_active;
  END IF;

  SELECT count(*) INTO v_bad_evidence FROM public.pad_nst_recommendation_rules WHERE evidence_level NOT IN ('expert_rule', 'nstr_bridge_inferred');
  IF v_bad_evidence != 0 THEN
    RAISE EXCEPTION 'ECHEC: % regles avec evidence_level invalide', v_bad_evidence;
  END IF;

  SELECT min(confidence), max(confidence) INTO v_min_conf, v_max_conf FROM public.pad_nst_recommendation_rules;
  IF v_min_conf != 0.45 OR v_max_conf != 0.85 THEN
    RAISE EXCEPTION 'ECHEC: confidence range %-%, attendu 0.45-0.85', v_min_conf, v_max_conf;
  END IF;

  RAISE NOTICE 'PAD-NST-2E-B: 88 regles importees avec succes, tous controles OK';
END $$;