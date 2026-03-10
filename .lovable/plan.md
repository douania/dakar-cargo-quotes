

# STRUCTURAL_PATCH_ALLOWED — TRANSIT_REGIONAL_VIA_DAKAR

Patch validé CTO. Correction finale intégrée : `isGatewayDakar` utilise uniquement des signaux Dakar explicites (pas `destCountry === 'SN'`).

## 2 fichiers, 3 insertions

### 1. `supabase/functions/build-case-puzzle/index.ts`

**A. Nouvelle règle dans `detectFlowType()` — après ligne 829, avant Rule 2 (ligne 831)**

Insérer après le bloc `// Rule 1: Transit Gambia` :

```typescript
// Rule 1b: Transit régional via Dakar (pays enclavés ML/BF/NE)
const INLAND_TRANSIT_COUNTRIES = new Set(['ML', 'BF', 'NE']);
const INLAND_TRANSIT_CITIES = ['BAMAKO', 'OUAGADOUGOU', 'NIAMEY'];
const destPort = factMap.get('routing.destination_port')?.value?.toUpperCase() || '';
const destCity = factMap.get('routing.destination_city')?.value?.toUpperCase() || '';
const isGatewayDakar =
  destPort.includes('DAKAR') ||
  destPort.includes('DKR') ||
  destCity.includes('DAKAR');
const inlandCountry = PORT_COUNTRY_MAP[finalDest] || PORT_COUNTRY_MAP[destCity] || '';
const isInlandTransit =
  INLAND_TRANSIT_COUNTRIES.has(inlandCountry) ||
  INLAND_TRANSIT_CITIES.some(c => finalDest.includes(c) || destCity.includes(c));
if (isGatewayDakar && isInlandTransit && originCountry !== 'SN') {
  return 'TRANSIT_REGIONAL_VIA_DAKAR';
}
```

**B. Nouveau bloc dans `ASSUMPTION_RULES` — après ligne 317 (après `SEA_LCL_IMPORT`)**

```typescript
TRANSIT_REGIONAL_VIA_DAKAR: [
  { key: 'service.package', value: 'TRANSIT_REGIONAL_VIA_DAKAR', confidence: 0.7 },
  { key: 'border.fee_expected', value: 'true', confidence: 0.6 },
],
```

### 2. `src/features/quotation/constants.ts`

**Ajout dans `SERVICE_PACKAGES` — après ligne 49 (après `LCL_IMPORT_DAP`)**

```typescript
TRANSIT_REGIONAL_VIA_DAKAR: ['PORT_DAKAR_HANDLING', 'DTHC', 'TRUCKING', 'BORDER_FEES', 'CUSTOMS_DAKAR', 'AGENCY'],
```

## Ordre des règles après patch

```text
1.  TRANSIT_GAMBIA              (destCountry=GM ou Banjul)
1b. TRANSIT_REGIONAL_VIA_DAKAR  (gateway Dakar + inland ML/BF/NE + origin≠SN)
2.  EXPORT_SENEGAL              (origin SN + dest ≠ SN)
3.  BREAKBULK_PROJECT           (poids lourd sans conteneurs)
4.  IMPORT_PROJECT_DAP          (dest SN)
```

## Ce qui ne change pas

Aucune migration, aucun changement UI, pricing, gaps, facts, RLS. Les règles existantes restent intactes.

