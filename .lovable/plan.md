

# Integration PROMAD — Patch final corrige apres audit reel

## Correction CTO importante

Le `ratesMap` mentionne dans la review CTO **n'existe pas** dans `quotation-engine`. Les taux sont lus directement depuis `hs_codes` par article. La table `tax_rates` n'est jamais chargee globalement.

La requete dediee avant la boucle est donc le bon pattern — minimal, isole, sans refactor.

## Modifications (4 fichiers)

### 1. `supabase/functions/calculate-duties/index.ts`

Apres le bloc COSEC (ligne ~227), ajouter :

```text
// PROMAD (2% CAF — hors base TVA)
const promadRateRaw = getTaxRate('PROMAD');
const promadRate = typeof promadRateRaw === 'number' ? promadRateRaw : 0;

const isPromadExempt =
  normalizedCode.startsWith('1006') ||
  normalizedCode.startsWith('1001') ||
  normalizedCode.startsWith('1003') ||
  normalizedCode.startsWith('30');

const effectivePromadRate = isPromadExempt ? 0 : promadRate;
const promadAmount = Math.round(caf_value * (effectivePromadRate / 100));

breakdown.push({
  name: 'PROMAD',
  code: 'PROMAD',
  rate: effectivePromadRate,
  base: caf_value,
  amount: promadAmount,
  notes: isPromadExempt ? 'Exempte (produit exonere PROMAD)' : undefined,
});
```

Ajouter `'PROMAD'` dans l'agregation `droits_douane` (ligne ~350) :
```text
['DD', 'SURTAXE', 'RS', 'PCS', 'PCC', 'COSEC', 'PROMAD']
```

Aucune modification de `baseTVA`.

### 2. `supabase/functions/quotation-engine/index.ts`

**Avant la boucle (ligne ~2229)**, requete dediee unique :

```text
// PROMAD rate — loaded once before article loop
let promadRate = 0;
{
  const { data: promadRow } = await supabase
    .from('tax_rates')
    .select('rate')
    .eq('code', 'PROMAD')
    .eq('is_active', true)
    .maybeSingle();
  if (promadRow) promadRate = parseFloat(promadRow.rate) || 0;
}
```

**Dans la boucle, apres cosecAmount (ligne ~2249)** :

```text
// PROMAD — exemptions produit (riz, ble, orge, pharma)
const isPromadExempt =
  hsNormalized.startsWith('1006') ||
  hsNormalized.startsWith('1001') ||
  hsNormalized.startsWith('1003') ||
  hsNormalized.startsWith('30');
const promadAmount = Math.round(
  isPromadExempt ? 0 : cafForArticle * (promadRate / 100)
);
```

**Ligne 2260 — commentaire de securite** :

```text
const baseVAT = cafForArticle + ddAmount + surtaxeAmount + rsAmount + tinAmount + tciAmount;
// PROMAD excluded from VAT base intentionally (parafiscal, same as COSEC/PCS)
```

**Ligne 2264 — ajouter promadAmount** :

```text
const articleDuties = ddAmount + rsAmount + surtaxeAmount + tinAmount
  + tciAmount + pcsAmount + pccAmount + cosecAmount + promadAmount + tvaAmount;
```

**Lignes 2285-2286 — ajouter dans dutyBreakdown.push()** :

```text
cosec_rate: hs.cosec || 0, cosec_amount: Math.round(cosecAmount),
promad_rate: promadRate, promad_amount: Math.round(promadAmount),
```

### 3. `src/hooks/usePricingResultData.ts`

Ajouter deux champs optionnels dans `DutyBreakdownItem` :

```text
promad_rate?: number;
promad_amount?: number;
```

### 4. `src/components/puzzle/DutyBreakdownTable.tsx`

Ajouter colonne PROMAD dans `taxColumns`, apres COSEC :

```text
{ label: 'PROMAD', rateKey: 'promad_rate', amountKey: 'promad_amount' },
```

## Justification de la requete dediee (vs ratesMap)

| Point | Realite du code |
|---|---|
| `ratesMap` dans quotation-engine | N'existe pas |
| Source des taux DD/RS/TVA... | Table `hs_codes` par article |
| Source de PROMAD | Table `tax_rates` (taux unique global) |
| Pattern existant | Aucun chargement global de `tax_rates` |

La requete dediee est le choix le plus chirurgical. Refactorer pour creer un `ratesMap` global serait un changement d'architecture hors scope.

## Ce qui ne change PAS

- Zero migration DB
- Base TVA/VAT inchangee (commentaire ajoute pour securite future)
- Aucune autre taxe modifiee
- Idempotence preservee
- Retrocompatibilite UI (champs optionnels)

