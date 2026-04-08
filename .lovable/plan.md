
# Bilan de clôture S1 — Clarification sémantique statut partenaire

## Statut : DONE — livré et validé le 2026-04-08

## Problème résolu

`status = "sent"` dans `external_quote_requests` signifiait "brouillon email créé" alors qu'aucun envoi SMTP réel n'avait lieu. Le timer `stale_followup` (24h) se déclenchait depuis la date de marquage, pas d'envoi réel.

## Solution : Option B — preuve d'envoi séparée

- Migration DB : `email_sent_at TIMESTAMPTZ NULL` + `email_draft_id UUID NULL REFERENCES email_drafts(id)` sur `external_quote_requests`
- `send-external-quote-request/index.ts` : stocke `email_draft_id`, laisse `email_sent_at = NULL`
- `getNextAction.ts` : timer stale basé sur `email_sent_at ?? sent_at`
- `ExternalRequestsPanel.tsx` : badge "Envoyée (brouillon)" vs "Envoyée (confirmée)"
- `useExternalRequestFlow.ts` : toast corrigé "Brouillon email créé pour le partenaire"
- `useExternalRequests.ts` : interface `ExternalRequest` enrichie avec `email_sent_at` + `email_draft_id`
- Tests : 13/13 passent, incluant nouveau test `emailSentAt`

## Fichiers modifiés

| Fichier | Nature |
|---------|--------|
| Migration DB | +2 colonnes, +1 index |
| `send-external-quote-request/index.ts` | Stocke email_draft_id |
| `getNextAction.ts` | +param emailSentAt, timer adapté |
| `getNextAction.test.ts` | +1 test emailSentAt, tous mis à jour |
| `useExternalRequests.ts` | Interface enrichie |
| `useExternalRequestFlow.ts` | Toast corrigé |
| `ExternalRequestsPanel.tsx` | Badge brouillon/confirmé |
| `docs/MASTER_CONTEXT.md` | Section S1 ajoutée |
| `docs/DEFERRED_BACKLOG.md` | S1 DONE, COM-1A prérequis mis à jour |

## Invariants respectés

- Aucun changement d'enum DB
- Aucune zone FROZEN touchée
- Pipeline EQ1 intact
- `canSend` inchangé
- Rétro-compatible : `email_sent_at = NULL` = pas encore envoyé réellement

## Prochaine action

COM-1A : remplir `email_sent_at` après transmission SMTP réussie.
