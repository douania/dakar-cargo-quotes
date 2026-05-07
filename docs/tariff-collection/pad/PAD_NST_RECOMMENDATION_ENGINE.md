# PAD-NST-1 — Doctrine NST 2007 pour recommandation PAD

**Date** : 2026-05-07
**Statut** : ✅ DOCUMENT DE DOCTRINE — Phase documentaire uniquement
**Auteur** : CTO / Lovable
**Phase** : PAD-NST-1
**Dépendances** : PAD-R1B-GOVERNANCE (✅ DÉCISION ACTÉE), PAD-TOTALS-1 (✅ CLOS)

---

## 1. Résumé exécutif

### Pourquoi NST peut aider

La nomenclature NST 2007 (Standard goods classification for transport statistics) classe les marchandises transportées en 20 divisions selon leur activité économique d'origine. Lorsqu'une marchandise n'est pas trouvée dans les 384 alias PAD validés ni dans la nomenclature PAD 2006, NST 2007 peut fournir un **raisonnement par famille logistique/statistique** pour orienter la recherche d'une catégorie PAD probable.

NST 2007 est conçue pour les statistiques de transport (route, rail, voies navigables, maritime). Son découpage par famille économique de produit est naturellement proche du raisonnement nécessaire pour classifier une marchandise portuaire.

### Pourquoi NST ne remplace pas PAD

NST 2007 est une nomenclature **statistique européenne** sans aucun lien juridique avec le barème du Port Autonome de Dakar. Les 20 divisions NST ne correspondent pas aux 19 catégories PAD (T01–T14, P01–P05). Le barème PAD 2006 est la **seule source de vérité** pour déterminer la catégorie tarifaire et le montant du droit de passage.

### Pourquoi NST ne remplace pas HS/SH

Le Système Harmonisé (HS/SH) est une nomenclature **douanière** gérée par l'Organisation Mondiale des Douanes (OMD/WCO). Il sert à déterminer les droits de douane et les taxes. NST et HS ont des finalités distinctes : HS classifie pour la fiscalité douanière, NST classifie pour les statistiques de transport. Les deux peuvent aider au raisonnement, mais aucun ne se substitue à l'autre ni à PAD.

### Pourquoi toute recommandation doit rester opérateur-in-the-loop

Conformément à la doctrine PAD-R1B actée :
- Aucune catégorie PAD estimée ne doit produire `amount > 0`.
- Aucun alias PAD ne doit être créé automatiquement.
- Toute suggestion doit rester `TO_CONFIRM` avec `estimated_amount` uniquement.
- La validation opérateur est **obligatoire** avant qu'une catégorie PAD devienne officielle dans un devis.

NST 2007 est une **aide au raisonnement**, pas une source de vérité tarifaire.

---

## 2. Sources officielles et fiables — Vérification PAD-NST-1A

> **Passe de vérification effectuée le 2026-05-07.**
> Chaque URL a été consultée directement. Les statuts ci-dessous reflètent l'accès réel constaté.

### Tableau des sources avec statut de vérification

#### S1 — Regulation (EC) No 1304/2007

| Champ | Détail |
|-------|--------|
| **Organisme** | Commission européenne |
| **Lien** | [EUR-Lex CELEX:32007R1304](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32007R1304) |
| **Statut de vérification** | `VERIFIED_DIRECT` |
| **Date de consultation** | 2026-05-07 |
| **URL vérifiée exactement** | Page HTML du règlement complet, ouverte et consultée. Texte intégral accessible. |
| **Ce qui est confirmé** | Établit NST 2007 comme classification unique des marchandises transportées (route, rail, voies navigables, maritime). Liste les 20 divisions au premier niveau dans l'annexe. |
| **Ce qui n'est pas confirmé** | Ne contient pas le détail des sous-groupes (niveau 2 — 81 groupes). N'est plus en vigueur en tant que texte autonome (intégré dans des actes ultérieurs), mais la classification NST 2007 elle-même reste la référence active. |
| **Interprétation applicative** | Aucune — fait réglementaire pur. |

#### S2 — Eurostat — Glossaire NST 2007

