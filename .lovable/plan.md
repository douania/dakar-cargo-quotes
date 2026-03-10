

# PATCH V2-A.1 — 4 correctifs audit

## 1. Fix prompt contradiction rule (`analyze-thread-event`)

**File**: `supabase/functions/analyze-thread-event/index.ts`, line 67

**Current** (wrong):
```
- Si des dimensions (LxlxH) ET un conteneur (20ft/40ft) sont mentionnés ensemble, signaler "LCL_WITH_CONTAINER"
```

**Fix**: Replace with:
```
- Si un signal LCL/groupage ET un conteneur (20ft/40ft) sont mentionnés ensemble, signaler "LCL_WITH_CONTAINER"
```

This prevents false contradiction flags on normal FCL requests that include dimensions.

---

## 2. Fix `parseDimensions` implicit cm fallback (`analyze-case-coherence`)

**File**: `supabase/functions/analyze-case-coherence/index.ts`, line 57

**Current** (wrong):
```typescript
const unit = (match[4] || "cm").toLowerCase();
```

**Fix**:
```typescript
if (!match[4]) return null; // No unit = ambiguous, skip
const unit = match[4].toLowerCase();
```

Aligns with the deterministic rule: unit must be explicit (mm/cm/m).

---

## 3. Fix confidence read path in `CaseUnderstandingPanel`

**File**: `src/components/case/CaseUnderstandingPanel.tsx`, line 131

**Current**: Reads `intent["confidence"]` only.

The confidence is stored at `event_data.confidence` (line 247 of analyze-thread-event), not inside `event_data.intent.confidence`.

**Fix**: Read from `ed["confidence"]` first, fallback to `intent["confidence"]`:
```typescript
confidence: typeof ed["confidence"] === "number"
  ? ed["confidence"]
  : (typeof intent["confidence"] === "number" ? intent["confidence"] : null),
```

---

## 4. Add missing `config.toml` entry

The function `analyze-case-coherence` is missing from `supabase/config.toml`. Add:

```toml
[functions.analyze-case-coherence]
verify_jwt = false
```

---

## Summary

| # | File | Fix |
|---|------|-----|
| 1 | `analyze-thread-event/index.ts` | Prompt: dimensions+container -> LCL+container |
| 2 | `analyze-case-coherence/index.ts` | Remove implicit cm fallback |
| 3 | `CaseUnderstandingPanel.tsx` | Read confidence from `ed["confidence"]` |
| 4 | `config.toml` | Add missing function entry |

All surgical, no refactor, no new files, no migration.

