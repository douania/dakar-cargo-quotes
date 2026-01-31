
# PHASE 4F.5 - Integration minimale Engine dans QuotationSheet.tsx

## Contexte

Phase 4F.1-4F.4 executees. Le domain layer est pret :
- `src/features/quotation/domain/` contient types, guards, rules, engine
- Tests Vitest 4/4 OK
- Engine expose `runQuotationEngine(input): QuotationEngineResult`

## Analyse du code actuel

### Hooks existants (lignes 157-173)
```typescript
const { cargoLines, setCargoLines, addCargoLine, updateCargoLine, removeCargoLine } = useCargoLines();
const { serviceLines, setServiceLines, addServiceLine, updateServiceLine, removeServiceLine } = useServiceLines();
```

### Calculs inline identifies
- **Ligne 886** : `amount: (line.rate || 0) * line.quantity` dans QuotationExcelExport

### Pas de section "Totaux" affichee
Le fichier ne contient pas de rendu de totaux dans l'UI principale.
L'engine sera utilise pour :
1. Alimenter QuotationExcelExport avec des totaux valides
2. Preparer l'affichage futur d'un recapitulatif

---

## Modifications a effectuer

### 1. Ajout de l'import (ligne ~74)
```typescript
// Domain layer (Phase 4F)
import { runQuotationEngine } from '@/features/quotation/domain/engine';
import type { QuotationInput } from '@/features/quotation/domain/types';
```

### 2. Mapping UI to Domain (apres ligne 179)
```typescript
// Quotation Engine - mapping UI → Domain (Phase 4F.5)
const quotationInput: QuotationInput = {
  cargoLines: cargoLines.map((c, i) => ({
    id: c.id,
    quantity: c.container_count ?? c.pieces ?? 1,
    weight_kg: c.weight_kg ?? null,
    volume_m3: c.volume_cbm ?? null,
    description: c.description || null,
  })),
  serviceLines: serviceLines.map((s) => ({
    id: s.id,
    quantity: s.quantity ?? 1,
    unit_price: s.rate ?? null,
    description: s.description || null,
    service_code: s.service || null,
  })),
  context: { rounding: 'none' },
};

const engineResult = runQuotationEngine(quotationInput);
const quotationTotals = engineResult.snapshot.totals;
```

### 3. Usage dans QuotationExcelExport (optionnel, non bloquant)
Le composant QuotationExcelExport calcule deja `amount` inline.
Phase 4F.5 se limite a rendre `quotationTotals` disponible.
L'integration dans QuotationExcelExport peut etre reportee.

---

## Fichiers modifies

| Fichier | Modification |
|---------|-------------|
| QuotationSheet.tsx | +2 imports, +15 lignes mapping |

## Fichiers NON modifies (verification)

| Fichier | Statut |
|---------|--------|
| CargoLinesForm.tsx | FROZEN - aucun changement |
| ServiceLinesForm.tsx | FROZEN - aucun changement |
| useCargoLines.ts | aucun changement |
| useServiceLines.ts | aucun changement |

---

## Code a ajouter

### Import (apres ligne 126)
```typescript
// Domain layer (Phase 4F)
import { runQuotationEngine } from '@/features/quotation/domain/engine';
import type { QuotationInput } from '@/features/quotation/domain/types';
```

### Mapping + appel engine (apres ligne 179, avant useEffect)
```typescript
// ═══════════════════════════════════════════════════════════════════
// Quotation Engine — Phase 4F.5
// Mapping UI → Domain puis calcul des totaux
// ═══════════════════════════════════════════════════════════════════
const quotationInput: QuotationInput = {
  cargoLines: cargoLines.map((c) => ({
    id: c.id,
    quantity: c.container_count ?? c.pieces ?? 1,
    weight_kg: c.weight_kg ?? null,
    volume_m3: c.volume_cbm ?? null,
    description: c.description || null,
  })),
  serviceLines: serviceLines.map((s) => ({
    id: s.id,
    quantity: s.quantity ?? 1,
    unit_price: s.rate ?? null,
    description: s.description || null,
    service_code: s.service || null,
  })),
  context: { rounding: 'none' },
};

const engineResult = runQuotationEngine(quotationInput);
const quotationTotals = engineResult.snapshot.totals;

// Debug : afficher issues en dev (optionnel)
// if (engineResult.snapshot.issues.length > 0) {
//   console.debug('[QuotationEngine] Issues:', engineResult.snapshot.issues);
// }
```

---

## Verification post-integration

1. **Build TypeScript OK** - aucun type error
2. **Tests Vitest OK** - 23/23 (19 existants + 4 engine)
3. **Rendu visuel identique** - aucun changement UI
4. **Console** - `quotationTotals` disponible pour debug

---

## Impact

| Metrique | Avant | Apres |
|----------|-------|-------|
| Lignes QuotationSheet.tsx | 1005 | ~1022 |
| Imports | 32 | 34 |
| Variables disponibles | - | quotationTotals, engineResult |

---

## Criteres de sortie Phase 4F.5

- Import runQuotationEngine ajoute
- Mapping UI → Domain en place
- Variable `quotationTotals` disponible dans le composant
- Build OK, Tests OK
- Aucun changement visuel
- Composants FROZEN non modifies

---

## Section technique

### Schema d'integration

```text
┌─────────────────────────────────────────────────────────────┐
│                    QuotationSheet.tsx                       │
│                                                             │
│  ┌─────────────┐    ┌──────────────┐                       │
│  │ cargoLines  │    │ serviceLines │  (hooks Phase 4C)     │
│  └──────┬──────┘    └──────┬───────┘                       │
│         │                  │                                │
│         └────────┬─────────┘                                │
│                  ▼                                          │
│  ┌──────────────────────────────────────┐                  │
│  │        quotationInput (mapping)      │ ← NEW (4F.5)     │
│  └──────────────────┬───────────────────┘                  │
│                     │                                       │
│                     ▼                                       │
│  ┌──────────────────────────────────────┐                  │
│  │     runQuotationEngine(input)        │                  │
│  └──────────────────┬───────────────────┘                  │
│                     │                                       │
│                     ▼                                       │
│  ┌──────────────────────────────────────┐                  │
│  │  quotationTotals                     │                  │
│  │  ├─ subtotal_services                │                  │
│  │  ├─ subtotal_cargo_metrics           │                  │
│  │  ├─ total_ht                         │                  │
│  │  └─ total_ttc                        │                  │
│  └──────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

### Mapping champs UI → Domain

| CargoLine (UI) | CargoLineDomain |
|----------------|-----------------|
| id | id |
| container_count ?? pieces ?? 1 | quantity |
| weight_kg | weight_kg |
| volume_cbm | volume_m3 |
| description | description |

| ServiceLine (UI) | ServiceLineDomain |
|------------------|-------------------|
| id | id |
| quantity | quantity |
| rate | unit_price |
| description | description |
| service | service_code |

