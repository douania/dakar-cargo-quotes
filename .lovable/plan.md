
# Correctif double : revert verify_jwt + guard synthetique manquant

## Probleme 1 : 401 "Invalid token" sur ensure-quote-case (et 8 autres fonctions)

Le Patch 3 a mis `verify_jwt = true` sur 9 fonctions. Or, Lovable Cloud utilise un systeme signing-keys ou `verify_jwt = true` **ne fonctionne pas**. Le guard `requireUser()` dans le code suffit comme couche d'authentification.

**Correction** : Remettre `verify_jwt = false` sur les 9 fonctions dans `supabase/config.toml` :
- `data-admin` (ligne 67)
- `email-admin` (ligne 64)
- `send-quotation` (ligne 142)
- `import-thread` (ligne 46)
- `sync-emails` (ligne 31)
- `ensure-quote-case` (ligne 112)
- `build-case-puzzle` (ligne 115)
- `run-pricing` (ligne 118)
- `commit-decision` (ligne 130)

---

## Probleme 2 : 400 "invalid input syntax for uuid" depuis ThreadUsageTagWithData

Le fichier `src/components/puzzle/ThreadUsageTagWithData.tsx` query `quote_cases` et `puzzle_jobs` avec `.eq('thread_id', threadId)` sans verifier si `threadId` est un ref synthetique `subject:*`.

**Correction** : Ajouter un guard au debut du composant et dans les `enabled` des deux queries :

```text
const isSyntheticRef = threadId.startsWith('subject:');
```

- Query quote_cases : `enabled: !isSyntheticRef`
- Query puzzle_jobs : `enabled: !isSyntheticRef`

Si `isSyntheticRef`, les queries ne s'executent pas et le composant retourne `null`.

---

## Resume

| Correctif | Fichier | Nature |
|---|---|---|
| Revert verify_jwt | supabase/config.toml | 9 lignes false |
| Guard synthetique | ThreadUsageTagWithData.tsx | 3 lignes ajoutees |

## Risque

Nul. On revient a l'etat fonctionnel pour config.toml, et on ajoute un guard defensif pour ThreadUsageTagWithData.
