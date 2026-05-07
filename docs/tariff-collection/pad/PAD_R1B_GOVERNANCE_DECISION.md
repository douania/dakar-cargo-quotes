# PAD-R1B-GOVERNANCE — Décision de gouvernance

**Date** : 2026-05-07
**Statut** : ✅ DÉCISION ACTÉE
**Auteur** : CTO
**Phase** : PAD-R1B-GOVERNANCE (Phase 1 uniquement — documentation)

---

## 1. Gouvernance retenue : Option A — Coexistence réglementée

### Frontière IA / Runtime

| Surface | Mécanisme | Rôle | Branchement pricing |
|---------|-----------|------|---------------------|
| `recommend-pad-category` (edge function) | IA (`google/gemini-2.5-flash`) | Aide opérateur UI uniquement | **INTERDIT** — jamais appelé par `run-pricing` |
| PAD-R1 local (futur) | Scoring déterministe local | Fallback runtime dans `run-pricing` | Autorisé — ligne `TO_CONFIRM` uniquement |

### Règles strictes `recommend-pad-category`

1. **Jamais appelé par `run-pricing`** ni aucune autre edge function de pricing.
2. **Jamais créateur d'alias automatique** — les alias ne sont créés que par action opérateur explicite dans l'UI admin.
3. **Jamais producteur de montant ferme** — aucun `amount > 0` n'entre dans un devis via cette fonction.
4. **Appelé uniquement par `DesignationSuggestionBlock.tsx`** via `supabase.functions.invoke()`, conditionné à `bestLocalScore < 0.5`.
5. **Read-only** — SELECT uniquement, zéro INSERT/UPDATE/DELETE.
6. **Auth obligatoire** — `requireUser` appliqué.

### Doctrine

- **IA = aide opérateur.** L'IA propose, l'opérateur dispose.
- **Runtime pricing = local-only déterministe.** Aucun appel IA dans le chemin de calcul du devis.

---

## 2. Doctrine amount retenue : Option C modifiée — `TO_CONFIRM` + `estimated_amount`

### Ce qui est INTERDIT pour PAD-R1 local

| Champ | Valeur interdite | Raison |
|-------|-----------------|--------|
| `source.type` | `ESTIMATED` | Nécessiterait une nouvelle doctrine QQM/UI/PDF/email |
| `amount` | `> 0` | Montant non validé ne doit pas entrer dans le devis client |
| Inclusion `total_ht` | Oui | Catégorie PAD estimée ≠ catégorie PAD validée |

### Ce qui est RETENU pour PAD-R1 local

Quand PAD-R1 local produit une recommandation sans alias validé :

```
source.type = "TO_CONFIRM"
qualification = "PAD_CATEGORY_ESTIMATED"
amount = 0
estimated_amount = <montant calculé depuis port_tariffs pour la catégorie proposée>
estimated_pad_category = <catégorie proposée par le scoring local>
candidates = [<liste des candidats scorés>]
conservative_choice = true | false
```

### Impact sur la chaîne devis

| Élément | Comportement |
|---------|-------------|
| `total_ht` | **Non impacté** — `amount = 0` et `source.type = TO_CONFIRM` sont déjà exclus par PAD-TOTALS-1 |
| `total_ttc` | **Non impacté** |
| QQM (`qqm-resolver.ts`) | `TO_CONFIRM` détecté → `hasToConfirmLine = true` → qualification dégradée à `provisional` — **comportement existant, aucun changement requis** |
| PDF / Email | Montant affiché = 0 ou absent — `estimated_amount` visible uniquement dans les données techniques |
| UI opérateur | `estimated_amount` et `estimated_pad_category` affichables dans `DesignationSuggestionBlock` ou panneau dédié |

### Cycle de vie

