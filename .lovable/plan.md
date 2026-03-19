

# CL2-final A+ — Plan corrigé (v2)

## Corrections intégrées par rapport au plan précédent

### Correction 1 — BG unsupported reste pré-claim

Dans le code réel BG mode, l'ordre est :
- L609-616 : type detection
- L618-625 : unsupported → update + return (pré-claim)
- L627 : download

Le claim sera inséré **entre L625 et L627** (après type-check, avant download). Donc `unsupported` (L618-625) reste pré-claim et garde son update simple `.eq('is_analyzed', false)` — aucune modification ownership sur cette branche.

### Correction 2 — Sync `return new Response` post-claim doivent libérer le claim

4 occurrences dans `processAttachmentsLoop` :
- L1311-1314 (402 Excel AI)
- L1317-1320 (429 Excel AI)
- L1422-1425 (402 doc AI)
- L1428-1431 (429 doc AI)

Ces `return new Response(...)` sortent directement de la fonction après le claim. Chacun doit être précédé d'un release ownership-aware :

```typescript
await supabase.from('email_attachments')
  .update({ analysis_claimed_at: null })
  .eq('id', attachment.id)
  .eq('is_analyzed', false)
  .eq('analysis_claimed_at', claimTs);
```

Note : ces `return new Response` dans une fonction `Promise<any[]>` sont déjà un bug de typage, mais le fix CL2 ne les refactore pas — il ajoute juste le release avant chaque return.

---

## Étape 1 — Migration SQL

Une seule migration, 5 statements :

```sql
ALTER TABLE public.email_attachments
  ADD COLUMN IF NOT EXISTS analysis_claimed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_quotation_history_attachment_cargo
  ON public.quotation_history (source_attachment_id, cargo_type)
  WHERE source_attachment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_learned_knowledge_source
  ON public.learned_knowledge (source_type, source_id, category)
  WHERE source_type = 'attachment' AND source_id IS NOT NULL;

ALTER TABLE public.local_transport_rates
  ADD COLUMN IF NOT EXISTS source_attachment_id UUID;

-- Invariant: one attachment produces at most one rate per (destination, container_type, cargo_category)
CREATE UNIQUE INDEX IF NOT EXISTS uq_local_transport_rates_attachment
  ON public.local_transport_rates (source_attachment_id, destination, container_type, cargo_category)
  WHERE source_attachment_id IS NOT NULL;
```

## Étape 2 — `analyze-attachments/index.ts`

### 2a. Claim atomique (BG + Sync)

**BG mode** : inséré entre L625 (unsupported return) et L627 (download). `unsupported` reste pré-claim.

**Sync mode** : inséré après L1143 (unsupported continue), avant L1146 (storage_path check).

Pattern identique dans les deux modes :

```typescript
const claimTs = new Date().toISOString();
const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
const { data: claimed, error: claimErr } = await supabase
  .from('email_attachments')
  .update({ analysis_claimed_at: claimTs })
  .eq('id', attachment.id)
  .eq('is_analyzed', false)
  .or(`analysis_claimed_at.is.null,analysis_claimed_at.lt.${fifteenMinAgo}`)
  .select('id').maybeSingle();

if (claimErr) {
  console.warn(`[analyze] Claim failed for ${attachment.id}:`, claimErr.message);
  continue; // or return in BG
}
if (!claimed) {
  console.log(`[analyze] ${attachment.id} already claimed/analyzed, skip`);
  continue; // or return in BG
}
```

### 2b. Sélection initiale élargie

Modifier ~L982 pour inclure claims expirés :

```typescript
const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
query = query.eq('is_analyzed', false)
  .or(`analysis_claimed_at.is.null,analysis_claimed_at.lt.${fifteenMinAgo}`)
  .limit(10);
```

### 2c. Early exits post-claim — ownership-aware

**BG mode** : L633 (download fail), L649 (empty excel) et tout autre exit post-claim ajoutent `.eq('analysis_claimed_at', claimTs)` et `analysis_claimed_at: null`.

**Sync mode** : L1148 (no storage_path), L1180 (download fail), L1203 (too small), L1236 (empty excel), L1324 (AI error mark) — tous ajoutent `.eq('analysis_claimed_at', claimTs)` et `analysis_claimed_at: null`.

**BG unsupported (L618-625)** : reste pré-claim, inchangé.
**Sync unsupported (L1130-1142)** : reste pré-claim, inchangé.

### 2d. `return new Response` post-claim — release avant return

Les 4 occurrences (L1311, L1317, L1422, L1428) reçoivent un release ownership-aware juste avant le `return` :

```typescript
// Release claim before early HTTP return
await supabase.from('email_attachments')
  .update({ analysis_claimed_at: null })
  .eq('id', attachment.id)
  .eq('is_analyzed', false)
  .eq('analysis_claimed_at', claimTs);
return new Response(...);
```

### 2e. Final update avec ownership check + retour vérifié

BG (~L906) et Sync (~L1603) :

```typescript
const { data: finalized, error: finalErr } = await supabase
  .from('email_attachments')
  .update({
    is_analyzed: true,
    extracted_text: normalizeText(extractedText || '').substring(0, limit),
    extracted_data: extractedData,
    analysis_claimed_at: null,
  })
  .eq('id', attachment.id)
  .eq('is_analyzed', false)
  .eq('analysis_claimed_at', claimTs)
  .select('id').maybeSingle();

if (finalErr) console.warn('[analyze] Final update failed:', finalErr.message);
if (!finalized) console.log(`[analyze] ${attachment.id} lost claim before finalization`);
```

### 2f. Catch blocks — ownership release

BG (~L921) et Sync (~L1633) :

```typescript
catch (error) {
  console.error(`Error: ${attachment.filename}`, error);
  await supabase.from('email_attachments')
    .update({ analysis_claimed_at: null })
    .eq('id', attachment.id)
    .eq('is_analyzed', false)
    .eq('analysis_claimed_at', claimTs);
}
```

### 2g. Side effects — Patch E remplacé par contraintes DB

- **quotation_history** : supprimer les blocs `maybeSingle()` check. Insert direct, gestion `23505` comme skip.
- **learned_knowledge** : même approche `23505`.
- **local_transport_rates** : ajouter `source_attachment_id: attachment.id` dans l'insert. Gestion `23505`.

### 2h. plan.md — marquer CL2-final A+ comme "in progress"

Pas "complete" avant vérification diff + migration réussie.

---

## Résumé

| Composant | Action |
|-----------|--------|
| Migration | +1 col `analysis_claimed_at`, +1 col `source_attachment_id`, +3 UNIQUE partiels |
| analyze-attachments | Claim ownership, 4 release avant `return Response`, final vérifié, early exits ownership-aware, Patch E → DB constraints |

## Non touché

Patches A/B/D, sync-emails, email-admin, modules FROZEN, prompts AI, frontend.

