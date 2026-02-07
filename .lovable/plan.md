
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

## Prochaines phases
- **R2** : Gouvernance documentaire (rattacher tarifs → documents, tariff_resolution_log étendu)
- **R3** : Sourcing 2026 (DPW, PAD, Hapag-Lloyd, AIBD)
