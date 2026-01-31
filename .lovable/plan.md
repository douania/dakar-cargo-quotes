

# PHASE 5B - Recapitulatif visuel Totaux

## Objectif

Creer un composant UI affichant les totaux calcules par l'engine :
- Metriques cargo (poids, volume, quantite)
- Totaux financiers (sous-total services, HT, TTC)
- Alertes issues de l'engine (valeurs negatives coercees, etc.)

---

## Architecture

### Nouveau fichier a creer

```
src/features/quotation/components/QuotationTotalsCard.tsx
```

### Emplacement dans QuotationSheet.tsx

Apres `ServiceLinesForm` (ligne 884), avant le bloc `generatedResponse` (ligne 888) :

```text
├── CargoLinesForm (FROZEN)
├── Route & Incoterm Card
├── ServiceLinesForm (FROZEN)
├── QuotationTotalsCard   ← NOUVEAU (Phase 5B)
├── Generated Response
```

---

## Composant QuotationTotalsCard

### Props

```typescript
interface QuotationTotalsCardProps {
  totals: QuotationTotals;
  currency?: string;
  issues?: ReadonlyArray<QuoteIssue>;
}
```

### Structure visuelle

```text
┌─────────────────────────────────────────────────────────────┐
│  Calculator  Recapitulatif                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   POIDS     │  │   VOLUME    │  │   QTE       │         │
│  │  1,250 kg   │  │  45.2 m3    │  │   3         │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                             │
│  ───────────────────────────────────────────────────────   │
│                                                             │
│  Sous-total services                    1,250,000 FCFA     │
│  Total HT                               1,250,000 FCFA     │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ! Valeur negative ramenee a 0 (serviceLines[2])   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Comportement

- Affiche les metriques cargo (poids/volume/quantite) en grid 3 colonnes
- Affiche sous-total services et total HT
- Affiche total_tax et total_ttc UNIQUEMENT si tax > 0
- Affiche les issues de l'engine en zone d'alerte jaune
- Ne s'affiche PAS si quotationCompleted === true (coherent avec les autres formulaires)

---

## Code du composant

```typescript
/**
 * UI COMPONENT — Phase 5B
 * QuotationTotalsCard - Affichage recapitulatif des totaux engine
 * Aucune logique metier, props only
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { AlertTriangle, Calculator, Package, Scale, Box } from 'lucide-react';
import type { QuotationTotals, QuoteIssue } from '@/features/quotation/domain/types';

interface QuotationTotalsCardProps {
  totals: QuotationTotals;
  currency?: string;
  issues?: ReadonlyArray<QuoteIssue>;
}

function formatNumber(value: number, decimals = 0): string {
  return value.toLocaleString('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatMoney(amount: number, currency: string): string {
  return `${formatNumber(amount)} ${currency}`;
}

export function QuotationTotalsCard({
  totals,
  currency = 'FCFA',
  issues = [],
}: QuotationTotalsCardProps) {
  const { subtotal_cargo_metrics, subtotal_services, total_ht, total_tax, total_ttc } = totals;
  const hasTax = total_tax > 0;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Calculator className="h-4 w-4 text-primary" />
          Recapitulatif
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Metriques cargo */}
        <div className="grid grid-cols-3 gap-4">
          <MetricItem
            icon={<Scale className="h-4 w-4 text-muted-foreground" />}
            label="Poids total"
            value={formatNumber(subtotal_cargo_metrics.total_weight_kg)}
            unit="kg"
          />
          <MetricItem
            icon={<Box className="h-4 w-4 text-muted-foreground" />}
            label="Volume total"
            value={formatNumber(subtotal_cargo_metrics.total_volume_m3, 2)}
            unit="m3"
          />
          <MetricItem
            icon={<Package className="h-4 w-4 text-muted-foreground" />}
            label="Quantite"
            value={formatNumber(subtotal_cargo_metrics.total_quantity)}
          />
        </div>

        <Separator />

        {/* Totaux financiers */}
        <div className="space-y-2">
          <TotalRow
            label="Sous-total services"
            amount={subtotal_services}
            currency={currency}
          />
          <TotalRow
            label="Total HT"
            amount={total_ht}
            currency={currency}
            bold
          />
          {hasTax && (
            <>
              <TotalRow
                label="TVA"
                amount={total_tax}
                currency={currency}
              />
              <TotalRow
                label="Total TTC"
                amount={total_ttc}
                currency={currency}
                bold
                highlight
              />
            </>
          )}
        </div>

        {/* Issues / Alertes engine */}
        {issues.length > 0 && (
          <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                Alertes de calcul
              </span>
            </div>
            <div className="space-y-1">
              {issues.map((issue, i) => (
                <p key={i} className="text-xs text-yellow-700 dark:text-yellow-300">
                  {issue.message}
                  {issue.path && <span className="text-yellow-500"> ({issue.path})</span>}
                </p>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Sous-composants internes

function MetricItem({
  icon,
  label,
  value,
  unit,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="text-center p-3 rounded-lg bg-muted/30">
      <div className="flex items-center justify-center gap-1 mb-1">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-lg font-semibold">
        {value}
        {unit && <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span>}
      </p>
    </div>
  );
}

function TotalRow({
  label,
  amount,
  currency,
  bold = false,
  highlight = false,
}: {
  label: string;
  amount: number;
  currency: string;
  bold?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between py-1 ${
        highlight ? 'bg-primary/10 px-2 rounded -mx-2' : ''
      }`}
    >
      <span className={`text-sm ${bold ? 'font-medium' : 'text-muted-foreground'}`}>
        {label}
      </span>
      <span className={`text-sm ${bold ? 'font-semibold' : ''}`}>
        {formatMoney(amount, currency)}
      </span>
    </div>
  );
}
```

---

## Integration dans QuotationSheet.tsx

### 1. Import (apres ligne 127)

```typescript
import { QuotationTotalsCard } from '@/features/quotation/components/QuotationTotalsCard';
```

### 2. Rendu (apres ServiceLinesForm, ligne 884)

```typescript
{/* Services to Quote */}
<ServiceLinesForm
  serviceLines={serviceLines}
  addServiceLine={addServiceLine}
  updateServiceLine={updateServiceLine}
  removeServiceLine={removeServiceLine}
/>

{/* Recapitulatif Totaux - Phase 5B */}
<QuotationTotalsCard
  totals={quotationTotals}
  currency="FCFA"
  issues={engineResult.snapshot.issues}
/>
```

Le composant est rendu a l'interieur du bloc `{!quotationCompleted && ( ... )}` donc il ne s'affiche pas quand le devis est complete.

---

## Fichiers modifies/crees

| Fichier | Action | Lignes |
|---------|--------|--------|
| QuotationTotalsCard.tsx | CREER | ~130 |
| QuotationSheet.tsx | +1 import, +5 lignes rendu | ~6 |

## Fichiers NON modifies

| Fichier | Statut |
|---------|--------|
| CargoLinesForm.tsx | FROZEN |
| ServiceLinesForm.tsx | FROZEN |
| useCargoLines.ts | Aucun changement |
| useServiceLines.ts | Aucun changement |
| domain/engine.ts | Aucun changement |

---

## Tests visuels attendus

1. **Metriques cargo affichees** : poids, volume, quantite depuis l'engine
2. **Totaux corrects** : sous-total = somme(rate * quantity) des services
3. **Pas de TVA** : section TVA/TTC masquee (context.tax_rate = 0)
4. **Issues affichees** : si valeurs negatives ou invalides saisies
5. **Masque automatique** : composant invisible si quotationCompleted = true

---

## Criteres de sortie Phase 5B

- [ ] Fichier QuotationTotalsCard.tsx cree
- [ ] Import ajoute dans QuotationSheet.tsx
- [ ] Rendu ajoute apres ServiceLinesForm
- [ ] Totaux reactifs (changement serviceLines = mise a jour immediate)
- [ ] Build TypeScript OK
- [ ] Aucun composant FROZEN modifie

---

## Section technique

### Flux de donnees

```text
cargoLines (hook)    serviceLines (hook)
      │                     │
      └──────────┬──────────┘
                 ▼
    quotationInput (mapping Phase 4F.5)
                 │
                 ▼
    runQuotationEngine(quotationInput)
                 │
                 ▼
    engineResult.snapshot
         │              │
         ▼              ▼
   .totals         .issues
         │              │
         └──────┬───────┘
                ▼
    <QuotationTotalsCard
      totals={quotationTotals}
      issues={engineResult.snapshot.issues}
    />
```

### Reactivite

Le composant est recalcule a chaque modification de `cargoLines` ou `serviceLines` car :
1. Les hooks declenchent un re-render
2. `quotationInput` est recalcule (mapping inline)
3. `runQuotationEngine()` retourne de nouveaux totaux
4. `QuotationTotalsCard` affiche les nouvelles valeurs

Pas de state supplementaire, pas de useEffect, pas de memo necessaire.

