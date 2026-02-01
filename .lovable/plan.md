

# Phase 7.0 — Correctifs CTO : GO PROD Patches

## Résumé de l'audit

L'audit CTO a identifié **4 bloquants** critiques qui doivent être corrigés avant toute mise en production.

---

## 1. Bloquant A — `run_number` non atomique (Race Condition)

### Problème actuel (lignes 160-165 de `run-pricing`)
```typescript
const { count: existingRuns } = await serviceClient
  .from("pricing_runs")
  .select("*", { count: "exact", head: true })
  .eq("case_id", case_id);

const runNumber = (existingRuns || 0) + 1;
```

Deux appels simultanés lisent le même `count`, calculent le même `runNumber`, et l'un échoue sur la contrainte `UNIQUE(case_id, run_number)`. De plus, le case reste bloqué en `PRICING_RUNNING` sans run valide.

### Solution : Fonction RPC atomique + retry

**Migration SQL** : Créer une fonction `get_next_pricing_run_number`

```sql
CREATE OR REPLACE FUNCTION get_next_pricing_run_number(p_case_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_number INTEGER;
BEGIN
  -- Lock on case to prevent concurrent runs
  PERFORM pg_advisory_xact_lock(hashtext(p_case_id::text));
  
  SELECT COALESCE(MAX(run_number), 0) + 1 
  INTO next_number
  FROM pricing_runs
  WHERE case_id = p_case_id;
  
  RETURN next_number;
END;
$$;
```

**Edge Function** : Remplacer le COUNT par appel RPC
```typescript
const { data: nextRunNumber, error: rpcError } = await serviceClient
  .rpc('get_next_pricing_run_number', { p_case_id: case_id });

if (rpcError) throw new Error(`Failed to get run number: ${rpcError.message}`);
const runNumber = nextRunNumber;
```

**Compensation d'erreur** : Si l'insert du run échoue, rollback le status
```typescript
try {
  const { data: pricingRun, error: runInsertError } = await serviceClient
    .from("pricing_runs")
    .insert({ ... })
    .select("id")
    .single();
    
  if (runInsertError) throw runInsertError;
  // ... continue
} catch (insertError) {
  // Rollback status
  await serviceClient
    .from("quote_cases")
    .update({ status: "READY_TO_PRICE" })
    .eq("id", case_id);
  throw insertError;
}
```

---

## 2. Bloquant B — RLS INSERT `quote_cases` trop permissive

### Problème actuel (ligne 212-214 de la migration)
```sql
CREATE POLICY "quote_cases_insert_authenticated"
  ON quote_cases FOR INSERT TO authenticated
  WITH CHECK (true);
```

N'importe quel utilisateur peut créer des cases sur n'importe quel `thread_id`, permettant :
- Pollution de la base
- DoS logique via UNIQUE(thread_id) 
- Injection de cases "fantômes" via `assigned_to`

### Solution : Policy stricte

**Migration SQL** : Remplacer la policy
```sql
DROP POLICY IF EXISTS "quote_cases_insert_authenticated" ON quote_cases;

CREATE POLICY "quote_cases_insert_owner"
  ON quote_cases FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid() 
    AND (assigned_to IS NULL OR assigned_to = auth.uid())
  );
```

L'Edge Function `ensure-quote-case` fonctionne déjà avec `created_by: userId` explicite, donc compatible.

---

## 3. Bloquant C — Supersession des facts incomplète

### Problème actuel (lignes 245-266 de `build-case-puzzle`)
```typescript
if (existingFact) {
  if (JSON.stringify(existingValue) !== JSON.stringify(factValue)) {
    // Supersede old fact
    await serviceClient
      .from("quote_facts")
      .update({ is_current: false, updated_at: new Date().toISOString() })
      .eq("id", existingFact.id);

    // Insert new fact
    await insertFact(serviceClient, case_id, fact, existingFact.id);
```

Le problème : ces deux opérations ne sont pas atomiques. Si l'UPDATE réussit mais l'INSERT échoue, on perd le fait "current". De plus, une race condition peut créer deux facts `is_current=true` simultanément avant que le constraint unique ne les bloque.

### Solution : Transaction RPC