1. PAD-R1 local produit `TO_CONFIRM` + `estimated_amount > 0`
2. L'opérateur voit la suggestion (catégorie + montant estimé)
3. L'opérateur valide via l'UI → `set-case-fact` écrit `cargo.pad_category` + `cargo.pad_rate_fcfa_per_ton`
4. Au re-run pricing, le lookup alias/fact résout la catégorie validée → ligne `OFFICIAL` avec `amount > 0`
5. `total_ht` inclut alors le montant PAD validé

---

## 3. Scope PAD-R1 local

### Sources autorisées

| Source | Table / Fichier | Usage |
|--------|----------------|-------|
| Alias PAD validés | `pad_designation_aliases` (`is_validated = true`) | Scoring exact + substring + tokens |
| Référentiel marchandises | `commodity_categories` (`designation_normalized`) | Scoring tokens |
| Synonymes statiques | `src/lib/commoditySynonyms.ts` | Expansion tokens pré-scoring |

### Contraintes strictes

| Contrainte | Détail |
|-----------|--------|
| Pas d'IA | Aucun appel `callAI`, aucune invocation de `recommend-pad-category` |
| Pas de web | Aucune recherche web |
| Pas d'apprentissage automatique | Le dictionnaire de synonymes est statique et versionné |
| Pas de création automatique d'alias | Aucun INSERT dans `pad_designation_aliases` |
| Pas de validation automatique | La catégorie proposée reste `TO_CONFIRM` jusqu'à action opérateur |
| Pas de modification `quotation-engine` | PAD-R1 local opère dans `run-pricing` uniquement |

### Dictionnaire de synonymes

Le dictionnaire `src/lib/commoditySynonyms.ts` est acceptable si :
- Versionné dans le repo
- Testé (couvert par les tests Deno PAD-R1)
- Traçable (chaque ajout documenté)
- Limité (termes non ambigus uniquement)
- Non auto-apprenant (pas de feedback loop automatique)

---

## 4. Configuration `config.toml`

`recommend-pad-category` n'est **pas** dans `config.toml` actuellement. Elle déploie via les defaults Lovable Cloud (`verify_jwt = false` par défaut).

**Décision** : ne pas ajouter de bloc `[functions.recommend-pad-category]` dans cette phase. La fonction utilise `requireUser` en code (auth en code, pas par JWT gateway). Ajouter un bloc config.toml explicite sera fait lors de la Phase 2 si nécessaire, avec justification documentée.

---

## 5. Statut PAD-R1

**PAD-R1 reste NO-GO.**

Blocages restants après cette décision :
1. ~~PAD-R1B-GOVERNANCE~~ → ✅ DÉCISION ACTÉE (ce document)
2. ~~PAD-TOTALS-1~~ → ✅ CLOS
3. ❌ **Implémentation PAD-R1 local** — non démarrée, phase séparée requise

### Prochaines étapes (hors scope de ce document)

1. Implémenter PAD-R1 local dans `run-pricing/index.ts` (phase séparée)
2. Tests Deno pour PAD-R1 local
3. Smoke tests end-to-end
4. Mise à jour `DEFERRED_BACKLOG.md` et `PAD_R1_AUDIT_AND_PLAN.md`

---

## 6. Fichiers NON modifiés dans cette phase

| Fichier | Raison |
|---------|--------|
| `supabase/functions/run-pricing/index.ts` | Aucune implémentation PAD-R1 local dans cette phase |
| `src/components/case/DesignationSuggestionBlock.tsx` | Aucune modification UI dans cette phase |
| `supabase/functions/recommend-pad-category/index.ts` | Conservé tel quel — coexistence réglementée |
| `supabase/config.toml` | Pas d'ajout de bloc pour recommend-pad-category |
| `quotation-engine/index.ts` | Hors scope PAD-R1 |

---

## 7. Watchlist héritée de PAD-TOTALS-1

Le test "Engine dap/ddp = 0 is treated as present, not reconstructed" est acceptable uniquement si aucun chemin runtime réel ne produit `dap=0`/`ddp=0` avec `operationnel`/`honoraires`/`debours` non nuls. Si un tel cas apparaît, préférer une reconstruction depuis les blocs plutôt qu'un total à zéro.
