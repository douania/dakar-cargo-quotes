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

## Consultation directe Codex (canal miroir, à privilégier sur la file d'attente)

Codex peut déjà invoquer le CLI `claude` en local (sous-processus non interactif, lecture seule, session Claude Code déjà authentifiée sur la machine de l'utilisateur) pour obtenir un contre-avis sans passer par l'utilisateur — confirmé directement par Codex le 2026-09-03. Le canal symétrique existe : toute session Claude Code disposant d'un accès à l'ordinateur de l'utilisateur (outils `computer_*`/`device_*`) peut consulter Codex en direct de la même façon, au lieu d'attendre une réponse asynchrone dans `docs/CTO_GO_QUEUE.md`. C'est le canal à privilégier chaque fois qu'il est disponible, y compris en session interactive normale — pas seulement en mode autopilot planifié.

Procédure :
1. Vérifier que l'app ChatGPT/Codex est accessible (accès outil `computer_*` déjà accordé, sinon le demander explicitement avec une raison précise).
2. Prendre une capture d'écran avant toute action. Si un brouillon non envoyé existe dans la zone de saisie, ne jamais y toucher, ne jamais l'écraser : ouvrir un nouveau chat dédié à la place.
3. Ouvrir un nouveau chat (se détacher de tout projet si une erreur d'association apparaît), poser une question unique, précise et bornée : repo, branche, HEAD, l'ambiguïté ou la décision exacte requise, et demander explicitement le format de verdict CTO (Statut/Faits vérifiés/Hypothèses/Risques/Recommandation/Action suivante).
4. Attendre la réponse sans marteler l'interface (vérifier toutes les 20-30 s).
5. Agir sur un GO clair ; s'arrêter et rapporter sur un NO-GO ou une ambiguïté persistante.
6. Consigner l'échange (question + verdict, horodatage) dans `docs/CTO_GO_QUEUE.md` avec le statut `TRAITÉ` — ce fichier reste la trace d'audit unique même quand la décision a été obtenue en direct plutôt qu'en asynchrone.
7. Économiser le quota Codex : question unique et bornée, pas d'aller-retour exploratoire, effort raisonnable (éviter de déclencher un effort très élevé pour une décision simple).

Si aucun accès à l'ordinateur n'est disponible (session Claude Code sans pont device), revenir à l'escalade asynchrone standard : consigner une entrée `PENDING` dans `docs/CTO_GO_QUEUE.md` et continuer sur le lot sûr suivant.
