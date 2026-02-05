

## Plan Phase 14 FINAL — Observabilité & Résilience Edge Functions

### Corrections CTO intégrées (toutes)

| Point | Problème | Correction |
|-------|----------|------------|
| **#1 RLS runtime_events** | Policy `TO service_role` inutile | `REVOKE ALL` + accès service role uniquement |
| **#2 admin_select** | `auth.users.raw_user_meta_data` dangereux | Supprimé - lecture via service role uniquement |
| **#3 UI Retry** | Retry sans garantie idempotence | `commit-decision` retry OK, autres `MAX_RETRIES=1` |
| **#4 CORS** | `x-correlation-id` absent | Ajout dans `_shared/cors.ts` |
| **#5 meta bornage** | Risque PII/payload énorme | Limite 1KB dans helper |
| **#6 Append-only** | Convention, pas contrainte DB | Triggers BEFORE UPDATE/DELETE |
| **#7 Rate limit race** | SELECT puis INSERT = race condition | UPSERT atomique avec RETURNING |

---

### P0 — Patch CORS

**Fichier:** `supabase/functions/_shared/cors.ts`

Ajout `x-correlation-id` dans `Access-Control-Allow-Headers`

---

### P1 — runtime.ts (helper partagé)

**Fichier:** `supabase/functions/_shared/runtime.ts`

| Export | Description |
|--------|-------------|
| `getCorrelationId(req)` | Lit `x-correlation-id` ou génère UUID |
| `respondOk(data, correlationId)` | `{ ok: true, data, correlation_id }` |
| `respondError(opts)` | `{ ok: false, error: { code, message, retryable }, correlation_id }` |
| `structuredLog(entry)` | JSON console structuré |
| `logRuntimeEvent(client, entry)` | INSERT runtime_events (meta ≤ 1KB) |
| `checkRateLimit(client, userId, fn, limit, window)` | **UPSERT atomique** avec RETURNING |

**Taxonomie d'erreurs:**

| Code | HTTP | Retryable |
|------|------|-----------|
| `AUTH_MISSING_JWT` | 401 | false |
| `AUTH_INVALID_JWT` | 401 | false |
| `FORBIDDEN_OWNER` | 403 | false |
| `VALIDATION_FAILED` | 400 | false |
| `CONFLICT_INVALID_STATE` | 409 | false |
| `RATE_LIMITED` | 429 | true |
| `EDGE_TIMEOUT` | 504 | true |
| `UPSTREAM_DB_ERROR` | 500 | true |
| `UNKNOWN` | 500 | false |

---

### P2 — Migration runtime_events (CORRIGÉE FINALE)

```sql
CREATE TABLE runtime_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ts timestamptz DEFAULT now(),
  correlation_id uuid,
  function_name text NOT NULL,
  op text,
  user_id uuid,
  status text CHECK (status IN ('ok','retryable_error','fatal_error')),
  error_code text,
  http_status int,
  duration_ms int,
  meta jsonb DEFAULT '{}'
);

CREATE INDEX idx_runtime_events_ts ON runtime_events(ts DESC);
CREATE INDEX idx_runtime_events_correlation ON runtime_events(correlation_id);
CREATE INDEX idx_runtime_events_function ON runtime_events(function_name, ts DESC);

-- Accès service role uniquement
REVOKE ALL ON runtime_events FROM anon, authenticated;
GRANT INSERT, SELECT ON runtime_events TO service_role;

-- CORRECTION #6: Append-only enforced via triggers
CREATE OR REPLACE FUNCTION prevent_runtime_events_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'runtime_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER runtime_events_no_update
BEFORE UPDATE ON runtime_events
FOR EACH ROW EXECUTE FUNCTION prevent_runtime_events_mutation();

CREATE TRIGGER runtime_events_no_delete
BEFORE DELETE ON runtime_events
FOR EACH ROW EXECUTE FUNCTION prevent_runtime_events_mutation();
```

---

### P3 — Migration rate_limit_buckets

```sql
CREATE TABLE rate_limit_buckets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  function_name text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count int DEFAULT 1,
  UNIQUE(user_id, function_name, window_start)
);

CREATE INDEX idx_rate_limit_user_fn ON rate_limit_buckets(user_id, function_name);

REVOKE ALL ON rate_limit_buckets FROM anon, authenticated;
GRANT ALL ON rate_limit_buckets TO service_role;
```

**checkRateLimit UPSERT atomique (CORRECTION #7):**

```sql
INSERT INTO rate_limit_buckets (user_id, function_name, window_start, request_count)
VALUES ($1, $2, date_trunc('minute', now()), 1)
ON CONFLICT (user_id, function_name, window_start)
DO UPDATE SET request_count = rate_limit_buckets.request_count + 1
RETURNING request_count;
```

Seuils: commit-decision 10/min, generate-response 5/min, autres 10/min

---

### P4 — Patch 5 Edge Functions

Pattern appliqué à chaque fonction:

```text
import { getCorrelationId, respondOk, respondError, ... } from "../_shared/runtime.ts";

const correlationId = getCorrelationId(req);
const startTime = Date.now();

// Erreurs → respondError({ code, message, httpStatus, retryable, correlationId })
// Succès → respondOk(data, correlationId)
// Fin → logRuntimeEvent(serviceClient, { correlationId, functionName, ... })
```

**Fonctions:** commit-decision, generate-response, generate-case-outputs, generate-quotation, generate-quotation-pdf

---

### P5 — healthz

**Fichier:** `supabase/functions/healthz/index.ts`

```text
GET /healthz → { ok: true, db: true, ts: "...", latency_ms: 12 }
```

---

### P6 — UI Retry (différencié)

| Hook/Service | Fonction | MAX_RETRIES |
|--------------|----------|-------------|
| `useDecisionSupport.ts` | commit-decision | 3 |
| `emailService.ts` | generate-response | 1 |
| `QuotationPdfExport.tsx` | generate-quotation-pdf | 1 |

Header `x-correlation-id` ajouté à tous les appels.

---

### Séquence d'implémentation

1. Patch CORS (`_shared/cors.ts`)
2. Créer `_shared/runtime.ts`
3. Migrations SQL (runtime_events + rate_limit_buckets)
4. Patcher 5 Edge Functions
5. Créer healthz
6. Patcher hooks/services UI
7. Test end-to-end

---

### Rollback

| Composant | Action |
|-----------|--------|
| Triggers append-only | `DROP TRIGGER` |
| Tables | `REVOKE INSERT` (données conservées) |
| Rate limit | Désactiver check dans helper |
| UI retry | Revenir sans retry |

