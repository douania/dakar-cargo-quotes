

# FIX — Lenteur "Nouvelle cotation" (QuotationSheet)

## Diagnostic complet

| Cause | Impact | Priorité |
|-------|--------|----------|
| `runQuotationEngine` sans memoization | **CRITIQUE** — recalcul à chaque render | P0 |
| Warnings `forwardRef` React | Mineur — bruit console | P2 |
| 20+ `useState` sans splitting | Moyen — re-renders cascade | P1 |
| Fonctions inline non memoizées | Moyen — nouvelles références à chaque render | P1 |

---

## Solution en 3 parties

### PARTIE 1 — Memoization du Quotation Engine (P0)

Actuellement le calcul est fait à chaque render (ligne 220) :
```typescript
// ❌ PROBLÈME : exécuté à CHAQUE render
const engineResult = runQuotationEngine(quotationInput);
```

**Correction** : Wrapper avec `useMemo` pour ne recalculer que si les données changent :

```typescript
// ✅ SOLUTION : recalcul uniquement si cargoLines ou serviceLines changent
const engineResult = useMemo(() => {
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
  return runQuotationEngine(quotationInput);
}, [cargoLines, serviceLines]);

const quotationTotals = engineResult.snapshot.totals;
```

---

### PARTIE 2 — Correction des warnings `forwardRef` (P2)

Les composants sont passés comme éléments à `<Route>` et React tente d'y attacher des refs.

**Fichiers concernés** :
- `src/pages/QuotationSheet.tsx`
- `src/components/layout/MainLayout.tsx`

**Correction** : Wrapper avec `forwardRef` ou ignorer (cosmétique seulement).

Option A — Ignorer (car React Router n'a pas besoin de la ref) :
```typescript
// Pas de modification nécessaire, c'est un warning inoffensif
```

Option B — Supprimer le warning proprement :
```typescript
// MainLayout.tsx
import { forwardRef } from 'react';

export const MainLayout = forwardRef<HTMLDivElement, MainLayoutProps>(
  function MainLayout({ children }, ref) {
    return (
      <SidebarProvider>
        <div ref={ref} className="min-h-screen flex w-full">
          {/* ... */}
        </div>
      </SidebarProvider>
    );
  }
);
```

---

### PARTIE 3 — Memoization des handlers (P1)

Plusieurs fonctions sont recréées à chaque render, causant des re-renders des composants enfants.

**Exemples à corriger** :

```typescript
// Avant
const formatDate = (date: string) => { ... };

// Après
const formatDate = useCallback((date: string) => {
  return format(new Date(date), 'dd MMM yyyy HH:mm', { locale: fr });
}, []);
```

---

## Fichiers modifiés

| Fichier | Action | Description |
|---------|--------|-------------|
| `src/pages/QuotationSheet.tsx` | MODIFIER | Ajouter `useMemo` autour de `runQuotationEngine` |
| `src/components/layout/MainLayout.tsx` | OPTIONNEL | Ajouter `forwardRef` pour supprimer le warning |

---

## Impact attendu

| Métrique | Avant | Après |
|----------|-------|-------|
| Recalculs engine | À chaque keypress | Seulement si données cargo/service changent |
| Warnings console | 2 warnings forwardRef | 0 warnings |
| Perception UX | "Rame" au chargement | Fluide |

---

## Section technique

### Pourquoi le problème se manifeste au clic "Nouvelle cotation" ?

1. Navigation vers `/quotation/new`
2. React monte `QuotationSheet` → initialisation de 20+ états
3. `useCargoLines` et `useServiceLines` initialisent leurs états
4. Le render initial appelle `runQuotationEngine` avec les valeurs par défaut
5. Chaque micro-changement d'état (ex: sidebar animation) déclenche un re-render
6. Sans `useMemo`, le moteur de cotation recalcule à chaque fois

### Architecture optimisée

```text
┌─────────────────────────────────────────────────────────────┐
│  QuotationSheet (mount)                                    │
│      │                                                      │
│      ├── cargoLines: []                                    │
│      ├── serviceLines: []                                  │
│      │                                                      │
│      ▼                                                      │
│  useMemo([cargoLines, serviceLines])                       │
│      │                                                      │
│      └── runQuotationEngine() ── une seule fois            │
│                                                             │
│  ... user ajoute une ligne cargo ...                       │
│      │                                                      │
│      ▼                                                      │
│  cargoLines change → useMemo invalide                      │
│      │                                                      │
│      └── runQuotationEngine() ── recalcul                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Critères de sortie

- [ ] `runQuotationEngine` wrappé dans `useMemo`
- [ ] Pas de recalcul lors de changements d'état non liés (ex: timelineExpanded)
- [ ] Warnings `forwardRef` optionnellement corrigés
- [ ] Chargement de `/quotation/new` fluide (< 200ms perçu)
- [ ] Aucun composant FROZEN modifié

