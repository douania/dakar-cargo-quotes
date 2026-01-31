
# PHASE 4D - Extraction UI Formulaires (Cargo / Services)

## Contexte

Phase 4C validee. Hooks `useCargoLines` et `useServiceLines` extraits et fonctionnels.
Objectif Phase 4D : Extraire le JSX des formulaires vers des composants UI purs.

---

## Analyse du code actuel

### Formulaire Cargo (lignes 779-939)
```text
Localisation : QuotationSheet.tsx L779-939 (~160 lignes)
Contenu :
- Card avec header incluant boutons "Conteneur" / "Breakbulk"
- Empty state avec icone Package
- Liste iterative des cargoLines
  - Badge cargo_type (container/breakbulk)
  - Bouton supprimer
  - Champs : description, origin
  - Champs container : type (Select), count, coc_soc (Select), weight_kg
  - Champs breakbulk : weight_kg, volume_cbm, dimensions, pieces
```

### Formulaire Services (lignes 1002-1092)
```text
Localisation : QuotationSheet.tsx L1002-1092 (~90 lignes)
Contenu :
- Card avec header incluant Select pour ajouter service
- Empty state avec badges cliquables (serviceTemplates)
- Liste iterative des serviceLines
  - Input description
  - Input quantity
  - Input unit
  - Input rate
  - Bouton supprimer
```

---

## Fichiers a creer

### 1. `src/features/quotation/components/CargoLinesForm.tsx`

**Props interface :**
```typescript
interface CargoLinesFormProps {
  cargoLines: CargoLine[];
  addCargoLine: (type: 'container' | 'breakbulk') => void;
  updateCargoLine: (id: string, updates: Partial<CargoLine>) => void;
  removeCargoLine: (id: string) => void;
}
```

**Imports necessaires :**
- React (Fragment)
- UI : Card, CardHeader, CardTitle, CardContent, Button, Input, Label, Badge, Select, SelectTrigger, SelectValue, SelectContent, SelectItem
- Icons : Package, Container, Boxes, Trash2
- Types : CargoLine
- Constants : containerTypes

**Copie stricte du JSX :**
- Lignes 779-939 de QuotationSheet.tsx
- Aucune modification logique

---

### 2. `src/features/quotation/components/ServiceLinesForm.tsx`

**Props interface :**
```typescript
interface ServiceTemplate {
  service: string;
  description: string;
  unit: string;
}

interface ServiceLinesFormProps {
  serviceLines: ServiceLine[];
  addServiceLine: (template?: ServiceTemplate) => void;
  updateServiceLine: (id: string, updates: Partial<ServiceLine>) => void;
  removeServiceLine: (id: string) => void;
}
```

**Imports necessaires :**
- React (Fragment)
- UI : Card, CardHeader, CardTitle, CardContent, Button, Input, Badge, Select, SelectTrigger, SelectValue, SelectContent, SelectItem
- Icons : DollarSign, Plus, Trash2
- Types : ServiceLine
- Constants : serviceTemplates

**Copie stricte du JSX :**
- Lignes 1002-1092 de QuotationSheet.tsx
- Aucune modification logique

---

## Modifications dans QuotationSheet.tsx

### Phase 4D.3 - Integration

**Nouveaux imports a ajouter :**
```typescript
import { CargoLinesForm } from '@/features/quotation/components/CargoLinesForm';
import { ServiceLinesForm } from '@/features/quotation/components/ServiceLinesForm';
```

**Remplacement du JSX Cargo (L779-939) :**
```typescript
<CargoLinesForm
  cargoLines={cargoLines}
  addCargoLine={addCargoLine}
  updateCargoLine={updateCargoLine}
  removeCargoLine={removeCargoLine}
/>
```

**Remplacement du JSX Services (L1002-1092) :**
```typescript
<ServiceLinesForm
  serviceLines={serviceLines}
  addServiceLine={addServiceLine}
  updateServiceLine={updateServiceLine}
  removeServiceLine={removeServiceLine}
/>
```

