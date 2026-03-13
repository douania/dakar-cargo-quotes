

# P3b.1 Correctifs — Regime Check + Service Package Guard

## Diagnostic

Two gaps identified by CTO audit in the multi-lot branch of `run-pricing`:

1. **Missing `REGIME_REQUIRED_FOR_EXEMPTION` check per lot** — The mono-lot path (lines 760-816) checks if `exemption_title` exists without `regime_code` and blocks. The multi-lot branch (lines 319-342) checks HS, freight, and cargo value but NOT regime coherence. A lot with an exemption title but no regime code would slip through.

2. **Missing guard when `resolveServicePackageForLot()` returns `undefined`** — If `request_type_hint` is present but not recognized (e.g. a future type not yet mapped), `servicePackage` stays `undefined`, and the lot proceeds with an ambiguous scope. This should block with `LOT_SERVICE_PACKAGE_UNRESOLVED`.

## Changes

### File: `supabase/functions/run-pricing/index.ts`

**Fix 1 — Add `LOT_SERVICE_PACKAGE_UNRESOLVED` blocker (after line 309, before line 311)**

After `resolveServicePackageForLot()` is called, if it returns `undefined`, push a blocker immediately:

```typescript
if (!lotServicePackage) {
  lotBlockers.push("LOT_SERVICE_PACKAGE_UNRESOLVED");
}
```

This goes right before the existing `if (lotServicePackage)` block at line 311.

**Fix 2 — Add per-lot regime coherence check (after line 341, inside the per-lot loop)**

After the cargo value check (line 341), add the regime check using the merged facts for the lot:

```typescript
// Regime check for lots with duties scope
if (lotScopeWantsDuties) {
  const lotFactMap = new Map(mergedFacts.map((f: any) => [f.fact_key, f]));
  const hasExemptionTitle = !!lotFactMap.get("regulatory.exemption_title")?.value_text;
  const hasRegimeCode = !!lotFactMap.get("customs.regime_code")?.value_text;
  if (hasExemptionTitle && !hasRegimeCode) {
    lotBlockers.push("REGIME_REQUIRED_FOR_EXEMPTION");
  }
}
```

This mirrors the mono-lot check at lines 773-776 but operates on per-lot merged facts instead of global facts.

### No other files changed

- `PricingResultPanel.tsx` — no change needed, `blocked_lots[].blockers` already rendered
- No migration, no new function, `quotation-engine` untouched

## Summary

Two surgical additions inside the existing per-lot coherence loop (~10 lines total). Both blockers surface in `blocked_lots[]` via the existing aggregation at line 382, so UI and audit trail work without further changes.

