

# Plan d'Implémentation Pré-Phase 8 : 3 Règles Métier

## Validation CTO Confirmée ✅

| Règle | État Actuel | Niveau OK | Effort |
|-------|-------------|-----------|--------|
| **R1 - Import Idempotent** | Backend ✅, UX ❌ | 85% | 30 min |
| **R2 - Puzzle Incrémental** | Partiellement OK | 70% | 1h30 |
| **R3 - Continuité Cotations** | Non implémenté | 40% | 1h30 |

**Temps total : ~3h30**

---

## PHASE A : Import Email Idempotent (UX) — 30 min

### Ce qui fonctionne déjà ✅

Le backend gère correctement la déduplication :

**sync-emails (lignes 1354-1364)** :
```typescript
const { data: existing } = await supabase
  .from('emails')
  .select('id')
  .eq('message_id', msg.messageId)
  .maybeSingle();

if (existing) {
  console.log("Email already exists:", msg.messageId);
  continue; // ✅ Skip silencieux
}
```

### Ce qui manque ❌

Le retour API ne distingue pas les emails ignorés :
```typescript
// Ligne 1448 actuelle
return { success: true, synced: processedEmails.length }
// ❌ Pas de compteur "skipped"
```

### Modifications requises

#### A.1 Backend : `sync-emails/index.ts`

**Ajouter compteur `skipped`** :

Avant la boucle (vers ligne 1350), ajouter :
```typescript
let skippedCount = 0;
```

Dans le `if (existing)` (ligne 1361), ajouter :
```typescript
if (existing) {
  console.log("Email already exists:", msg.messageId);
  skippedCount++;
  continue;
}
```

Modifier le retour (ligne 1448) :
```typescript
return {
  success: true,
  synced: processedEmails.length,
  skipped: skippedCount,
  message: skippedCount > 0 
    ? `${processedEmails.length} nouveaux, ${skippedCount} ignorés (déjà présents)`
    : null
}
```

#### A.2 Frontend : `src/hooks/useEmails.ts`

Modifier le hook `useSyncEmails` (ligne 72-87) :

```typescript
export function useSyncEmails() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: emailService.syncEmails,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['emails'] });
      
      // Distinction nouveaux / ignorés
      if (data.synced === 0 && data.skipped > 0) {
        toast.info(`Aucun nouvel email (${data.skipped} déjà présents)`);
      } else if (data.skipped > 0) {
        toast.success(`${data.synced} nouveaux emails, ${data.skipped} ignorés`);
      } else {
        toast.success(`${data.synced} emails synchronisés`);
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erreur de synchronisation');
    },
  });
}
```

---

## PHASE B : Puzzle Strictement Incrémental — 1h30

### Ce qui fonctionne déjà ✅

1. **supersede_fact RPC** : Atomique, skip si valeur identique (ligne 254-259 de build-case-puzzle)
2. **Résolution des gaps** : Automatique si fact trouvé
3. **build-case-puzzle** : Incrémental par design (supersede, pas replace)

### Ce qui pose problème ❌

**learn-quotation-puzzle** (lignes 556-560, 690-691) :
```typescript
// Recharge TOUS les emails à chaque phase
const { emails, attachments } = await loadThreadData(supabase, supabaseUrl, supabaseKey, threadId);
```

Aucun filtre sur les emails déjà analysés → re-traitement inutile + coûts IA.

### Modifications requises

#### B.1 Migration : Ajouter tracking des emails analysés

```sql
-- Migration: add_emails_analyzed_tracking
ALTER TABLE puzzle_jobs 
ADD COLUMN IF NOT EXISTS emails_analyzed_ids TEXT[] DEFAULT '{}';

COMMENT ON COLUMN puzzle_jobs.emails_analyzed_ids IS 
  'IDs des emails déjà analysés lors de ce job pour éviter re-traitement';
```

#### B.2 Backend : `learn-quotation-puzzle/index.ts`

**Modifier la fonction `loadThreadData`** pour accepter un filtre optionnel :

