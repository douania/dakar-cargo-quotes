

# P1-C — Alignement contrat timeline / outputs

## Problème
Drift de schéma entre producteurs et lecteurs de `case_timeline_events` :
- `event_data.kind` vs `event_data.output_type` (vestige jamais écrit)
- Pas de contrat canonique documenté pour `output_generated` ni `manual_action`

## Diagnostic confirmé
- Tous les producteurs actifs écrivent déjà `kind` (output_generated) et `action_code` (manual_action)
- `output_type` n'est écrit par **aucune** edge function
- Un seul lecteur vestigial : `ReadyActionsPanel.tsx` L222 (`kind || output_type`)
- `create-quotation-email-draft` manque de `dedupe_key` (watchlist, pas corrigé ici)

## Correctif appliqué
- Suppression du drift `output_type` dans `ReadyActionsPanel.tsx`
- Contrat canonique documenté dans `docs/MASTER_CONTEXT.md` (section "Contrat canonique timeline")
- Watchlist `TIMELINE-DEDUPE-1` ajoutée dans `docs/DEFERRED_BACKLOG.md`
- `STATUS_REGISTRY.md` non modifié (contient uniquement des statuts FSM, pas des contrats d'events)

## Blast radius
- 1 ligne modifiée : `src/components/case/ReadyActionsPanel.tsx`
- 1 section ajoutée : `docs/MASTER_CONTEXT.md`
- 1 entrée ajoutée : `docs/DEFERRED_BACKLOG.md`
- Aucune edge function modifiée (déjà alignées)
- Aucune migration DB
- P0-A/P0-B/P0-C/P1-A/P1-B non impactés
