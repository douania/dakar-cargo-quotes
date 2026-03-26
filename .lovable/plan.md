

# Plan — Mise à jour DEFERRED_BACKLOG.md post-C1

## Objectif

Refléter la clôture de C1, ajouter C1-rest comme dormant, et renuméroter les priorités selon l'ordre validé : F2 → A4 → A1.

## Fichier unique modifié

`docs/DEFERRED_BACKLOG.md`

## Changements

### 1. Ligne 46 — C1 passe à `closed`

Remplacer l'entrée C1 par :

| C1 | CaseView.tsx monolithique — extraction progressive | dette | **closed** | — | C1 | **2026-03-26** | Objectif minimal atteint : C1.1 (constantes/types/helpers), C1.2a (FactHistoryPopover), C1.2b (ServiceOverridePanel). CaseView réduit de 2700+ à 2119 lignes (~21%). Smoke tests verts. | — | `src/pages/CaseView.tsx` | chat C1 | Fermé | Aucune action requise |

### 2. Ajouter C1-rest après C1 (nouvelle ligne 47)

| C1-rest | Extractions CaseView restantes (PipelineStepper, TimelineTab, ClientClarifications) | dette | **dormant** | Basse | C1 | 2026-03-26 | Restant volontairement non extrait ; ratio gain/risque insuffisant hors changement UX majeur | Prochain changement UX majeur sur CaseView | `src/pages/CaseView.tsx` | chat C1 | Confirmé | Garder dormant |

### 3. Top priorités futures — renuméroter

| Rang | ID | Sujet | Valeur |
|------|----|-------|--------|
| 1 | F2 | Smoke test M24b | Vérification pricing factuelle — prochaine action immédiate |
| 2 | A4 | Emails de cotation IA | Première priorité produit post-stabilisation |
| 3 | A1 | Fin commerciale post-SENT | Complétude workflow métier |
| 4 | B1 | M23c-fix multi-tenant | Pré-requis ouverture multi-société |
| 5 | F1 | Audit P0 métier | Validation justesse tarifaire |
| 6 | A6 | Intégration SMTP | Automatisation envoi (si décision produit) |
| 7 | D1 | Scroll-to-section | UX polish à fort impact perçu |
| 8 | A3 | Re-pricing après version | Flexibilité opérateur |

### 4. Dernière mise à jour → `2026-03-26`

Déjà à jour.

## Ce qui ne change pas

- Zéro code, zéro migration, zéro edge function
- `.lovable/plan.md` : C1 y figure déjà comme contexte historique, pas comme tâche ouverte — pas de modification nécessaire
- `MASTER_CONTEXT.md`, `STATUS_REGISTRY.md`, `SECURITY_CONTRACT.md` : aucun impact

