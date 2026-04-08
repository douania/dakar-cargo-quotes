

# Plan actif — COCKPIT-4B : Plan d'actions orienté communication réelle

## Statut : EN COURS (2026-04-08)

## Périmètre

- Évolution de `CaseActionPlan.tsx` : passage de 8 à 12 étapes orientées communication
- Décomposition des boucles partenaire (préparer → confirmer envoi → traiter réponses)
- Décomposition des boucles client (envoyer clarifications → analyser réponses)
- Étape 4 "Confirmer l'envoi" honnête : done seulement si `email_sent_at` renseigné
- Note UI discrète pré-COM-1A quand l'envoi n'est pas encore confirmé
- Étape 11 "Préparer l'email client" utilise `hasDraft` (déjà calculé, pas utilisé avant)
- 3 nouvelles queries ciblées ajoutées dans le batch 2

## Les 12 étapes

| # | Étape | Done si |
|---|-------|---------|
| 1 | Analyser la demande client | status > INTAKE |
| 2 | Résoudre les gaps bloquants | blockingGaps === 0 |
| 3 | Préparer les demandes partenaires | aucune en draft (skip si total === 0) |
| 4 | Confirmer l'envoi des demandes | aucune sent sans email_sent_at (skip si total === 0) |
| 5 | Traiter les réponses partenaires | openPartnerRequests === 0 ET pendingFacts === 0 (skip si total === 0) |
| 6 | Envoyer les clarifications client | aucun client_gap drafted (skip si total === 0) |
| 7 | Analyser les réponses client | openClientGaps === 0 (skip si total === 0) |
| 8 | Lancer le pricing | status >= PRICED_DRAFT |
| 9 | Créer la version | hasVersion |
| 10 | Exporter le PDF | hasPdf (document_type = pdf) |
| 11 | Préparer l'email client | hasDraft |
| 12 | Marquer l'envoi client | status in SENT/ACCEPTED/REJECTED |

## Fichiers modifiés

| Fichier | Nature |
|---------|--------|
| `src/components/case/CaseActionPlan.tsx` | Évolution majeure (8 → 12 étapes) |
| `docs/DEFERRED_BACKLOG.md` | Mise à jour description COCKPIT-4 |
| `.lovable/plan.md` | Plan actif COCKPIT-4B |

## Blast radius

- 0 migration DB
- 0 zone FROZEN touchée
- 0 mutation métier
- Pipeline EQ1 intact
- Filtres openPartnerRequests alignés COCKPIT-2/COCKPIT-3

## Prochaine action

Validation runtime sur dossier réel, puis clôture documentaire.
