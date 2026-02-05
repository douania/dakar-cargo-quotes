

# Phase 13 — Plan d'Implementation Final (Corrections CTO Integrees)

## Resume Executif

Plan d'implementation Phase 13 integrant les 3 corrections CTO obligatoires plus les 3 garde-fous supplementaires pour atteindre un niveau "production-grade".

---

## Corrections Appliquees

| Correction | Source | Solution |
|------------|--------|----------|
| Idempotency key stable | CTO #1 | `sha256(case_id + decision_type + proposal_id + selected_key)` |
| Gaps gating transactionnel | CTO #2 | RPC SQL avec `pg_advisory_xact_lock` |
| Canonical JSON hashing | CTO #3 | `canonicalStringify()` recursif |
| Idempotency basee sur proposal_id | Garde-fou #1 | Calcul APRES insertion proposal |
| Ne pas marquer committed si RPC rejette | Garde-fou #2 | Insert sans `committed_at`, update apres succes |
| Normaliser value_json si string | Garde-fou #3 | `JSON.parse()` defensif avant hash |

---

## Architecture du Flux Corrige

```text
commit-decision (Edge Function)
    |
    v
1. Validation JWT + ownership + status
    |
    v
2. Insert decision_proposals (SANS committed_at/committed_by)
    |
    v
3. Calculer facts_hash + gaps_hash (avec normalisation value_json)
    |
    v
4. Calculer idempotency_key = sha256(case_id + decision_type + proposal_id + selected_key)
    |
    v
5. Appeler RPC commit_decision_atomic (gaps check + insert transactionnel)
    |
    +--[rejected]---> Return 409 (proposal reste "generated", pas "committed")
    |
    +--[idempotent]-> Return 200 avec decision existante
    |
    +--[created]----> Update proposal avec committed_at/committed_by
                      |
                      v
                  6. Timeline event + check completude 5/5
                      |
                      v
                  Return 200 avec decision_id
```

---

## Etape 1 — Migration DB

### SQL Migration

