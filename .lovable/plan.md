# Livraison privée — correctif transport standard provisoire (run-scenario-pricing)

## Objectif
Livrer le correctif chirurgical poussé sur `work` : transmission au moteur du pays et du port déjà présents dans l'hypothèse transport liée lorsque les anciens faits de routage sont absents. Correctif limité à `supabase/functions/run-scenario-pricing/index.ts` et `handler_test.ts`.

## Étapes

1. **Préflight Git (lecture seule, STOP sur divergence)**
   - `HEAD` local = `origin/work` = `6affc1e89fe44238124ad94bd3f5f4cd51259e1f` (via `ls-remote`).
   - Worktree propre (`git status --short`).
   - Arbre `HEAD:supabase` = `c3ff85c04deeada1855187dced52b185dbc7f620`.
   - Toute divergence → STOP et rapport, aucune action.

2. **Preview privée**
   - Rebuild frontend (`npx vite build`, sans installation, sans édition).
   - Vérifier HTTP 200 avant et après.

3. **Déploiement unique**
   - Déployer uniquement `run-scenario-pricing`.
   - `quotation-engine` non redéployée (inchangée). Aucune autre fonction Edge.
   - STOP au premier échec.

4. **Post-déploiement**
   - Revérifier HEAD, worktree propre, arbre `HEAD:supabase` identique.
   - Sondes : `OPTIONS` 200 et `POST {}` sans authentification → 401 attendu (joignabilité et refus d'accès seulement, pas preuve de calcul authentifié).
   - Journal de build : vérifier qu'aucune erreur nouvelle n'apparaît.

## Rapport attendu
HEAD avant/après, arbre supabase avant/après, résultat build, accusé exact de déploiement, résultats des sondes, état preview, worktree.

## Interdictions (rappel)
Aucune édition de fichier, aucune migration/SQL, aucun fait client, barème, Auth/RLS, aucune autre fonction Edge, aucune publication publique, aucun envoi, aucun correctif automatique.

## Dette connue — signalée seulement, sans correction
- Test frontend `LocalTransportEstimateFields` obsolète.
- Test Deno Intake non atomique.
- Lint 740/16 vs baseline fichier 737/16 (identique à `origin/work`).
- TS2345 historiques dans `run-pricing/index.ts`.

## Limites
Bundle runtime déployé non exposé : NOT_VERIFIED. Preuve de substitution = sources Git inchangées + accusé exact de l'outil + sondes. Recette GoTrans authentifiée reprise par Codex après livraison.
