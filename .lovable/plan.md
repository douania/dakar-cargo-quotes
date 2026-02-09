
# Phase PRICING V2 — Paliers douaniers ✅ IMPLÉMENTÉ

## Résumé

Customs tier resolver intégré dans `price-service-lines` pour services `CUSTOMS_*`, avec les 3 corrections CTO appliquées.

## Corrections CTO appliquées

| # | Correction | Implémentation |
|---|---|---|
| 1 | percent = taux réel + CHECK 0-20 | `caf * percent / 100`, constraint SQL `pricing_customs_tiers_percent_chk` |
| 2 | max_value exclusif + range CHECK | `caf < tier.max_value`, constraint `pricing_customs_tiers_range_chk` |
| 3 | CAF depuis fact canonique unique | `factsMap.get("cargo.caf_value")?.value_number` |

## Migration SQL exécutée

- 4 CHECK constraints : mode, basis, percent (0-20), range (min < max)
- 1 index : `idx_customs_tiers_lookup(mode, basis, min_value, max_value) WHERE active`
- 6 seed tiers : 3 AIR/CAF + 3 SEA/CAF

## Backend modifié

**Fichier** : `supabase/functions/price-service-lines/index.ts`

1. `PricingContext.caf_value` ajouté
2. `buildPricingContext` extrait `cargo.caf_value` (value_number)
3. `pricing_customs_tiers` chargé dans Promise.all
4. Customs tier resolver inséré AVANT catalogue V1

## Cascade de résolution finale

```
1. CUSTOMS_* + CAF > 0 + tier trouvé → customs_tier
2. Catalogue SODATRA (V1, inchangé)
3. Rate cards (fallback)
4. Port tariffs (fallback DTHC)
5. null
```

## Ce qui n'a pas changé

- Catalogue SODATRA V1
- Modifiers V1 (réutilisés dans customs tier)
- Rate cards / port_tariffs
- Frontend
- Autres edge functions