```sql
-- ============================================================================
-- Phase 13 — Colonnes idempotence + forensic + RPC transactionnelle
-- ============================================================================

-- 1. operator_decisions : ajout colonnes
ALTER TABLE operator_decisions 
ADD COLUMN IF NOT EXISTS idempotency_key text,
ADD COLUMN IF NOT EXISTS facts_hash text,
ADD COLUMN IF NOT EXISTS gaps_hash text,
ADD COLUMN IF NOT EXISTS decision_version integer;

-- 2. Index unique partiel pour idempotence (case_id + idempotency_key)
CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_decisions_idempotency 
ON operator_decisions (case_id, idempotency_key) 
WHERE idempotency_key IS NOT NULL;

-- 3. decision_proposals : ajout hash forensic
ALTER TABLE decision_proposals 
ADD COLUMN IF NOT EXISTS facts_hash text,
ADD COLUMN IF NOT EXISTS gaps_hash text;

-- ============================================================================
-- RPC: commit_decision_atomic (transaction gaps check + insert)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.commit_decision_atomic(
  p_case_id uuid,
  p_decision_type text,
  p_idempotency_key text,
  p_proposal_id uuid,
  p_selected_key text,
  p_override_value text DEFAULT NULL,
  p_override_reason text DEFAULT NULL,
  p_facts_hash text DEFAULT NULL,
  p_gaps_hash text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing_id uuid;
  v_blocking_count integer;
  v_new_decision_id uuid;
  v_decision_version integer;
  v_old_decision_id uuid;
BEGIN
  -- Lock transactionnel sur case_id pour eviter race conditions
  PERFORM pg_advisory_xact_lock(hashtext('decision_' || p_case_id::text));
  
  -- 1. Idempotence check
  SELECT id INTO v_existing_id
  FROM operator_decisions
  WHERE case_id = p_case_id 
    AND idempotency_key = p_idempotency_key;
  
  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'decision_id', v_existing_id,
      'idempotent', true,
      'status', 'existing'
    );
  END IF;
  
  -- 2. Gaps blocking check (DANS LA TRANSACTION)
  SELECT COUNT(*) INTO v_blocking_count
  FROM quote_gaps
  WHERE case_id = p_case_id 
    AND is_blocking = true 
    AND status = 'open';
  
  IF v_blocking_count > 0 AND p_override_reason IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'blocking_gaps_open',
      'blocking_count', v_blocking_count,
      'status', 'rejected'
    );
  END IF;
  
  -- 3. Calculer decision_version (incremental par decision_type)
  SELECT COALESCE(MAX(decision_version), 0) + 1 INTO v_decision_version
  FROM operator_decisions
  WHERE case_id = p_case_id AND decision_type = p_decision_type::decision_type;
  
  -- 4. Trouver et superseder ancienne decision (si existe)
  SELECT id INTO v_old_decision_id
  FROM operator_decisions
  WHERE case_id = p_case_id 
    AND decision_type = p_decision_type::decision_type
    AND is_final = true;
  
  -- 5. Insert nouvelle decision
  INSERT INTO operator_decisions (
    case_id, proposal_id, decision_type, selected_key,
    override_value, override_reason, decided_by, decided_at,
    is_final, idempotency_key, facts_hash, gaps_hash, decision_version
  ) VALUES (
    p_case_id, p_proposal_id, p_decision_type::decision_type, p_selected_key,
    p_override_value, p_override_reason, p_user_id, now(),
    true, p_idempotency_key, p_facts_hash, p_gaps_hash, v_decision_version
  )
  RETURNING id INTO v_new_decision_id;
  
  -- 6. Superseder ancienne decision (si existe)
  IF v_old_decision_id IS NOT NULL THEN
    UPDATE operator_decisions
    SET is_final = false, superseded_by = v_new_decision_id
    WHERE id = v_old_decision_id;
  END IF;
  
  RETURN jsonb_build_object(
    'decision_id', v_new_decision_id,
    'decision_version', v_decision_version,
    'idempotent', false,
    'superseded_id', v_old_decision_id,
    'status', 'created'
  );
END;
$$;

-- Securite : service_role only
REVOKE ALL ON FUNCTION commit_decision_atomic FROM PUBLIC;
GRANT EXECUTE ON FUNCTION commit_decision_atomic TO service_role;
```

---

## Etape 2 — Helper Canonical Hash

### Nouveau fichier: `supabase/functions/_shared/canonical-hash.ts`

```typescript
/**
 * Phase 13 — Canonical JSON stringify + SHA-256 hash
 * 
 * Garantit un hash stable independant de:
 * - L'ordre des cles JSON
 * - Les types Date vs string
 * - Les valeurs undefined/null
 */

/**
 * Normalise une valeur avant serialisation canonique
 * - Parse les strings JSON imbriquees
 * - Convertit Date en ISO string
 * - Convertit undefined en null
 */
function normalizeValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  
  // Garde-fou #3: si c'est une string qui ressemble a du JSON, parser
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return normalizeValue(JSON.parse(trimmed));
      } catch {
        return value; // Pas du JSON valide, garder comme string
      }
    }
    return value;
  }
  
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }
  
  if (typeof value === 'object' && value !== null) {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      normalized[key] = normalizeValue((value as Record<string, unknown>)[key]);
    }
    return normalized;
  }
  
  return value;
}

/**
 * Stringify JSON de maniere canonique (cles triees recursivement)
 */
export function canonicalStringify(obj: unknown): string {
  const normalized = normalizeValue(obj);
  
  if (normalized === null) {
    return 'null';
  }
  
  if (typeof normalized !== 'object') {
    return JSON.stringify(normalized);
  }
  
  if (Array.isArray(normalized)) {
    const items = normalized.map(item => canonicalStringify(item));
    return '[' + items.join(',') + ']';
  }
  
  // Object: trier les cles recursivement
  const sortedKeys = Object.keys(normalized).sort();
  const pairs = sortedKeys.map(key => {
    const value = (normalized as Record<string, unknown>)[key];
    return JSON.stringify(key) + ':' + canonicalStringify(value);
  });
  
  return '{' + pairs.join(',') + '}';
}

/**
 * Compute SHA-256 hash of canonical JSON
 */
export async function computeCanonicalHash(data: unknown): Promise<string> {
  const canonical = canonicalStringify(data);
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(canonical);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
```

