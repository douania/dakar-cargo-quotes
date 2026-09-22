# Lot 5 — Partenaires et coordination

## Objectif
Réorganiser la section Coordination de la vue dossier selon la maquette opérateur, sans modifier les données, calculs, statuts ni contrats d’écriture existants.

## Réalisation
- Renommer la section « Partenaires et coordination » et compléter son résumé avec l’étape restante issue du plan existant.
- Rendre le plan d’actions lisible immédiatement : étapes terminées discrètes, seule étape restante mise en évidence avec son blocage existant.
- Présenter la communication client sur trois lignes : e-mail chargé, questions ouvertes et dernière analyse disponible ; conserver brouillons et actions clôturées derrière des commandes secondaires.
- Regrouper les demandes partenaires avec l’état de collecte existant et les commandes existantes « Scanner les e-mails » / « Nouvelle demande ».
- Représenter le périmètre fournisseur avec nom, priorité, statut et éléments attendus en pastilles ; afficher l’explication DAP/DDP uniquement à partir des qualifications déjà chargées.
- Reclasser le prochain geste en ligne discrète et conserver toutes les commandes historiques dans les blocs repliés.

## Technique
- Fichiers applicatifs autorisés : `CaseActionPlan.tsx`, `CommunicationSummaryCard.tsx`, `PartnerScopeCard.tsx`, section Coordination de `CaseView.tsx`, composants partenaires déjà montés si une adaptation d’intitulé est nécessaire.
- Aucun changement de requête d’écriture, payload, fonction distante, base, authentification ou règles d’accès.
- Tests ciblés : plan restant, trois lignes client, collecte, condition DAP/DDP, verrouillage, absence d’appel au montage et immutabilité.

## Validation
Typecheck, Vitest ciblés, suite complète avec comparaison à la baseline 518/519, ESLint ciblé, `lint:baseline`, build, diff exact et rollback dans le rapport.
