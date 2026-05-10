# PAD-BAREME-2006-RUNTIME-EXPAND — Lot C : Shadow-mode strict

**Verdict :** `LOT_C_SHADOW_MODE_READY`
**Branche :** `work`
**Date :** 2026-05-10

---

## Périmètre exécuté

Branchement de `resolvePadClassification` en **observation pure** dans `supabase/functions/run-pricing/index.ts`, scope **IMPORT / CONTENEUR strict** (TRANSIT / TRANSBORDEMENT / TRANSSHIPMENT explicitement exclus).

Aucun impact pricing, aucun changement de lignes, gaps, facts, statuts ou outputs. Flag d'activation **OFF par défaut** : `PAD_RESOLVER_SHADOW=true` requis.

## Fichiers créés

- `supabase/functions/_shared/pad/types.ts` — copie 1:1 de `src/lib/pad/types.ts`, imports avec extension `.ts`
- `supabase/functions/_shared/pad/invoiceLabelAliases.ts` — copie 1:1, `from "./types.ts"`
- `supabase/functions/_shared/pad/resolvePadClassification.ts` — copie 1:1, imports `.ts`
- `supabase/functions/_shared/pad/resolvePadClassification_test.ts` — 3 smoke tests Deno
- `docs/tariff-collection/pad/PAD_BAREME_2006_RUNTIME_EXPAND_LOT_C_REPORT.md` — ce rapport

## Fichiers modifiés

- `supabase/functions/run-pricing/index.ts` — uniquement :
  1. Import du resolver partagé en haut de fichier
  2. Capture pré-PAD-1 : `SHADOW_ON`, `padCategoryBeforeAlias`, `let padShadowAliasRows: any[] = []`
  3. Greffe d'observation dans PAD-1 : `padShadowAliasRows = padAliasRows ?? []` (1 ligne)
  4. Bloc `try/catch` shadow non-bloquant après PAD-1, avant PAD-GAP-1

## Garde-fous appliqués (v3.1)

| # | Garde-fou | Statut |
|---|-----------|--------|
| 1 | `resolverOut.classification` (et non `pad_category`) | ✅ |
| 2 | `ResolvePadContext` : `aliases`, `nstRules`, `hsToNstMapping` (singulier), `designationMatches`. Aucun `aiSuggestion` | ✅ |
| 3 | `nst_code: null` (PricingInputs n'expose pas nstCode) | ✅ |
| 4 | `normalized_term` alimenté via `normalizePricingText(inputs.cargoDescription)` | ✅ |
| 5 | Imports Deno avec extension `.ts` | ✅ |
| 6 | `normalizeShadowSource()` : `validated_alias→alias`, `operator_confirmed→operator`, `none→null` | ✅ |
| 7 | `SHADOW_ON = env === 'true'` (OFF par défaut) | ✅ |
| 8 | `known_pad_category: padCategoryBeforeAlias` capturé AVANT PAD-1 | ✅ |
| 9 | Exclusion TRANSIT/TRANSBORDEMENT/TRANSSHIPMENT (package + request_type, `includes`) | ✅ |
| 10 | `padRateBeforeAlias` non créé (variable inutile supprimée) | ✅ |
| 11 | Aucun taux loggué (`rate_fcfa_per_ton` absent du JSON) | ✅ |
| 12 | try/catch non-bloquant, zéro mutation `inputs`, zéro DB write | ✅ |

## Tests réalisés

### Resolver pur (Vitest)
```
✓ src/lib/pad/__tests__/resolvePadClassification.test.ts (26 tests) 13ms
Test Files  1 passed (1)
Tests  26 passed (26)
```

### Resolver Deno partagé (smoke)
```
running 3 tests from ./supabase/functions/_shared/pad/resolvePadClassification_test.ts
known_pad_category=T12 → operator_confirmed ... ok (1ms)
aucun input PAD → source none + blocking_gap ... ok (0ms)
designation matchant un alias validé → validated_alias ... ok (0ms)
ok | 3 passed | 0 failed (5ms)
```

## Validation runtime — DIFFÉRÉE

**Non exécutée pendant Lot C.** Procédure manuelle après activation explicite :

1. Activer le secret `PAD_RESOLVER_SHADOW=true` dans Lovable Cloud
2. Rejouer un dossier IMPORT/CONTENEUR connu (T12 confirmé Phase 2)
3. Lire `edge_function_logs` filtrés sur `tag=PAD_SHADOW`
4. Vérifier `comparison.match=true` sur cas connus
5. Documenter mismatchs détaillés (`legacy_only` / `resolver_only` / `category_diff` / `source_diff`)

Le rapport ne prétend pas que cette validation a été faite tant qu'elle ne l'a pas été.

## STRUCTURAL_PATCH_ALLOWED

`run-pricing/index.ts` est touché uniquement pour :

- import du resolver partagé,
- capture de variables d'observation avant PAD-1,
- une affectation observationnelle dans PAD-1 (`padShadowAliasRows = padAliasRows ?? []`),
- un bloc `try/catch` shadow non-bloquant après PAD-1.

**Aucune mutation runtime, aucun changement de calcul, aucune écriture DB, aucun changement d'output, aucun changement de comportement legacy.** Shadow OFF par défaut. Scope strictement IMPORT/CONTENEUR (TRANSIT/TRANSBORDEMENT/TRANSSHIPMENT explicitement exclus).

## Hors scope (différé)

À tracer dans `docs/DEFERRED_BACKLOG.md` :

- Élargissement EXPORT / TRANSIT / TRANSBORDEMENT / CONVENTIONNEL
- Branchement actif resolver → source de vérité (remplacement legacy)
- `containerSizeToCxxMapping` pour T13
- Réductions P01–P05 (pêche)
- Ingestion HS-NST mappings, NST rules, AI suggestions
- Alimentation `invoice_label` depuis facture commerciale
- Exposition de `nstCode` dans `PricingInputs`
