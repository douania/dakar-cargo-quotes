

## Diagnostic

Le code est déjà **quasi-correct**. Deux micro-fixes TS à appliquer dans `CaseView.tsx` :

### Problème 1 — Dot notation sur `Record<string, unknown>` (lignes 692, 698)

- **Ligne 692** : `ed?.dedupe_key` → TS n'autorise pas l'accès par dot sur `Record<string, unknown>`. Fix : `ed?.["dedupe_key"]`
- **Ligne 698** : `?.status` → même problème. Fix : `?.["status"]`

### Problème 2 — Pas de problème

- La condition JSX `doneActions.length > 0 && (...)` est **correcte** (ligne 1231) ✅
- La section UI utilise bien bracket notation (`ed["title_fr"]`, `ed["action_code"]`) ✅
- P0.7 (`analyze-thread-event/index.ts`) : `authHeader` validé en amont, timeout+clearTimeout+log safe tous OK ✅

### Fix unique

| Fichier | Lignes | Action |
|---------|--------|--------|
| `src/pages/CaseView.tsx` | 692, 698 | Bracket notation au lieu de dot notation |

**Ligne 692** : `ed?.dedupe_key` → `ed?.["dedupe_key"]`
**Ligne 698** : `?.status` → `?.["status"]`

C'est un patch de 2 lignes, zéro impact fonctionnel.

