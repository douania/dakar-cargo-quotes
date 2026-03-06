
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

---

## P0-F — Correction bug ville/pays extraction et mapping ✅

### Diagnostic

Le pipeline confondait ville et pays : `analyze-attachments` renvoyait un champ générique `destination`, puis `build-case-puzzle` le mappait directement vers `routing.destination_city`, écrasant Bamako par Mali.

### Patchs appliqués

| Patch | Fichier | Description |
|-------|---------|-------------|
| A | `analyze-attachments/index.ts` | Prompts enrichis : `destination_city`, `destination_country`, `origine_city`, `origine_country` + legacy compat + instruction fallback pays |
| B | `build-case-puzzle/index.ts` | 3 mappings ajoutés : `destination_city`, `destination_country`, `origine_country`. `origine_city` non mappé (pas de fact `routing.origin_city`) |
| C | `build-case-puzzle/index.ts` | Garde anti-pays : si `routing.destination_city` = nom de pays connu → redirige vers `routing.destination_country` via `effectiveFactKey` local. Pas de mutation de `mapping`, pas de faux `injectedKeys.add` |
| Policy | `client-gap-policy.ts` | `routing.destination_city` ajouté à la whitelist + question FR |

### Micro-corrections CTO intégrées

- Variables locales `effectiveFactKey`/`effectiveCategory` au lieu de mutation de `mapping`
- Pas de `injectedKeys.add('routing.destination_city')` dans le cas skip
- Timeline log et `injectedKeys.add` utilisent `effectiveFactKey` partout
