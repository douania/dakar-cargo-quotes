


# PHASE M1.3 — Migration des regles hardcodees vers la base de donnees (TERMINÉE)

## Objectif
Migrer les regles metier hardcodees dans `quotation-rules.ts` vers des tables parametrables, sans modifier l'API ni l'UI.

## Résumé d'implémentation

### Tables créées (2)

| Table | Records | Description |
|-------|---------|-------------|
| `sodatra_fee_rules` | 10 | Honoraires SODATRA (dédouanement, suivi, dossier, docs, commission) avec méthodes de calcul et facteurs de complexité |
| `delivery_zones` | 12 | Zones de livraison SN + transit (Dakar à Gambie) avec multiplicateurs, distances, jours additionnels |

### Tables connectées (2)

| Table | Records | Usage |
|-------|---------|-------|
| `incoterms_reference` | 11 | Remplace `INCOTERMS_MATRIX` hardcodé — chargement dynamique au démarrage |
| `operational_costs_senegal` | 12 | Frais d'escorte et autorisations pour transport exceptionnel (>40T, hors gabarit) |

### Correction appliquée

Le plan initial contenait `rate_percent = 0.4` pour le dédouanement. Valeur corrigée à `0.004` (0,4% de la valeur CAF), conforme au code existant.

### Fichiers modifiés

| Fichier | Changement |
|---------|-----------|
| `supabase/functions/quotation-engine/index.ts` | +4 loaders DB (incoterms, zones, sodatra_fees, operational_costs) avec fallback gracieux |
| `supabase/functions/_shared/quotation-rules.ts` | `INCOTERMS_MATRIX`, `DELIVERY_ZONES`, `calculateSodatraFees` marqués `@deprecated` |

### Tests de validation (tous OK)

| Test | Résultat |
|------|----------|
| Cotation Dakar 40HC CIF 50M | ✅ Honoraires depuis `sodatra_fee_rules (DB)` — dédouanement 120k, suivi 35k, dossier 25k, docs 15k |
| Cotation Tambacounda 20DV×2 FOB | ✅ Zone depuis `delivery_zones` — multiplicateur 2.2, complexité zone éloignée +0.36 |
| Cotation Bamako 40HC CIF MSC + OOG (55T, 20m, 3m) | ✅ Incoterm CIF depuis DB, demurrage MSC (100-300 USD/jour), transport exceptionnel (escorte 150-250k, autorisation 75-150k) depuis `operational_costs_senegal` |
| Zones DB chargées | ✅ 12 zones loaded from DB |
| Incoterms DB chargés | ✅ 11 incoterms loaded from DB |

## Ce qui ne change PAS

- Aucune API modifiée
- Aucune modification UI
- Fallbacks hardcodés conservés (graceful degradation si DB indisponible)
- Calculs normatifs M1.2 (neutralisation fallbacks, franchise, demurrage) intacts
