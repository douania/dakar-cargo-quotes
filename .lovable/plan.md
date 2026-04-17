

## Diagnostic

L'erreur 400 vient d'un **désalignement entre le code source et la version déployée** de l'edge function `run-pricing`.

**Preuves** :
- Le code local (`supabase/functions/run-pricing/index.ts` ligne 553-561) contient bien la logique Lot 4.1 backend : `NEED_INFO` et `FACTS_PARTIAL` sont autorisés si `allow_provisional=true`, et le message d'erreur formate `(provisional only)`.
- La réponse réelle du serveur retourne `"allowed_statuses":["READY_TO_PRICE","ACK_READY_FOR_PRICING","PRICED_DRAFT","HUMAN_REVIEW","QUOTED_VERSIONED","SENT"]` — **sans le suffixe `(provisional only)`** et **sans `NEED_INFO`/`FACTS_PARTIAL`**.

Donc la version exécutée est l'ancienne, antérieure au patch backend Lot 4.1.

## Cause

Lovable Cloud déploie automatiquement les edge functions en arrière-plan, mais il y a un délai. Les logs montrent un boot à `1776423808` (~1s après l'erreur), donc le redéploiement était probablement en cours au moment du clic. La requête a frappé l'ancienne version juste avant.

## Action proposée

**Forcer un redéploiement explicite** de la fonction `run-pricing` pour garantir que la version correcte est en ligne, puis re-tester l'opération provisoire DDP sur le dossier `737c9b08...`.

Étapes (en mode default) :
1. Déployer `run-pricing` via `supabase--deploy_edge_functions`.
2. Vérifier le déploiement via les logs de boot.
3. Optionnel : tester via `supabase--curl_edge_functions` un POST `{ case_id, allow_provisional: true }` pour confirmer que la réponse n'est plus 400.

## Aucun changement de code requis

Le code est correct. Aucun fichier ne doit être modifié.

