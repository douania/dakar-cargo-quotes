

# Phase C2.1-D -- Ajout dependance `activeCases` dans useEffect recherche

## Probleme

Le `useEffect` de recherche (ligne 279-339) utilise `activeCases` pour filtrer les threads deja convertis en case, mais le tableau de dependances (ligne 339) ne contient que `[searchQuery]`. Cela peut causer un filtre stale si `activeCases` change apres le montage initial.

## Correction

**Fichier unique** : `src/pages/Dashboard.tsx`

**Ligne 339** : remplacer `[searchQuery]` par `[searchQuery, activeCases]`

C'est un changement d'une seule ligne, sans impact sur la logique de filtrage ni sur aucun autre comportement.

## Impact

- Si `activeCases` est mis a jour (par ex. apres un `fetchData()` ou un refresh), toute recherche en cours sera re-executee avec le filtre anti-fantome a jour
- Aucun risque de regression : le contenu du useEffect ne change pas, seul le declencheur est elargi

## Ce qui ne change PAS

- Logique de filtrage interne au useEffect
- `fetchData()`
- Requetes backend
- UI / labels / composants
- Aucun autre fichier

