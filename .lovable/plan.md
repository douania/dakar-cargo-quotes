
# Fix: `cargoValueFCFA is not defined` dans quotation-engine

## Diagnostic

L'erreur `ReferenceError: cargoValueFCFA is not defined` est un probleme de **portee de variable** (block scoping).

```text
Ligne 2009:  if (!isTransit) {
Ligne 2012:    let cargoValueFCFA: number;  // <-- declare DANS le bloc if
  ...
Ligne 2224:  } // end if (!isTransit)
Ligne 2226:  return { lines, warnings, dutyBreakdown, cargoValueFCFA };  // <-- HORS du bloc
```

La variable `cargoValueFCFA` est declaree avec `let` a l'interieur du bloc `if (!isTransit)`, ce qui la rend invisible au `return` situe apres la fermeture du bloc. Meme pour un dossier non-transit (comme le cas actuel SEA_FCL_IMPORT), le moteur JavaScript/Deno considere la variable comme hors-portee au point de retour.

## Correction

**Fichier** : `supabase/functions/quotation-engine/index.ts`

Deplacer la declaration de `cargoValueFCFA` **avant** le bloc `if (!isTransit)`, avec une valeur par defaut :

```text
// Avant le bloc if (!isTransit)
const dutyBreakdown: any[] = [];
let cargoValueFCFA: number = 0;    // <-- AJOUTER ICI

if (!isTransit) {
  const rawCurrency = ...
  // SUPPRIMER l'ancien "let cargoValueFCFA: number;" (ligne 2012)
  // Garder les assignations: cargoValueFCFA = request.cargoValue; etc.
```

## Detail technique

| Ligne | Avant | Apres |
|-------|-------|-------|
| 2007 (apres dutyBreakdown) | rien | `let cargoValueFCFA: number = 0;` |
| 2012 | `let cargoValueFCFA: number;` | supprimee |

Tout le reste du code (assignations, calculs CAF, return) reste inchange.

## Impact

- 1 ligne ajoutee, 1 ligne supprimee
- Zero changement de logique metier
- Les cas transit retourneront `cargoValueFCFA = 0` (correct : pas de droits en transit)
- Les cas non-transit fonctionneront comme avant
- Deploiement automatique de `quotation-engine` apres modification
