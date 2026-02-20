

# Clarification des labels TTC vs DDP dans l'UI

## Probleme

Les labels actuels "Total TTC" et "Total DDP" sont ambigus pour le client final. Il peut croire a une incoherence alors que ce sont deux perimetre de couts differents.

## Composants concernes

### 1. `src/components/QuotationCostBreakdown.tsx`

**Ligne 167** : "Total DDP" (vue compacte)
- Ajouter un sous-label explicatif : "Cout complet livre"
- Ajouter un tooltip sur le label normal (pas seulement quand TBC)

**Ligne 534** : "TOTAL DDP" (vue detaillee)
- Remplacer par : "TOTAL DDP (cout complet livre)"

**Ligne 158** : "Total DAP"
- Ajouter un sous-label : "Hors droits et taxes"

### 2. `src/features/quotation/components/QuotationTotalsCard.tsx`

**Ligne "Total HT"** (environ ligne 120) : Garder tel quel, c'est clair.

**Ligne "Total TTC"** (environ ligne 130) :
- Remplacer le label par : "Total TTC (hors couts port & transport)"
- Ajouter un tooltip explicatif : "Ce total inclut les droits, taxes et honoraires. Les frais portuaires et de transport sont inclus dans le Total DDP."

### 3. `src/components/puzzle/PricingResultPanel.tsx`

**Ligne 140** : "Total HT" dans le panneau de resultats pricing.
- Pas de changement necessaire, le label est correct dans ce contexte.

## Detail technique des modifications

### QuotationCostBreakdown.tsx - Vue compacte (lignes 157-184)

Modifier le label "Total DAP" :
```text
<span className="font-medium">
  Total DAP
  <span className="text-xs font-normal text-muted-foreground ml-1">(hors droits & taxes)</span>
</span>
```

Modifier le label "Total DDP" avec tooltip permanent :
```text
<span className="flex items-center gap-1">
  Total DDP
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger>
        <Info className="h-3 w-3 text-muted-foreground" />
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">Cout complet livre : operationnel + honoraires + droits & taxes</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</span>
```

### QuotationCostBreakdown.tsx - Vue detaillee (ligne 534)

Remplacer :
```text
<span className="font-semibold">TOTAL DDP</span>
```
Par :
```text
<span className="font-semibold">TOTAL DDP <span className="text-xs font-normal">(cout complet livre)</span></span>
```

### QuotationTotalsCard.tsx (lignes 126-133)

Modifier le label "Total TTC" :
```text
<TotalRow
  label="Total TTC (fiscal, hors port & transport)"
  amount={total_ttc}
  currency={currency}
  bold
  highlight
/>
```

## Import supplementaire

Ajouter `Info` depuis `lucide-react` dans `QuotationCostBreakdown.tsx` (si pas deja importe).

## Ce qui ne change PAS

- Aucune logique metier
- Aucun calcul modifie
- Zero migration DB
- Les montants restent identiques
- Le PricingResultPanel (affiche Total HT, correct)

