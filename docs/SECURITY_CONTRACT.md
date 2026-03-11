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
| **user_auth** | `requireUser` | All case/quotation/pricing/decision functions |
| **admin** | `requireAdmin` | `data-admin`, `email-admin` |

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
