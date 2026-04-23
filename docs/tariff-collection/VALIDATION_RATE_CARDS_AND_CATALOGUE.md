# VALIDATION TARIFAIRE — `pricing_rate_cards` + `pricing_service_catalogue`

**Type** : document de validation / correction ciblée (Bloc B campagne anti-duplication).
**Date** : 2026-04-23
**Statut** : `to_validate_by_sodatra`
**Garde-fous** : aucun runtime modifié, aucune migration, aucune duplication des 11 grilles `TARIF_*.md`, aucun tarif inventé.

> Les 10 tables stables (Bloc A) sont validées via les 10 CSV `/mnt/documents/SODATRA_VALIDATION_*.csv`.
> Les vrais trous (Bloc C : `AIR_FREIGHT`, `AIR_HANDLING`, `PICKUP_ORIGIN`, `PRE_CARRIAGE`) restent collectés via les grilles existantes (`TARIF_AEROPORT.md`, `TARIF_PARTENAIRES.md`).
> Ce document couvre uniquement les **2 familles partiellement validées**.

---

## Section B.1 — `pricing_rate_cards` (35 lignes)

**Statut famille** : partiellement paramétrée / partiellement validée.

### B.1.a — Anomalie critique

| service_key | scope | container_type | value | currency | status | source | Action attendue SODATRA |
|---|---|---|---|---|---|---|---|
| `TRUCKING` | `import` | _(null)_ | **0** | XOF | **`active`** ⚠️ | `internal` | (1) basculer en `to_confirm` OU (2) supprimer la ligne OU (3) renseigner une valeur réelle |

**Risque runtime** : ligne `value = 0` + `status = active` → potentiel match positif avec tarif à zéro pour un cas TRUCKING import sans container_type spécifié. À arbitrer en priorité.

### B.1.b — 34 lignes `to_confirm` (validation par lots)

Toutes les lignes ci-dessous ont `status = to_confirm` et `source = internal`. Elles sont **inertes côté runtime** tant que non passées en `active`. SODATRA doit décider, par bloc, lesquelles activer.

#### Bloc AGENCY (3 lignes)
| service_key | scope | container_type | value (XOF) | Décision SODATRA | Valeur corrigée | Commentaire |
|---|---|---|---|---|---|---|
| AGENCY | export | — | 200 000 | ☐ valider ☐ corriger ☐ supprimer | | |
| AGENCY | import | — | 200 000 | ☐ valider ☐ corriger ☐ supprimer | | |
| AGENCY | transit | — | 250 000 | ☐ valider ☐ corriger ☐ supprimer | | |

#### Bloc BORDER / CUSTOMS (5 lignes)
| service_key | scope | container_type | value (XOF) | Décision SODATRA | Valeur corrigée | Commentaire |
|---|---|---|---|---|---|---|
| BORDER_FEES | transit | — | 250 000 | ☐ valider ☐ corriger ☐ supprimer | | doublon à arbitrer avec ligne 450 000 |
| BORDER_FEES | transit | — | 450 000 | ☐ valider ☐ corriger ☐ supprimer | | doublon à arbitrer avec ligne 250 000 |
| CUSTOMS_BAMAKO | transit | — | 400 000 | ☐ valider ☐ corriger ☐ supprimer | | |
| CUSTOMS_DAKAR | import | — | 350 000 | ☐ valider ☐ corriger ☐ supprimer | | |
| CUSTOMS_DAKAR | transit | — | 350 000 | ☐ valider ☐ corriger ☐ supprimer | | |
| CUSTOMS_EXPORT | export | — | 300 000 | ☐ valider ☐ corriger ☐ supprimer | | déjà cité Lot 1-B |

#### Bloc DTHC (7 lignes)
| service_key | scope | container_type | value (XOF) | Décision SODATRA | Valeur corrigée | Commentaire |
|---|---|---|---|---|---|---|
| DTHC | import | 20DV | 250 000 | ☐ | | |
| DTHC | import | 40DV | 350 000 | ☐ | | |
| DTHC | import | 40HC | 350 000 | ☐ | | |
| DTHC | import | 40RF | 450 000 | ☐ | | |
| DTHC | transit | 20DV | 250 000 | ☐ | | |
| DTHC | transit | 40DV | 350 000 | ☐ | | |
| DTHC | transit | 40HC | 350 000 | ☐ | | |

#### Bloc EMPTY_RETURN (5 lignes)
| service_key | scope | container_type | value (XOF) | Décision SODATRA |
|---|---|---|---|---|
| EMPTY_RETURN | import | 20DV | 150 000 | ☐ |
| EMPTY_RETURN | import | 40DV | 200 000 | ☐ |
| EMPTY_RETURN | import | 40HC | 200 000 | ☐ |
| EMPTY_RETURN | transit | 20DV | 150 000 | ☐ |
| EMPTY_RETURN | transit | 40HC | 200 000 | ☐ |

> ⚠️ Voir mémoire `container-empty-return-senegal` : pour imports SN standards, ce service est non-billable. Cohérence à valider.

