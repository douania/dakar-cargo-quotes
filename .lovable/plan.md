

## Fix P0.3 — `actor_type` constraint violation

### Problème identifié

L'edge function `close-manual-action` insère avec `actor_type: "human"`, mais la contrainte CHECK sur `case_timeline_events.actor_type` n'autorise que : `system`, `user`, `ai`, `operator`.

**Erreur exacte** (logs) :
```
new row for relation "case_timeline_events" violates check constraint "case_timeline_events_actor_type_check"
```

### Fix (1 ligne)

**Fichier** : `supabase/functions/close-manual-action/index.ts`

Remplacer `actor_type: "human"` par `actor_type: "operator"` dans l'insert (ligne 73).

C'est le seul changement nécessaire. Le reste du code (UI, idempotence, typing) est correct.

### Validation après fix

1. Re-tester `close-manual-action` sur le case `18accd26...` → devrait retourner `{ ok: true, idempotent: false }`
2. Re-tester → `{ ok: true, idempotent: true }`
3. Vérifier en DB que l'event `done` est bien inséré

