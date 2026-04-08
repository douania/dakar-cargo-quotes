# COCKPIT-8 Phase 1 — Bandeau "Prochaine action prioritaire + blocage principal" : DONE ✅

## Composant `NextActionBanner.tsx`
- 6 queries parallélisées + 2 lazy (si version sélectionnée)
- Hiérarchie 12 niveaux, premier match gagne
- STATUS_ORDER explicite (pas de comparaison naïve de strings)
- Niveau 7 : blocage = "Aucun blocage majeur" (pas de faux positif)
- Terminal (SENT/ACCEPTED/REJECTED/ARCHIVED) → `null` (pas de bandeau)
- Pas de CTA (Phase 1)

## Blast radius
| Fichier | Nature |
|---------|--------|
| `NextActionBanner.tsx` | Nouveau composant |
| `CaseView.tsx` | +import + rendu avant CaseActionPlan |
| `.lovable/plan.md` | Plan actif |
| `docs/DEFERRED_BACKLOG.md` | Entrée ajoutée |
