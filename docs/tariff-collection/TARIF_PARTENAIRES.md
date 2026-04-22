# TARIF — PARTENAIRES & RFQ EXTERNES

**Périmètre** : services pour lesquels SODATRA n'est pas le fournisseur final → demande de tarif (RFQ) à un partenaire externe.
**Mécanique application** : `external_quote_request` + cockpit `ReadyActionsPanel` + email centralisé `operations@sodatra.sn`.
**Mémoires liées** : `outbound-email-governance-centralized-sender`, `partner-offer-selection-logic`, `standardized-partner-email-templates`, `partner-request-scope-extraction`, `pricing-communication-guard`.
**Priorité globale** : **P1**

> ⚠️ Aucun tarif inventé. Cette grille **ne stocke pas de tarifs partenaires** : elle liste les services qui **déclenchent une RFQ** et le suivi de réponse.
> Pendant qu'une RFQ est ouverte, le PRICING-GUARD suspend l'auto-pricing (mémoire `pricing-communication-guard`).

| Famille tarifaire | Service key application | Libellé métier SODATRA | Mode transport | Sens | Incoterm concerné | Unité de facturation | Quantité utilisée | Tarif HT XOF | Valeur existante en base | Validation SODATRA | Devise si différente | TVA applicable | Minimum facturable | Maximum facturable | Base de calcul | Conditions d'application | Exemple de calcul | Source du tarif | Fournisseur / compagnie / terminal | Date de validité | Statut | Priorité | Impact si non renseigné | Table cible future | Commentaire équipe SODATRA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Pré-acheminement origine | `PRE_CARRIAGE` | Pré-acheminement | tous | IMPORT | EXW / FCA | voyage / forfait | 1 | À confirmer (RFQ) | Non en base (par dossier) | à valider | EUR / USD | À renseigner | — | — | RFQ partenaire | EXW / FCA | À renseigner | Transporteur origine | partenaire | À renseigner | à confirmer | P1 | ligne à confirmer | `pricing_rate_cards` (par dossier) | Mémoire `partner-request-scope-extraction` |
| Enlèvement origine | `PICKUP_ORIGIN` | Enlèvement origine | tous | IMPORT | EXW | forfait | 1 | À confirmer (RFQ) | Non en base | à valider | EUR / USD | À renseigner | — | — | RFQ partenaire | EXW | À renseigner | Agent origine | partenaire | À renseigner | à confirmer | P1 | ligne à confirmer | `pricing_rate_cards` | |
| Fret maritime carrier | `SEA_FREIGHT` | Fret maritime | MARITIME | tous | EXW / FOB / CIF / CFR | EVP | `cargo.container_count` | À confirmer (RFQ) | `carrier_billing_templates` partiel | à valider | USD | À renseigner | — | — | RFQ carrier | FCL | À renseigner | Compagnie maritime | MSC / CMA / Maersk / etc. | À renseigner | à confirmer | P0 | devis impossible | `carrier_billing_templates` | Voir `TARIF_FRAIS_COMPAGNIES_MARITIMES.md` |
| Fret aérien | `AIR_FREIGHT` | Fret aérien | AIR | IMPORT | EXW / FCA / FAS | kg | `cargo.chargeable_weight_kg` | À confirmer (RFQ) | Non systématique | à valider | USD | À renseigner | — | — | RFQ compagnie aérienne | EXW / FCA / FAS | À renseigner | Compagnie aérienne | carrier | À renseigner | à confirmer | P0 | devis impossible | `pricing_rate_cards` | |
| Empotage off-port | `STUFFING_FACTORY` | Empotage usine | MARITIME FCL | EXPORT | FCA / FOB | EVP | `cargo.container_count` | À confirmer (RFQ) | Placeholder 0 XOF | à corriger | — | À renseigner | — | — | RFQ prestataire | empotage off-port | À renseigner | Prestataire empotage | partenaire | À renseigner | à confirmer | P1 | ligne à confirmer | `pricing_rate_cards` | |
| Survey project cargo | `SURVEY` | Survey port + site | tous | IMPORT | tous | forfait | 1 | À confirmer (RFQ) | Non systématique | à valider | EUR / USD probable | À renseigner | — | — | RFQ surveyor | project cargo / breakbulk | À renseigner | Cabinet survey | partenaire | À renseigner | à confirmer | P2 | info interne | `pricing_rate_cards` | Optionnel selon nature cargo |

## Workflow RFQ partenaire
1. Détection ligne TO_CONFIRM → cockpit propose action partenaire.
2. Génération template email standardisé (mémoire `standardized-partner-email-templates`).
3. Envoi via `operations@sodatra.sn` (mémoire `outbound-email-governance-centralized-sender`).
4. Suivi `external_quote_request` + sélection unique offre partenaire (mémoire `partner-offer-selection-logic`).
5. Réponse partenaire → fact `manual_input` priorité absolue (mémoire `manual-data-protection-policy-v2`).

## Zones floues identifiées
- Politique de comparaison multi-partenaires : actuellement **sélection unique** par dossier (mémoire). À reconfirmer.
- Format JSON attendu pour parser une réponse partenaire automatiquement (hors scope grille).
- Grille tarifaire historisée par partenaire : différé (table dédiée à créer si validée).
