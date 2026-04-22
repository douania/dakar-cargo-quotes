# TARIF — PORT & TERMINAL (PAD + Dakar Terminal + DPW)

**Tables base** : `port_tariffs` (98), `destination_terminal_rates` (10)
**Service keys liés** : `PORT_DAKAR_HANDLING`, `PORT_CHARGES`, `DTHC`, `DISCHARGE`
**Mémoires liées** : `pad-nomenclature-alignment-v2`, `pad-alias-registry`, `terminal-operator-distinction`, `terminal-handling-deduplication-policy`, `deferred-tariff-decisions`
**Priorité globale** : **P0**

> ⚠️ Distinction stricte : **Dakar Terminal (Bolloré)** = magasinage / stockage ; **DPW** = manutention conteneurs.
> Nomenclature alignée PAD 2006 — codes T01 à T14.

| Famille tarifaire | Service key application | Libellé métier SODATRA | Mode transport | Sens | Incoterm concerné | Unité de facturation | Quantité utilisée | Tarif HT XOF | Valeur existante en base | Validation SODATRA | Devise si différente | TVA applicable | Minimum facturable | Maximum facturable | Base de calcul | Conditions d'application | Exemple de calcul | Source du tarif | Fournisseur / compagnie / terminal | Date de validité | Statut | Priorité | Impact si non renseigné | Table cible future | Commentaire équipe SODATRA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PAD T01–T14 (manutention) | `PORT_DAKAR_HANDLING` | Redevances PAD 2006 | MARITIME | IMPORT / EXPORT | tous | tonne / cbm / EVP | dérivé cargo + cat. PAD | À renseigner | À vérifier (`port_tariffs` 98 lignes — couvre T01–T14) | à valider | — | non (PAD) | À renseigner | À renseigner | nomenclature PAD par catégorie | scope=import + cat. PAD résolue | À renseigner | PAD Dakar | PAD | À renseigner | à renseigner | P0 | devis impossible | `port_tariffs` | Mémoire `pad-nomenclature-alignment-v2` + `pad-alias-registry` (60 alias) |
| Magasinage Dakar Terminal | `STORAGE_DT` | Magasinage Dakar Terminal | MARITIME | IMPORT | tous | jour × EVP | dérivé séjour | À renseigner | À vérifier (`destination_terminal_rates` 10 lignes) | à valider | — | À renseigner | À renseigner | À renseigner | par jour + franchise | franchise 10j PAD | À renseigner | Dakar Terminal (Bolloré) | Bolloré | À renseigner | à renseigner | P1 | total incomplet | `destination_terminal_rates` | Mémoire `terminal-operator-distinction` |
| THC destination DPW | `DTHC` | Terminal Handling Charge destination | MARITIME FCL | IMPORT | tous | EVP | `cargo.container_count` | À renseigner | À vérifier | à valider | — | À renseigner | À renseigner | À renseigner | par EVP | FCL import | À renseigner | DPW Dakar | DP World | À renseigner | à renseigner | P0 | devis impossible | `destination_terminal_rates` | Politique dédup THC/DTHC (mémoire) |
| Frais port export | `PORT_CHARGES` | Frais de port export | MARITIME | EXPORT | tous | tonne | `cargo.weight_kg` | À renseigner | Placeholder 0 XOF (Lot 1) | à corriger | — | non | À renseigner | À renseigner | par tonne | scope=export | À renseigner | PAD Dakar | PAD | À renseigner | à confirmer | P0 | risque de 0 | `pricing_rate_cards` | Voir `TARIF_EXPORT_SENEGAL.md` |
| Déchargement breakbulk | `DISCHARGE` | Déchargement navire breakbulk | MARITIME | IMPORT | tous | tonne | `cargo.weight_kg` | À renseigner | À vérifier | à valider | — | À renseigner | À renseigner | À renseigner | par tonne | breakbulk uniquement | À renseigner | DPW / Dakar Terminal | terminal | À renseigner | à renseigner | P1 | total incomplet | `port_tariffs` | |

## Zones floues identifiées
- Couverture exhaustive PAD T01–T14 : 98 lignes existent — vérifier qu'aucune catégorie ne manque.
- Magasinage : franchise 10j PAD bien appliquée ? Politique de paliers comme demurrage ?
- `PORT_DAKAR_HANDLING` vs `DTHC` : décision **dette acceptée** (mémoire `deferred-tariff-decisions`) — ne pas fusionner sans validation produit.
- Alias PAD : 60 alias existants — campagne de complétion alias en cours hors scope.
