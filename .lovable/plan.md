

# Phase S5 — Manual Source Protection Completion

## STRUCTURAL_PATCH_ALLOWED Justification (FROZEN zone: `build-case-puzzle`)

- **Business problem**: Multiple automated paths (AI extraction loop, document_regex, email_body, hs_resolution, force_articles_detail) can silently supersede human-entered facts
- **Why structural**: adds missing guards before existing `supersede_fact` calls — no logic restructure
- **Why localized**: each patch is a 3-5 line guard insertion at a specific injection point
- **Why not a refactor**: no control flow change, no function extraction, no reordering
- **Risks**: low — guards only skip injection when source is manual; automated-to-automated supersession unchanged
- **Tests**: inject manual HS via set-case-fact → rebuild → manual HS preserved; inject manual articles_detail → force rebuild → preserved if operator source

---

## Single file: `supabase/functions/build-case-puzzle/index.ts`

### Bug 1 — Main AI extraction loop (l.1777-1808)

The loop loads existing facts **without `source_type`** (l.1780), then supersedes if value differs. A manual fact gets overwritten.

**Fix**: Add `source_type` to the SELECT and guard before supersede.

```typescript
// l.1780: add source_type to select
.select("id, value_text, value_number, value_json, source_type")

// l.1788: after existingFact check, before value comparison, add guard:
if (existingFact) {
  if (MANUAL_PROTECTED_SOURCES.has(existingFact.source_type ?? '')) {
    console.log(`[AI extract] Skipping ${fact.key}: protected manual source (${existingFact.source_type})`);
    factsSkipped++;
    continue;
  }
  const existingValue = ...  // rest unchanged
```

### Bug 2 — force_articles_detail guard (l.1917)

Only checks `manual_input`, misses legacy `operator`.

**Fix**: Replace l.1917:
```typescript
// Before:
if (existingSourceType === "manual_input") {
// After:
if (MANUAL_PROTECTED_SOURCES.has(existingSourceType ?? '')) {
```

### Bug 3 — cargo.articles_detail from case_documents (l.2112-2126)

Calls `supersede_fact` without checking if existing fact is manual. Note: the `proceedWithExtraction` guard at l.1910-1925 covers the `force_articles_detail` path, but when `!hasExisting` is false and `!force_articles_detail`, extraction is skipped (l.1923-1924). However, when `proceedWithExtraction` is true and not forced, it means `!hasExisting` — so no existing manual fact to protect.

**Verdict**: No guard needed here — if we reach l.2112, either there was no existing fact, or `force_articles_detail` was true and the manual guard at l.1917 (Bug 2 fix) already ran. **No change.**

### Bug 4 — HS from case_documents doc-regex (l.2206-2258)

`source_type` is already loaded at l.2160. No manual guard before supersede.

**Fix**: After idempotency check at l.2208, add manual source guard:
```typescript
if (hsDigitsDoc === uniqueCodes[0]) {
  console.log("[HS doc-regex] HS identical to existing, skip supersede");
} else if (MANUAL_PROTECTED_SOURCES.has(hsFactDoc?.source_type ?? '')) {
  console.log("[HS doc-regex] Existing HS is manual source, skip supersede");
} else {
  // existing supersede_fact call
```

Same pattern for multi-HS branch at l.2241-2258:
```typescript
if (csvValue === existingNormalized) {
  console.log("[HS doc-regex] Multi-HS CSV identical to existing, skip");
} else if (MANUAL_PROTECTED_SOURCES.has(hsFactDoc?.source_type ?? '')) {
  console.log("[HS doc-regex] Existing HS is manual source, skip multi-HS supersede");
} else {
  // existing supersede_fact call
```

### Bug 5 — HS from emails email-regex (l.2331-2390)

`source_type` loaded at l.2277. Same pattern as Bug 4.

**Fix**: Add manual guard in both single-HS (l.2333) and multi-HS (l.2366) branches:
```typescript
// Single-HS:
} else if (MANUAL_PROTECTED_SOURCES.has(hsFactEmail?.source_type ?? '')) {
  console.log("[HS email-regex] Existing HS is manual source, skip supersede");
} else {

// Multi-HS:
} else if (MANUAL_PROTECTED_SOURCES.has(hsFactEmail?.source_type ?? '')) {
  console.log("[HS email-regex] Existing HS is manual source, skip multi-HS supersede");
} else {
```

### Bug 6 — HS post-attachment validation (l.2848-2875)

`source_type` loaded at l.2821. Two risks:
- **l.2854**: supersedes with `hs_resolution` without manual guard
- **l.2872**: deactivates (`is_current: false`) without manual guard

**Fix**: Add guard before the re-validation block at l.2848:
```typescript
if (digitsOnly.length !== 10 || !(await isExactHsMatch(serviceClient, digitsOnly))) {
  // S5: protect manual HS from automated re-validation
  if (MANUAL_PROTECTED_SOURCES.has(hsFactRow.source_type ?? '')) {
    console.log(`[HS Post-Attach] Manual HS preserved, skipping re-validation (source=${hsFactRow.source_type})`);
  } else {
    const hsResult = await resolveSenegalHsCode(serviceClient, rawHsValue);
    // ... rest of existing logic unchanged
  }
}
```
This protects both the supersede and the deactivation paths.

---

## Summary

| # | Zone | Type of fix | Lines affected |
|---|------|------------|----------------|
| 1 | Main AI extraction loop | Add `source_type` to SELECT + guard | ~l.1780, 1788 |
| 2 | force_articles_detail | Use `MANUAL_PROTECTED_SOURCES` | l.1917 |
| 3 | cargo.articles_detail from docs | No change needed | — |
| 4 | HS doc-regex (single + multi) | Add manual guard | ~l.2208, 2241 |
| 5 | HS email-regex (single + multi) | Add manual guard | ~l.2333, 2366 |
| 6 | HS post-attach validation | Add manual guard wrapping both supersede + deactivate | ~l.2848 |

**Total**: 6 guard insertions in 1 file, 0 migrations, 0 other files.

## What does NOT change

- `set-case-fact` — already correct
- `supersede_fact` RPC — no schema change (protection stays applicative)
- DB / RLS / migrations — none
- Pricing engine — not touched
- FSM / status transitions — not touched
- `injectAttachmentFacts` — already correct from S4
- Assumption engine — already correct from S4
- Documentation — STATUS_REGISTRY.md and MASTER_CONTEXT.md unchanged (S5 is a data-integrity hardening, not a workflow change)

