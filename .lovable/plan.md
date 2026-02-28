
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
