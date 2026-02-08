

# Fix Phase S1 — Câblage du transportMode manquant

## Diagnostic

Les filtres d'exclusion Phase S1 sont correctement codés mais **jamais activés** :

1. `QuotationSheet.tsx` ligne 1792 : `SimilarQuotationsPanel` est rendu **sans** la prop `transportMode`
2. Consequence : `useSimilarQuotations` recoit `transportMode = undefined`, donc `inputModeCategory = null`, donc aucun filtrage

Le transport mode est disponible dans la page via `cargoLines[0].cargo_type` qui contient des valeurs comme `container`, `breakbulk`, ou `air_cargo`. De plus, les services injectés contiennent des prefixes comme `AIR_IMPORT_DAP`, `SEA_FCL_IMPORT`, etc. qui encodent le mode.

## Correction (1 fichier, 1 ligne)

**Fichier : `src/pages/QuotationSheet.tsx`** — ligne ~1792

Ajouter la prop `transportMode` au rendu de `SimilarQuotationsPanel` :

```typescript
<SimilarQuotationsPanel
  destination={finalDestination || destination}
  cargoType={cargoLines.length > 0 ? cargoLines[0].cargo_type : undefined}
  clientCompany={projectContext.requesting_company}
  transportMode={cargoLines.length > 0 ? cargoLines[0].cargo_type : undefined}
  requestedServices={serviceLines.map(s => s.service).filter(Boolean)}
  onApplyTariff={...}
/>
```

Ici `cargoLines[0].cargo_type` contient `air_cargo` / `container` / `breakbulk` ce qui alimente le `modeCategory` :
- `air_cargo` -> pas de match AIR (le helper cherche "AIR" en majuscule, mais `cargo_type` est `air_cargo` en minuscule)

### Sous-correction necessaire dans `modeCategory` (useQuotationHistory.ts)

Le helper `modeCategory` dans le hook frontend doit aussi reconaitre `air_cargo` et `container` :

```typescript
const modeCategory = (mode: string | undefined | null): string | null => {
  if (!mode) return null;
  const m = mode.toUpperCase();
  if (m.includes('AIR')) return 'AIR';
  if (m.includes('SEA') || m.includes('FCL') || m.includes('LCL') || m.includes('CONTAINER')) return 'SEA';
  if (m.includes('ROAD') || m.includes('TRUCK')) return 'ROAD';
  if (m.includes('BREAKBULK') || m.includes('BREAK')) return 'SEA'; // breakbulk is sea
  return null;
};
```

Cela permettra :
- `air_cargo` -> `.toUpperCase()` = `AIR_CARGO` -> includes `AIR` -> `'AIR'`  (deja OK)
- `container` -> `.toUpperCase()` = `CONTAINER` -> includes `CONTAINER` -> `'SEA'` (NOUVEAU)
- `breakbulk` -> `.toUpperCase()` = `BREAKBULK` -> includes `BREAKBULK` -> `'SEA'` (NOUVEAU)

## Resume des modifications

| Fichier | Changement |
|---------|-----------|
| `src/pages/QuotationSheet.tsx` | Ajouter `transportMode={cargoLines.length > 0 ? cargoLines[0].cargo_type : undefined}` au rendu SimilarQuotationsPanel |
| `src/hooks/useQuotationHistory.ts` | Ajouter `CONTAINER` et `BREAKBULK` au helper `modeCategory` pour couvrir les valeurs `cargo_type` du frontend |

## Resultat attendu

Pour le cas aiocargo (air_cargo) :
- `transportMode = "air_cargo"` -> `modeCategory = "AIR"`
- Cotations historiques avec `cargo_type` = `container` -> `modeCategory = "SEA"` -> **exclues**
- Plus de suggestion a 3.5M FCFA
