# COCKPIT-7B — Vue détaillée par partenaire / par purpose : DONE ✅

## Composant `PartnerRequestsDetailView.tsx`
- Query `external_quote_requests` → liste des demandes avec partner_name, purpose, lot, status, email_sent_at, created_at
- Query `external_quote_response_facts` → regroupement par request_id, comptage total + proposed
- Badge hiérarchique : closed > facts_proposed > response > sent > to_confirm > draft
- Tooltip sur purpose_detail
- Date relative (date-fns fr)
- Retourne null si aucune demande

## Intégration
- Rendu dans CaseView.tsx entre PartnerRequestsSummary (7A) et ExternalRequestsPanel

## Blast radius
| Fichier | Nature |
|---------|--------|
| `PartnerRequestsDetailView.tsx` | Nouveau composant |
| `CaseView.tsx` | +import + rendu |
| `.lovable/plan.md` | Plan actif |
| `docs/DEFERRED_BACKLOG.md` | Entrée ajoutée |
