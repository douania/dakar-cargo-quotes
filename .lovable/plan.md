


# Phase PRICING V1 — IMPLÉMENTÉ ✅

## Résumé

Grille tarifaire SODATRA déterministe avec cascade catalogue → modifiers → rate_cards → port_tariff → null.

## Tables créées

- `pricing_service_catalogue` (5 entrées seed, CHECK sur pricing_mode)
- `pricing_modifiers` (3 entrées seed, CHECK sur type)
- `pricing_customs_tiers` (structure V2, vide)

## Backend (price-service-lines)

- Chargement catalogue + modifiers dans Promise.all
- Lecture `active_modifiers` du body
- Resolver cascade : catalogue prioritaire, puis rate_cards, puis port_tariff
- UNIT_RATE calculé côté backend (lineTotal = base_price * quantity)
- Modifiers appliqués sur lineTotal, min_price EN DERNIER
- Traçabilité complète dans explanation

## Frontend (QuotationSheet)

- 3 switches : Urgent (+25%), Régularisation (+150K), Client premium (-10%)
- `callPriceServiceLines` accepte `modifiers` en paramètre
- useEffect sécurisé (serviceLinesRef, deps = [pricingModifiers, quoteCase?.id])
- Pas de boucle infinie (serviceLines lu via ref)

## Corrections CTO intégrées

1. base_price=0 : FIXED accepté, UNIT_RATE → fallback
2. CHECK constraints sur pricing_mode et modifier.type
3. Pas de updated_at (pas de trigger standard)
4. useEffect anti-boucle via ref + deps limitées
5. R2 CTO : quantity_used null/0 en UNIT_RATE → fallback
