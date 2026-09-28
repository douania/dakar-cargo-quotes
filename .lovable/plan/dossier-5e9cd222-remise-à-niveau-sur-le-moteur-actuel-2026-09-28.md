# Dossier 5e9cd222 — remise à niveau sur le moteur actuel

## Constat (lecture seule, 28/09/2026)
- Statut PRICED_DRAFT, type SEA_FCL_IMPORT, 12 faits courants, aucune version sélectionnée.
- Dernier calcul : run n°1 du 07/06/2026 (HT 7 335 000 XOF, TTC 7 702 200 XOF).
- Faits modifiés après ce calcul (dernier le 10/09/2026) : le calcul ne les intègre pas.
- 1 gap bloquant ouvert.
- Le calcul date d'avant les corrections moteur déployées en septembre (DTHC/poids par lot, prestations « à confirmer », PAD v3, IMO).

Conclusion : le dossier ne reflète pas les résultats de l'application actuelle.

## Étapes proposées (sous GO CTO explicite, car écriture en base)
1. Lecture seule : identifier le gap bloquant et les faits postérieurs au run.
2. Résoudre le gap bloquant via l'interface (action opérateur).
3. Relancer le pricing depuis la vue dossier (run n°2), sans modification de code.
4. Comparer run 1 / run 2 ligne par ligne et rapporter les écarts.

## Hors périmètre
Aucune modification de code, migration, déploiement ou envoi d'e-mail.