Après le chargement des emails (créer une nouvelle fonction) :
```typescript
async function loadIncrementalThreadData(
  supabase: SupabaseClient,
  supabaseUrl: string,
  supabaseKey: string,
  threadId: string,
  previouslyAnalyzedIds: string[] = []
): Promise<{ emails: any[]; attachments: any[]; allEmailIds: string[] }> {
  const { emails: allEmails, attachments } = await loadThreadData(
    supabase, supabaseUrl, supabaseKey, threadId
  );
  
  const allEmailIds = allEmails.map((e: any) => e.id);
  const previousSet = new Set(previouslyAnalyzedIds);
  
  // Filtrer seulement les nouveaux emails
  const newEmails = allEmails.filter((e: any) => !previousSet.has(e.id));
  
  console.log(`[Puzzle] Thread has ${allEmails.length} emails, ${newEmails.length} new (${previouslyAnalyzedIds.length} already analyzed)`);
  
  // Si aucun nouvel email, retourner tableau vide (skip analysis)
  return {
    emails: newEmails,
    attachments: attachments.filter((a: any) => 
      newEmails.some((e: any) => e.id === a.email_id)
    ),
    allEmailIds
  };
}
```

**Modifier `processAllPhases`** (ligne 545) :

```typescript
async function processAllPhases(
  supabase: SupabaseClient,
  apiKey: string,
  jobId: string,
  threadId: string
) {
  // Récupérer les emails déjà analysés du dernier job completed
  const { data: previousJob } = await supabase
    .from("puzzle_jobs")
    .select("emails_analyzed_ids")
    .eq("thread_id", threadId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const previouslyAnalyzed = previousJob?.emails_analyzed_ids || [];

  // Charger seulement les nouveaux emails
  const { emails, attachments, allEmailIds } = await loadIncrementalThreadData(
    supabase, supabaseUrl, supabaseKey, threadId, previouslyAnalyzed
  );

  // Si aucun nouvel email et pas de force_refresh
  if (emails.length === 0) {
    console.log(`[Puzzle] No new emails for thread ${threadId}, marking as completed`);
    await updateJob(supabase, jobId, {
      status: "completed",
      progress: 100,
      current_phase: null,
      completed_at: new Date().toISOString(),
      knowledge_stored: 0,
      // Conserver les emails précédemment analysés
      emails_analyzed_ids: previouslyAnalyzed
    });
    return;
  }

  // ... reste de la logique existante ...

  // À la fin, sauvegarder TOUS les emails analysés (anciens + nouveaux)
  await updateJob(supabase, jobId, {
    status: "completed",
    // ...
    emails_analyzed_ids: allEmailIds // Tous les emails du thread
  });
}
```

#### B.3 Backend : `build-case-puzzle/index.ts`

**Ajouter protection statuts figés** (après ligne 186) :

```typescript
// Statuts qui ne doivent pas être modifiés automatiquement
const FROZEN_STATUSES = ["PRICED_DRAFT", "HUMAN_REVIEW", "SENT", "ACCEPTED", "REJECTED", "ARCHIVED"];

if (FROZEN_STATUSES.includes(caseData.status) && !force_refresh) {
  console.log(`[BuildPuzzle] Case ${case_id} is frozen (${caseData.status}), facts will be added but status unchanged`);
}
```

Modifier la logique de changement de statut (ligne 494-501) :

```typescript
// 12. Determine new status (only if not frozen)
let newStatus = caseData.status;
const isFrozen = FROZEN_STATUSES.includes(caseData.status);

if (!isFrozen) {
  if (blockingGapsCount === 0 && (currentFactsCount || 0) > 0) {
    newStatus = "READY_TO_PRICE";
  } else if ((openGapsCount || 0) > 0) {
    newStatus = "NEED_INFO";
  } else {
    newStatus = "FACTS_PARTIAL";
  }
}
```

---

## PHASE C : Continuité des Cotations — 1h30

### Ce qui manque ❌

1. Pas de signal au `quote_case` quand un nouvel email arrive
2. Pas de réouverture automatique du statut `NEED_INFO`
3. Protection "devis figé" non implémentée partout

### Modifications requises

#### C.1 Migration : Tracking de la dernière activité

