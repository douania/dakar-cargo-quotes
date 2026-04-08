# COCKPIT-7A — Vue synthétique "Offres attendues vs reçues" : DONE ✅

## Composant `PartnerRequestsSummary.tsx`
- Query `external_quote_requests` → compteurs par statut (draft, sent sans email, sent avec email, response_*, closed)
- Query `external_quote_response_facts` → faits à valider (validation_status = proposed)
- Pas de query `external_quote_responses` (non nécessaire pour les compteurs)
- Barre de progression clôturées/total
- Badges colorés conditionnels (affichés si > 0)
- Texte neutre si aucune demande

## Intégration
- Rendu dans CaseView.tsx au-dessus de ExternalRequestsPanel

## Blast radius
| Fichier | Nature |
|---------|--------|
| `PartnerRequestsSummary.tsx` | Nouveau composant |
| `CaseView.tsx` | +import + rendu |
| `.lovable/plan.md` | Plan actif |
| `docs/DEFERRED_BACKLOG.md` | Entrée ajoutée |
