

# P1.1 — Hardening: error guards + multi-lot limitation doc

## Changes

### 1. `supabase/functions/build-case-puzzle/index.ts` — Error handling in P1 block (L3696-3823)

Apply the CTO-validated error hierarchy:

**L3696 — freightGaps query**: Add `error` destructuring. If error, warn + skip entire P1 block.
```typescript
const { data: freightGaps, error: freightGapsErr } = await serviceClient...
if (freightGapsErr) {
  console.warn("[P1-AutoEQ] Failed to read freight gaps:", freightGapsErr.message);
} else if (freightGaps && freightGaps.length > 0) {
  // ... entire existing block moves inside this else-if
}
```

**L3706 — requestLines query**: Add `error` destructuring. If error, warn + skip entire P1 block (abort, don't fall into mono-lot fallback).
```typescript
const { data: requestLines, error: requestLinesErr } = await serviceClient...
if (requestLinesErr) {
  console.warn("[P1-AutoEQ] Failed to read request lines:", requestLinesErr.message);
  // abort P1 — do NOT fall through to mono-lot fallback
} else {
  // existing target-building logic
}
```

**L3729 — relevantFacts query**: Warn only, continue with empty facts (acceptable — only affects purpose_detail text).
```typescript
const { data: relevantFacts, error: relevantFactsErr } = await serviceClient...
if (relevantFactsErr) console.warn("[P1-AutoEQ] Failed to read facts:", relevantFactsErr.message);
```

**L3747/3757 — existence checks (existNull/existLot)**: If error, warn + `continue` (skip this target, never insert).
```typescript
const { data: existNull, error: existNullErr } = await serviceClient...
if (existNullErr) {
  console.warn("[P1-AutoEQ] Existence check failed (null lot):", existNullErr.message);
  continue; // skip target — do not risk duplicate insert
}
```
Same pattern for `existLot`.

**L3805 — timeline insert**: Add error read, warn only (already acceptable).
```typescript
const { error: timelineErr } = await serviceClient.from("case_timeline_events").insert({...});
if (timelineErr) console.warn("[P1-AutoEQ] Timeline insert failed:", timelineErr.message);
```

### 2. `docs/MASTER_CONTEXT.md` — Add multi-lot limitation

Under the existing "Limitation documentée" section (L213-216), append:

```
En multi-lot mixte (un lot avec gap fret, un autre sans), P1 peut créer des demandes pour tous les lots.
Le filtrage lot-level nécessiterait une extension du schéma quote_gaps (hors scope P1).
```

## Error hierarchy summary

| Query | On error |
|-------|----------|
| freightGaps | warn + skip block |
| requestLines | warn + skip block |
| relevantFacts | warn + continue (empty facts) |
| existNull/existLot | warn + continue target (skip insert) |
| insert request | already handled (warn + continue) |
| timeline | warn only |

## Scope

| File | Change |
|------|--------|
| `supabase/functions/build-case-puzzle/index.ts` | Add error reads with correct guard levels |
| `docs/MASTER_CONTEXT.md` | Document multi-lot over-creation limitation |

