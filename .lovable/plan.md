

# Phase S1.3 — Filtrage du pricing par mode transport (avec corrections CTO)

## Objectif

Empecher le moteur `price-service-lines` de matcher des tarifs container (TRUCKING 40HC 3.5M, CUSTOMS_DAKAR 350K, AGENCY 200K) pour un dossier AIR_IMPORT.

## Modifications

### 1. Backend : `supabase/functions/price-service-lines/index.ts`

**1a. Lire `request_type` depuis le quote_case (ligne 489-493)**

Modifier la requete existante pour inclure `request_type` :

```typescript
const { data: caseData, error: caseError } = await jwtClient
  .from("quote_cases")
  .select("id, status, request_type")  // AJOUT request_type
  .eq("id", case_id)
  .single();
```

Deduire le mode apres le check d'ownership :

```typescript
const requestType = caseData?.request_type || "";
const isAirMode = /AIR/i.test(requestType);
```

Logger le mode dans le bloc `pricing_context` existant (ligne 540-556) :

```typescript
meta: { ...existant, request_type: requestType, is_air_mode: isAirMode }
```

**1b. Filtrer dans `findBestRateCard` (ligne 350)**

Ajouter `isAirMode` comme parametre de la fonction, puis dans la boucle sur les candidates, exclure les rate cards avec `container_type` non-null quand le mode est AIR :

```typescript
// Phase S1.3: Exclure rate cards container pour mode AIR
if (isAirMode && card.container_type) continue;
```

**1c. Filtrer dans `computeQuantity` (ligne 160, 187)**

Ajouter `isAirMode` comme parametre. Quand `basis === "EVP"` ou `basis === "COUNT"` et que `isAirMode === true`, retourner `quantity_used: null` pour empecher le pricing :

```typescript
// Phase S1.3: Skip container-based quantity for AIR mode
if (isAirMode && (basis === "EVP" || basis === "COUNT")) {
  return {
    quantity_used: null,
    unit_used: rule.default_unit,
    rule_id: rule.id,
    conversion_used: "air_mode_skip_container_basis",
  };
}
```

### 2. Frontend : `src/pages/QuotationSheet.tsx`

**Pas de seuil heuristique (correction CTO).** Ajouter un `useEffect` deterministe qui re-declenche le pricing quand le `request_type` AIR est detecte :

```typescript
// Phase S1.3: Re-price when AIR mode detected
useEffect(() => {
  if (quoteCase?.request_type?.includes('AIR') && quoteCase.id && serviceLines.length > 0) {
    callPriceServiceLines(quoteCase.id, serviceLines);
  }
}, [quoteCase?.request_type]);
```

Cet effet :
- Se declenche uniquement quand `request_type` change (ou devient disponible)
- Envoie toutes les lignes au backend corrige qui filtrera les rate cards container
- `callPriceServiceLines` ne re-price que les lignes sans `rate` (filtre `unpricedLines` existant ligne 673)

**Point important** : les lignes ont deja un `rate` du premier pricing errone. Il faut d'abord les reset. Ajout avant l'appel :

```typescript
useEffect(() => {
  if (quoteCase?.request_type?.includes('AIR') && quoteCase.id && serviceLines.length > 0) {
    // Reset rates des lignes ai_assumption pour re-pricing backend
    const resetLines = serviceLines.map(l =>
      l.source === 'ai_assumption' ? { ...l, rate: undefined } : l
    );
    setServiceLines(resetLines);
    callPriceServiceLines(quoteCase.id, resetLines);
  }
}, [quoteCase?.request_type]);
```

Le reset est conditionne par `source === 'ai_assumption'` (seules les lignes auto-injectees), pas par un seuil de montant. C'est deterministe et tracable.

## Fichiers modifies

| Fichier | Changement |
|---------|-----------|
| `supabase/functions/price-service-lines/index.ts` | Lire `request_type`, passer `isAirMode` a `findBestRateCard` et `computeQuantity`, exclure rate cards container et bases EVP/COUNT en mode AIR |
| `src/pages/QuotationSheet.tsx` | useEffect deterministe : reset `ai_assumption` rates + re-pricing quand mode AIR detecte |

## Resultat attendu

- TRUCKING 40HC 3.5M FCFA : rate card a `container_type=40HC` -> exclue en mode AIR -> `rate=null` -> "A completer"
- CUSTOMS_DAKAR : si rate card sans `container_type` -> autorisee ; si avec -> exclue
- AGENCY : idem
- Les dossiers SEA/ROAD ne sont pas impactes (isAirMode = false)

