# PAD-R1 — Audit et plan moteur de recommandation PAD

**Date**: 2026-05-07
**Statut**: NO-GO — bloqué par implémentation locale (gouvernance et doctrine actées)
**Gouvernance** : PAD-R1B-GOVERNANCE ✅ DÉCISION ACTÉE — voir `PAD_R1B_GOVERNANCE_DECISION.md`

---

## 1. Contexte

PAD-R1 vise à fournir un moteur local (sans IA) pour recommander une catégorie PAD lorsque la désignation marchandise ne correspond à aucun alias existant dans `pad_designation_aliases`.

## 2. État actuel du runtime

### Lookup existant (`run-pricing/index.ts` L1959-2028)
1. `normalizePricingText(description)` → NFD + lowercase + trim + collapse spaces
2. SELECT `pad_designation_aliases` WHERE `normalized_term` = normalized AND `is_validated = true`
3. Si trouvé → `pad_category` résolu → lookup `port_tariffs` → montant OFFICIAL
4. Si non trouvé → gap `pricing.pad_category` + placeholder `PAD_DROIT_PASSAGE` avec `source.type = 'TO_CONFIRM'`, `amount: 0`

### Résultats PAD-NOM-3 smoke tests
- gasoil → T06 → 885 FCFA/t ✅
- crustaces nda → P01 → 28,100 FCFA/t ✅
- biscuits → T12 → 4,780 FCFA/t ✅
- amidon → T12 → 4,780 FCFA/t ✅

## 3. Algorithme proposé (local-only, 0 IA)

1. Normaliser la description → extraire tokens (min 3 chars)
2. Expansion de synonymes locaux (dictionnaire statique)
3. Scoring local contre `pad_designation_aliases.normalized_term` et `commodity_categories.designation_normalized`
4. Agrégation par `pad_category`, max score par catégorie
5. Sélection conservatrice (tarif le plus élevé parmi les candidats)
6. **Aucune création d'alias** — suggestion uniquement
7. **Aucun appel IA**

## 4. Blocages actuels

### PAD-TOTALS-INTEGRITY (CRITIQUE)
- Les enrichissements PAD post-engine n'étaient pas inclus dans `total_ht`/`total_ttc`
- **Patch PAD-TOTALS-1 appliqué** — en attente de validation
- Si PAD-R1 génère des `amount > 0` avec un statut intermédiaire, ils doivent être correctement gérés par les totaux

### PAD-R1B-GOVERNANCE (✅ RÉSOLU)
- Décision CTO actée : **Option A — coexistence réglementée**
- `recommend-pad-category` = aide opérateur UI uniquement, jamais branchée à `run-pricing`
- PAD-R1 local = seul mécanisme runtime, déterministe, sans IA
- Voir `PAD_R1B_GOVERNANCE_DECISION.md`

### Doctrine amount (✅ RÉSOLU)
- Décision CTO : **Option C modifiée**
- `source.type = TO_CONFIRM`, `amount = 0`, `estimated_amount > 0`
- Non inclus dans `total_ht` / `total_ttc`
- Validation opérateur requise avant transformation en ligne OFFICIAL
- Voir `PAD_R1B_GOVERNANCE_DECISION.md`

## 5. Verdict

**PAD-R1 = NO-GO** jusqu'à :
1. ✅ PAD-TOTALS-1 PASS — CLOS
2. ✅ PAD-R1B-GOVERNANCE clarifié — DÉCISION ACTÉE
3. ✅ Doctrine amount définie — Option C modifiée actée
4. ❌ **Implémentation PAD-R1 local** — non démarrée

## 6. Prochaines étapes

1. ~~Valider PAD-TOTALS-1 avec tests end-to-end~~ → ✅ CLOS
2. ~~Ouvrir chantier PAD-R1B-GOVERNANCE~~ → ✅ DÉCISION ACTÉE
3. ~~Définir doctrine amount pour recommandations~~ → ✅ Option C modifiée actée
4. **Implémenter PAD-R1 local-only** dans `run-pricing/index.ts` (phase séparée à planifier)