**Migration SQL** : Créer une fonction `supersede_fact`
```sql
CREATE OR REPLACE FUNCTION supersede_fact(
  p_case_id UUID,
  p_fact_key TEXT,
  p_fact_category TEXT,
  p_value_text TEXT DEFAULT NULL,
  p_value_number NUMERIC DEFAULT NULL,
  p_value_json JSONB DEFAULT NULL,
  p_value_date TIMESTAMPTZ DEFAULT NULL,
  p_source_type TEXT DEFAULT 'ai_extraction',
  p_source_email_id UUID DEFAULT NULL,
  p_source_attachment_id UUID DEFAULT NULL,
  p_source_excerpt TEXT DEFAULT NULL,
  p_confidence NUMERIC DEFAULT 0.80
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_fact_id UUID;
  new_fact_id UUID;
BEGIN
  -- Lock to prevent concurrent supersessions
  PERFORM pg_advisory_xact_lock(hashtext(p_case_id::text || p_fact_key));
  
  -- Find and deactivate old fact
  SELECT id INTO old_fact_id
  FROM quote_facts
  WHERE case_id = p_case_id AND fact_key = p_fact_key AND is_current = true;
  
  IF old_fact_id IS NOT NULL THEN
    UPDATE quote_facts 
    SET is_current = false, updated_at = now()
    WHERE id = old_fact_id;
  END IF;
  
  -- Insert new fact
  INSERT INTO quote_facts (
    case_id, fact_key, fact_category,
    value_text, value_number, value_json, value_date,
    source_type, source_email_id, source_attachment_id, source_excerpt,
    confidence, is_current, supersedes_fact_id
  ) VALUES (
    p_case_id, p_fact_key, p_fact_category,
    p_value_text, p_value_number, p_value_json, p_value_date,
    p_source_type, p_source_email_id, p_source_attachment_id, p_source_excerpt,
    p_confidence, true, old_fact_id
  )
  RETURNING id INTO new_fact_id;
  
  RETURN new_fact_id;
END;
$$;
```

**Edge Function** : Utiliser la RPC
```typescript
const { data: newFactId, error } = await serviceClient.rpc('supersede_fact', {
  p_case_id: case_id,
  p_fact_key: fact.key,
  p_fact_category: fact.category,
  p_value_text: fact.valueType === 'text' ? String(fact.value) : null,
  p_value_number: fact.valueType === 'number' ? Number(fact.value) : null,
  p_value_json: fact.valueType === 'json' ? fact.value : null,
  p_source_type: fact.sourceType,
  p_source_email_id: fact.sourceEmailId,
  p_confidence: fact.confidence,
});
```

---

## 4. Bloquant D — Transitions de statut non-transactionnelles

### Problème actuel

Le flow de `run-pricing` fait :
1. UPDATE status → PRICING_RUNNING
2. INSERT pricing_run
3. Appel quotation-engine
4. UPDATE pricing_run
5. UPDATE status → PRICED_DRAFT

Si l'étape 2 échoue (collision run_number), le case reste en `PRICING_RUNNING` sans run valide.

### Solution : Compensation robuste

L'Edge Function doit garantir un rollback si l'insertion du run échoue :

```typescript
// Après transition vers PRICING_RUNNING
try {
  // Get atomic run number
  const { data: runNumber, error: rpcError } = await serviceClient
    .rpc('get_next_pricing_run_number', { p_case_id: case_id });
    
  if (rpcError) throw new Error(`Run number failed: ${rpcError.message}`);

  // Insert run
  const { data: pricingRun, error: runInsertError } = await serviceClient
    .from("pricing_runs")
    .insert({ case_id, run_number: runNumber, inputs_json, facts_snapshot, status: "running", ... })
    .select("id")
    .single();

  if (runInsertError) throw runInsertError;
  
  // Continue with engine call...
  
} catch (error) {
  // ROLLBACK: Restore previous status
  await serviceClient
    .from("quote_cases")
    .update({ 
      status: "READY_TO_PRICE", 
      updated_at: new Date().toISOString() 
    })
    .eq("id", case_id);

  await serviceClient.from("case_timeline_events").insert({
    case_id,
    event_type: "pricing_failed",
    event_data: { error: String(error), reason: "run_creation_failed" },
    actor_type: "system",
  });

  throw error;
}
```

---

## 5. Amélioration recommandée — Garde-fou `run-pricing`

Même si `status = READY_TO_PRICE`, re-vérifier les gaps bloquants avant de lancer le pricing :

