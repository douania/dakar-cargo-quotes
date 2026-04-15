

# Plan — Micro-nettoyage commentaire auth `export-quotation-version-pdf`

## Diagnostic confirmé

**Commentaire fautif** — Lignes 369 et 372 :
```
L369: // --- Auth (verify_jwt=true guarantees JWT present) ---
L372: // Unreachable with verify_jwt=true, but defensive
```

**Vérité réelle** :
- `supabase/config.toml` : `verify_jwt = false`
- Le header du fichier (L6) dit correctement : `verify_jwt = false (config.toml) — auth validated in-function via inline JWT check`
- L'auth inline fonctionne réellement (check Authorization header + `getUser`) — le code est correct, seuls les commentaires L369 et L372 sont faux

**Nature** : dette documentaire locale uniquement. Aucun changement fonctionnel nécessaire.

## Correctif

**Fichier** : `supabase/functions/export-quotation-version-pdf/index.ts`

| Ligne | Avant | Après |
|-------|-------|-------|
| 369 | `// --- Auth (verify_jwt=true guarantees JWT present) ---` | `// --- Auth (verify_jwt=false in config.toml — inline JWT validation) ---` |
| 372 | `// Unreachable with verify_jwt=true, but defensive` | `// Defensive: reject requests without Bearer token` |

**Aucun code exécutable modifié.** Seuls deux commentaires sont reformulés.

## Confirmations

- Aucun comportement runtime modifié
- Aucune migration
- Aucun autre fichier touché
- Aucun FROZEN touché
- Aucune logique produit altérée
- Pas de mise à jour `DEFERRED_BACKLOG.md` nécessaire (pas d'entrée dédiée à ce commentaire)

