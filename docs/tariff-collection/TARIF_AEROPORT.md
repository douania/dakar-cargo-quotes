# TARIF — AÉROPORT (Manutention + Fret aérien)

**Service keys application** : `AIR_HANDLING`, `AIR_FREIGHT`
**Tables base** : `pricing_rate_cards` (à compléter), `pricing_service_catalogue`
**Priorité globale** : **P1**

> ⚠️ Modes EXW / FCA AIR ajoutent `PICKUP_ORIGIN` et `PRE_CARRIAGE` (cf. `TARIF_AIR_IMPORT_DAP.md`).

| Famille tarifaire | Service key application | Libellé métier SODATRA | Mode transport | Sens | Incoterm concerné | Unité de facturation | Quantité utilisée | Tarif HT XOF | Valeur existante en base | Validation SODATRA | Devise si différente | TVA applicable | Minimum facturable | Maximum facturable | Base de calcul | Conditions d'application | Exemple de calcul | Source du tarif | Fournisseur / compagnie / terminal | Date de validité | Statut | Priorité | Impact si non renseigné | Table cible future | Commentaire équipe SODATRA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Manutention aéroportuaire DKR | `AIR_HANDLING` | Manutention DKR (handler) | AIR | IMPORT / EXPORT | tous | kg | `cargo.chargeable_weight_kg` | À renseigner | À vérifier (`pricing_rate_cards`) | à valider | — | À renseigner | À renseigner | À renseigner | poids taxable × tarif/kg | scope=import/export AIR | À renseigner | Handler DKR | À renseigner | À renseigner | à renseigner | P0 | devis impossible | `pricing_rate_cards` | Tranches poids potentielles |
| Fret aérien | `AIR_FREIGHT` | Fret aérien | AIR | IMPORT | EXW / FCA / FAS | kg | `cargo.chargeable_weight_kg` | À renseigner | À vérifier | à valider | USD probable | À renseigner | À renseigner | À renseigner | poids taxable × tarif/kg | EXW / FCA / FAS uniquement | À renseigner | Compagnie aérienne | carrier | À renseigner | à renseigner | P0 | devis impossible | `pricing_rate_cards` | RFQ compagnie aérienne |
| Surcharge sécurité / fuel | `AIR_FREIGHT` (surcharge) | Surcharge fuel / sécurité | AIR | IMPORT / EXPORT | tous | kg | `cargo.chargeable_weight_kg` | À renseigner | Non séparée actuellement | à valider | USD probable | — | — | — | par kg | volatil | À renseigner | Compagnie | carrier | À renseigner | à renseigner | P2 | info interne | `pricing_rate_cards` (séparé) | Modélisation séparée à valider |

## Zones floues identifiées
- Définition `cargo.chargeable_weight_kg` : ratio volumétrique 1:6 standard IATA — confirmer.
- Tranches dégressives par poids ? À documenter.
- RFQ compagnies aériennes : à intégrer dans `TARIF_PARTENAIRES.md`.
