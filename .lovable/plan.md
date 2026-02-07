

# Phase FIX-EMAIL — Resilience du chargement email face aux timeouts DB

## Probleme identifie

La configuration email **existe toujours en base** (confirmee par les logs precedents montrant des syncs reussies). Le probleme est que la base de donnees subit des **timeouts de connexion intermittents**. Quand l'appel `email-admin get_all` echoue (timeout), la fonction `loadData()` tombe dans le `catch` et affiche "Erreur de chargement" avec un ecran vide -- donnant l'impression que rien n'est configure.

## Diagnostic technique

- Les logs `email-admin` montrent des erreurs repetees : `Http: connection closed before message completed`
- La metadata Supabase retourne : `Connection terminated due to connection timeout`
- Le code actuel dans `Emails.tsx` (ligne 149-277) fait tout dans un seul `try/catch` : si le premier appel echoue, tout le reste est ignore

## Corrections proposees

### 1. Separation des appels avec gestion d'erreur individuelle

Modifier `loadData()` dans `src/pages/admin/Emails.tsx` pour :
- Encapsuler chaque appel dans son propre `try/catch`
- Afficher les configs meme si les threads echouent (et inversement)
- Ajouter un **retry automatique** (1 tentative) sur le `get_all` en cas de timeout

### 2. Ajout d'un timeout cote client

Ajouter un `AbortController` avec timeout de 15 secondes sur l'appel `get_all` pour eviter que le navigateur attende indefiniment, et retenter une fois.

### 3. Message d'erreur plus explicite

Au lieu de "Erreur de chargement" generique, distinguer :
- "Serveur temporairement lent, nouvelle tentative..." (retry en cours)
- "Configuration trouvee mais emails en cours de chargement..." (configs OK, threads en erreur)
- "Erreur de connexion persistante" (apres 2 echecs)

### 4. Conserver les donnees existantes en cas d'erreur

Ne pas remettre les states a zero (`setConfigs([])`, etc.) quand un refresh echoue -- garder les donnees precedentes.

## Fichiers modifies

| Fichier | Modification |
|---|---|
| `src/pages/admin/Emails.tsx` | Refactoring de `loadData()` avec try/catch individuels, retry, et messages explicites |

## Perimetres preserves

- Zero migration DB
- Zero modification edge function
- Zero impact sur les autres pages
- La logique de sync, learn, generate reste identique

