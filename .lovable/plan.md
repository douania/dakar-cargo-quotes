
# FIX — Loader infini sur /quotation/new

## Diagnostic

| Route | `emailId` | `isNewQuotation` actuel | `isLoading` initial | Résultat |
|-------|-----------|-------------------------|---------------------|----------|
| `/quotation/new` | `undefined` | `false` ❌ | `true` | **Loader infini** |
| `/quotation/abc-123` | `"abc-123"` | `false` | `true` | Chargement normal |

## Correction (une seule ligne)

**Fichier** : `src/pages/QuotationSheet.tsx`

**Ligne 141 — Avant** :
```typescript
const isNewQuotation = emailId === 'new';
```

**Ligne 141 — Après** :
```typescript
const isNewQuotation = !emailId || emailId === 'new';
```

## Logique corrigée

| Route | `emailId` | `!emailId` | `emailId === 'new'` | `isNewQuotation` | `isLoading` |
|-------|-----------|------------|---------------------|------------------|-------------|
| `/quotation/new` | `undefined` | `true` | `false` | **true** ✅ | `false` |
| `/quotation/abc-123` | `"abc-123"` | `false` | `false` | `false` | `true` |

## Impact

- **Avant** : `/quotation/new` affiche un loader infini → perception "ça rame"
- **Après** : `/quotation/new` affiche immédiatement le formulaire vide

## Fichiers modifiés

| Fichier | Ligne | Action |
|---------|-------|--------|
| `src/pages/QuotationSheet.tsx` | 141 | Modifier la condition `isNewQuotation` |

## Ce qui ne change PAS

- `MainLayout.tsx` : aucun changement (conformément à votre directive)
- Le `useMemo` du moteur de cotation reste intact
- Tous les composants FROZEN restent inchangés

## Section technique

La route `/quotation/new` n'a pas de paramètre `:emailId` dans le chemin. React Router retourne donc `undefined` pour `useParams().emailId`. En ajoutant `!emailId` à la condition, on couvre les deux cas :
1. Pas de paramètre → nouvelle cotation
2. Paramètre explicite `"new"` → nouvelle cotation (si jamais utilisé)

