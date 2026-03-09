

# Fix — Couleur du texte dans le panel "questions non bloquantes"

## Problème
Le texte des questions dans le panel bleu (`bg-blue-50`) utilise `text-foreground` (couleur claire du thème sombre), ce qui le rend quasi invisible sur fond blanc/bleu clair. Le titre utilise `text-blue-800` et est lisible — il faut aligner.

## Correction

**Fichier** : `src/pages/CaseView.tsx`

### 1. `renderGapRow` (ligne 1733)
Remplacer `text-foreground` par `text-blue-800` sur le `<li>` :
```tsx
<li key={g.id} className="flex items-center gap-2 text-sm text-blue-800">
```

Cela aligne la couleur du texte des questions avec celle du titre "1 question ouverte (non bloquante)".

**Note** : Ce composant est aussi utilisé pour les gaps bloquants (fond rouge). Il faudra passer un paramètre de couleur contextuel. Actuellement `renderGapRow(g, isEditable)` — le contexte bloquant/non-bloquant est déjà implicite via le `isEditable` mais pas la couleur. Solution : ajouter un 3e paramètre `textColorClass` pour distinguer les deux contextes (`text-red-800` pour bloquant, `text-blue-800` pour non-bloquant).

### 2. Appels à `renderGapRow`

- **Ligne ~1841** (non-bloquant) : `renderGapRow(g, false, "text-blue-800")`
- **Lignes dans le panel bloquant** : `renderGapRow(g, true, "text-red-800")`

## Impact
- 1 fichier, ~4 lignes modifiées
- Lisibilité garantie sur les deux panels

