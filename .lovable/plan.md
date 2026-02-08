

# Fix: MIME Body Pre-Processing in build-case-puzzle

## Context

The aiocargo email body contains raw MIME multi-part data (base64-encoded text, HTML, and PNG images). This raw blob is sent directly to the AI, causing hallucinated extractions (39 containers, EXW instead of DAP). The 403 ownership issue has been resolved separately.

## Changes (single file)

**File: `supabase/functions/build-case-puzzle/index.ts`**

### 1. Add `extractPlainTextFromMime(rawBody: string): string` helper

Insert before the main handler. Logic:

```text
1. If no MIME boundary detected (no "boundary=" in body), return rawBody.slice(0, 4000)
2. Split body by boundary
3. For each part:
   a. Parse Content-Type and Content-Transfer-Encoding headers
   b. Skip image/* parts entirely
   c. For text/plain + base64:
      try { decoded = atob(content); } catch { decoded = ""; }
   d. For text/plain + quoted-printable: decode =XX sequences
   e. For text/html: strip tags, decode &amp; entities
4. Return first successful text/plain decode
5. Fallback: return stripped HTML part
6. Final fallback: return rawBody (non-MIME) truncated
7. ALWAYS: return result.slice(0, 4000)   <-- global guard
```

CTO corrections integrated:
- `try/catch` around every `atob()` call (Correction 1)
- `.slice(0, 4000)` on the final return value regardless of parsing path (Correction 2)

### 2. Apply helper at line 668 (threadContext construction)

Replace:
```typescript
`${e.body_text || ""}`
```
With:
```typescript
`${extractPlainTextFromMime(e.body_text || "")}`
```

### 3. Apply helper at line 1168 (extractFactsBasic fallback)

Replace:
```typescript
const body = firstEmail.body_text || "";
```
With:
```typescript
const body = extractPlainTextFromMime(firstEmail.body_text || "");
```

### 4. Purge corrupted facts and reset case

SQL operations after deployment:
- Delete corrupted `quote_facts` rows for case `bfeaa70f-2f98-4e45-b00b-20ec8dc94801`
- Reset `quote_cases.status` to allow re-analysis

## What does NOT change

- No AI prompt modifications
- No schema changes
- No fact storage logic changes (supersede_fact RPC untouched)
- No security/auth changes
- No other edge functions touched

## Expected result after re-analysis

| Fact | Before (hallucinated) | After (correct) |
|---|---|---|
| routing.incoterm | EXW | DAP |
| routing.transport_mode | (maritime implied) | AIR |
| cargo.weight_kg | missing | 3234 |
| cargo.pieces_count | missing | 6 |
| cargo.volume_cbm | missing | 3 |
| cargo.containers | 39 entries / 7000+ units | none (AIR cargo) |

## Validation

1. Deploy the updated function
2. Purge corrupted facts for case `bfeaa70f`
3. Re-trigger "Analyser la demande" on the aiocargo quotation
4. Verify facts match expected values above

