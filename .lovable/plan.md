

# Fix 4 — `newFactId` scoping bug in `validate-partner-fact`

## Problem

`newFactId` is declared with `const` inside the `if (action === "validate")` block (line 74), but referenced on line 154 outside that block scope. This causes a ReferenceError at runtime when `action === "validate"`.

## Fix

Hoist a `let` variable before the `if` block, assign inside:

```typescript
let injectedFactId: string | null = null;

if (action === "validate") {
  const { data: newFactId, error: rpcErr } = await serviceClient.rpc("supersede_fact", { ... });
  // ...
  injectedFactId = newFactId;
  // update uses injectedFactId
  await serviceClient.from("external_quote_response_facts").update({
    ...
    injected_fact_id: injectedFactId,
  }).eq("id", fact_id);
}
```

Then line 154 becomes:
```typescript
injected_fact_id: injectedFactId,
```

**Single file change**: `supabase/functions/validate-partner-fact/index.ts` — lines 69-154.

