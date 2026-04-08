

# Bilan de clôture S1 — Clarification sémantique statut partenaire

## Statut : FERMÉ (2026-04-08)

## Périmètre livré

- Migration : colonnes `email_sent_at` + `email_draft_id` ajoutées sur `external_quote_requests`, index sur `email_draft_id`
- `send-external-quote-request/index.ts` : stocke `email_draft_id`, laisse `email_sent_at` à NULL (contrat COM-1A)
- `getNextAction.ts` : timer stale basé sur `emailSentAt ?? lastUpdateAt`
- `getNextAction.test.ts` : tests mis à jour + test spécifique `emailSentAt`
- `useExternalRequests.ts` : interface mise à jour avec les 2 nouveaux champs
- `useExternalRequestFlow.ts` : toast corrigé ("Brouillon email créé pour le partenaire")
- `ExternalRequestsPanel.tsx` : `sent_confirmed` dans `STATUS_COLORS` (emerald), badge utilise `displayStatus`

## Blast radius

- 0 zone FROZEN touchée
- 0 mutation métier
- 0 changement d'enum DB
- Pipeline EQ1 intact

## Prochaine action

Audit readiness COM-1A → implémentation COM-1A (sendEmail + adresse SODATRA + remplissage email_sent_at).
Provider d'envoi : option prioritaire Lovable Emails, sous réserve de validation configuration domaine.
