

# P2.1 — Wire existing pieces (Preflight PASSED)

## Preflight Results

| Check | Result |
|-------|--------|
| `send-external-quote-request/index.ts` exists | YES (204 lines, complete) |
| `useExternalRequestFlow.ts` exists | YES (96 lines, complete) |
| Hook exports `sendRequest`, `validateFactAndRerun`, `isPricingRerunning` | YES |
| `config.toml` entry for `send-external-quote-request` | MISSING (would 403) |
| Hook imported anywhere | NO (zero consumers) |

Verdict: **Plan Lovable confirmed — wiring only, 3 files.**

---

## Changes

### 1. `supabase/config.toml` — Add function entry

Add after existing entries:
```toml
[functions.send-external-quote-request]
verify_jwt = false
```

### 2. `src/components/puzzle/ExternalRequestsPanel.tsx` — Wire flow hook

**Import** `useExternalRequestFlow` (line 1 area).

**Initialize hook** after `useExternalRequests` (line 86 area):
```typescript
const { sendRequest, validateFactAndRerun, isPricingRerunning } = useExternalRequestFlow(caseId);
```

**Add state** for inline partner email editing on draft requests:
```typescript
const [editingEmail, setEditingEmail] = useState<Record<string, string>>({});
```

**Replace draft "Marquer envoyée" button** (lines 301-311) with proper send flow:
- Inline `partner_email` input (editable, pre-filled from `req.partner_email`)
- Save email to DB before sending (direct Supabase update if changed)
- "Envoyer" button calls `sendRequest.mutate(req.id)` instead of `markAsSent.mutate(req.id)`
- Disable if partner email is empty
- Show spinner during send

**Replace fact validate button** (line 430):
- Change `validateFact.mutate(fact.id)` to `validateFactAndRerun.mutate({ factId: fact.id, factKey: fact.fact_key })`
- This auto-triggers `run-pricing` for pricing-critical facts
- Keep `rejectFact.mutate(fact.id)` unchanged

**Show pricing rerun indicator** when `isPricingRerunning` is true (small badge near panel header).

### 3. Deploy edge function

The `send-external-quote-request` function already exists but needs the `config.toml` entry to be callable. Deployment happens automatically.

## What does NOT change

- `send-external-quote-request/index.ts` — already complete
- `useExternalRequestFlow.ts` — already complete
- `useExternalRequests.ts` — kept as data layer
- `analyze-partner-response`, `validate-partner-fact`, `run-pricing` — untouched
- No new tables, migrations, or schema changes

## File summary

| File | Action |
|------|--------|
| `supabase/config.toml` | Add 2-line function entry |
| `src/components/puzzle/ExternalRequestsPanel.tsx` | Import hook, wire send + validate+rerun |

