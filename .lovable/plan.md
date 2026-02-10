

# Phase PRICING V4.1 — Tests E2E du Transport Resolver

## Objectif

4 tests unitaires ciblant la fonction `findLocalTransportRate` pour valider les corrections CTO et la logique de matching.

## Strategie

La fonction `findLocalTransportRate` est **pure** (aucun appel DB, travaille sur un tableau pre-charge). On peut la tester directement avec des donnees mockees reproduisant les enregistrements reels de `local_transport_rates`.

## Fichier cree

`supabase/functions/_tests/transport_resolver_test.ts`

## Donnees de test (basees sur les valeurs reelles en base)

```text
KAOLACK / 40' Dry  = 527,460 XOF (Aksa Energy)
KAOLACK / 20' Dry  = 290,280 XOF
THIES / POPONGUINE / 40' Dry = 248,980 XOF
THIES / POPONGUINE / 20' Dry = 151,040 XOF
```

## Les 4 tests

### Test 1 : Match exact
- **Input** : `destination_city = "KAOLACK"`, `serviceKey = "TRUCKING"`, `container_type = "40DV"`, `isAirMode = false`
- **Expected** : `source = "local_transport_rate"`, `rate = 527460`, `confidence = 0.90`

### Test 2 : Partial unique
- **Input** : `destination_city = "THIES"`, `serviceKey = "TRUCKING"`, `container_type = "20DV"`, `isAirMode = false`
- **Expected** : `source = "local_transport_rate"`, `rate = 151040` (match partiel "THIES" dans "THIES / POPONGUINE")

### Test 3 : AIR interdit (CTO Correction B)
- **Input** : `destination_city = "KAOLACK"`, `serviceKey = "TRUCKING"`, `container_type = "40DV"`, `isAirMode = true`
- **Expected** : `null` (aucun prix retourne)

### Test 4 : Container missing (CTO Correction A)
- **Input** : `destination_city = "KAOLACK"`, `serviceKey = "TRUCKING"`, `container_type = null`, `isAirMode = false`
- **Expected** : `null` (fallback vers rate_card ou no_match)

## Implementation technique

Le test importe directement la fonction `findLocalTransportRate` depuis `price-service-lines/index.ts`. Si l'export n'est pas disponible (la fonction est actuellement privee), deux options :

- **Option A (preferee)** : Exporter `findLocalTransportRate` depuis `index.ts` via un `export { findLocalTransportRate }` en fin de fichier. Cet export n'affecte pas le `Deno.serve` et permet le test direct.
- **Option B** : Copier la fonction dans le fichier de test (snapshot). Moins maintenable mais zero modification sur le fichier source.

On choisira l'option A (export) car elle garantit qu'on teste le code reel.

## Structure du fichier test

```text
transport_resolver_test.ts
  - Mock data (4 LocalTransportRate records reproduisant KAOLACK et THIES)
  - Mock PricingContext factory
  - Test 1: exact match KAOLACK + 40DV
  - Test 2: partial match THIES + 20DV
  - Test 3: AIR mode returns null
  - Test 4: null container returns null
```

## Modifications

| Fichier | Action | Lignes |
|---|---|---|
| `supabase/functions/price-service-lines/index.ts` | Ajouter `export { findLocalTransportRate }` en fin de fichier | +1 ligne |
| `supabase/functions/_tests/transport_resolver_test.ts` | Creer (4 tests) | ~120 lignes |

## Execution

```text
deno test --allow-net --allow-env --allow-read supabase/functions/_tests/transport_resolver_test.ts
```

Ou via l'outil de test integre Lovable.

## Ce qui ne change PAS

- Aucune logique metier modifiee
- Aucune migration
- Aucun changement frontend
- La cascade de pricing reste identique