---

## Impact attendu

| Fichier | Lignes supprimees | Lignes ajoutees | Diff net |
|---------|-------------------|-----------------|----------|
| QuotationSheet.tsx | ~250 | ~12 | **-238** |
| CargoLinesForm.tsx | 0 | ~170 | +170 |
| ServiceLinesForm.tsx | 0 | ~100 | +100 |

**Total QuotationSheet.tsx apres Phase 4D :** ~1000 lignes (vs ~1240 actuelles)

---

## Contraintes respectees

| Contrainte | Verification |
|------------|--------------|
| Pas de modification logique metier | Copie stricte du JSX |
| Pas de modification des hooks | Aucun changement |
| Pas de creation de nouveaux states | Props only |
| Pas de deplacement de fonctions | Handlers passes via props |
| Pas de tests | Aucun fichier test |
| Signatures identiques | Props = handlers existants |
| Pas de gel (FROZEN) | Report Phase suivante |

---

## Execution sequentielle

### Etape 4D.1 - CargoLinesForm
1. Creer `src/features/quotation/components/CargoLinesForm.tsx`
2. Copier JSX L779-939 strictement
3. Definir props interface
4. Verifier build TypeScript

### Etape 4D.2 - ServiceLinesForm
1. Creer `src/features/quotation/components/ServiceLinesForm.tsx`
2. Copier JSX L1002-1092 strictement
3. Definir props interface
4. Verifier build TypeScript

### Etape 4D.3 - Integration
1. Ajouter imports dans QuotationSheet.tsx
2. Remplacer JSX Cargo par composant
3. Remplacer JSX Services par composant
4. Verifier build TypeScript
5. Verification visuelle (rendu identique)

---

## Criteres de sortie

- Build TypeScript OK
- Aucun runtime error
- Rendu formulaire Cargo identique (visuel + interaction)
- Rendu formulaire Services identique (visuel + interaction)
- QuotationSheet.tsx reduit de ~238 lignes
- Tests existants toujours verts (19/19)

---

## Message de cloture attendu

```
Phase 4D executee.
2 composants UI crees : CargoLinesForm, ServiceLinesForm
Diff QuotationSheet : -238 lignes (~1000 lignes restantes)
Build OK. Tests 19/19.
```

---

## Section technique

### Structure CargoLinesForm.tsx
```text
src/features/quotation/components/CargoLinesForm.tsx

export function CargoLinesForm({
  cargoLines,
  addCargoLine,
  updateCargoLine,
  removeCargoLine,
}: CargoLinesFormProps) {
  return (
    <Card className="border-border/50 bg-gradient-card">
      {/* Header avec boutons Conteneur/Breakbulk */}
      {/* Empty state */}
      {/* Liste cargoLines.map(...) */}
    </Card>
  );
}
```

### Structure ServiceLinesForm.tsx
```text
src/features/quotation/components/ServiceLinesForm.tsx

export function ServiceLinesForm({
  serviceLines,
  addServiceLine,
  updateServiceLine,
  removeServiceLine,
}: ServiceLinesFormProps) {
  return (
    <Card className="border-border/50 bg-gradient-card">
      {/* Header avec Select ajouter service */}
      {/* Empty state avec badges */}
      {/* Liste serviceLines.map(...) */}
    </Card>
  );
}
```

### Mapping des handlers

| QuotationSheet | Prop | Composant |
|----------------|------|-----------|
| `addCargoLine` | `addCargoLine` | CargoLinesForm |
| `updateCargoLine` | `updateCargoLine` | CargoLinesForm |
| `removeCargoLine` | `removeCargoLine` | CargoLinesForm |
| `addServiceLine` | `addServiceLine` | ServiceLinesForm |
| `updateServiceLine` | `updateServiceLine` | ServiceLinesForm |
| `removeServiceLine` | `removeServiceLine` | ServiceLinesForm |

