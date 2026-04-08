
# Bilan COCKPIT-2 — Garde-fous communication SendQuotationPanel

## Statut : DONE — livré et validé CTO le 2026-04-08

## Périmètre livré

Avertissements (non bloquants) dans SendQuotationPanel avant marquage d'envoi :
- Demandes partenaires non clôturées (tout sauf `closed`)
- Faits partenaires `proposed` (non validés)
- Clarifications client `drafted`, `sent` ou `answered` (non clôturées)

Rappel dans le dialog de confirmation finale. `canSend` inchangé (opérateur souverain).

## Filtres exacts

| Requête | Table | Filtre |
|---------|-------|--------|
| Demandes partenaires | `external_quote_requests` | `neq('status', 'closed')` |
| Faits partenaires | `external_quote_response_facts` | `eq('validation_status', 'proposed')` |
| Clarifications client | `client_gap_requests` | `in('status', ['drafted', 'sent', 'answered'])` |

## Fichiers modifiés

| Fichier | Nature |
|---------|--------|
| `src/hooks/useSendQuotation.ts` | +3 requêtes parallèles, derived flags |
| `src/components/puzzle/SendQuotationPanel.tsx` | Alertes ambrées + rappel dialog |
| `docs/DEFERRED_BACKLOG.md` | Entrée COCKPIT-2 → DONE |
| `docs/MASTER_CONTEXT.md` | Section COCKPIT-2 ajoutée |

## Prochaine action : COCKPIT-3 — Résumé communication dossier

Widget synthétique case-level dans CaseView, réutilisant les mêmes filtres COCKPIT-2.
Placement : juste avant ExternalRequestsPanel, même condition d'affichage.
