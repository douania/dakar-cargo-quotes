# SESSION PAD — Synthèse (2026-04-02)

## Objet

Cette note synthétise les travaux réalisés autour du référentiel marchandises, du matching désignation → catégorie PAD, de la visibilité des références PAD dans l'UI, et de l'intégration PAD fact-based dans le pricing.

Elle complète :
- `docs/MASTER_CONTEXT.md` pour l'état canonique livré
- `docs/DEFERRED_BACKLOG.md` pour les sujets différés

## Livré dans cette session

### 1. Référentiel marchandises

Le référentiel marchandises est désormais opérationnel via :
- `commodity_categories`
- `commodity_designation_matches`

Le système couvre les catégories PAD actuellement introduites en base :
T01, T02, T03, T04, T05, T07, T09, T12, T13, T14

### 2. Matching désignation → catégorie PAD

Le matching lexical a été enrichi avec :
- normalisation des désignations
- dictionnaire de correspondances observées
- héritage de `pad_category` via la catégorie parente
- séparation stricte entre :
  - validation du dictionnaire (`Confirmer`)
  - application au dossier (`Appliquer au dossier`)

### 3. Barèmes PAD officiels

Les tarifs PAD officiels de droit de passage ont été injectés dans `port_tariffs` avec :
- `provider = PAD`
- `category = DROIT_PASSAGE`

Ces lignes servent de base officielle de référence pour le pont UI et les facts PAD dossier.

### 4. Facts dossier PAD

Deux facts dossier ont été introduits dans le flux opérateur :
- `cargo.pad_category`
- `cargo.pad_rate_fcfa_per_ton`

Ils sont appliqués explicitement au dossier via l'UI, puis visibles dans le cockpit.

### 5. Visibilité PAD dans l'interface

Les références PAD sont maintenant visibles à deux niveaux :
- **CaseView** : carte informative dossier
- **PricingResultPanel** : note contextuelle basée sur le snapshot du pricing

La distinction entre facts courants du dossier et snapshot pricing a été explicitement conservée.

### 6. Phase 3 PAD — enrichissement moteur

Le pricing prend désormais en charge une ligne enrichie :
- `PAD_DROIT_PASSAGE`

Caractéristiques :
- enrichissement **post-moteur**
- `origin_layer = enrichment_pad`
- `pricing_method = fact_based`
- source fondée sur le **fact dossier PAD** (barème Redevances Portuaires 2006)
- périmètre actuel limité au **mono-lot**

### 7. Ajustements UI complémentaires

Deux améliorations UI ont aussi été livrées dans cette session :
- lignes tarifaires extensibles dans `PricingResultPanel`
- affichage de l'ID court sur les cartes dashboard (`CaseCard`)

## Validé par smoke tests

### Chemin positif

- **T01** — `ab959454` — `SEA_FCL_IMPORT`
  PASS — ligne PAD correcte : **59 372 FCFA**

- **T12** — `29b96eec` — `SEA_FCL_IMPORT`
  PASS — ligne PAD correcte : **4 015 200 FCFA**

### Régression

- **AIR_IMPORT** — `2fa7861d`
  PASS — **0 ligne PAD**, comportement correct hors maritime conteneurisé

### Cas non validé dans cette session

- **T07** — `6d4d996f` — `SEA_FCL_IMPORT`
  BLOQUÉ — ambiguïté FCL/LCL (`FCL-OVR`), hors scope PAD

## Diagnostiqué et différé

### FCL-OVR

Le blocage `AMBIGUOUS_LCL_FCL` a été diagnostiqué.
Cause racine confirmée :
- `build-case-puzzle` redétecte l'ambiguïté depuis le texte des emails
- les facts manuels DB conteneur ne sont pas relus pour lever cette ambiguïté

Ce sujet est documenté dans :
- `docs/DEFERRED_BACKLOG.md` (`FCL-OVR`)

### Formulaire générique "Ajouter un fact"

Le besoin a été identifié, mais il ne résout pas à lui seul le blocage FCL/LCL sans le patch `FCL-OVR`.
Sujet conservé comme amélioration ergonomique distincte.

## Limites connues

- périmètre PAD actuel borné au **mono-lot**
- usage de **facts dossier globaux**
- distinction à conserver entre :
  - facts courants du dossier
  - facts capturés dans le snapshot pricing
  - ligne moteur enrichie `PAD_DROIT_PASSAGE`

