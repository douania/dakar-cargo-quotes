

# Bilan de clôture COM-2A — Auto-matching réponses partenaires

## Objectif livré

Permettre à l'opérateur de scanner les emails d'un dossier pour identifier automatiquement les réponses partenaires candidates, puis les confirmer ou rejeter manuellement avant injection dans le pipeline EQ1.

## Architecture retenue (Option B)

- **Table dédiée** : `partner_response_suggestions` (séparée de `external_quote_responses`)
- **Edge function** : `auto-match-partner-responses` (actions: scan, confirm, reject)
- **Hook** : `usePartnerSuggestions`
- **UI** : intégrée dans `ExternalRequestsPanel` (pending, accepted, rejected)
- **Doctrine** : assistant structurant — scan déclenché manuellement, confirm/reject par opérateur

## Correctif final de confirm (2026-04-07)

**Défaut corrigé** : le confirm passait la suggestion à `accepted` avant d'appeler `analyze-partner-response`. Si l'analyse échouait, la suggestion restait `accepted` sans vraie réponse EQ1.

**Correction** : appel `analyze-partner-response` d'abord ; si succès → passage à `accepted` + timeline. Si échec → suggestion reste `pending`, retour 502.

Validé CTO sur le zip (33).

## Ce qui n'a pas été touché

- Aucune zone FROZEN modifiée
- Aucune migration DB pour le correctif (table déjà en place)
- Pipeline EQ1 (`external_quote_responses` / `external_quote_response_facts`) intact
- `suggestPartnerResponse.ts` conservé côté front (dette acceptée, ~50 lignes)

## Statut : **CLOSED**

## Prochaines phases

| Lot | Description | Statut |
|-----|-------------|--------|
| COM-1A | Envoi réel emails partenaires (SMTP) — décision produit + secrets + traçabilité | deferred |
| COM-3 | SLA / relances partenaires | deferred (dépend COM-1A) |
| COM-4 | Comparaison multi-offres + réponse client consolidée | deferred |
