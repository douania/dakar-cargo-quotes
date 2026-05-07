# PAD-NST-1C — Evidence Package : NST/R 1967 ↔ NST 2007

**Date** : 2026-05-07
**Statut** : EN ATTENTE DE VALIDATION CTO
**Auteur** : CTO / Lovable
**Phase** : PAD-NST-1C
**Prérequis** : PAD-NST-1B (✅ ACCEPTÉ)

---

## 1. Objectif

Documenter la table de correspondance officielle UNECE entre la classification NST/R 1967 (ancienne) et NST 2007 (moderne).

Cette table est **stratégiquement prioritaire** pour le projet car le barème PAD 2006 utilise explicitement une « Table des produits par catégorie NST (2 positions) », qui correspond à la structure de chapitres NST/R ancienne.

**⚠️ AVERTISSEMENT** : Ce document est strictement documentaire. Aucune ingestion en base, aucune migration, aucune modification de runtime n'est effectuée dans cette phase.

---

## 2. Provenance du fichier

| Champ | Valeur |
|-------|--------|
| **Fichier téléchargé** | `NST_2007_-_NST_R_1967_0.zip` |
| **Source UNECE** | Page [Classification NST 2007](https://unece.org/transport/statistics-transport/classification-nst-2007), section « Correspondence tables » |
| **Date de téléchargement** | 2026-05-07 |
| **Téléchargé par** | Opérateur (upload Lovable) |

---

## 3. Inventaire complet du ZIP

### 3.1 — Structure arborescente

```text
NST_2007_-_NST_R_1967_0.zip
├── NST_2007_concordances_based_on_NHM-2007_and_CN-2007.zip
│   ├── NHM 2007 - NST 2007.xls
│   ├── NHM 2007 - NST 2007.mdb
│   ├── NST2007 - NSTR - CN 2007 - CPA 2008.xls
│   ├── NST2007 - NSTR - CN 2007 - CPA 2008.pdf
│   └── NST_2007_concordances_based_on_NHM-2007_and_CN-2007.mdb
└── NST_2007_concordances_based_on_NHM-2008_and_CN-2008.zip
    ├── NSTR-NST2007.zip
    │   ├── NSTR-NST2007.xls          ← FICHIER CLÉ
    │   ├── NSTR-NST2007.pdf
    │   ├── Methodology_NSTR-NST2007.doc
    │   └── NSTR-NST2007.mdb
    └── NHM-NST2007.zip
```

### 3.2 — Sous-packages

Le ZIP principal contient deux variantes :

| Sous-package | Base CN | Base NHM | Contenu principal |
|-------------|---------|---------|-------------------|
| `..._NHM-2007_and_CN-2007.zip` | CN 2007 | NHM 2007 | Concordance NSTR/NST2007 via CN 2007 + NHM 2007 |
| `..._NHM-2008_and_CN-2008.zip` | CN 2008 | NHM 2008 | Concordance NSTR/NST2007 via CN 2008 ← **version retenue** |

La version basée sur CN 2008 / NHM 2008 est retenue comme plus récente.

---

## 4. Fichiers copiés dans le repo

| Fichier source | Destination repo | Taille | SHA256 |
|---------------|-----------------|--------|--------|
| `NSTR-NST2007.xls` | `docs/tariff-collection/pad/unece-sources/NSTR-NST2007.xls` | 2 884 096 octets | `d4c4d81b76e83dc7a3bac4b171168e44f6693618f7bfd7073198f2f7892d5478` |
| `NSTR-NST2007.pdf` | `docs/tariff-collection/pad/unece-sources/NSTR-NST2007.pdf` | 400 109 octets | `8c92be34ea244e4638a2daccf63c87986d577164fa756697968d162a51a3bea6` |
| `Methodology_NSTR-NST2007.doc` | `docs/tariff-collection/pad/unece-sources/Methodology_NSTR-NST2007.doc` | 498 688 octets | `f3ce3de098a44c725ff5a7b87b55e5e3b548aeac5e3dd2d4c49ab6f561049c37` |
| `NST2007 - NSTR - CN 2007 - CPA 2008.xls` | `docs/tariff-collection/pad/unece-sources/NST2007_NSTR_CN2007_CPA2008.xls` | 3 028 992 octets | `f779d4f6c39dfbbe33fe5fb93f4d6505dfb453d9b5c66d1877bb786619a32108` |

Fichiers **non copiés** (volumineux, format Access, non nécessaires à ce stade) :
- `NSTR-NST2007.mdb` (7 200 768 octets, SHA256 `69ed0716166cdaf57066ee2bde8792e85513f67e333808563a981c6faba59ed3`)
- `NHM-NST2007.zip` (3 412 379 octets)
- Fichiers MDB du package 2007

---

## 5. Analyse du fichier clé : NSTR-NST2007.xls

### 5.1 — Métadonnées

| Champ | Valeur |
|-------|--------|
| **Feuille** | `NSTR_NST2007_correspondence` |
| **Lignes de données** | 9 782 |
| **Colonnes** | 8 |
| **Doublons (lignes complètes)** | 0 |

### 5.2 — Colonnes

| # | En-tête | Type | Description |
|---|---------|------|-------------|
| 0 | `NSTR` | float (entier stocké) | Code NST/R 1967 à 3 positions (ex: 1.0 = groupe 001) |
| 1 | `NSTR Label` | text | Label anglais du groupe NST/R |
| 2 | `CN2008` | float (entier stocké) | Code CN 2008 à 8 chiffres |
| 3 | `CN2008 Label` | text | Label anglais CN 2008 |
| 4 | `CPA2008` | text | Code CPA 2008 |
| 5 | `CPA2008 Label` | text | Label anglais CPA 2008 |
| 6 | `NST2007` | text | Code NST 2007 (format `XX.X` ou `XX.A`) |
| 7 | `NST2007 Label` | text | Label anglais NST 2007 |

### 5.3 — Analyse des cellules vides

| Colonne | Nulls | % | Note |
|---------|-------|---|------|
| `NSTR` | 5 | 0,05% | 5 lignes CPA-only, mappées vers NST2007 `14.2` |
| `NSTR Label` | 5 | 0,05% | Mêmes 5 lignes |
| `CN2008` | 83 | 0,85% | Correspondances CPA-only (sans CN) |
| `CN2008 Label` | 83 | 0,85% | Idem |
| `CPA2008` | 26 | 0,27% | Correspondances CN-only (sans CPA) |
| `CPA2008 Label` | 26 | 0,27% | Idem |
| `NST2007` | 0 | 0,00% | Toujours renseigné |
| `NST2007 Label` | 1 | 0,01% | 1 ligne : NSTR 999 / NST2007 = `.` |

### 5.4 — Codes NST/R (NSTR)

Les codes NSTR sont stockés comme des float (ex: `1.0`, `11.0`, `999.0`).

Selon la nomenclature NST/R 1967, ce sont des codes à 3 positions (groupes) dont les 2 premières positions constituent le chapitre.

**Méthode de normalisation** : `int(float) → str.zfill(3)` → 2 premiers caractères = chapitre.

Exemples :
- `1.0` → `001` → chapitre `00`
- `11.0` → `011` → chapitre `01`
- `999.0` → `999` → chapitre `99`

| Métrique | Valeur | Méthode |
|----------|--------|---------|
| Codes NSTR 3 positions distincts | **173** | `int(NSTR).zfill(3)`, NSTR non null |
| Chapitres NSTR 2 positions — brut | **52** | `zfill(3)[:2]`, NSTR non null, toutes lignes |
| Chapitres NSTR 2 positions — après exclusion NSTR null | **52** | 5 lignes NSTR null exclues (pas d'impact) |
| Chapitres NSTR 2 positions — après exclusion NST2007 = `.` | **52** | 1 ligne NST2007=`.` exclue (NSTR 999, chapitre 99 — reste présent via NSTR 992 et 994) |
| **Nombre final retenu pour PAD-NST-2** | **52** | Méthode normalisée zfill(3) |

**Explication du précédent comptage « 55 »** : Le chiffre 55 résultait d'une méthode non normalisée (prise des 2 premiers caractères de `str(int(x))` sans zero-padding). Cela créait 3 faux préfixes d'un seul caractère (`"1"` au lieu de `"00"`) et dédoublait certains chapitres. La méthode correcte `zfill(3)[:2]` donne **52 chapitres**, confirmé par la variante 2007 qui utilise des codes texte et donne également 52 préfixes.

### 5.5 — Codes NST 2007

| Métrique | Valeur |
|----------|--------|
| Codes NST 2007 distincts (brut) | 70 |
| Codes NST 2007 valides (excluant `.`) | **69** |
| Couverture des 81 groupes NST 2007 | 69 / 81 (85,2%) |

Les 69 codes valides couvrent les divisions 01 à 14, 17 et 19. Absentes : 15 (courrier), 16 (conteneurs vides — sauf NHM), 18 (marchandises groupées — sauf NHM), 20 (non identifiées).

### 5.6 — Cardinalité chapitre NSTR → NST 2007

La relation chapitre NSTR (2 positions) → NST 2007 est **many-to-many**. Exemples :

| Chapitre NSTR | Nb groupes NST 2007 | Exemple |
|---------------|---------------------|---------|
| `97` | 25 | Articles manufacturés divers → 25 groupes NST 2007 |
| `93` | 17 | Machines, véhicules, etc. |
| `89` | 16 | Matières chimiques |
| `81` | 11 | Produits chimiques de base |
| `00` | 2 | Animaux vivants |
| `01` | 4 | Céréales |

**Conséquence** : Un chapitre NSTR 2 positions seul ne suffit PAS à déterminer un unique groupe NST 2007. La correspondance nécessite le code NSTR 3 positions et/ou les codes CN/CPA intermédiaires.

---

## 6. Données anomales

### 6.1 — NST2007 = `.`

| NSTR | NSTR Label | NST2007 | NST2007 Label |
|------|-----------|---------|---------------|
| 999 | OTHER MANUFACTURED GOODS NOT CLASSIFIED ACCORDING TO KIND | `.` | *(null)* |

**1 ligne** sur 9 782. Le code `.` n'est pas un code NST 2007 valide.

**Règle stricte** :
> Ne jamais importer `.` comme code NST2007 valide.
> La ligne NSTR 999 / NST2007 = `.` doit être **exclue du mapping actif** ou placée en quarantaine.
> Note : le chapitre 99 reste présent dans le mapping via NSTR 992 et 994 (qui mappent vers des NST2007 valides comme `10.2`, `10.5`, `12.2`, `13.2`, `14.2`, `17.5`).

### 6.2 — Lignes NSTR null

5 lignes ont NSTR null et NSTR Label null. Elles ont toutes :
- Un code CPA2008 renseigné
- NST2007 = `14.2` (Other waste and secondary raw materials)

**Règle** : Ces lignes sont des correspondances CPA-only. Elles seront importées dans la table de mapping avec NSTR null, mais ne participent pas au raisonnement PAD (qui requiert un code NSTR).

---

## 7. Variante 2007 : NST2007 - NSTR - CN 2007 - CPA 2008

Le package CN-2007 contient une variante plus ancienne :

| Champ | Valeur |
|-------|--------|
| **Fichier** | `NST2007_NSTR_CN2007_CPA2008.xls` |
| **SHA256** | `f779d4f6c39dfbbe33fe5fb93f4d6505dfb453d9b5c66d1877bb786619a32108` |
| **Feuille** | (première feuille) |
| **Lignes** | 9 720 |
| **Colonnes** | 9 : `NSTR 3 Digits`, `NSTR 3 Digits-Label`, `CN2007`, `CN2007-Label`, `CPA2008`, `CPA2008-Label`, `NST2007`, `NST2007-Label`, `Comments` |
| **NSTR distinct** | 168 (vs 173 dans la version CN-2008) |
| **NST2007 distinct** | 69 |
| **Chapitres NSTR 2 positions** | 52 (confirme le comptage) |
| **NSTR null** | 0 |
| **Doublons** | 0 |

**Note** : Les codes NSTR sont stockés en texte dans cette variante (pas en float), ce qui facilite la normalisation. Les 62 lignes de différence (9 782 - 9 720) proviennent probablement de l'ajout de nouvelles correspondances CN 2008 non couvertes par CN 2007.

---

## 8. Fichiers complémentaires

### 8.1 — Methodology_NSTR-NST2007.doc

Document Word décrivant la méthodologie de construction de la table de correspondance NST/R → NST 2007. À lire pour comprendre les choix de mapping dans les cas ambigus.

### 8.2 — NSTR-NST2007.pdf

Version PDF de la table de correspondance. Utile comme référence visuelle/imprimable.

### 8.3 — NSTR-NST2007.mdb

Base Access contenant les données brutes. Non copiée dans le repo (7,2 Mo). Disponible si nécessaire pour vérification croisée.

---

## 9. Règles de normalisation (pour PAD-NST-2)

Ces règles ne sont **pas implémentées** dans cette phase.

| Règle | Description |
|-------|-------------|
| **N1 — Codes NSTR** | Stocker comme text. Normaliser : `int(float).zfill(3)`. Ex: `1.0` → `"001"`, `999.0` → `"999"`. |
| **N2 — Chapitre NSTR** | Dériver : `nstr_code[:2]`. Ex: `"001"` → `"00"`, `"011"` → `"01"`, `"999"` → `"99"`. |
| **N3 — Codes CN2008** | Normaliser en 8 chiffres sans espaces. Dériver `hs6_prefix` = 6 premiers chiffres. |
| **N4 — Codes CPA2008** | Conserver le format original (format `XX.XX.XX`). |
| **N5 — NST2007 = `.`** | Ne jamais importer `.` comme code NST2007 valide. Exclure ou quarantaine. |
| **N6 — NSTR null** | 5 lignes CPA-only. Importer avec `nstr_code = NULL`, ne pas utiliser pour raisonnement PAD. |
| **N7 — Rapprochement PAD** | Les codes PAD 2006 à 2 positions doivent être rapprochés du chapitre NSTR (2 premiers caractères du code 3 positions normalisé), PAS d'un code brut non normalisé. |

---

## 10. Impact sur PAD-NST-2

### 10.1 — Nouvelle table requise

Le schéma PAD-NST-2 doit inclure une 7ème table : `nstr_nst2007_mappings`.

| Colonne probable | Type | Notes |
|-----------------|------|-------|
| `nstr_code` | text | Code 3 positions normalisé (`"001"`, `"011"`, etc.) |
| `nstr_chapter` | text | Chapitre 2 positions dérivé (`"00"`, `"01"`, etc.) |
| `nstr_label` | text | Label anglais |
| `cn2008_code` | text | Code CN 8 chiffres (nullable) |
| `cpa2008_code` | text | Code CPA 2008 (nullable) |
| `nst2007_code` | text | Code NST 2007 — FK vers `nst_groups.group_code` |
| `source_row_number` | integer | Ligne dans le XLSX |
| `source_id` | uuid | FK vers `nst_mapping_sources` |

Données attendues : ~9 781 lignes (9 782 - 1 ligne NST2007 `.` exclue).

### 10.2 — Nouvelle chaîne de raisonnement

Avant PAD-NST-1C :
```
Produit moderne → NST 2007 → aide à trouver PAD
```

Après PAD-NST-1C :
```
PAD 2006 / NST ancienne 2 positions
  → NST/R 1967 (chapitre = 2 premiers chiffres du code 3 positions)
  → NST 2007 (via table de correspondance officielle UNECE)
  → CPA / CN / NHM / HS (via tables PAD-NST-1B)
  → recommandation PAD moderne
```

Et dans l'autre sens :
```
Produit moderne → CN / CPA / NHM / HS
  → NST 2007 (via tables PAD-NST-1B)
  → NST/R 1967 (via table inverse)
  → chapitre NST/R 2 positions
  → rapprochement avec catégorie PAD 2006
```

### 10.3 — Avertissements

1. **NST/R → NST2007 ne donne PAS automatiquement la catégorie PAD finale.** Un chapitre NSTR mappe vers 2 à 25 groupes NST 2007 différents. La validation opérateur reste obligatoire.

2. **Le rapprochement PAD 2006 → NSTR n'est pas encore documenté.** Il faudra extraire la « Table des produits par catégorie NST (2 positions) » du PDF PAD 2006 pour établir la correspondance explicite `catégorie_PAD ↔ chapitre_NSTR`.

3. **CN 2008 vs CN 2024** : La table NSTR utilise CN 2008. Les tables PAD-NST-1B utilisent CN 2024. Les codes CN évoluent entre versions. Le chaînage NSTR→CN2008→CN2024 nécessitera une table de correspondance CN interversions ou un passage par HS6 (plus stable).

---

## 11. Tableau récapitulatif des fichiers du repo (PAD-NST-1A à 1C)

| Phase | Fichier | Lignes | Source | SHA256 (début) |
|-------|---------|--------|--------|----------------|
| 1B | `NST2007_CPA21_Table.xlsx` | 1 759 | UNECE | `e23e2a7f...` |
| 1B | `NST2007_CN2024_Table.xlsx` | 9 762 | UNECE | `39689011...` |
| 1B | `NST_2007_-_NHM_2025.xlsx` | 15 079 | UNECE | `c63bddc5...` |
| 1C | `NSTR-NST2007.xls` | 9 782 | UNECE | `d4c4d81b...` |
| 1C | `NST2007_NSTR_CN2007_CPA2008.xls` | 9 720 | UNECE | `f779d4f6...` |
| 1C | `NSTR-NST2007.pdf` | — | UNECE | `8c92be34...` |
| 1C | `Methodology_NSTR-NST2007.doc` | — | UNECE | `f3ce3de0...` |

---

## 12. Ce qui n'est PAS dans PAD-NST-1C

- Aucune migration SQL
- Aucune Edge Function
- Aucun fichier `src/`
- Aucune modification `config.toml`
- Aucune ingestion de données en base
- Aucun branchement runtime
- Aucun run-pricing

---

## 13. Statut des phases

| Phase | Statut |
|-------|--------|
| PAD-NST-1 | ✅ ACCEPTÉ |
| PAD-NST-1A | ✅ ACCEPTÉ |
| PAD-NST-1B | ✅ ACCEPTÉ |
| **PAD-NST-1C** | **EN ATTENTE DE VALIDATION CTO** |
| PAD-NST-2A-R1 | EN ATTENTE (nécessite révision pour table NSTR) |
| PAD-NST-2B | BLOQUÉ (en attente 2A-R1 + 1C) |

---

*Fin du document PAD-NST-1C Evidence Package.*
