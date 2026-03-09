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

---

## P1 — Bouton "Préparer demande client" dans gap rows ✅

### Objectif

Permettre à l'opérateur de lancer directement depuis une gap row la génération d'un brouillon d'email client pour tous les gaps client-résolvables ouverts du dossier.

### Patchs appliqués

| Patch | Fichier | Description |
|-------|---------|-------------|
| 1 | `src/pages/CaseView.tsx` L76-84 | Whitelist locale `CLIENT_RESOLVABLE_GAP_KEYS` (miroir de `_shared/client-gap-policy.ts`) |
| 2 | `src/pages/CaseView.tsx` L519 | État `askingClientForGaps` |
| 3 | `src/pages/CaseView.tsx` L894-955 | Fonction `askClientForGaps()` : sync → lookup DB direct → generate-reply-draft → toast + refresh |
| 4 | `src/pages/CaseView.tsx` renderGapRow | Bouton "Préparer demande client" avec tooltip explicite, visible si gap client-résolvable et dossier non verrouillé |

### Corrections CTO intégrées

- Wording honnête : "Préparer demande client" + tooltip "Génère un brouillon pour tous les gaps client-résolvables ouverts du dossier"
- Lookup DB direct : requête `case_timeline_events` filtrée sur `event_type=manual_action`, `action_code=REQUEST_CLIENT_INFO_FOR_GAPS`, `status=open`
- Garde-fou : message d'erreur explicite si aucune action trouvée ou dedupe_key manquant
- Toast adapté à l'idempotence : "Brouillon déjà disponible" vs "Brouillon de demande client généré"
- Whitelist marquée comme miroir backend avec commentaire

---

## Phase 1 — Service Scope + Case Reasoning (MVP Safe) ✅

### Objectif

Introduire une couche légère et additive de compréhension métier avant les gaps/pricing :
- `service_scope_v1` : détection du scope de service (fret, douane, transit, document)
- `case_reasoning_v1` : mini raisonnement métier structuré

### Patchs appliqués

| Fichier | Action | Description |
|---------|--------|-------------|
| Migration SQL | Créé | Ajout `service_scope_v1` et `case_reasoning_v1` à la CHECK constraint (29 → 31 valeurs) |
| `supabase/functions/analyze-service-scope/index.ts` | Créé | Nouvelle edge function additive |
| `src/components/case/CaseUnderstandingPanel.tsx` | Créé | Panneau read-only de compréhension du dossier |
| `src/pages/CaseView.tsx` | Modifié | Import + insertion du panel avant les gaps (~3 lignes) |

### Architecture edge function

1. Auth via `requireUser(req)`
2. Input : `{ case_id }`
3. Résout thread → charge les 5 derniers emails
4. **Idempotence duale** : vérifie les 2 events (`service_scope_v1` + `case_reasoning_v1`) pour le `related_email_id` du dernier email
   - Si les 2 existent → retour idempotent
   - Sinon → 1 seul appel IA → insert uniquement les events manquants
5. Contexte LLM structuré : `[LATEST_EMAIL]` prioritaire + `[PREVIOUS_CONTEXT]` tronqué (500 chars)
6. Pas de lecture des `quote_facts` — raisonnement indépendant basé sur les emails
7. 0 side effect sur facts/gaps/pricing

### UI Panel

- Affiche : Type, Fret principal, Douane, Transit intérieur, Résumé
- Timestamp : "Analyse générée il y a X"
- Matching `related_email_id` entre scope et reasoning pour cohérence
- Si aucun event → ne rend rien

### Liste complète des event_type (31 valeurs)

```
case_created, status_changed, fact_added, fact_updated, fact_superseded,
gap_identified, gap_resolved, gap_waived, pricing_started, pricing_completed,
pricing_failed, output_generated, human_approved, human_rejected, sent,
archived, email_received, email_sent, attachment_analyzed, clarification_sent,
manual_action, status_rollback, fact_insert_failed, document_uploaded,
fact_injected_manual, assumption_applied, detection_corrected,
fact_injected_from_attachment, thread_intent_v1,
service_scope_v1, case_reasoning_v1
```

### Hors périmètre (Phase 1)

- Déclenchement automatique de `analyze-service-scope`
- Modification des gaps conditionnels basée sur le scope
- Impact sur pricing / facts / build-case-puzzle
- Bouton UI pour déclencher l'analyse (sera Phase 2)
