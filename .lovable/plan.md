

# Phase 15.6 — Correctifs finaux (2 micro-patches)

## Fichier unique : `supabase/functions/run-pricing/index.ts`

### Patch 1 — Aligner split HS sur `/[;,]/` (L172)
Remplacer `rawHs.split(",")` par `rawHs.split(/[;,]/)` pour cohérence avec `build-case-puzzle`.

### Patch 2 — Supprimer `POLICY_GAP_KEYS` inutilisé (L134)
Supprimer la ligne `const POLICY_GAP_KEYS = [...]` (jamais référencée, le `.not()` est hardcodé).

Aucun autre fichier modifié.

