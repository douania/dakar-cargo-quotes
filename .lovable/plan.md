

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

## P4.D — Thread Consolidation ✅

Pure helper `getThreadConsolidationGroups.ts` grouping thread emails by direction (partner/us) + normalized subject into readable blocks. Labels use informative format: `Partenaire · {subjectShort}` / `Nous · {subjectShort}`. Top 2 emails per group shown with `+X autre(s) email(s)` overflow. Groups sorted by suggested-first then recency. P4.A timeline preserved below for traceability.

## P4.E — Cross-layer Alignment ✅

Visual deduplication across P4 layers when consolidation groups exist:
- P4.A timeline: hides redundant tags (Suggéré, Déjà analysé, Partenaire) — keeps Après envoi, Récent
- P4.B summary: hides "X déjà analysé(s)" count — keeps email-after-send and unanalyzed counts
- P4.C: unchanged
- No helper modifications — deduplication is purely at render level in ExternalRequestsPanel

## P4.F — Progressive Disclosure ✅

Local UI state `expandedThreadIds: Set<string>` per request. Timeline P4.A hidden by default, accessible via "Voir le détail" / "Masquer le détail" toggle button. State updates use immutable Set cloning. Button hidden when focus-expanded (P4.G).

## P4.G — Operator Focus Mode ✅

Uses existing `analysisTarget` as cross-layer visual focus. Derives `activeEmailId` per request. Dual highlight hierarchy: active (strong) > suggested (light) > normal. Auto-expands timeline for focused request via pure derivation (`isManuallyExpanded || isFocusExpanded`) — no useEffect, no state mutation. Muted "Email sélectionné" label when active.

## What does NOT change across P4

- No edge functions, no migrations, no FROZEN files
- `useExternalRequests.ts`, `useExternalRequestFlow.ts` untouched (except PRICING_CRITICAL_KEYS extraction)
- `triggerAnalysis`, `analysisTarget` shape unchanged
- No auto-validation, no auto-close
- Helpers P4.A/B/C/D are pure functions with no I/O

---

# M26b — Edge Functions Cleanup

## Supprimées (dead code confirmé)

| Fonction | Raison |
|----------|--------|
| `generate-case-outputs` | Remplacée par `generate-quotation-version` + `create-quotation-email-draft` |
| `learn-from-contact` | Zéro appelant frontend/server |
| `get-active-exchange-rate` | Remplacée par query directe `exchange_rates` |
| `calculate-duties` | Logique intégrée dans `quotation-engine` |
| `suggest-regime` | Logique intégrée dans `suggest-decisions` |

## Dormantes (admin/maintenance — conservées)

| Fonction | Usage | Statut |
|----------|-------|--------|
| `backfill-case-documents` | Script one-shot de réparation documentaire | Dormant — garder |
| `reclassify-threads` | Outil admin de maintenance du threading | Dormant — garder |
| `find-similar-quotations` | Recherche de cotations similaires (pas d'appelant UI actuel) | Dormant — garder |
| `import-historical-quotation` | Import admin CLI/script de cotations historiques | Dormant — garder |

---

# Règle de gouvernance — Sujets différés

Tout sujet explicitement différé, laissé dormant, accepté comme dette, ou déplacé à une phase ultérieure doit être ajouté ou mis à jour dans `docs/DEFERRED_BACKLOG.md` immédiatement.
