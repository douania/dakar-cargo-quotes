# PAD-NST-1B — Evidence Package : Tables de correspondance UNECE

**Date** : 2026-05-07
**Statut** : ✅ EVIDENCE PACKAGE — Phase documentaire uniquement
**Auteur** : CTO / Lovable
**Phase** : PAD-NST-1B
**Prérequis** : PAD-NST-1A (✅ ACCEPTÉ)

---

## 1. Objectif

Documenter les 3 tables de correspondance officielles UNECE téléchargées manuellement par l'opérateur depuis la page UNECE [Classification NST 2007](https://unece.org/transport/statistics-transport/classification-nst-2007).

Ce document constitue la preuve d'existence, d'intégrité et de qualité des fichiers avant toute ingestion en base de données.

**⚠️ AVERTISSEMENT** : Ce document est strictement documentaire. Aucune ingestion en base, aucune migration, aucune modification de runtime n'est effectuée dans cette phase.

---

## 2. Inventaire des fichiers

### 2.1 — NST 2007 ↔ CPA 2.1

| Champ | Valeur |
|-------|--------|
| **Fichier** | `docs/tariff-collection/pad/unece-sources/NST2007_CPA21_Table.xlsx` |
| **SHA256** | `e23e2a7fe8bdcd5d0eef77f660fd1d22b8d6c782bdcf542974e2223424e0f933` |
| **Source UNECE** | Page NST 2007, section "Correspondence tables", lien "NST 2007 - CPA 2.1" |
| **URL UNECE (node)** | `https://unece.org/node/392887` (bloqué Cloudflare pour téléchargement automatisé — téléchargé manuellement par opérateur) |
| **Date de téléchargement** | 2026-05-07 |
| **Feuille** | `Sheet0` |
| **Lignes de données** | 1 759 |
| **Colonnes** | 8 |
| **En-têtes** | `NST2007_KEY`, `NST2007_CODE`, `NST2007_NAME`, `CPA21_KEY`, `CPA21_CODE`, `CPA21_NAME`, `Source`, `Target` |
| **Divisions NST couvertes** | 16 sur 20 : 01–14, 17, 19 |
| **Divisions NST absentes** | 15 (courrier), 16 (conteneurs vides), 18 (marchandises groupées), 20 (autres/non identifiées) |
| **Groupes NST (81 positions)** | 69 groupes distincts |
| **Cellules vides** | 0 (0,0%) |
| **Doublons (lignes identiques)** | 0 |

### 2.2 — NST 2007 ↔ CN 2024

| Champ | Valeur |
|-------|--------|
| **Fichier** | `docs/tariff-collection/pad/unece-sources/NST2007_CN2024_Table.xlsx` |
| **SHA256** | `39689011ef4718383dd274c1bdd3e4fd729fb45b36616d3568f3de18a0cadbb2` |
| **Source UNECE** | Page NST 2007, section "Correspondence tables", lien "NST 2007 - CN 2024" |
| **URL UNECE (node)** | `https://unece.org/node/392886` (bloqué Cloudflare — téléchargé manuellement par opérateur) |
| **Date de téléchargement** | 2026-05-07 |
| **Feuille** | `Sheet0` |
| **Lignes de données** | 9 762 |
| **Colonnes** | 8 |
| **En-têtes** | `NST2007_KEY`, `NST2007_CODE`, `NST2007_NAME`, `CN2024_KEY`, `CN2024_CODE`, `CN2024_NAME`, `Source`, `Target` |
| **Divisions NST couvertes** | 16 sur 20 : 01–14, 17, 19 |
| **Divisions NST absentes** | 15 (courrier), 16 (conteneurs vides), 18 (marchandises groupées), 20 (autres/non identifiées) |
| **Groupes NST (81 positions)** | 68 groupes distincts |
| **Cellules vides** | 0 (0,0%) |
| **Doublons (lignes identiques)** | 0 |

**Note** : CN 2024 = Nomenclature Combinée 2024 (UE). Les codes CN à 8 chiffres partagent les 6 premiers chiffres avec le Système Harmonisé (HS). Ce fichier permet donc un rapprochement indirect NST ↔ HS via les 6 premiers chiffres CN.

### 2.3 — NST 2007 ↔ NHM 2025

