

# Correctifs CTO bloquants -- Phase PRICING V1

## Diagnostic

Apres inspection du code reel, voici le statut de chaque point CTO :

### Point 1 : Migration SQL / Seed
**Statut : OK -- rien a corriger.**
Les 5 services catalogue et 3 modifiers sont correctement presents en base avec les bonnes valeurs, CHECK constraints incluses. Le diff montre des "..." mais la migration executee est complete.

### Point 2 : UI Switches
**Statut : OK -- rien a corriger.**
Les 3 Switch (lignes 1675-1712) sont complets avec `checked={pricingModifiers.includes(...)}` et `onCheckedChange` qui ajoute/retire correctement.

### Point 3 : Typage TS
**Statut : OK -- deja type.**
Ligne 749 : `useState<string[]>([])` et ligne 750 : `useRef<ServiceLine[]>([])`. Pas de `never[]`.

### Point 4 : Ordre des hooks -- BUG REEL A CORRIGER
**Statut : BLOQUANT.**

Le `pricingModifiers` est declare a la ligne 749, mais reference a la ligne 743 dans le `useEffect` AIR re-pricing (lignes 732-746). Meme si JavaScript ne crashe pas ici (le callback s'execute apres le rendu), c'est une violation de l'ordre logique des hooks et un piege de maintenance.

## Correction a appliquer

**Fichier** : `src/pages/QuotationSheet.tsx`

**Action** : Deplacer le bloc PRICING V1 (lignes 748-770) AVANT le bloc AIR re-pricing (lignes 730-746).

Ordre final :

```text
1. [ligne ~730] -- Phase PRICING V1: state + refs
   const [pricingModifiers, setPricingModifiers] = useState<string[]>([]);
   const serviceLinesRef = useRef<ServiceLine[]>([]);
   useEffect sync ref
   const modifiersRepricedRef = useRef<string>('');
   useEffect modifiers re-pricing

2. [apres] -- AIR mode re-pricing (existant, lignes 730-746 actuelles)
   const airModeRepricedRef = useRef(...)
   useEffect AIR re-pricing (utilise pricingModifiers, desormais declare avant)
```

Cela garantit que `pricingModifiers` est declare avant toute utilisation, et respecte l'ordre strict des hooks React.

## Fichiers modifies

| Fichier | Changement |
|---------|-----------|
| `src/pages/QuotationSheet.tsx` | Reordonner : bloc PRICING V1 hooks avant bloc AIR re-pricing |

## Ce qui ne change PAS

- Aucune modification SQL
- Aucune modification backend
- Aucune modification de la logique UI (switches)
- Aucun ajout/suppression de code, uniquement deplacement de lignes existantes

