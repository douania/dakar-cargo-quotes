

# Phase V4.1.5 — Corriger le parsing de cargo.containers dans le pricing engine

## Diagnostic

Les deux problemes signales (transport a 3 500 000 FCFA pour Dakar + 1 EVP au lieu de 4) ont une **cause unique** :

Le fait `cargo.containers` est stocke en base comme une **chaine JSON doublement encodee** :
```
jsonb_typeof(value_json) = 'string'
valeur: "\"[{\\\"type\\\": \\\"40HC\\\", \\\"quantity\\\": 2}]\""
```

Au lieu d'etre un vrai tableau JSONB `[{"type": "40HC", "quantity": 2}]`, c'est un **string contenant du JSON**. Du coup :
- `Array.isArray(containersFact.value_json)` retourne `false`
- L'array `containers` reste vide dans le `PricingContext`
- `container_type` est `null`, `container_count` est `null`

### Consequences en cascade :

| Probleme | Cause |
|---|---|
| Transport a 3 500 000 FCFA | Le resolver local transport (zone Dakar = 123 900 FCFA) renvoie `null` car `container_type` est null (ligne 511). Le fallback rate card matche Dakar-Kedougou 40HC a 3 500 000. |
| 1 EVP au lieu de 4 | `computeQuantity` avec `containers.length === 0` retourne `quantity_used = 1` (missing_containers_default_1) |
| DTHC a 250 000 au lieu de 500 000 | Meme probleme : 1 EVP au lieu de 4 (2x40HC = 4 EVP) |

## Solution

### Volet A : Robustifier `buildPricingContext` (edge function)

Fichier : `supabase/functions/price-service-lines/index.ts`

Dans `buildPricingContext` (ligne 305), ajouter un `JSON.parse` de secours quand `value_json` est un string :

```typescript
const containersFact = factsMap.get("cargo.containers");
let containersRaw = containersFact?.value_json;

// Robustesse: si value_json est un string JSON (double-encodage), le parser
if (typeof containersRaw === "string") {
  try {
    containersRaw = JSON.parse(containersRaw);
  } catch {
    containersRaw = null;
  }
}

if (containersRaw && Array.isArray(containersRaw)) {
  // ... code existant inchange
}
```

### Volet B : Corriger la source du double-encodage (edge function build-case-puzzle)

Fichier : `supabase/functions/build-case-puzzle/index.ts`

Trouver l'endroit ou `cargo.containers` est ecrit dans `quote_facts` et s'assurer que `value_json` est un objet JS, pas un `JSON.stringify(...)` d'un objet deja serialise.

Typiquement le bug vient de :
```typescript
// BUG: value_json recoit une string au lieu d'un objet
value_json: JSON.stringify([{type: "40HC", quantity: 2}])
// CORRECT: passer l'objet directement, Supabase gere la serialisation JSONB
value_json: [{type: "40HC", quantity: 2}]
```

### Volet C : Corriger le fait existant en base (one-shot)

Via une migration ou une requete manuelle, corriger le fait `cargo.containers` du case concerne pour que les tests soient immediats sans re-analyser le dossier.

## Fichiers impactes

| Fichier | Modification |
|---|---|
| `supabase/functions/price-service-lines/index.ts` | ~8 lignes dans `buildPricingContext` (parse defensif) |
| `supabase/functions/build-case-puzzle/index.ts` | Corriger l'ecriture de `value_json` (eviter double-encodage) |

Aucune modification frontend. Aucune migration SQL de schema.

## Resultat attendu

Apres correction + re-pricing :
- `containers = [{"type": "40HC", "quantity": 2}]`
- `container_type = "40HC"`, `container_count = 2`
- EVP = 2 x 2 = 4
- DTHC = 250 000 x 4 = 1 000 000 FCFA (ou selon catalogue)
- Transport = 123 900 FCFA (zone 1 Dakar, 40' Dry) x 2 voyages
- Restitution vide = tarif x 4 EVP

## Validation

1. Recharger la page de cotation `c627ed62-...`
2. Verifier que DTHC affiche quantity = 4 EVP
3. Verifier que Transport affiche un tarif Dakar zone 1 (~123 900 par voyage, pas 3 500 000)
4. Verifier que Restitution vide affiche quantity = 4 EVP

