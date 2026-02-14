
# Correctif : 403 "Access denied" — Ownership trop restrictif en contexte mono-entreprise

## Diagnostic

L'utilisateur connecte est `ramzi.hoballah@sodatra.sn` (ID `577d99cd`), mais les cases ont ete crees par `sodatrasn@gmail.com` (ID `fcd6d183`). Le champ `assigned_to` est `null` sur la plupart des cases.

Le check d'ownership dans `build-case-puzzle` (et 9 autres fonctions) est :

```text
if (caseData.created_by !== userId && caseData.assigned_to !== userId) {
  return 403 "Access denied"
}
```

Sodatra est une application mono-entreprise : tous les utilisateurs authentifies doivent pouvoir acceder a tous les cases. Le check actuel bloque tout utilisateur qui n'est pas le createur exact.

## Approche recommandee

Remplacer le check strict `created_by === userId` par un simple check `authenticated`. Puisque l'auth est deja validee en amont (JWT + getUser), tout utilisateur authentifie est un employe Sodatra et a le droit d'acceder aux cases.

## Fonctions impactees (10 fichiers)

| Fonction | Ligne | Check actuel |
|---|---|---|
| `build-case-puzzle` | 771 | `created_by !== userId && assigned_to !== userId` |
| `run-pricing` | 100 | `created_by !== userId && assigned_to !== userId` |
| `generate-case-outputs` | 141 | `created_by !== userId && assigned_to !== userId` |
| `send-quotation` | 122 | `created_by !== user.id && assigned_to !== user.id` |
| `generate-quotation-version` | 149 | `created_by !== user.id && assigned_to !== user.id` |
| `ack-pricing-ready` | 138 | `created_by !== userId` |
| `commit-decision` | 283 | `created_by !== userId` |
| `suggest-decisions` | 351 | `created_by !== userId` |
| `generate-quotation` | 138 | `created_by !== userId` |
| `learn-quotation-puzzle` | 465 | `created_by !== userId` (cancel job) |

## Correctif

Pour chaque fonction, supprimer ou commenter le bloc de check d'ownership. L'authentification JWT reste en place comme garde de securite. Le commentaire expliquera que c'est une app mono-entreprise.

```text
// Mono-tenant app: all authenticated users can access all cases
// Ownership check removed — JWT auth is sufficient
```

## Risque

Faible. L'application est mono-entreprise (Sodatra). Tous les utilisateurs ont un compte email `@sodatra.sn` ou `sodatrasn@gmail.com`. L'authentification JWT garantit que seuls les utilisateurs enregistres accedent aux fonctions.

Si l'application devient multi-tenant a l'avenir, un systeme de teams/organizations devra etre mis en place a ce moment-la.

## Resume

| Correctif | Nature | Impact |
|---|---|---|
| Retrait ownership check | 10 edge functions | ~3 lignes par fonction |
| Auth JWT maintenu | Aucun changement | Securite preservee |
