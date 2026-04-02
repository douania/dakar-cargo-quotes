

# Plan : Rendre `cargo.description` éditable dans CaseView

## Diagnostic

Le fichier `src/pages/case-view/constants.ts` définit `EDITABLE_FACT_KEYS` — la liste blanche des facts modifiables depuis l'UI. `cargo.description` n'y figure pas, ce qui bloque toute saisie manuelle.

C'est un gap critique car `cargo.description` est souvent un gap bloquant pour le pricing, et sans possibilité de le renseigner manuellement, le dossier reste bloqué.

## Correction minimale

**1 fichier, 1 ligne ajoutée**

**Fichier** : `src/pages/case-view/constants.ts`

Ajouter `"cargo.description"` dans le Set `EDITABLE_FACT_KEYS` (ligne ~80).

## Vérification nécessaire

Il faut aussi vérifier que `set-case-fact` (edge function backend) accepte `cargo.description` dans sa propre whitelist. Si ce n'est pas le cas, il faudra aussi l'y ajouter — sinon l'UI permettra la saisie mais le backend la rejettera.

## Impact

- 0 migration
- 0 nouveau fichier
- Débloque la saisie manuelle de la nature de marchandise
- Permet de résoudre le gap bloquant sur le dossier `a5a58d25`

