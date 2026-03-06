
## Plan d'exécution — Phase P0 (Gap-based Client Info Requests)

### STATUS: ✅ DONE

### Fichiers modifiés

| Fichier | Action | Phase |
|---------|--------|-------|
| `supabase/functions/_shared/client-gap-policy.ts` | Créé — whitelist déterministe gaps client | P0-A |
| `supabase/functions/sync-gap-client-actions/index.ts` | Créé — edge function sync actions idempotentes | P0-B |
| `supabase/functions/generate-reply-draft/index.ts` | Modifié — branche déterministe REQUEST_CLIENT_INFO_FOR_GAPS | P0-C |
| `src/pages/CaseView.tsx` | Modifié — bouton Générer brouillon étendu | P0-D |
| `supabase/config.toml` | Ajout `[functions.sync-gap-client-actions] verify_jwt = false` | P0-B |

### Corrections appliquées vs prompt original

- `dedupe_key` dans `event_data` JSONB (pas colonne top-level)
- `event_type: "manual_action"` (pas `manual_action_created`)
- Import `jsr:@supabase/supabase-js@2` (pas `esm.sh`)
- `serve()` + CORS + `requireUser` (pattern projet)
- Tri + déduplication des gap_keys pour idempotence stable
- Double guard idempotence : dedupe_key exact + action ouverte équivalente

### Historique phases précédentes

- P0.1 — Fix intentContext dans generate-reply-draft ✅
- P0.2 — Refresh après analyze-thread-event ✅  
- P0.3 — Bracket notation CaseView.tsx ✅
- P0.5 — Actions clôturées (UX) ✅
- P0.7 — Auto-apply provide_missing_info ✅
- C3/P0 — Reply Analysis v1 ✅
- P0-E — Branchement sync-gap-client-actions dans CaseView ✅
