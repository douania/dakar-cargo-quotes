

# Correction P0 : Cache _rateCache stale entre requetes

## Constat

Points 1 et 2 de l'audit sont OK :
- `convertArticleValueToFCFA` est `async` et tous ses appels utilisent `await`
- `generateQuotationLines` est `async` et son appel utilise `await`

Point 3 est un risque reel :
- `_rateCache` (ligne 405) est un `Map` au niveau module
- Dans Deno Deploy (Lovable Cloud), le worker peut etre reutilise entre requetes
- Un taux mis a jour par un operateur pourrait ne pas etre pris en compte si le cache survit

## Correction

### Fichier unique : `supabase/functions/quotation-engine/index.ts`

Ajouter une seule ligne apres la creation du supabase client (ligne 2329) :

```text
_rateCache.clear();
```

Position exacte :

```text
const supabase = createSupabaseClient();
_rateCache.clear(); // <-- ajout ici
const body = await req.json();
```

## Impact

- 1 ligne ajoutee
- Garantit que chaque requete HTTP resout les taux depuis la DB
- Le cache `Map` reste utile DANS une meme requete (evite 4 queries identiques pour USD)
- Zero risque de stale data entre requetes

## Ce qui ne change pas

- Tout le reste du moteur
- Les 2 nouvelles edge functions
- La migration SQL
- Le frontend PricingLaunchPanel

