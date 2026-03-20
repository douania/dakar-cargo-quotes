

# P3.D — Assisted Close-Loop v1

## Scope

2 files: 1 new utility, 1 modified component. No backend, no migration, no FROZEN files.

## Changes

### 1. Create `src/features/external-requests/utils/getRequestCloseLoopState.ts`

Pure function. Inputs:
- `requestStatus`: string
- `requestFacts`: array of `{ fact_key, validation_status }[]`
- `isPricingRerunning`: boolean

Local constant: `PRICING_CRITICAL_KEYS` set (same 4 keys as `useExternalRequestFlow.ts`).

Output type:
```typescript
type RequestCloseLoopState = "awaiting_validation" | "pricing_rerunning" | "ready_to_close" | "already_closed" | "in_progress";
type RequestCloseLoopInfo = { state: RequestCloseLoopState; label: string; reasons: string[]; remainingProposedCount: number; };
```

Rules (priority order):
1. `requestStatus === "closed"` → `already_closed`, label `"Clôturée"`
2. `remainingProposedCount > 0` → `awaiting_validation`, label `"Encore X fait(s)"`, reason: `"X fait(s) proposé(s) restant(s)"`
3. `isPricingRerunning` AND at least one validated fact with pricing-critical key → `pricing_rerunning`, label `"Pricing relancé"`, reason: `"Recalcul en cours après validation"`
4. No proposed facts AND at least one validated fact → `ready_to_close`, label `"Prête à clôturer"`, reasons: `"Plus aucun fait en attente"`, `"Tous les faits traités"`
5. Fallback → `in_progress`, label `"En cours"`

### 2. Modify `src/components/puzzle/ExternalRequestsPanel.tsx`

**Import** `getRequestCloseLoopState`.

**Inside `requests.map()`** (after line 277, suggestion computation) — compute for every request:
```typescript
const closeLoop = getRequestCloseLoopState(req.status, reqFacts, isPricingRerunning);
```

**Add close-loop badge and reasons** inside the expanded section, between the existing action buttons zone (line ~458) and the Responses section (line ~460). Specifically after the closing `</div>` of the actions div and before the `{reqResponses.length > 0 && (` block:

- A small row with:
  - Badge colored by state: `already_closed` muted, `awaiting_validation` orange, `pricing_rerunning` blue with spinner, `ready_to_close` green, `in_progress` gray
  - 1-2 reasons in `text-[10px] text-muted-foreground`
- Skip rendering when state is `in_progress` (no useful signal to show)

**Enhance Clôturer button** (line 448-457): when `closeLoop.state === "ready_to_close"`, change variant from `ghost` to `outline` and add a subtle green border class. No change to `onClick` or logic.

## What does NOT change

- No edge functions, no migrations, no FROZEN files
- `useExternalRequests.ts` untouched
- `useExternalRequestFlow.ts` untouched
- `validate-partner-fact`, `set-case-fact`, `build-case-puzzle` untouched
- `closeRequest` logic unchanged — no auto-close
- No new FSM states

## File summary

| File | Action |
|------|--------|
| `src/features/external-requests/utils/getRequestCloseLoopState.ts` | Create — pure close-loop state helper |
| `src/components/puzzle/ExternalRequestsPanel.tsx` | Import + compute close-loop + badge + enhanced close button |

