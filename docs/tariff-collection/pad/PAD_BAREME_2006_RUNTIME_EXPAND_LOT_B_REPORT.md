# PAD-BAREME-2006-RUNTIME-EXPAND — Lot B : rapport de réalisation

**Date :** 2026-05-10
**Repo :** `douania/dakar-cargo-quotes`
**Branche :** `work`
**Mode :** CTO / Architecte production-grade — création d'un helper pur, aucun branchement runtime.

---

## 1. Confirmation repo + branche

- Repo : `douania/dakar-cargo-quotes`
- Branche : `work`
- Verdict Lot A confirmé : `LOT_A_PATCH_PLAN_READY` (présent dans `docs/tariff-collection/pad/PAD_BAREME_2006_RUNTIME_EXPAND_LOT_A_PATCH_PLAN.md`).

## 2. Fichiers lus

- `docs/MASTER_CONTEXT.md`
- `docs/STATUS_REGISTRY.md`
- `docs/SECURITY_CONTRACT.md`
- `docs/DEFERRED_BACKLOG.md`
- `.lovable/plan.md`
- `docs/tariff-collection/pad/PAD_BAREME_2006_RUNTIME_EXPAND_AUDIT_AND_ROADMAP.md`
- `docs/tariff-collection/pad/PAD_BAREME_2006_RUNTIME_EXPAND_LOT_A_PATCH_PLAN.md`
- `vitest.config.ts` (vérification du runner de tests)

## 3. Fichiers créés

```
A src/lib/pad/types.ts
A src/lib/pad/invoiceLabelAliases.ts
A src/lib/pad/resolvePadClassification.ts
A src/lib/pad/__tests__/resolvePadClassification.test.ts
A docs/tariff-collection/pad/PAD_BAREME_2006_RUNTIME_EXPAND_LOT_B_REPORT.md
```

Aucun autre fichier créé, modifié ou supprimé.

## 4. Confirmation : aucun fichier runtime modifié

- ❌ Aucune modification `supabase/functions/run-pricing/`
- ❌ Aucune modification `supabase/functions/recommend-pad-category/`
- ❌ Aucune modification `supabase/functions/get-pad-nst-suggestions/`
- ❌ Aucune modification `supabase/functions/build-case-puzzle/`
- ❌ Aucune modification `supabase/functions/price-service-lines/`
- ❌ Aucune modification `supabase/functions/quotation-engine/`
- ❌ Aucune modification `supabase/functions/set-case-fact/`
- ❌ Aucune migration créée
- ❌ Aucune écriture DB
- ❌ Aucune modification `port_tariffs`, `pad_designation_aliases`, `pad_nst_recommendation_rules`, tables NST
- ❌ Aucune modification CSV PAD 2006 / manifest / rapports Phase 2
- ❌ Aucune modification `src/components/`, `src/pages/`, `src/integrations/supabase/`
- ❌ Aucune modification `supabase/config.toml`
- ❌ Aucune Edge Function créée
- ❌ Aucun branchement du resolver dans l'application

## 5. Résumé du design du resolver

`resolvePadClassification(input, context?)` est une **fonction pure**.

Hiérarchie de priorité (déterministe) :