## Conclusion

La session a permis de passer d'un système de matching lexical à un flux opérationnel plus complet :
- catégorisation PAD
- barème PAD visible
- application explicite au dossier
- visibilité dans le cockpit
- enrichissement moteur fact-based dans le pricing

La phase 3 PAD est validée.
Le sujet `FCL-OVR` reste séparé et documenté comme dette différée.

---

## Correction data-only `demurrage_rates` (2026-04-02)

### Franchises import corrigées

- **CMA CGM, Maersk, Hapag-Lloyd, MSC** :
  - Dry (20DV, 40DV, 40HC) : `free_days_import` 7j → **10j**
  - Reefer (20RF, 40RF) : `free_days_import` 5j → **3j**
- Sources : barèmes officiels Sénégal/Dakar par compagnie

### Devises et montants

- **Inchangés volontairement**
- Pas de conversion USD → XOF/EUR sans montants exacts prouvés
- `currency` reste USD pour toutes les lignes

### Requalification prudente

- **COSCO / EVERGREEN / ONE** : `notes` marquées `TO_CONFIRM`, `source_document` marqué non vérifié Sénégal

### Verdict

- Données plus honnêtes
- Gap résiduel = montants journaliers exacts et devises de publication officielle par compagnie

---

## Taux de surestaries prouvés par facture (2026-04-02)

### MSC — 20DV (EUR)
- Franchise : 10j (standard Dakar) — mention "17 FD" sur facture, interprétation non confirmée
- Palier 1 (J11–J20) : **27.00 EUR/jour**
- Palier 2 (J21+) : **37.00 EUR/jour**
- Source : Facture MSC BL MEDUF8860316 + BL MEDUAK978032
- Verdict : **preuve forte**

### CMA CGM — 40HC (XOF)
- Franchise : **10 jours** (explicite "10 Free Calendar Days")
- Palier 1 (J11–J20) : **38 050 XOF/jour**
- Palier 2 (J21+) : **45 920 XOF/jour**
- Source : Facture CMA CGM BL SNIM0709935 + cohérence barème officiel Sénégal
- Verdict : **preuve forte**

### Séparation stricte maintenue
- Demurrage brut compagnie ≠ commission Sodatra ≠ caution transit
- Commissions Sodatra observées : 66 744 XOF et 320 334 XOF (séparées)

### Nouveau modèle `demurrage_tiers`
- Table enfant de `demurrage_rates`, non destructive
- 4 tiers prouvés injectés (MSC 20DV `observed`, CMA CGM 40HC `official`)
- Colonnes legacy `day_1_7/8_14/15_plus` conservées comme fallback
- Moteur (`quotation-engine`, `analyze-risks`) et UI non modifiés dans cette vague

---

## Enrichissement officiel `demurrage_tiers` — Vague 3 (2026-04-02)

### Sources utilisées

| Compagnie | Source | Date effet | Devise |
|-----------|--------|------------|--------|
| CMA CGM | PDF officiel CMA CGM Sénégal | 01-Jan-2025 | XOF |
| MAERSK | Page officielle Maersk Sénégal import | 25-Jan-2024 | XOF |
| HAPAG-LLOYD | PDF officiel Hapag-Lloyd Sénégal | 01-May-2024 | EUR |

### Parents special equipment créés

6 nouveaux parents dans `demurrage_rates` :
- CMA CGM : 20OT, 40OT (couvrent aussi FR/Tank au même tarif)
- MAERSK : 20OT, 40OT (couvrent aussi FR au même tarif)
- HAPAG-LLOYD : 20OT, 40OT (couvrent aussi FR au même tarif)
- Montants legacy parent laissés volontairement à 0 (non utilisés)

### Tiers injectés — Bilan

| Compagnie | Tiers ajoutés | Types couverts |
|-----------|--------------|----------------|
| CMA CGM | 10 | 20DV, 40DV, 20RF, 40RF, 20OT, 40OT |
| MAERSK | 7 | 20DV, 40DV, 40HC, 20RF, 40RF, 20OT, 40OT |
| HAPAG-LLOYD | 14 | 20DV, 40DV, 40HC, 20RF, 40RF, 20OT, 40OT |
| **Total nouveaux** | **31** | |

### Tiers existants conservés

