
# Gestion centralisée des taux de change douaniers GAINDE

## Statut : ✅ IMPLÉMENTÉ

### Modifications réalisées

| Fichier | Action | Statut |
|---------|--------|--------|
| Migration SQL | Table `exchange_rates` + RLS + unique index + seed EUR | ✅ |
| `supabase/functions/get-active-exchange-rate/index.ts` | Nouveau — résolution taux actif | ✅ |
| `supabase/functions/upsert-exchange-rate/index.ts` | Nouveau — insertion taux GAINDE | ✅ |
| `supabase/functions/quotation-engine/index.ts` | Helper `resolveExchangeRate` avec cache Map + 4 zones converties + `exchangeRateUSD` supprimé | ✅ |
| `supabase/functions/run-pricing/index.ts` | `freightExchangeRate` supprimé (interface, switch, body) | ✅ |
| `src/components/puzzle/PricingLaunchPanel.tsx` | Modale taux de change + relance auto | ✅ |

### Vérifications post-déploiement

- [x] Zéro occurrence de `655.957` dans quotation-engine
- [x] Zéro occurrence de `exchangeRateUSD` dans quotation-engine
- [x] Seed EUR en base : 655.957, BCEAO_FIXED, 2000-2100
- [x] Edge functions déployées : get-active-exchange-rate, upsert-exchange-rate, quotation-engine, run-pricing
- [x] requireUser protège les 2 nouvelles fonctions (401 si non authentifié)

### Flux opérateur

1. Pricing lancé → moteur détecte devise (ex: USD)
2. Query `exchange_rates` → taux valide → conversion auto → OK
3. Si taux absent/expiré → throw "Exchange rate for USD expired or missing"
4. PricingLaunchPanel intercepte → modale "Taux USD/XOF requis (source GAINDE)"
5. Opérateur saisit taux → `upsert-exchange-rate` insère (validité mardi suivant)
6. Pricing relancé automatiquement → succès
