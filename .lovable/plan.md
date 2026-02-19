
# Correction P0 urgente : freightFCFA scope + cargo.hs_code whitelists

## Probleme 1 : `freightFCFA is not defined` (CRASH)

`freightFCFA` est declare a la ligne 2042 dans le bloc `if (!isTransit)` (lignes 2018-2300, fonction `generateQuotationLines`). Le second appel `calculateCAF` a la ligne 2374 est dans le handler principal `Deno.serve` (ligne 2308+), dans la section `case 'generate'`. Ces deux blocs sont dans des fonctions differentes :
- `generateQuotationLines()` contient la declaration (ligne 2042)
- Le handler `Deno.serve` appelle `generateQuotationLines` (ligne 2342) puis tente d'utiliser `freightFCFA` (ligne 2377)

La variable n'existe pas dans ce scope. D'ou le crash `freightFCFA is not defined`.

### Correction

Dans le handler principal (lignes 2374-2378), recalculer `freightFCFA` localement avant le second `calculateCAF`. Le code a inserer juste avant la ligne 2374 :

```text
// P0 CAF strict: recalcul freightFCFA pour metadata (meme logique que generateQuotationLines)
let freightFCFA: number | undefined = undefined;
if (request.freightAmount && request.freightAmount > 0) {
  const freightCur = String(request.freightCurrency ?? 'XOF').trim().toUpperCase();
  if (freightCur === 'XOF' || freightCur === 'FCFA' || freightCur === 'CFA') {
    freightFCFA = request.freightAmount;
  } else if (freightCur === 'EUR') {
    freightFCFA = request.freightAmount * 655.957;
  } else if (freightCur === 'USD') {
    if (request.exchangeRateUSD && request.exchangeRateUSD > 0) {
      freightFCFA = request.freightAmount * request.exchangeRateUSD;
    }
  }
}
```

Puis la ligne 2374-2378 reste identique (elle utilisera le `freightFCFA` local).

Note : pas de `throw` ici car le premier appel dans `generateQuotationLines` a deja valide. Ce second appel est purement pour les metadata.

## Probleme 2 : `cargo.hs_code` absent des whitelists

Sans ce champ editable, l'operateur ne peut pas saisir le code HS manuellement, et le pricing reste bloque par le soft blocker `HS_CODE_REQUIRED`.

### Fichier 1 : `supabase/functions/set-case-fact/index.ts`

Ajouter `"cargo.hs_code"` dans `ALLOWED_FACT_KEYS` (ligne 14-33).

### Fichier 2 : `src/pages/CaseView.tsx`

Ajouter `"cargo.hs_code"` dans `EDITABLE_FACT_KEYS` (apres les autres cles cargo).

`cargo.hs_code` est un champ texte (code 10 chiffres), il ne doit PAS etre ajoute a `NUMERIC_FACT_KEYS`.

## Fichiers modifies (3 fichiers)

| Fichier | Modification |
|---------|-------------|
| `supabase/functions/quotation-engine/index.ts` | Recalcul local de `freightFCFA` avant le second `calculateCAF` (ligne 2374) |
| `supabase/functions/set-case-fact/index.ts` | Ajout `cargo.hs_code` a `ALLOWED_FACT_KEYS` |
| `src/pages/CaseView.tsx` | Ajout `cargo.hs_code` a `EDITABLE_FACT_KEYS` |

## Risque

Nul. Le recalcul local est une duplication mineure mais sure (meme logique, sans throw pour le cas metadata). L'ajout aux whitelists est purement additif.

## Resultat attendu

- Le crash `freightFCFA is not defined` disparait
- L'operateur peut saisir `cargo.hs_code` manuellement
- Le pricing peut se lancer si toutes les donnees sont presentes