- CMA CGM 40HC : 2 tiers `official` (inchangés, déjà corrects)
- MSC 20DV : 2 tiers `observed` (inchangés)

### Total `demurrage_tiers` : **35 lignes**

### Ce qui n'a PAS changé

- Moteur (`quotation-engine`, `analyze-risks`) : non touché
- UI : non touchée (les tiers apparaissent automatiquement via TariffOverview vague 2)
- MSC : tiers `observed` conservés, pas de tiers `official` ajoutés (source insuffisante)
- COSCO / EVERGREEN / ONE : non touchés, restent `TO_CONFIRM`
- Colonnes legacy `demurrage_rates` : inchangées
- Moteur (`quotation-engine`, `analyze-risks`) et UI non modifiés dans cette vague

### Vague 4 — Lecture `demurrage_tiers` dans `analyze-risks` (2026-04-02)

`analyze-risks` lit désormais `demurrage_tiers` en priorité :
- Tiers réels d'abord (triés par `tier_order`)
- Fallback legacy (`day_1_7_rate`, etc.) si aucun tier
- Devise réelle transportée (`rate_currency`), sans conversion implicite
- `total_provisions_fcfa` n'intègre la surestarie que si devise = XOF/FCFA
- Bugfix `normalizeContainerType` : 20DV mappé correctement

### Vague 5 — Lecture `demurrage_tiers` dans `quotation-engine` (2026-04-02)

`quotation-engine` section 8c lit désormais `demurrage_tiers` en priorité :
- Même stratégie tiers-first que `analyze-risks`
- Description dynamique : `Franchise 10j, puis J11-20: 17 715 XOF/j | J21+: 22 960 XOF/j`
- Source documentaire : priorité `tier.source_document` > `parent.source_document` > fallback texte
- Types source compatibles existant : `OFFICIAL`, `OBSERVED`, `TO_CONFIRM`
- Devise réelle dans la ligne (XOF, EUR), sans conversion
- Fallback legacy inchangé pour compagnies sans tiers (COSCO, EVERGREEN, ONE)
- Ligne générique "contacter armateur" inchangée si aucun parent trouvé

---

## Grille tarifaire Dakar Terminal (Bolloré) — Analyse documentaire (2026-04-02)

### Source

- **Document** : Grille Tarifaire Officielle, Dakar Terminal (Bolloré Africa Logistics)
- **Date** : 09/12/2014
- **Statut** : référence de structure / nomenclature — pas encore référence pleinement validée de tous les montants actuels

### Périmètre d'exploitation

**Distinction obligatoire** :

- **Magasinage** : la grille Dakar Terminal est retenue comme référence de structure / codification
  (désignations, codes magasinage P1/P2/P3, périodes, franchise, logique poids × jours × taux).
  Les factures TOM/TCD confirment que ces codes sont réutilisés en pratique.

- **Manutention** : la grille Dakar Terminal ne doit PAS être utilisée pour la manutention.
  DPW a son propre référentiel tarifaire, déjà paramétré dans `port_tariffs`.
  Aucune fusion entre les deux sujets.

### Structure du barème

- ~500 désignations de marchandises
- Chaque désignation → 1 code manutention (101–149) + 3 codes magasinage (4xx/5xx/6xx)
- Franchise : 5 jours (10 jours transit Mali)
- 3 périodes progressives :
  - **P1** : J1–15 après franchise (codes 4xx)
  - **P2** : J16–30 après franchise (codes 5xx)
  - **P3** : J31+ après franchise (codes 6xx)
- Unité de calcul : **Tonne × Jours × Taux** (sauf exceptions nommées : unité, M3, panier)
- Incompatible avec le modèle `warehouse_franchise` actuel (basé conteneur/EVP)

### Liaison prouvée avec factures TOM

La facture TOM analysée portait la désignation "MARCHANDISES NON REPRISES AILLEURS", position tarifaire **138**, codes magasinage **419/519/619**.

| Code | Grille 2014 (FCFA/T/j) | Facture TOM (FCFA/T/j) | Verdict |
|------|------------------------|------------------------|---------|
| 419 (P1) | 1 768 | 1 964 | **Écart observé à investiguer** (+11%) |
| 519 (P2) | 2 873 | 2 873 | **Exact** |
| 619 (P3) | 3 708 | 3 708 | **Exact** |

