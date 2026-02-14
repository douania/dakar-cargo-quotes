

# Test de regression — pricing_engine_regression.test.ts

## Objectif

Creer un fichier de test Deno **purement local** (aucun appel reseau) qui valide la logique de repartition CAF dans le moteur de cotation. 5 cas de test couvrant les scenarios identifies par l'audit CTO.

## Fichier a creer

`supabase/functions/_tests/pricing_engine_regression.test.ts`

## Approche

Le test ne peut pas appeler `quotation-engine` directement (c'est un serveur HTTP Deno.serve). On va donc **extraire et tester la logique de repartition CAF** en la reimplementant dans le test comme fonction pure, puis valider qu'elle produit les resultats attendus.

Cela sert de **contrat de regression** : si quelqu'un modifie la logique dans le moteur, ce test documentera le comportement attendu.

## Les 5 tests

| # | Nom | Scenario | Assertion cle |
|---|---|---|---|
| 1 | Proportional 2 articles EUR | 165 EUR + 3760 EUR, CAF 3053480 FCFA | article1 ~4.2%, article2 ~95.8%, somme = CAF total |
| 2 | Equal fallback (no detail) | 2 HS, pas d'articlesDetail | chaque article = CAF/2 |
| 3 | Single article | 1 HS, 1 article | CAF entiere sur l'article unique |
| 4 | Mismatch HS vs articles | 2 HS mais 3 articles detail | fallback equal + warning |
| 5 | Mixed currencies (EUR + XOF) | 1 article EUR + 1 article XOF | conversion EUR→FCFA avant ratio |

## Detail technique

La fonction testee `computeCafDistribution` reproduit exactement la logique des lignes 2048-2087 du moteur avec les corrections M3.4.1 (conversion devise + guard couverture).

Chaque test verifie :
- La taille du tableau `cafDistribution`
- La methode de distribution (`proportional` ou `equal`)
- Les valeurs individuelles (avec tolerance d'arrondi de 1 FCFA)
- La somme totale = CAF exacte (pas de derive d'arrondi)
- Les warnings generes le cas echeant

## Aucune modification existante

- Aucun fichier existant modifie
- 1 seul fichier cree : `supabase/functions/_tests/pricing_engine_regression.test.ts`
- Executable avec : `deno test --allow-env supabase/functions/_tests/pricing_engine_regression.test.ts`

