

# Patch P0 + P1 : Gaps non-bloquants UI + Multi-HS CSV

## P0 — UI gaps non-bloquants (CaseView.tsx)

### Problème
Le formulaire de réponse aux gaps n'était rendu que pour `blockingGaps`. Après résolution du dernier gap bloquant, les gaps non-bloquants restants étaient comptés mais inaccessibles.

### Correction
- Extraction de `saveGapAnswer(g, allowAutoPricing: boolean)` comme fonction locale partagée
- `renderGapRow(g, allowAutoPricing)` pour éviter la duplication du JSX
- Nouvelle section "questions ouvertes" (style bleu) visible uniquement quand `blockingGaps.length === 0`
- Auto-pricing désactivé pour les gaps non-bloquants (`allowAutoPricing: false`)

## P1 — Multi-HS CSV (build-case-puzzle/index.ts)

### Problème
Quand plusieurs codes HS valides étaient détectés dans les documents ou emails, le code loggait un warning sans rien injecter.

### Correction
- Helper `normalizeHsCsv()` pour comparaison idempotente basée sur `value_text` brut
- Blocs M3.4b (documents) et M3.4c (emails) : injection CSV trié au lieu de warning
- Guard post-attach : détection multi-HS CSV pour éviter invalidation par la revalidation single-code

## Fichiers modifiés

| Fichier | Action |
|---------|--------|
| `src/pages/CaseView.tsx` | P0 : `saveGapAnswer` extraite, section non-bloquants, import `HelpCircle` |
| `supabase/functions/build-case-puzzle/index.ts` | P1 : `normalizeHsCsv`, multi-HS CSV doc+email, guard post-attach |

## Ce qui ne change pas
- Backend RPC `supersede_fact` : inchangé
- Moteur `quotation-engine` / `run-pricing` : inchangé
- Migration DB : aucune
- RLS : inchangé
