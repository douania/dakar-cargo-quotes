
# Phase RESILIENCE-GLOBALE — avec correction CTO Auth

## Contexte

L'infrastructure cloud subit des timeouts de connexion intermittents. L'application n'a aucune protection contre ce type de degradation, ce qui cause un blocage complet (spinner infini) sur toutes les pages.

La correction CTO est integree : un timeout auth ne doit JAMAIS rediriger vers login.

## 1. Utilitaire central `src/lib/fetchWithRetry.ts` (nouveau fichier)

Helper reutilisable avec :
- `AbortController` + timeout configurable (defaut 15s)
- 1 retry automatique sur timeout/connexion fermee
- Toast informatif lors du retry

Sera utilise par Dashboard et Emails.

## 2. AuthProvider avec etat `timeout` (correction CTO integree)

Fichier : `src/features/auth/AuthProvider.tsx`

Modifications :
- Ajouter un type `AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'timeout'`
- Exposer `authStatus` dans le contexte (en plus de `isLoading` pour compatibilite)
- Ajouter un timeout de 10 secondes sur `getSession()`
- Si timeout : `authStatus = 'timeout'` (et NON `session = null`)
- Ajouter une fonction `retryAuth()` pour relancer `getSession()`
- `isLoading` reste `true` uniquement quand `authStatus === 'loading'`

```text
Etats possibles :
  loading         -> spinner (max 10s)
  authenticated   -> acces normal
  unauthenticated -> redirect login
  timeout         -> message "connexion lente" + bouton retry
```

Interface du contexte mise a jour :
```text
AuthContextType {
  session: Session | null
  user: User | null
  isLoading: boolean          // compat: true ssi 'loading'
  authStatus: AuthStatus
  signOut: () => Promise<void>
  retryAuth: () => void
}
```

## 3. RequireAuth avec gestion du timeout

Fichier : `src/features/auth/RequireAuth.tsx`

Modifications :
- Lire `authStatus` et `retryAuth` depuis `useAuth()`
- Si `authStatus === 'timeout'` : afficher message "Connexion lente. Verification en cours..." avec bouton "Reessayer"
- Redirection vers `/login` UNIQUEMENT si `authStatus === 'unauthenticated'`
- Jamais de redirect sur timeout

## 4. Dashboard resilient

Fichier : `src/pages/Dashboard.tsx`

Modifications :
- Importer `invokeWithRetry` depuis `src/lib/fetchWithRetry.ts` (pour les appels directs Supabase, wrapper similaire)
- Ajouter un etat `error` avec message explicite et bouton "Reessayer"
- Ne pas rester bloque sur spinner infini : apres 15s de timeout sur les requetes, afficher l'erreur
- Conserver les donnees existantes si un refresh echoue (ne pas `setRequests([])`)

## 5. Emails refactor vers utilitaire central

Fichier : `src/pages/admin/Emails.tsx`

Modifications :
- Remplacer le `invokeWithRetry` local (lignes 150-178) par l'import depuis `src/lib/fetchWithRetry.ts`
- Le reste du code `loadData` deja refactore reste identique

## 6. Export mis a jour

Fichier : `src/features/auth/index.ts`

- Re-exporter le type `AuthStatus` pour usage externe si necessaire

## Resume des fichiers

| Fichier | Type | Modification |
|---|---|---|
| `src/lib/fetchWithRetry.ts` | Nouveau | Utilitaire central retry + timeout |
| `src/features/auth/AuthProvider.tsx` | Modifie | AuthStatus 4 etats, timeout 10s, retryAuth() |
| `src/features/auth/RequireAuth.tsx` | Modifie | Gestion timeout sans redirect |
| `src/features/auth/index.ts` | Modifie | Export AuthStatus |
| `src/pages/Dashboard.tsx` | Modifie | Etat erreur, bouton retry, conservation donnees |
| `src/pages/admin/Emails.tsx` | Modifie | Import utilitaire central |

## Perimetres preserves

- Zero migration DB
- Zero modification edge function
- Logique metier inchangee
- Compatibilite ascendante : `isLoading` reste disponible
