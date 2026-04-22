# TARIF — SEA LCL IMPORT DAP / DAP_PROJECT / EXW

**Packages application** : `LCL_IMPORT_DAP`, `DAP_PROJECT_IMPORT`, `LCL_IMPORT_EXW`, `DAP_PROJECT_IMPORT_EXW`
**Services injectés** :
- `LCL_IMPORT_DAP` : `PORT_DAKAR_HANDLING`, `CUSTOMS_DAKAR`, `TRUCKING`, `AGENCY`
- `DAP_PROJECT_IMPORT` : `PORT_DAKAR_HANDLING`, `DTHC`, `TRUCKING`, `EMPTY_RETURN`, `CUSTOMS_DAKAR`
- variantes EXW : ajoutent `PICKUP_ORIGIN`, `PRE_CARRIAGE`, `SEA_FREIGHT`

**Spécificité DAP** : droits/taxes **non inclus** (charge destinataire).
**Priorité globale** : **P0**

| Famille tarifaire | Service key application | Libellé métier SODATRA | Mode transport | Sens | Incoterm concerné | Unité de facturation | Quantité utilisée | Tarif HT XOF | Valeur existante en base | Validation SODATRA | Devise si différente | TVA applicable | Minimum facturable | Maximum facturable | Base de calcul | Conditions d'application | Exemple de calcul | Source du tarif | Fournisseur / compagnie / terminal | Date de validité | Statut | Priorité | Impact si non renseigné | Table cible future | Commentaire équipe SODATRA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Frais port Dakar | `PORT_DAKAR_HANDLING` | Manutention PAD | MARITIME | IMPORT | DAP / EXW | tonne / cbm / EVP | dérivé cargo | À renseigner | À vérifier (`port_tariffs`) | à valider | — | non | À renseigner | À renseigner | PAD 2006 | scope=import | À renseigner | PAD Dakar | PAD | À renseigner | à renseigner | P0 | devis impossible | `port_tariffs` | Voir `TARIF_PORT_TERMINAL.md` |
| THC destination | `DTHC` | Terminal Handling Charge destination | MARITIME FCL | IMPORT | DAP / EXW | EVP | `cargo.container_count` | À renseigner | À vérifier (cf. `destination_terminal_rates` + dédup THC `terminal-handling-deduplication-policy`) | à valider | — | À renseigner | À renseigner | À renseigner | par EVP | FCL uniquement | À renseigner | DPW Dakar | DP World | À renseigner | à renseigner | P0 | devis impossible | `destination_terminal_rates` | Politique dédup THC/DTHC active |
| Dédouanement Dakar | `CUSTOMS_DAKAR` | Dédouanement import | MARITIME | IMPORT | DAP / EXW | déclaration | 1 | À renseigner | À vérifier (`pricing_customs_tiers`) | à valider | — | non | À renseigner | À renseigner | paliers CAF | tous incoterms | À renseigner | À renseigner | SODATRA | À renseigner | à renseigner | P0 | devis impossible | `pricing_customs_tiers` | |
| Transport routier | `TRUCKING` | Camionnage destination | MARITIME | IMPORT | DAP / EXW | voyage | dérivé destination | À renseigner | À vérifier (`local_transport_rates`) | à valider | — | À renseigner | À renseigner | À renseigner | par zone | destination résolue | À renseigner | À renseigner | Transporteur partenaire | À renseigner | à renseigner | P0 | devis impossible | `local_transport_rates` | |
| Retour conteneur vide | `EMPTY_RETURN` | Retour vide | MARITIME FCL | IMPORT | DAP | EVP | `cargo.container_count` | 0 (non facturable SN) | N/A | validé (mémoire `container-empty-return-senegal`) | — | — | — | — | non facturé | imports SN standard | non facturé | N/A | N/A | N/A | non applicable | P2 | info interne | N/A | Non-facturable selon mémoire projet |
| Frais agence | `AGENCY` | Frais agence import | MARITIME | IMPORT | DAP / EXW | forfait | 1 | À renseigner | À vérifier | à valider | — | non | À renseigner | À renseigner | forfaitaire | tous packages | À renseigner | À renseigner | SODATRA | À renseigner | à renseigner | P1 | ligne à confirmer | `pricing_rate_cards` | |
| Enlèvement origine | `PICKUP_ORIGIN` | Enlèvement origine | MARITIME | IMPORT | EXW / FCA | forfait | 1 | À renseigner | À vérifier | à valider | EUR/USD probable | À renseigner | À renseigner | À renseigner | forfaitaire | EXW / FCA | À renseigner | Agent partenaire | partenaire | À renseigner | à renseigner | P1 | ligne à confirmer | `pricing_rate_cards` | RFQ partenaire |
| Pré-acheminement | `PRE_CARRIAGE` | Pré-acheminement vers port | MARITIME | IMPORT | EXW / FCA | voyage | 1 | À renseigner | À vérifier | à valider | EUR/USD | À renseigner | À renseigner | À renseigner | par distance | EXW / FCA | À renseigner | Transporteur origine | partenaire | À renseigner | à renseigner | P1 | ligne à confirmer | `pricing_rate_cards` | RFQ partenaire |
| Fret maritime | `SEA_FREIGHT` | Fret maritime | MARITIME | IMPORT | EXW / FCA / FAS / FOB | EVP | `cargo.container_count` | À renseigner | À vérifier (`carrier_billing_templates`) | à valider | USD probable | À renseigner | À renseigner | À renseigner | par EVP + carrier | FCL + EXW/FOB | À renseigner | Compagnie maritime | carrier | À renseigner | à renseigner | P0 | devis impossible | `carrier_billing_templates` | RFQ carrier — voir `TARIF_FRAIS_COMPAGNIES_MARITIMES.md` |

## Zones floues identifiées
- Distinction `PORT_DAKAR_HANDLING` vs `DTHC` : la mémoire `deferred-tariff-decisions` rappelle que la séparation est **volontairement maintenue** (dette acceptée).
- Frais surveys (`SURVEY`) optionnels selon nature cargo (project) — à clarifier qui décide.
