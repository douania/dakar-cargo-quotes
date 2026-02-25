

# Fix : stale value sur Select auto-save (saveGapAnswer)

## Diagnostic confirmé

Ligne 866 : `const raw = gapInputs[g.gap_key] || ""` lit le state React **avant** que `setGapInputs` (ligne 961) ait pris effet. Le `setTimeout(0)` (ligne 963) ne garantit pas que le re-render a eu lieu.

Résultat possible : `raw` est vide ou contient l'ancienne valeur → erreur "Valeur requise" ou mauvaise valeur enregistrée.

## Correction (3 lignes modifiées, zero refactor)

### 1. Ajouter un paramètre `rawOverride?` à `saveGapAnswer` (ligne 864-866)

```typescript
const saveGapAnswer = async (g: any, allowAutoPricing: boolean, rawOverride?: string) => {
  if (!caseId) return;
  const raw = rawOverride ?? gapInputs[g.gap_key] ?? "";
```

### 2. Passer la valeur directement dans le Select `onValueChange` (lignes 960-967)

Remplacer le bloc actuel par :

```typescript
onValueChange={(val) => {
  setGapInputs((prev) => ({ ...prev, [g.gap_key]: val }));
  saveGapAnswer(g, allowAutoPricing, val);
}}
```

Cela supprime le `setTimeout` hack, le `setSavingGapKey` redondant (déjà fait dans `saveGapAnswer`), et passe la valeur fraîche directement.

### 3. Aucun changement sur les autres call sites

- `onKeyDown Enter` (ligne 987) → continue sans override (lit `gapInputs`, correct car la valeur est déjà dans le state)
- Bouton `onClick` (ligne 996) → idem, correct
- `renderGapRow` appels (lignes 1018, 1033) → inchangés

## Fichiers modifiés

| Fichier | Lignes | Action |
|---------|--------|--------|
| `src/pages/CaseView.tsx` | 864-866 | Ajout paramètre `rawOverride?` |
| `src/pages/CaseView.tsx` | 960-967 | Suppression `setTimeout` + passage direct de `val` |

## Impact

- Zero nouveau composant
- Zero changement backend
- Corrige le bug intermittent de stale value sur Select
- Les call sites Input et Button restent inchangés

