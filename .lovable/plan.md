

# Plan de correction P1 : 2 fixes post-review CTO

## Résumé des corrections

| Issue | Fichier | Statut | Action |
|-------|---------|--------|--------|
| **P1.1** - No-op sans final_puzzle | `learn-quotation-puzzle/index.ts` | ❌ À corriger | Copier puzzle du job précédent |
| **P1.2** - Typage Record | `sync-emails/index.ts` | ✅ Déjà OK | Ligne 1443 = `Record<string, unknown>` |

---

## P1.1 : learn-quotation-puzzle — Copier final_puzzle en mode no-op

### Problème identifié

**Lignes 586-598** : Quand aucun nouvel email n'est trouvé, le job est marqué `completed` SANS `final_puzzle` :

```typescript
if (newEmails.length === 0 && previouslyAnalyzedIds.length > 0) {
  await updateJob(supabase, jobId, {
    status: "completed",
    progress: 100,
    knowledge_stored: 0,  // ❌ Pas de final_puzzle
    emails_analyzed_ids: previouslyAnalyzedIds,
    // ...
  });
  return;
}
```

### Conséquence

- L'UI reçoit un job `completed` mais `final_puzzle = null`
- `onPuzzleComplete` peut planter ou afficher un puzzle vide
- Confusion UX : "analyse terminée" mais aucun résultat visible

### Correction

Modifier la query ligne 560-567 pour récupérer aussi `final_puzzle` et `knowledge_stored`, puis les copier dans le nouveau job :

```typescript
// Ligne 560-567 : Ajouter final_puzzle et knowledge_stored au select
const { data: previousJob } = await supabase
  .from("puzzle_jobs")
  .select("emails_analyzed_ids, final_puzzle, knowledge_stored")  // ← AJOUT
  .eq("thread_id", threadId)
  .eq("status", "completed")
  .order("completed_at", { ascending: false })
  .limit(1)
  .maybeSingle();

// Lignes 586-598 : Utiliser les données du job précédent
if (newEmails.length === 0 && previouslyAnalyzedIds.length > 0) {
  console.log(`[Puzzle] No new emails for thread ${threadId}, reusing previous puzzle (no-op)`);
  await updateJob(supabase, jobId, {
    status: "completed",
    progress: 100,
    current_phase: null,
    completed_at: new Date().toISOString(),
    final_puzzle: previousJob?.final_puzzle || null,      // ← COPIE
    knowledge_stored: previousJob?.knowledge_stored || 0, // ← COPIE
    emails_analyzed_ids: previouslyAnalyzedIds,
    duration_ms: Date.now() - startTime
  });
  return;
}
```

---

## P1.2 : sync-emails — Typage Record

### Statut : ✅ Déjà correct

Vérification effectuée sur `supabase/functions/sync-emails/index.ts` ligne 1443 :

```typescript
const updates: Record<string, unknown> = {
  last_email_seen_at: new Date().toISOString(),
  last_activity_at: new Date().toISOString(),
};
```

Le typage `Record<string, unknown>` est bien présent. **Aucune modification requise.**

---

## Résumé des modifications

| Fichier | Lignes | Modification |
|---------|--------|--------------|
| `learn-quotation-puzzle/index.ts` | 562 | Ajouter `final_puzzle, knowledge_stored` au select |
| `learn-quotation-puzzle/index.ts` | 588-596 | Copier `final_puzzle` et `knowledge_stored` du job précédent |

**Effort : 5 minutes**

---

## Tests de validation post-fix

### R1 — Import idempotent (UX)
1. Sync sur boîte déjà importée → toast "Aucun nouvel email (X déjà présents)"
2. Sync mixte → toast "N nouveaux, M ignorés"

### R2 — Puzzle incrémental
1. Analyser thread déjà analysé sans nouveau mail → job `completed` avec `final_puzzle` visible
2. Ajouter 1 email, relancer → job traite uniquement les nouveaux

### R3 — Continuité cotation
1. Case `NEED_INFO` + nouvel email → status `FACTS_PARTIAL` + event timeline
2. Case `PRICED_DRAFT` + nouvel email → status inchangé, `last_email_seen_at` mis à jour

