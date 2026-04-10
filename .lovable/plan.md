
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

---

# ACTION-SYNC-1 — Synchroniser le bloc Actions avec les gaps réellement ouverts

## Statut : DONE (2026-04-10)

### Diagnostic

Le bloc "Actions" dans CaseView lisait `case_timeline_events` (event_type `manual_action`) et filtrait uniquement par `event_data.status === "open"`, sans vérifier si les gaps référencés dans `requested_gap_keys` étaient encore ouverts dans `quote_gaps`.

Résultat : une action pour `routing.destination_port` restait affichée alors que ce gap était déjà `resolved`.

### Correctif

**Fichier** : `src/pages/CaseView.tsx` — `openActions` useMemo

- Ajout d'un cross-reference avec le tableau `gaps` (qui ne contient que les gaps `status = 'open'`)
- Si une action timeline référence des `requested_gap_keys`, elle n'est affichée que si **au moins un** de ces gap keys est encore ouvert
- Si aucun gap key n'est référencé, l'action reste visible (comportement conservateur)
- Pas de blacklist codée en dur sur un gap spécifique

### Fichiers impactés

| Fichier | Changement |
|---------|-----------|
| `src/pages/CaseView.tsx` | `openActions` memo croisé avec gaps ouverts (~20 lignes) |
| `.lovable/plan.md` | Documentation |

### Ce que ce lot ne fait PAS

- Pas de migration
- Pas de modification backend
- Pas de création d'action timeline pour `pricing.pad_category`
- Pas de refactor global
