
## Plan d'exécution — Phase C3/P0 (Reply Analysis v1)

### STATUS: ✅ DONE

### Fichiers modifiés

| Fichier | Action | Phase |
|---------|--------|-------|
| `supabase/functions/analyze-reply-event/index.ts` | Créé — edge function analyse réponse client | C3/P0 |
| `supabase/config.toml` | Ajout `[functions.analyze-reply-event] verify_jwt = false` | C3/P0 |
| `src/pages/admin/Emails.tsx` | +state `analyzingReplyId`, +handler `analyzeReply`, +2 boutons | C3/P0 |
| `src/pages/CaseView.tsx` | +affichage Card "Analyse dernière réponse client" | C3/P0 |

### C3/P0 — Reply Analysis v1

- [x] Edge function `analyze-reply-event` : auth, email→thread→case, idempotence (JS filter kind=reply_analysis_v1, limit 50), AI call, parse JSON, normalize (clamp confidence, skip empty facts), insert `output_generated` timeline event, generate 1-3 `manual_action` idempotentes
- [x] Idempotence actions : filtre par `case_id` + Set de dedupe_keys
- [x] dedupe_key = `reply_analysis_v1:${case_id}:${email_id}` (basé sur email, pas sur event_id)
- [x] Actions : APPLY_FACT_PROPOSALS (toujours), PREPARE_CLIENT_REPLY_DRAFT (si reply_recommended), LAUNCH_PRICING (si ready_to_price)
- [x] UI Admin : bouton "Réponse" dans liste emails + dialog détail, avec toast + refresh
- [x] UI CaseView : Card compacte après "Actions clôturées" — chips ready_to_price/reply_recommended, proposed_facts (max 10), open_questions
- [x] Bracket notation systématique sur tous les accès Record<string, unknown>
- [x] Comment SECURITY dans edge function

### Historique phases précédentes

- P0.1 — Fix intentContext dans generate-reply-draft ✅
- P0.2 — Refresh après analyze-thread-event ✅  
- P0.3 — Bracket notation CaseView.tsx ✅
- P0.5 — Actions clôturées (UX) ✅
- P0.7 — Auto-apply provide_missing_info ✅
