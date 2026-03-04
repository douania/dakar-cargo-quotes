
## Plan d'exécution — Phase C2/P0.5 + P0.7

### STATUS: ✅ DONE

### Fichiers modifiés

| Fichier | Action | Phase |
|---------|--------|-------|
| `src/pages/CaseView.tsx` | +`doneActions` memo + Card "Actions clôturées" | P0.5 |
| `supabase/functions/analyze-thread-event/index.ts` | +auto-apply `provide_missing_info` avec timeout 2.5s | P0.7 |

### P0.5 — Actions clôturées (UX)

- [x] Memo `doneActions` (group by dedupe_key, keep latest, filter `status === "done"`, sort desc)
- [x] Card "Actions clôturées" avec Badge count, CheckCircle vert, title_fr (fallback action_code), date created_at
- [x] Affiché seulement si `doneActions.length > 0`, top 10

### P0.6 — Bouton "Insérer dans réponse"

- [x] **NON IMPLÉMENTÉ** — doublon du bouton "Copier" existant. Revisité lors ajout composeur email in-app.

### P0.7 — Auto-apply provide_missing_info

- [x] `.insert(...).select("id").single()` pour récupérer inserted.id
- [x] Auto-apply via fetch interne si `intent_type ∈ AUTO_APPLY_INTENTS`
- [x] AbortController timeout 2.5s + clearTimeout cleanup (P0-A)
- [x] Safe error logging `e instanceof Error` (P0-B)
- [x] Check `resp.ok` non-bloquant (P0-C)
- [x] `intent_event_id` passé dans le body (évite race condition)
- [x] Retour enrichi avec `intent_event_id`
