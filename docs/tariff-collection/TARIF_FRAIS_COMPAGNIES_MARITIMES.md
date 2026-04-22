# TARIF — FRAIS COMPAGNIES MARITIMES

**Tables base** : `carrier_billing_templates` (59), `demurrage_rates` (35), `demurrage_tiers`
**Service keys liés** : `SEA_FREIGHT`, `DTHC`, `DOCUMENTATION_BL`, `EMPTY_REPO`, charges THO
**Mémoires liées** : `carrier-import-charges-activation-v2`, `carrier-variable-fees`, `demurrage-rates-dakar-standard`, `demurrage-tiered-model`, `terminal-handling-deduplication-policy`
**Priorité globale** : **P0**

> ⚠️ Carrier inconnu → politique automatique "À confirmer" déjà active (Lot 4-A précédent).
> Frais variables (`is_variable: true`) : nécessitent override manuel opérateur (mémoire `carrier-variable-fees`).

| Famille tarifaire | Service key application | Libellé métier SODATRA | Mode transport | Sens | Incoterm concerné | Unité de facturation | Quantité utilisée | Tarif HT XOF | Valeur existante en base | Validation SODATRA | Devise si différente | TVA applicable | Minimum facturable | Maximum facturable | Base de calcul | Conditions d'application | Exemple de calcul | Source du tarif | Fournisseur / compagnie / terminal | Date de validité | Statut | Priorité | Impact si non renseigné | Table cible future | Commentaire équipe SODATRA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Fret maritime carrier (FCL) | `SEA_FREIGHT` | Fret maritime conteneur | MARITIME FCL | IMPORT / EXPORT | EXW / FOB / CIF / CFR | EVP | `cargo.container_count` | À renseigner | À vérifier (`carrier_billing_templates` 59 lignes) | à valider | USD | À renseigner | À renseigner | À renseigner | par EVP + carrier + corridor | FCL | À renseigner | Compagnie maritime | MSC / CMA / Maersk / etc. | À renseigner | à renseigner | P0 | devis impossible | `carrier_billing_templates` | RFQ par carrier |
| THC out (variable) | `THO` | Terminal Handling Out | MARITIME FCL | tous | tous | EVP | `cargo.container_count` | À renseigner | `is_variable: true`, `default_amount: null` | à valider | — | À renseigner | — | — | override opérateur | par carrier | À renseigner | Compagnie | carrier | À renseigner | à confirmer | P1 | ligne à confirmer | `carrier_billing_templates` | Mémoire `carrier-variable-fees` |
| Documentation B/L | `DOCUMENTATION_BL` | Documentation B/L | MARITIME | tous | tous | BL | 1 | À renseigner | À vérifier | à valider | USD probable | À renseigner | — | — | par BL | tous BL | À renseigner | Compagnie | carrier | À renseigner | à renseigner | P0 | risque de 0 (export Lot 1) | `carrier_billing_templates` | |
| Repositionnement vide | `EMPTY_REPO` | Repositionnement conteneur vide | MARITIME FCL | EXPORT | tous | EVP | `cargo.container_count` | À renseigner | Placeholder export | à corriger | — | À renseigner | — | — | par EVP | dépôt distant | À renseigner | Compagnie | carrier | À renseigner | à confirmer | P1 | ligne à confirmer | `carrier_billing_templates` | |
| Demurrage Dry — palier 1 | `DEMURRAGE` | Surestaries Dry standard | MARITIME FCL | IMPORT | tous | jour × EVP | dérivé séjour | À renseigner | À vérifier (`demurrage_rates` 35 lignes + tiers) | à valider | USD probable | À renseigner | — | — | par jour après franchise | franchise 10j Dry | À renseigner | Compagnie maritime | carrier | À renseigner | à renseigner | P1 | total incomplet | `demurrage_tiers` | Mémoire `demurrage-rates-dakar-standard` (10j Dry / 3j Reefer) |
| Demurrage Reefer | `DEMURRAGE` | Surestaries Reefer | MARITIME FCL | IMPORT | tous | jour × EVP | dérivé séjour | À renseigner | À vérifier | à valider | USD probable | À renseigner | — | — | par jour après franchise | franchise 3j Reefer | À renseigner | Compagnie | carrier | À renseigner | à renseigner | P1 | total incomplet | `demurrage_tiers` | Reefer franchise plus courte |
| Carrier inconnu | tous | Carrier non référencé | MARITIME | tous | tous | — | — | À confirmer (auto) | N/A (politique active) | à valider | — | — | — | — | aucun (TO_CONFIRM) | carrier hors base | aucun calcul | N/A | N/A | N/A | à confirmer | P0 | ligne à confirmer | `carrier_billing_templates` | Mémoire `carrier-import-charges-activation-v2` — règle anti-hallucination |

## Zones floues identifiées
- Tarification BAF / CAF / GRI : non couverte aujourd'hui (différé P2).
- Demurrage paliers : modèle actif via `demurrage_tiers` mais couverture par carrier à valider individuellement.
- Politique de change USD → XOF : centralisée dans `exchange_rates` (mémoire `exchange-rate-management-system`).
