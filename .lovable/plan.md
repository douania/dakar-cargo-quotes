
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

## Vérification finale
| Métrique | Valeur |
|---|---|
| unit_conversions | 12 lignes |
| service_quantity_rules | 12 lignes |
| tariff_resolution_log | 8 résolutions |
| THC DPW actifs | 16 lignes (sans doublons) |
| Tarifs désactivés | 8 |
| Rate cards to_confirm | 34 |

## Prochaines phases
- **R2** : Gouvernance documentaire (rattacher tarifs → documents, tariff_resolution_log étendu)
- **R3** : Sourcing 2026 (DPW, PAD, Hapag-Lloyd, AIBD)
- **T3** : Branchement moteur M3.7 sur unit_conversions + service_quantity_rules
