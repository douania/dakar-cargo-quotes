

# Phase 18 -- Email Stub (plan corrige avec P1, P2, P3 CTO)

## Etape 18B -- Migration chirurgicale

```sql
ALTER TABLE public.email_drafts
  ADD COLUMN quotation_version_id uuid NULL
  REFERENCES public.quotation_versions(id) ON DELETE SET NULL;
```

## Etape 18C -- Edge Function `send-quotation`

### Fichier unique

`supabase/functions/send-quotation/index.ts`

### Config

```toml
[functions.send-quotation]
verify_jwt = true
```

### Logique corrigee (ordre strict)

1. CORS preflight
2. `t0`, `correlationId`, `serviceClient` (pour logging uniquement)
3. Auth : `userClient` + `getUser()` -- si echec `AUTH_INVALID_JWT`
4. Parse body : valider `case_id`, `version_id`, `draft_id` (tous UUID requis, sinon `VALIDATION_FAILED`)
5. Charger `quote_cases` via `userClient` (RLS)
6. **Ownership explicite (P2)** : verifier `caseData.created_by === user.id || caseData.assigned_to === user.id`, sinon `FORBIDDEN_OWNER`
7. **Guard FSM (P3)** : `["QUOTED_VERSIONED", "SENT"].includes(caseData.status)`, sinon `CONFLICT_INVALID_STATE`
8. Charger `quotation_versions` via `serviceClient` : verifier existence, `case_id` match, `is_selected = true` -- sinon `VALIDATION_FAILED`
9. Charger `email_drafts` via `userClient` (RLS ownership) -- sinon `VALIDATION_FAILED`
10. **Idempotence** : si `draft.sent_at !== null`, log `op: 'idempotent_hit'` et `respondOk({ idempotent: true, draft_id, case_id, version_id, sent_at: draft.sent_at })`
11. **Update draft via userClient (P1)** :
    - `status = 'sent'`, `sent_at = new Date().toISOString()`, `quotation_version_id = version_id`
    - Clause WHERE implicite RLS (userClient garantit `created_by = auth.uid()`)
    - Si 0 rows affectees ou erreur : `UPSTREAM_DB_ERROR`
12. **FSM transition** (seulement si `caseData.status === 'QUOTED_VERSIONED'`) :
    - `UPDATE quote_cases SET status = 'SENT'` via `serviceClient`
    - Si le status etait deja `SENT` (idempotence atteinte a l'etape 10), on ne passe jamais ici
13. **Timeline event** (best-effort, serviceClient) : `event_type: 'quotation_sent'`, `new_value: 'SENT'`, `actor_type: 'human'`
14. `logRuntimeEvent` op `send_quotation` + `respondOk`

### Corrections CTO appliquees

| Correction | Probleme | Solution |
|------------|----------|----------|
| P1 | Update draft via serviceClient (bypass RLS) | Update via userClient -- RLS garantit ownership |
| P2 | Ownership implicite du case | Guard explicite `created_by === user.id OR assigned_to === user.id` |
| P3 | Guard FSM non idempotent | Autoriser `QUOTED_VERSIONED` et `SENT` dans le guard |

### Mapping erreurs

| Situation | ErrorCode | HTTP |
|-----------|-----------|------|
| JWT manquant/invalide | AUTH_INVALID_JWT | 401 |
| Case non trouve (RLS filtre) | VALIDATION_FAILED | 400 |
| Ownership case refuse | FORBIDDEN_OWNER | 403 |
| Status hors guard | CONFLICT_INVALID_STATE | 409 |
| Version non trouvee / non selectionnee | VALIDATION_FAILED | 400 |
| Draft non trouve (RLS filtre) | VALIDATION_FAILED | 400 |
| Update draft echoue | UPSTREAM_DB_ERROR | 500 |
| Catch global | UNKNOWN | 500 |

### Pattern `fail()` helper

Identique a `generate-quotation-version` :

```text
async function fail(serviceClient, code, message, correlationId, userId, t0, meta?) {
  await logRuntimeEvent(serviceClient, { ... });
  return respondError({ code, message, correlationId, meta });
}
```

## Resume des livrables

| Etape | Livrable | Type |
|-------|----------|------|
| 18B | `ALTER TABLE email_drafts ADD COLUMN quotation_version_id` | Migration SQL |
| 18C | `supabase/functions/send-quotation/index.ts` | Edge Function |
| 18C | Ajout `send-quotation` dans `config.toml` | Config |

## Smoke tests post-deploy

1. Appel sans JWT : 401
2. Appel avec case_id invalide : 400 VALIDATION_FAILED
3. Appel avec case dont status != QUOTED_VERSIONED|SENT : 409 CONFLICT_INVALID_STATE
4. Appel nominal : 200 ok:true + draft.status='sent' + case.status='SENT'
5. Appel idempotent (meme draft_id) : 200 idempotent:true + count email_drafts inchange
6. Verification DB : `SELECT status, sent_at, quotation_version_id FROM email_drafts WHERE id = :draft_id`
7. Runtime events : 0 UNKNOWN

