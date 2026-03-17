

# Phase EQ1.2-ter — Disable "Analyser la demande" when no thread linked

## Problem
The button "Analyser la demande" calls `analyze-service-scope`, which returns 404 when the `quote_case` has no `thread_id`. This causes a confusing error toast for the user.

## Fix
**Single file**: `src/pages/CaseView.tsx`, line 1922

Add `!caseData?.thread_id` to the `disabled` condition:

```tsx
disabled={isServiceScopeAnalyzing || !caseId || !caseData?.thread_id}
```

`caseData` is already available in scope and `thread_id` is already used elsewhere in the component. No other changes needed.

