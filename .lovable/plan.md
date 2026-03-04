

## P0 CRITIQUE — Regression dans analyze-thread-event

### Probleme identifie

La "correction" precedente (`.eq("id", email.thread_ref)` → `.eq("thread_ref", email.thread_ref)`) est en realite une **regression**. Verification en base :

- `emails.thread_ref` est un **UUID** qui correspond directement a `email_threads.id`
- `email_threads` n'a **pas** de colonne `thread_ref` (colonnes : `id`, `subject_normalized`, `root_message_id`, etc.)
- Le code original `.eq("id", email.thread_ref)` etait **correct**

Preuve DB :
```
emails.thread_ref = f1d5c49b-... → email_threads.id = f1d5c49b-...
```

Le mapping est `emails.thread_ref → email_threads.id` (FK directe).

### Correction requise

**Fichier** : `supabase/functions/analyze-thread-event/index.ts`, ligne 79

Revenir a :
```typescript
.eq("id", email.thread_ref)
```

au lieu de :
```typescript
.eq("thread_ref", email.thread_ref)  // FAUX — colonne inexistante
```

### Impact

Sans ce fix, **chaque appel** a `analyze-thread-event` retourne "Thread not found" (404) car la requete filtre sur une colonne qui n'existe pas dans `email_threads`.

### Scope

1 ligne changee, 1 fichier, 0 risque de regression (on restaure le comportement correct original).

