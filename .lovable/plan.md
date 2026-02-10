
# Phase PRICING V3.2 — Client Overrides (contrats tarifaires) ✅ IMPLÉMENTÉ

## Résumé

Resolver CLIENT_OVERRIDE intégré dans `price-service-lines` en position prioritaire (avant CAF, WEIGHT, catalogue), avec les 4 corrections CTO appliquées.

## Corrections CTO appliquées

| # | Correction | Implémentation |
|---|---|---|
| 1 | Unicité active par couple | `CREATE UNIQUE INDEX uniq_client_override_active ON pricing_client_overrides(client_code, service_code, COALESCE(mode_scope,'*')) WHERE active = true` |
| 2 | Cohérence dates | `CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to)` |
| 3 | Fact canonique client.code | `factsMap.get("client.code")?.value_text ?? null` — pas d'heuristique, skip si absent |
| 4 | UNIT_RATE skip si qty null/<=0 | `if (!computed.quantity_used || computed.quantity_used <= 0) skipOverride = true` → fallback cascade |

## Migration SQL exécutée

- Table `pricing_client_overrides` avec contraintes mode_chk + date_chk
- Unique partial index `uniq_client_override_active`
- Lookup index `idx_client_overrides_lookup`
- RLS : lecture authentifiée
- Seed test : AI0CARGO / CUSTOMS_DAKAR / FIXED / 200 000 XOF

## Backend modifié

**Fichier** : `supabase/functions/price-service-lines/index.ts`

1. `PricingContext` : ajout `client_code: string | null`
2. `buildPricingContext` : extraction depuis `client.code` fact canonique
3. `Promise.all` : +1 requête `pricing_client_overrides` (active=true)
4. `clientOverrideMap` : index Map `client_code::service_code`
5. Resolver client_override inséré AVANT customs CAF/WEIGHT
6. Logique : scope check → date check → FIXED/UNIT_RATE → modifiers FIRST → min_price LAST → round → confidence=1.0

## Cascade de résolution finale (V3.2)

```
1. client_override (V3.2)          → confidence 1.0
2. CUSTOMS_* + CAF + tier CAF      → customs_tier (V2)
3. CUSTOMS_* + weight + tier WEIGHT → customs_weight_tier (V3.1)
4. Catalogue SODATRA standard (V1)
5. Rate cards historiques
6. Port tariffs (DTHC)
7. null
```

## Ce qui n'a pas changé

- Resolver CAF V2 (inchangé)
- Resolver WEIGHT V3.1 (inchangé)
- Catalogue SODATRA V1 (inchangé)
- Rate cards / port_tariffs (inchangés)
- Frontend (aucune modification)
- Autres edge functions (aucune modification)

## Tests de validation attendus

| Test | Entrée | Résultat attendu |
|---|---|---|
| Override simple | client=AI0CARGO, CUSTOMS_DAKAR | 200 000 XOF, source=client_override, confidence=1.0 |
| Override + URGENT | client=AI0CARGO + URGENT(+25%) | 250 000 XOF, source=client_override+modifiers |
| Client normal | client=ACME, CUSTOMS_DAKAR | cascade CAF/WEIGHT/catalogue |
| Service sans override | client=AI0CARGO, DTHC | cascade rate_card/port_tariff |
| Override expiré | valid_to passé | cascade (override ignoré) |
| UNIT_RATE qty=0 | qty null ou <=0 | cascade (skip override, CTO Fix #4) |
