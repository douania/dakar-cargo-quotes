
# Phase 15.8 — Async / Anti-timeout (IMPLEMENTED)

## 15.8.1 — analyze-attachments async ✅
- Extracted sync loop into `processAttachmentsLoop()` function
- Added `mode: "start"` path with `EdgeRuntime.waitUntil` for full async
- Added `lovableApiKey` guard before async launch (returns 400 if missing)
- UI callers updated: `AttachmentStatusPanel.tsx` + `Emails.tsx` → `mode: "start"`

## 15.8.2 — build-case-puzzle Jobs ✅
- Migration: `case_puzzle_jobs` table with owner-only RLS, unique partial index
- Backend: switch(mode) BEFORE case_id validation (poll/tick/cancel use job_id only)
- Self-fetch uses user's `authHeader` (NOT service_role)
- `serviceClient` used only for writing job state (bypass RLS)
- `tick` reads `request_params` from job row for self-fetch body
- Self-fetch: `AbortController` 290s timeout + `resp.ok` check + defensive JSON parse
- UI: local `runBuildCasePuzzleAsync` helper in CaseView + QuotationSheet
- Polling: 3s normal, x2 backoff on error (max 30s), 5 min global timeout
- `saveGapAnswer`: fire-and-forget `mode: "start"` (non-blocking)

# Phase 18 E2E — Unblock "Envoyer le devis" (IMPLEMENTED)

## Patch A — RLS email_drafts authenticated-only ✅
- Dropped 4 owner-based policies (select/insert/update/delete)
- Created 4 authenticated-only policies (mono-tenant back-office)
- Added unique partial index `email_drafts_one_per_version_active` on `(quotation_version_id) WHERE status IN ('draft','sent')`
- Ensures RLS enabled with `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`

## Patch B — create-quotation-email-draft Edge Function ✅
- New function: `supabase/functions/create-quotation-email-draft/index.ts`
- Auth via `requireUser(req)` (project standard verify_jwt=false)
- Defensive body parse with try/catch + validation case_id/version_id non-empty strings
- Reads `quotation_versions` via userClient (RLS) with `.eq("id", versionId).eq("case_id", caseId)`
- Idempotence: checks existing draft with `quotation_version_id=versionId AND status IN ('draft','sent')`
- Insert via serviceClient with `created_by = user.id`
- Fallback on unique constraint violation (error.code === "23505"): re-select existing draft
- Extracts client email from `snapshot.client.email` for `to_addresses`

## Patch C — UI SendQuotationPanel "Générer brouillon" ✅
- When `selectedVersion` exists but `ownerDraft` is null: shows "Générer un brouillon" button
- Invokes `create-quotation-email-draft` with `{ case_id, version_id }`
- Local `isGenerating` state for loading spinner
- On success: invalidates `['send-quotation-data', caseId]` query + toast
- Existing send flow and `canSend` guard unchanged
