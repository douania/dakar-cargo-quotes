## Mission: RLS-REFERENCE-TABLES-P1 — Deploy & Runtime Verification

Strict deploy/runtime verification. No code patches, no new migration content, no docs changes.

### Scope (allowed)
- Apply existing migration: `supabase/migrations/20260604120000_rls_reference_tables_p1.sql` (commits `665844f` / `26ec970` on branch `work`)
- Deploy ONLY: `port-tariffs-admin`, `carrier-billing-templates-admin`
- Run read-only metadata SELECT verification
- Optional no-auth 401 smoke on the two admin functions

### Out of scope (forbidden)
- No edits to `quote_cases`, `quote_facts`, `commodity_classification_candidates`
- No touch to `build-case-puzzle`, `run-pricing`, or any other function
- No new migration, no docs change, no data mutation beyond the approved migration
- No create/update/delete smoke tests

### Execution steps

1. **Pre-check (read-only)**
   - Confirm the migration file exists at the expected path on branch `work`.
   - Snapshot current RLS state of `port_tariffs` and `carrier_billing_templates` via `supabase--read_query` (queries 1 & 2 from mission) — baseline before/after diff.

2. **Apply migration**
   - Call `supabase--migration` with the exact SQL contents of `supabase/migrations/20260604120000_rls_reference_tables_p1.sql` (no modifications).
   - Wait for user approval and execution.

3. **Deploy edge functions**
   - `supabase--deploy_edge_functions` with `["port-tariffs-admin", "carrier-billing-templates-admin"]` only.

4. **Runtime metadata verification (read-only)**
   - Query 1 — `pg_tables.rowsecurity` for both tables.
   - Query 2 — `pg_policies` (policyname, roles, cmd, qual, with_check) for both tables.
   - Compare against expected state:
     - RLS enabled on both
     - SELECT policy scoped to `authenticated` only
     - No public read policy
     - No INSERT/UPDATE/DELETE policy for `authenticated` (writes flow exclusively through admin edge functions with service_role)

5. **Optional no-auth smoke (safe, non-mutating)**
   - `supabase--curl_edge_functions` POST `/port-tariffs-admin` with empty Authorization + `{"action":"list"}` payload → expect `401 Missing authorization header`.
   - Same for `/carrier-billing-templates-admin`.
   - Explicit empty Authorization header to prevent preview-session token injection.
   - No create/update/delete probes.

### Deliverable (report)

| Item | Result |
|---|---|
| Migration file present on `work` | yes/no |
| Migration applied | yes/no + timestamp |
| Functions deployed | list |
| `pg_tables` results | raw |
| `pg_policies` results | raw |
| Expected RLS shape matched | per-table verdict |
| Auth smoke 401 (port-tariffs-admin) | HTTP + body |
| Auth smoke 401 (carrier-billing-templates-admin) | HTTP + body |
| Errors (verbatim) | … |

Verdicts: `RLS_P1_DEPLOY_PASS` / `RLS_P1_PARTIAL` / `RLS_P1_FAIL` / `NOT_VERIFIABLE`.

### Risks & guardrails
- If migration drops an existing policy that authenticated writers rely on, write paths via direct PostgREST (if any) will start failing. Mitigation: both admin functions already use `requireAdmin` + `createSupabaseClient` (service_role), bypassing RLS — confirmed in current source.
- No rollback migration is in scope. If the deployed RLS shape diverges from expectation, report as `RLS_P1_FAIL` and stop; do not author a corrective migration without separate CTO GO.
