# Écran dossier simplifié : « Où j'en suis / Ce que je dois faire »

## Objectif
Qu'en ouvrant un dossier, l'opérateur comprenne en 5 secondes où en est la cotation, ce qu'il reste à faire, et puisse agir sur place, sans passer d'une fenêtre à l'autre. Aucun calcul, montant, contrôle ou règle métier n'est modifié.

## Nouvel écran par défaut (vue simple)

```text
+--------------------------------------------------------------+
| Dossier · Client · Import maritime Dakar                     |
| Situation : Devis calculé — il reste 2 étapes avant l'envoi   |
| [Estimation]-[Devis calculé]-(Version)-(PDF)-(Envoi)          |
+--------------------------------------------------------------+
| A FAIRE MAINTENANT                                            |
|  1. Valider le poids retenu pour le devis                     |
|     Explication en une phrase + choix proposé                 |
|     [ Approuver ]   Voir le détail                            |
|  2. Calculer le devis                     (grisé tant que 1)  |
|  3. Créer la version et envoyer au client (grisé)             |
+--------------------------------------------------------------+
| Résumé : Marchandise · Conteneurs · Montant estimé / confirmé |
+--------------------------------------------------------------+
| [ Mode expert ] (tout le détail actuel, organisé en onglets)  |
+--------------------------------------------------------------+
```

- Une seule carte « À faire maintenant » : liste numérotée des tâches restantes, dans l'ordre. Seule la première est active, avec **un seul bouton principal**.
- Chaque tâche s'ouvre **sur place** (dépliée dans la carte) : explication simple, choix à approuver, bouton d'action. Plus besoin de chercher dans un autre onglet.
- Un bloc « Résumé » court remplace les nombreux encadrés.
- Tout le reste (tableaux de faits, scénarios, partenaires, historique, diagnostics) passe dans le **Mode expert**, fermé par défaut, qui reprend les 4 onglets actuels.

## Langage simple
Glossaire appliqué aux libellés affichés en vue simple (le mode expert garde les termes précis entre parenthèses) :
- gap bloquant → information manquante
- catégorie PAD → catégorie de marchandise au port
- run / pricing → calcul du devis
- scope → prestations demandées
- faits → informations du dossier

## Tâches couvertes (issues de la logique existante « action prioritaire »)
Informations manquantes, validation catégorie/poids au port, demandes partenaires (préparer, confirmer l'envoi, valider la réponse, choisir l'offre), clarifications client, calcul du devis, création de version, PDF, brouillon d'e-mail, confirmation d'envoi. Pour chaque tâche : titre clair, pourquoi, que faire, bouton. Si l'action demande un panneau complexe existant, il est affiché intégré dans la carte plutôt qu'ailleurs.

## Règles
- Aucune modification de base de données, fonction serveur, migration, calcul, montant ni flux d'écriture ; composants gelés non touchés.
- Les composants existants sont réutilisés tels quels (affichés dans la carte ou dans le mode expert).
- Impression inchangée (dossier complet).
- Pas d'envoi automatique : chaque action reste un clic de l'opérateur.

## Détails techniques
- Nouveau composant `src/components/case/CaseTodoCard.tsx` : liste ordonnée dérivée d'une nouvelle fonction pure `buildCaseTodoList(cockpit, …)` dans `src/pages/case-view/presentation.ts` (réutilise les mêmes conditions que `selectPilotageAction`, mais retourne toutes les tâches au lieu de la première).
- Chaque tâche a un rendu inline : réutilise `PadGroupConfirmationsPanel`, `PricingLaunchPanel`, panneau version/envoi, `BlockingGapsPanel`, etc.
- `CaseView.tsx` : en-tête + situation + `CaseTodoCard` + résumé ; les 4 onglets existants passent derrière un bouton « Mode expert » (état mémorisé en localStorage, préférence d'affichage uniquement).
- Libellés : table de correspondance dans `src/pages/case-view/constants.ts`.
- Tests Vitest de `buildCaseTodoList` (ordre, blocage des étapes suivantes) + mise à jour de `cockpit-layout.test.tsx` ; typecheck, eslint, lint:baseline, build.

## Hors périmètre
Refonte visuelle (couleurs, polices), changements des panneaux experts eux-mêmes.
