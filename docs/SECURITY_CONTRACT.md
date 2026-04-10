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

### Admin Surface

**Important** : les pages sous `/admin/*` dans l'application sont un **regroupement produit/UI**, pas une frontière d'autorisation backend. Il n'existe pas de garde frontend admin — tout utilisateur authentifié voit ces pages dans la sidebar.

La protection réelle repose sur :

1. **Edge Functions admin-only** (`data-admin`, `email-admin`) : protégées par `requireAdmin` (allowlist email). Les pages Knowledge, MarketIntelligence, PricingIntelligence, et les actions sensibles d'Emails passent par ces fonctions.

2. **Tables de référence — shared workspace authenticated CRUD** : les tables suivantes sont accessibles en lecture/écriture à tout utilisateur authentifié, sans restriction de rôle :
   - `hs_codes` (SELECT public, UPDATE/DELETE authenticated)
   - `tax_rates` (SELECT public, INSERT/UPDATE authenticated)
   - `customs_regimes` (SELECT public, INSERT/UPDATE authenticated)
   - `port_tariffs` (SELECT public, INSERT/UPDATE/DELETE authenticated)
   - `pricing_client_overrides` (SELECT/INSERT/UPDATE/DELETE authenticated)
   - `documents` (SELECT/DELETE authenticated ; INSERT via `parse-document` service_role)
   - `learned_knowledge` (SELECT authenticated ; writes via `data-admin` service_role)

   Ce modèle est un **choix produit volontaire** pour une équipe mono-société. Ce n'est pas un modèle RBAC admin.

3. **Suppression `documents`** : tout utilisateur authentifié peut supprimer tout document. C'est un choix accepté en mono-équipe, documenté explicitement. À restreindre si ouverture multi-société.

**Décision de non-implémentation** : aucun système de rôles (RBAC) n'est implémenté à ce stade. Le ROI est négatif en mono-équipe. Voir `DEFERRED_BACKLOG.md` item RLS-ADMIN pour le déclencheur de réouverture.

---

## Function Classification

| Level | Auth method | Examples |
|-------|-------------|---------|
| **public** | None | `healthz` |
| **user_auth (requireUser)** | `requireUser` helper | `ack-pricing-ready`, `suggest-decisions`, `generate-quotation-version`, `analyze-partner-response`, `validate-partner-fact`, `send-external-quote-request`, `confirm-external-request-sent`, `close-external-quote-request`, `analyze-reply-event`, `analyze-attachments`, `analyze-service-scope`, `analyze-risks`, `ensure-quote-case`, `send-quotation`, `create-quotation-email-draft`, `close-commercial-outcome`, `generate-reply-draft`, `sync-gap-client-actions`, `auto-match-partner-responses`, `select-partner-request`, `close-manual-action`, `mark-client-gap-request-sent`, **`data-query`** |
| **user_auth (inline)** | Inline JWT validation | `commit-decision` (S1.3 — granular error codes), `run-pricing` (FROZEN), `build-case-puzzle` (FROZEN), `export-quotation-version-pdf` (canonical pipeline, inline auth conservé, `verify_jwt = false` en config) |
| **admin** | `requireAdmin` | `data-admin`, `email-admin` |

### `data-query` — Operator read surface (B1-audit)

Created to decouple operator-level read queries from `data-admin` (which requires `requireAdmin`). Exposes **5 read-only actions**: `search`, `search_tariffs`, `find_historical_references`, `get_transport_rates`, `search_transport_rate`. Write operations (`create_knowledge`, etc.) remain in `data-admin` — see `DEFERRED_BACKLOG.md` item P2B.

### Auth migration stance

Auth convergence is **complete for the current stabilization phase**.

All non-FROZEN functions without a specific observability justification have been migrated to `requireUser`. The remaining inline-auth functions are **intentional exceptions**, not deferred work:

- `commit-decision` — retained for **observability preservation** (granular `AUTH_MISSING_JWT` / `AUTH_INVALID_JWT` distinction, S1.3).
- `run-pricing` — **FROZEN**. Must not be reopened without a `STRUCTURAL_PATCH_ALLOWED` exception.
- `build-case-puzzle` — **FROZEN**. Must not be reopened without a `STRUCTURAL_PATCH_ALLOWED` exception.

No further auth migration should be opened unless a new business or structural need justifies it.

---

## SOURCE-GUARD — Protection provenance facts

`build-case-puzzle` implémente un système de protection contre la contamination des faits depuis les sources internes ou partenaires :

1. **SG-1 — Filtrage contexte IA** : les emails des domaines internes (`@sodatra.sn`, `@sodatra.com`) sont exclus du contexte d'extraction IA
2. **SG-2 — Garde monétaire post-extraction** : les facts monétaires sensibles (`cargo.value`, `cargo.freight_cost`, etc.) sont bloqués si la provenance email n'est pas `client` (classification par `classifyEmailProvenance()` via domain matching)
3. **SG-2 doc-regex** : les documents internes (devis, brouillons) sont ignorés lors de l'extraction par regex

Limitations : le domain matching est heuristique — voir `SOURCE-GUARD-DEBT` dans `docs/DEFERRED_BACKLOG.md`.

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
| `data-query` | Created as user_auth (requireUser). Decouples operator reads (search, tariffs, transport rates, historical references) from admin-only `data-admin`. Components migrated: `KnowledgeSearch`, `HistoricalRateReminders`, `useTariffSuggestions`, `MatchKnowledgeToSegmentDialog`. | 2026-03 |
| `generate-reply-draft` | Added to classification as user_auth (requireUser). Generates client reply drafts from gap questions. | 2026-04 |
| `sync-gap-client-actions` | Added to classification as user_auth (requireUser). Syncs open gaps to idempotent manual_action timeline events. | 2026-04 |
| `auto-match-partner-responses` | Added to classification as user_auth (requireUser). COM-2A partner response suggestion scanning. | 2026-04 |
| `select-partner-request` | Added to classification as user_auth (requireUser). COCKPIT-9 P2 partner offer selection. | 2026-04 |
| `close-manual-action` | Added to classification as user_auth (requireUser). Closes manual_action timeline events. | 2026-04 |
| `mark-client-gap-request-sent` | Added to classification as user_auth (requireUser). CL1 marks client_gap_requests as sent. | 2026-04 |
| `confirm-external-request-sent` | Added as user_auth (requireUser). P0-C: confirms partner request actual send, sets `email_sent_at`. Preconditions: `status=sent`, `email_draft_id` present. Idempotent. | 2026-04 |
| `close-external-quote-request` | Added as user_auth (requireUser). P1-B: backendised partner request closure. Preconditions: no `proposed` facts remaining (409 if any). No status whitelist — any non-closed status allowed. Idempotent if already closed. Timeline: NON-SILENT (failure → 500). | 2026-04 |