### Conclusion documentaire

- Les **codes** sont bien réutilisés dans les factures observées
- Les **taux** sont souvent alignés entre la grille 2014 et les factures récentes
- Au moins un **écart existe sur P1** (419 : 1 768 vs 1 964) — cause non prouvée (révision, contexte TOM/TCD, arrondi)
- Donc : **structure validée**, mais **montants actuels restent à consolider** avant toute injection

### Familles de codes magasinage identifiées

| Codes P1/P2/P3 | Taux P1 (FCFA) | Taux P2 (FCFA) | Taux P3 (FCFA) | Exemples typiques |
|----------------|----------------|----------------|----------------|-------------------|
| 410/510/610 | 140 | 238 | 305 | Ciment, riz, céréales en sacs |
| 412/512/612 | 177 | 294 | 394 | Tôles, bois, métaux <1T |
| 413/513/613 | 215 | 354 | 461 | Huiles, bitume, vracs en sacs |
| 414/514/614 | 355 | 599 | 775 | Colis lourds, véhicules >3T |
| 416/516/616 | 571 | 954 | 1 229 | Produits frigo, dangereux |
| 417/517/617 | 884 | 1 476 | 1 909 | Quincaillerie, lait, verre |
| 418/518/618 | 1 396 | 2 325 | 3 073 | Boissons, conserves, papier |
| 419/519/619 | 1 768 | 2 873 | 3 708 | Marchandises générales (138) |
| 420/520/620 | 1 974 | — | — | Véhicules automobiles |
| 421/521/621 | 3 558 | 5 921 | 7 654 | Électronique, textiles, luxe |

### Table `terminal_tariff_codes` — structure créée (2026-04-02)

Table de résolution **code → montant FCFA** créée par migration. Chaînon manquant entre les codes stockés dans `commodity_categories` et les montants du barème terminal.

Colonnes : `code`, `tariff_type` (storage/handling), `period` (P1/P2/P3), `amount_per_unit`, `currency`, `unit_basis`, `terminal_provider` (dakar_terminal/dpw), `source_document`, `evidence_level`, `effective_date`.

Contraintes :
- `tariff_type` IN ('storage', 'handling')
- `terminal_provider` IN ('dakar_terminal', 'dpw')
- Cohérence métier : storage → period obligatoire, handling → period interdit
- `amount_per_unit >= 0`
- `UNIQUE(code, terminal_provider, period)`
- Index lookup : `(terminal_provider, tariff_type, code)`
- RLS : shared workspace authenticated CRUD

### Peuplement initial storage (2026-04-02)

**28 lignes** injectées dans `terminal_tariff_codes` — magasinage Dakar Terminal uniquement.

| Familles | Lignes | Evidence |
|----------|--------|----------|
| 410, 412, 413, 414, 416, 417, 418, 421 (× P1/P2/P3) | 24 | `official` |
| 420 (P1 seul, P2/P3 non documentés) | 1 | `official` |
| 519, 619 (corroborés par facture TOM) | 2 | `official` |
| **419 (P1)** — écart +11% vs facture TOM | 1 | **`to_confirm`** |
| **Total initial** | **28** | 27 `official`, 1 `to_confirm` |

- `source_document` = `Grille Tarifaire Officielle Dakar Terminal 2014 p.34`
- `effective_date` = `2014-12-09`
- Notes corroboration sur 519/619 : "Montant grille 2014 corroboré par facture TOM"
- Note 419 : "Ecart observé +11% vs facture TOM (1 964 FCFA/T/j)"

### Peuplement complémentaire — Vague 2 (2026-04-03)

**6 lignes** ajoutées dans `terminal_tariff_codes` — codes manquants identifiés par audit couverture.

| Code | Période | Montant (FCFA) | unit_basis | Famille | Evidence |
|------|---------|---------------|------------|---------|----------|
| 411 | P1 | 158 | tonne_per_day | RIZ en sacs | `official` |
| 511 | P2 | 318 | tonne_per_day | RIZ en sacs | `official` |
| 611 | P3 | 410 | tonne_per_day | RIZ en sacs | `official` |
| 415 | P1 | 466 | unit | Animaux vivants | `official` |
| 515 | P2 | 750 | unit | Animaux vivants | `official` |
| 615 | P3 | 969 | unit | Animaux vivants | `official` |

