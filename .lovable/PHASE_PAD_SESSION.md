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
