

# Phase S1 — Similarity Safety Guard

## Problem Confirmed

The `useSimilarQuotations` hook in `src/hooks/useQuotationHistory.ts` scores quotations using only:
- Destination match (+50)
- Cargo type string match (+30)
- Client match (+20)
- Recency bonus (+10)

It has **zero hard exclusion filters**. A SEA/ROAD quotation for 25t container to Bamako (3.5M FCFA transport) scores 50+ just by matching "Dakar" as destination, then gets suggested for an AIR 3.2t local delivery.

The backend `find-similar-quotations` edge function has the same gap: transport mode is only a +10 bonus, never a hard filter. Weight ratio check exists but only as a +10 bonus, not exclusion.

## Scope

Two files modified, zero DB/AI/schema changes.

## Changes

### 1. Frontend: `src/hooks/useQuotationHistory.ts`

The `useSimilarQuotations` function currently receives `destination`, `cargoType`, `clientCompany`. It needs an additional optional parameter `transportMode` to enable hard filtering.

**Signature change:**
```typescript
export function useSimilarQuotations(
  destination: string | undefined,
  cargoType: string | undefined,
  clientCompany: string | undefined,
  transportMode?: string  // NEW
)
```

**Add hard exclusion before scoring loop** (after line 73, before `for (const quotation of allQuotations)`):

```typescript
// --- Phase S1: Hard exclusion filters ---
// Transport mode must be compatible (AIR != SEA != ROAD)
const modeCategory = (mode: string | undefined) => {
  if (!mode) return null;
  const m = mode.toUpperCase();
  if (m.includes('AIR')) return 'AIR';
  if (m.includes('SEA') || m.includes('FCL') || m.includes('LCL')) return 'SEA';
  if (m.includes('ROAD') || m.includes('TRUCK')) return 'ROAD';
  return null;
};
const inputModeCategory = modeCategory(transportMode);
```

Then inside the loop, before any scoring:

```typescript
// Hard filter: incompatible transport mode -> skip
if (inputModeCategory) {
  const quotModeCategory = modeCategory(quotation.cargo_type);
  if (quotModeCategory && quotModeCategory !== inputModeCategory) {
    continue; // Strict exclusion
  }
}
```

Note: `quotation_history.cargo_type` contains strings like "SEA_FCL_IMPORT", "AIR_IMPORT", etc. so the category extraction works on this field.

### 2. Backend: `supabase/functions/find-similar-quotations/index.ts`

Add a hard exclusion step between profile loading (step 6) and scoring (step 7).

**Add transport mode categorizer** (after the `buildRoute` helper):

```typescript
function modeCategory(mode: string | null | undefined): string | null {
  const m = n(mode);
  if (!m) return null;
  if (m.includes('air')) return 'AIR';
  if (m.includes('sea') || m.includes('fcl') || m.includes('lcl')) return 'SEA';
  if (m.includes('road') || m.includes('truck')) return 'ROAD';
  return null;
}
```

**Replace the scoring step** (step 7) with exclusion + scoring:

```typescript
const inputMode = modeCategory(input.transport_mode);

const scored = (profiles as HistoricalProfile[])
  .filter((profile) => {
    // Hard filter 1: transport mode must be compatible
    if (inputMode) {
      const profileMode = modeCategory(profile.transport_mode);
      if (profileMode && profileMode !== inputMode) return false;
    }
    // Hard filter 2: weight ratio must be within 3x
    const iw = input.total_weight_kg ?? 0;
    const pw = profile.total_weight_kg ?? 0;
    if (iw > 0 && pw > 0) {
      const ratio = iw / pw;
      if (ratio > 3 || ratio < 0.33) return false;
    }
    return true;
  })
  .map((profile) => ({
    profile,
    score: computeScore(input, profile),
  }))
  .filter((item) => item.score >= 40)
  .sort((a, b) => b.score - a.score)
  .slice(0, limit);
```

### 3. Caller update: `src/components/SimilarQuotationsPanel.tsx`

Pass the `transportMode` prop (if available from parent) to `useSimilarQuotations`. If not currently available in the component props, add it as an optional prop.

## What does NOT change

- No database migration
- No AI prompt changes
- No pricing engine changes
- No auth/RLS changes
- Existing scoring logic stays the same (bonuses remain)
- Threshold of 40 points remains

## Expected Result for aiocargo case

| Before | After |
|--------|-------|
| Bamako 40HC quotations matched (score 50+) | Excluded: SEA mode != AIR mode |
| Transport 3.5M suggested | No suggestion or realistic local rate |
| Breakbulk 25t matched | Excluded: weight ratio 25/3.2 = 7.8x > 3x |

## Risk Assessment

- **Low risk**: exclusion filters only remove obviously wrong matches
- **No false negatives**: if transport mode is unknown (null), filter is skipped (permissive)
- **No false negatives**: if weight is unknown (0), weight filter is skipped
- **Backward compatible**: new `transportMode` param is optional
