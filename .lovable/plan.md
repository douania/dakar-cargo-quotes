
# Phase R1 — Stabilisation base tarifaire ✅ TERMINÉE

## Résumé des opérations effectuées

### 1. Tables de gouvernance créées (migration)
- `unit_conversions` — 12 lignes (avec aliases CTO : 20, 40, 20GP, 40HC-OT, 40FR, 20RF, 40RF)
- `service_quantity_rules` — 12 lignes (DTHC, TRUCKING, EMPTY_RETURN, CUSTOMS_*, AGENCY, PORT_DAKAR_HANDLING, BORDER_FEES, SURVEY, DISCHARGE, PORT_CHARGES)
- `tariff_resolution_log` — 8 résolutions tracées (resolved_by = system_r1)
- `pricing_rate_cards` — colonnes ajoutées : `tariff_document_id`, `status`

### 2. Nettoyage DPW
- **8 doublons/conflits THC désactivés** (is_active=false)
- Source gold élue : "Arrêté DPW 2025"
- Lignes exclusives PDF conservées (Standard 40'=232.5k, Vide=75k, Transbordement=75k)
- 2 conflits résolus : Reefer Import (170.5k Arrêté vs 115k PDF), Reefer Export (170.5k vs 90k)

### 3. Classification RORO corrigée
- 11 lignes mises à jour avec tranches poids dans `classification`
- Ex: vehicle_heavy → vehicle_heavy_10000_20000kg

### 4. pricing_rate_cards marqués
- 34 lignes → status='to_confirm', effective_from='2025-01-01'

### 5. Document 2015 désactivé
- dpw_dakar_landside_tariff_2015.pdf → is_current=false

---

# Phase T3 — Branchement moteur quantités ✅ TERMINÉE

## Résumé des opérations effectuées

### 1. Migration SQL
- `quote_service_pricing` : colonnes `quantity_used` (numeric) et `unit_used` (text) ajoutées

### 2. Edge Function `price-service-lines` refactorisée
- **computeQuantity()** : calcul déterministe basé sur `service_quantity_rules` + `unit_conversions`
  - EVP : somme facteurs × quantités depuis cargo.containers
  - COUNT : logique CTO-T3 (TRUCKING = conteneurs ≥40' ; autres = physiques)
  - TONNE : cargo.weight_kg / 1000
  - FLAT : 1
- **Sécurités** : containers absent → qty=1, weight_kg ≤ 0 → qty=1
- **Fallback port_tariffs** pour DTHC quand aucun pricing_rate_cards ne match
- **Audit enrichi** : quantity_used + unit_used écrits dans quote_service_pricing
- Tables chargées en parallèle (Promise.all)

### 3. Patch frontend QuotationSheet.tsx
- `updateServiceLine` reçoit désormais `quantity` et `unit` depuis la réponse edge

### 4. Résultat attendu (cas 2×40HC Import DAP Bamako)
| Service | quantity_used | unit_used |
|---|---|---|
| DTHC | 4 | EVP |
| TRUCKING | 2 | VOYAGE |
| EMPTY_RETURN | 2 | EVP |
| CUSTOMS_DAKAR | 1 | DECL |
| AGENCY | 1 | FORFAIT |

---

# Phase A1 — Détection aérien + extraction cargo ✅ TERMINÉE

## Corrections CTO P0 intégrées

| Ref | Correction | Impact |
|---|---|---|
| P0-1 | `detectRequestType()` default = `UNKNOWN` au lieu de `SEA_FCL_IMPORT` | Évite forçage maritime sur cas ambigus |
| P0-2 | Breakbulk patterns vérifiés AVANT "container fact" | Évite faux FCL sur dimensions breakbulk |
| P0-3 | `MANDATORY_FACTS.AIR_IMPORT` : retiré `cargo.description` (assumable) | Réduit questions inutiles |
| P0-A | Container fact strict : doit avoir items avec quantity > 0 | Évite faux SEA sur fact vide |
| P0-B | IATA context : aussi "from XXX to YYY" (case-insensitive) | Couverture patterns fréquents |
| P0-C | Dimensions regex accepte × (multiplication unicode) | Parsing robuste |

## Résumé des opérations

### 1. Migration SQL
- `service_quantity_rules` : ajout AIR_HANDLING et AIR_FREIGHT avec `quantity_basis='KG'` (UPSERT)

### 2. Edge Function `build-case-puzzle`
- **detectRequestType()** refactorisé :
  1. AIR explicite en priorité (by air, air cargo, awb, etc.)
  2. Maritime sur indices forts (conteneurs, BL, vessel, POL/POD)
  3. Breakbulk AVANT container fact
  4. Container fact strict (quantity > 0)
  5. IATA codes avec contexte
  6. Default → UNKNOWN + question transport mode
- **extractFactsBasic()** enrichi :
  - weight_kg, volume_cbm, pieces_count, dimensions, description
  - Parsing nombre robuste (espaces, virgules, formats EU/US)
  - Chargeable weight déterministe : max(gross_kg, cbm×167) + audit IATA_167
- **Incoterm** : priorité TERM:/Incoterm: puis dernier match libre (plus break au premier)
- **ASSUMPTION_RULES** : ajout AIR_IMPORT → package AIR_IMPORT_DAP
- **AIR_IMPORT_BLOCKING_GAPS** : destination_city, weight_kg, pieces_count, client_email
- **MANDATORY_FACTS.AIR_IMPORT** : réduit (sans cargo.description, cargo.value, routing.incoterm)
- **UNKNOWN** : injecte 1 question ciblée "Confirmez le mode de transport"

### 3. Edge Function `price-service-lines`
- Whitelist : +AIR_HANDLING, +AIR_FREIGHT
- Unit aliases : +kg/KG
- **computeQuantity()** : nouveau basis KG
  - Si poids manquant → quantity_used=null → skip pricing (source=missing_quantity)
- **buildPricingContext()** : priorise cargo.chargeable_weight_kg > cargo.weight_kg

### 4. Frontend constants.ts
- Templates : +AIR_HANDLING, +AIR_FREIGHT
- Package : +AIR_IMPORT_DAP

### 5. Frontend parsing.ts (UX only)
- parseSubject() : détecte et retire "by AIR/SEA/TRUCK" de la destination
- parseEmailBody() : extraction légère poids/volume/pièces/dimensions pour preview

## Résultat attendu

| Champ | Avant (bug) | Après A1 |
|---|---|---|
| request_type | SEA_FCL_IMPORT | AIR_IMPORT |
| Incoterm | EXW (faux) | DAP |
| Poids | non extrait | 3234 kg |
| Volume | non extrait | 3 cbm |
| Pièces | non extrait | 6 |
| Chargeable weight | inexistant | 3234 kg |
| Services | DTHC, Trucking, Empty Return | AIR_HANDLING, CUSTOMS_DAKAR, TRUCKING, AGENCY |
| Questions | 9+ | 0-2 |

## Ce qui n'a PAS changé
- `PORT_COUNTRY_MAP` intact (routing, pas détection mode)
- `detectFlowType()` intact (fallback AIR dans applyAssumptionRules)
- Moteur maritime T3 (EVP, COUNT, TONNE) intact
- Schéma quote_cases / quote_facts non modifié
- pricing_rate_cards non touchés

## Prochaines phases
- **R2** : Gouvernance documentaire (rattacher tarifs → documents, tariff_resolution_log étendu)
- **R3** : Sourcing 2026 (DPW, PAD, Hapag-Lloyd, AIBD)
