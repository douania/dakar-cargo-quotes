
# PAD-GAP-1 — Gap bloquant quand la catégorie PAD ne peut pas être résolue

## Statut : DONE (2026-04-10)

### Correctifs appliqués

1. **isMaritime hoisted** (`supabase/functions/run-pricing/index.ts`)
   - `isMaritime` remonté avant le bloc PAD alias pour réutilisation dans la condition gap

2. **Gap bloquant `pricing.pad_category`** (`supabase/functions/run-pricing/index.ts`)
   - Condition : `isMaritime && cargoDescription && cargoWeight > 0 && !padCategory`
   - Idempotent : check `existingGap` avant insert
   - `question_fr` contient la question client pré-rédigée + description reçue + fourchette tarifs
   - `is_blocking = true`

3. **Ligne placeholder PAD TO_CONFIRM** (`supabase/functions/run-pricing/index.ts`)
   - `amount = 0`, `source.type = 'TO_CONFIRM'`, `confidence = 0`
   - Garde-fou anti-duplication : check `hasExistingPadPlaceholder` avant push
   - Non interprétée comme tarif confirmé dans les agrégats

### Adaptation schéma

- `quote_gaps` n'a **pas** de colonnes `context` ni `suggested_question`
- La question client + contexte sont combinés dans `question_fr` (seul champ texte disponible)

### Dette reportée

- Tarif max PAD comme fallback conservateur → voir `docs/DEFERRED_BACKLOG.md` (PAD-GAP-1-DEBT)

