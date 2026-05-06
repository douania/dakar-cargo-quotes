# Rapport PAD-NOM-0 : Extraction de la Nomenclature Officielle PAD 2006

**Date** : 6 Mai 2026
**Auteur** : Manus AI
**Source** : `REDEVANCES_PORTUAIRES_2006.pdf` (Sections 2.3.1, 2.3.2, 2.3.3)

## 1. Synthèse de l'extraction

L'extraction de la nomenclature officielle des marchandises du Port Autonome de Dakar (barème 2006) a été réalisée avec succès en mode lecture seule. **Aucune insertion en base de données n'a été effectuée**, conformément aux instructions.

| Métrique | Valeur |
|---|---|
| Entrées brutes extraites (toutes sections) | 787 |
| Entrées uniques après déduplication | **345** |
| Nouvelles désignations proposées (`new`) | 340 |
| Alias existants confirmés (`already_exists`) | 1 |
| Termes en conflit (`conflict`) | 4 (2 termes) |
| Lignes nécessitant revue manuelle (`needs_review`) | 0 |

Les fichiers de revue ont été générés dans `docs/tariff-collection/pad/` :
- `PAD_2006_NOMENCLATURE_EXTRACT_REVIEW.csv` (345 lignes)
- `PAD_2006_ALIAS_CONFLICTS.csv` (2 conflits)
- `PAD_2006_EXTRACT_STATS.json` (Statistiques détaillées)

## 2. Analyse des conflits et doublons

### 2.1 Conflits de catégories
Le script a détecté **2 termes normalisés** pointant vers plusieurs catégories PAD différentes selon la section du document source. Ces lignes ont été isolées dans le fichier des conflits et marquées comme `conflict` dans le fichier de revue.

1. **"alcool industriel"** :
   - Section 2.3.2 (Alphabétique) : T07
   - Section 2.3.3 (Par catégorie) : T12
2. **"sport"** :
   - Section 2.3.1 (NST) : T01
   - Section 2.3.2 (Alphabétique) : T02

*Recommandation* : Ces termes ne doivent pas être injectés automatiquement. Une décision métier est requise pour déterminer la catégorie prioritaire.

### 2.2 Doublons OCR et variantes orthographiques
L'analyse de distance de Levenshtein a révélé environ 50 paires de termes très similaires au sein d'une même catégorie, typiques de coquilles dans le document original ou d'erreurs d'OCR.

Exemples notables :
- `MATIERE PLASTIQUE BRUTE NDA` vs `MATIERES PLASTIQUES BRUTES NDA` (T03)
- `ARTICLES EN MATIERES PLASTIQUES NDA` vs `ARTICLES EN MATIERES PLASTIQUES NENDA` (T12)
- `CAOUTCHOUC PLAQUE OU ROULEAUX` vs `CAOUTCHOUC PLAQUES OU ROULEAUX` (T12)
- `SACS EN JUTE OU EN FIBRES VEGETALES` vs `SACS EN JUT OU EN FIBRES VEGETALES` (T12)

*Recommandation* : L'injection de ces variantes est bénéfique car elle augmente la surface de "catch" du moteur de matching exact sans créer de conflits de catégorie.

## 3. Couverture par catégorie tarifaire

L'extraction couvre 19 catégories tarifaires (T01-T14, P01-P05). Les catégories conteneurs (C01-C05) ont été intentionnellement filtrées car elles ne relèvent pas de la nomenclature des marchandises.

| Catégorie | Nombre d'entrées uniques |
|---|---|
| **T02** | 88 |
| **T12** | 84 |
| **T01** | 39 |
| **T07** | 29 |
| **T03** | 24 |
| **T04** | 21 |
| **T05** | 15 |
| **T11** | 12 |
| **T06** | 8 |
| **T08** | 7 |
| **T09** | 7 |
| **P03** | 3 |
| **T13** | 2 |
| **T10, T14, P01, P02, P04, P05** | 1 chacune |

## 4. Analyse du cas "Géomembranes"

Comme anticipé, **aucun alias exact "geomembrane" ou "geomembranes" n'a été trouvé** dans la nomenclature officielle de 2006.

Cependant, 11 candidats proches ont été identifiés, se répartissant entre les catégories T03 et T12 :
- **T03** : MATIERE(S) PLASTIQUE(S) BRUTE(S) NDA
- **T12** : ARTICLES EN MATIERES PLASTIQUES NDA, CAOUTCHOUC NATUREL, CAOUTCHOUC PLAQUE(S) OU ROULEAUX, RESINE SYNTHETIQUE, REVETEMENT DE SOL (CARRELAGE) NDA, TUBES/TUYAUX EN PVC, etc.

**Conclusion sur les géomembranes** :
L'injection de la nomenclature officielle ne résoudra pas automatiquement les BL contenant le terme "geomembranes" par match exact.
L'hypothèse conservatrice penche vers **T12** si le produit est considéré comme une membrane plastique finie (assimilable à "Articles en matières plastiques NDA" ou "Revêtement de sol"), ou **T03** s'il est considéré comme matière brute.
Cela confirme le besoin futur d'un moteur de recommandation (PAD-R1) pour les termes techniques modernes absents du barème de 2006.

## 5. Audit du schéma avant injection (PAD-NOM-1)

L'audit des migrations et du `MASTER_CONTEXT.md` révèle les points d'attention suivants avant de procéder à l'injection (Phase PAD-NOM-2) :

### 5.1 Structure de `pad_designation_aliases`
- La table requiert un `commodity_category_id` (NOT NULL) qui est une clé étrangère vers `commodity_categories`.
- La contrainte `source_type` n'accepte actuellement que `seed`, `operator_correction`, ou `ai_suggestion_validated`. La valeur `official_nomenclature` n'est pas autorisée par le CHECK actuel.
- Les colonnes `source_document` et `source_page` n'existent pas.

*Recommandation pour l'injection* : Utiliser `source_type = 'seed'` et concaténer les informations de source dans la colonne existante `source_reference` (ex: `REDEVANCES_PORTUAIRES_2006.pdf, Section 2.3.1, Page 13`).

### 5.2 État de `commodity_categories`
- Le `MASTER_CONTEXT.md` indique que les catégories **T06, T08, T10, T11** sont actuellement "absentes" du référentiel applicatif et "hors périmètre référentiel applicatif actuel".
- Pour injecter les alias de ces catégories, il faudra d'abord créer les lignes correspondantes dans `commodity_categories` pour obtenir des UUID valides.

*Recommandation pour l'injection* :
1. Ne pas créer aveuglément les 13 catégories.
2. Injecter uniquement les alias dont la catégorie PAD existe déjà dans `commodity_categories`.
3. Pour les catégories manquantes (T06, T08, T10, T11), différer leur création et l'injection de leurs alias jusqu'à ce qu'un besoin métier soit avéré, conformément à la politique de prudence documentée.

## 6. Prochaines étapes recommandées

1. **Revue humaine** : Validation du fichier `PAD_2006_NOMENCLATURE_EXTRACT_REVIEW.csv` par l'équipe métier.
2. **Décision sur les conflits** : Arbitrage sur les catégories pour "alcool industriel" et "sport".
3. **Script d'injection (PAD-NOM-2)** : Écriture d'un script d'injection idempotent qui :
   - Lit le CSV validé.
   - Fait un lookup du `commodity_category_id` via `pad_category`.
   - Ignore les lignes dont la catégorie n'existe pas encore en base.
   - Insère avec `source_type = 'seed'` et `source_reference` enrichie.
