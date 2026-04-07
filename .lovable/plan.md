

# Plan — COM-2A Auto-matching réponses partenaires

## Statut : LIVRÉ (2026-04-07)

### Périmètre livré

#### Migration DB
- Table `partner_response_suggestions` créée
- FK : `case_id` → `quote_cases`, `request_id` → `external_quote_requests`, `suggested_email_id` → `emails`
- UNIQUE `(request_id, suggested_email_id)` pour idempotence
- Index `(case_id, suggestion_status)` pour performance UI
- RLS shared workspace authenticated (cohérent avec EQ1)
- Statuts : `pending`, `accepted`, `rejected` (transitions terminales)

#### Edge function `auto-match-partner-responses`
- Action `scan` : charge demandes ouvertes (sent/response_received), emails du thread, exclut emails déjà utilisés dans `external_quote_responses`, exclut paires déjà suggérées, score >= 40 → insert suggestion pending
- Action `confirm` : vérifie pending, passe accepted, timeline manual_action PARTNER_SUGGESTION_CONFIRMED, appelle analyze-partner-response via HTTP interne avec bearer token utilisateur
- Action `reject` : vérifie pending, passe rejected, timeline manual_action PARTNER_SUGGESTION_REJECTED
- Scoring : duplication contrôlée de suggestPartnerResponse.ts (dette acceptée, ~50 lignes)
- Guards : requireUser, case access via RLS, idempotence unique constraint

#### Frontend
- `src/hooks/usePartnerSuggestions.ts` : queries + mutations scan/confirm/reject
- `src/components/puzzle/ExternalRequestsPanel.tsx` :
  - Bouton global "Scanner" (icône Radar)
  - Badge compteur suggestions pending dans le header
  - Bandeaux suggestion par demande avec badge confiance, email suggéré, reasons, boutons Confirmer/Rejeter
  - Bouton Analyser manuel conservé comme fallback

#### Config
- `supabase/config.toml` : bloc `[functions.auto-match-partner-responses]` ajouté

#### Documentation
- `docs/MASTER_CONTEXT.md` : section COM-2A ajoutée dans module EQ1
- `docs/DEFERRED_BACKLOG.md` : COM-2A marqué DONE, COM-1A/COM-3/COM-4 ajoutés comme deferred
- `.lovable/plan.md` : ce fichier

### Architecture retenue : Option B — Table dédiée
- Séparation stricte entre suggestions (partner_response_suggestions) et pipeline EQ1 (external_quote_responses)
- Pattern identique à terminal_designation_suggestions
- Aucune pollution du pipeline aval EQ1

### Ce qui n'a PAS été touché
- Pipeline EQ1 existant (external_quote_requests, responses, facts)
- Zones FROZEN (quotation-engine, build-case-puzzle, set-case-fact)
- analyze-thread-event (pas de hook auto)
- Suggestion locale existante dans ExternalRequestsPanel (suggestPartnerResponse) — conservée en parallèle
- Bouton Analyser manuel — conservé comme fallback

### Corrections CTO appliquées
- FK explicites sur request_id et suggested_email_id (Correction A)
- Policies RLS explicites SELECT/INSERT/UPDATE/DELETE (Correction B)
- Pas de nouvel event_type timeline — réutilisation de manual_action avec action_code (Correction C)
- Exclusion scan par paire (request_id, suggested_email_id), pas par email global (Correction D)
- Note : types.ts auto-généré par le système, pas modifiable manuellement (Correction E — géré via cast)

### Prochaines phases cockpit communication (deferred)
- COM-1A : envoi réel emails partenaires (SMTP) — prérequis structurel
- COM-3 : SLA / relances partenaires — nécessite COM-1A
- COM-4 : comparaison multi-offres + réponse client consolidée

### Dettes acceptées
- Duplication scoring front/back (~50 lignes) — contrôlée, même algorithme
- Cast `as any` / `as unknown` pour partner_response_suggestions dans le hook (table non encore dans types.ts auto-généré)
