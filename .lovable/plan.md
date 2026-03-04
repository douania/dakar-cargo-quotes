
## Plan d'exécution — Phase C2/P0.3 — Actions opérateur (Open → Done)

### STATUS: ✅ DONE

### Fichiers créés/modifiés

| Fichier | Action |
|---------|--------|
| `supabase/functions/close-manual-action/index.ts` | Création — edge function append-only |
| `supabase/config.toml` | +1 entrée `verify_jwt = false` |
| `src/pages/CaseView.tsx` | +openActions memo, +closeAction handler, +section Actions UI |

### Fonctionnalités

1. **Edge function `close-manual-action`** : append-only, idempotente, `related_email_id` au niveau row
2. **UI Actions** : section affichant les `manual_action` open avec bouton "Marquer comme fait"
3. **Idempotence** : re-cliquer → `idempotent: true`, 0 doublon
4. **Typage** : `Record<string, unknown> | null` partout, JSX validé

### Audit P0

- P0 #1 (Record générique) : ✅ déjà correct
- P0 #2 (JSX bouton) : ✅ déjà correct
