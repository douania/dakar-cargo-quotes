

# P4.A — Thread Timeline Intelligence

## Scope

2 files: 1 new utility, 1 modified component. No backend, no migration, no FROZEN files.

## Changes

### 1. Created `src/features/external-requests/utils/getThreadEmailSignals.ts`

Pure function. Inputs: request, threadEmails, usedEmailIds, suggestedEmailId.

Rules:
- Dates parsed to timestamps via `safeTimestamp()` — never compared as raw strings
- `isAfterSent`: `receivedTs >= sentTs` (both must be valid)
- `isPartnerMatch`: `trim().toLowerCase()` on both sides
- `isMostRecent`: only assigned to the email with highest valid `received_at`; if none valid, no email gets "Récent"
- `isUsed`: email id in usedEmailIds set
- `isSuggested`: email id === suggestedEmailId
- Priority: +40 suggested, +25 afterSent, +20 partnerMatch, -50 used
- Tags: "Suggéré", "Après envoi", "Partenaire", "Déjà analysé", "Récent"
- Fallbacks: empty sender → "expéditeur inconnu", empty subject → "(sans sujet)", long subject → truncated with "…"
- Sorted by priority desc, then date desc (nulls last), limited to top 5

### 2. Modified `src/components/puzzle/ExternalRequestsPanel.tsx`

- Import `getThreadEmailSignals`
- For `sent`/`response_received` requests, compute `emailSignals` after the suggestion block
- Render a compact mini timeline (up to 5 rows) with sender, truncated subject, relative date, and tag badges
- Date fallback: if `receivedAt` is null/invalid → display "Date inconnue" (no `formatDistanceToNow` call)
- Click on a row → `setAnalysisTarget({ requestId, emailId })` — no auto-trigger of analysis
- Selected row highlighted with `bg-accent/50`

## CTO corrections applied

- All date comparisons use parsed timestamps
- `isMostRecent` only when valid date exists
- UI fallback for missing dates
- Safe fallbacks for sender/subject
- No interpretive labels (only descriptive signal tags)

## What does NOT change

- No edge functions, no migrations, no FROZEN files
- `useExternalRequests.ts`, `useExternalRequestFlow.ts` untouched
- `triggerAnalysis` logic unchanged — still manual only
- `analysisTarget` state shape unchanged
- Suggestion logic (P3.B) unchanged
