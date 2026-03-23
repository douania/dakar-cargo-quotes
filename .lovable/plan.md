

# P4 — Thread Intelligence Layer (UI-only)

## P4.A — Thread Timeline Intelligence ✅

Pure helper `getThreadEmailSignals.ts` enriching thread emails with contextual tags (Après envoi, Suggéré, Partenaire, Récent) and priority-based sorting. Mini timeline rendered in ExternalRequestsPanel for `sent`/`response_received` requests.

## P4.B — Thread Context Compression ✅

Pure helper `getThreadContextSummary.ts` deriving compact thread stats (emails after send, analyzed count, unanalyzed, last partner email, silence days). Rendered as `text-xs` summary row above the mini timeline.

## P4.C — Thread Interaction Patterns ✅

Pure helper `getThreadInteractionSignals.ts` detecting conversation direction and back-and-forth patterns. Renders strictly descriptive labels: "Dernier message : nous/partenaire", "Aller-retour détecté".

CTO corrections applied:
- Removed `isAwaitingPartner`/`isAwaitingUs` — derive display from `lastMessageFrom` only
- No interpretive wording (no "En attente", no "À examiner")
- No emoji, no amber highlight on interaction line

## What does NOT change across P4

- No edge functions, no migrations, no FROZEN files
- `useExternalRequests.ts`, `useExternalRequestFlow.ts` untouched
- `triggerAnalysis`, `analysisTarget` unchanged
- No new state variables, no buttons, no actions
- No auto-validation, no auto-close
