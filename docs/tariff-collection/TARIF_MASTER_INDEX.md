# TARIFF COLLECTION — MASTER INDEX

**Statut** : `in_progress` (campagne documentaire)
**Date d'ouverture** : 2026-04-22
**Périmètre** : grilles de collecte tarifaire pour validation SODATRA **avant toute injection en base**.
**Aucun runtime, aucune migration, aucun tarif inventé.**

---

## Inventaire base (read-only, snapshot 2026-04-22)

| Table | Lignes existantes | Famille couverte |
|-------|-------------------|------------------|
| `pricing_service_catalogue` | 11 | Catalogue services SODATRA (placeholders inclus) |
| `pricing_rate_cards` | 35 | Tarifs principaux par service |
| `service_quantity_rules` | 23 | Règles de quantité (CTO-T3) |
| `port_tariffs` | 98 | PAD T01–T14 + Dakar Terminal |
| `carrier_billing_templates` | 59 | Frais compagnies maritimes |
| `local_transport_rates` | 91 | Camionnage Sénégal |
| `destination_terminal_rates` | 10 | Terminaux destination |
| `demurrage_rates` | 35 | Surestaries (+ `demurrage_tiers` paliers) |
| `pricing_customs_tiers` | 12 | Frais agence douane par paliers CAF |
| `tax_rates` | 8 | Taxes UEMOA (DD, TVA, RS, etc.) |
| `border_clearing_rates` | 6 | Frais frontière CEDEAO |
| `mali_transport_zones` | 17 | Zones transit Mali |

> **Important** : "Lignes existantes" ≠ "Tarif validé SODATRA". Chaque grille distingue **Valeur existante en base** et **Validation SODATRA** (à valider / validé / à corriger / à supprimer).

---

## Grilles à remplir (11 fichiers)

| # | Fichier | Famille | Priorité globale |
|---|---------|---------|------------------|
| 1 | [TARIF_AIR_IMPORT_DDP.md](./TARIF_AIR_IMPORT_DDP.md) | Air import DDP | **P0** |
| 2 | [TARIF_AIR_IMPORT_DAP.md](./TARIF_AIR_IMPORT_DAP.md) | Air import DAP / EXW | **P0** |
| 3 | [TARIF_SEA_LCL_IMPORT_DDP.md](./TARIF_SEA_LCL_IMPORT_DDP.md) | LCL maritime DDP | **P0** |
| 4 | [TARIF_SEA_LCL_IMPORT_DAP.md](./TARIF_SEA_LCL_IMPORT_DAP.md) | LCL maritime DAP / DAP_PROJECT | **P0** |
| 5 | [TARIF_EXPORT_SENEGAL.md](./TARIF_EXPORT_SENEGAL.md) | Export Sénégal (whitelist Lot 1) | **P0** |
| 6 | [TARIF_TRANSPORT_ROUTIER.md](./TARIF_TRANSPORT_ROUTIER.md) | Camionnage SN + Mali + frontières | **P1** |
| 7 | [TARIF_FRAIS_COMPAGNIES_MARITIMES.md](./TARIF_FRAIS_COMPAGNIES_MARITIMES.md) | Carriers + demurrage | **P0** |
| 8 | [TARIF_PORT_TERMINAL.md](./TARIF_PORT_TERMINAL.md) | PAD T01–T14 + Dakar Terminal + DTHC | **P0** |
| 9 | [TARIF_AEROPORT.md](./TARIF_AEROPORT.md) | Manutention + fret aérien | **P1** |
| 10 | [TARIF_PARTENAIRES.md](./TARIF_PARTENAIRES.md) | Cas TO_CONFIRM / RFQ partenaires | **P1** |

---

## Légende des statuts

### Colonne **Statut**
- `confirmé` — tarif validé SODATRA + montant en base
- `à confirmer` — logique active mais montant à valider
- `à renseigner` — aucune donnée fiable
- `non applicable` — exclusion justifiée par code/docs

### Colonne **Validation SODATRA**
- `à valider` — valeur existe en base mais pas relue par SODATRA
- `validé` — relu et signé par SODATRA
- `à corriger` — valeur en base obsolète ou fausse
- `à supprimer` — entrée à retirer de la base

### Colonne **Priorité**
- **P0** — bloque ou fausse les devis client
- **P1** — important pour fiabilité commerciale
- **P2** — amélioration

### Colonne **Impact si non renseigné**
- `devis impossible`
- `ligne à confirmer`
- `risque de 0 affiché`
- `total incomplet`
- `info interne`

---

## Workflow de remplissage recommandé

1. **Lecture** : opérateur SODATRA lit la grille.
2. **Annotation** : remplir colonnes `Tarif HT XOF`, `Validation SODATRA`, `Source`, `Date validité`, `Commentaire`.
3. **Revue collégiale** : réunion équipe pour valider statuts.
4. **Conversion** (optionnel) : Markdown → Word/PDF (réunion) ou Excel/Sheet (saisie).
5. **Ingestion** : campagne future `TARIFF-INGESTION-CAMPAIGN` (lot séparé, runtime).

---

## Garde-fous (rappels mémoire projet)

- `exact-official-tariffs-only` : aucun tarif inventé.
- `opaque-pricing-strategy` : pas de colonne marge.
- `operator-in-the-loop-categorization-policy` : validation humaine obligatoire.
- `pad-nomenclature-alignment-v2` : grille port utilise T01–T14 PAD 2006.
- `outbound-email-governance-centralized-sender` : RFQ partenaires via `operations@sodatra.sn`.

---

## Zones floues identifiées (à clarifier avec SODATRA)

- Niveau de détail attendu sur `service_quantity_rules` (faut-il une grille séparée ?).
- Frais agence douane vs `pricing_customs_tiers` : règle par paliers CAF déjà active, à reconfirmer.
- Politique de TVA exonérée selon régime douanier (table `customs_regimes` 56 régimes — doit-on dupliquer ici ?).
- Surcharges saisonnières non couvertes (BAF, CAF, GRI compagnies maritimes) — différé P2.