```sql
-- Migration: add_case_email_tracking
ALTER TABLE quote_cases 
ADD COLUMN IF NOT EXISTS last_email_seen_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_quote_cases_thread_status 
ON quote_cases(thread_id, status);

COMMENT ON COLUMN quote_cases.last_email_seen_at IS 
  'Timestamp du dernier email du thread vu par le système';
```

#### C.2 Backend : `import-thread/index.ts` (ou équivalent sync-emails)

**Ajouter notification au quote_case** après insertion d'email :

Après l'insertion d'un email (vers ligne 1425 de sync-emails), ajouter :

```typescript
// Notifier le quote_case existant s'il y en a un
if (inserted.thread_ref) {
  const { data: existingCase } = await supabase
    .from("quote_cases")
    .select("id, status")
    .eq("thread_id", inserted.thread_ref)
    .maybeSingle();

  if (existingCase) {
    // Statuts qui peuvent être réouverts
    const REOPENABLE_STATUSES = ["NEED_INFO", "READY_TO_PRICE"];
    
    // Statuts figés (devis généré)
    const FROZEN_STATUSES = ["PRICED_DRAFT", "HUMAN_REVIEW", "SENT", "ACCEPTED", "REJECTED", "ARCHIVED"];
    
    const updates: Record<string, unknown> = {
      last_email_seen_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
    };
    
    // Réouvrir si en attente d'info (nouvel email = potentielle réponse)
    if (REOPENABLE_STATUSES.includes(existingCase.status)) {
      updates.status = "FACTS_PARTIAL"; // Relancer l'analyse
    }
    
    await supabase
      .from("quote_cases")
      .update(updates)
      .eq("id", existingCase.id);

    // Log timeline
    await supabase.from("case_timeline_events").insert({
      case_id: existingCase.id,
      event_type: "new_email_received",
      event_data: { 
        email_id: inserted.id,
        previous_status: existingCase.status,
        new_status: updates.status || existingCase.status,
        was_frozen: FROZEN_STATUSES.includes(existingCase.status)
      },
      actor_type: "system",
    });

    console.log(`Notified quote_case ${existingCase.id} of new email ${inserted.id}`);
  }
}
```

#### C.3 UX : Message explicite si case figé

Dans le composant `CaseView.tsx` ou `QuotationPuzzleView.tsx`, ajouter :

```tsx
// Afficher un banner si le case a reçu de nouveaux emails après génération du devis
{caseData.status === 'PRICED_DRAFT' && caseData.last_email_seen_at && 
 new Date(caseData.last_email_seen_at) > new Date(caseData.updated_at) && (
  <Alert variant="info" className="mb-4">
    <AlertCircle className="h-4 w-4" />
    <AlertDescription>
      De nouveaux emails ont été reçus depuis la génération du devis. 
      Pour les intégrer, créez un nouveau pricing run.
    </AlertDescription>
  </Alert>
)}
```

---

## Résumé des fichiers modifiés

| Fichier | Type | Modification |
|---------|------|--------------|
| `supabase/functions/sync-emails/index.ts` | Edge Function | Compteur skipped + notification case |
| `supabase/functions/learn-quotation-puzzle/index.ts` | Edge Function | Filtrage emails déjà analysés |
| `supabase/functions/build-case-puzzle/index.ts` | Edge Function | Protection statuts figés |
| `src/hooks/useEmails.ts` | Hook | Toast avec distinction nouveaux/ignorés |
| Migration SQL | Schema | 2 colonnes (emails_analyzed_ids, last_email_seen_at) |

---

## Vérifications post-implémentation

1. **R1** : Relancer sync sur emails déjà importés → toast "Aucun nouvel email (X déjà présents)"
2. **R2** : Relancer puzzle sur thread déjà analysé sans nouveaux emails → skip immédiat
3. **R3** : Ajouter email à thread avec case NEED_INFO → status passe à FACTS_PARTIAL

---

## Risques maîtrisés

| Risque | Mitigation |
|--------|------------|
| Régression sync emails | Skip logic existante conservée |
| Perte de données puzzle | Supersede atomic, pas de delete |
| Incohérence statuts | FROZEN_STATUSES explicite |

