
# PHASE 4F - Domain Layer Quotation Engine

## Contexte

- Phase 4E validée (composants FROZEN)
- Architecture existante : `src/features/quotation/` pour les types/composants UI
- Types actuels : `CargoLine` (weight_kg, volume_cbm, container_count) et `ServiceLine` (rate, quantity)
- Pas de taxe dans le formulaire quotation (TVA gérée via HS codes)

## Décision architecturale

Le user propose `src/domain/quotation/` mais le projet utilise déjà `src/features/quotation/`.

**Proposition** : Créer `src/features/quotation/domain/` pour rester cohérent avec l'arborescence existante, tout en séparant clairement la couche métier.

---

## Fichiers à créer (Phase 4F)

```
src/features/quotation/domain/
├── types.ts        (4F.1 - contrat métier)
├── guards.ts       (4F.1 - sanitization)
├── rules.ts        (4F.2 - calculs purs)
├── engine.ts       (4F.3 - orchestrateur)
├── engine.test.ts  (4F.4 - tests Vitest)
└── index.ts        (barrel export)
```

---

## 4F.1 — Contrat métier (types.ts)

**Adaptation aux types existants :**

| Type existant | Champ UI | Champ Domain |
|--------------|----------|--------------|
| CargoLine | weight_kg | weight_kg |
| CargoLine | volume_cbm | volume_m3 (mapping) |
| CargoLine | container_count | quantity |
| ServiceLine | rate | unit_price (mapping) |
| ServiceLine | quantity | quantity |

**Types canoniques à créer :**

```typescript
// Branded types pour la sécurité
export type Money = number;
export type Quantity = number;
export type WeightKg = number;
export type VolumeM3 = number;
export type EntityId = string;

// Interfaces domain (readonly, immutables)
export interface CargoLineDomain { ... }
export interface ServiceLineDomain { ... }
export interface QuotationInput { ... }
export interface QuotationTotals { ... }
export interface QuoteIssue { ... }
export interface QuotationSnapshot { ... }
export interface QuotationEngineResult { ... }
```

---

## 4F.2 — Règles métier (rules.ts)

**Calculs purs sans effet de bord :**

1. `sumCargoMetrics()` - agrège weight_kg, volume_m3, quantity
2. `sumServiceSubtotal()` - calcule quantity × unit_price
3. `computeTotals()` - orchestre et applique arrondi/taxes

**Pas de TVA par défaut** (context.tax_rate optionnel pour future extension)

---

## 4F.3 — Engine (engine.ts)

```typescript
export function runQuotationEngine(input: QuotationInput): QuotationEngineResult
```

- Fonction pure
- Sérialisable (prêt pour API/PDF)
- Collecte les issues (valeurs négatives, NaN, etc.)

---

## 4F.4 — Tests unitaires (engine.test.ts)

```typescript
describe("Quotation Engine", () => {
  it("should compute service subtotal")
  it("should aggregate cargo metrics")
  it("should coerce negative values and record issues")
  it("should apply integer rounding when configured")
})
```

---

## 4F.5 — Intégration minimale (QuotationSheet.tsx)

**Ajout d'import :**
```typescript
import { runQuotationEngine } from '@/features/quotation/domain/engine';
```

**Mapping types UI → Domain :**
```typescript
const domainInput = {
  cargoLines: cargoLines.map(c => ({
    id: c.id,
    quantity: c.container_count ?? c.pieces ?? 1,
    weight_kg: c.weight_kg,
    volume_m3: c.volume_cbm, // mapping cbm → m3
    description: c.description,
  })),
  serviceLines: serviceLines.map(s => ({
    id: s.id,
    quantity: s.quantity,
    unit_price: s.rate, // mapping rate → unit_price
    description: s.description,
  })),
  context: { rounding: "none" },
};

const engineResult = runQuotationEngine(domainInput);
```

**Usage :** `engineResult.snapshot.totals` pour affichage

---

## Contraintes respectées

