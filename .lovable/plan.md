

# CTO Post-Audit Correction — 2 disabled conditions in ExternalRequestsPanel.tsx

## Context

4 of 5 patches from the hardening batch are validated. The only remaining correction is adjusting the `disabled` logic on two buttons in `ExternalRequestsPanel.tsx` from per-item to global lock.

`build-case-puzzle/index.ts` already has the corrected keys (`other.border_fee_expected`, `pricing.vat_rate`) from the previous batch — CTO says do not touch it in this batch. Confirmed: no change needed.

## Single file change

**File**: `src/components/puzzle/ExternalRequestsPanel.tsx`

### Edit 1 — Send button disabled (L326)

Current:
```typescript
sendingId === req.id ||
!(editingEmail[req.id] ?? req.partner_email)
```

Replace with:
```typescript
sendingId !== null ||
!(editingEmail[req.id] ?? req.partner_email)
```

### Edit 2 — Validate button disabled (L483)

Current:
```typescript
disabled={validatingFactId === fact.id}
```

Replace with:
```typescript
disabled={validatingFactId !== null}
```

## What does NOT change

- `analyze-partner-response/index.ts` — already correct
- `_shared/cors.ts` — already correct
- `useExternalRequests.ts` — already correct
- `build-case-puzzle/index.ts` — FROZEN, not touched
- No new files, no migrations

## Post-patch verification

- One send at a time: all draft send buttons disabled while any send is in progress
- One validation at a time: all validate buttons disabled while any validation is in progress
- Spinner still shows on the active item only (unchanged)
- Reset guaranteed via `finally` (unchanged)

