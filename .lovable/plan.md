

# Phase PRICING V3.3 -- Client Overrides PERCENTAGE (Correction CTO)

## Principe

Activer le mode `PERCENTAGE` dans le resolver `client_override` sans modifier aucun resolver existant. L'approche utilise une fonction interne `resolveWithoutClientOverride()` qui re-execute la cascade downstream pour obtenir le prix fallback, puis applique le pourcentage.

## Strategie technique (correction CTO appliquee)

Le plan initial proposait de modifier chaque resolver pour stocker dans une variable `fallbackLine`. La correction CTO interdit cela. A la place :

1. Quand `pricing_mode === "PERCENTAGE"` est detecte dans le bloc client_override (ligne 710-712)
2. On appelle une nouvelle fonction `resolveWithoutClientOverride()` qui execute la cascade (customs_tier CAF, customs_weight, catalogue, rate_card, port_tariff) avec les memes parametres
3. Si un fallback est trouve, on applique : `fallback.rate * override.base_price / 100`, puis modifiers, puis min_price
4. Si aucun fallback, la ligne tombe en `no_match` normalement

## Modification unique : `supabase/functions/price-service-lines/index.ts`

### Changement 1 : Nouvelle fonction interne (~80 lignes)

Ajouter avant le `Deno.serve()` (vers ligne 470) une fonction :

```text
async function resolveWithoutClientOverride(
  serviceKey: string,
  computed: { quantity_used: number; unit_used: string; rule_id: string | null; conversion_used?: string },
  pricingCtx: PricingContext,
  isAirMode: boolean,
  currency: string,
  customsTiers: Array<...>,
  catalogue: Map<...>,
  allCards: RateCardRow[],
  serviceClient: any,
  allModifiers: Array<...>,
  activeModifierCodes: Set<string>,
): Promise<{ rate: number; source: string; confidence: number; explanation: string; quantity_used: number; unit_used: string; rule_id: string | null; conversion_used?: string } | null>
```

Cette fonction contient une copie read-only de la logique de cascade :
- customs_tier CAF (lignes 756-813)
- customs_weight_tier (lignes 815-873)
- catalogue_sodatra (lignes 875-930)
- rate_card match (lignes 932-947)
- port_tariff fallback (lignes 948-963)

**Difference critique** : cette fonction ne fait PAS de `pricedLines.push()` ni de `continue`. Elle retourne simplement le premier resultat trouve (rate, source, confidence, explanation) ou `null`.

Les modifiers et min_price ne sont PAS appliques dans cette fonction -- ils seront appliques par le bloc PERCENTAGE appelant, car le calcul est : `fallback_rate * percent / 100` PUIS modifiers PUIS min_price.

### Changement 2 : Activer PERCENTAGE dans le bloc client_override (lignes 710-713)

Remplacer :

```text
} else {
  // PERCENTAGE reserved for V3.3 — skip
  skipOverride = true;
}
```

Par :

```text
} else if (override.pricing_mode === "PERCENTAGE") {
  // Phase V3.3: Percentage override — resolve fallback then apply %
  const fallback = await resolveWithoutClientOverride(
    serviceKey, computed, pricingCtx, isAirMode, currency,
    customsTiers, catalogue, allCards, serviceClient,
    allModifiers, activeModifierCodes
  );

  if (fallback) {
    lineTotal = fallback.rate * override.base_price / 100;
    // source will be set below with percentage suffix
  } else {
    skipOverride = true; // No fallback found, line falls to no_match
  }
} else {
  skipOverride = true;
}
```

### Changement 3 : Ajuster le source label (ligne 741)

Dans le bloc `if (!skipOverride)`, modifier la construction du source pour distinguer PERCENTAGE :

```text
const isPercentage = override.pricing_mode === "PERCENTAGE";
const modeLabel = isPercentage ? "client_override_percentage" : "client_override";
const modSuffix = appliedMods.length > 0 ? "+modifiers" : "";

// In pricedLines.push:
source: `${modeLabel}${modSuffix}`,
explanation: isPercentage
  ? `client_override_percentage: client=${pricingCtx.client_code}, base_fallback=${Math.round(lineTotal * 100 / override.base_price)}, percent=${override.base_price}, raw=${Math.round(rawTotal)}, modifiers=[${appliedMods.join(",")}], min_price=${override.min_price}, final=${lineTotal}`
  : `client_override: client=${pricingCtx.client_code}, ...existing...`,
```

## Ce qui ne change PAS

- Resolvers customs_tier CAF (lignes 756-813) : zero modification
- Resolver customs_weight_tier (lignes 815-873) : zero modification
- Resolver catalogue_sodatra (lignes 875-930) : zero modification
- Resolver rate_card (lignes 932-947) : zero modification
- Resolver port_tariff (lignes 948-975) : zero modification
- Aucune autre edge function
- Aucune migration SQL
- Aucune modification frontend

## Fichiers modifies

| Fichier | Changement |
|---|---|
| `supabase/functions/price-service-lines/index.ts` | +1 fonction `resolveWithoutClientOverride` (~80 lignes), ~15 lignes modifiees dans le bloc client_override |

## Validation

| Test | Donnees | Resultat attendu |
|---|---|---|
| Override 80% | fallback customs_tier=250000, override PERCENTAGE base_price=80 | 200000 XOF, source=client_override_percentage |
| Override 120% + URGENT | fallback=250000, 120%, URGENT +25% | 375000 XOF |
| min_price protege | fallback=150000, 50%, min_price=120000 | 120000 XOF |
| Pas de fallback | PERCENTAGE mais aucun resolver downstream ne matche | no_match (skipOverride=true) |
| FIXED inchange | AI0CARGO FIXED 200000 | 200000 XOF (regression zero) |

## Risques

| Risque | Niveau | Mitigation |
|---|---|---|
| Regression FIXED/UNIT_RATE | Nul | Bloc inchange, seul le `else` est modifie |
| Regression resolvers downstream | Nul | Aucune modification, copie read-only dans la fonction helper |
| Double execution cascade | Faible | Seulement quand PERCENTAGE est actif (rare), lectures DB deja en cache memoire |
| Performance | Negligeable | Les donnees (tiers, catalogue, cards) sont deja chargees en memoire, pas de requete DB supplementaire sauf port_tariff fallback |