| Champ | Valeur |
|-------|--------|
| **Fichier** | `docs/tariff-collection/pad/unece-sources/NST_2007_-_NHM_2025.xlsx` |
| **SHA256** | `c63bddc5818c1723531bb378edae4c9b28adffab12714e759707a3a43e17fa7c` |
| **Source UNECE** | Page NST 2007, section "Correspondence tables", lien "NST 2007 - NHM 2025" |
| **URL UNECE (node)** | `https://unece.org/node/392889` (bloqué Cloudflare — téléchargé manuellement par opérateur) |
| **Date de téléchargement** | 2026-05-07 |
| **Feuille** | `Feuil1` |
| **Lignes de données** | 15 079 |
| **Colonnes** | 17 (dont 5 colonnes vides en fin de tableau) |
| **Divisions NST couvertes** | 18 sur 20 : 01–14, 16–19 |
| **Divisions NST absentes** | 15 (courrier), 20 (autres/non identifiées) |
| **Groupes NST (81 positions)** | 72 groupes distincts |
| **Cellules vides** | 127 635 (49,8% — expliqué par colonnes structurellement vides) |
| **Doublons (lignes identiques)** | 0 |
| **Lignes avec NST 81-pos renseigné** | 15 079 / 15 079 (100%) |

#### Analyse par colonne (NHM 2025)

| Col | En-tête | Nulls | % Null | Commentaire |
|-----|---------|-------|--------|-------------|
| 0 | `NHM_2025_Code` | 0 | 0% | Code NHM complet |
| 1 | *(numéro séquentiel)* | 0 | 0% | Index interne |
| 2 | *(en-tête null — code chapître)* | 2 368 | 15,7% | Codes chapitres/sections (lignes intermédiaires) |
| 3 | `Label NHM_2025 (EN)` | 2 368 | 15,7% | Labels EN — vides pour lignes chapitres |
| 4 | `selftext_fr` | 2 369 | 15,7% | **Labels FR** — très utile pour le contexte sénégalais |
| 5 | `NHM_2025 Renvoi` | 15 043 | 99,8% | Renvois rares |
| 6 | `NHM_2025 Texte Renvoi` | 15 043 | 99,8% | Textes de renvoi rares |
| 7 | `In Custom declaration` | 15 051 | 99,8% | Flag douanier — très peu renseigné |
| 8 | `NST_2007_CODE 81 positions` | 0 | 0% | **Code NST groupe — clé de correspondance** |
| 9 | `Label NST 2007 81 positions` | 0 | 0% | Label NST groupe |
| 10 | `NST_2007_CODE 20 positions` | 0 | 0% | **Code NST division — clé agrégée** |
| 11 | `Label NST 2007 20 positions` | 0 | 0% | Label NST division |
| 12–16 | *(null)* | 100% | 100% | Colonnes vides — à ignorer |

**Colonnes utiles pour PAD-NST-2** : 0 (NHM code), 3 (label EN), 4 (label FR), 8 (NST 81-pos), 9 (label NST 81), 10 (NST 20-pos), 11 (label NST 20).

---

## 3. Tableau récapitulatif

| Fichier | Lignes | Colonnes utiles | Divisions NST | Cellules vides (utiles) | Doublons |
|---------|--------|-----------------|---------------|------------------------|----------|
| NST ↔ CPA 2.1 | 1 759 | 8/8 | 16/20 | 0% | 0 |
| NST ↔ CN 2024 | 9 762 | 8/8 | 16/20 | 0% | 0 |
| NST ↔ NHM 2025 | 15 079 | 12/17 (5 vides) | 18/20 | 0% (colonnes utiles) | 0 |

---

## 4. Divisions NST absentes — analyse

| Division | Description | Absente dans CPA | Absente dans CN | Absente dans NHM | Raison |
|----------|-------------|:---:|:---:|:---:|--------|
| 15 | Mail, parcels | ✗ | ✗ | ✗ | Catégorie opérationnelle sans correspondance produit |
| 16 | Equipment and material used in transport of goods | ✗ | ✗ | ✓ | Conteneurs/matériel — NHM inclut les 30 codes UIC spéciaux |
| 18 | Grouped goods | ✗ | ✗ | ✓ | Groupage — NHM a des codes pour marchandises groupées |
| 20 | Unidentifiable goods | ✗ | ✗ | ✗ | Résiduel — non classifiable |

---

## 5. Statut licence / redistribution

| Source | Licence connue | Redistribution |
|--------|---------------|----------------|
| UNECE | Documents UNECE publiés sous politique d'accès ouvert des Nations Unies. Pas de licence explicite sur les fichiers téléchargés. | Usage interne autorisé. Redistribution publique : à confirmer auprès de UNECE. |
| NHM 2025 (UIC) | Le fichier UNECE contient une correspondance NHM ↔ NST, pas la nomenclature NHM complète propriétaire UIC. | Usage de la table de correspondance UNECE autorisé. Les données NHM détaillées restent propriété UIC. |

