# Plan — Diagnostic « Failed to fetch » à la connexion

## Constat (vérifié)
- `LoginPage.tsx` utilise `supabase.auth.signInWithPassword` — code correct.
- L'API d'authentification Lovable Cloud répond depuis le sandbox (400 sur mauvais identifiants = service joignable).
- `cloud_status` : backend `ACTIVE_HEALTHY` (auth et base de données atteignables).
- Erreur affichée côté navigateur : « Failed to fetch » = échec réseau au niveau du navigateur, pas du serveur.

## Cause la plus probable
1. Preview en cours de rebuild au moment du test (« Aperçu en cours » visible après le merge) — requêtes interrompues.
2. Bloqueur (uBlock/AdGuard) ou filtrage réseau d'entreprise bloquant `*.supabase.co` depuis le navigateur.
3. Coupure réseau transitoire.

## Étape 1 — Vérifications utilisateur (sans code)
- Recharger la preview et retenter la connexion.
- Ouvrir DevTools → Network : vérifier le statut de la requête `auth/v1/token` (bloquée / CORS / hors-ligne).
- Désactiver temporairement les extensions de blocage et retester.

## Étape 2 — Si le problème persiste : durcissement UX du login (1 fichier)
- `src/pages/LoginPage.tsx` : distinguer l'échec réseau (`Failed to fetch` / `TypeError`) des erreurs d'identifiants, et afficher un message explicite (« Serveur injoignable — vérifiez votre connexion ou vos extensions de blocage ») avec un bouton Réessayer, au lieu du toast générique.
- Aucune logique métier, aucun changement Auth/RLS/tarif.

## Hors périmètre
- Aucune modification backend, Edge Function, migration, donnée ou publication.
