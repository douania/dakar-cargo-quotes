
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

---

## P0-G — 7 bugs invisibles, patchs chirurgicaux ✅

### Lot 1 — P0 critiques

| Bug | Fichier | Patch |
|-----|---------|-------|
| 1 | `build-case-puzzle/index.ts:1572` | `ACK_READY_FOR_PRICING` ajouté à `FROZEN_STATUSES` |
| 2 | `sync-emails/index.ts:1521` | `ACK_READY_FOR_PRICING` ajouté à `REOPENABLE_STATUSES` |
| 7 | `_shared/client-gap-policy.ts` | Clés réalignées : `cargo.weight_kg`, `cargo.volume_cbm`, `cargo.hs_code`, `cargo.pieces_count`, `routing.destination_country`. Supprimé : `cargo.currency`, `cargo.weight`, `cargo.volume`, `goods.hs_code`, `goods.quantity` |
| 3 | `set-case-fact/index.ts:14-36` | `routing.destination_country` et `routing.origin_country` ajoutés à `ALLOWED_FACT_KEYS` |
| 5 | `generate-response/index.ts:2247-2248` | Fallback P0-F : `origin_country ?? origin`, `destination_country ?? destination` |

### Lot 2 — P1 finition

| Bug | Fichier | Patch |
|-----|---------|-------|
| 4 | `src/pages/Intake.tsx:338-340` | Garde anti-pays `KNOWN_COUNTRIES` avant injection `routing.destination_city` |
| 6 | `generate-case-outputs/index.ts:496` | Fallback `routing.destination_country` ajouté dans template |

### Vérification transversale consommateurs

- `sync-gap-client-actions` : consomme `quote_gaps.gap_key` depuis la DB → clés canoniques produites par `build-case-puzzle` → cohérent ✅
- `generate-reply-draft` : consomme via `buildClientQuestionsFromGaps` depuis policy → réaligné ✅
- Aucun module consommateur ne hardcode les anciennes clés legacy
