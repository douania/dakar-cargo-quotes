# PAD-NST-2E-A — Rule Candidate Manifest

**Date** : 2026-05-07
**Phase** : PAD-NST-2E-A — Manifeste des regles candidates (documentation uniquement)
**Statut** : En attente de validation CTO
**Import DB** : NON — aucune donnee importee

---

## 1. Resume executif

Ce manifeste liste **112 regles candidates** pour le rapprochement NST 2007 -> PAD.
Aucune de ces regles n'a ete importee en base de donnees.

| Metrique | Valeur |
|----------|--------|
| Regles division-level | **28** |
| Regles group-level | **84** |
| Total | **112** |
| Regles `validated` | **0** |
| Regles `requires_operator_validation = false` | **0** |
| Regles `pad_official_extract` | **0** |
| Regles `confidence > 0.65` | **0** |
| Regles division `confidence > 0.50` | **0** |
| Regles pour divisions 18, 19, 20 | **0** |

**Categories PAD verifiees par introspection DB** (`commodity_categories` table, 19 categories confirmees).

---

## 2. Categories PAD utilisees (source : introspection DB commodity_categories)

| PAD | Label officiel DB |
|-----|-------------------|
| P01 | Crustacés non dénommés ailleurs |
| P02 | Thonidés |
| P03 | Crabes, crevettes, mollusques et poissons plats |
| P04 | Sardinelles, chinchard, maquereau |
| P05 | Produits de pêche non dénommés ailleurs |
| T01 | Biens de valeur, électronique, informatique et mobilier |
| T02 | Marchandises générales |
| T03 | Acides, sucres et matières premières |
| T04 | Bois et produits divers |
| T05 | Céréales, ciment, riz et produits assimilés |
| T06 | Gasoil, fuel oil, diesel, butane en vrac, phosphates |
| T07 | Clinker, farine, charbon, sable et vracs pondéreux |
| T08 | Attapulgite, phosphates, ferrailles, tourteaux, cellulose |
| T09 | Tracteurs, véhicules industriels et matériel de transport |
| T10 | Sel de production locale |
| T11 | Pétrole brut, essences, bitumes, hydrocarbures raffinés |
| T12 | Matériaux et produits manufacturés |
| T13 | Marchandises diverses en groupage |
| T14 | Fil machine et feuillard |

---

## 3. Repartition par categorie PAD

| PAD | Label | Nombre de regles |
|-----|-------|-----------------|
| P05 | Produits de pêche non dénommés ailleurs | 3 |
| T01 | Biens de valeur, électronique, informatique et mobilier | 14 |
| T02 | Marchandises générales | 19 |
| T03 | Acides, sucres et matières premières | 11 |
| T04 | Bois et produits divers | 4 |
| T05 | Céréales, ciment, riz et produits assimilés | 5 |
| T06 | Gasoil, fuel oil, diesel, butane en vrac, phosphates | 4 |
| T07 | Clinker, farine, charbon, sable et vracs pondéreux | 8 |
| T08 | Attapulgite, phosphates, ferrailles, tourteaux, cellulose | 7 |
| T09 | Tracteurs, véhicules industriels et matériel de transport | 8 |
| T10 | Sel de production locale | 1 |
| T11 | Pétrole brut, essences, bitumes, hydrocarbures raffinés | 6 |
| T12 | Matériaux et produits manufacturés | 19 |
| T13 | Marchandises diverses en groupage | 1 |
| T14 | Fil machine et feuillard | 2 |

Categories PAD sans aucune regle candidate :

- **P01** — Crustacés non dénommés ailleurs
- **P02** — Thonidés
- **P03** — Crabes, crevettes, mollusques et poissons plats
- **P04** — Sardinelles, chinchard, maquereau

---

## 4. Repartition par evidence_level

| Evidence Level | Nombre |
|---------------|--------|
| `expert_rule` | 108 |
| `nstr_bridge_inferred` | 4 |

---

## 5. Codes NST sans regle

### Divisions sans regle