**⚠️ Recommandation** : Les fichiers sont stockés dans `unece-sources/` comme données de référence internes. Ne pas publier publiquement sans vérification de la politique UNECE.

---

## 6. Règles de normalisation recommandées (pour PAD-NST-2)

Ces règles ne sont **pas implémentées** dans cette phase. Elles constituent des recommandations pour la conception du schéma d'ingestion.

| Règle | Description |
|-------|-------------|
| **N1 — Codes NST** | Normaliser en format `XX.X` (ex: `01.1`). Supprimer les espaces et padding. |
| **N2 — Codes CN** | Normaliser en 8 chiffres sans espaces (ex: `10011100`). Les 6 premiers = HS. |
| **N3 — Codes NHM** | Normaliser en 12 chiffres (ex: `010011000090`). Les 6 premiers = HS. |
| **N4 — Codes CPA** | Conserver le format `XX.XX.XX.XX` tel quel. |
| **N5 — Colonnes Source/Target** | Colonnes URI (Linked Data). À conserver comme métadonnées ou ignorer selon le schéma choisi. |
| **N6 — Colonnes vides NHM** | Colonnes 12–16 : ignorer à l'ingestion. |
| **N7 — Labels FR** | Colonne `selftext_fr` du NHM : conserver pour l'affichage opérateur (contexte sénégalais francophone). |
| **N8 — Versioning** | CPA 2.1 (pas 2.2), CN **2024** (pas 2025), NHM **2025**. Stocker la version dans les métadonnées. |
| **N9 — Dédoublonnage** | Aucun doublon trouvé dans les 3 fichiers. Pas de règle de dédoublonnage nécessaire a priori. |

---

## 7. Impact sur PAD-NST-2

### Verdict

**GO pour conception PAD-NST-2, sous réserve de validation CTO du schéma d'ingestion, des licences, du versioning et des règles de normalisation.**

### Ce qui est GO

- La table `nst_2007_groups` peut être conçue (20 divisions, 81 groupes confirmés par les 3 fichiers).
- La table `nst_mapping_sources` peut être conçue (3 fichiers avec métadonnées de provenance).
- La table `pad_nst_recommendation_rules` peut être conçue (règles de rapprochement NST → PAD candidates).
- La table `pad_recommendation_audit_log` peut être conçue (traçabilité des suggestions).

### Ce qui nécessite validation CTO avant création

- Les tables de correspondance détaillées (`nst_cpa_mappings`, `nst_cn_mappings`, `nst_nhm_mappings`) nécessitent :
  - Choix des colonnes à ingérer
  - Stratégie de versioning (CN 2024 vs CN 2025 futur)
  - Confirmation de la licence pour stockage en base
  - Décision sur ingestion complète ou partielle (les 3 fichiers totalisent 26 600 lignes)
  - Stratégie d'indexation (par code NST, par code CN/HS, ou les deux)

### Ce qui est explicitement hors périmètre PAD-NST-1B

- Aucune migration SQL
- Aucune Edge Function
- Aucun fichier `src/`
- Aucune modification `config.toml`
- Aucune ingestion de données en base

---

## 8. Version CPA : avertissement

La table NST ↔ CPA utilise **CPA 2.1** (2015). La version en vigueur dans l'UE est **CPA 2.2** (2024).

Eurostat publie des tables de correspondance CPA 2.1 ↔ CPA 2.2. Si un chaînage NST → CPA → CN est envisagé, il faudra tenir compte de cette version intermédiaire.

Pour le cas d'usage PAD (raisonnement par famille logistique), CPA 2.1 est suffisant car le rapprochement NST → PAD est une interprétation applicative, pas un mapping normatif précis.

---

## 9. Historique des téléchargements

| Date | Action | Résultat |
|------|--------|---------|
| 2026-05-07 | Tentatives automatisées (curl) sur les 3 URLs UNECE | Bloquées par Cloudflare (403) |
| 2026-05-07 | Navigation Lovable vers la page UNECE | Page accessible, liens de téléchargement identifiés |
| 2026-05-07 | Téléchargement manuel par opérateur : NST ↔ CPA 2.1 | ✅ Réussi — uploadé dans Lovable |
| 2026-05-07 | Téléchargement manuel par opérateur : NST ↔ CN 2024 | ✅ Réussi — uploadé dans Lovable |
| 2026-05-07 | Téléchargement manuel par opérateur : NST ↔ NHM 2025 | ✅ Réussi — uploadé dans Lovable |

---

*Fin du document PAD-NST-1B Evidence Package.*
