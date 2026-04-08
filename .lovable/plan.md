

# Plan actif — COCKPIT-4 : Plan d'actions dossier

## Statut : EN COURS (2026-04-08)

## Périmètre

- Nouveau composant `CaseActionPlan.tsx` : checklist ordonnée des étapes dossier
- Composant autonome avec ses propres queries (staleTime 30s)
- Lecture seule, aucune mutation
- 8 étapes max : Analyser → Gaps → Partenaires → Client → Pricing → Version → PDF → Envoi
- Étapes partenaires/client masquées si aucune demande n'a JAMAIS existé (totalCount === 0)
- Hiérarchie de statuts explicite via `STATUS_ORDER` (pas de comparaison de strings naïve)
- Placé avant CommunicationSummaryCard dans CaseView.tsx

## Fichiers modifiés

| Fichier | Nature |
|---------|--------|
| `src/components/case/CaseActionPlan.tsx` | Nouveau composant |
| `src/pages/CaseView.tsx` | Import + placement (~5 lignes) |
| `docs/DEFERRED_BACKLOG.md` | Entrée COCKPIT-4 en `planned` |

## Blast radius

- 0 migration DB
- 0 zone FROZEN touchée
- 0 mutation métier
- Pipeline EQ1 intact

## Prochaine action

Validation runtime sur dossier réel, puis clôture documentaire (DONE dans backlog, section MASTER_CONTEXT).