- Source : Grille Tarifaire Officielle Dakar Terminal 2014, page 34
- Double-check : CSV `tariff_final_consolidated` ↔ PDF confirmé (unit_basis cohérent)
- **Total `terminal_tariff_codes`** : **34 lignes** (33 `official`, 1 `to_confirm`)

### Couverture après vague 2

| Période | Couverts | Total non-vrac | Couverture |
|---------|----------|----------------|------------|
| P1 | 929 | 929 | **100%** |
| P2 | 915 | 929 | **98.5%** |
| P3 | 915 | 929 | **98.5%** |

**Gap résiduel** : codes **520/620** (véhicules P2/P3) — absents de la grille PDF 2014, non inventés, documentés comme gap.

### Ce qui n'a PAS été fait

- 0 moteur
- 0 UI
- 0 contamination du référentiel manutention DPW (`port_tariffs`)
- 0 handling injecté
- 0 dpw injecté
- 0 codes 520/620 inventés

---

## Peuplement partiel conservateur `commodity_categories` — codes magasinage (2026-04-02)

### Périmètre

3 catégories PAD peuplées sur 10 — uniquement celles où le code terminal dominant est quasi non ambigu.

### Mappings retenus (data-only, 3 UPDATE)

| PAD | Désignation | Codes P1/P2/P3 | Famille grille 2014 | Justification |
|-----|-------------|----------------|---------------------|---------------|
| T05 | Céréales, ciment, riz, plâtre | 410 / 510 / 610 | Ciment, riz, céréales en sacs | Quasi univoque |
| T09 | Tracteurs, véhicules industriels | 414 / 514 / 614 | Colis lourds, véhicules >3T | Correspondance directe |
| T14 | Fil machine, bobines, feuillard | 412 / 512 / 612 | Tôles, bois, métaux <1T | Famille identifiable sans ambiguïté |

### Catégories explicitement non peuplées (7)

T01, T02, T03, T04, T07, T12, T13 — trop hétérogènes ou ambiguës.
Colonnes `terminal_storage_code_p1/p2/p3` restent NULL.

### Traçabilité

Chaque catégorie peuplée a reçu une annotation dans `notes_operator` :
> "Mapping terminal storage conservateur, non officiel, retenu comme approximation défendable."

### Ce qui n'a PAS changé

- 0 moteur
- 0 UI
- 0 `terminal_tariff_codes`
- 0 handling / DPW
- Les 7 catégories ambiguës restent vierges

---

## ⚠️ Recadrage conceptuel — PAD ≠ classification terminale (2026-04-03)

### Constat

Le mapping `commodity_categories.terminal_storage_code_p1/p2/p3` (via catégories PAD) est une **approximation provisoire, pas le modèle cible**.

PAD (redevances portuaires) et Dakar Terminal (magasinage) sont **deux systèmes de classification distincts** :
- **PAD** : catégories agrégées de redevances portuaires (T01–T14)
- **Dakar Terminal** : ~500 désignations de marchandises avec positions tarifaires propres

### Schéma logique correct

```
BL goods_description
  → normalisation / matching
    → désignation Dakar Terminal (ex: "AVIONS (jouets)")
      → position tarifaire (ex: 138)
        → codes magasinage P1/P2/P3 (ex: 419/519/619)
          → terminal_tariff_codes → montants
            → calcul magasinage
```

### Ce qui est faux

Utiliser les catégories PAD (T01, T02, ...) comme clé d'entrée du magasinage terminal.
Le mapping PAD → code terminal est au mieux indirect et trop grossier.

### Règle de non-usage moteur

> **Tant qu'un modèle par désignation terminale n'existe pas, le moteur ne doit pas consommer `commodity_categories.terminal_storage_code_p1/p2/p3` comme source normative de calcul du magasinage.**

### Données existantes

Les 3 mappings T05/T09/T14 restent en base (pas de rollback) mais sont requalifiés comme :
- approximation provisoire
- non-cible architecturale
- non consommable par le moteur

### Modèle cible — Phase 1 livrée (2026-04-03)