Aucune (toutes les divisions 01-17 ont au moins une regle).

### Divisions exclues (blocage operateur obligatoire)

- **18** — Grouped goods: a mixture of types of goods which are transported together — Aucune categorie PAD unique possible, validation operateur obligatoire
- **19** — Unidentifiable goods — Aucune categorie PAD unique possible, validation operateur obligatoire
- **20** — Other goods n.e.c. — Aucune categorie PAD unique possible, validation operateur obligatoire

### Groupes sans regle

Aucun (tous les groupes hors 18.0/19.1/19.2 ont au moins une regle).

### Groupes exclus (blocage operateur obligatoire)

- **18.0** — Grouped goods
- **19.1** — Unidentifiable goods in containers or swap bodies
- **19.2** — Other unidentifiable goods

---

## 6. Codes NST avec plusieurs categories PAD candidates (conflits)

| Niveau | Code NST | Label | Categories PAD candidates |
|--------|----------|-------|--------------------------|
| division | 01 | Products of agriculture, hunting, and forestry; fish and oth... | P05, T02 |
| division | 02 | Coal and lignite; crude petroleum and natural gas | T07, T11 |
| division | 03 | Metal ores and other mining and quarrying products; peat; ur... | T03, T08 |
| division | 04 | Food products, beverages and tobacco | T02, T05 |
| division | 05 | Textiles and textile products; leather and leather products | T02, T12 |
| division | 08 | Chemicals, chemical products, and man-made fibres; rubber an... | T03, T12 |
| division | 09 | Other non-metallic mineral products | T05, T07 |
| division | 10 | Basic metals; fabricated metal products, except machinery an... | T08, T12, T14 |
| division | 11 | Machinery and equipment n.e.c.; office machinery and compute... | T01, T09 |
| division | 13 | Furniture; other manufactured goods n.e.c. | T01, T12 |
| group | 02.3 | Natural gas | T06, T11 |
| group | 03.3 | Chemical and (natural) fertilizer minerals | T06, T08 |
| group | 04.6 | Grain mill products, starches, starch products and prepared ... | T05, T07 |
| group | 04.7 | Beverages | T01, T02 |
| group | 04.8 | Other food products n.e.c. and tobacco products (except in p... | T01, T02 |
| group | 07.2 | Liquid refined petroleum products | T06, T11 |
| group | 08.4 | Basic plastics and synthetic rubber in primary forms | T03, T12 |
| group | 08.5 | Pharmaceuticals and parachemicals including pesticides and o... | T01, T02 |
| group | 09.2 | Cement, lime and plaster | T05, T07 |
| group | 09.3 | Other construction materials, manufactures | T07, T12 |
| group | 10.5 | Boilers, hardware, weapons and other fabricated metal produc... | T01, T12 |
| group | 11.4 | Electric machinery and apparatus n.e.c. | T01, T12 |
| group | 11.8 | Other machines, machine tools and parts | T09, T12 |
| group | 13.2 | Other manufactured goods | T01, T12 |

**Total : 24 codes NST avec conflits.**

Pour chaque conflit, l'application future devra afficher toutes les candidates a l'operateur, pas choisir automatiquement.

---

## 7. Regles division-level

| Code | Label | PAD | Confidence | Evidence | Notes |
|------|-------|-----|-----------|----------|-------|
| 01 | Products of agriculture, hunting, and forestry; fi... | P05 | 0.30 | `expert_rule` | Division 01 inclut 'fish and other fishing products' (groupe 01.B). P05 = produits de peche NDA, cat... |
| 01 | Products of agriculture, hunting, and forestry; fi... | T02 | 0.30 | `expert_rule` | Division 01 couvre agriculture, chasse, foret et peche. Les produits agricoles bruts (hors cereales/... |
| 02 | Coal and lignite; crude petroleum and natural gas | T07 | 0.35 | `expert_rule` | Division 02 inclut charbon et lignite (02.1). T07 = clinker, farine, charbon, sable et vracs pondere... |
| 02 | Coal and lignite; crude petroleum and natural gas | T11 | 0.45 | `expert_rule` | Division 02 = charbon, petrole brut, gaz naturel. T11 = petrole brut, essences, bitumes, hydrocarbur... |
| 03 | Metal ores and other mining and quarrying products... | T03 | 0.40 | `expert_rule` | Division 03 = minerais metalliques, produits miniers. T03 = acides, sucres et matieres premieres. Le... |
| 03 | Metal ores and other mining and quarrying products... | T08 | 0.35 | `expert_rule` | Division 03 inclut les mineraux fertilisants (03.3) et le sel (03.4). T08 = attapulgite, phosphates,... |
| 04 | Food products, beverages and tobacco | T02 | 0.40 | `expert_rule` | Division 04 = produits alimentaires, boissons, tabac. T02 = marchandises generales. Les denrees alim... |
| 04 | Food products, beverages and tobacco | T05 | 0.35 | `expert_rule` | Division 04 inclut les farines et amidons (04.6). T05 = cereales, ciment, riz et produits assimiles.... |
| 05 | Textiles and textile products; leather and leather... | T02 | 0.30 | `expert_rule` | Division 05 = textiles et cuir. T02 = marchandises generales. Certains textiles bruts ou en vrac pou... |
| 05 | Textiles and textile products; leather and leather... | T12 | 0.40 | `expert_rule` | Division 05 = textiles, cuir. T12 = materiaux et produits manufactures. Les textiles et articles en ... |
| 06 | Wood and products of wood and cork; pulp, paper an... | T04 | 0.45 | `expert_rule` | Division 06 = bois, liege, papier. T04 = bois et produits divers. Le bois et ses derives corresponde... |
| 07 | Coke and refined petroleum products | T11 | 0.50 | `expert_rule` | Division 07 = coke et produits petroliers raffines. T11 = petrole brut, essences, bitumes, hydrocarb... |
| 08 | Chemicals, chemical products, and man-made fibres;... | T03 | 0.35 | `expert_rule` | Division 08 = chimie, plastiques, caoutchouc, combustible nucleaire. T03 = acides, sucres et matiere... |
| 08 | Chemicals, chemical products, and man-made fibres;... | T12 | 0.30 | `expert_rule` | Division 08 inclut les plastiques et caoutchoucs (08.4, 08.6). T12 = materiaux et produits manufactu... |
| 09 | Other non-metallic mineral products | T05 | 0.35 | `expert_rule` | Division 09 inclut ciment, chaux, platre (09.2). T05 = cereales, ciment, riz et produits assimiles. ... |
| 09 | Other non-metallic mineral products | T07 | 0.45 | `expert_rule` | Division 09 = produits mineraux non metalliques. T07 = clinker, farine, charbon, sable et vracs pond... |
| 10 | Basic metals; fabricated metal products, except ma... | T08 | 0.30 | `expert_rule` | Division 10 peut inclure des ferrailles et dechets metalliques en pratique. T08 = attapulgite, phosp... |
| 10 | Basic metals; fabricated metal products, except ma... | T12 | 0.35 | `expert_rule` | Division 10 inclut les produits metalliques fabriques (10.3-10.5). T12 = materiaux et produits manuf... |
| 10 | Basic metals; fabricated metal products, except ma... | T14 | 0.40 | `expert_rule` | Division 10 = metaux de base, produits metalliques. T14 = fil machine et feuillard. Les produits de ... |
| 11 | Machinery and equipment n.e.c.; office machinery a... | T01 | 0.40 | `expert_rule` | Division 11 = machines, equipements, informatique, electronique. T01 = biens de valeur, electronique... |
| 11 | Machinery and equipment n.e.c.; office machinery a... | T09 | 0.35 | `expert_rule` | Division 11 inclut les machines agricoles (11.1) et les machines-outils (11.8). T09 = tracteurs, veh... |
| 12 | Transport equipment | T09 | 0.50 | `expert_rule` | Division 12 = materiel de transport. T09 = tracteurs, vehicules industriels et materiel de transport... |
| 13 | Furniture; other manufactured goods n.e.c. | T01 | 0.40 | `expert_rule` | Division 13 = meubles et autres produits manufactures. T01 = biens de valeur, electronique, informat... |
| 13 | Furniture; other manufactured goods n.e.c. | T12 | 0.35 | `expert_rule` | Division 13 inclut 'other manufactured goods' (13.2). T12 = materiaux et produits manufactures. Les ... |
| 14 | Secondary raw materials; municipal wastes and othe... | T08 | 0.40 | `expert_rule` | Division 14 = matieres premieres secondaires, dechets. T08 = attapulgite, phosphates, ferrailles, to... |
| 15 | Mail, parcels | T13 | 0.35 | `expert_rule` | Division 15 = courrier, colis. T13 = marchandises diverses en groupage. Les colis et envois postaux ... |
| 16 | Equipment and material utilised in the transport o... | T09 | 0.40 | `expert_rule` | Division 16 = equipements de transport de marchandises en service. T09 = tracteurs, vehicules indust... |
| 17 | Goods moved in the course of household and office ... | T02 | 0.30 | `expert_rule` | Division 17 = demenagement, bagages, vehicules en reparation. T02 = marchandises generales. Les effe... |

---

## 8. Regles group-level

| Code | Label | PAD | Confidence | Evidence | Notes |
|------|-------|-----|-----------|----------|-------|
| 01.1 | Cereals | T05 | 0.60 | `expert_rule` | Cereales -> T05 : le label PAD T05 mentionne explicitement 'cereales, ciment, riz'. Match direct ent... |
| 01.2 | Potatoes | T02 | 0.40 | `expert_rule` | Pommes de terre -> T02 : produit agricole frais, classe marchandises generales en l'absence d'alias ... |
| 01.3 | Sugar beet | T03 | 0.45 | `expert_rule` | Betteraves sucrieres -> T03 : T03 = acides, sucres et matieres premieres. La betterave sucriere est ... |
| 01.4 | Other fresh fruit and vegetables | T02 | 0.40 | `expert_rule` | Fruits et legumes frais -> T02 : marchandises generales. Pas de categorie PAD specifique aux fruits/... |
| 01.5 | Products of forestry and logging | T04 | 0.55 | `expert_rule` | Produits forestiers et bois d'exploitation -> T04 : T04 = bois et produits divers. Match direct entr... |
| 01.6 | Live plants and flowers | T02 | 0.35 | `expert_rule` | Plantes vivantes et fleurs -> T02 : marchandises generales. Pas de categorie PAD dediee a l'horticul... |
| 01.7 | Other substances of vegetable origin | T03 | 0.40 | `expert_rule` | Autres substances d'origine vegetale -> T03 : matieres premieres vegetales (caoutchouc naturel, coto... |
| 01.8 | Live animals | T02 | 0.35 | `expert_rule` | Animaux vivants -> T02 : marchandises generales. Pas de categorie PAD specifique aux animaux vivants... |
| 01.9 | Raw milk from bovine cattle, sheep and goats | T02 | 0.30 | `expert_rule` | Lait cru -> T02 : marchandises generales. Produit refrigere perissable. Pas de categorie PAD dediee ... |
| 01.A | Other raw materials of animal origin | T02 | 0.30 | `expert_rule` | Autres matieres premieres animales -> T02 : marchandises generales. Peaux brutes, laine, poils. Pas ... |
| 01.B | Fish and other fishing products | P05 | 0.55 | `expert_rule` | Poissons et produits de la peche -> P05 : P05 = produits de peche non denommes ailleurs. Match direc... |
| 02.1 | Coal and lignite | T07 | 0.55 | `expert_rule` | Charbon et lignite -> T07 : T07 = clinker, farine, charbon, sable et vracs pondereux. Le charbon est... |
| 02.2 | Crude petroleum | T11 | 0.60 | `expert_rule` | Petrole brut -> T11 : T11 = petrole brut, essences, bitumes, hydrocarbures raffines. 'Petrole brut' ... |
| 02.3 | Natural gas | T06 | 0.45 | `expert_rule` | Gaz naturel -> T06 : T06 = gasoil, fuel oil, diesel, butane en vrac, phosphates. Le butane est un ga... |
| 02.3 | Natural gas | T11 | 0.40 | `expert_rule` | Gaz naturel -> T11 : T11 = petrole brut, essences, bitumes, hydrocarbures raffines. Le gaz naturel p... |
| 03.1 | Iron ores | T03 | 0.50 | `expert_rule` | Minerais de fer -> T03 : T03 = acides, sucres et matieres premieres. Les minerais de fer sont des ma... |
| 03.2 | Non ferrous metal ores (except uranium and thorium... | T03 | 0.45 | `expert_rule` | Minerais de metaux non ferreux -> T03 : matieres premieres brutes. Meme raisonnement que 03.1 mais c... |
| 03.3 | Chemical and (natural) fertilizer minerals | T06 | 0.40 | `expert_rule` | Mineraux fertilisants -> T06 : T06 mentionne aussi 'phosphates'. Conflit PAD : les phosphates appara... |
| 03.3 | Chemical and (natural) fertilizer minerals | T08 | 0.50 | `expert_rule` | Mineraux fertilisants -> T08 : T08 = attapulgite, phosphates, ferrailles, tourteaux, cellulose. Les ... |
| 03.4 | Salt | T10 | 0.55 | `expert_rule` | Sel -> T10 : T10 = sel de production locale. Match direct entre sel et le label T10. Note : T10 prec... |
| 03.5 | Stone, sand, gravel, clay, peat and other mining a... | T07 | 0.55 | `expert_rule` | Pierre, sable, gravier, argile -> T07 : T07 = clinker, farine, charbon, sable et vracs pondereux. Le... |
| 03.6 | Uranium and thorium ores | T03 | 0.30 | `expert_rule` | Minerais d'uranium et de thorium -> T03 : matieres premieres specialisees. Extremement rare a Dakar.... |
| 04.1 | Meat, raw hides and skins and meat products | T02 | 0.45 | `expert_rule` | Viandes, peaux brutes, produits carnes -> T02 : marchandises generales. Denrees alimentaires transfo... |
| 04.2 | Fish and fish products, processed and preserved | P05 | 0.50 | `expert_rule` | Poissons transformes et conserves -> P05 : P05 = produits de peche NDA. Les produits de peche transf... |
| 04.3 | Fruit and vegetables, processed and preserved | T02 | 0.45 | `expert_rule` | Fruits et legumes transformes -> T02 : marchandises generales. Conserves et produits alimentaires tr... |
| 04.4 | Animal and vegetable oils and fats | T02 | 0.40 | `expert_rule` | Huiles et graisses animales et vegetales -> T02 : marchandises generales. Huiles alimentaires en con... |
| 04.5 | Dairy products and ice cream | T02 | 0.40 | `expert_rule` | Produits laitiers et creme glacee -> T02 : marchandises generales. Denrees alimentaires refrigerees. |
| 04.6 | Grain mill products, starches, starch products and... | T05 | 0.55 | `expert_rule` | Farines, amidons, aliments pour animaux -> T05 : T05 = cereales, ciment, riz et produits assimiles. ... |
| 04.6 | Grain mill products, starches, starch products and... | T07 | 0.40 | `expert_rule` | Farines -> T07 : T07 = clinker, farine, charbon, sable et vracs pondereux. La farine est expliciteme... |
| 04.7 | Beverages | T01 | 0.40 | `expert_rule` | Boissons -> T01 : T01 = biens de valeur. Des alias PAD existants classent 'boissons alcoolisees' sou... |
| 04.7 | Beverages | T02 | 0.35 | `expert_rule` | Boissons non alcoolisees -> T02 : marchandises generales. Les boissons non alcoolisees (eau, jus) so... |
| 04.8 | Other food products n.e.c. and tobacco products (e... | T01 | 0.35 | `expert_rule` | Tabac, cigarettes -> T01 : T01 = biens de valeur. Un alias PAD existant classe 'autre tabac, cigaret... |
| 04.8 | Other food products n.e.c. and tobacco products (e... | T02 | 0.45 | `expert_rule` | Autres produits alimentaires et tabac -> T02 : marchandises generales. Les denrees alimentaires dive... |
| 05.1 | Textiles | T12 | 0.45 | `expert_rule` | Textiles -> T12 : T12 = materiaux et produits manufactures. Les textiles manufactures (tissus, fils)... |
| 05.2 | Wearing apparel and articles of fur | T12 | 0.45 | `expert_rule` | Vetements et fourrures -> T12 : produits manufactures. Les vetements sont des produits finis manufac... |
| 05.3 | Leather and leather products | T12 | 0.45 | `expert_rule` | Cuir et articles en cuir -> T12 : produits manufactures. Les articles en cuir (sacs, chaussures) son... |
| 06.1 | Products of wood and cork (except furniture) | T04 | 0.60 | `expert_rule` | Produits en bois et liege (hors meubles) -> T04 : T04 = bois et produits divers. Match direct entre ... |
| 06.2 | Pulp, paper and paper products | T04 | 0.50 | `expert_rule` | Pate a papier, papier et produits en papier -> T04 : T04 = bois et produits divers. Le papier derive... |
| 06.3 | Printed matter and recorded media | T12 | 0.40 | `expert_rule` | Imprimes et medias enregistres -> T12 : produits manufactures. Les imprimes sont des produits manufa... |
| 07.1 | Coke oven products; briquettes, ovoids and similar... | T07 | 0.55 | `expert_rule` | Coke, briquettes, combustibles solides -> T07 : T07 = clinker, farine, charbon, sable et vracs ponde... |
| 07.2 | Liquid refined petroleum products | T06 | 0.50 | `expert_rule` | Produits petroliers liquides raffines -> T06 : T06 = gasoil, fuel oil, diesel. Le gasoil et le diese... |
| 07.2 | Liquid refined petroleum products | T11 | 0.65 | `nstr_bridge_inferred` | Produits petroliers liquides raffines -> T11 : T11 = petrole brut, essences, bitumes, hydrocarbures ... |
| 07.3 | Gaseous, liquefied or compressed petroleum product... | T06 | 0.55 | `expert_rule` | Produits petroliers gazeux, liquefies ou comprimes -> T06 : T06 = gasoil, fuel oil, diesel, butane e... |
| 07.4 | Solid or waxy refined petroleum products | T11 | 0.50 | `expert_rule` | Produits petroliers solides ou cireux -> T11 : T11 = petrole brut, essences, bitumes, hydrocarbures ... |
| 08.1 | Basic mineral chemical products | T03 | 0.55 | `expert_rule` | Produits chimiques mineraux de base -> T03 : T03 = acides, sucres et matieres premieres. Les acides ... |
| 08.2 | Basic organic chemical products | T03 | 0.45 | `expert_rule` | Produits chimiques organiques de base -> T03 : matieres premieres chimiques. Les solvants, alcools i... |
| 08.3 | Nitrogen compounds and fertilizers (except natural... | T08 | 0.50 | `expert_rule` | Composes azotes et engrais -> T08 : T08 = attapulgite, phosphates, ferrailles, tourteaux, cellulose.... |
| 08.4 | Basic plastics and synthetic rubber in primary for... | T03 | 0.45 | `expert_rule` | Plastiques de base et caoutchouc synthetique en formes primaires -> T03 : T03 = matieres premieres. ... |
| 08.4 | Basic plastics and synthetic rubber in primary for... | T12 | 0.40 | `expert_rule` | Plastiques de base -> T12 : T12 = materiaux et produits manufactures. Si le plastique est sous forme... |
| 08.5 | Pharmaceuticals and parachemicals including pestic... | T01 | 0.45 | `expert_rule` | Produits pharmaceutiques et parachemiques -> T01 : T01 = biens de valeur. Les medicaments sont des p... |
| 08.5 | Pharmaceuticals and parachemicals including pestic... | T02 | 0.35 | `expert_rule` | Produits parachemiques, pesticides -> T02 : marchandises generales. Les pesticides et produits agro-... |
| 08.6 | Rubber or plastic products | T12 | 0.50 | `expert_rule` | Produits en caoutchouc ou plastique -> T12 : T12 = materiaux et produits manufactures. Les pneus, tu... |
| 08.7 | Nuclear fuel | T03 | 0.25 | `expert_rule` | Combustible nucleaire -> T03 : matieres premieres specialisees. Extremement rare a Dakar. Theorique ... |
| 09.1 | Glass and glass products, ceramic and porcelain pr... | T12 | 0.45 | `expert_rule` | Verre, ceramique, porcelaine -> T12 : T12 = materiaux et produits manufactures. Les produits en verr... |
| 09.2 | Cement, lime and plaster | T05 | 0.60 | `expert_rule` | Ciment, chaux, platre -> T05 : T05 = cereales, ciment, riz et produits assimiles. Le ciment est expl... |
| 09.2 | Cement, lime and plaster | T07 | 0.45 | `expert_rule` | Ciment -> T07 : T07 = clinker, farine, charbon, sable et vracs pondereux. Le clinker (matiere premie... |
| 09.3 | Other construction materials, manufactures | T07 | 0.40 | `expert_rule` | Materiaux de construction en vrac -> T07 : T07 = vracs pondereux. Si les materiaux sont en vrac (gra... |
| 09.3 | Other construction materials, manufactures | T12 | 0.45 | `expert_rule` | Autres materiaux de construction manufactures -> T12 : T12 = materiaux et produits manufactures. Car... |
| 10.1 | Basic iron and steel and ferro-alloys and products... | T14 | 0.60 | `nstr_bridge_inferred` | Fer, acier de base, ferro-alliages et produits de premiere transformation -> T14 : T14 = fil machine... |
| 10.2 | Non ferrous metals and products thereof | T12 | 0.45 | `expert_rule` | Metaux non ferreux et produits derives -> T12 : T12 = materiaux et produits manufactures. Les metaux... |
| 10.3 | Tubes, pipes, hollow profiles and related fittings | T12 | 0.50 | `expert_rule` | Tubes, tuyaux, profiles creux -> T12 : T12 = materiaux et produits manufactures. Les tubes et profil... |
| 10.4 | Structural metal products | T12 | 0.50 | `expert_rule` | Produits metalliques structurels -> T12 : T12 = materiaux et produits manufactures. Les charpentes, ... |
| 10.5 | Boilers, hardware, weapons and other fabricated me... | T01 | 0.30 | `expert_rule` | Armes -> T01 : T01 = biens de valeur. Un alias PAD existant classe 'armurerie' sous T01. Candidate s... |
| 10.5 | Boilers, hardware, weapons and other fabricated me... | T12 | 0.45 | `expert_rule` | Chaudieres, quincaillerie, armes, autres produits metalliques -> T12 : produits manufactures. Ambigu... |
| 11.1 | Agricultural and forestry machinery | T09 | 0.55 | `expert_rule` | Machines agricoles et forestieres -> T09 : T09 = tracteurs, vehicules industriels et materiel de tra... |
| 11.2 | Domestic appliances n.e.c. (White goods) | T01 | 0.45 | `expert_rule` | Appareils menagers (electromenager blanc) -> T01 : T01 = biens de valeur, electronique, informatique... |
| 11.3 | Office machinery and computers | T01 | 0.60 | `expert_rule` | Machines de bureau et ordinateurs -> T01 : T01 = biens de valeur, electronique, informatique et mobi... |
| 11.4 | Electric machinery and apparatus n.e.c. | T01 | 0.45 | `expert_rule` | Machines et appareils electriques NDA -> T01 : T01 = electronique. Les appareils electriques sont as... |
| 11.4 | Electric machinery and apparatus n.e.c. | T12 | 0.35 | `expert_rule` | Machines electriques industrielles -> T12 : T12 = materiaux et produits manufactures. Les moteurs, t... |
| 11.5 | Electronic components and emission and transmissio... | T01 | 0.55 | `expert_rule` | Composants electroniques, appareils d'emission/transmission -> T01 : T01 = biens de valeur, electron... |
| 11.6 | Television and radio receivers; sound or video rec... | T01 | 0.60 | `expert_rule` | TV, radio, appareils audio/video -> T01 : T01 = biens de valeur, electronique. Alias PAD existants :... |
| 11.7 | Medical, precision and optical instruments, watche... | T01 | 0.55 | `expert_rule` | Instruments medicaux, de precision, optiques, horlogerie -> T01 : T01 = biens de valeur. Alias PAD e... |
| 11.8 | Other machines, machine tools and parts | T09 | 0.45 | `expert_rule` | Autres machines, machines-outils et pieces -> T09 : T09 = vehicules industriels et materiel de trans... |
| 11.8 | Other machines, machine tools and parts | T12 | 0.40 | `expert_rule` | Machines-outils et pieces -> T12 : T12 = materiaux et produits manufactures. Les pieces detachees et... |
| 12.1 | Automobile industry products | T09 | 0.60 | `nstr_bridge_inferred` | Produits de l'industrie automobile -> T09 : T09 = tracteurs, vehicules industriels et materiel de tr... |
| 12.2 | Other transport equipment | T09 | 0.55 | `expert_rule` | Autres materiels de transport -> T09 : T09 = materiel de transport. Les navires, avions, wagons, rem... |
| 13.1 | Furniture | T01 | 0.55 | `expert_rule` | Meubles -> T01 : T01 = biens de valeur, electronique, informatique et mobilier. Le mobilier est expl... |
| 13.2 | Other manufactured goods | T01 | 0.35 | `expert_rule` | Produits manufactures de valeur -> T01 : T01 = biens de valeur. Certains articles (bijouterie vraie,... |
| 13.2 | Other manufactured goods | T12 | 0.45 | `expert_rule` | Autres produits manufactures -> T12 : T12 = materiaux et produits manufactures. Les produits manufac... |
| 14.1 | Household and municipal waste | T08 | 0.35 | `expert_rule` | Dechets menagers et municipaux -> T08 : T08 inclut ferrailles. Les dechets metalliques menagers pour... |
| 14.2 | Other waste and secondary raw materials | T08 | 0.50 | `nstr_bridge_inferred` | Autres dechets et matieres premieres secondaires -> T08 : T08 = attapulgite, phosphates, ferrailles,... |
| 16.1 | Containers and swap bodies in service, empty | T09 | 0.45 | `expert_rule` | Conteneurs et caisses mobiles en service, vides -> T09 : T09 = materiel de transport. Les conteneurs... |
| 17.1 | Household removal | T02 | 0.35 | `expert_rule` | Demenagement -> T02 : marchandises generales. Les effets personnels de demenagement sont classes mar... |
| 17.5 | Other non market goods n.e.c. | T02 | 0.25 | `expert_rule` | Autres marchandises non marchandes NDA -> T02 : marchandises generales par defaut. Categorie residue... |

---

## 9. Perimetre strict

| Item | Statut |
|------|--------|
| Import DB | ❌ Aucun |
| Migration | ❌ Aucune |
| `src/` modifications | ❌ Aucune |
| Edge Functions | ❌ Aucune |
| `config.toml` | ❌ Non modifie |
| Runtime impact | ❌ Aucun |

---

## 10. Prochaine etape

Apres validation CTO du manifeste :
- **PAD-NST-2E-B** : import des regles validees en base (`pad_nst_recommendation_rules`)
- L'import ne concernera que les regles explicitement approuvees par le CTO
- Aucune regle ne sera importee avec `validation_status = 'validated'`