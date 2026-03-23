

# P4.C — Thread Interaction Patterns (Revised)

## Scope

2 files: 1 new utility, 1 modified component. No backend, no migration, no FROZEN files.

## CTO corrections applied

- **Removed** `isAwaitingPartner` and `isAwaitingUs` from helper output — derive display from `lastMessageFrom` only
- **Wording** strictly descriptive: "Dernier message : nous/partenaire", "Aller-retour détecté" — no interpretive labels like "En attente" or "À examiner"

## Changes

### 1. Create `src/features/external-requests/utils/getThreadInteractionSignals.ts`

Pure function. Inputs:
- `request`: `{ partner_email: string | null, sent_at: string | null }`
- `threadEmails`: `{ id, from_address: string, received_at: string | null }[]`

Output:
```typescript
interface ThreadInteractionSignals {
  lastMessageFrom: "partner" | "us" | "unknown";
  partnerMessagesAfterSend: number;
  ourMessagesAfterSend: number;
  hasBackAndForth: boolean;
}
```

Rules:
- `safeTimestamp` for date parsing, guard `from_address` with `|| ""`
- Filter to emails with valid `received_at >= sent_at`
- Sort post-send emails by `received_at` ascending
- `isPartner`: `fromNorm === partnerNorm` (trim + lowercase both sides)
- Everything else = `"us"`
- `hasBackAndForth`: at least one direction change in sorted sequence
- `lastMessageFrom`: direction of the last post-send email, or `"unknown"` if none

No `isAwaitingPartner`, no `isAwaitingUs`.

### 2. Modify `src/components/puzzle/ExternalRequestsPanel.tsx`

**Import** `getThreadInteractionSignals`.

**Compute** after `threadContext` (inside the `sent`/`response_received` block):
```typescript
const interactionSignals = getThreadInteractionSignals(req, threadEmails);
```

**Render** a `text-[10px] text-muted-foreground` line between P4.B summary and P4.A timeline. Only when `interactionSignals.partnerMessagesAfterSend + interactionSignals.ourMessagesAfterSend > 0`:

- `lastMessageFrom === "us"` → `"Dernier message : nous"`
- `lastMessageFrom === "partner"` → `"Dernier message : partenaire"`
- `hasBackAndForth` → append `" · Aller-retour détecté"`

No emoji, no amber highlight, no interpretive phrasing.

## What does NOT change

- No edge functions, no migrations, no FROZEN files
- `useExternalRequests.ts`, `useExternalRequestFlow.ts` untouched
- `triggerAnalysis`, `analysisTarget` unchanged
- P4.A timeline and P4.B summary unchanged
- No new state variables, no buttons, no actions

## File summary

| File | Action |
|------|--------|
| `src/features/external-requests/utils/getThreadInteractionSignals.ts` | Create — pure interaction detection |
| `src/components/puzzle/ExternalRequestsPanel.tsx` | Import + compute + render interaction line |

