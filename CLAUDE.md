@AGENTS.md

## Spécifique Claude Code
- Modèle/effort par défaut pour ce dépôt : Sonnet, effort high. Opus (effort high/xhigh) uniquement sur GO CTO pour DB/RLS/Auth/migration, pricing, sécurité ou blocage récurrent. Jamais `max` ni ultracode sans périmètre strict écrit.
- Commencer chaque session par le préflight Git ci-dessus et la lecture ciblée de la roadmap (sections 1–2 + pack actif). Ne pas charger `docs/DEFERRED_BACKLOG.md` (1 700 lignes) sauf besoin explicite.
- Travailler en lecture seule (Read/Grep/Glob) tant que le GO du lot n'autorise pas l'écriture ; quand le GO autorise l'écriture, appliquer et tester soi-même dans ce clone plutôt que produire un patch à recopier par une autre IA.
- Découper tout lot > 3 fichiers en sous-lots pour éviter la saturation de sortie.
- Ne pas lire `.env` ; ne jamais coller de clés dans un message ou un commit.

## Escalade automatique (mode autopilot planifié)
En tâche planifiée (sans utilisateur présent) : vérifier `docs/CTO_GO_QUEUE.md` en premier et traiter toute entrée dont le statut est passé à `GO` depuis le dernier passage. Pour un lot déjà couvert par un GO explicite dans la roadmap, exécuter normalement (patch, tests, commit local sur `work`). Si le travail restant bute sur une stop condition ou nécessite un nouveau verdict CTO non encore donné : ne pas rester bloqué en attente d'une réponse synchrone — consigner une entrée `PENDING` dans `docs/CTO_GO_QUEUE.md` (format dans ce fichier), committer uniquement ce fichier (jamais le code concerné) avec un message dédié, puis passer au lot sûr suivant s'il y en a un, ou terminer proprement.

Garde-fous supplémentaires propres au mode autopilot :
- Ne jamais lever soi-même une stop condition : rester en lecture seule sur le sujet concerné tant que l'entrée correspondante n'est pas passée à `GO` dans la file.
- Ne jamais committer un fichier modifié dans les 15 dernières minutes (risque d'édition en cours par un autre agent ou par l'utilisateur).
- Le push vers `origin` n'est pas disponible depuis l'environnement planifié (pas d'identifiants Git dans ce contexte) : les commits restent locaux sur `work`. Le résumé de fin de passage doit lister explicitement les commits locaux prêts à être poussés.
- Un passage planifié qui ne trouve rien de sûr à faire et aucune entrée `GO` à traiter se termine sans rien committer — ce n'est pas un échec.
