

# P3.B — Candidate Response Matching v1

## Scope

2 files: 1 new utility, 1 modified component. No backend, no migration, no FROZEN files.

## Changes

### 1. Create `src/features/external-requests/utils/suggestPartnerResponse.ts`

Pure scoring function with these inputs:
- `request`: `{ partner_name, partner_email, sent_at, purpose, purpose_detail }`
- `threadEmails`: `{ id, subject, from_address, received_at }[]`
- `usedEmailIds`: `string[]` — derived from ALL `responses` for the case (not per-request)

Scoring rules:
- `from_address === partner_email` → +70
- `from_address` contains normalized `partner_name` fragment → +25
- `received_at >= sent_at` → +15
- Subject contains `re:`, `fw:`, `fwd:` → +5
- Subject shares keyword with `purpose`/`purpose_detail` → +10
- Exclude emails in `usedEmailIds`
- Exclude emails with `received_at < sent_at`

Output: `{ bestEmailId: string | null, score: number, confidence: "high"|"medium"|"low"|"none", reasons: string[] }`

Thresholds: ≥70 high, ≥40 medium, ≥20 low, else none.

### 2. Modify `src/components/puzzle/ExternalRequestsPanel.tsx`

**Import** `suggestPartnerResponse`.

**Derive `usedEmailIds`** once before the map (line ~259):
```typescript
const usedEmailIds = responses.map(r => r.source_email_id).filter(Boolean) as string[];
```

**Inside `requests.map()`** (after line 269, nextAction computation) — for `sent`/`response_received` requests:
```typescript
const suggestion = suggestPartnerResponse(req, threadEmails, usedEmailIds);
```

**Select value** (line 375) — derive without writing to state:
```typescript
value={
  analysisTarget?.requestId === req.id
    ? analysisTarget.emailId
    : (suggestion?.bestEmailId ?? "")
}
```

The `onValueChange` and `Analyser` button logic remain unchanged — manual selection writes to `analysisTarget` which then takes priority.

**Analyser button disabled** (line 392-394) — also accept suggestion as valid selection:
```typescript
disabled={
  triggerAnalysis.isPending ||
  !(analysisTarget?.requestId === req.id
    ? analysisTarget.emailId
    : suggestion?.bestEmailId)
}
```

**Analyser button onClick** (line 395-402) — use derived value:
```typescript
const emailToAnalyze = analysisTarget?.requestId === req.id
  ? analysisTarget.emailId
  : suggestion?.bestEmailId;
if (emailToAnalyze) {
  triggerAnalysis.mutate(
    { request_id: req.id, email_id: emailToAnalyze },
    { onSuccess: () => setAnalysisTarget(null) }
  );
}
```

**Mark suggested email** in SelectContent — append `★ Suggéré` to the suggested option label.

**Add suggestion badge** after the Select (before Analyser button) when confidence ≥ low:
- Small badge: `Suggestion forte` / `moyenne` / `faible`
- 1-2 reasons in `text-xs text-muted-foreground`

## What does NOT change

- No edge functions, no migrations, no FROZEN files
- `useExternalRequests.ts` untouched
- `triggerAnalysis` call structure unchanged — still manual only
- `analysisTarget` state shape unchanged
- No suggestion written into state

## File summary

| File | Action |
|------|--------|
| `src/features/external-requests/utils/suggestPartnerResponse.ts` | Create |
| `src/components/puzzle/ExternalRequestsPanel.tsx` | Import + derived Select value + badge |

