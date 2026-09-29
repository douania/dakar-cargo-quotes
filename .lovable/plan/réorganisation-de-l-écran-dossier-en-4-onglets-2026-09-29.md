# Réorganisation de l'écran dossier en 4 onglets

## Objectif

L'écran dossier empile aujourd'hui plus de dix blocs dépliables les uns sous les autres, ce qui oblige à faire défiler longuement la page et disperse les boutons d'action. L'objectif est de regrouper ces blocs dans quatre onglets correspondant aux quatre moments de travail réels, sans modifier un seul calcul, montant, contrôle ou règle métier.

## Étape 1 — Structure en onglets (ce lot)

Sous l'en-tête du dossier et le bandeau de pilotage (qui restent visibles en permanence), quatre onglets remplacent le défilement continu.

```text
+-------------------------------------------------------------+
|  Dossier 5e9cd222 · Client · Statut · Imprimer               |
|  Bandeau de pilotage (progression + action attendue)         |
+-------------------------------------------------------------+
| [Devis & Offre] [Marchandise] [Partenaires] [Données & Audit]|
+-------------------------------------------------------------+
|  Contenu de l'onglet sélectionné                             |
+-------------------------------------------------------------+
```

### Onglet 1 — Devis & Offre (affiché par défaut)
Lancement du chiffrage, résultat du chiffrage, contrôles de préparation du devis, version de devis et envoi au client, lignes multi-demandes.

### Onglet 2 — Marchandise & Paramètres
Données de base et marchandise, aperçu cargo canonique, confirmations des catégories PAD et des poids, confirmations de lots, hypothèses de séjour, scénarios et variantes, suggestions NST et classification.

### Onglet 3 — Partenaires & Échanges
Coordination partenaires, demandes externes, propositions de frais maritimes, analyse de la dernière réponse client, brouillons de réponse, actions clôturées, résumé des communications.

### Onglet 4 — Données & Audit
Table des faits et ajout manuel de fait, documents sources, historique des événements, panneaux de synchronisation et de diagnostic.

## Règles de réalisation

- Aucun composant n'est réécrit : ils sont déplacés tels quels dans l'onglet correspondant.
- Aucun changement de calcul, de montant, de fait, d'hypothèse, de statut ni de flux d'écriture.
- Aucune modification de base de données, de migration, d'authentification ni de fonction serveur ; aucune fonction gelée n'est touchée.
- Le bandeau de pilotage et son bouton d'action restent hors onglets, toujours visibles.
- La navigation par ancre existante (le bouton « action attendue » qui fait défiler jusqu'à une section) est conservée : sélectionner l'onglet qui contient la cible avant de faire défiler.
- L'impression continue de produire l'intégralité du dossier, comme aujourd'hui.

## Détails techniques

- Fichier principal concerné : `src/pages/CaseView.tsx`.
- Utilisation du composant `Tabs` déjà présent dans le projet, avec un état d'onglet actif géré dans la page.
- `focusPilotageAction` et la table de correspondance des ancres (`id="section-..."`) sont étendus pour activer d'abord l'onglet hôte de la cible, puis attendre le rendu avant `scrollIntoView`.
- Le sous-onglet existant Faits / Documents / Chronologie du bloc « sources » est absorbé par l'onglet 4 afin d'éviter des onglets imbriqués.
- Pour l'impression, tous les contenus d'onglets sont rendus et l'onglet inactif est masqué par CSS (`print:block`) plutôt que démonté.

## Contrôles avant clôture

Typecheck, tests Vitest ciblés sur la vue dossier puis suite complète, ESLint sur le fichier touché, `lint:baseline` sans dégradation, build.

## Hors périmètre

Étape 2 (harmonisation de l'en-tête avec un bouton d'action principal unique et simplification des libellés techniques) fera l'objet d'un lot distinct après validation de cette structure.
