Relevé en lecture seule — 5 anciennes fonctions serveur (9 oct. 2026)

Statut : UNKNOWN (preuve indisponible avec mes outils)

Résultat par fonction

| Fonction | verify_jwt déployé | id | version | statut | URL publique |
|---|---|---|---|---|---|
| calculate-duties | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN (non prouvée) |
| learn-from-contact | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN (non prouvée) |
| suggest-regime | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN (non prouvée) |
| generate-case-outputs | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN (non prouvée) |
| get-active-exchange-rate | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN (non prouvée) |

Sources consultées
- Informations du projet Lovable Cloud : confirme seulement le projet actif (non en pause). Aucune liste de fonctions déployées.
- Journaux des fonctions (requête de métadonnées id/version filtrée sur les 5 noms) : 0 ligne dans la fenêtre de rétention. Ne prouve ni l'existence ni l'absence.

Pourquoi UNKNOWN
- Aucun de mes outils Lovable Cloud ne liste les fonctions déployées ni leur détail (verify_jwt, id, version, statut).
- Le seul moyen restant serait d'appeler les endpoints : interdit par le mandat.
- config.toml et Git volontairement non utilisés comme preuve.

Rien d'autre fait
Aucun appel de fonction, aucun déploiement, aucune lecture de données métier, secret ou variable d'environnement, aucune modification.

Recommandation / action suivante
- Relever ces métadonnées avec le connecteur Lovable Cloud disposant de la liste des fonctions (côté Codex / get_project), puis me transmettre verify_jwt par fonction avant le déploiement.
- Le déploiement approuvé devra préserver ce réglage : comme le gate du dépôt impose une section par fonction présente, si une valeur relevée est true, un arbitrage CTO sera nécessaire (le gate refuse verify_jwt = true).
