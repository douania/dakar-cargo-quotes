

# PHASE 4B.2 — Extraction Bannière Cotation Réalisée

## Analyse du bloc cible

| Élément | Détails |
|---------|---------|
| Lignes source | 749–850 (conditionnel inclus) |
| Condition d'affichage | `quotationCompleted && quotationOffers.length > 0` |
| Icônes utilisées | `CheckCircle`, `Loader2`, `GraduationCap`, `Container`, `Boxes`, `Package`, `FileSpreadsheet`, `Paperclip` |
| Composants UI | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `Button`, `Badge` |
| Helpers internes | `getOfferTypeIcon()`, `getOfferTypeLabel()`, `formatDate()` |

## Props identifiées pour le nouveau composant

| Prop | Type | Usage |
|------|------|-------|
| `quotationOffers` | `QuotationOffer[]` | Liste des offres à afficher |
| `isLearning` | `boolean` | État du bouton d'apprentissage |
| `onLearnFromQuotation` | `() => void` | Callback du bouton "Apprendre" |
| `formatDate` | `(dateStr: string \| null) => string` | Formatage des dates |
| `getOfferTypeIcon` | `(type) => ReactNode` | Icône selon type d'offre |
| `getOfferTypeLabel` | `(type) => string` | Label selon type d'offre |

## Fichier à créer

**Chemin** : `src/features/quotation/components/QuotationCompletedBanner.tsx`

**Structure** :
```text
/**
 * UI COMPONENT — FROZEN (Phase 4B)
 * - Ne pas modifier sans ouvrir une nouvelle phase
 */

// Imports UI (Card, Badge, Button, icônes)
// Import types (QuotationOffer)
// Import cn depuis @/lib/utils

interface QuotationCompletedBannerProps {
  quotationOffers: QuotationOffer[];
  isLearning: boolean;
  onLearnFromQuotation: () => void;
  formatDate: (dateStr: string | null) => string;
  getOfferTypeIcon: (type: 'container' | 'breakbulk' | 'combined') => React.ReactNode;
  getOfferTypeLabel: (type: 'container' | 'breakbulk' | 'combined') => string;
}

export function QuotationCompletedBanner({ ... }) {
  // JSX copié strictement identique (lignes 750-849)
}
```

## Modifications dans QuotationSheet.tsx

### 1. Ajout de l'import

```typescript
// Après les imports existants de features/quotation/components
import { QuotationCompletedBanner } from '@/features/quotation/components/QuotationCompletedBanner';
```

### 2. Remplacement du bloc JSX (lignes 749-850)

**Avant** :
```typescript
{quotationCompleted && quotationOffers.length > 0 && (
  <Card className="border-green-500/30 bg-green-500/5">
    {/* ~100 lignes de JSX */}
  </Card>
)}
```

**Après** :
```typescript
{quotationCompleted && quotationOffers.length > 0 && (
  <QuotationCompletedBanner
    quotationOffers={quotationOffers}
    isLearning={isLearning}
    onLearnFromQuotation={handleLearnFromQuotation}
    formatDate={formatDate}
    getOfferTypeIcon={getOfferTypeIcon}
    getOfferTypeLabel={getOfferTypeLabel}
  />
)}
```

---

## Fichiers impactés

| Fichier | Action |
|---------|--------|
| `src/features/quotation/components/QuotationCompletedBanner.tsx` | **Créer** — Nouveau composant FROZEN |
| `src/pages/QuotationSheet.tsx` | **Modifier** — Import + remplacement bloc |

---

## Validation

- [ ] Build TypeScript OK
- [ ] Aucun runtime error
- [ ] Tests Vitest 5/5 (ThreadTimelineCard)
- [ ] Rendu visuel strictement identique
- [ ] Commentaire FREEZE présent

---

## Message de clôture attendu

```
Phase 4B.2 exécutée.
Bannière extraite et gelée.
Fichier créé : QuotationCompletedBanner.tsx
Diff QuotationSheet : ~100 lignes → 8 lignes
Build OK. Tests 5/5.
```

