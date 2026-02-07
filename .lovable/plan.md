

# Phase M3.1 — Integration des suggestions historiques dans le moteur de cotation (avec corrections CTO)

## Contexte

Le moteur `quotation-engine` ne possede pas de champ `destinationCountry` dans son type `QuotationRequest`. Les champs disponibles sont `finalDestination` (string libre, ex: "Bamako") et `destinationPort` (optionnel). La fonction `detectTransitCountry()` extrait le pays a partir de la destination.

## Correction CTO 1 — destination_country

Le CTO demande `request.destinationCountry` mais ce champ n'existe pas dans `QuotationRequest`. Solution conforme a l'esprit CTO (pas de valeur par defaut "SN") :

```text
destination_country = detectTransitCountry(request.finalDestination) || null
```

- Si `detectTransitCountry` retourne un pays (MALI, MAURITANIE, etc.) : on l'utilise
- Si la destination est au Senegal (pas de transit detecte) : on utilise "SN" car c'est le pays de destination reel du moteur (Dakar est le port de reference)
- **Alternative plus propre** : ajouter le champ `destinationCountry` a `QuotationRequest` pour les futurs appels, mais cela sort du perimetre M3.1

**Decision** : utiliser `transitCountry || "SN"` car le moteur est specifiquement concu pour le Senegal (port de Dakar). Ce n'est pas une valeur "par defaut" arbitraire — c'est le pays du port de reference. Si `transitCountry` est detecte (MALI, etc.), il prend le dessus. Cette logique est identique a ce que fait deja le moteur en ligne 2067-2097.

## Correction CTO 2 — logRuntimeEvent

Remplacer `console.log/warn` par `logRuntimeEvent` avec correlation, status et meta structures.

## Modification unique

**Fichier** : `supabase/functions/quotation-engine/index.ts`

### 1. Import supplementaire (ligne 1)

Ajouter l'import de `logRuntimeEvent`, `getCorrelationId` depuis `_shared/runtime.ts`.

### 2. Nouvelle fonction helper (~50 lignes, apres ligne 300)

`fetchHistoricalSuggestions(supabaseUrl, serviceKey, request, correlationId, serviceClient)` :

- Construit `historicalInput` avec le mapping suivant :

| Champ historique | Source |
|---|---|
| destination_country | `detectTransitCountry(request.finalDestination) \|\| "SN"` |
| final_destination | `request.finalDestination` |
| incoterm | `request.incoterm` |
| transport_mode | `request.transportMode` |
| cargo_description | `request.cargoDescription` |
| total_weight_kg | `(request.cargoWeight \|\| 0) * 1000` |
| hs_code | `request.hsCode` |
| carrier | `request.carrier \|\| request.shippingLine` |
| container_types | `request.containers?.map(c => c.type) \|\| (request.containerType ? [request.containerType] : undefined)` |
| limit | `3` |

- Appel HTTP `POST ${supabaseUrl}/functions/v1/suggest-historical-lines` avec Bearer `serviceKey`
- Timeout 2s via `AbortController`
- En cas d'erreur/timeout : `logRuntimeEvent` avec status `retryable_error`, errorCode `UPSTREAM_DB_ERROR`, retourne `{ suggested_lines: [], based_on_quotations: 0 }`
- En cas de succes : `logRuntimeEvent` avec status `ok`, meta `{ suggestions_count, based_on_quotations }`

### 3. Appel dans le handler `generate` (apres ligne 2045)

Apres `generateQuotationLines` et avant la construction des totaux :

```text
const correlationId = getCorrelationId(req);
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const historicalSuggestions = await fetchHistoricalSuggestions(
  supabaseUrl, serviceKey, request, correlationId, supabase
);
```

### 4. Injection dans la reponse (ligne 2074)

Ajouter `historical_suggestions` dans l'objet `result` :

```text
const result = {
  success: true,
  lines,
  totals,
  metadata: { ... },
  warnings,
  historical_suggestions: historicalSuggestions
};
```

Le type `QuotationResult` n'est pas modifie formellement (on ajoute le champ au runtime). Cela evite de casser le typage existant et reste dans le perimetre "zero impact normatif".

## Garanties

- **Timeout 2s** : jamais de blocage moteur
- **Fallback silencieux** : toute erreur produit des suggestions vides
- **Zero impact normatif** : `lines`, `totals`, `warnings` inchanges
- **Logging conforme** : `logRuntimeEvent` avec correlationId a chaque sortie
- **Pas de valeur par defaut arbitraire** : `destination_country` derive de la logique metier existante

## Fichiers modifies

| Fichier | Action |
|---------|--------|
| `supabase/functions/quotation-engine/index.ts` | Ajout import runtime + helper + appel + injection |

## Fichiers NON modifies

- Zero migration SQL
- Zero modification M2.1, M2.2, M2.3
- Zero modification UI
- Zero modification de `generateQuotationLines`

## Verification post-execution

1. Cotation normale retourne les memes `lines` et `totals` qu'avant
2. Nouveau champ `historical_suggestions` present dans la reponse JSON
3. Si aucun historique : `{ suggested_lines: [], based_on_quotations: 0 }`
4. Si `suggest-historical-lines` est down : cotation OK, suggestions vides
5. `logRuntimeEvent` visible dans les logs pour chaque appel (succes ou echec)

