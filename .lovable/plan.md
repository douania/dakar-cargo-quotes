

# Plan — Récupération d'accès + flux "Mot de passe oublié"

## Situation

- Votre compte : `ramzi.hoballah@sodatra.sn` (dernière connexion 28 mars)
- Aucun domaine email configuré sur le projet → impossible d'envoyer des emails de réinitialisation pour l'instant
- La page de login n'a pas de lien "Mot de passe oublié"

## Approche en 2 étapes

### Étape 1 — Vous débloquer immédiatement (sans email)

Créer une **edge function temporaire sécurisée** `admin-reset-password` qui :
- accepte un appel authentifié par `requireAdmin`
- utilise le `service_role` pour appeler `supabase.auth.admin.updateUserById()` 
- réinitialise le mot de passe de votre compte

**Problème** : vous n'êtes pas connecté, donc `requireAdmin` ne fonctionnera pas.

**Alternative plus simple et sûre** : je crée une edge function one-shot protégée par un secret temporaire (pas de JWT requis), qui réinitialise le mot de passe de votre compte spécifique. Vous me donnez le nouveau mot de passe souhaité, j'exécute, puis je supprime immédiatement la fonction.

### Étape 2 — Ajouter le flux "Mot de passe oublié" (pour le futur)

Ceci nécessite un **domaine email configuré** pour envoyer les emails de récupération. Sans domaine email, `resetPasswordForEmail()` ne pourra pas livrer l'email.

**Fichiers à modifier :**
- `src/pages/LoginPage.tsx` — ajouter le lien + dialog "Mot de passe oublié"
- `src/pages/ResetPassword.tsx` — créer la page `/reset-password` pour saisir le nouveau mot de passe
- `src/App.tsx` — ajouter la route `/reset-password` (publique, hors `RequireAuth`)

**Prérequis** : configurer un domaine email d'abord.

## Recommandation

1. **Maintenant** : réinitialiser votre mot de passe via une edge function temporaire sécurisée
2. **Ensuite** : configurer le domaine email + ajouter le flux complet "Mot de passe oublié"

Pour l'étape 1, j'ai besoin que vous me disiez le **nouveau mot de passe** que vous souhaitez utiliser. Je le configurerai via une edge function sécurisée qui sera supprimée immédiatement après usage.

## Périmètre strict

- Aucun module FROZEN touché
- Aucun seed
- Aucun changement de schéma DB
- Edge function temporaire supprimée après usage

