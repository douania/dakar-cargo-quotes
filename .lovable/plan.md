

# PATCH P0 — Auto-calc `cargo.volume_cbm` from `cargo.dimensions`

## Fichier unique
`supabase/functions/build-case-puzzle/index.ts`

## Modification 1 — Regex dimensions (ligne 3735)

Remplacer le regex actuel par une version permissive avec support décimales et unité **optionnelle** capturée :

```typescript
// Avant
const dimMatch = body.match(/(\d+)\s*[*x×]\s*(\d+)\s*[*x×]\s*(\d+)\s*(?:cm|mm)?/i);

// Après
const dimMatch = body.match(/(\d+(?:[.,]\d+)?)\s*[*x×]\s*(\d+(?:[.,]\d+)?)\s*[*x×]\s*(\d+(?:[.,]\d+)?)(?:\s*(mm|cm|m)\b)?/i);
```

L'extraction `cargo.dimensions` reste identique (ligne 3736-3747 inchangée).

## Modification 2 — Bloc auto-calc (après ligne 3747)

Insérer le bloc fourni par l'utilisateur entre la fin de l'extraction `cargo.dimensions` (ligne 3747) et le commentaire `cargo.description` (ligne 3749) :

- Parse `dimMatch[1..3]` avec support virgule/point
- Lit `dimMatch[4]` comme unité explicite
- Ne calcule que si unité présente (`divisor !== null`)
- Sanity check `volM3 > 0 && volM3 < 10000`
- Injecte `cargo.volume_cbm` avec `sourceType: "deterministic_calc"`, `confidence: 0.90`

## Impact
- 1 regex modifié (rétrocompatible)
- ~20 lignes ajoutées
- Le downstream `cargo.chargeable_weight_kg` (ligne 3767) bénéficie automatiquement du nouveau fact
- Aucune régression sur `cargo.dimensions`

