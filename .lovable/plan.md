

# PHASE 4C — Découplage Formulaire (Cargo / Services)

## Objectif

Extraire la logique de gestion des lignes cargo et services dans des hooks dédiés, réduisant la complexité de `QuotationSheet.tsx` sans modifier le comportement.

---

## Analyse du code actuel

| Élément | Emplacement | Détails |
|---------|-------------|---------|
| State `cargoLines` | Ligne 151 | `useState<CargoLine[]>([])` |
| State `serviceLines` | Ligne 154 | `useState<ServiceLine[]>([])` |
| `addCargoLine(type)` | L559-570 | Prend un type `'container' \| 'breakbulk'` |
| `updateCargoLine(id, updates)` | L572-576 | Mise à jour partielle |
| `removeCargoLine(id)` | L578-580 | Suppression par ID |
| `addServiceLine(template?)` | L582-592 | Template optionnel |
| `updateServiceLine(id, updates)` | L594-598 | Mise à jour partielle |
| `removeServiceLine(id)` | L600-602 | Suppression par ID |
| Usage `setCargoLines` | L305 | Dans `applyConsolidatedData` |

### Point d'attention

Les fonctions `addCargoLine` et `addServiceLine` ont des signatures spécifiques :
- `addCargoLine(type: 'container' | 'breakbulk')` — création typée
- `addServiceLine(template?: ServiceTemplate)` — template optionnel

Le hook doit reproduire exactement ces signatures pour une extraction safe.

---

## Fichiers à créer

### 1. `src/features/quotation/hooks/useCargoLines.ts`

```text
/**
 * Hook de gestion des lignes cargo
 * Phase 4C — Extraction safe de QuotationSheet
 */

import { useState, useCallback } from 'react';
import type { CargoLine } from '@/features/quotation/types';

export function useCargoLines(initial: CargoLine[] = []) {
  const [cargoLines, setCargoLines] = useState<CargoLine[]>(initial);

  const addCargoLine = useCallback((type: 'container' | 'breakbulk') => {
    const newLine: CargoLine = {
      id: crypto.randomUUID(),
      description: '',
      origin: '',
      cargo_type: type,
      container_type: type === 'container' ? '40HC' : undefined,
      container_count: type === 'container' ? 1 : undefined,
      coc_soc: 'COC',
    };
    setCargoLines(lines => [...lines, newLine]);
  }, []);

  const updateCargoLine = useCallback((id: string, updates: Partial<CargoLine>) => {
    setCargoLines(lines =>
      lines.map(line => (line.id === id ? { ...line, ...updates } : line))
    );
  }, []);

  const removeCargoLine = useCallback((id: string) => {
    setCargoLines(lines => lines.filter(line => line.id !== id));
  }, []);

  return {
    cargoLines,
    setCargoLines,
    addCargoLine,
    updateCargoLine,
    removeCargoLine,
  };
}
```

---

### 2. `src/features/quotation/hooks/useServiceLines.ts`

```text
/**
 * Hook de gestion des lignes services
 * Phase 4C — Extraction safe de QuotationSheet
 */

import { useState, useCallback } from 'react';
import type { ServiceLine } from '@/features/quotation/types';

interface ServiceTemplate {
  service: string;
  description: string;
  unit: string;
}

export function useServiceLines(initial: ServiceLine[] = []) {
  const [serviceLines, setServiceLines] = useState<ServiceLine[]>(initial);

  const addServiceLine = useCallback((template?: ServiceTemplate) => {
    const newLine: ServiceLine = {
      id: crypto.randomUUID(),
      service: template?.service || '',
      description: template?.description || '',
      unit: template?.unit || 'forfait',
      quantity: 1,
      currency: 'FCFA',
    };
    setServiceLines(lines => [...lines, newLine]);
  }, []);

  const updateServiceLine = useCallback((id: string, updates: Partial<ServiceLine>) => {
    setServiceLines(lines =>
      lines.map(line => (line.id === id ? { ...line, ...updates } : line))
    );
  }, []);

  const removeServiceLine = useCallback((id: string) => {
    setServiceLines(lines => lines.filter(line => line.id !== id));
  }, []);

  return {
    serviceLines,
    setServiceLines,
    addServiceLine,
    updateServiceLine,
    removeServiceLine,
  };
}
```

---

## Modifications dans QuotationSheet.tsx

### 1. Ajout des imports

```typescript
// Après les imports existants
import { useCargoLines } from '@/features/quotation/hooks/useCargoLines';
import { useServiceLines } from '@/features/quotation/hooks/useServiceLines';
```

### 2. Remplacement des states et fonctions

**À supprimer** (lignes 150-154 + 559-602) :

```typescript
// ❌ SUPPRIMER
const [cargoLines, setCargoLines] = useState<CargoLine[]>([]);
const [serviceLines, setServiceLines] = useState<ServiceLine[]>([]);

const addCargoLine = (type: 'container' | 'breakbulk') => { ... };
const updateCargoLine = (id: string, updates: Partial<CargoLine>) => { ... };
const removeCargoLine = (id: string) => { ... };

const addServiceLine = (template?: typeof serviceTemplates[0]) => { ... };
const updateServiceLine = (id: string, updates: Partial<ServiceLine>) => { ... };
const removeServiceLine = (id: string) => { ... };
```

**À ajouter** (après les autres states, ~ligne 161) :

```typescript
// ✅ HOOKS FORMULAIRE
const {
  cargoLines,
  setCargoLines,
  addCargoLine,
  updateCargoLine,
  removeCargoLine,
} = useCargoLines();

const {
  serviceLines,
  setServiceLines,
  addServiceLine,
  updateServiceLine,
  removeServiceLine,
} = useServiceLines();
```

---

## Impact

| Fichier | Lignes supprimées | Lignes ajoutées | Diff net |
|---------|-------------------|-----------------|----------|
| `QuotationSheet.tsx` | ~50 | ~15 | **-35** |
| `useCargoLines.ts` | 0 | ~35 | +35 |
| `useServiceLines.ts` | 0 | ~35 | +35 |

**Total** : +35 lignes mais complexité réduite dans le monolithe

---

## Contraintes respectées

| Contrainte | Statut |
|------------|--------|
| Signatures identiques | ✅ |
| Comportement inchangé | ✅ |
| setCargoLines exposé | ✅ (pour applyConsolidatedData) |
| setServiceLines exposé | ✅ |
| useCallback pour performance | ✅ |
| Aucun JSX modifié | ✅ |
| Aucune logique métier modifiée | ✅ |

---

## Validation attendue

- [ ] Build TypeScript OK
- [ ] Aucun runtime error
- [ ] Formulaire cargo identique
- [ ] Formulaire services identique
- [ ] Génération de réponse identique
- [ ] Tests existants toujours verts (19/19)

---

## Message de clôture attendu

```
Phase 4C exécutée.
2 hooks créés : useCargoLines, useServiceLines
Diff QuotationSheet : -35 lignes
Build OK. Tests 19/19.
```

