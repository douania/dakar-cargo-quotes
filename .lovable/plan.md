

# Phase S5.1 — Micro-patch: falsy-zero fix + log accuracy

## Single file: `supabase/functions/build-case-puzzle/index.ts`

### Patch 1 — Fix `||` to `??` (l.1791)

The `||` operator treats `0` as falsy, so a manual fact with `value_number = 0` would not be protected.

**Before** (l.1791):
```typescript
const existingValue = existingFact.value_text || existingFact.value_number || existingFact.value_json;
```

**After**:
```typescript
const existingValue = existingFact.value_text ?? existingFact.value_number ?? existingFact.value_json;
```

### Patch 2 — Fix misleading log (l.1927)

**Before**:
```typescript
console.log(`[M3.4c] force requested but current fact is manual_input; skipping`);
```

**After**:
```typescript
console.log(`[M3.4c] force requested but current fact is protected manual source (${existingSourceType}); skipping`);
```

### Summary

- 2 line edits, 1 file
- 0 migrations, 0 logic changes
- Fixes: numeric zero protection + log accuracy

