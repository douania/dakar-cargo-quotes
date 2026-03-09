

# Fix — Texte invisible dans le panel des questions non bloquantes

## Problème
Dans `renderGapRow` (ligne 1733), le `<li>` n'a pas de couleur de texte explicite. Le panel bleu (`bg-blue-50`) a un fond clair, mais le texte hérite d'une couleur qui se confond avec le fond.

Le panel des gaps bloquants (rouge) a le même problème potentiel.

## Correction

**Fichier** : `src/pages/CaseView.tsx`

**Ligne 1733** — Ajouter une couleur de texte explicite au `<li>` :
```tsx
// Avant
<li key={g.id} className="flex items-center gap-2 text-sm">

// Après  
<li key={g.id} className="flex items-center gap-2 text-sm text-foreground">
```

`text-foreground` est le token Tailwind du design system qui garantit la lisibilité quel que soit le contexte (fond bleu, fond rouge, mode clair/sombre).

## Impact
- 1 ligne modifiée
- Aucun changement fonctionnel
- Corrige la lisibilité dans les deux panels (bloquant et non bloquant)

