
# Fix Phase S1.2 — Utiliser request_type du quote_case comme transportMode

## Diagnostic confirmé

La chaîne actuelle :
1. `QuotationSheet.tsx` passe `transportMode={cargoLines[0].cargo_type}` = **"container"** (valeur du formulaire cargo, jamais modifiée manuellement)
2. `modeCategory("container")` = **SEA**
3. Les cotations historiques ont aussi `cargo_type = "container"` (mal classifié à la sauvegarde)
4. Résultat : SEA == SEA, aucune exclusion, la cotation 3.5M FCFA passe toujours

Le **bon signal** existe déjà : `quoteCase.request_type = "AIR_IMPORT"` — c'est le résultat de l'analyse IA du dossier. C'est la source fiable du mode de transport.

## Correction (1 fichier, 1 ligne)

**Fichier : `src/pages/QuotationSheet.tsx`** — ligne ~1796

Remplacer :
```typescript
transportMode={cargoLines.length > 0 ? cargoLines[0].cargo_type : undefined}
```

Par :
```typescript
transportMode={quoteCase?.request_type || (cargoLines.length > 0 ? cargoLines[0].cargo_type : undefined)}
```

Cela priorise `quoteCase.request_type` (ex: `"AIR_IMPORT"`) qui est le résultat de l'analyse IA, avec fallback sur `cargoLines[0].cargo_type` si pas de quote_case.

## Flux résultant pour aiocargo

1. `transportMode = "AIR_IMPORT"`
2. `modeCategory("AIR_IMPORT")` = `"AIR"` (contient "AIR")
3. Cotation historique `cargo_type = "container"` -> `modeCategory = "SEA"` -> **exclue**
4. Cotation historique Bamako `cargo_type = "container"` -> **exclue**
5. Plus de suggestion 3.5M FCFA

## Risque

- Aucun : fallback préservé si quote_case absent
- `request_type` contient des valeurs comme `AIR_IMPORT`, `SEA_FCL_IMPORT`, `ROAD_IMPORT` qui sont parfaitement compatibles avec le helper `modeCategory`
