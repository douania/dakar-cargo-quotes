# PAD-NST-2E-AUDIT — Rapport d'audit des règles candidates

**Date**: 2026-05-07 19:05 UTC
**Phase**: PAD-NST-2E-AUDIT (documentation only)
**Import DB**: ❌ AUCUN
**Toutes les règles restent**: `validation_status=candidate`, `requires_operator_validation=true`

---

## Statistiques

| Métrique | Valeur |
|----------|--------|
| Total règles auditées | 112 |
| TIER-A (validable) | 35 |
| TIER-B (conserver, ajuster) | 53 |
| TIER-C (différer/retirer) | 24 |
| **ready_for_import_count** | **88** |
| **deferred_count** | **20** |
| **removed_count** | **4** |

## Vérification NSTR Bridge (DB-verified)

Les 4 règles `nstr_bridge_inferred` ont été vérifiées contre la base de données.

| Règle | Manifeste cite | Réalité DB | Précision |
|-------|---------------|------------|-----------|
| group\|07.2\|T11 | '76 mappings division 07' | Division 07 = 76 ✅, **Groupe 07.2 = 37** | Manifeste citait total division, pas le groupe |
| group\|10.1\|T14 | '1039 mappings division 10' | Division 10 = 1039 ✅, **Groupe 10.1 = 348** | Manifeste citait total division, pas le groupe |
| group\|12.1\|T09 | '312 mappings division 12' | Division 12 = 312 ✅, **Groupe 12.1 = 164** | Manifeste citait total division, pas le groupe |
| group\|14.2\|T08 | '118 mappings division 14' | Division 14 = 118 ✅, **Groupe 14.2 = 117** | 1 mapping est pour 14.1, pas 14.2 |

**Conclusion NSTR** : Les 4 totaux division sont corrects. Les notes du manifeste sont imprécises (citent le total division au lieu du groupe). L'audit corrige les notes pour refléter les comptes group-level réels. Aucune règle ne nécessite de changement de tier à cause des comptes NSTR.

## Règles TIER-A (35 règles)

Éligibles à l'import comme règles candidates fortes. Restent `candidate` + `requires_operator_validation=true`.

