

# P0 — Replace `return new Response(...)` in `processAttachmentsLoop()`

## Problem

4 occurrences of `return new Response(...)` inside `processAttachmentsLoop()` break the function's `Promise<any[]>` contract. They exit the entire loop prematurely on AI 402/429 errors instead of continuing to the next attachment.

## Fix — 4 surgical replacements

Each of the 4 blocks follows the same pattern. The claim release is already correct — only the `return new Response(...)` line changes.

### Block 1 — Excel AI 402 (L1380-1383)

Replace:
```typescript
return new Response(
  JSON.stringify({ success: false, error: 'Crédits AI insuffisants.' }),
  { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
);
```
With:
```typescript
results.push({ attachment_id: attachment.id, filename: attachment.filename, success: false, skipped: true, error_code: 'AI_QUOTA_402', error_message: 'Crédits AI insuffisants.' });
continue;
```

### Block 2 — Excel AI 429 (L1390-1393)

Same pattern, with `error_code: 'AI_RATE_LIMIT_429'` and `error_message: 'Limite de requêtes atteinte, réessayez plus tard.'`

### Block 3 — Doc AI 402 (L1501-1504)

Same as Block 1.

### Block 4 — Doc AI 429 (L1511-1514)

Same as Block 2.

## What changes

- 4 `return new Response(...)` → `results.push({...}); continue;`
- No signature change, no new types, no handler change

## What does not change

Everything else in the file. No other files touched.

