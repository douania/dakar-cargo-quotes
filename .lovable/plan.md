# Lot B.1 — Retrait strict de `carrier_label` de `PadAliasKind`

## Contexte
Verdict CTO : `LOT_B_RESOLVER_READY_ACCEPTED` avec réserve mineure.

Le brief Lot B exigeait strictement `PadAliasKind = "designation" | "invoice_label"`. L'implémentation actuelle inclut aussi `"carrier_label"`, qui est inerte côté resolver (ignoré comme source de classification) mais constitue une extension non demandée. Discipline « zéro extension non demandée » → on retire.

## Périmètre autorisé (strict)
- `src/lib/pad/types.ts`
- `src/lib/pad/resolvePadClassification.ts`
- `src/lib/pad/__tests__/resolvePadClassification.test.ts` (uniquement si un test fait référence à `carrier_label`)
- `docs/tariff-collection/pad/PAD_BAREME_2006_RUNTIME_EXPAND_LOT_B_REPORT.md` (note correctif)

## Interdictions
- Aucune modification dans `supabase/functions/`
- Aucune modification de `run-pricing`, `recommend-pad-category`, `quotation-engine`
- Aucune migration / DB / `port_tariffs`
- Aucune modification dans `src/components/`, `src/pages/`, autres `src/`
- Aucun branchement runtime du resolver
- Aucune autre logique métier touchée

## Diff prévu (chirurgical)

### 1. `src/lib/pad/types.ts` (ligne 94)
```diff
-export type PadAliasKind = "designation" | "invoice_label" | "carrier_label";
+export type PadAliasKind = "designation" | "invoice_label";
```

### 2. `src/lib/pad/resolvePadClassification.ts` (lignes 427-436)
Suppression de la branche `carrier_label` dans la condition ; on conserve la garde-fou `invoice_label` inchangée.
```diff
-    } else if (
-      (a.alias_kind === "invoice_label" || a.alias_kind === "carrier_label") &&
-      invoice &&
-      invoice === term
-    ) {
+    } else if (a.alias_kind === "invoice_label" && invoice && invoice === term) {
       // Garde-fou : un invoice_label ne peut JAMAIS classifier seul.
       // On l'ignore comme source de classification.
       // (Il a déjà ajouté un warning DROIT_PASSAGE dans le préchecks.)
       continue;
     }
```

### 3. Tests
Vérification préalable : `rg "carrier_label" src/lib/pad/__tests__/`. Si aucun match → fichier non modifié. Si match → suppression des cas concernés (le resolver les ignorait déjà, donc aucune assertion comportementale ne devrait dépendre de la valeur littérale `carrier_label`).

### 4. Rapport `LOT_B_REPORT.md`
Ajout d'une section finale :
> ### Correctif Lot B.1
> Retrait de `carrier_label` de `PadAliasKind` pour conformité stricte au brief Lot B (« designation » | « invoice_label » uniquement). Aucun impact comportemental : la valeur était déjà ignorée comme source de classification. Tests : 26/26 PASS après correctif.

## Validation
```bash
bunx vitest run src/lib/pad/__tests__/resolvePadClassification.test.ts
```
Attendu : **26/26 PASS** (aucun changement comportemental, seul un type littéral est retiré).

## Verdict attendu
- Succès → `LOT_B_1_CARRIER_LABEL_REMOVED`
- Échec test → `LOT_B_1_BLOCKED` avec cause exacte

## Étape suivante (séparée, non incluse)
Lot C — Shadow-mode strict : appel parallèle de `resolvePadClassification` dans `run-pricing` (IMPORT/CONTENEUR uniquement), log comparatif legacy vs resolver, **aucun impact pricing**. Plan séparé après validation Lot B.1.
