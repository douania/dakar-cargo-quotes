
# Phase 7.1: Async Quotation Puzzle Engine ✅ IMPLÉMENTÉE

## Résumé

Phase 7.1 transforme le moteur d'analyse `learn-quotation-puzzle` en architecture asynchrone robuste.

## Composants livrés

| Fichier | Description |
|---------|-------------|
| Migration SQL `puzzle_jobs` | Table avec FK, RLS UPDATE, anti-doublon, index |
| `supabase/functions/learn-quotation-puzzle/index.ts` | Modes start/poll/cancel/tick + worker service_role |
| `src/hooks/usePuzzleJob.ts` | Hook React polling + auto-resume stale |
| `src/components/QuotationPuzzleView.tsx` | UI avec progress bar + boutons annuler/reprendre |

## Architecture

```
Client → start → job_id → poll (3s) → progress UI
                    ↓
          Background worker (waitUntil)
                    ↓
          Persiste après chaque phase
                    ↓
          Si stale → tick resume
```

## Correctifs CTO intégrés

- ✅ (A) RLS UPDATE pour cancel côté client
- ✅ (B) Mode tick pour reprise si waitUntil échoue
- ✅ (C) Anti-doublon via unique partiel sur (created_by, thread_id)

## Phase 7.0 non modifiée

- `run-pricing`, `build-case-puzzle` gelés ✓
- Tables `quote_cases`, `quote_facts`, `quote_gaps`, `pricing_runs` intactes ✓
