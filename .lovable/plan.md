

# Plan : Rendre toutes les lignes tarifaires visibles

## Diagnostic

Dans `PricingResultPanel.tsx` ligne 364, les lignes tarifaires sont tronquées à 10 avec `tariffLines.slice(0, 10)`. Le message "+7 lignes supplémentaires" (ligne 399-404) est un simple texte statique sans bouton ni action — l'utilisateur ne peut pas voir les lignes restantes.

## Solution — 1 fichier

**`src/components/puzzle/PricingResultPanel.tsx`**

Remplacer la troncature statique par un mécanisme "Voir plus / Voir moins" :

1. Ajouter un state `showAllLines` (défaut `false`)
2. Afficher `tariffLines.slice(0, showAllLines ? tariffLines.length : 10)`
3. Remplacer le `<tr>` statique "+N lignes supplémentaires" par un bouton cliquable qui bascule `showAllLines`
4. Quand déplié, afficher un bouton "Réduire" pour revenir à 10 lignes

Même traitement pour le bloc multi-lot (ligne 321) qui a la même troncature à 15 lignes.

## Rendu attendu

```text
Avant (actuel) :
  10 lignes affichées
  "+7 lignes supplémentaires" (texte mort)

Après :
  10 lignes affichées
  [Voir les 7 lignes restantes]  ← bouton cliquable
  → clic → toutes les 17 lignes visibles
  [Réduire]  ← bouton pour replier
```

## Ce qui ne change pas

- 0 module FROZEN
- 0 migration
- Aucune logique métier modifiée
- Affichage identique quand il y a 10 lignes ou moins