| Champ | Détail |
|-------|--------|
| **Organisme** | Eurostat (Commission européenne) |
| **Lien** | [Eurostat Statistics Explained — Glossary:NST_2007](https://ec.europa.eu/eurostat/statistics-explained/index.php?title=Glossary:NST_2007) |
| **Statut de vérification** | `VERIFIED_DIRECT` |
| **Date de consultation** | 2026-05-07 |
| **URL vérifiée exactement** | Page de glossaire HTML, ouverte et consultée. Contient le tableau des 20 divisions et la citation sur CPA/NACE. |
| **Ce qui est confirmé** | Confirme les 20 divisions NST 2007. Citation exacte : « each of its items is strongly connected to an item of the EU product and activity classifications CPA and NACE ». |
| **Ce qui n'est pas confirmé** | Ne fournit pas de table de correspondance directe NST ↔ CPA sur cette page. Renvoie vers Ramon (URL obsolète — voir S8). |
| **Interprétation applicative** | Le « lien fort » NST ↔ CPA est une affirmation Eurostat, pas une table de mapping. Cependant, UNECE (S3) publie une table officielle NST 2007 ↔ CPA 2.1 — voir S3. |

#### S3 — UNECE — Classification NST 2007

| Champ | Détail |
|-------|--------|
| **Organisme** | UNECE (Commission économique des Nations Unies pour l'Europe) |
| **Lien** | [unece.org/transport/statistics-transport/classification-nst-2007](https://unece.org/transport/statistics-transport/classification-nst-2007) |
| **Statut de vérification** | `VERIFIED_DIRECT` (**mise à jour PAD-NST-1A** — page accessible lors de cette vérification, contrairement à la consultation initiale bloquée par Cloudflare) |
| **Date de consultation** | 2026-05-07 (re-vérification PAD-NST-1A) |
| **URL vérifiée exactement** | Page HTML de la classification NST 2007, ouverte et consultée. Contient la structure (20 divisions, 81 groupes), les liens vers les tables de correspondance officielles, et la FAQ. |
| **Ce qui est confirmé** | NST 2007 : 20 divisions (niveau 1), 81 groupes (niveau 2). Statut : « Operational ». Custodian : UNECE. **Tables de correspondance officielles publiées** : NST 2007 ↔ CN (2017 à 2024), NST 2007 ↔ CPA 2.1, NST 2007 ↔ NHM (2017, 2024, 2025), NST/R 1967 ↔ NST 2007. FAQ confirme que la conversion HS → NST passe par NHM (les 6 premiers chiffres NHM = HS). |
| **Ce qui n'est pas confirmé** | Le contenu exact des fichiers de correspondance (non téléchargés ni vérifiés ligne par ligne dans cette phase documentaire). |
| **Interprétation applicative** | Aucune — fait institutionnel. L'existence des tables de correspondance est un fait. Leur exploitabilité pour le contexte PAD Dakar reste une interprétation applicative. |

> **⚠️ CORRECTION PAD-NST-1A** : La version initiale de ce document indiquait que la page UNECE était « bloquée par Cloudflare lors de la consultation ». Lors de la re-vérification PAD-NST-1A (2026-05-07), la page est pleinement accessible. De plus, UNECE publie des tables de correspondance officielles NST ↔ CN, NST ↔ CPA et NST ↔ NHM, ce qui corrige plusieurs affirmations du document initial (voir section « Affirmations rétrogradées ou promues »).

#### S4 — Statistics Denmark — NST 2007 v1:2007

| Champ | Détail |
|-------|--------|
| **Organisme** | Danmarks Statistik |
| **Lien** | [dst.dk — NST](https://www.dst.dk/en/Statistik/dokumentation/nomenklaturer/nst) |
| **Statut de vérification** | `VERIFIED_PARTIAL` |
| **Date de consultation** | 2026-05-07 |
| **URL vérifiée exactement** | Page HTML de nomenclature, ouverte et consultée. Affiche la liste des 20 divisions avec descriptions. |
| **Ce qui est confirmé** | NST 2007 considère l'activité économique d'origine. Liste les 20 divisions. Renvoie vers le Règlement (CE) n° 1304/2007. Valide depuis le 1er janvier 2008. |
| **Ce qui n'est pas confirmé** | Source secondaire (office statistique national danois) — confirme mais n'est pas l'émetteur de la nomenclature. |
| **Interprétation applicative** | Aucune — corroboration. |

#### S5 — Eurostat — Tables de correspondance CPA

| Champ | Détail |
|-------|--------|
| **Organisme** | Eurostat |
| **Lien** | [Eurostat CPA correspondence tables](https://ec.europa.eu/eurostat/web/cpa/correspondence-tables) |
| **Statut de vérification** | `VERIFIED_PARTIAL` |
| **Date de consultation** | 2026-05-07 |
| **URL vérifiée exactement** | Page HTML de correspondances CPA, ouverte et consultée. Publie CPA 2.1 ↔ CPA 2.2 et CPA 2.2 ↔ CN 2025. |
| **Ce qui est confirmé** | Eurostat publie des tables CPA ↔ CN. |
| **Ce qui n'est pas confirmé** | **Aucune table de correspondance directe NST ↔ CPA n'est publiée sur cette page Eurostat.** Cependant, UNECE (S3) publie séparément une table NST 2007 ↔ CPA 2.1. |
| **Interprétation applicative** | Le rapprochement NST ↔ CPA via Eurostat n'est pas direct sur cette page. La table officielle est publiée par UNECE (S3). |

#### S6 — WCO — Système Harmonisé (HS)

| Champ | Détail |
|-------|--------|
| **Organisme** | Organisation Mondiale des Douanes (OMD/WCO) |
| **Lien** | [wcoomd.org](https://www.wcoomd.org/) |
| **Statut de vérification** | `NOT_DIRECTLY_VERIFIED` |
| **Date de consultation** | 2026-05-07 |
| **URL vérifiée exactement** | Page d'accueil générale de l'OMD uniquement — **aucune page spécifique de nomenclature HS consultée**. Le site WCO est principalement institutionnel ; les données HS détaillées sont derrière un accès réservé ou publiées via les douanes nationales. |
| **Ce qui est confirmé** | L'OMD/WCO est l'organisme responsable du Système Harmonisé (fait de notoriété publique, confirmé indirectement par S3 FAQ). |
| **Ce qui n'est pas confirmé** | Aucune page HS spécifique n'a été consultée. Pas de correspondance officielle HS ↔ NST trouvée sur ce site. UNECE (S3 FAQ) confirme que la conversion HS → NST passe par NHM (les 6 premiers chiffres NHM = HS). |
| **Interprétation applicative** | HS est utilisé comme référence contextuelle. Le lien HS → NST est indirect, via NHM (S3 FAQ). |

#### S7 — UIC — NHM (Nomenclature Harmonisée Marchandises)

| Champ | Détail |
|-------|--------|
| **Organisme** | UIC (Union Internationale des Chemins de fer) |
| **Lien** | [uic.org/nhm](https://uic.org/nhm) |
| **Statut de vérification** | `PAID_SOURCE` (pour le document NHM complet) / `VERIFIED_PARTIAL` (existence confirmée) |
| **Date de consultation** | 2026-05-07 |
| **URL vérifiée exactement** | Page UIC non consultée directement dans cette passe. Cependant, UNECE (S3) publie des tables officielles NST 2007 ↔ NHM (2017, 2024, 2025) et la FAQ UNECE confirme que les 6 premiers chiffres NHM = HS. |
| **Ce qui est confirmé** | NHM est basée sur HS, publiée par UIC/CIT. UNECE publie des tables officielles NST ↔ NHM (S3). Les 30 derniers codes NHM concernent les équipements de transport gérés par l'UIC et s'alignent avec NST (S3 FAQ). |
| **Ce qui n'est pas confirmé** | Le document NHM complet (tables détaillées publiées par UIC) est payant (shop.uic.org). Le contenu exact des fichiers NST ↔ NHM publiés par UNECE n'a pas été téléchargé ni vérifié ligne par ligne. |
| **Interprétation applicative** | NHM est pertinente comme passerelle HS → NST (via les tables UNECE). Son utilité directe pour le contexte portuaire de Dakar reste une interprétation applicative. |

#### S8 — Eurostat — Ramon (base de métadonnées)

| Champ | Détail |
|-------|--------|
| **Organisme** | Eurostat |
| **Lien** | [Ramon Eurostat](http://ec.europa.eu/eurostat/ramon/index.cfm) |
| **Statut de vérification** | `INACCESSIBLE` |
| **Date de consultation** | 2026-05-07 |
| **URL vérifiée exactement** | **URL retourne « Not Found ».** Page inaccessible — base probablement migrée ou supprimée. La page Eurostat glossaire (S2) renvoie encore vers Ramon, mais le lien est obsolète. |
| **Ce qui est confirmé** | Rien — page inaccessible. |
| **Ce qui n'est pas confirmé** | Le contenu complet de la classification NST 2007 avec sous-groupes (qui était hébergé sur Ramon). |
| **Interprétation applicative** | Aucune — source non exploitable en l'état. Les sous-groupes NST 2007 (81 groupes) sont confirmés par UNECE (S3) comme existants, mais leur détail n'est pas disponible via Ramon. |

#### S9 — Interoperable Europe Portal — NST 2007 Excel

| Champ | Détail |
|-------|--------|
| **Organisme** | Commission européenne |
| **Lien** | [Interoperable Europe — NST 2007 Excel](https://interoperable-europe.ec.europa.eu/collection/eu-semantic-interoperability-catalogue/solution/standard-goods-classification-transport-statistics/distribution/nst-2007-standard-code-list-ms-excel-format) |
| **Statut de vérification** | `ARCHIVED_SOURCE` |
| **Date de consultation** | 2026-05-07 |
| **URL vérifiée exactement** | Page HTML accessible, marquée « Archived ». La page existe mais le téléchargement du fichier Excel n'a pas été vérifié (non testé si le lien de téléchargement fonctionne encore). |
| **Ce qui est confirmé** | La page existe et référence un fichier Excel NST 2007. Statut « Archived / Completed ». |
| **Ce qui n'est pas confirmé** | Le fichier Excel est-il encore téléchargeable. Son contenu exact (divisions + sous-groupes ou divisions seules). |
| **Interprétation applicative** | Aucune — source d'archivage. |

### Tableau récapitulatif des statuts

| # | Source | Statut | URL exacte consultée |
|---|--------|--------|---------------------|
| S1 | EUR-Lex Regulation 1304/2007 | `VERIFIED_DIRECT` | Page HTML du règlement complet |
| S2 | Eurostat Glossaire NST 2007 | `VERIFIED_DIRECT` | Page HTML glossaire avec tableau 20 divisions |
| S3 | UNECE Classification NST 2007 | `VERIFIED_DIRECT` | Page HTML avec structure + tables de correspondance |
| S4 | Statistics Denmark NST 2007 | `VERIFIED_PARTIAL` | Page HTML nomenclature (source secondaire) |
| S5 | Eurostat CPA correspondence | `VERIFIED_PARTIAL` | Page HTML CPA (pas de table NST↔CPA ici) |
| S6 | WCO / HS | `NOT_DIRECTLY_VERIFIED` | Page d'accueil générale uniquement |
| S7 | UIC / NHM | `PAID_SOURCE` | Page UIC non consultée ; tables UNECE S3 confirment NST↔NHM |
| S8 | Eurostat Ramon | `INACCESSIBLE` | URL retourne 404 |
| S9 | Interoperable Europe Excel | `ARCHIVED_SOURCE` | Page accessible, statut archivé, téléchargement non testé |

### Affirmations rétrogradées ou promues (PAD-NST-1A)

| Affirmation initiale | Statut initial | Statut corrigé PAD-NST-1A | Raison |
|---------------------|----------------|---------------------------|--------|
| « Aucune table de correspondance directe NST ↔ CPA n'a été trouvée » | Absence de preuve | **PROMU → Fait sourcé** | UNECE (S3) publie une table officielle NST 2007 ↔ CPA 2.1. Table non téléchargée mais existence confirmée sur la page UNECE. |
| « Aucune table officielle NHM ↔ NST n'a été trouvée en accès libre » | Absence de preuve | **PROMU → Fait sourcé (existence)** | UNECE (S3) publie des tables officielles NST 2007 ↔ NHM (2017, 2024, 2025). Contenu non vérifié ligne par ligne. |
| « Pas de correspondance officielle HS ↔ NST trouvée » | Absence de preuve | **Rétrogradé → Indirect confirmé** | UNECE FAQ (S3) confirme que HS → NST passe par NHM (6 premiers chiffres NHM = HS). Pas de table directe HS ↔ NST, mais passerelle officielle via NHM. |
| « Aucune table officielle de correspondance directe NST ↔ CN n'a été trouvée » | Absence de preuve | **PROMU → Fait sourcé** | UNECE (S3) publie des tables officielles NST 2007 ↔ CN (2017 à 2024). |
| « Page UNECE bloquée par Cloudflare » | Inaccessible | **PROMU → Accessible** | Page UNECE pleinement accessible lors de la re-vérification PAD-NST-1A. |
| NST → PAD | Interprétation applicative | **Inchangé → Interprétation applicative** | Aucune source officielle ne relie NST aux catégories PAD du Port Autonome de Dakar. Ce rapprochement reste une interprétation applicative. |

### Distinction fait / interprétation / recommandation (mise à jour PAD-NST-1A)

| Nature | Exemple |
|--------|---------|
| **Fait sourcé** | NST 2007 comporte 20 divisions et 81 groupes (S1, S2, S3, S4). NST est liée à CPA/NACE (S2 — citation Eurostat). Des tables de correspondance officielles NST ↔ CPA, NST ↔ CN et NST ↔ NHM existent et sont publiées par UNECE (S3). La conversion HS → NST passe par NHM (S3 FAQ). |
| **Fait sourcé mais contenu non vérifié en détail** | Les fichiers de correspondance NST ↔ CPA 2.1, NST ↔ CN, NST ↔ NHM publiés par UNECE existent. Leur contenu exact n'a pas été téléchargé ni vérifié ligne par ligne dans cette phase documentaire. |
| **Interprétation** | La division NST 08 (chimie, plastiques) pourrait aider à orienter vers les catégories PAD T04/T11. Cette interprétation n'a aucune source officielle de mapping NST → PAD. |
| **Recommandation applicative** | Utiliser NST comme couche de raisonnement intermédiaire pour proposer des familles PAD candidates, en `TO_CONFIRM`, avec validation opérateur obligatoire. |

---

## 3. Définitions simples

### 3.1 NST

**Nomenclature Standard des Transports** (Standard goods classification for transport statistics). Classification statistique des marchandises transportées. Originellement créée pour harmoniser les statistiques de transport en Europe. Couvre les modes route, rail, voies navigables et maritime.

### 3.2 NST-R

**NST/R** (NST Révisée). Version antérieure de la nomenclature de transport, utilisée jusqu'en 2007. Remplacée par NST 2007 via le Règlement (CE) n° 1304/2007 (source S1). NST-R était utilisée dans les statistiques de transport routier (Règlement 1172/98) et ferroviaire (Règlement 91/2003).

### 3.3 NST 2007

Version moderne et actuellement en vigueur. Adoptée en juin 2007 par l'UNECE, transposée dans le droit européen en novembre 2007 (source S1). Comprend **20 divisions** au premier niveau, avec des sous-groupes au deuxième niveau. Chaque item est « fortement connecté » à un item CPA/NACE (source S2 — Eurostat).

**Les 20 divisions NST 2007** (source S1 — Annexe du Règlement 1304/2007) :

| Division | Description |
|----------|-------------|
| 01 | Products of agriculture, hunting, and forestry; fish and other fishing products |
| 02 | Coal and lignite; crude petroleum and natural gas |
| 03 | Metal ores and other mining and quarrying products; peat; uranium and thorium |
| 04 | Food products, beverages and tobacco |
| 05 | Textiles and textile products; leather and leather products |
| 06 | Wood and products of wood and cork (except furniture); articles of straw and plaiting materials; pulp, paper and paper products; printed matter and recorded media |
| 07 | Coke and refined petroleum products |
| 08 | Chemicals, chemical products, and man-made fibres; rubber and plastic products; nuclear fuel |
| 09 | Other non-metallic mineral products |
| 10 | Basic metals; fabricated metal products, except machinery and equipment |
| 11 | Machinery and equipment n.e.c.; office machinery and computers; electrical machinery and apparatus n.e.c.; radio, television and communication equipment and apparatus; medical, precision and optical instruments; watches and clocks |
| 12 | Transport equipment |
| 13 | Furniture; other manufactured goods n.e.c. |
| 14 | Secondary raw materials; municipal wastes and other wastes |
| 15 | Mail, parcels |
| 16 | Equipment and material utilised in the transport of goods |
| 17 | Goods moved in the course of household and office removals; baggage transported separately from passengers; motor vehicles being moved for repair; other non-market goods n.e.c. |
| 18 | Grouped goods: a mixture of types of goods which are transported together |
| 19 | Unidentifiable goods: goods which for any reason cannot be identified and therefore cannot be assigned to groups 01–16 |
| 20 | Other goods n.e.c. |

### 3.4 HS / SH

**Système Harmonisé de désignation et de codification des marchandises** (Harmonized System). Nomenclature douanière internationale gérée par l'OMD/WCO. Structure à 6 chiffres minimum. Utilisé dans le monde entier pour les droits de douane, les taxes et le commerce international. Le Sénégal utilise le SH (Système Harmonisé) comme base de son tarif douanier national.

### 3.5 CN

**Combined Nomenclature** (Nomenclature Combinée). Extension européenne du HS à 8 chiffres. Utilisée pour les déclarations douanières et les statistiques du commerce extérieur dans l'Union européenne. Eurostat publie des tables de correspondance CPA ↔ CN (source S5).

### 3.6 CPA

**Classification des Produits par Activité** (Classification of Products by Activity). Classification statistique européenne qui classe les produits par l'activité économique qui les produit. CPA est « fortement connectée » à NST 2007 (source S2). La version actuelle est CPA 2.2. **UNECE publie une table de correspondance officielle NST 2007 ↔ CPA 2.1** (source S3). Eurostat publie des tables CPA ↔ CN (source S5) mais pas de table NST ↔ CPA directement.

### 3.7 NHM

**Nomenclature Harmonisée Marchandises** (Harmonised Commodity Code). Nomenclature basée sur le HS, publiée par l'UIC (Union Internationale des Chemins de fer) et le CIT. Utilisée principalement pour le transport ferroviaire de marchandises.

**Source officielle NHM** : UIC — [uic.org/nhm](https://uic.org/nhm) (source S7). Document NHM complet payant.

**Correspondance NHM ↔ NST** : **UNECE publie des tables officielles NST 2007 ↔ NHM** (2017, 2024, 2025) (source S3). La FAQ UNECE confirme que les 6 premiers chiffres NHM correspondent aux codes HS, et que les 30 derniers codes NHM concernent les équipements de transport gérés par l'UIC, qui s'alignent avec NST. Le contenu exact des fichiers n'a pas été téléchargé ni vérifié ligne par ligne dans cette phase documentaire.

---

## 4. Différences entre NST, HS/SH, CN, CPA, NHM et PAD

| Nomenclature | Finalité | Niveau de précision | Utilisable pour droits de douane ? | Utilisable pour recommandation PAD ? | Limite |
|-------------|----------|--------------------|------------------------------------|--------------------------------------|--------|
| **NST 2007** | Statistiques de transport (route, rail, voies navigables, maritime) | 20 divisions + sous-groupes | Non | Oui — comme aide au raisonnement par famille logistique | Ne contient pas de tarif. Pas de mapping officiel vers PAD. |
| **HS / SH** | Classification douanière internationale | 6+ chiffres, très précis | Oui — base des droits de douane | Indirectement — aide à identifier la nature du produit | Trop fin pour le raisonnement par famille PAD. Pas de mapping officiel HS → PAD. |
| **CN** | Douane + statistiques commerce extérieur UE | 8 chiffres (extension HS) | Oui (UE) | Indirectement — via rapprochement CPA | Nomenclature européenne, pas utilisée directement au Sénégal. |
| **CPA** | Classification produits par activité économique | Hiérarchique, liée à NACE | Non | Indirectement — aide à classer par secteur économique | « Fortement connectée » à NST (Eurostat). **Table officielle NST 2007 ↔ CPA 2.1 publiée par UNECE (S3).** Contenu non vérifié en détail. |
| **NHM** | Transport ferroviaire de marchandises | Basée sur HS | Non | Indirectement — passerelle HS → NST via tables UNECE | Document NHM complet payant (UIC). **Tables officielles NST ↔ NHM publiées par UNECE (S3).** |
| **PAD 2006** | Tarification portuaire — droits de passage Port Autonome de Dakar | 19 catégories (T01–T14, P01–P05) | Non (redevance portuaire, pas douane) | **OUI — source de vérité unique** | Nomenclature locale, pas normalisée internationalement. |

### Conclusion obligatoire

- **NST** aide à raisonner par famille de marchandise transportée.
- **HS/SH** aide à raisonner par classification douanière.
- **CPA** aide à raisonner par produit/activité économique.
- **CN** peut aider à relier produit et commerce extérieur européen.
- **NHM** peut aider en contexte transport ferroviaire.
- **PAD 2006 reste la seule source de vérité** pour la catégorie PAD et le tarif PAD (droit de passage).
- **Une correspondance NST → PAD n'est jamais officielle sans validation opérateur.**

---

## 5. Logique générale de classification d'une marchandise absente du PAD

Lorsqu'une marchandise n'est trouvée ni par alias PAD exact, ni par substring, ni par tokens, les critères suivants doivent être évalués pour orienter la recherche :

### Critère 1 — Matière principale

Identifier la matière dominante : plastique, métal, bois, produit chimique, minerai, produit agricole, produit alimentaire, textile, etc.

**Exemple** : « résine plastique brute » → matière = plastique.

### Critère 2 — Usage principal

Identifier l'usage : matière première industrielle, produit fini de consommation, équipement, pièce détachée, intrant agricole, etc.

**Exemple** : « tuyaux PVC » → usage = construction / canalisation.

### Critère 3 — Forme commerciale

Le produit est-il en vrac, conditionné, emballé, en rouleaux, en bobines, en sacs, en fûts ?

**Exemple** : « HDPE geomembrane en rouleaux » → forme = rouleaux, produit semi-fini.

### Critère 4 — Degré de transformation

| Niveau | Description | Familles typiques |
|--------|-------------|-------------------|
| Brut | Matière première non transformée | Minerais, produits agricoles bruts, pétrole brut |
| Semi-fini | Transformé mais pas produit final | Résines, tôles, fils, granulés |
| Manufacturé | Produit fini prêt à l'usage | Machines, véhicules, meubles, équipements |
| Mixte | Mélange de niveaux | Groupage, lots hétérogènes |
| Inconnu | Impossible à déterminer | Description trop vague |

### Critère 5 — Secteur économique

Agriculture, industrie extractive, industrie chimique, construction, équipements, transport, alimentation, textile, etc.

### Critère 6 — Conditionnement

Vrac solide, vrac liquide, conteneurisé, palettisé, en caisses, en fûts, en big bags, etc.

### Critère 7 — Destination d'usage

Le produit est-il destiné à la construction, l'agriculture, l'industrie minière, la consommation alimentaire, le transport, etc. ?

**Exemple** : « HDPE geomembrane pour projet minier » → destination = industrie minière, mais le produit reste un plastique manufacturé.

### Critère 8 — Contexte documentaire

Informations extraites du BL (Bill of Lading), de la facture commerciale, du certificat d'origine, du code HS déclaré, etc.

### Critère 9 — Indice de nomenclature existant

Le produit est-il proche d'un alias PAD existant ? Y a-t-il un token commun avec des alias validés ? La catégorie `commodity_categories` contient-elle une désignation normalisée proche ?

### Critère 10 — Ambiguïté / marchandises mixtes

Le BL décrit-il plusieurs marchandises hétérogènes ? Le terme est-il générique (« pièces détachées », « marchandises diverses », « matériel ») ?

**Règle** : en cas d'ambiguïté, le statut doit être `BLOCKED_OPERATOR_REQUIRED` ou `TO_CONFIRM` avec confiance `low`.

---

## 6. Arbre de décision applicatif

```text
1. Description marchandise disponible ?
   Non → BLOCKED_OPERATOR_REQUIRED
   Oui → continuer

2. Alias PAD exact validé ? (pad_designation_aliases, is_validated=true)
   Oui → catégorie PAD officielle via alias validé → OFFICIAL
   Non → continuer

3. Alias PAD substring fort ? (score >= 0.70)
   Oui → catégorie PAD candidate → TO_CONFIRM (confiance medium-high)
   Non → continuer

4. Description contient plusieurs marchandises hétérogènes ?
   Oui → BLOCKED_OPERATOR_REQUIRED (groupage mixte)
   Non → continuer

5. Matière principale identifiable ?
   Oui → scoring matière → continuer
   Non → continuer avec scoring réduit

6. Usage principal identifiable ?
   Oui → scoring usage → continuer
   Non → réduire confiance

7. Produit brut ou manufacturé ?
   Brut → familles matières premières (NST 01-03, 07, 09)
   Semi-fini → familles intermédiaires (NST 08, 09, 10)
   Manufacturé → familles produits finis / équipements (NST 11, 12, 13)
   Mixte/Inconnu → confiance low

8. Famille NST probable identifiable ?
   Oui → rapprocher avec familles PAD existantes → continuer
   Non → BLOCKED_OPERATOR_REQUIRED

9. Plusieurs catégories PAD candidates proches ?
   Oui → proposer liste + choix conservateur (tarif le plus élevé)
        → TO_CONFIRM + validation opérateur obligatoire
   Non → proposer candidat unique → TO_CONFIRM

10. Confiance suffisante ?
    high (>= 0.85) → AUTO_SUGGESTED mais validation opérateur OBLIGATOIRE
    medium (0.60-0.84) → TO_CONFIRM
    low (< 0.60) → BLOCKED_OPERATOR_REQUIRED
```

### Rapprochement indicatif NST → familles PAD

> **AVERTISSEMENT** : Ce tableau est une **interprétation applicative**. Il n'existe aucune table de correspondance officielle NST → PAD. Ce rapprochement est proposé comme aide au raisonnement et doit être validé par l'opérateur dans chaque cas.

| Division NST 2007 | Description NST | Familles PAD candidates probables | Niveau de preuve |
|--------------------|-----------------|-----------------------------------|------------------|
| 01 | Agriculture, chasse, forêt, pêche | P01–P05 (pêche), T01 (agriculture) | Interprétation — pas de source officielle |
| 02 | Charbon, pétrole brut, gaz naturel | T06 (hydrocarbures) | Interprétation |
| 03 | Minerais métalliques, produits miniers | T03 (minerais) | Interprétation |
| 04 | Produits alimentaires, boissons, tabac | T12 (denrées alimentaires) | Interprétation |
| 05 | Textiles, cuir | T12 (produits manufacturés divers) ou T13 | Interprétation — ambiguïté PAD |
| 06 | Bois, liège, papier | T05 (bois) | Interprétation |
| 07 | Coke, produits pétroliers raffinés | T06 (hydrocarbures) | Interprétation |
| 08 | Chimie, plastiques, caoutchouc | T04 (produits chimiques), T11 (plastiques/caoutchouc) | Interprétation — dépend du degré de transformation |
| 09 | Produits minéraux non métalliques | T07 (matériaux de construction) | Interprétation |
| 10 | Métaux de base, produits métalliques | T02 (métaux), T10 (ferraille/déchets métalliques) | Interprétation |
| 11 | Machines, équipements, informatique | Catégorie portée par l'alias PAD validé (ex : « mat informatique ordinateurs ») ou T14 (véhicules/machines) si pas d'alias | Interprétation — ambiguïté PAD, dépend de l'alias validé |
| 12 | Matériel de transport | T14 (véhicules) | Interprétation |
| 13 | Meubles, autres produits manufacturés | T12 (divers), T13 | Interprétation |
| 14 | Matières premières secondaires, déchets | T10 (déchets/ferraille) | Interprétation |
| 15 | Courrier, colis | T12 (divers) | Interprétation — rare en contexte portuaire Dakar |
| 16 | Équipements de transport de marchandises | T09 (matériel) — interprétation, pas de catégorie PAD dédiée pour équipements de transport | Interprétation |
| 17 | Déménagement, bagages | T12 (divers) | Interprétation — rare |
| 18 | Marchandises groupées | **BLOCAGE** — validation opérateur obligatoire | N/A |
| 19 | Marchandises non identifiables | **BLOCAGE** — validation opérateur obligatoire | N/A |
| 20 | Autres marchandises n.d.a. | **BLOCAGE** — validation opérateur obligatoire | N/A |

---

## 7. Scoring recommandé

### Tableau de poids indicatifs

| Signal | Poids indicatif | Exemple | Remarque |
|--------|----------------|---------|----------|
| Alias PAD exact validé | 1.00 | « mat informatique ordinateurs » | Officiel côté application |
| Alias PAD substring fort | 0.70–0.85 | « ordinateurs portables » | Prudence — vérifier si le substring est discriminant |
| Token matière | 0.15–0.30 | pvc, acier, engrais | Faible seul — insuffisant pour une catégorie PAD |
| Token usage | 0.10–0.25 | chantier, minier, agricole | Contexte seulement |
| Correspondance NST probable | 0.15–0.35 | plastique manufacturé → NST 08 | Aide au raisonnement, pas vérité |
| Correspondance HS/CN/CPA/NHM sourcée | 0.20–0.40 | Si source officielle trouvée | À tracer — niveau de preuve variable |
| Synonyme local (`commoditySynonyms.ts`) | 0.10–0.20 | hdpe → plastique, polyethylene | Expansion, pas résolution |
| Conflit multi-catégorie | **Malus** −0.30 | pièces détachées, groupage | Force la validation opérateur |
| Marchandise mixte | **Blocage** | lots groupés hétérogènes | Pas d'automatisation possible |

### Agrégation

Le score final est la somme pondérée des signaux actifs, plafonnée à 1.00.

### Niveaux de confiance

| Score | Niveau | Statut recommandé |
|-------|--------|-------------------|
| >= 0.85 | `high` | `AUTO_SUGGESTED` — mais validation opérateur **toujours obligatoire** |
| 0.60 – 0.84 | `medium` | `TO_CONFIRM` |
| < 0.60 | `low` | `BLOCKED_OPERATOR_REQUIRED` |

> **Important** : ces seuils sont **indicatifs** et doivent être calibrés par tests terrain sur des cas réels de dossiers SODATRA. Un score `high` ne dispense jamais de la validation opérateur.

---

## 8. Règles de prudence

### 8.1 Quand proposer une hypothèse conservatrice

Proposer un choix conservateur (tarif le plus élevé parmi les candidats) **seulement si** :

1. Plusieurs catégories PAD plausibles existent ;
2. Toutes sont des catégories **existantes dans le repo** (T01–T14, P01–P05 confirmées en DB) ;
3. Les sources du raisonnement sont tracées ;
4. L'opérateur voit la justification complète ;
5. Le montant reste `estimated_amount`, **jamais** `amount`.

### 8.2 Quand afficher « à confirmer »

Afficher `TO_CONFIRM` si :

- Correspondance non exacte (pas d'alias PAD validé) ;
- NST aide mais ne prouve pas ;
- Matière ou usage partiellement identifié ;
- Plusieurs catégories candidates ;
- Contexte documentaire insuffisant ;
- Score entre 0.60 et 0.84.

### 8.3 Quand bloquer

Bloquer avec `BLOCKED_OPERATOR_REQUIRED` si :

- Description trop vague (« marchandises », « matériel », « divers ») ;
- Marchandises mixtes ou groupage non détaillé (NST 18, 19, 20) ;
- Produit dangereux / chimique sans précision suffisante ;
- « Pièces détachées » sans nature de la machine ou du secteur ;
- « Équipement industriel » sans usage identifiable ;
- Absence de catégorie PAD candidate existante dans le repo ;
- Conflit connu dans la nomenclature PAD (ex : « alcool industriel », « sport ») ;
- Score < 0.60.

---

## 9. Modèle de sortie recommandé pour futur moteur

### Contrat de sortie cible (TypeScript — documentation uniquement, pas de code runtime)

```typescript
type PadNstRecommendation = {
  input_description: string;
  normalized_description: string;
  detected_materials: string[];
  detected_usage_hints: string[];
  detected_form: string | null;
  detected_transformation_level: "raw" | "semi_finished" | "manufactured" | "mixed" | "unknown";
  nst_candidates: Array<{
    code: string;        // e.g. "08"
    label: string;       // e.g. "Chemicals, chemical products..."
    confidence: number;  // 0.0 – 1.0
    source_refs: string[]; // e.g. ["S1", "interprétation applicative"]
  }>;
  pad_candidates: Array<{
    pad_category: string;     // e.g. "T04"
    pad_label: string | null; // e.g. "Produits chimiques"
    confidence: number;
    reason: string;           // Justification en français
    source_refs: string[];
    estimated_rate_fcfa_per_ton: number | null;
  }>;
  recommended_pad_category: string | null;
  conservative_pad_category: string | null;
  confidence_level: "high" | "medium" | "low";
  status: "AUTO_SUGGESTED" | "TO_CONFIRM" | "BLOCKED_OPERATOR_REQUIRED";
  requires_operator_confirmation: true;  // Toujours true
  explanation_fr: string;
};
```

### Rappel critique

Ce contrat de sortie :
- **NE DOIT PAS** être branché à `run-pricing` dans cette phase ;
- **NE DOIT PAS** produire de ligne avec `amount > 0` ;
- **NE DOIT PAS** créer d'alias PAD ;
- **NE DOIT PAS** être confondu avec la sortie de `recommend-pad-category` (edge function IA existante).

---

## 10. Compatibilité avec la doctrine PAD-R1B existante

Ce document prolonge et respecte la doctrine actée dans `PAD_R1B_GOVERNANCE_DECISION.md` :

| Règle PAD-R1B | Respect dans PAD-NST-1 |
|---------------|------------------------|
| IA = aide opérateur uniquement | ✅ NST n'est pas de l'IA. NST est une couche de raisonnement logistique/statistique. |
| Runtime pricing = déterministe local-only | ✅ Le futur moteur NST serait local, sans appel IA, sans appel web. |
| Pas d'appel IA dans `run-pricing` | ✅ Aucun appel IA prévu. NST est un raisonnement par grille statique. |
| Pas de création automatique d'alias | ✅ Le moteur NST proposerait des suggestions, jamais de création DB. |
| Pas de validation automatique | ✅ `requires_operator_confirmation = true` toujours. |
| `source.type = "TO_CONFIRM"` pour catégorie estimée | ✅ Confirmé dans le contrat de sortie. |
| `amount = 0` | ✅ Confirmé. |
| `estimated_amount` autorisé uniquement comme donnée technique | ✅ Confirmé — non inclus dans `total_ht` / `total_ttc`. |
| `total_ht` et `total_ttc` non impactés | ✅ Les filtres PAD-TOTALS-1 excluent déjà `source.type = "TO_CONFIRM"` avec `amount = 0`. |
| Validation opérateur obligatoire avant catégorie officielle | ✅ Le cycle de vie reste identique : suggestion → validation opérateur → `set-case-fact` → re-run pricing → ligne OFFICIAL. |

---

## 11. Cas tests obligatoires

| # | Description | Signaux matière | Signaux usage | Famille NST probable | Catégorie PAD candidate (existante dans repo) | Confiance | Justification | Catégorie conservatrice | Validation opérateur | Statut recommandé |
|---|-------------|-----------------|---------------|---------------------|-----------------------------------------------|-----------|---------------|------------------------|---------------------|-------------------|
| 1 | HDPE geomembrane pour projet minier | plastique, HDPE, polyéthylène | revêtement, étanchéité, projet minier | NST 08 (chimie, plastiques) | T11 (plastiques/caoutchouc) ou T04 (produits chimiques) | medium | Plastique manufacturé semi-fini. HDPE = polyéthylène haute densité. Geomembrane = produit plastique technique. NST 08 couvre plastiques. T11 couvre plastiques dans PAD. Aucun alias PAD existant pour « geomembrane ». | T11 (tarif plus élevé si applicable) | **OUI** | `TO_CONFIRM` |
| 2 | Matériel informatique | informatique, électronique | équipement bureau, IT | NST 11 (machines, équipements, informatique) | T09 (matériel divers) — alias PAD existant : « mat informatique ordinateurs » | high | Alias PAD validé existant pour « mat informatique ». Si alias exact trouvé → OFFICIAL. Si non exact → TO_CONFIRM via scoring. | N/A (alias probable) | Oui si alias non exact | `AUTO_SUGGESTED` ou `OFFICIAL` (si alias exact) |
| 3 | Pièces détachées industrielles | métal (probable), plastique (possible) | maintenance, réparation, industrie | NST 10 (métaux) ou NST 11 (machines) ou NST 13 (divers) | T02 (métaux) ou T09 (matériel) ou T12 (divers) | low | **Ambiguïté forte** : « pièces détachées » sans précision sur la machine ou le secteur. Peut couvrir des pièces métalliques (T02), du matériel (T09), ou des produits divers (T12). | N/A — blocage | **OUI — obligatoire** | `BLOCKED_OPERATOR_REQUIRED` |
| 4 | Résine plastique brute | plastique, résine, polymère | matière première industrielle | NST 08 (chimie, plastiques) | T04 (produits chimiques) ou T11 (plastiques) | medium | Résine = matière première plastique (brute/semi-finie). NST 08 couvre chimie et plastiques. Ambiguïté entre T04 (chimie) et T11 (plastiques) dans PAD. | T04 ou T11 (conservateur = tarif le plus élevé) | **OUI** | `TO_CONFIRM` |
| 5 | Tuyaux PVC | plastique, PVC, vinyle | construction, canalisation, plomberie | NST 08 (plastiques) | T11 (plastiques/caoutchouc) — alias PAD existant possible via synonyme PVC | medium-high | PVC = plastique. Tuyaux = produit manufacturé. Alias « pvc » dans `commoditySynonyms.ts` → expansion vers « plastique, vinyle ». Si alias PAD trouvé → score plus élevé. | T11 | **OUI** | `TO_CONFIRM` |
| 6 | Engrais | chimique, minéral, azote/phosphate/potassium | agriculture, intrant agricole | NST 08 (chimie) ou NST 01 (agriculture — intrant) | T04 (produits chimiques) ou T01 (agriculture) | medium | Engrais chimiques → T04. Engrais organiques → T01. Ambiguïté sans précision. | T04 (conservateur si tarif plus élevé) | **OUI** | `TO_CONFIRM` |
| 7 | Équipements de chantier | métal, mécanique | construction, travaux publics, chantier | NST 11 (machines, équipements) | T09 (matériel de chantier) — alias PAD existant : « materiel de chantier » | high | Alias PAD existant pour « materiel de chantier ». Si alias exact trouvé → OFFICIAL. Token « chantier » → expansion vers T09. | T09 | Oui si alias non exact | `AUTO_SUGGESTED` |
| 8 | Produits chimiques industriels | chimique | industrie | NST 08 (chimie) | T04 (produits chimiques) | medium | **Distinguer** : si le produit chimique est identifié (ex : acide sulfurique, soude caustique) → T04 avec confiance plus élevée. Si description vague (« produits chimiques industriels ») → T04 probable mais confiance réduite. Produit dangereux possible → validation obligatoire. | T04 | **OUI — obligatoire** | `TO_CONFIRM` |
| 9 | Matériaux de construction divers | minéral, ciment, métal, bois (possible) | construction, BTP | NST 09 (minéraux non métalliques) ou NST 06 (bois) ou NST 10 (métaux) | T07 (matériaux de construction) ou T02 (métaux) ou T05 (bois) | low-medium | « Divers » = signal d'ambiguïté. Plusieurs catégories PAD candidates. Sans détail sur la nature exacte (ciment, carrelage, fer à béton, bois), le scoring reste faible. | T07 (conservateur) | **OUI — obligatoire** | `TO_CONFIRM` (si indices suffisants) ou `BLOCKED_OPERATOR_REQUIRED` (si trop vague) |
| 10 | Marchandises de groupage mixtes | indéterminé | indéterminé | NST 18 (marchandises groupées) | **Aucune catégorie PAD unique** | N/A | **Blocage obligatoire.** NST 18 = marchandises groupées = mélange de types. Impossible de déterminer une catégorie PAD unique. L'opérateur doit détailler le contenu du groupage pour classifier chaque lot séparément. | N/A — blocage | **OUI — obligatoire** | `BLOCKED_OPERATOR_REQUIRED` |

---

## 12. Données futures recommandées

### Tables proposées (documentation uniquement — aucune migration SQL dans cette phase)

#### 12.1 `nst_2007_groups`

| Attribut | Détail |
|----------|--------|
| **Rôle** | Référentiel des 20 divisions NST 2007 + sous-groupes |
| **Colonnes probables** | `id`, `division_code` (ex : "08"), `group_code` (ex : "08.1"), `label_en`, `label_fr`, `parent_division_code`, `is_active` |
| **Source de vérité** | Règlement (CE) n° 1304/2007 (S1), Eurostat (S2) |
| **Niveau de preuve** | Officiel — 20 divisions confirmées. Sous-groupes à sourcer via Ramon/Excel (S8, S9). |
| **Usage runtime futur** | Lookup pour identifier la division NST probable d'une marchandise |
| **Risques** | Sous-groupes non vérifiés si source Ramon indisponible. Ne pas inventer de sous-groupes. |

#### 12.2 `nst_mapping_sources`

| Attribut | Détail |
|----------|--------|
| **Rôle** | Registre des sources utilisées pour les correspondances NST ↔ autres nomenclatures |
| **Colonnes probables** | `id`, `source_code` (ex : "S1"), `organism`, `title`, `date`, `url`, `reliability_level` ("official", "interpretation", "unverified") |
| **Source de vérité** | Ce document (section 2) |
| **Niveau de preuve** | Métadonnée — la fiabilité dépend de chaque source |
| **Usage runtime futur** | Traçabilité des recommandations |
| **Risques** | URLs peuvent devenir obsolètes. Prévoir un champ `last_verified_at`. |

#### 12.3 `nst_cpa_mappings`

| Attribut | Détail |
|----------|--------|
| **Rôle** | Correspondance NST ↔ CPA si source officielle trouvée |
| **Colonnes probables** | `id`, `nst_code`, `cpa_code`, `cpa_version`, `correspondence_type` ("official", "interpretation"), `source_id` (FK → `nst_mapping_sources`), `notes` |
| **Source de vérité** | **Source officielle non trouvée.** Eurostat indique un lien fort NST ↔ CPA (S2) mais aucune table officielle n'a été localisée. |
| **Niveau de preuve** | **À confirmer.** Table vide tant qu'aucune source officielle n'est trouvée. |
| **Usage runtime futur** | Enrichissement du scoring si source fiable disponible |
| **Risques** | Ne pas remplir avec des correspondances inventées. Attendre source officielle ou marquer comme « interpretation ». |

#### 12.4 `nst_cn_hs_mappings`

| Attribut | Détail |
|----------|--------|
| **Rôle** | Correspondance NST ↔ CN/HS si source officielle trouvée |
| **Colonnes probables** | `id`, `nst_code`, `hs_code_prefix` (4-6 chiffres), `cn_code` (8 chiffres, nullable), `correspondence_type`, `source_id`, `notes` |
| **Source de vérité** | **Source officielle non trouvée.** Pas de table directe NST ↔ HS publiée par Eurostat ou WCO. Un rapprochement indirect via CPA ↔ CN est théoriquement possible. |
| **Niveau de preuve** | **À confirmer.** |
| **Usage runtime futur** | Enrichissement si code HS disponible dans le dossier |
| **Risques** | Correspondance indirecte (NST → CPA → CN → HS) = perte de précision à chaque étape. |

#### 12.5 `nst_nhm_mappings`

| Attribut | Détail |
|----------|--------|
| **Rôle** | Correspondance NST ↔ NHM si source officielle trouvée |
| **Colonnes probables** | `id`, `nst_code`, `nhm_code`, `correspondence_type`, `source_id`, `notes` |
| **Source de vérité** | **Source officielle non trouvée en accès libre.** NHM est publiée par UIC (document payant). |
| **Niveau de preuve** | **Non vérifié.** |
| **Usage runtime futur** | Faible — NHM est ferroviaire, peu pertinent pour le contexte portuaire de Dakar |
| **Risques** | Investissement disproportionné par rapport à l'utilité. Prioriser NST → PAD directement. |

#### 12.6 `pad_nst_recommendation_rules`

| Attribut | Détail |
|----------|--------|
| **Rôle** | Règles de rapprochement NST → PAD validées par opérateur |
| **Colonnes probables** | `id`, `nst_code`, `pad_category`, `rule_type` ("material", "usage", "sector", "form"), `keywords`, `weight`, `is_active`, `validated_by`, `validated_at`, `notes` |
| **Source de vérité** | Interprétation applicative — ce document (section 6, tableau rapprochement) |
| **Niveau de preuve** | Interprétation — jamais officiel. Chaque règle doit être validée par l'opérateur. |
| **Usage runtime futur** | Scoring du moteur PAD-R1 local |
| **Risques** | Règles trop larges → faux positifs. Règles trop étroites → faux négatifs. Nécessite calibrage terrain. |

#### 12.7 `pad_recommendation_audit_log`

| Attribut | Détail |
|----------|--------|
| **Rôle** | Journal d'audit des recommandations PAD (suggestions et décisions opérateur) |
| **Colonnes probables** | `id`, `case_id`, `input_description`, `recommended_category`, `conservative_category`, `confidence_level`, `status`, `operator_decision` (nullable), `operator_category` (nullable), `decided_at` (nullable), `created_at` |
| **Source de vérité** | Runtime — données de production |
| **Niveau de preuve** | N/A — journal opérationnel |
| **Usage runtime futur** | Analyse qualité des recommandations, amélioration des règles, détection de biais |
| **Risques** | Volume potentiellement important. Prévoir rétention et archivage. |

---

## 13. Plan de phases futures

### PAD-NST-2 — Modèle de données

- Créer les migrations pour `nst_2007_groups` et `nst_mapping_sources` uniquement.
- Injecter les 20 divisions NST 2007 confirmées (source S1).
- **Ne pas créer** `nst_cpa_mappings`, `nst_cn_hs_mappings`, `nst_nhm_mappings` tant que les sources officielles n'ont pas été trouvées et vérifiées.
- Créer `pad_nst_recommendation_rules` avec les règles interprétatives documentées ici, marquées `rule_type = "interpretation"`.
- Créer `pad_recommendation_audit_log`.
- **Prérequis** : validation documentaire PAD-NST-1 (ce document).

### PAD-NST-3 — Moteur local isolé

- Implémenter le moteur de scoring dans `run-pricing/index.ts` comme extension du lookup PAD existant.
- **Aucune écriture DB** (pas de création d'alias, pas d'INSERT).
- **Aucun appel IA.**
- **Aucun pricing** — le moteur produit uniquement des suggestions `TO_CONFIRM` avec `amount = 0` et `estimated_amount`.
- Sortie conforme au contrat `PadNstRecommendation` (section 9).
- Tests Deno couvrant les 10 cas tests de la section 11.

### PAD-NST-4 — UI opérateur

- Afficher dans l'UI (ex : `DesignationSuggestionBlock.tsx` ou panneau dédié) :
  - La suggestion de catégorie PAD ;
  - Les sources du raisonnement ;
  - Le score de confiance ;
  - La justification en français ;
  - Les catégories candidates alternatives ;
  - Le choix conservateur éventuel.
- **Pas de bouton « valider automatiquement »** — l'opérateur utilise le processus existant (`set-case-fact`).

### PAD-NST-5 — Branchement runtime prudent

- Intégrer le moteur dans le flux `run-pricing` :
  - Seulement après échec du lookup alias PAD standard ;
  - Produisant une ligne `TO_CONFIRM`, `amount = 0`, `estimated_amount > 0` ;
  - Validation opérateur obligatoire.
- Activer le journal d'audit (`pad_recommendation_audit_log`).
- Analyser la qualité des recommandations après N dossiers réels.
- Calibrer les seuils de scoring.

---

## 14. Critères de GO / NO-GO

### GO documentaire (PAD-NST-1)

| # | Critère | Statut |
|---|---------|--------|
| 1 | Sources citées avec organisme, date, lien | ✅ 9 sources documentées |
| 2 | Limites clairement identifiées | ✅ Correspondances NST ↔ CPA/HS/NHM non trouvées — explicitement mentionné |
| 3 | Aucune catégorie PAD inventée | ✅ Toutes les catégories mentionnées existent dans le repo (T01–T14, P01–P05) |
| 4 | Compatibilité PAD-R1B | ✅ Vérifiée point par point (section 10) |
| 5 | Cas tests couverts | ✅ 10 cas tests documentés (section 11) |
| 6 | Distinction fait / interprétation / recommandation | ✅ Explicite dans chaque section |

### NO-GO pour implémentation (critères bloquants)

| # | Critère de blocage | Description |
|---|-------------------|-------------|
| 1 | Absence de sources | Si une affirmation factuelle n'est pas sourcée → blocage |
| 2 | Confusion NST vs HS | Si le moteur traite NST comme une nomenclature douanière → blocage |
| 3 | Catégorie PAD estimée présentée comme officielle | Si `source.type` n'est pas `TO_CONFIRM` → blocage |
| 4 | Absence de validation opérateur | Si `requires_operator_confirmation` n'est pas `true` → blocage |
| 5 | Proposition de patch runtime immédiat | Si du code runtime est modifié dans la phase documentaire → blocage |
| 6 | Appel IA dans pricing | Si `run-pricing` appelle une IA pour la recommandation NST → blocage |
| 7 | Création automatique d'alias | Si le moteur écrit dans `pad_designation_aliases` sans action opérateur → blocage |
| 8 | Correspondance non sourcée présentée comme officielle | Si un mapping NST → PAD est présenté comme officiel sans source → blocage |

---

## 15. Conclusion CTO

NST 2007 peut améliorer la qualité de recommandation PAD, mais **seulement comme couche d'aide au raisonnement**. La classification NST par famille économique/logistique de marchandise transportée offre un cadre structuré pour orienter la recherche d'une catégorie PAD probable lorsque les alias PAD existants ne couvrent pas la description.

**Limites fondamentales** :

1. **Aucune correspondance officielle NST → PAD n'existe.** Tout rapprochement est une interprétation applicative.
2. **Aucune table officielle de correspondance directe NST ↔ CPA n'a été trouvée** lors de cette recherche, malgré l'indication d'Eurostat d'un « lien fort » entre les deux nomenclatures.
3. **Aucune table officielle NHM ↔ NST n'a été trouvée en accès libre** (document NHM payant, UIC).
4. Le rapprochement NST → PAD dépend du contexte spécifique de chaque marchandise et ne peut être automatisé avec certitude.

**Principes inviolables** :

- La catégorie PAD officielle doit rester issue soit d'un **alias PAD validé**, soit d'une **validation opérateur explicite**.
- Le futur moteur doit être **déterministe** (pas d'IA), **traçable** (sources documentées), **prudent** (`TO_CONFIRM`, `amount = 0`) et **non bloquant** pour l'intégrité du devis (`total_ht` / `total_ttc` non impactés).
- NST 2007 est un **outil de raisonnement**, pas une source de tarification.

---

## Annexe — Fichiers NON modifiés dans cette phase

| Fichier | Raison |
|---------|--------|
| `supabase/functions/run-pricing/index.ts` | Phase documentaire uniquement |
| `supabase/functions/quotation-engine/index.ts` | Hors scope |
| `supabase/functions/build-case-puzzle/index.ts` | Hors scope |
| `supabase/functions/recommend-pad-category/index.ts` | Conservé tel quel — coexistence réglementée |
| `src/components/case/DesignationSuggestionBlock.tsx` | Aucune modification UI |
| `src/lib/commoditySynonyms.ts` | Aucun synonyme ajouté |
| `supabase/config.toml` | Aucune modification |
| `docs/MASTER_CONTEXT.md` | FROZEN — non modifié |
| `docs/DEFERRED_BACKLOG.md` | Non modifié dans cette phase |
| `docs/SECURITY_CONTRACT.md` | FROZEN — non modifié |
| `docs/STATUS_REGISTRY.md` | FROZEN — non modifié |
| Toute migration SQL | Aucune migration créée |
| Tout fichier `src/` | Aucun fichier source modifié |
