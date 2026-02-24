

# Phase C3 — Convergence "Traiter" -> case direct (DONE)

## Fichiers modifiés

1. `src/components/QuotationThreadCard.tsx` (2 lignes)
2. `src/pages/Dashboard.tsx` (import + handleProcess refactoré)

## Résumé des changements

### QuotationThreadCard.tsx
- Signature `onProcess`: `(rootEmailId: string)` → `(rootEmailId: string, threadRef: string | null)`
- onClick: `void onProcess(thread.rootEmailId, thread.threadRef)` (async-safe)

### Dashboard.tsx
- Import `useCallback` ajouté
- `isProcessing` state anti double-clic
- `handleProcess` async avec:
  - fallback legacy si `threadRef` absent
  - `ensure-quote-case({ thread_id: threadRef })` idempotent
  - garde `factsCount === 0` avant `build-case-puzzle`
  - navigation `/case/:caseId`
  - fallback legacy + toast warning si erreur
  - `finally` reset `isProcessing`

## Ce qui n'a PAS changé
- Logique C2.1 (pending/search anti-fantôme)
- emailService.ts pipeline C1
- Backend functions
- Aucune migration DB
- Aucun composant FROZEN
