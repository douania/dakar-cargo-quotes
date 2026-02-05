
# Plan Phase 12 - Orchestration UI Analyse

## ✅ Implémentation terminée

### Patch orchestration Phase 12 — Version CTO Sécurisée

**Objectif** : Chaîner `build-case-puzzle` après `ensure-quote-case` avec vérification des facts existants pour garantir idempotence et sécurité forensic.

---

## Corrections CTO appliquées

| Risque identifié | Correction | Status |
|------------------|------------|--------|
| `is_new` bloque replay | Remplacé par `factsCount === 0` | ✅ |
| Double-clic / retry réseau | Vérification facts avant invocation + `isBuildingPuzzle` state | ✅ |
| UI stale après puzzle | Invalidation React Query `quote_facts` + `quote_gaps` + `quote-case` | ✅ |

---

## Modification : `src/pages/QuotationSheet.tsx`

### Changements effectués

1. **Nouveau state** (ligne ~176) :
```typescript
const [isBuildingPuzzle, setIsBuildingPuzzle] = useState(false);
```

2. **Handler `handleStartAnalysis` remplacé** (lignes ~307-383) :
   - Garde anti double-clic combinée : `isStartingAnalysis || isBuildingPuzzle`
   - Vérification facts existants via `SELECT count(*) FROM quote_facts`
   - Appel `build-case-puzzle` SEULEMENT si `factsCount === 0`
   - Invalidation React Query : `quote_facts`, `quote_gaps`, `quote-case`

---

## Comportement validé

| Scénario | Résultat |
|----------|----------|
| Case neuf | `ensure-quote-case` → `build-case-puzzle` → facts générés |
| Case existant sans facts | `ensure-quote-case` (existant) → `build-case-puzzle` → facts générés |
| Case existant avec facts | `ensure-quote-case` (existant) → puzzle skipped |
| Double-clic | Bloqué par `isStartingAnalysis \|\| isBuildingPuzzle` |
| Retry réseau | Facts vérifiés avant puzzle → pas de duplication |
| Reload page | Même comportement via vérification DB |

---

## Tests opérateurs Phase 12

| Test | Action | Attendu |
|------|--------|---------|
| TEST 1 | Création case neuf | Facts générés automatiquement |
| TEST 2 | Reload thread existant | Facts détectés → puzzle non relancé |
| TEST 3 | Double clic | 1 seul run puzzle |
| TEST 4 | Retry réseau | Aucune duplication facts |
| TEST 5 | Forensic audit | Facts reliés au corpus correct |

---

## Exclusions CTO respectées

| Élément | Action |
|---------|--------|
| Refactor global | NON |
| Logique métier modifiée | NON |
| DecisionSupportPanel | NON modifié |
| Structure DB | NON modifiée |
| Edge Functions | NON modifiées |

---

## Flux corrigé

```text
┌─────────────────────────────────────────────────────────────────┐
│              handleStartAnalysis (bouton UI)                    │
├─────────────────────────────────────────────────────────────────┤
│  1. Garde: stableThreadRef + anti double-clic                   │
│                        │                                        │
│                        ▼                                        │
│  2. ensure-quote-case(thread_id)                                │
│        → Retourne case_id + status                              │
│                        │                                        │
│                        ▼                                        │
│  3. SELECT count(*) FROM quote_facts WHERE case_id = ?          │
│                        │                                        │
│              ┌─────────┴─────────┐                              │
│              │                   │                              │
│        count = 0           count > 0                            │
│              │                   │                              │
│              ▼                   ▼                              │
│  4. build-case-puzzle     Skip + log                            │
│              │                                                  │
│              ▼                                                  │
│  5. invalidateQueries(['quote_facts'], ['quote_gaps'])          │
└─────────────────────────────────────────────────────────────────┘
```
