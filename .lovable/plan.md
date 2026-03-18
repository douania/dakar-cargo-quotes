

# Diagnostic : pourquoi l'erreur apparait encore

## Ce qui fonctionne deja
Le frontend EQ1.2-quinquies fonctionne correctement :
- Il extrait l'erreur depuis `FunctionsHttpError.context`
- Il ouvre la modale GAINDE
- L'utilisateur saisit le taux (602.2 USD/XOF, 201 OK)
- Le 2e appel `run-pricing` reussit (200, 8 lignes, total_ht 145000)

## Ce qui ne fonctionne PAS
La fonction edge `run-pricing` n'a **pas ete redeployee** avec le code soft blocker (Phase EQ1.2-quinquies backend). Preuve : le log `[EQ1.2] Exchange rate blocker detected` n'apparait nulle part dans les logs edge function. Le backend retourne toujours un **HTTP 500** au lieu du 200 soft blocker.

Consequence : le premier appel declenche un 500 qui provoque le popup d'erreur de la plateforme avant que le composant puisse le gerer proprement.

## Correction
Deployer la fonction edge `run-pricing` pour activer le code soft blocker deja ecrit. Aucune modification de code necessaire -- juste un redeploiement.

### Detail technique
Le fichier `supabase/functions/run-pricing/index.ts` contient deja le bon code (lignes 1578-1627) qui :
1. Detecte `Exchange rate for [CUR] expired or missing`
2. Enregistre le pricing_run comme `blocked` (pas `failed`)
3. Retourne HTTP 200 avec `pricing_blockers: ["EXCHANGE_RATE_REQUIRED"]`

Il suffit de forcer le deploiement de cette fonction.

