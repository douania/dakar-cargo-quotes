

# Plan micro-correctif S1 — Badge couleur brouillon/confirmé

## Problème

Dans `ExternalRequestsPanel.tsx` :
- `STATUS_LABELS` contient bien `sent_confirmed` (L63)
- `STATUS_COLORS` ne contient **pas** `sent_confirmed` (L50-58)
- Le badge utilise `STATUS_COLORS[req.status]` (L359) au lieu de `STATUS_COLORS[displayStatus]`

Résultat : le texte distingue brouillon/confirmé, mais la couleur reste identique.

## Correctif (1 fichier, 2 lignes)

### `src/components/puzzle/ExternalRequestsPanel.tsx`

**Étape 1** — Ajouter `sent_confirmed` dans `STATUS_COLORS` (après L52) :
```typescript
sent_confirmed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
```
Couleur emerald pour distinguer visuellement de `sent` (blue = brouillon, emerald = confirmé).

**Étape 2** — Ligne 359, remplacer :
```tsx
<Badge className={STATUS_COLORS[req.status] || ""} variant="secondary">
```
par :
```tsx
<Badge className={STATUS_COLORS[displayStatus] || ""} variant="secondary">
```

## Blast radius

1 fichier, 2 modifications mineures. Aucune migration. Aucune zone FROZEN. Aucun changement logique métier.

