

# Phase 4B — resolveCountry() DB lookup avec fallback

## Fichier unique modifié
`supabase/functions/build-case-puzzle/index.ts`

## 4 changements

### A. Helper normalisation (nouveau, avant resolveCountry)
```typescript
function normalizeLocationKey(value: string): string {
  return String(value || '').toUpperCase().trim().replace(/\s+/g, ' ');
}
```

### B. resolveCountry() → async avec gestion explicite de `error`

- Accepte `serviceClient` en premier paramètre
- Normalise via `normalizeLocationKey()`
- DB lookup : `location_aliases` JOIN `locations_reference`, filtre `is_active = true`
- Lecture explicite de `{ data, error }` (pas juste try/catch) :
  - Si `error` → log + continue vers fallback
  - Si `data` trouvé → return `country_code`
- Fallback `PORT_COUNTRY_MAP` exact puis partial (code existant inchangé)
- Warning log avec variables renommées `rawPort`/`rawCity` (fix bug double `const port`)
- `try/catch` conservé comme filet réseau en plus

### C. detectFlowType() → async
- Accepte `serviceClient` en premier paramètre
- Les 2 appels `resolveCountry` deviennent `await`
- Aucun autre changement de logique métier

### D. Appelant unique (~ligne 912)
```typescript
let flowType = await detectFlowType(serviceClient, factMap);
```

## Ce qui ne change pas
- `PORT_COUNTRY_MAP` intact
- `ASSUMPTION_RULES` intact
- Aucun autre fichier, aucune migration, aucun changement UI

## Vérification post-patch (exécution réelle)
- DB hits : DSS→SN, CDG→FR, PORT KLANG→MY, KHORFAKKAN→AE
- Fallback hardcoded : DAKAR→SN, BANJUL→GM
- Flows : TRANSIT_REGIONAL_VIA_DAKAR, EXPORT_SENEGAL
- Cas panne DB : fallback fonctionne

