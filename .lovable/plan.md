
# Bilan de clôture COCKPIT-2 + COCKPIT-3

## Statut : DONE — les deux lots livrés et validés CTO le 2026-04-08

## COCKPIT-2 — Garde-fous communication SendQuotationPanel

Avertissements (non bloquants) dans SendQuotationPanel avant marquage d'envoi :
- Demandes partenaires non clôturées (tout sauf `closed`)
- Faits partenaires `proposed` (non validés)
- Clarifications client `drafted`, `sent` ou `answered` (non clôturées)

Rappel dans le dialog de confirmation finale. `canSend` inchangé (opérateur souverain).

Fichiers modifiés : `useSendQuotation.ts`, `SendQuotationPanel.tsx`, 2 docs.

## COCKPIT-3 — Résumé communication dossier

Composant : `src/components/case/CommunicationSummaryCard.tsx`
Placement : CaseView, juste avant ExternalRequestsPanel, même gating (`caseId`)
Requêtes : 3 queries parallèles réutilisant les filtres COCKPIT-2
UI : badge vert/amber + mini-liste partenaires (max 3)
staleTime : 30s

Fichiers modifiés : `CommunicationSummaryCard.tsx` (nouveau), `CaseView.tsx` (+import+placement), 2 docs.

## Invariants respectés

- Aucune migration DB
- Aucune zone FROZEN touchée
- Aucune mutation métier
- Pipeline EQ1 intact
- `canSend` inchangé

## Prochaine action

Cadrage COM-1A (envoi réel partenaires) ou priorisation CTO.
