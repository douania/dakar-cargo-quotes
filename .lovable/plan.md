
# Phase PRICING V3.1 — Douane par poids (WEIGHT tiers) ✅ IMPLÉMENTÉ

## Résumé

Resolver WEIGHT intégré dans `price-service-lines` pour services `CUSTOMS_*`, avec les 3 corrections CTO appliquées.

## Corrections CTO appliquées

| # | Correction | Implémentation |
|---|---|---|
| 1 | Contrainte weight_range_chk gère les NULL | `(min IS NULL AND max IS NULL) OR (min IS NOT NULL AND (max IS NULL OR min < max))` |
| 2 | Garde anti-double résolution CAF+WEIGHT | `cafResolved` flag vérifie si pricedLines contient déjà un customs_tier pour cette ligne |
| R1 | price NOT NULL pour WEIGHT tiers | Contrainte `pricing_customs_tiers_weight_price_chk` |

## Migration SQL exécutée

- 2 CHECK constraints : `weight_range_chk`, `weight_price_chk`
- 6 seed tiers WEIGHT : 3 AIR (0-1t, 1-5t, 5t+) + 3 SEA (0-5t, 5-20t, 20t+)

## Backend modifié

**Fichier** : `supabase/functions/price-service-lines/index.ts`

1. `cafResolved` flag ajouté après bloc CAF (vérifie pricedLines)
2. Bloc resolver WEIGHT inséré entre CAF et catalogue V1
3. Logique : price fixe → modifiers → bounds → round
4. Explanation enrichie avec `tier=min-max` (recommandation CTO R2)

## Cascade de résolution finale (V3.1)

```
1. CUSTOMS_* + CAF > 0 + tier CAF trouvé     → customs_tier (V2)
2. CUSTOMS_* + weight > 0 + tier WEIGHT trouvé → customs_weight_tier (V3.1)
3. Catalogue SODATRA standard (V1)
4. Rate cards historiques
5. Port tariffs (DTHC)
6. null
```

## Ce qui n'a pas changé

- Resolver CAF V2 (inchangé)
- Catalogue SODATRA V1 (inchangé, reste fallback)
- Rate cards / port_tariffs (inchangés)
- Frontend (aucune modification)
- Autres edge functions (aucune modification)
- PricingContext (weight_kg existait déjà)

## Tests de validation

| Test | Entrée | Tier attendu | Résultat |
|---|---|---|---|
| AIR 500 kg | mode=AIR, weight=500, pas de CAF | AIR WEIGHT 0-1000 | 150 000 XOF |
| AIR 3000 kg | mode=AIR, weight=3000, pas de CAF | AIR WEIGHT 1000-5000 | 300 000 XOF |
| SEA 15000 kg | mode=SEA, weight=15000, pas de CAF | SEA WEIGHT 5000-20000 | 350 000 XOF |
| CAF prioritaire | mode=SEA, weight=5000, CAF=8M | tier CAF (V2) | 250 000 XOF (CAF gagne) |
| Ni CAF ni poids | mode=SEA, pas de weight, pas de CAF | fallback catalogue V1 | prix catalogue |
