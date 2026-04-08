# COCKPIT-9 Phase 2 — Offre retenue opérateur : DONE ✅

## Migration DB
- `external_quote_requests` : +`is_selected` (boolean NOT NULL DEFAULT false) + `selected_at` (timestamptz)
- Index unique partiel `idx_eqr_one_selected_per_case` : une seule offre retenue par dossier

## Edge function `select-partner-request`
- Auth requise (requireUser)
- Préconditions strictes : status exploitable + 0 fait proposé en attente
- Atomique : deselect all → select target
- Gestion concurrence : erreur 409 sur conflit d'unicité
- Événement timeline `PARTNER_REQUEST_SELECTED`

## Composants modifiés
| Fichier | Nature |
|---------|--------|
| `PartnerRequestsDetailView.tsx` | Badge "Retenue" + bouton "Retenir" (exploitable only) |
| `PartnerCollectionReadinessCard.tsx` | Ligne offre retenue dynamique (partner_name ou "Sélection opérateur requise") |
| `NextActionBanner.tsx` | Nouveau niveau 7 : "Retenir une offre partenaire" |
| `PricingReadinessCard.tsx` | Sous-ligne "Sélection partenaire requise" si ready mais pas de sélection |

## Blast radius
- Migration SQL : +2 colonnes + 1 partial unique index
- Nouvelle edge function : `select-partner-request/index.ts`
- 4 composants UI enrichis
- Aucune zone FROZEN touchée
- `run-pricing` intact
