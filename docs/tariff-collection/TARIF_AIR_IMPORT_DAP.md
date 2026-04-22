# TARIF — AIR IMPORT DAP / EXW

**Packages application** : `AIR_IMPORT_DAP`, `AIR_IMPORT_EXW`
**Services injectés** :
- `AIR_IMPORT_DAP` : `AIR_HANDLING`, `CUSTOMS_DAKAR`, `TRUCKING`, `AGENCY`
- `AIR_IMPORT_EXW` : `PICKUP_ORIGIN`, `PRE_CARRIAGE`, `AIR_FREIGHT`, `AIR_HANDLING`, `CUSTOMS_DAKAR`, `TRUCKING`, `AGENCY`

**Spécificité DAP** : droits/taxes **non inclus** (à la charge du destinataire).
**Priorité globale** : **P0**

> ⚠️ Aucun tarif inventé. Distinguer `Valeur existante en base` de `Validation SODATRA`.

| Famille tarifaire | Service key application | Libellé métier SODATRA | Mode transport | Sens | Incoterm concerné | Unité de facturation | Quantité utilisée | Tarif HT XOF | Valeur existante en base | Validation SODATRA | Devise si différente | TVA applicable | Minimum facturable | Maximum facturable | Base de calcul | Conditions d'application | Exemple de calcul | Source du tarif | Fournisseur / compagnie / terminal | Date de validité | Statut | Priorité | Impact si non renseigné | Table cible future | Commentaire équipe SODATRA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Enlèvement origine | `PICKUP_ORIGIN` | Enlèvement à l'origine | AIR | IMPORT | EXW / FCA | forfait | 1 | À renseigner | À vérifier | à valider | EUR / USD probable | À renseigner | À renseigner | À renseigner | forfaitaire pays origine | EXW / FCA uniquement | À renseigner | À renseigner | Agent origine partenaire | À renseigner | à renseigner | P1 | ligne à confirmer | `pricing_rate_cards` | RFQ partenaire (cf. TARIF_PARTENAIRES.md) |
| Pré-acheminement | `PRE_CARRIAGE` | Pré-acheminement vers aéroport | AIR | IMPORT | EXW / FCA | voyage | 1 | À renseigner | À vérifier | à valider | EUR / USD probable | À renseigner | À renseigner | À renseigner | par distance | EXW / FCA uniquement | À renseigner | À renseigner | Transporteur origine | À renseigner | à renseigner | P1 | ligne à confirmer | `pricing_rate_cards` | RFQ partenaire |
| Fret aérien | `AIR_FREIGHT` | Fret aérien | AIR | IMPORT | EXW / FCA / FAS | kg | `cargo.chargeable_weight_kg` | À renseigner | À vérifier | à valider | USD probable | À renseigner | À renseigner | À renseigner | poids taxable × tarif/kg | mode=AIR + EXW/FCA/FAS | À renseigner | À renseigner | Compagnie aérienne | À renseigner | à renseigner | P0 | devis impossible | `pricing_rate_cards` | RFQ compagnie aérienne |
| Manutention aéroportuaire | `AIR_HANDLING` | Manutention aéroportuaire DKR | AIR | IMPORT | DAP / EXW | kg | `cargo.chargeable_weight_kg` | À renseigner | À vérifier (cf. `pricing_rate_cards`) | à valider | — | À renseigner | À renseigner | À renseigner | poids taxable × tarif/kg | scope=import + mode=AIR | À renseigner | À renseigner | Handler DKR | À renseigner | à renseigner | P0 | devis impossible | `pricing_rate_cards` | |
| Dédouanement Dakar | `CUSTOMS_DAKAR` | Dédouanement import | AIR | IMPORT | DAP / EXW | déclaration | 1 | À renseigner | À vérifier (cf. `pricing_customs_tiers`) | à valider | — | non | À renseigner | À renseigner | par paliers CAF | tous incoterms | À renseigner | À renseigner | SODATRA | À renseigner | à renseigner | P0 | devis impossible | `pricing_customs_tiers` | |
| Transport routier | `TRUCKING` | Camionnage destination | AIR | IMPORT | DAP / EXW | voyage | dérivé `routing.destination_city` | À renseigner | À vérifier (cf. `local_transport_rates`) | à valider | — | À renseigner | À renseigner | À renseigner | par zone | mode=AIR + destination résolue | À renseigner | À renseigner | Transporteur partenaire | À renseigner | à renseigner | P0 | devis impossible | `local_transport_rates` | |
| Frais agence | `AGENCY` | Frais agence import | AIR | IMPORT | DAP / EXW | forfait | 1 | À renseigner | À vérifier | à valider | — | non | À renseigner | À renseigner | forfaitaire | tous packages | À renseigner | À renseigner | SODATRA | À renseigner | à renseigner | P1 | ligne à confirmer | `pricing_rate_cards` | |

## Zones floues identifiées
- Conversion devise pré-acheminement / fret aérien : EUR ou USD ? Politique de change déjà centralisée (`exchange_rates`) — confirmer la devise contractuelle source.
- `PICKUP_ORIGIN` doit-il être systématique ou conditionné à la déclaration client ?
