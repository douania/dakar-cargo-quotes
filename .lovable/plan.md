

# Phase EQ1 — External Quote Requests (Final Implementation Plan)

## CTO Correction Responses

**Correction 1 — `verify_jwt = false`**: This is the established project standard, not an oversight. All 60+ functions use `verify_jwt = false` + `requireUser` due to ES256 signing-keys compatibility (documented in `docs/SECURITY_CONTRACT.md`). No change needed.

**Correction 2 — Idempotence**: Will add `UNIQUE (request_id, source_email_id)` constraint on `external_quote_responses`. Accepted.

**Correction 3 — Status transitions**: Will add CHECK constraints on all three tables with the full status list. Status transition rules codified below.

---

## 1. Database Migration (single SQL migration)

### Table: `external_quote_requests`
- `id` UUID PK, `case_id` FK → quote_cases NOT NULL, `partner_name` TEXT NOT NULL, `partner_email` TEXT, `purpose` TEXT NOT NULL, `purpose_detail` TEXT, `related_lot_index` INT, `sent_at` TIMESTAMPTZ, `due_at` TIMESTAMPTZ, `created_by` UUID, `created_at` / `updated_at` TIMESTAMPTZ defaults
- `status` TEXT NOT NULL DEFAULT 'draft' with CHECK: `draft`, `sent`, `response_received`, `response_analyzed`, `partially_validated`, `facts_validated`, `closed`
- Indexes: `(case_id, status)`, `(case_id, created_at DESC)`
- RLS: authenticated SELECT/INSERT/UPDATE
- `updated_at` trigger using existing `update_updated_at_column()`

### Table: `external_quote_responses`
- `id` UUID PK, `request_id` FK → external_quote_requests NOT NULL, `case_id` FK → quote_cases NOT NULL, `source_email_id` UUID (FK → emails), `raw_excerpt` TEXT, `received_at` / `analyzed_at` TIMESTAMPTZ, `created_at` TIMESTAMPTZ
- `status` TEXT NOT NULL DEFAULT 'received' with CHECK: `received`, `analyzed`, `reviewed`
- **UNIQUE constraint on `(request_id, source_email_id)`** — idempotence guard
- Index: `(request_id, received_at DESC)`
- RLS: authenticated SELECT/INSERT/UPDATE

### Table: `external_quote_response_facts`
- `id` UUID PK, `response_id` FK → external_quote_responses NOT NULL, `request_id` FK (denormalized), `case_id` FK (denormalized), `fact_key` TEXT NOT NULL, `proposed_value_text` TEXT, `proposed_value_number` NUMERIC, `currency` TEXT, `confidence` NUMERIC DEFAULT 0.7, `source_excerpt` TEXT, `injected_fact_id` UUID, `validated_by` UUID, `validated_at` TIMESTAMPTZ, `created_at` TIMESTAMPTZ
- `validation_status` TEXT NOT NULL DEFAULT 'proposed' with CHECK: `proposed`, `validated`, `rejected`
- Indexes: `(request_id, validation_status)`, `(response_id)`
- RLS: authenticated SELECT/INSERT/UPDATE

### CHECK constraint updates
- Add `'partner_response'` to `quote_facts_source_type_check` (drop + re-create with full existing list + new value)
- Add `'external_request_created'`, `'external_response_analyzed'` to `case_timeline_events_event_type_check`

### Status transition rules (codified in edge functions, not DB triggers)

```text
external_quote_requests.status:
  draft → sent                    (operator sends)
  sent → response_received        (response linked)
  response_received → response_analyzed  (AI analysis done)
  response_analyzed → partially_validated (≥1 fact validated/rejected, some still proposed)
  response_analyzed → facts_validated     (all facts resolved, ≥1 validated)
  partially_validated → facts_validated   (last proposed fact resolved, ≥1 validated)
  response_analyzed → closed              (all facts rejected or manual close)
  partially_validated → closed            (manual close)
  * → closed                              (manual close allowed from any state)
```

---

## 2. Edge Function: `analyze-partner-response`

File: `supabase/functions/analyze-partner-response/index.ts`

Pattern: mirrors `analyze-reply-event` (same imports, same structure).

**Input**: `{ case_id, request_id, email_id }`

**Flow**:
1. `requireUser(req)` auth
2. Load request (purpose, partner_name) + email (body_text, subject) via userClient
3. Idempotence: `INSERT INTO external_quote_responses ... ON CONFLICT (request_id, source_email_id) DO NOTHING` — if conflict, return existing response + its facts
4. Call AI (Gemini 2.5 Flash) with purpose-aware prompt to extract facts
5. Insert proposed facts into `external_quote_response_facts`
6. Update response `status → analyzed`, request `status → response_analyzed`
7. Insert `case_timeline_events` with `event_type: 'external_response_analyzed'`
8. Create `manual_action` timeline event: "Valider les faits du partenaire"
9. Return analysis summary

**AI prompt** will be purpose-aware: different extraction guidance for `origin_charges` vs `freight_rate` vs `air_tariff`.

---

## 3. Edge Function: `validate-partner-fact`

File: `supabase/functions/validate-partner-fact/index.ts`

**Input**: `{ fact_id, action: 'validate' | 'reject' }`

**Flow**:
1. `requireUser(req)` auth
2. Load fact + its request
3. If `validate`: call `supersede_fact` RPC with `p_source_type: 'partner_response'`, store returned UUID as `injected_fact_id`, set `validation_status → validated`, `validated_by`, `validated_at`
4. If `reject`: set `validation_status → rejected`
5. Compute request status: count remaining `proposed` facts for this request
   - If 0 proposed remaining AND ≥1 validated → `facts_validated`
   - If 0 proposed remaining AND 0 validated → `closed`
   - If >0 proposed remaining → `partially_validated`
6. Update request status
7. Insert timeline event for traceability

---

## 4. Config

Add to `supabase/config.toml`:
```toml
[functions.analyze-partner-response]
verify_jwt = false

[functions.validate-partner-fact]
verify_jwt = false
```

---

## 5. Frontend

### New hook: `src/hooks/useExternalRequests.ts`
- Queries all 3 tables for a given `case_id`
- Provides mutations: `createRequest`, `triggerAnalysis` (invoke analyze-partner-response), `validateFact`, `rejectFact`
- Uses `@tanstack/react-query` with invalidation on mutations

### New component: `src/components/puzzle/ExternalRequestsPanel.tsx`
- List of requests with status badges (color-coded)
- "Nouvelle demande partenaire" button → inline form (partner_name, partner_email, purpose select, purpose_detail textarea)
- For each request with responses: expandable list of proposed facts
- Per fact: Validate (green) / Reject (red) buttons
- Status auto-updates after each action

### CaseView integration: `src/pages/CaseView.tsx`
- Import `ExternalRequestsPanel`
- Add as a new section in the "puzzle" tab, after the existing DecisionSupportPanel
- Pass `caseId` and `threadId`

---

## Files Summary

| File | Action |
|------|--------|
| Migration SQL | Create 3 tables, CHECK updates, indexes, unique constraint, trigger |
| `supabase/functions/analyze-partner-response/index.ts` | Create |
| `supabase/functions/validate-partner-fact/index.ts` | Create |
| `supabase/config.toml` | Add 2 entries |
| `src/hooks/useExternalRequests.ts` | Create |
| `src/components/puzzle/ExternalRequestsPanel.tsx` | Create |
| `src/pages/CaseView.tsx` | Add panel import + render |

## Not Changed
- `build-case-puzzle`, `quotation-engine`, `run-pricing` (FROZEN)
- Existing `set-case-fact`, `supersede_fact` RPC — reused as-is

