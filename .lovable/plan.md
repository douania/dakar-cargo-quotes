
# Orchestration — Plan d'exécution

## ORCH-SYNC-2 — Aligner bloc Actions & actions internes ✅ DONE

### Problème
1. Le vieux bloc "Actions" affichait "Aucune action ouverte" même quand ReadyActionsPanel avait des actions client prioritaires
2. Les actions internes ("Créer la version du devis") apparaissaient comme exécutables même en présence de gaps bloquants

### Correctif appliqué
1. **CaseView.tsx** : Le bloc "Open Actions" n'est affiché que pour les dossiers terminaux (`SENT`, `ACCEPTED`, `REJECTED`, `ARCHIVED`). Pour les dossiers actifs, ReadyActionsPanel est la seule source d'actions exécutables.
2. **ReadyActionsPanel.tsx** : Les actions internes (§8 — pricing, version, PDF) sont conditionnées à `!hasBlockingGaps`. Elles réapparaissent automatiquement quand tous les gaps bloquants sont résolus.

### Fichiers modifiés
- `src/pages/CaseView.tsx` — wrapping conditionnel du bloc Actions
- `src/components/case/ReadyActionsPanel.tsx` — guard `hasBlockingGaps` sur §8

---

## Fix impression PDF ✅ DONE

Neutralisation du layout flex sidebar dans `@media print` (`src/index.css`).
