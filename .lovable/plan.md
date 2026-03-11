

# Micro-fix S1.2 — Two corrections before merge

## Fix 1: `suggest-decisions/index.ts` line 321
The comment `// 3. OWNERSHIP CHECK (MINIMAL: created_by = auth.uid() ONLY)` is now false — no ownership check exists, and line 335 already documents the shared workspace model.

**Change**: Replace line 321 with:
```typescript
    // 3. LOAD CASE
```

Simple rename of the step label. No logic change.

## Fix 2: `docs/SECURITY_CONTRACT.md` — document observability limitation

Add one line to the Observability section noting the known granularity trade-off:

```
Note: `generate-quotation-version` logs all auth failures as `AUTH_INVALID_JWT` regardless of whether the cause is a missing header or an invalid token. This is a known trade-off accepted in S1.2 to avoid re-implementing inline auth.
```

## Files modified
1. `supabase/functions/suggest-decisions/index.ts` — 1 comment line
2. `docs/SECURITY_CONTRACT.md` — 1 line addition

## What does not change
- Zero logic change
- Zero FROZEN module touched
- Zero migration / RLS / UI change

