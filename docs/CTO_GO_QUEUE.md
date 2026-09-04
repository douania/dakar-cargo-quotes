# File d'attente CTO — Dakar Cargo Quotes

Convention (mode autopilot) : quand Claude Code, en exécution automatique planifiée, atteint une
stop condition ou termine un lot nécessitant un verdict CTO non encore donné, il consigne une
entrée ici au lieu d'attendre une réponse synchrone, puis passe au lot sûr suivant (ou s'arrête
proprement s'il n'y en a pas). Codex (ou l'utilisateur) traite les entrées `PENDING` en priorité à
l'ouverture de session, puis met à jour le statut : `GO` / `NO-GO` / `INFO_MANQUANTE` / `TRAITÉ`.

Ne jamais committer ce fichier avec autre chose que lui-même (commit docs-only dédié).

---

<!-- Nouvelle entrée : copier le bloc ci-dessous, remplir, ajouter en haut de la liste. -->

## [AAAA-MM-JJ HH:MM UTC] PENDING — <titre court>
**Origine** : autopilot quotidien (planifié) | session interactive
**Type** : demande de GO avant travail | branche/PR prête pour verdict | blocage / divergence Git
**Objectif** :
**Fichiers concernés** :
**Pourquoi une décision CTO est nécessaire** :
**Risques** :
**Recommandation de Claude Code** :
**Référence** (branche / commit local / lien) :

---

*(Aucune entrée pour l'instant — fichier créé le 2026-09-03 lors de la mise en place du mode
autopilot.)*
