

## Plan d'exécution — Phase C2/P0.1 — Thread Intent v1

### 4 fichiers modifiés/créés, 1 migration SQL

---

### Étape 1 — Migration SQL (CHECK constraint → 29 valeurs)

Nouvelle migration :

```sql
ALTER TABLE public.case_timeline_events
  DROP CONSTRAINT IF EXISTS case_timeline_events_event_type_check;

ALTER TABLE public.case_timeline_events
  ADD CONSTRAINT case_timeline_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'case_created', 'status_changed',
    'fact_added', 'fact_updated', 'fact_superseded',
    'gap_identified', 'gap_resolved', 'gap_waived',
    'pricing_started', 'pricing_completed', 'pricing_failed',
    'output_generated',
    'human_approved', 'human_rejected',
    'sent', 'archived',
    'email_received', 'email_sent',
    'attachment_analyzed', 'clarification_sent',
    'manual_action', 'status_rollback', 'fact_insert_failed',
    'document_uploaded', 'fact_injected_manual',
    'assumption_applied', 'detection_corrected',
    'fact_injected_from_attachment',
    'thread_intent_v1'
  ]));
```

---

### Étape 2 — Edge Function `analyze-thread-event`

**Fichier** : `supabase/functions/analyze-thread-event/index.ts`

Utilise les helpers existants : `handleCors`, `jsonResponse`, `errorResponse` (de `_shared/cors.ts`), `requireUser` (de `_shared/auth.ts`), `callAI`, `parseAIResponse` (de `_shared/ai-client.ts`), `extractAndParseJSON` (de `_shared/json-parser.ts`).

**Flow** :
1. `handleCors(req)` — preflight
2. `requireUser(req)` — auth, **avant tout**
3. Parse body `{ email_id }`
4. Créer `userClient` avec le JWT de l'utilisateur (Authorization header forwarded)
5. `userClient` : SELECT email → `thread_ref`, `body_text`, `subject`
6. `userClient` : SELECT `email_threads` → `id` (thread_id)
7. `userClient` : SELECT `quote_cases` WHERE `thread_id` → `case_id`. Si absent → `errorResponse("No quote_case linked", 404)`
8. Idempotence : `serviceClient` SELECT `case_timeline_events` WHERE `case_id` + `event_type='thread_intent_v1'` + `related_email_id=email_id` `.maybeSingle()`. Si existe → `jsonResponse({ ok:true, idempotent:true, intent: existing.event_data.intent })`
9. `callAI` (gemini-2.5-flash) avec prompt strict → 8 intent types
10. `extractAndParseJSON` (expectRoot:"object", maxLogChars:500). Si échec → `jsonResponse({ ok:false, error:"AI_JSON_PARSE_FAILED" }, 200)`
11. `serviceClient` INSERT `case_timeline_events` : `event_type='thread_intent_v1'`, `related_email_id=email_id`, `actor_type='ai'`, `event_data={ email_id, thread_id, dedupe_key, intent, confidence, model_meta }`. Si erreur → `jsonResponse({ ok:false, error:"TIMELINE_INSERT_FAILED" }, 200)` + `console.warn`
12. `jsonResponse({ ok:true, case_id, thread_id, email_id, intent, idempotent:false })`

**Correction CTO** : toutes les réponses (erreur ou succès) passent par `jsonResponse`/`errorResponse` → CORS + Content-Type JSON garanti. `confidence` stocké dans `event_data` pour affichage UI.

---

### Étape 3 — Config TOML

Ajout dans `supabase/config.toml` :

```toml
[functions.analyze-thread-event]
verify_jwt = false
```

---

### Étape 4 — UI : bouton "Analyser intent" dans `src/pages/admin/Emails.tsx`

**2 emplacements** (correction CTO : liste + dialog) :

1. **Vue liste** (~ligne 1342, entre "Apprendre" et "Supprimer") : bouton `Search` + "Intent"
2. **Dialog détail** (~ligne 1468, entre "Apprendre" et "Supprimer") : bouton `Search` + "Analyser intent"

Logique :
- State `analyzingIntentId: string | null` pour disable pendant l'appel
- Fonction `analyzeIntent(emailId)` : `supabase.functions.invoke("analyze-thread-event", { body: { email_id } })`
- Toast succès : `Intent: ${intent_type} (confiance: ${confidence})`
- Toast erreur : message d'erreur

L'icône `Search` est déjà importée (ligne 15).

---

### Récapitulatif

| Fichier | Action |
|---------|--------|
| Migration SQL | CHECK 29 valeurs |
| `supabase/config.toml` | Ajout `[functions.analyze-thread-event]` |
| `supabase/functions/analyze-thread-event/index.ts` | Création |
| `src/pages/admin/Emails.tsx` | Ajout bouton intent (2 emplacements) |

