
## Plan d'exécution — Phase C2/P0.1 + P0.2 + P0.3

### STATUS: ✅ DONE

### Fichiers modifiés

| Fichier | Action | Phase |
|---------|--------|-------|
| `supabase/functions/generate-reply-draft/index.ts` | Fix lecture `event_data.intent` + enrichissement prompt `[THREAD_INTENT]` | P0.1 |
| `src/pages/admin/Emails.tsx` | +`await loadData()` après succès analyze-thread-event | P0.2 |
| `src/pages/CaseView.tsx` | Bracket notation sur tous les accès `Record<string, unknown>` | P0.3 |

### P0.1 — Fix intentContext dans generate-reply-draft

- [x] Descendre dans `event_data.intent` (objet imbriqué par analyze-thread-event)
- [x] Fallback direct sur `event_data.intent_type` si structure plate
- [x] Enrichir prompt avec `risk_level`, `reply_recommended`, `missing_fields`
- [x] Guard `missing_fields` via `JSON.stringify().slice(0, 1000)` (stabilité prompt)
- [x] Format structuré `[THREAD_INTENT]...[/THREAD_INTENT]`

### P0.2 — Refresh après analyze-thread-event

- [x] `await loadData()` ajouté après toast succès, avant `setAnalyzingIntentId(null)`

### P0.3 — Bracket notation CaseView.tsx

- [x] `ed?.dedupe_key` → `ed?.["dedupe_key"]` (openActions memo)
- [x] `?.status` → `?.["status"]` (openActions filter)
- [x] `ed?.kind` → `ed?.["kind"]` (draftsByActionKey)
- [x] `ed?.source_action_dedupe_key` → `ed?.["source_action_dedupe_key"]`
- [x] `ed?.draft_reply` → `ed?.["draft_reply"]`
- [x] `ed?.dedupe_key` → `ed?.["dedupe_key"]` (UI openActions render)
- [x] `ed?.action_code` → `ed?.["action_code"]`
- [x] `ed?.title_fr` → `ed?.["title_fr"]`
- [x] `ed?.description_fr` → `ed?.["description_fr"]`
- [x] `ed.description_fr` → `ed["description_fr"]`

### Historique phases précédentes

- P0.5 — Actions clôturées (UX) ✅
- P0.6 — Bouton "Insérer dans réponse" — NON IMPLÉMENTÉ (doublon Copier)
- P0.7 — Auto-apply provide_missing_info ✅