| rule_key | confidence | action | note |
|----------|-----------|--------|------|
| division|06|T04 | 0.45 | keep_as_is | Match direct : label PAD T04 = 'Bois et produits divers'. Division 06 = bois, li... |
| division|07|T11 | 0.5 | keep_as_is | Match direct : label PAD T11 = 'Pétrole brut, essences, bitumes, hydrocarbures r... |
| division|10|T14 | 0.4 | keep_as_is | Match direct : label PAD T14 = 'Fil machine et feuillard'. Division 10 = métaux ... |
| division|12|T09 | 0.5 | keep_as_is | Match direct : label PAD T09 = 'Tracteurs, véhicules industriels et matériel de ... |
| division|13|T01 | 0.4 | keep_as_is | Match direct : label PAD T01 mentionne 'mobilier'. Division 13 = meubles et autr... |
| group|01.1|T05 | 0.6 | keep_as_is | Match direct : label PAD T05 = 'Céréales, ciment, riz et produits assimilés'. Cé... |
| group|01.5|T04 | 0.55 | keep_as_is | Match direct : label PAD T04 = 'Bois et produits divers'. Produits forestiers = ... |
| group|01.B|P05 | 0.55 | keep_as_is | Match direct : P05 = 'Produits de pêche non dénommés ailleurs'. Poissons et prod... |
| group|02.1|T07 | 0.55 | keep_as_is | Match direct : label PAD T07 cite 'charbon'. Charbon et lignite → T07.... |
| group|02.2|T11 | 0.6 | keep_as_is | Match direct : label PAD T11 cite 'Pétrole brut'. Correspondance explicite.... |
| group|03.1|T03 | 0.5 | keep_as_is | Minerais de fer = matières premières brutes. T03 'matières premières' pertinent.... |
| group|03.4|T10 | 0.55 | enrich_notes | Match direct : T10 = 'Sel de production locale'. Note : T10 précise 'production ... |
| group|03.5|T07 | 0.55 | keep_as_is | Match direct : T07 cite 'sable et vracs pondéreux'. Pierre, sable, gravier → T07... |
| group|04.2|P05 | 0.5 | keep_as_is | Poissons transformés et conservés → P05. Les produits de pêche transformés reste... |
| group|04.6|T05 | 0.55 | keep_as_is | Match direct : T05 = 'Céréales, ciment, riz et produits assimilés'. Farines = pr... |
| group|06.1|T04 | 0.6 | keep_as_is | Match direct : T04 = 'Bois et produits divers'. Produits en bois → T04.... |
| group|06.2|T04 | 0.5 | keep_as_is | Pâte à papier, papier → T04 'Bois et produits divers'. Le papier dérive du bois.... |
| group|07.1|T07 | 0.55 | keep_as_is | Coke, briquettes, combustibles solides → T07 vracs pondéreux. T07 cite 'charbon'... |
| group|07.2|T11 | 0.65 | enrich_notes | NSTR bridge vérifié : 37 mappings NSTR pour le groupe 07.2 (pas 76 comme cité da... |
| group|07.3|T06 | 0.55 | keep_as_is | T06 cite 'butane en vrac'. Produits pétroliers gazeux/liquéfiés → T06. Match dir... |
| group|07.4|T11 | 0.5 | keep_as_is | T11 cite 'bitumes'. Produits pétroliers solides/cireux → T11.... |
| group|08.1|T03 | 0.55 | keep_as_is | T03 cite 'Acides'. Produits chimiques minéraux de base (acides) → T03. Match dir... |
| group|08.6|T12 | 0.5 | keep_as_is | Produits en caoutchouc/plastique finis (pneus, tuyaux) → T12 produits manufactur... |
| group|09.2|T05 | 0.6 | enrich_notes | Match direct : T05 cite 'ciment'. CONFLIT T05/T07 documenté : ciment fini → T05,... |
| group|10.1|T14 | 0.6 | enrich_notes | Match direct : T14 = 'Fil machine et feuillard'. NSTR bridge vérifié : 348 mappi... |
| group|10.3|T12 | 0.5 | keep_as_is | Tubes, tuyaux, profilés creux → T12 produits manufacturés. Flux réel à Dakar.... |
| group|10.4|T12 | 0.5 | keep_as_is | Charpentes, pylônes, structures métalliques → T12. Flux réel à Dakar.... |
| group|11.1|T09 | 0.55 | keep_as_is | Match direct : T09 cite 'Tracteurs'. Machines agricoles → T09.... |
| group|11.3|T01 | 0.6 | keep_as_is | Match direct : T01 cite 'informatique'. Alias PAD : 'mat informatique ordinateur... |
| group|11.5|T01 | 0.55 | keep_as_is | Composants électroniques → T01 'électronique'. Match direct.... |
| group|11.6|T01 | 0.6 | keep_as_is | TV, radio, audio/vidéo → T01. Alias PAD confirmés : 'electrophones chaines hifi'... |
| group|11.7|T01 | 0.55 | keep_as_is | Instruments médicaux, optiques, horlogerie → T01 biens de valeur. Alias PAD : 'h... |
| group|12.1|T09 | 0.6 | enrich_notes | Match direct : T09 = 'Tracteurs, véhicules industriels et matériel de transport'... |
| group|12.2|T09 | 0.55 | keep_as_is | Navires, avions, wagons, remorques → T09 matériel de transport.... |
| group|13.1|T01 | 0.55 | keep_as_is | Match direct : T01 cite 'mobilier'. Meubles → T01.... |

## Règles TIER-B (53 règles)

Conservées avec ajustements de confidence ou enrichissement des notes.

| rule_key | orig_conf | adj_conf | action | note |
|----------|----------|---------|--------|------|
| division|01|P05 | 0.3 | 0.3 | enrich_notes | P05 pertinent uniquement pour le sous-groupe peche (01.B). L... |
| division|02|T07 | 0.35 | 0.35 | enrich_notes | T07 pertinent pour le charbon (02.1) mais pas pour le pétrol... |
| division|02|T11 | 0.45 | 0.4 | enrich_notes | T11 pertinent pour pétrole brut (02.2) mais pas pour charbon... |
| division|03|T03 | 0.4 | 0.35 | enrich_notes | T03 'matières premières' pertinent pour minerais (03.1, 03.2... |
| division|03|T08 | 0.35 | 0.3 | adjust_confidence | T08 pertinent pour phosphates (03.3) uniquement. Confidence ... |
| division|04|T02 | 0.4 | 0.35 | enrich_notes | T02 par défaut pour les denrées alimentaires transformées. A... |
| division|05|T12 | 0.4 | 0.4 | keep_as_is | T12 pertinent pour textiles et cuir manufacturés. Confidence... |
| division|08|T03 | 0.35 | 0.3 | adjust_confidence | T03 pertinent pour chimie de base (08.1) mais la division co... |
| division|09|T05 | 0.35 | 0.3 | adjust_confidence | T05 pertinent pour ciment fini (09.2) mais pas pour verre/cé... |
| division|09|T07 | 0.45 | 0.4 | enrich_notes | T07 pertinent pour clinker, sable, matériaux de carrière. Pl... |
| division|10|T12 | 0.35 | 0.35 | keep_as_is | T12 pertinent pour produits métalliques fabriqués (10.3-10.5... |
| division|11|T01 | 0.4 | 0.4 | enrich_notes | T01 pertinent pour informatique et électronique (11.3-11.7) ... |
| division|13|T12 | 0.35 | 0.35 | keep_as_is | T12 pertinent pour 'autres produits manufacturés' (13.2). Ca... |
| division|14|T08 | 0.4 | 0.35 | adjust_confidence | T08 ferrailles pertinent pour matières premières secondaires... |
| group|01.2|T02 | 0.4 | 0.4 | keep_as_is | Produit agricole frais sans catégorie PAD dédiée. T02 par dé... |
| group|01.3|T03 | 0.45 | 0.4 | adjust_confidence | Betterave sucrière = matière première pour le sucre. T03 'su... |
| group|01.4|T02 | 0.4 | 0.4 | keep_as_is | Fruits/légumes frais : marchandises générales. Pas de PAD dé... |
| group|01.7|T03 | 0.4 | 0.4 | keep_as_is | Matières premières végétales (coton brut, fibres). T03 'mati... |
| group|02.3|T06 | 0.45 | 0.45 | enrich_notes | T06 cite 'butane en vrac'. Le gaz naturel n'est pas explicit... |
| group|03.2|T03 | 0.45 | 0.45 | keep_as_is | Minerais non ferreux = matières premières. Même logique que ... |
| group|03.3|T06 | 0.4 | 0.35 | adjust_confidence | CONFLIT T06/T08 pour phosphates. T06 cite 'phosphates' mais ... |
| group|03.3|T08 | 0.5 | 0.45 | enrich_notes | CONFLIT T06/T08 : T08 cite aussi 'phosphates'. T08 semble pl... |
| group|04.1|T02 | 0.45 | 0.45 | keep_as_is | Viandes et produits carnés : marchandises générales. Flux ré... |
| group|04.3|T02 | 0.45 | 0.45 | keep_as_is | Fruits/légumes transformés (conserves). Marchandises général... |
| group|04.4|T02 | 0.4 | 0.4 | keep_as_is | Huiles alimentaires en conteneur. T02 par défaut. Flux impor... |
| group|04.5|T02 | 0.4 | 0.4 | keep_as_is | Produits laitiers : marchandises générales réfrigérées. Flux... |
| group|04.6|T07 | 0.4 | 0.35 | adjust_confidence | CONFLIT T05/T07 pour farine : T07 cite 'farine' pour le vrac... |
| group|04.7|T01 | 0.4 | 0.35 | adjust_confidence | T01 pertinent pour boissons alcoolisées (alias PAD existant)... |
| group|04.7|T02 | 0.35 | 0.35 | keep_as_is | T02 pertinent pour boissons non alcoolisées (eau, jus). Conf... |
| group|04.8|T01 | 0.35 | 0.3 | adjust_confidence | T01 pertinent uniquement pour tabac/cigarettes (alias PAD). ... |
| group|04.8|T02 | 0.45 | 0.45 | keep_as_is | T02 pour denrées alimentaires diverses et tabac. Candidat pr... |
| group|05.1|T12 | 0.45 | 0.45 | keep_as_is | Textiles manufacturés → T12 produits manufacturés. Pertinent... |
| group|05.2|T12 | 0.45 | 0.45 | keep_as_is | Vêtements → T12 produits manufacturés. Flux réel à Dakar (fr... |
| group|05.3|T12 | 0.45 | 0.45 | keep_as_is | Articles en cuir → T12 produits manufacturés. Acceptable.... |
| group|06.3|T12 | 0.4 | 0.4 | keep_as_is | Imprimés et médias enregistrés → T12 produits manufacturés. ... |
| group|07.2|T06 | 0.5 | 0.45 | enrich_notes | CONFLIT T06/T11 : T06 = carburants courants en vrac (gasoil,... |
| group|08.2|T03 | 0.45 | 0.45 | keep_as_is | Chimie organique de base → T03 matières premières chimiques.... |
| group|08.3|T08 | 0.5 | 0.5 | keep_as_is | Engrais azotés → T08. T08 couvre phosphates et produits fert... |
| group|08.4|T03 | 0.45 | 0.4 | enrich_notes | CONFLIT T03/T12 : granulés plastiques bruts = matière premiè... |
| group|08.4|T12 | 0.4 | 0.35 | adjust_confidence | T12 secondaire pour plastiques semi-finis. Confidence baissé... |
| group|08.5|T01 | 0.45 | 0.45 | keep_as_is | Produits pharmaceutiques = biens de valeur → T01. Flux réel ... |
| group|09.1|T12 | 0.45 | 0.45 | keep_as_is | Verre, céramique, porcelaine → T12 produits manufacturés. Pe... |
| group|09.2|T07 | 0.45 | 0.4 | enrich_notes | CONFLIT T05/T07 : T07 cite 'clinker'. Candidat si clinker ou... |
| group|09.3|T07 | 0.4 | 0.4 | keep_as_is | Matériaux de construction en vrac (graviers, agrégats) → T07... |
| group|09.3|T12 | 0.45 | 0.45 | keep_as_is | Carrelage, briques, tuiles → T12 matériaux de construction m... |
| group|10.2|T12 | 0.45 | 0.45 | keep_as_is | Métaux non ferreux transformés (aluminium, cuivre) → T12 mat... |
| group|10.5|T12 | 0.45 | 0.45 | keep_as_is | Chaudières, quincaillerie → T12 produits manufacturés. Candi... |
| group|11.2|T01 | 0.45 | 0.45 | keep_as_is | Électroménager → T01 biens de valeur. Flux réel à Dakar. Amb... |
| group|11.4|T01 | 0.45 | 0.45 | keep_as_is | Appareils électriques → T01 'électronique'. Ambiguïté avec T... |
| group|11.8|T09 | 0.45 | 0.4 | adjust_confidence | Machines-outils industrielles → T09. Pertinent mais confiden... |
| group|13.2|T01 | 0.35 | 0.3 | adjust_confidence | T01 pertinent uniquement pour bijouterie vraie, instruments ... |
| group|13.2|T12 | 0.45 | 0.45 | keep_as_is | Produits manufacturés divers (jouets, articles de sport) → T... |
| group|14.2|T08 | 0.5 | 0.45 | enrich_notes | T08 cite 'ferrailles'. NSTR bridge vérifié : 117 mappings NS... |

## Règles TIER-C (24 règles)

Explicitement exclues du futur import PAD-NST-2E-B.

| rule_key | action | justification |
|----------|--------|---------------|
| division|01|T02 | defer | T02 catch-all sans valeur discriminante au niveau division. Les groupes 01.x ont... |
| division|04|T05 | defer | T05 pertinent uniquement pour le sous-groupe farines (04.6). Reporter au profit ... |
| division|05|T02 | defer | T02 catch-all sans justification forte pour les textiles. Les groupes 05.x point... |
| division|08|T12 | defer | T12 secondaire au niveau division. Les groupes 08.x ont des règles plus précises... |
| division|10|T08 | defer | T08 ferrailles uniquement pertinent comme sous-cas de la division 10. Trop margi... |
| division|11|T09 | defer | T09 secondaire au niveau division. Pertinent uniquement pour machines agricoles ... |
| division|15|T13 | defer | Usage extrêmement rare en contexte portuaire Dakar. Le courrier/colis n'est pas ... |
| division|16|T09 | defer | Conteneurs en service vides : le droit de passage PAD n'est pas toujours applica... |
| division|17|T02 | defer | Déménagements et bagages : usage extrêmement rare en maritime commercial Dakar. ... |
| group|01.6|T02 | defer | Plantes vivantes et fleurs : produit fragile, usage très rare à Dakar en maritim... |
| group|01.8|T02 | defer | Animaux vivants : transport spécialisé, très rare en conteneur maritime à Dakar.... |
| group|01.9|T02 | remove | Lait cru : produit réfrigéré périssable. Inexistant en import maritime Dakar. Re... |
| group|01.A|T02 | defer | Peaux brutes, laine, poils : rare en conteneur à Dakar. T02 catch-all. Reporter.... |
| group|02.3|T11 | defer | T11 secondaire pour le gaz naturel. T06 est plus pertinent pour les hydrocarbure... |
| group|03.6|T03 | remove | Minerais d'uranium et thorium : inexistant en trafic Dakar. Retirer du manifeste... |
| group|08.5|T02 | defer | T02 secondaire pour pharma/pesticides. T01 est plus pertinent pour la composante... |
| group|08.7|T03 | remove | Combustible nucléaire : inexistant en trafic Dakar. Retirer du manifeste.... |
| group|10.5|T01 | defer | T01 uniquement pour la composante armes (alias PAD 'armurerie'). Trop partiel po... |
| group|11.4|T12 | defer | T12 secondaire faible pour machines électriques industrielles. T01 est prioritai... |
| group|11.8|T12 | defer | T12 tertiaire pour pièces détachées et petites machines. T09 est prioritaire. Re... |
| group|14.1|T08 | defer | Déchets ménagers/municipaux : très rare en trafic maritime Dakar. T08 ferrailles... |
| group|16.1|T09 | defer | Conteneurs vides en service : le droit de passage PAD n'est pas toujours applica... |
| group|17.1|T02 | defer | Déménagement : usage rare en maritime commercial Dakar. T02 catch-all. Reporter.... |
| group|17.5|T02 | remove | Catégorie résiduelle extrêmement vague. Confidence minimale (0.25). Aucune valeu... |

## Conflits multi-PAD (24 NST codes)

### 01 — Products of agriculture, hunting, and forestry; fish and other fishing products

- 📋 **P05** (TIER-B, conf=0.3, enrich_notes): P05 pertinent uniquement pour le sous-groupe peche (01.B). La division est trop ...
- ❌ **T02** (TIER-C, conf=N/A, defer): T02 catch-all sans valeur discriminante au niveau division. Les groupes 01.x ont...

### 02 — Coal and lignite; crude petroleum and natural gas

- 📋 **T07** (TIER-B, conf=0.35, enrich_notes): T07 pertinent pour le charbon (02.1) mais pas pour le pétrole (02.2) ni le gaz (...
- 📋 **T11** (TIER-B, conf=0.4, enrich_notes): T11 pertinent pour pétrole brut (02.2) mais pas pour charbon (02.1). Les groupes...

### 03 — Metal ores and other mining and quarrying products; peat; uranium and thorium ores

- 📋 **T03** (TIER-B, conf=0.35, enrich_notes): T03 'matières premières' pertinent pour minerais (03.1, 03.2) mais la division i...
- 📋 **T08** (TIER-B, conf=0.3, adjust_confidence): T08 pertinent pour phosphates (03.3) uniquement. Confidence baissée car secondai...

### 04 — Food products, beverages and tobacco

- 📋 **T02** (TIER-B, conf=0.35, enrich_notes): T02 par défaut pour les denrées alimentaires transformées. Ambiguïté avec T01 (b...
- ❌ **T05** (TIER-C, conf=N/A, defer): T05 pertinent uniquement pour le sous-groupe farines (04.6). Reporter au profit ...

### 05 — Textiles and textile products; leather and leather products

- ❌ **T02** (TIER-C, conf=N/A, defer): T02 catch-all sans justification forte pour les textiles. Les groupes 05.x point...
- 📋 **T12** (TIER-B, conf=0.4, keep_as_is): T12 pertinent pour textiles et cuir manufacturés. Confidence acceptable au nivea...

### 08 — Chemicals, chemical products, and man-made fibres; rubber and plastic products; nuclear fuel

- 📋 **T03** (TIER-B, conf=0.3, adjust_confidence): T03 pertinent pour chimie de base (08.1) mais la division couvre aussi plastique...
- ❌ **T12** (TIER-C, conf=N/A, defer): T12 secondaire au niveau division. Les groupes 08.x ont des règles plus précises...

### 09 — Other non-metallic mineral products

- 📋 **T05** (TIER-B, conf=0.3, adjust_confidence): T05 pertinent pour ciment fini (09.2) mais pas pour verre/céramique. Confidence ...
- 📋 **T07** (TIER-B, conf=0.4, enrich_notes): T07 pertinent pour clinker, sable, matériaux de carrière. Plus large que T05 pou...

### 10 — Basic metals; fabricated metal products, except machinery and equipment

- ❌ **T08** (TIER-C, conf=N/A, defer): T08 ferrailles uniquement pertinent comme sous-cas de la division 10. Trop margi...
- 📋 **T12** (TIER-B, conf=0.35, keep_as_is): T12 pertinent pour produits métalliques fabriqués (10.3-10.5). Accepté comme can...
- ⭐ **T14** (TIER-A, conf=0.4, keep_as_is): Match direct : label PAD T14 = 'Fil machine et feuillard'. Division 10 = métaux ...

### 11 — Machinery and equipment n.e.c.; office machinery and computers; electrical machinery and apparatus n.e.c.; radio, television and communication equipment and apparatus; medical, precision and optical instruments; watches and clocks

- 📋 **T01** (TIER-B, conf=0.4, enrich_notes): T01 pertinent pour informatique et électronique (11.3-11.7) mais pas pour machin...
- ❌ **T09** (TIER-C, conf=N/A, defer): T09 secondaire au niveau division. Pertinent uniquement pour machines agricoles ...

### 13 — Furniture; other manufactured goods n.e.c.

- ⭐ **T01** (TIER-A, conf=0.4, keep_as_is): Match direct : label PAD T01 mentionne 'mobilier'. Division 13 = meubles et autr...
- 📋 **T12** (TIER-B, conf=0.35, keep_as_is): T12 pertinent pour 'autres produits manufacturés' (13.2). Candidat secondaire co...

### 02.3 — Natural gas

- 📋 **T06** (TIER-B, conf=0.45, enrich_notes): T06 cite 'butane en vrac'. Le gaz naturel n'est pas explicitement nommé mais T06...
- ❌ **T11** (TIER-C, conf=N/A, defer): T11 secondaire pour le gaz naturel. T06 est plus pertinent pour les hydrocarbure...

### 03.3 — Chemical and (natural) fertilizer minerals

- 📋 **T06** (TIER-B, conf=0.35, adjust_confidence): CONFLIT T06/T08 pour phosphates. T06 cite 'phosphates' mais T08 aussi. Confidenc...
- 📋 **T08** (TIER-B, conf=0.45, enrich_notes): CONFLIT T06/T08 : T08 cite aussi 'phosphates'. T08 semble plus pertinent car les...

### 04.6 — Grain mill products, starches, starch products and prepared animal feeds

- ⭐ **T05** (TIER-A, conf=0.55, keep_as_is): Match direct : T05 = 'Céréales, ciment, riz et produits assimilés'. Farines = pr...
- 📋 **T07** (TIER-B, conf=0.35, adjust_confidence): CONFLIT T05/T07 pour farine : T07 cite 'farine' pour le vrac. Dépend du conditio...

### 04.7 — Beverages

- 📋 **T01** (TIER-B, conf=0.35, adjust_confidence): T01 pertinent pour boissons alcoolisées (alias PAD existant). Confidence baissée...
- 📋 **T02** (TIER-B, conf=0.35, keep_as_is): T02 pertinent pour boissons non alcoolisées (eau, jus). Conflit T01/T02 document...

### 04.8 — Other food products n.e.c. and tobacco products (except in parcel service or grouped)

- 📋 **T01** (TIER-B, conf=0.3, adjust_confidence): T01 pertinent uniquement pour tabac/cigarettes (alias PAD). Confidence baissée c...
- 📋 **T02** (TIER-B, conf=0.45, keep_as_is): T02 pour denrées alimentaires diverses et tabac. Candidat principal. Flux réel à...

### 07.2 — Liquid refined petroleum products

- 📋 **T06** (TIER-B, conf=0.45, enrich_notes): CONFLIT T06/T11 : T06 = carburants courants en vrac (gasoil, fuel oil), T11 = hy...
- ⭐ **T11** (TIER-A, conf=0.65, enrich_notes): NSTR bridge vérifié : 37 mappings NSTR pour le groupe 07.2 (pas 76 comme cité da...

### 08.4 — Basic plastics and synthetic rubber in primary forms

- 📋 **T03** (TIER-B, conf=0.4, enrich_notes): CONFLIT T03/T12 : granulés plastiques bruts = matière première (T03) vs plaques/...
- 📋 **T12** (TIER-B, conf=0.35, adjust_confidence): T12 secondaire pour plastiques semi-finis. Confidence baissée car T03 est priori...

### 08.5 — Pharmaceuticals and parachemicals including pesticides and other agro-chemical products

- 📋 **T01** (TIER-B, conf=0.45, keep_as_is): Produits pharmaceutiques = biens de valeur → T01. Flux réel à Dakar. Pertinent....
- ❌ **T02** (TIER-C, conf=N/A, defer): T02 secondaire pour pharma/pesticides. T01 est plus pertinent pour la composante...

### 09.2 — Cement, lime and plaster

- ⭐ **T05** (TIER-A, conf=0.6, enrich_notes): Match direct : T05 cite 'ciment'. CONFLIT T05/T07 documenté : ciment fini → T05,...
- 📋 **T07** (TIER-B, conf=0.4, enrich_notes): CONFLIT T05/T07 : T07 cite 'clinker'. Candidat si clinker ou ciment en vrac. Sec...

### 09.3 — Other construction materials, manufactures

- 📋 **T07** (TIER-B, conf=0.4, keep_as_is): Matériaux de construction en vrac (graviers, agrégats) → T07. Dépend du conditio...
- 📋 **T12** (TIER-B, conf=0.45, keep_as_is): Carrelage, briques, tuiles → T12 matériaux de construction manufacturés. Pertine...

### 10.5 — Boilers, hardware, weapons and other fabricated metal products

- ❌ **T01** (TIER-C, conf=N/A, defer): T01 uniquement pour la composante armes (alias PAD 'armurerie'). Trop partiel po...
- 📋 **T12** (TIER-B, conf=0.45, keep_as_is): Chaudières, quincaillerie → T12 produits manufacturés. Candidat principal pour l...

### 11.4 — Electric machinery and apparatus n.e.c.

- 📋 **T01** (TIER-B, conf=0.45, keep_as_is): Appareils électriques → T01 'électronique'. Ambiguïté avec T12 pour équipements ...
- ❌ **T12** (TIER-C, conf=N/A, defer): T12 secondaire faible pour machines électriques industrielles. T01 est prioritai...

### 11.8 — Other machines, machine tools and parts

- 📋 **T09** (TIER-B, conf=0.4, adjust_confidence): Machines-outils industrielles → T09. Pertinent mais confidence ajustée car le gr...
- ❌ **T12** (TIER-C, conf=N/A, defer): T12 tertiaire pour pièces détachées et petites machines. T09 est prioritaire. Re...

### 13.2 — Other manufactured goods

- 📋 **T01** (TIER-B, conf=0.3, adjust_confidence): T01 pertinent uniquement pour bijouterie vraie, instruments de musique (alias PA...
- 📋 **T12** (TIER-B, conf=0.45, keep_as_is): Produits manufacturés divers (jouets, articles de sport) → T12. Candidat princip...

## Compteur final pour PAD-NST-2E-B

```
ready_for_import_count = 88  (TIER-A + TIER-B non-deferred)
deferred_count         = 20  (TIER-C deferred)
removed_count          = 4  (TIER-C removed)
total_audited          = 112
```

**PAD-NST-2E-B ne doit importer que les 88 règles ready_for_import (TIER-A + TIER-B acceptées).**
Les 24 règles TIER-C sont explicitement exclues.

---

## Requêtes SQL de vérification NSTR

```sql
-- Vérification des comptes NSTR par groupe
SELECT nst2007_code, count(*) as mapping_count
FROM nstr_nst2007_mappings
WHERE is_quarantined = false
  AND LEFT(nst2007_code, 2) IN ('07', '10', '12', '14')
GROUP BY nst2007_code
ORDER BY nst2007_code;
```

Résultats DB (vérifié 2026-05-07 19:05 UTC) :

| nst2007_code | mapping_count |
|-------------|--------------|
| 07.1 | 10 |
| 07.2 | 37 |
| 07.3 | 13 |
| 07.4 | 16 |
| 10.1 | 348 |
| 10.2 | 201 |
| 10.3 | 92 |
| 10.4 | 13 |
| 10.5 | 385 |
| 12.1 | 164 |
| 12.2 | 148 |
| 14.1 | 1 |
| 14.2 | 117 |

---

*Rapport généré par pad_nst_2e_audit.py — phase documentaire uniquement.*
*Aucun import DB réalisé. Table pad_nst_recommendation_rules reste vide.*