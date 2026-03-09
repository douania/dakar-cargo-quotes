

# PATCH P1.1 — Fallback LCL en cas d'ambiguïté LCL/container

## Fichier
`supabase/functions/build-case-puzzle/index.ts`

## Modification unique

Dans `detectRequestType()`, remplacer le fallback FCL par LCL dans le cas ambigu :

```typescript
// Avant
if (hasLclSignal && hasExplicitContainer) {
  console.log(`[Detection] SEA_FCL_IMPORT (ambiguous: both LCL signal and explicit container found)`);
  return { type: "SEA_FCL_IMPORT", ambiguous_lcl_fcl: true };
}

// Après
if (hasLclSignal && hasExplicitContainer) {
  console.log(`[Detection] SEA_LCL_IMPORT (ambiguous: both LCL signal and explicit container — pending client clarification)`);
  return { type: "SEA_LCL_IMPORT", ambiguous_lcl_fcl: true };
}
```

## Impact
- 1 ligne de type + 1 ligne de log modifiées
- Le gap `routing.shipment_mode_clarification` reste inchangé
- Aucun autre fichier touché