| Contrainte | Vérification |
|------------|--------------|
| Composants FROZEN non modifiés | ✅ Aucun changement |
| Hooks existants non modifiés | ✅ Aucun changement |
| Pas de nouveau state | ✅ Calcul dérivé |
| Pas de logique UI | ✅ Domain layer pur |
| Pas de modification signatures | ✅ Extension uniquement |

---

## Exécution séquentielle

### Étape 4F.1 (Contrat)
1. Créer `src/features/quotation/domain/types.ts`
2. Créer `src/features/quotation/domain/guards.ts`
3. Créer `src/features/quotation/domain/index.ts` (barrel partiel)

### Étape 4F.2 (Règles)
1. Créer `src/features/quotation/domain/rules.ts`
2. Vérifier build TypeScript

### Étape 4F.3 (Engine)
1. Créer `src/features/quotation/domain/engine.ts`
2. Mettre à jour barrel export

### Étape 4F.4 (Tests)
1. Créer `src/features/quotation/domain/engine.test.ts`
2. Exécuter `pnpm test`

### Étape 4F.5 (Intégration)
1. Ajouter import dans QuotationSheet.tsx
2. Ajouter mapping + appel engine
3. Vérifier build + tests

---

## Critères de sortie

- 5 nouveaux fichiers dans `src/features/quotation/domain/`
- Build TypeScript OK
- Tests Vitest 23/23 (19 existants + 4 nouveaux)
- Aucun diff sur composants FROZEN
- Aucun diff sur hooks Phase 4C
- Engine utilisable pour affichage totaux

---

## Section technique détaillée

### Mapping types existants → domain

```text
CargoLine (UI)                    CargoLineDomain
─────────────                     ───────────────
id: string                   →    id: EntityId
container_count?: number     →    quantity?: Quantity
weight_kg?: number          →    weight_kg?: WeightKg
volume_cbm?: number         →    volume_m3?: VolumeM3
description: string         →    description?: string
(autres champs)             →    meta?: Record<string, unknown>

ServiceLine (UI)                  ServiceLineDomain
─────────────                     ────────────────
id: string                   →    id: EntityId
quantity: number            →    quantity?: Quantity
rate?: number               →    unit_price?: Money
description: string         →    description?: string
(autres champs)             →    meta?: Record<string, unknown>
```

### Schéma d'intégration

```text
┌─────────────────────────────────────────────────────────────┐
│                    QuotationSheet.tsx                       │
│                                                             │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │ useCargoLines│    │useServiceLines│   │ UI Components │  │
│  │  (Phase 4C) │    │  (Phase 4C)  │    │  (FROZEN 4E)  │  │
│  └──────┬──────┘    └──────┬───────┘    └───────────────┘  │
│         │                  │                                │
│         ▼                  ▼                                │
│  ┌──────────────────────────────────────┐                  │
│  │        Mapping UI → Domain           │                  │
│  └──────────────────┬───────────────────┘                  │
│                     │                                       │
│                     ▼                                       │
│  ┌──────────────────────────────────────┐                  │
│  │     runQuotationEngine(input)        │ ← NEW (4F.3)     │
│  │     (src/features/quotation/domain)  │                  │
│  └──────────────────┬───────────────────┘                  │
│                     │                                       │
│                     ▼                                       │
│  ┌──────────────────────────────────────┐                  │
│  │  engineResult.snapshot.totals        │                  │
│  │  → Affichage récapitulatif           │                  │
│  └──────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

### Livrables Phase 4F

| Fichier | Lignes | Rôle |
|---------|--------|------|
| types.ts | ~80 | Contrat métier canonique |
| guards.ts | ~60 | Sanitization non-destructive |
| rules.ts | ~70 | Calculs purs |
| engine.ts | ~25 | Orchestrateur |
| engine.test.ts | ~50 | Tests unitaires |
| index.ts | ~10 | Barrel export |

**Total nouveau code : ~295 lignes**

**Impact QuotationSheet.tsx : +15 lignes** (import + mapping + appel)