```typescript
// Après vérification status === "READY_TO_PRICE"
const { count: blockingGaps } = await serviceClient
  .from("quote_gaps")
  .select("*", { count: "exact", head: true })
  .eq("case_id", case_id)
  .eq("is_blocking", true)
  .eq("status", "open");

if (blockingGaps && blockingGaps > 0) {
  return new Response(
    JSON.stringify({ 
      error: "Blocking gaps still open",
      blocking_gaps_count: blockingGaps,
      hint: "Resolve blocking gaps before pricing"
    }),
    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
```

---

## Récapitulatif des fichiers modifiés

| Fichier | Modification |
|---------|--------------|
| `supabase/migrations/[new].sql` | Nouvelle migration avec fonctions RPC + policy corrigée |
| `supabase/functions/run-pricing/index.ts` | RPC atomique, compensation rollback, garde-fou gaps |
| `supabase/functions/build-case-puzzle/index.ts` | Utilisation RPC `supersede_fact` |

---

## Migration SQL complète

```sql
-- Phase 7.0.1-fix: Correctifs CTO pour GO PROD

-- 1. Function atomique pour run_number
CREATE OR REPLACE FUNCTION get_next_pricing_run_number(p_case_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_number INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_case_id::text));
  
  SELECT COALESCE(MAX(run_number), 0) + 1 
  INTO next_number
  FROM pricing_runs
  WHERE case_id = p_case_id;
  
  RETURN next_number;
END;
$$;

-- 2. Function atomique pour supersession des facts
CREATE OR REPLACE FUNCTION supersede_fact(
  p_case_id UUID,
  p_fact_key TEXT,
  p_fact_category TEXT,
  p_value_text TEXT DEFAULT NULL,
  p_value_number NUMERIC DEFAULT NULL,
  p_value_json JSONB DEFAULT NULL,
  p_value_date TIMESTAMPTZ DEFAULT NULL,
  p_source_type TEXT DEFAULT 'ai_extraction',
  p_source_email_id UUID DEFAULT NULL,
  p_source_attachment_id UUID DEFAULT NULL,
  p_source_excerpt TEXT DEFAULT NULL,
  p_confidence NUMERIC DEFAULT 0.80
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_fact_id UUID;
  new_fact_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_case_id::text || p_fact_key));
  
  SELECT id INTO old_fact_id
  FROM quote_facts
  WHERE case_id = p_case_id AND fact_key = p_fact_key AND is_current = true;
  
  IF old_fact_id IS NOT NULL THEN
    UPDATE quote_facts 
    SET is_current = false, updated_at = now()
    WHERE id = old_fact_id;
  END IF;
  
  INSERT INTO quote_facts (
    case_id, fact_key, fact_category,
    value_text, value_number, value_json, value_date,
    source_type, source_email_id, source_attachment_id, source_excerpt,
    confidence, is_current, supersedes_fact_id
  ) VALUES (
    p_case_id, p_fact_key, p_fact_category,
    p_value_text, p_value_number, p_value_json, p_value_date,
    p_source_type, p_source_email_id, p_source_attachment_id, p_source_excerpt,
    p_confidence, true, old_fact_id
  )
  RETURNING id INTO new_fact_id;
  
  RETURN new_fact_id;
END;
$$;

-- 3. Correction RLS INSERT quote_cases
DROP POLICY IF EXISTS "quote_cases_insert_authenticated" ON quote_cases;

CREATE POLICY "quote_cases_insert_owner"
  ON quote_cases FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid() 
    AND (assigned_to IS NULL OR assigned_to = auth.uid())
  );
```

---

## Impact et risques

| Critère | Avant | Après |
|---------|-------|-------|
| Race condition run_number | ❌ Collision possible | ✅ Advisory lock atomique |
| RLS INSERT abuse | ❌ WITH CHECK(true) | ✅ created_by = auth.uid() |
| Supersession facts | ❌ 2 queries non atomiques | ✅ RPC transactionnelle |
| Status orphelin | ❌ Case bloqué en PRICING_RUNNING | ✅ Rollback automatique |
| Gaps blocking check | ⚠️ Confiance au status | ✅ Double vérification |

---

## Estimation

| Composant | Effort |
|-----------|--------|
| Migration SQL (2 RPC + 1 policy) | 30 min |
| `run-pricing/index.ts` refactor | 45 min |
| `build-case-puzzle/index.ts` refactor | 30 min |
| Tests Edge Functions | 30 min |
| **Total** | **~2h15** |