Référencé sous **DT-DESIGNATION-MODEL** dans `docs/DEFERRED_BACKLOG.md` :
- Table `terminal_designations` **créée** avec :
  - CHECK constraints : codes 3 chiffres (`handling_code`, `storage_code_p1/p2/p3`), `tariff_position > 0`
  - UNIQUE `(designation_label, terminal_provider)`
  - `effective_date` nullable sans default (renseigné au peuplement)
  - RLS authenticated CRUD (même modèle que `terminal_tariff_codes`)
  - Index : `(terminal_provider, designation_label)` + `(terminal_provider, tariff_position)`
- **0 donnée injectée** — peuplement = Phase 2 séparée
- Résolution cible : `goods_description → terminal_designations → terminal_tariff_codes → montant`

#### Notes de prudence
- L'unicité `(designation_label, terminal_provider)` pourra évoluer vers `(terminal_provider, designation_label, tariff_position)` si le peuplement réel révèle des collisions de libellés
- Le matching futur devra probablement utiliser une normalisation du libellé (index case-insensitive à créer)

### Ce qui n'a PAS changé

- 0 moteur
- 0 UI
- 0 suppression de données
- 0 `terminal_tariff_codes`
- 0 `commodity_categories`

---

## Peuplement terminal_designations — Phase 2 (2026-04-03)

### Source

- **Fichier** : `tariff_final_consolidated.csv` (956 lignes)
- **Document d'origine** : Grille Tarifaire Officielle Dakar Terminal 2014
- **Croisement qualité** : 100 lignes aléatoires vérifiées manuellement contre le PDF — 100% conformes

### Données insérées

- **956 lignes** dans `terminal_designations`
- `terminal_provider = 'dakar_terminal'`
- `evidence_level = 'official'`
- `source_document = 'Grille Tarifaire Officielle Dakar Terminal 2014'`
- `effective_date = '2014-12-09'`

### Mapping `tariff_position`

Dans le référentiel Dakar Terminal importé ici, la colonne "Position tarifaire" correspond factuellement aux valeurs 3 chiffres reprises dans `handling_code` ; cette équivalence est spécifique à ce référentiel et ne doit pas être généralisée.

### `handling_code` — cadrage strict

- Importé comme **métadonnée descriptive** de nomenclature Dakar Terminal
- **Non consommable** par le moteur pour le calcul de la manutention
- La manutention DPW reste un référentiel séparé via `port_tariffs`

### Répartition `unit_basis`

| unit_basis | Nombre |
|------------|--------|
| tonne_per_day | 858 |
| unit | 54 |
| m3 | 40 |
| basket | 2 |
| per_100kg | 1 |
| atypical | 1 |

### Cas particuliers traités

- **27 lignes vrac** : storage codes convertis en `NULL` (valeurs source : `0`, `-`, vide)
- **Cale frigo** : `unit_basis = 'atypical'`, note : "Libellé tarifaire non marchandise, conservé comme désignation de nomenclature Dakar Terminal."
- **1 ligne VOIR TARIF** (`CHARPENTES métalliques et longueur supérieur à 8 m, + 3 T voir tarif colis lourds`) : conservée avec annotation de renvoi tarifaire

### Ce qui n'a PAS changé

- 0 moteur
- 0 UI
- 0 `terminal_tariff_codes`
- 0 `commodity_categories`
- 0 `port_tariffs`
- 0 DPW

---

## Phase 3-A — Résolution provisionnelle P1 magasinage terminal (2026-04-03)

### Objet

Enrichissement post-moteur dans `run-pricing/index.ts` : résolution `terminal_designations → terminal_tariff_codes` pour calculer une provision estimative de magasinage terminal Dakar Terminal (P1 uniquement).

### Chaîne de résolution

```
cargo.description (fact dossier)
  → normalisation (lowercase, trim, strip accents)
    → exact match dans terminal_designations (terminal_provider = 'dakar_terminal')
      → storage_code_p1
        → lookup terminal_tariff_codes (code, period='P1', tariff_type='storage', provider='dakar_terminal')
          → montant = taux × poids_tonnes × 3 jours (hypothèse)
```

### Contraintes strictes

- **Matching** : exact match normalisé uniquement. 0 ILIKE, 0 fuzzy, 0 partial.
- **Conditions cumulatives** : les 5 suivantes doivent être réunies pour qu'un montant soit calculé :
  1. `cargoDescription` présent et non vide
  2. `cargoWeight` > 0
  3. Match exact trouvé dans `terminal_designations`
  4. `storage_code_p1` non NULL
  5. Tarif P1 trouvé dans `terminal_tariff_codes`
