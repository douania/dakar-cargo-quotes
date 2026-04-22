# TARIF — SEA LCL IMPORT DDP

**Package application** : `LCL_IMPORT_DDP`
**Services injectés** : `PORT_DAKAR_HANDLING`, `CUSTOMS_DAKAR`, `TRUCKING`, `AGENCY`
**Spécificité DDP** : droits/taxes inclus → `CUSTOMS_RESERVE` typée TO_CONFIRM si `cargo.value` absent (Lot 4-A).
**Priorité globale** : **P0**

> ⚠️ Aucun tarif inventé.

| Famille tarifaire | Service key application | Libellé métier SODATRA | Mode transport | Sens | Incoterm concerné | Unité de facturation | Quantité utilisée | Tarif HT XOF | Valeur existante en base | Validation SODATRA | Devise si différente | TVA applicable | Minimum facturable | Maximum facturable | Base de calcul | Conditions d'application | Exemple de calcul | Source du tarif | Fournisseur / compagnie / terminal | Date de validité | Statut | Priorité | Impact si non renseigné | Table cible future | Commentaire équipe SODATRA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Frais port Dakar | `PORT_DAKAR_HANDLING` | Manutention PAD (T01–T14) | MARITIME LCL | IMPORT | DDP | tonne / cbm | `cargo.weight_kg` ou `cargo.volume_cbm` | À renseigner | À vérifier (cf. `port_tariffs` 98 lignes) | à valider | — | non (PAD) | À renseigner | À renseigner | nomenclature PAD 2006 | LCL + scope=import | À renseigner | PAD Dakar | PAD | À renseigner | à renseigner | P0 | devis impossible | `port_tariffs` | Voir `TARIF_PORT_TERMINAL.md` pour détail T01–T14 |
| Dédouanement Dakar | `CUSTOMS_DAKAR` | Dédouanement import | MARITIME LCL | IMPORT | DDP | déclaration | 1 | À renseigner | À vérifier (cf. `pricing_customs_tiers`) | à valider | — | non | À renseigner | À renseigner | paliers CAF | tous incoterms | À renseigner | À renseigner | SODATRA | À renseigner | à renseigner | P0 | devis impossible | `pricing_customs_tiers` | |
| Transport routier | `TRUCKING` | Camionnage destination | MARITIME LCL | IMPORT | DDP | voyage | dérivé `routing.destination_city` | À renseigner | À vérifier (cf. `local_transport_rates`) | à valider | — | À renseigner | À renseigner | À renseigner | par zone | LCL + destination résolue | À renseigner | À renseigner | Transporteur partenaire | À renseigner | à renseigner | P0 | devis impossible | `local_transport_rates` | |
| Frais agence | `AGENCY` | Frais agence import | MARITIME LCL | IMPORT | DDP | forfait | 1 | À renseigner | À vérifier | à valider | — | non | À renseigner | À renseigner | forfaitaire | tous packages | À renseigner | À renseigner | SODATRA | À renseigner | à renseigner | P1 | ligne à confirmer | `pricing_rate_cards` | |
| Droits & taxes | `CUSTOMS_RESERVE` (Lot 4-A) | Droits et taxes DDP | MARITIME LCL | IMPORT | **DDP** | — | dérivé `cargo.value` + régime | À confirmer (TO_CONFIRM si valeur absente) | N/A (calcul moteur) | à valider | — | exonéré selon régime | — | — | CAF + DD + TVA + autres | DDP uniquement | À renseigner | DGD Sénégal | DGD | À renseigner | à confirmer | P0 | risque de 0 (corrigé Lot 4-A) | `tax_rates` + `customs_regimes` | Lot 4-A : ligne réservée |

## Zones floues identifiées
- Choix tonne vs cbm pour `PORT_DAKAR_HANDLING` LCL : règle de bascule (1 tonne = 1 cbm ?) à confirmer.
- Frais empotage / dépotage CFS pour LCL import à clarifier (peut nécessiter ligne séparée).