---

## Etape 3 — Modifier commit-decision Edge Function

### Fichier: `supabase/functions/commit-decision/index.ts`

**Changements principaux:**

1. Import du helper canonical hash
2. Insert `decision_proposals` SANS `committed_at`/`committed_by` (Garde-fou #2)
3. Calcul `idempotency_key` APRES insertion proposal (Garde-fou #1)
4. Appel RPC `commit_decision_atomic`
5. UPDATE proposal avec `committed_at` uniquement si RPC succes
6. Gestion retour idempotent vs rejected vs created

```typescript
// Structure du flux modifie:

// 1. Insert proposal SANS committed_at/committed_by
const { data: proposal } = await serviceClient
  .from('decision_proposals')
  .insert({
    case_id,
    decision_type,
    proposal_batch_id: proposalBatchId,
    options_json: proposal_json,
    generated_at: now,
    generated_by: 'ai',
    // committed_at: RETIRE (Garde-fou #2)
    // committed_by: RETIRE (Garde-fou #2)
    facts_hash: factsHash,
    gaps_hash: gapsHash
  })
  .select('id')
  .single();

// 2. Calculer idempotency_key APRES avoir le proposal_id (Garde-fou #1)
const idempotencyKey = await computeCanonicalHash({
  case_id,
  decision_type,
  proposal_id: proposal.id,  // Stable!
  selected_key,
  override_reason: override_reason || null
});

// 3. Appeler RPC transactionnelle
const { data: rpcResult } = await serviceClient.rpc('commit_decision_atomic', {
  p_case_id: case_id,
  p_decision_type: decision_type,
  p_idempotency_key: idempotencyKey,
  p_proposal_id: proposal.id,
  p_selected_key: selected_key,
  p_override_value: override_value || null,
  p_override_reason: override_reason || null,
  p_facts_hash: factsHash,
  p_gaps_hash: gapsHash,
  p_user_id: userId
});

// 4. Gerer les retours
if (rpcResult.status === 'rejected') {
  // NE PAS marquer proposal comme committed (Garde-fou #2)
  return new Response(JSON.stringify({
    error: 'Gaps bloquants ouverts',
    blocking_count: rpcResult.blocking_count,
    require_override: true
  }), { status: 409 });
}

if (rpcResult.idempotent) {
  return new Response(JSON.stringify({
    decision_id: rpcResult.decision_id,
    idempotent: true
  }), { status: 200 });
}

// 5. Succes: marquer proposal comme committed (Garde-fou #2)
await serviceClient
  .from('decision_proposals')
  .update({ committed_at: now, committed_by: userId })
  .eq('id', proposal.id);

// 6. Timeline + completude (inchange)
```

---

## Etape 4 — Bouton "Debloquer le Pricing"

### Fichier: `src/components/puzzle/DecisionSupportPanel.tsx`

**Ajouts:**

1. Etat `isUnlockingPricing`
2. Handler `handleUnlockPricing` appelant `ack-pricing-ready`
3. Section UI conditionnelle basee sur `quoteCase?.status === 'DECISIONS_COMPLETE'`

```typescript
// Import manquant
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Unlock } from 'lucide-react';

// Dans le composant:
const [isUnlockingPricing, setIsUnlockingPricing] = useState(false);
const queryClient = useQueryClient();

// Fetch quote case status
const { data: quoteCase } = useQuery({
  queryKey: ['quote-case', caseId],
  queryFn: async () => {
    const { data } = await supabase
      .from('quote_cases')
      .select('status')
      .eq('id', caseId)
      .single();
    return data;
  }
});

const handleUnlockPricing = async () => {
  setIsUnlockingPricing(true);
  try {
    const { data, error } = await supabase.functions.invoke('ack-pricing-ready', {
      body: { case_id: caseId }
    });
    
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    
    toast.success('Pricing debloque - pret pour le calcul');
    queryClient.invalidateQueries({ queryKey: ['quote-case'] });
  } catch (err) {
    toast.error('Echec du deblocage pricing');
  } finally {
    setIsUnlockingPricing(false);
  }
};

// Dans le render, apres DecisionProgressIndicator:
{quoteCase?.status === 'DECISIONS_COMPLETE' && (
  <Card className="border-green-300 bg-green-50">
    <CardContent className="py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle className="h-5 w-5 text-green-600" />
          <div>
            <p className="font-medium text-green-900">
              Toutes les decisions sont validees (5/5)
            </p>
            <p className="text-sm text-green-700">
              Debloquez le calcul de prix pour continuer
            </p>
          </div>
        </div>
        <Button 
          onClick={handleUnlockPricing}
          disabled={isUnlockingPricing}
          className="gap-2 bg-green-600 hover:bg-green-700"
        >
          {isUnlockingPricing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Unlock className="h-4 w-4" />
          )}
          Debloquer le pricing
        </Button>
      </div>
    </CardContent>
  </Card>
)}
```

---

## Resume des Fichiers a Modifier

| Fichier | Type | Modification |
|---------|------|--------------|
| Migration SQL | DB | +4 colonnes + 1 index + 1 RPC |
| `supabase/functions/_shared/canonical-hash.ts` | NOUVEAU | Helper hash canonique |
| `supabase/functions/commit-decision/index.ts` | MODIFIER | Flux 2-phase proposal + RPC |
| `src/components/puzzle/DecisionSupportPanel.tsx` | MODIFIER | Bouton unlock pricing |

---

## Checklist Acceptance Phase 13

| Critere | Implementation | Statut |
|---------|---------------|--------|
| Idempotence stable | `sha256(case_id + decision_type + proposal_id + selected_key)` | A implementer |
| Idempotence basee sur proposal_id | Calcul APRES insert proposal | A implementer |
| Gaps gating transactionnel | RPC `commit_decision_atomic` avec lock | A implementer |
| Pas d'artefact si RPC rejette | Insert proposal sans committed_at | A implementer |
| Hash canonical | `canonicalStringify()` recursif + normalisation | A implementer |
| Normaliser value_json | `JSON.parse()` defensif dans normalizeValue() | A implementer |
| Append-only | Supersession via `is_final` + `superseded_by` | Existant |
| Forensic complet | Hash dans `operator_decisions` + `decision_proposals` | A implementer |
| UI depend etat DB | `quoteCase?.status === 'DECISIONS_COMPLETE'` | A implementer |
| Ack pricing gate | Existant et fonctionnel | OK |

---

## Estimation Effort

| Tache | Temps |
|-------|-------|
| Migration DB + RPC | 15 min |
| canonical-hash.ts | 15 min |
| commit-decision refactor | 35 min |
| DecisionSupportPanel | 20 min |
| Tests manuels (idempotence, gaps, hash) | 25 min |
| **Total** | **~1h50** |

---

## Risques et Mitigations

| Risque | Mitigation |
|--------|------------|
| RPC echoue silencieusement | Log explicite + return JSON structure |
| Proposal orphelin si crash | Proposal sans committed_at = identifiable |
| Hash different entre runs | Canonical stringify + normalisation deterministe |
| Double clic pendant RPC | Index unique + retour idempotent 200 |

