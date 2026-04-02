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

### Ce qui n'a PAS été fait

- 0 migration
- 0 injection de données
- 0 moteur
- 0 UI
- 0 peuplement de `commodity_categories`
- Aucune table `terminal_tariff_codes` créée
