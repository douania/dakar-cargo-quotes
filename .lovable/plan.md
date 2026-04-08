

# Plan actif — COCKPIT-4C : Séparation visuelle Communication / Consolidation

## Statut : IN_PROGRESS (2026-04-08)

## Objectif

Ajouter une séparation visuelle en 2 sections (Communication / Consolidation commerciale) dans le composant CaseActionPlan, sans modifier la logique métier ni les queries.

## Fichiers modifiés

| Fichier | Nature |
|---------|--------|
| `src/components/case/CaseActionPlan.tsx` | Ajout propriété `group` + rendu en 2 sections |
| `docs/DEFERRED_BACKLOG.md` | Entrée COCKPIT-4C |
| `.lovable/plan.md` | Plan actif |

## Ce qui ne change PAS

- Aucune query ajoutée ou modifiée
- Aucune logique de statut modifiée
- Le compteur done/total reste global
- Skip logic inchangée
- Aucune migration, aucune zone FROZEN, aucune mutation
