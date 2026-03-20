

# P3.D — Assisted Close-Loop v1 (DONE)

## Scope

2 files: 1 new utility, 1 modified component. No backend, no migration, no FROZEN files.

## Changes

### 1. Created `src/features/external-requests/utils/getRequestCloseLoopState.ts`

Pure function. Inputs: `requestStatus`, `requestFacts[]`, `isPricingRerunning`.

Rules (priority order):
1. **already_closed** — `requestStatus === "closed"`
2. **awaiting_validation** — proposed facts remain, label shows count
3. **pricing_rerunning** — `isPricingRerunning` AND validated pricing-critical fact exists
4. **ready_to_close** — no proposed facts, at least one validated
5. **in_progress** — fallback (hidden in UI)

Pricing-critical keys: same 4 as `useExternalRequestFlow.ts`.

### 2. Modified `src/components/puzzle/ExternalRequestsPanel.tsx`

- Import `getRequestCloseLoopState`
- Compute `closeLoop` for every request in the map loop
- Close-loop badge rendered between actions div and Responses section, hidden when `in_progress`
- Badge colors: muted (closed), orange (awaiting), blue+spinner (pricing), green (ready)
- 1-2 reasons in `text-[10px]` beside badge
- Clôturer button: `variant="outline"` with green border when `ready_to_close`, unchanged `onClick`

## What does NOT change

- No edge functions, no migrations, no FROZEN files
- `useExternalRequests.ts` untouched
- `useExternalRequestFlow.ts` untouched
- `closeRequest` logic unchanged — no auto-close
- No new FSM states
