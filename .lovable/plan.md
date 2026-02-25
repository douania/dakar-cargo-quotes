

# Fix Patch C : existingDbKeys avant init + .maybeSingle() + validation stricte

## Bug confirme

`existingDbKeys` utilise ligne 2448, declare ligne 2478 → `ReferenceError` runtime.

## Corrections (3 points sur le meme fichier)

### 1. Remonter + enrichir le chargement des facts (avant ligne 2438)

Deplacer le bloc `existingDbFacts` de lignes 2472-2478 vers juste apres ligne 2436 (`let gapsIdentified = 0`). Enrichir le select avec `value_text` et ajouter la validation stricte :

```typescript
let gapsIdentified = 0;

// Load existing DB facts BEFORE any gap logic (mandatory/orphan/A1)
const { data: existingDbFacts } = await serviceClient
  .from("quote_facts")
  .select("fact_key, value_text")
  .eq("case_id", case_id)
  .eq("is_current", true);

const existingDbKeys = (existingDbFacts || []).map((f: { fact_key: string }) => f.fact_key);

const transportModeRaw = (existingDbFacts || [])
  .find((f: { fact_key: string; value_text?: string | null }) => f.fact_key === "routing.transport_mode")
  ?.value_text ?? null;

const transportModeNormalized =
  typeof transportModeRaw === "string" ? transportModeRaw.trim().toUpperCase() : "";

const hasResolvedTransportMode =
  transportModeNormalized === "AIR" ||
  transportModeNormalized === "MARITIME" ||
  transportModeNormalized === "ROUTE";
```

### 2. Supprimer le doublon lignes 2472-2478

Le bloc `existingDbFacts`/`existingDbKeys` qui reste a son ancien emplacement doit etre supprime.

### 3. Remplacer les references

- Ligne 2448 : `!existingDbKeys.includes(...)` → `!hasResolvedTransportMode`
- Ligne 2482 : `existingDbKeys.includes(...)` → `hasResolvedTransportMode`
- Ligne 2492 : `.single()` → `.maybeSingle()`
- Ligne 2508 : `.single()` → `.maybeSingle()`
- Ligne 2537 : `.single()` → `.maybeSingle()` (bonus, meme pattern fragile)

## Fichier modifie

| Fichier | Action |
|---------|--------|
| `supabase/functions/build-case-puzzle/index.ts` | Remonter existingDbFacts avant orphan gaps, validation stricte transport_mode, .maybeSingle() partout |

## Resultat attendu

- Plus de `ReferenceError`
- Validation stricte : seuls AIR/MARITIME/ROUTE ferment le gap
- `.maybeSingle()` : pas d'erreur 406 si 0 ou 2+ lignes
- Redeploiement automatique

