

## Diagnostic

Le thème de l'app est **dark-only** : `--foreground` = blanc/clair (~96% lightness). L'alerte non-bloquante utilise `bg-blue-50` (fond clair) mais le contenu des gap rows hérite de `text-foreground` (blanc) → **texte blanc sur fond bleu clair = invisible**.

Le titre "1 question ouverte" est lisible car il a `text-blue-800` explicitement, mais les `<li>` du `renderGapRow` n'ont aucune couleur explicite.

Le même problème existe pour l'alerte des gaps bloquants (`bg-orange-50`).

## Correction — `src/pages/CaseView.tsx`

Ajouter `text-blue-900` sur le `<ul>` des gaps non-bloquants (L1797) et `text-orange-900` sur le `<ul>` des gaps bloquants (L1782) pour que le texte soit lisible sur fond clair :

**Ligne 1782** (blocking gaps) :
```tsx
<ul className="space-y-3 text-orange-900">
```

**Ligne 1797** (non-blocking gaps) :
```tsx
<ul className="space-y-3 text-blue-900">
```

1 fichier, 2 lignes modifiées, 0 migration, 0 backend.