#### Bloc TRUCKING (7 lignes — hors anomalie B.1.a)
| service_key | scope | container_type | value (XOF) | Décision SODATRA | Commentaire |
|---|---|---|---|---|---|
| TRUCKING | import | 20DV | 800 000 | ☐ | |
| TRUCKING | import | 40HC | 1 000 000 | ☐ | doublon 40HC à arbitrer |
| TRUCKING | import | 40HC | 1 200 000 | ☐ | doublon 40HC à arbitrer |
| TRUCKING | import | 40HC | 3 500 000 | ☐ | écart majeur — zone éloignée ? |
| TRUCKING | transit | 20DV | 1 800 000 | ☐ | |
| TRUCKING | transit | 40HC | 800 000 | ☐ | doublon 40HC transit |
| TRUCKING | transit | 40HC | 2 500 000 | ☐ | doublon 40HC transit |

> 🔁 Recouvrement potentiel avec `local_transport_rates` (91 lignes, hors blocs). À traiter dans le sous-lot dédié `local_transport_rates`.

#### Bloc PORT / DIVERS (7 lignes)
| service_key | scope | container_type | value (XOF) | Décision SODATRA |
|---|---|---|---|---|
| DISCHARGE | import | — | 18 000 | ☐ |
| ON_CARRIAGE | import | 40HC | 1 000 000 | ☐ |
| PORT_CHARGES | export | — | 12 000 | ☐ |
| PORT_DAKAR_HANDLING | import | — | 15 000 | ☐ |
| PORT_DAKAR_HANDLING | transit | — | 15 000 | ☐ |
| SURVEY | import | — | 500 000 | ☐ |

---

## Section B.2 — `pricing_service_catalogue` (11 lignes)

**Statut famille** : partiellement paramétrée (6 lignes export `base_price = 0`).

**Logique runtime active** : `EXPORT_PLACEHOLDER_SERVICE_KEYS` (Lot 1-B, `supabase/functions/price-service-lines/index.ts`) intercepte ces 6 services et les classe en `TO_CONFIRM` au lieu de produire un tarif à 0. **Comportement intentionnel — ne pas modifier sans décision SODATRA.**

| service_code | service_name | base_price | active | Statut runtime | Décision SODATRA |
|---|---|---|---|---|---|
| AGENCY | Frais agence import | 200 000 | ✓ | confirmé | ☐ valider ☐ corriger |
| AGENCY_TRANSIT | Frais agence transit | 250 000 | ✓ | confirmé | ☐ valider ☐ corriger |
| CUSTOMS_DAKAR | Déclaration import Dakar | 350 000 | ✓ | confirmé | ☐ valider ☐ corriger |
| CUSTOMS_EXPORT | Déclaration export | 300 000 | ✓ | confirmé | ☐ valider ☐ corriger |
| SURVEY | Expertise | 500 000 | ✓ | confirmé | ☐ valider ☐ corriger |
| **DOCUMENTATION_BL** | Documentation / B/L fees | **0** | ✓ | **placeholder TO_CONFIRM** | ☐ garder placeholder ☐ injecter valeur réelle : ____ |
| **EMPTY_REPO** | Repositionnement conteneur vide | **0** | ✓ | **placeholder TO_CONFIRM** | ☐ garder placeholder ☐ injecter : ____ |
| **STUFFING_CFS** | Empotage CFS / port | **0** | ✓ | **placeholder TO_CONFIRM** | ☐ garder placeholder ☐ injecter : ____ |
| **STUFFING_FACTORY** | Empotage usine | **0** | ✓ | **placeholder TO_CONFIRM** | ☐ garder placeholder ☐ injecter : ____ |
| **THC_EXPORT** | THC export | **0** | ✓ | **placeholder TO_CONFIRM** | ☐ garder placeholder ☐ injecter : ____ |
| **VGM_WEIGHING** | VGM / Pesée conteneur | **0** | ✓ | **placeholder TO_CONFIRM** | ☐ garder placeholder ☐ injecter : ____ |

---

## Section B.3 — Synthèse arbitrages SODATRA attendus

| # | Famille | Clé | Valeur actuelle | Validation SODATRA | Valeur corrigée | Statut | Commentaire |
|---|---|---|---|---|---|---|---|
| 1 | `pricing_rate_cards` | `TRUCKING / import / null / status=active` | 0 XOF | ☐ valider ☐ corriger ☐ supprimer | | **à corriger (critique)** | Anomalie B.1.a |
| 2 | `pricing_rate_cards` | 34 lignes `to_confirm` | divers | ☐ par bloc | | à compléter | Sections B.1.b |
| 3 | `pricing_service_catalogue` | 5 lignes confirmées (AGENCY/CUSTOMS/SURVEY) | divers | ☐ valider ☐ corriger | | à valider | Section B.2 |
| 4 | `pricing_service_catalogue` | 6 placeholders export à 0 XOF | 0 XOF | ☐ garder placeholder ☐ injecter valeur | | à compléter ou statu quo | Logique TO_CONFIRM Lot 1-B active |

---

## Suite (déclencheur `TARIFF-INGESTION-CAMPAIGN`)

Une fois ce document signé par SODATRA :
- Anomalie B.1.a → migration ciblée (1 UPDATE ou 1 DELETE).
- Lignes `to_confirm` validées → batch `UPDATE pricing_rate_cards SET status = 'active' WHERE …`.
- Placeholders export validés → soit conservation logique TO_CONFIRM, soit batch `UPDATE pricing_service_catalogue SET base_price = … WHERE service_code IN (…)`.

Aucune action runtime tant que ce fichier n'est pas signé.
