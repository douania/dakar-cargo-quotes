

# Réinitialisation du mot de passe pour ramzi.hoballah@sodatra.sn

## Contexte

Le compte existe dans la base : `ramzi.hoballah@sodatra.sn` (ID: `577d99cd-e6d4-4dc8-afcb-428a172dc14d`). Le mot de passe n'est pas récupérable (hashé). Il faut le réinitialiser via l'API admin.

## Approche

Utiliser l'API admin Supabase (`auth.admin.updateUserById`) pour définir un mot de passe temporaire. Cela se fait via une edge function existante ou un appel direct.

## Plan d'exécution (1 étape)

Créer une edge function temporaire `reset-user-password` qui :

1. Utilise `requireAdmin` pour la sécurité
2. Appelle `supabase.auth.admin.updateUserById(userId, { password })` 
3. Retourne un succès/échec

Après utilisation, la function sera supprimée.

**Mot de passe temporaire proposé** : `Sodatra2026!` (à changer après première connexion)

## Fichier créé

| Fichier | Action |
|---------|--------|
| `supabase/functions/reset-user-password/index.ts` | Edge function temporaire (à supprimer après usage) |

## Alternative plus simple

Si vous préférez ne pas créer de fonction, vous pouvez accéder au backend Lovable Cloud directement :

1. Ouvrir le backend via le panneau Cloud
2. Aller dans Users
3. Trouver `ramzi.hoballah@sodatra.sn`
4. Réinitialiser le mot de passe depuis l'interface

## Sections techniques

La fonction utilisera le pattern standard du repo : `createClient` avec `SUPABASE_SERVICE_ROLE_KEY`, cors headers, et `requireAdmin` guard. Elle sera déployée, appelée une fois, puis supprimée.

