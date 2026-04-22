# TARIF — TRANSPORT ROUTIER (Sénégal + Mali + Frontières)

**Tables base** : `local_transport_rates` (91), `mali_transport_zones` (17), `border_clearing_rates` (6), `delivery_zones`
**Service key application** : `TRUCKING`, `ON_CARRIAGE`, `BORDER_FEES`, `PRE_CARRIAGE`
**Mémoires liées** : `transport-pricing-resolver-logic`, `mali-transit-pricing-complete`, `transport-official-vs-surcharge-separation`
**Priorité globale** : **P1**

> ⚠️ Aucun tarif inventé. Mali transit suit règles spéciales (distance + structurels).

| Famille tarifaire | Service key application | Libellé métier SODATRA | Mode transport | Sens | Incoterm concerné | Unité de facturation | Quantité utilisée | Tarif HT XOF | Valeur existante en base | Validation SODATRA | Devise si différente | TVA applicable | Minimum facturable | Maximum facturable | Base de calcul | Conditions d'application | Exemple de calcul | Source du tarif | Fournisseur / compagnie / terminal | Date de validité | Statut | Priorité | Impact si non renseigné | Table cible future | Commentaire équipe SODATRA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Camionnage Dakar → site SN | `TRUCKING` | Transport routier destination Sénégal | ROUTE | IMPORT / EXPORT | tous | voyage | dérivé `routing.destination_city` | À renseigner | À vérifier (91 lignes `local_transport_rates`) | à valider | — | À renseigner | À renseigner | À renseigner | par zone destination | destination résolue | À renseigner | SODATRA / Transporteur partenaire | partenaire | À renseigner | à renseigner | P1 | ligne à confirmer | `local_transport_rates` | Mémoire `transport-pricing-resolver-logic` (ZONE_MAPPING) |
| Camionnage on-carriage transit | `ON_CARRIAGE` | Transport vers site (transit) | ROUTE | TRANSIT | tous | voyage | 1 | À renseigner | À vérifier | à valider | — | À renseigner | À renseigner | À renseigner | par zone | scope transit | À renseigner | Transporteur partenaire | partenaire | À renseigner | à renseigner | P1 | ligne à confirmer | `local_transport_rates` | Exclusif avec TRUCKING (groupe dédup) |
| Pré-acheminement origine | `PRE_CARRIAGE` | Pré-acheminement port/aéroport | ROUTE | IMPORT | EXW / FCA | voyage | 1 | À renseigner | À vérifier | à valider | EUR / USD probable | À renseigner | À renseigner | À renseigner | par distance origine | EXW / FCA | À renseigner | Transporteur origine | partenaire | À renseigner | à renseigner | P1 | ligne à confirmer | `pricing_rate_cards` | RFQ partenaire |
| Transit Mali — base distance | `TRUCKING` (corridor Mali) | Transit Dakar → Bamako | ROUTE | TRANSIT | tous | voyage | 1 | À renseigner | À vérifier (`mali_transport_zones` 17 lignes) | à valider | — | À renseigner | À renseigner | À renseigner | par zone Mali (km) | corridor Mali | À renseigner | Transporteur Mali | partenaire | À renseigner | à renseigner | P1 | total incomplet | `mali_transport_zones` | Mémoire `mali-transit-pricing-complete` |
| Frais structurels Mali | `BORDER_FEES` (Mali) | Frais structurels corridor Mali | ROUTE | TRANSIT | tous | forfait | 1 | À renseigner | À vérifier | à valider | — | non | — | — | forfaitaire | corridor Mali | À renseigner | Frontière + Mali | autorités | À renseigner | à renseigner | P1 | total incomplet | `border_clearing_rates` | À distinguer du tarif distance |
| Frais frontière CEDEAO | `BORDER_FEES` | Frais frontière | ROUTE | TRANSIT | tous | forfait | 1 | À renseigner | À vérifier (`border_clearing_rates` 6 lignes) | à valider | — | non | — | — | forfaitaire | corridor CEDEAO | À renseigner | Postes frontière | autorités | À renseigner | à renseigner | P1 | total incomplet | `border_clearing_rates` | |
| Surcharge transport (saisonnier) | `TRUCKING` | Surcharge ad-hoc | ROUTE | tous | tous | forfait | 1 | À renseigner | Non en base (séparation officiel/surcharge) | à valider | — | À renseigner | — | — | ad-hoc | événements ponctuels | À renseigner | Transporteur | partenaire | À renseigner | à renseigner | P2 | info interne | `pricing_rate_cards` (séparé) | Mémoire `transport-official-vs-surcharge-separation` |

## Zones floues identifiées
- Couverture complète des destinations SN au-delà de Dakar : 91 lignes en base — exhaustivité à valider.
- Tarif aller-retour vs aller simple : règle implicite à documenter.
- Modélisation surcharges saisonnières : actuellement non faite — décision produit attendue.
