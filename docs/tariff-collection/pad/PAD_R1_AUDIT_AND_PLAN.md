# PAD-R1 — Audit et plan moteur de recommandation PAD

**Date**: 2026-05-07
**Statut**: NO-GO — bloqué par PAD-TOTALS-1 et PAD-R1B-GOVERNANCE

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

### PAD-R1B-GOVERNANCE (BLOQUANT)
- `supabase/functions/recommend-pad-category/index.ts` existe déjà
- Appelle `callAI` avec `google/gemini-2.5-flash`
- Active dans l'UI via `DesignationSuggestionBlock.tsx`
- **Non conforme** à la doctrine PAD-R1 local-only
- Doit être clarifiée avant de démarrer PAD-R1 :
  - Coexistence ? Remplacement ? Isolation ?
  - Config.toml à ajouter ?
  - Surface IA à gouverner ?

### Doctrine amount (NON DÉFINIE)
- PAD-R1 doit-il produire `amount > 0` avec `source.type = 'ESTIMATED'` ?
- Ou `amount > 0` avec `source.type = 'TO_CONFIRM'` ?
- Ou un nouveau champ `estimated_amount` séparé de `amount` ?
- Impact sur totaux, PDF, email à définir

## 5. Verdict

**PAD-R1 = NO-GO** jusqu'à :
1. ✅ PAD-TOTALS-1 PASS (patch appliqué, tests en cours)
2. ❌ PAD-R1B-GOVERNANCE clarifié
3. ❌ Doctrine amount définie

## 6. Prochaines étapes

1. Valider PAD-TOTALS-1 avec tests end-to-end
2. Ouvrir chantier PAD-R1B-GOVERNANCE
3. Définir doctrine amount pour recommandations
4. Seulement alors : implémenter PAD-R1 local-only
