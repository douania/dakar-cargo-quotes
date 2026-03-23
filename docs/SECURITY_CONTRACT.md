# Security Contract — Edge Functions

> **Subordinate to `docs/MASTER_CONTEXT.md`** (source of truth).
> This document details operational application of security rules defined in MASTER_CONTEXT.

---

## Authentication Standard

Pattern: `verify_jwt = false` + `requireUser` (centralized auth helper in `_shared/auth.ts`).

- `requireUser(req)` → validates JWT, returns `AuthResult` or `401 Response`
- `requireAdmin(req)` → validates JWT + checks `ADMIN_EMAIL_ALLOWLIST`

All Edge Functions set `verify_jwt = false` in `supabase/config.toml` for ES256 signing-keys compatibility.

---

## Access Model

**Current access model**: shared authenticated operator workspace.

- All authenticated operators can access all cases.
- Case ownership (`created_by`) is **not enforced** for access control.
- Actor identity **is preserved** for audit trail (`actor_user_id`, `decided_by`, `created_by`).

This model is appropriate for a single-company transit/customs team with a shared case portfolio.

---

## Function Classification

| Level | Auth method | Examples |
|-------|-------------|---------|
| **public** | None | `healthz` |
| **user_auth (requireUser)** | `requireUser` helper | `ack-pricing-ready`, `suggest-decisions`, `generate-quotation-version`, `analyze-partner-response`, `validate-partner-fact`, `send-external-quote-request`, `analyze-reply-event`, `analyze-attachments`, `analyze-service-scope`, `analyze-risks`, `ensure-quote-case`, `send-quotation`, `generate-case-outputs` |
| **user_auth (inline)** | Inline JWT validation | `commit-decision` (S1.3 — granular error codes), `run-pricing` (FROZEN), `build-case-puzzle` (FROZEN) |
| **admin** | `requireAdmin` | `data-admin`, `email-admin` |

### Auth migration stance

Both `requireUser` and inline JWT validation perform the same functional check: extract Bearer token, call `getUser(token)`, reject on failure. They are **functionally equivalent** in terms of access control.

However, `requireUser` remains the **target standard**. Inline auth is retained only when:

- The function is **FROZEN** and must not be reopened without a `STRUCTURAL_PATCH_ALLOWED` exception (`build-case-puzzle`, `run-pricing`).
- The function requires **granular error codes** for observability that `requireUser` does not provide (`commit-decision` — distinguishes `AUTH_MISSING_JWT` from `AUTH_INVALID_JWT`).
- Migration has been **deferred** to a future stabilization phase.

Migration is **progressive and opportunistic**: functions are migrated to `requireUser` when they are already opened for another legitimate change. No global auth refactor is planned.

---

## Observability

Functions using the `runtime.ts` contract (`logRuntimeEvent`, `respondOk`, `respondError`) preserve auth failure events in `runtime_events` for traceability.

Functions migrated to `requireUser` that previously used inline auth with `logRuntimeEvent` add a post-check log to preserve this observability (see `generate-quotation-version`).

Note: `generate-quotation-version` logs all auth failures as `AUTH_INVALID_JWT` regardless of whether the cause is a missing header or an invalid token. This is a known trade-off accepted in S1.2 to avoid re-implementing inline auth.

---

## S1 Patch Log

| Function | Change | Date |
|----------|--------|------|
| `ack-pricing-ready` | Migrated to `requireUser` | 2026-03 |
| `suggest-decisions` | Migrated to `requireUser`, removed false `verify_jwt=true` comment | 2026-03 |
| `generate-quotation-version` | Migrated to `requireUser` + post-check log, fixed false docstrings | 2026-03 |
| `commit-decision` | Comments only (auth deferred to S1.3 for observability preservation) | 2026-03 |
| `ensure-quote-case` | Migrated to `requireUser`, removed inline auth + local corsHeaders, harmonized CORS with shared helper | 2026-03 |
| `send-quotation` | Migrated to `requireUser` + post-check log, retained userClient for RLS (reconstructed via `auth.token`) | 2026-03 |
| `generate-case-outputs` | Migrated to `requireUser` + post-check log, removed userClient + local corsHeaders | 2026-03 |
