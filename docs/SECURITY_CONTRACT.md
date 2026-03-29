# Security Contract — Edge Functions

> **Subordinate to `docs/MASTER_CONTEXT.md`** (source of truth).
> This document details operational application of security rules defined in MASTER_CONTEXT.

## Scope

This contract covers the **canonical pipeline** and **critical functions** only. Functions not listed in the classification table are not individually formalized here; their absence does not imply lack of authentication — the project standard is `requireUser` for all non-public functions. For an exhaustive inventory of all edge functions, refer to the codebase directly.

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

### Isolation Surfaces

| Surface | Modèle d'accès | Notes |
|---------|---------------|-------|
| `email_drafts` | **Owner-scoped** (B1-A) | SELECT/DELETE: owner + legacy NULL transitoire. UPDATE/INSERT: owner strict. Service_role non affecté. |
| `case_documents` + bucket | Shared workspace (B1-B reporté) | Flux upload-first/delete-first incompatible avec jointure RLS storage. |
| `quotation_documents` | Owner-scoped (existant) | Policies `owner_select`/`owner_insert` déjà en place. |
| `quote_cases` et tables enfants | Shared workspace | Contrat team-wide inchangé. |

B1-A crée volontairement une asymétrie : les drafts deviennent owner-scoped tandis que les dossiers restent en shared workspace. Cette asymétrie est acceptée comme trade-off produit local, pas comme modèle d'isolation global.

---

## Function Classification

| Level | Auth method | Examples |
|-------|-------------|---------|
| **public** | None | `healthz` |
| **user_auth (requireUser)** | `requireUser` helper | `ack-pricing-ready`, `suggest-decisions`, `generate-quotation-version`, `analyze-partner-response`, `validate-partner-fact`, `send-external-quote-request`, `analyze-reply-event`, `analyze-attachments`, `analyze-service-scope`, `analyze-risks`, `ensure-quote-case`, `send-quotation`, `create-quotation-email-draft`, `close-commercial-outcome` |
| **user_auth (inline)** | Inline JWT validation | `commit-decision` (S1.3 — granular error codes), `run-pricing` (FROZEN), `build-case-puzzle` (FROZEN), `export-quotation-version-pdf` (canonical pipeline, inline auth conservé, `verify_jwt = false` en config) |
| **admin** | `requireAdmin` | `data-admin`, `email-admin` |

### Auth migration stance

Auth convergence is **complete for the current stabilization phase**.

All non-FROZEN functions without a specific observability justification have been migrated to `requireUser`. The remaining inline-auth functions are **intentional exceptions**, not deferred work:

- `commit-decision` — retained for **observability preservation** (granular `AUTH_MISSING_JWT` / `AUTH_INVALID_JWT` distinction, S1.3).
- `run-pricing` — **FROZEN**. Must not be reopened without a `STRUCTURAL_PATCH_ALLOWED` exception.
- `build-case-puzzle` — **FROZEN**. Must not be reopened without a `STRUCTURAL_PATCH_ALLOWED` exception.

No further auth migration should be opened unless a new business or structural need justifies it.

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
| `generate-case-outputs` | ~~Migrated to `requireUser`~~ — **Fonction supprimée en M26b** (dead code confirmé). Entrée conservée pour historique. | 2026-03 |
| — | **Auth convergence complete.** Remaining inline: `commit-decision` (observability), `run-pricing` (FROZEN), `build-case-puzzle` (FROZEN). No further migration planned for current phase. | 2026-03 |
| `export-quotation-version-pdf` | Added to classification as user_auth (inline). Docstring corrected: `verify_jwt = false`. Inline auth conserved — no migration in M7b. | 2026-03 |
| `create-quotation-email-draft` | Added to classification as user_auth (requireUser). Previously missing from security contract. | 2026-03 |
| `close-commercial-outcome` | Added as user_auth (requireUser). Transitions SENT → ACCEPTED/REJECTED. | 2026-03 |