0. **Détection libellé facture** (informatif, ajoute warnings, ne classifie jamais).
1. **Préchecks structurels** : `operation_type` puis `cargo_type` obligatoires sinon gap immédiat.
2. **operator_confirmed** — `known_pad_category` validée (T01..T14 / P01..P05 / C01..C03).
3. **validated_alias** — `context.aliases[].is_validated=true` matchant `designation`. Les alias `invoice_label` sont **explicitement ignorés comme source de classification** (réserve CTO #1).
4. **hs_to_nst** — uniquement via `context.hsToNstMapping` explicite, avec `is_unique=true` et `pad_category` non null. Aucune normalisation HS10→CN8/HS6 hardcodée (réserve CTO #2).
5. **nst_rule** — `context.nstRules` matchant `nst_code`. Si `requires_operator_validation=true` → `needs_human_review=true` + `confidence=0.5`.
6. **designation_match** — `context.designationMatches[].is_validated=true`.
7. **ai_suggestion** — `confidence=0.5`, `needs_human_review=true`, jamais OFFICIAL.
8. **none + gap** — `pricing.hs_or_nst_required` si HS/NST fournis sans mapping ; sinon `pricing.pad_category_required`.

Cas spécial **T13 transit/transbordement conteneur** :
- Sans `container_size` → `pricing.container_size_required_for_T13_transit`.
- Avec `container_size` mais sans `context.containerSizeToCxxMapping` → `needs_human_review=true` + gap. **Aucune invention C01/C02/C03** (réserve CTO #3).
- Avec mapping explicite → classification C0x renvoyée.

## 6. Invariants respectés

| Invariant | Statut |
|---|---|
| `canonical_rate_family === "DROIT_PASSAGE"` toujours | ✅ |
| `PORT_TAX` jamais retourné comme famille canonique | ✅ |
| Aucun calcul de montant | ✅ |
| Aucune lecture `port_tariffs` | ✅ |
| Aucun import Supabase / fetch / React / DOM | ✅ |
| Aucun `Date.now` / `Math.random` | ✅ |
| Idempotent (mêmes inputs → mêmes outputs) | ✅ (test 13) |
| BLANK_IN_PDF jamais transformé en 0 | ✅ (helper ne renvoie aucun champ montant) |
| `invoice_label` ne classifie jamais seul | ✅ (réserve CTO #1, tests 5 + dédié context) |
| HS → NST uniquement via context | ✅ (réserve CTO #2) |
| T13 transit conteneur sans mapping → bloquant | ✅ (réserve CTO #3) |
| `ai_suggestion` → confidence ≤ 0.5 + needs_human_review=true | ✅ (test 10) |
| Aucune réduction pêche P01–P05 automatique | ✅ (test 12) |
| Collision multi-PAD → `needs_human_review` | ✅ (test 8) |
| Catégories inconnues → rejetées | ✅ |

## 7. Liste des tests créés

26 tests Vitest dans `src/lib/pad/__tests__/resolvePadClassification.test.ts`, regroupés en 7 blocs :

1. **Invariants** (1 test) — `canonical_rate_family === "DROIT_PASSAGE"`.
2. **operator_confirmed** (4 tests) — T12 prime (#1), T10 sans montant (#2), P02 sans réduction (#12), catégorie inconnue.
3. **Préchecks structurels** (2 tests) — operation_type manquant (#3), cargo_type manquant (#4).
4. **invoice_label** (4 tests) — taxe de port (#5), PORT_TAX warning (#6), invoice_label inconnu (#15), invoice_label en context.aliases ignoré comme classifiant.
5. **validated_alias désignation** (3 tests) — riz→T01 (#7), collision (#8), alias non validé ignoré.
6. **nst_rule** (2 tests) — candidate avec validation requise (#9), validée sans confirmation.
7. **ai_suggestion** (2 tests) — IA seule (#10), IA inconnue ignorée.
8. **T13 transit conteneur** (3 tests) — sans size (#11), avec size sans mapping, avec size + mapping.
9. **Propriétés générales** (5 tests) — idempotence (#13), BLANK_IN_PDF (#14), HS sans mapping, HS avec mapping, aucun signal.

## 8. Résultat des tests

```
$ bunx vitest run src/lib/pad/__tests__/resolvePadClassification.test.ts --config vitest.config.ts

 ✓ src/lib/pad/__tests__/resolvePadClassification.test.ts (26 tests) 25ms

 Test Files  1 passed (1)
      Tests  26 passed (26)
```

**26/26 PASS. 0 FAIL. 0 SKIP.**

## 9. Limites volontaires du Lot B

- Le resolver **n'est pas branché** dans `run-pricing`, `recommend-pad-category` ni aucun composant UI. **Aucun comportement de pricing n'est modifié** (réserve CTO #4).
- Les tables de référence (`pad_designation_aliases`, `pad_nst_recommendation_rules`, mappings HS/NST, mappings taille→Cxx) ne sont pas chargées par le helper : elles doivent être **injectées par l'appelant** via `context`.
- La constante `INVOICE_LABEL_ALIASES` est une donnée statique versionnée, **non consommée** par le runtime actuel.
- Aucun mapping HS10 → CN8 / HS6 n'est codé. Le helper ne dérive pas de codes.
- Aucun mapping taille → C01/C02/C03 n'est codé. Le helper exige `containerSizeToCxxMapping` explicite.
- Le helper ne lit pas de fichiers, ne fait pas d'I/O, ne logue rien.

## 10. Risques restants avant Lot C

| Risque | Mitigation prévue Lot C |
|---|---|
| Drift entre `src/lib/pad/` et future copie Deno `supabase/functions/_shared/pad/` | Garder le helper sans dépendance ; copie miroir contrôlée au Lot C. |
| Couverture des mappings HS/NST réelle (volume + unicité) | Audit data dédié avant activation. |
| Validation métier C01/C02/C03 vs taille conteneur | GO CTO data avant injection `containerSizeToCxxMapping` en runtime. |
| Casser le smoke T12=4 015 200 FCFA lors du branchement | Lot C avec tests de non-régression sur 19 lignes IMPORT/CONTENEUR. |
| Réactivation involontaire des lignes legacy `PORT_TAX/Taleb_Quote_2024` | Le resolver n'écrit jamais `PORT_TAX` ; le bloc legacy `quotation-engine` reste hors scope. |
| Élargissement scope (EXPORT/TRANSIT/TRANSBORDEMENT) sans validation | Activation par lot/feature flag au Lot F. |

## 11. Verdict final

**`LOT_B_RESOLVER_READY`**

Helper pur livré, 26 tests Vitest verts, aucun branchement runtime, aucune modification DB / migration / Edge Function. Le comportement de pricing actuel reste strictement inchangé.

Prochaine étape autorisée uniquement sur GO CTO séparé : **Lot C — intégration contrôlée du resolver dans `run-pricing` (scope `IMPORT/CONTENEUR` d'abord en non-régression, puis élargissement par étapes)**.
