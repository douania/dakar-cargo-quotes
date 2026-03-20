

# P3.C — Fact Confidence Layer v1 (DONE)

## Scope

2 files: 1 new utility, 1 modified component. No backend, no migration, no FROZEN files.

## Changes

### 1. Created `src/features/external-requests/utils/reviewPartnerFact.ts`

Pure function. Inputs: `fact` + `siblingFacts` (same `request_id` and `fact_key`).

Rules (priority order):
1. **conflict** — proposed siblings with different `proposed_value_number` or `currency`
2. **strong** — `confidence >= 0.85`, value present, monetary facts have currency
3. **weak** — `confidence < 0.6`, or value missing, or monetary fact without currency
4. **medium** — fallback

Monetary heuristic: `fact_key` matches `/rate|cost|amount|charge|price|freight/i`.

### 2. Modified `src/components/puzzle/ExternalRequestsPanel.tsx`

- Import `reviewPartnerFact` and `FactReviewLevel`
- For each fact in the rendering loop, compute `review` **only when `validation_status === "proposed"`**
- Display review badge (green/yellow/gray/red) next to validation status badge
- Display 1-2 reasons in `text-[10px]` below the fact line
- Existing badges (Proposé/Validé/Rejeté) and buttons unchanged

## CTO adjustment applied

Review badge + reasons shown **only for proposed facts** — not for validated or rejected facts.

## What does NOT change

- No edge functions, no migrations, no FROZEN files
- `useExternalRequests.ts` untouched
- `validate-partner-fact`, `set-case-fact` untouched
- No auto-validation or auto-rejection
