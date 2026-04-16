
# Micro-correction — Retirer FOB de la branche freightValue

## Problème

Ligne 552 de `build-case-puzzle/index.ts` :
```typescript
} else if (/\b(?:FRET|FREIGHT|FOB)\b/i.test(line) && !result.freightValue) {
```

FOB est regroupé avec FRET/FREIGHT et alimente `freightValue`, ce qui est métierment faux (FOB = valeur marchandise, pas du fret). Cela peut injecter une mauvaise valeur dans `cargo.freight_cost`.

## Correction

Retirer `FOB` du regex à la ligne 552. Résultat :

```typescript
} else if (/\b(?:FRET|FREIGHT)\b/i.test(line) && !result.freightValue) {
```

FOB n'est pas traité dans ce lot — une fact key canonique dédiée sera décidée dans un lot ultérieur.

## Scope

- **1 ligne modifiée** dans `supabase/functions/build-case-puzzle/index.ts` (ligne 552)
- Pas de migration
- Pas d'autre fichier touché
- Redéploiement de la fonction après correction
