# Lot 6 — Sources, faits et historique

## Objectif
Appliquer les trois corrections mineures de clôture du lot 5, puis réorganiser la section Sources selon la maquette opérateur, sans modifier les contrats d’écriture, données, calculs, statuts ou services distants.

## Réalisation
- Corriger la communication client : compter les gaps chargés, distinguer les demandes déjà envoyées et afficher « E-mail client manquant » lorsque c’est le seul défaut.
- Retirer uniquement le doublon de l’état de collecte sous le panneau de pricing et conserver son instance dans Partenaires et coordination.
- Renommer l’onglet Timeline en « Historique (n) », afficher le compte réel des documents dans l’onglet et le résumé quand il est disponible.
- Extraire le tableau des faits dans `CaseFactsTable.tsx` : regroupements métier ordonnés, libellé lisible avec clé technique, origine lisible, confiance colorée aux seuils demandés et actions d’édition/historique existantes.
- Résumer les valeurs JSON en clair ; garder le brut derrière « Détail technique », avec l’adaptateur d’hypothèses seulement si la structure est compatible.
- Conserver le filtre courant actif, afficher le nombre de faits sous 70 %, et garder « Ajouter un fait » en commande secondaire avec son formulaire et ses payloads inchangés.
- Ne marquer comme conflit que les faits reliés à un signal explicite déjà chargé ; une confiance faible seule ne produit aucun conflit ni action d’arbitrage.

## Technique
- Fichiers autorisés : `CommunicationSummaryCard.tsx`, `CaseView.tsx`, `case-view/constants.ts`, nouveau `CaseFactsTable.tsx`, nouveau test du tableau, tests `CoordinationCards` et `cockpit-layout` concernés.
- Réutiliser `FactHistoryPopover` tel qu’il existe ; aucun nouveau mécanisme d’historique.
- Aucun changement de requête d’écriture, payload `set-case-fact`, fonction distante, migration, base, authentification ou RLS.
- Les signaux explicites absents de la vue chargée ne seront pas inventés ; le tableau accepte uniquement les clés explicitement signalées par son parent.

## Validation
Typecheck, Vitest ciblés, suite complète comparée à 522/523, ESLint ciblé, `lint:baseline` comparé à 734/16, build, contrôle du diff réel et rapport de rollback.
