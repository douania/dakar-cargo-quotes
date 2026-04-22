# TARIF — AIR IMPORT DDP

**Package application** : `AIR_IMPORT_DDP`
**Services injectés** (cf. `src/features/quotation/constants.ts`) : `AIR_HANDLING`, `CUSTOMS_DAKAR`, `TRUCKING`, `AGENCY`
**Spécificité DDP** : droits/taxes inclus → ligne `CUSTOMS_RESERVE` typée `TO_CONFIRM` si `cargo.value` absent (cf. Lot 4-A).
**Priorité globale** : **P0**

> ⚠️ Aucun tarif inventé. Remplir uniquement après validation SODATRA. Distinguer `Valeur existante en base` (snapshot lecture) de `Validation SODATRA` (relecture métier).

| Famille tarifaire | Service key application | Libellé métier SODATRA | Mode transport | Sens | Incoterm concerné | Unité de facturation | Quantité utilisée | Tarif HT XOF | Valeur existante en base | Validation SODATRA | Devise si différente | TVA applicable | Minimum facturable | Maximum facturable | Base de calcul | Conditions d'application | Exemple de calcul | Source du tarif | Fournisseur / compagnie / terminal | Date de validité | Statut | Priorité | Impact si non renseigné | Table cible future | Commentaire équipe SODATRA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Manutention aéroportuaire | `AIR_HANDLING` | À renseigner | AIR | IMPORT | DDP | kg | `cargo.chargeable_weight_kg` | À renseigner | À vérifier (cf. `pricing_rate_cards`) | à valider | — | À renseigner | À renseigner | À renseigner | poids taxable × tarif/kg | scope=import + mode=AIR | À renseigner | À renseigner | À renseigner (handler aéroport DKR) | À renseigner | à renseigner | P0 | devis impossible | `pricing_rate_cards` | |
| Dédouanement Dakar | `CUSTOMS_DAKAR` | Dédouanement import Dakar | AIR | IMPORT | DDP | déclaration | 1 | À renseigner | À vérifier (cf. `pricing_customs_tiers`) | à valider | — | non (frais admin) | À renseigner | À renseigner | par paliers CAF | tous incoterms import | À renseigner | À renseigner | SODATRA | À renseigner | à renseigner | P0 | devis impossible | `pricing_customs_tiers` | Paliers CAF déjà actifs en base (12 lignes) — à relire |
| Transport routier | `TRUCKING` | Camionnage destination | AIR | IMPORT | DDP | voyage | dérivé `routing.destination_city` | À renseigner | À vérifier (cf. `local_transport_rates`) | à valider | — | À renseigner | À renseigner | À renseigner | par zone destination | mode=AIR + destination résolue | À renseigner | À renseigner | Transporteur partenaire | À renseigner | à renseigner | P0 | devis impossible | `local_transport_rates` | |
| Frais agence | `AGENCY` | Frais agence import | AIR | IMPORT | DDP | forfait | 1 | À renseigner | À vérifier | à valider | — | non (frais admin) | À renseigner | À renseigner | forfaitaire | tous packages import | À renseigner | À renseigner | SODATRA | À renseigner | à renseigner | P1 | ligne à confirmer | `pricing_rate_cards` | |
| Droits & taxes | `CUSTOMS_RESERVE` (Lot 4-A) | Droits et taxes DDP | AIR | IMPORT | **DDP** | — | dérivé `cargo.value` + régime douanier | À confirmer (TO_CONFIRM si valeur absente) | N/A (calcul moteur) | à valider | — | exonéré selon régime | — | — | base CAF + DD + TVA + autres | DDP uniquement | À renseigner | DGD Sénégal | DGD | À renseigner | à confirmer | P0 | risque de 0 affiché (corrigé Lot 4-A) | `tax_rates` + `customs_regimes` | Lot 4-A : ligne réservée typée TO_CONFIRM → "À confirmer" jamais "0 FCFA" |

## Zones floues identifiées
- Tarif `AIR_HANDLING` par tranche de poids ? Forfait minimum ?
- `AGENCY` AIR : taux distinct du maritime ? À clarifier.
- Couverture HORS_PROMAD selon régime douanier pour droits & taxes.
