# Lot HS — préflight lecture seule (15/10/2026 12:38 UTC)

Statut : PARTIAL. Rien n'a été modifié ni déployé.

## Identité actuelle
- HEAD : `d8b2bd7ef1e1187698a0b9890ad0776e059afdf4`, égal à `origin/work`. Branche Lovable temporaire `edit/edt-11503ab5…`. Arbre propre.
- `is_published=false`. La visibilité lue est `public`, pas `workspace_edit`. L'outil ne connaît que `public` et `private`. Je ne l'ai pas modifiée.
- Les 5 dossiers existent. Dans `supabase/config.toml`, les 5 sont en `verify_jwt=false`. L'admission se fait dans le code.

## Ce que mes outils permettent (vérifié)
- `supabase--deploy_edge_functions` accepte une liste de noms explicite. Il déploie le contenu local, sans choix de SHA et sans réécrire les sources.
- Procédure : avancer en fast-forward uniquement vers le SHA fourni. Ensuite, vérifier HEAD, l'état de l'arbre et le hash de l'arbre `supabase/functions`. Enfin, déployer les 5 noms et capturer les accusés et les hashes.
- Aucune migration, aucune publication, aucun changement de config.

## Limites
- Fin des anciennes invocations : aucun outil ne fournit de signal de drain ni de liste des workers actifs. La seule référence est la limite Supabase documentée de 400 s par worker, tâches de fond comprises. Je n'ai pas de limite propre à Lovable.
  - Protocole possible : noter l'heure UTC du dernier accusé, puis attendre au moins 400 s avant la migration.
  - Ce délai ne vaut que si la limite Supabase s'applique bien à ce runtime. Il ne prouve pas que les invocations sont terminées.
- Métadonnées distantes (id, version, statut, `verify_jwt` effectif) : UNKNOWN, elles ne sont pas exposées.
- Recette synthétique de `generate` dans `quotation-engine` : impossible dans vos conditions.
  - `LOVABLE_BROWSER_AUTH_STATUS=signed_out` : aucune session existante.
  - En obtenir une exigerait d'ouvrir une nouvelle session, ce que vous interdisez.
  - Le chemin `generate` (ligne 2793) lit les données avec un client service. `.update(` apparaît aux lignes 814 et 1349, dans des fonctions dont le déclenchement par `generate` n'est pas vérifié. L'absence totale d'écriture n'est donc pas prouvée.
- Tests possibles sans secret : OPTIONS et POST sans jeton (401 attendu) sur les 5. Un 401 ne prouve pas que le nouveau code tourne, sauf s'il renvoie un marqueur.

## Étape suivante (sur GO avec SHA)
1. Avancer en fast-forward vers le SHA, puis vérifier HEAD, l'état de l'arbre et les hashes.
2. Déployer les 5 fonctions et relever les accusés et l'heure UTC de fin.
3. Lancer les sondes OPTIONS et POST sans jeton.
4. Attendre au moins 400 s après le dernier accusé avant votre migration.