- Si une condition manque → skip silencieux (warning log)
- `unit_basis = 'atypical'` → skip (via storage_code_p1 NULL)
- Maritime conteneurisé uniquement (skip si AIR)
- Mono-lot uniquement (multi-lot non enrichi)

### Sortie produite

- **Catégorie** : `TERMINAL_STORAGE_PROVISION_ESTIMATE`
- **origin_layer** : `enrichment_terminal_storage`
- **service_key** : `TERMINAL_STORAGE_PROVISION_ESTIMATE`
- **dedup_group** : `TERMINAL_STORAGE`
- **Confiance** : plafonnée à 0.5
- **source.type** : mappé depuis `evidence_level` → `OFFICIAL` / `TO_CONFIRM` / `OBSERVED`
- **Description** : explicitement estimative, mentionne désignation, taux, poids formaté, jours, caractère non contractuel
- **isEditable** : true (l'opérateur peut corriger/supprimer)

### Règles métier préservées

- `handling_code` reste non consommé (métadonnée descriptive Dakar Terminal uniquement)
- Dans le référentiel Dakar Terminal importé ici, la colonne "Position tarifaire" correspond factuellement aux valeurs 3 chiffres reprises dans `handling_code` ; cette équivalence est spécifique à ce référentiel et ne doit pas être généralisée.
- 0 DPW, 0 handling moteur, 0 `port_tariffs`
- 0 `quotation-engine` (FROZEN)

### Bugfix capturé

- `unit` → `unit_basis` dans la requête `terminal_tariff_codes` (bloquant, corrigé et redéployé)

### Validation métier — Smoke tests runtime (2026-04-03)

| Cas | Description | Ligne produite ? | Montant | source.type | Verdict |
|-----|-------------|-----------------|---------|-------------|---------|
| T1b matché | "AVIONS (jouets)", 12.5T, SEA_FCL | ✅ OUI | 66 300 FCFA | TO_CONFIRM | **PASS** |
| T2 non matché | description fantaisie, SEA_FCL | ❌ NON | — | — | **PASS** |
| T3 vrac | désignation vrac (storage NULL), SEA_FCL | ❌ NON | — | — | PASS (indirect) |
| T4 AIR | payload AIR_IMPORT | ❌ NON | — | — | PASS (indirect) |

**Nuance de couverture** :
- T1b et T2 : preuves runtime isolées complètes — valident le cœur fonctionnel (match exact + non-match)
- T3 et T4 : confirmations indirectes via guards amont ; non testés en isolation complète du bloc terminal storage

### Hors scope (Phase 3-B, deferred)

- ~~Matching fuzzy / synonymes / table d'alias~~ → **Phase 3-B.1-A livrée** (alias déterministes)
- UI admin alias → Phase 3-B.1-B (deferred)
- Fallback IA → Phase 3-B.2 (deferred)
- P2/P3 (périodes ultérieures)
- Calcul jours réels après franchise
- Renvois VOIR TARIF
- Cas vrac / atypical
- DPW / handling

### Audit couverture codes/montants (2026-04-03)

- **P1** : 100% des non-vrac (929/929 désignations résolues)
- **P2/P3** : 98.5% (914/929 désignations résolues)
- **Gap résiduel** : codes 520/620 (véhicules P2/P3) — ~14 désignations non résolubles
  - **Correction factuelle** : ces codes sont référencés dans la nomenclature des désignations (pages 28-29, 32 du PDF 2014) mais leurs taux FCFA sont absents du barème officiel page 34 — c'est un gap de la source elle-même, pas une erreur d'extraction
  - Décision : non injectés (règle 0-extrapolation respectée)
  - Déclencheur de réouverture : obtention d'une source secondaire (facture TOM véhicules, grille post-2014) avec les montants réels

### Phase 3-B.1-A — Alias BL → désignation terminale (2026-04-03)

**Livré** :
- Table `terminal_designation_aliases` créée (migration + RLS + trigger updated_at)
- 9 alias seedés (`is_validated = true`, `source_type = 'seeded_synonym'`) :
  - `ceramic tiles` / `tiles` → CARREAUX en vrac
  - `rice in bags` / `rice bags` → RIZ en sacs
  - `cement bags` / `bagged cement` → CIMENT en sac
  - `used clothing` / `secondhand clothes` → VETEMENTS usagés
  - `plywood` → CONTREPLAQUE (bois)
- Lookup alias intégré dans `run-pricing` avant match direct Phase 3-A
- Seuls les alias `is_validated = true` consommés par le moteur
- Confidence plafonnée à 0.5
- Log explicite avec `match=alias` ou `match=direct`

**Smoke tests** :
| Cas | Description | Résultat | Détail |
|-----|-------------|----------|--------|
| T1 | `ceramic tiles` (alias validé) | ✅ PASS | 446 040 FCFA, match=alias, OFFICIAL |
| T2 | `BATTERY ENERGY STORAGE SYSTEM` (aucun match) | ✅ PASS | Skip, log "No alias or direct match" |
| T3 | Chaîne DB résolution prouvée | ⚠️ INDIRECT | Fallback direct confirmé via jointure DB, pas par smoke test runtime isolé aussi fort que T1/T2 |

**Règles** :
- `normalized_term` = source de vérité moteur (jamais lookup sur `bl_term` brut)
- `validated_by` NULL autorisé pour seeds système
- `updated_at` maintenu automatiquement par trigger DB

### Phase 3-B.1-B — UI admin alias (2026-04-03)

**Livré** :
- Onglet "Alias BL" ajouté à la page admin Magasinage (`TerminalStorage.tsx`)
- Onglet "Désignations" existant inchangé (refactoré en composant `DesignationsTab`)
- CRUD alias : création, validation explicite, suppression avec confirmation
- `normalized_term` calculé automatiquement via `normalizeForMatch()` (read-only, non éditable)
- Création = `is_validated: false` + `source_type: 'manual'` — validation = action séparée
- Tri opératoire : alias en attente d'abord, puis validés, `created_at DESC`
- KPI : total / en attente / validés
- Filtres : recherche texte + filtre statut
- `validated_by` affiché comme "Système" si NULL, sinon UUID tronqué
- Badges visuels `source_type` (seeded_synonym, manual, operator_correction)
- 0 migration, 0 moteur, 0 run-pricing

### Phase 3-B.2-A — IA de suggestion assistée BL → désignation terminale (2026-04-04)

**Livré** :
- Table `terminal_designation_suggestions` créée (migration + RLS + trigger updated_at + indexes)
  - Champs : `source_text`, `normalized_source_text`, `terminal_designation_id`, `suggested_label`, `confidence_score`, `reasoning`, `suggestion_rank`, `suggestion_status` (pending/accepted/rejected), `alias_created`, `created_alias_id`
- Appel IA (Gemini 2.5 Flash via Lovable AI Gateway) intégré dans `run-pricing` :
  - Uniquement après échec alias validé + match direct (3e couche)
  - Anti-duplication : pas de nouvel appel IA si suggestion pending existe déjà pour le même `normalized_source_text`
  - Référentiel IA minimal : uniquement `id`, `designation_label`, `unit_basis` pour Dakar Terminal avec `storage_code_p1 IS NOT NULL`
  - Filtrage strict des suggestions IA : `confidence_score` ∈ [0,1], max 3 suggestions, `designation_id` validé contre le référentiel chargé
  - **Aucune ligne pricing produite** — stockage des suggestions uniquement
  - Timeout 15s, erreurs non bloquantes (skip silencieux)
- UI admin 3e onglet "Suggestions IA" dans `TerminalStorage.tsx` :
  - KPI : total / en attente / acceptées / rejetées
  - Filtres texte + statut
  - Tri : pending d'abord, puis created_at DESC
  - Actions : Accepter, Accepter + créer alias, Rejeter
  - Anti-doublon alias : vérification avant création (normalized_term + terminal_designation_id)
  - Indicateur visuel `alias_created` : distingue "suggestion acceptée" de "alias créé et consommable moteur"

**Règles métier** :
- Aucune auto-validation
- Aucun auto-enrichissement silencieux
- Aucune substitution invisible par l'IA
- L'opérateur reste décisionnaire à 100%
- Dakar Terminal uniquement, magasinage uniquement

**Statuts simplifiés** : pending → accepted / rejected (pas de superseded dans cette vague)

**Différé Phase 3-B.2-B** :
- Auto-segmentation BL composites multi-désignations
- P2/P3 dans le moteur
- Jours réels après franchise
