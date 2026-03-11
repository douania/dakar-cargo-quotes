

# Post-S3 — Doc fix + Legacy audit plan

## 1. Doc fix: `docs/MASTER_CONTEXT.md` header

Current line 3: `Phase: C2 — Conversation Engine`

Replace with:
```
Phase: C2 — Conversation Engine
Latest patch: S3 — Decision Workflow Repair
```

This preserves the macro phase identity while reflecting the latest structural patch.

## 2. Post-S3 audit scope

Query the database for cases currently in `READY_TO_PRICE` to assess legacy exposure, then verify the decision workflow end-to-end by inspecting the runtime path through `commit-decision` and `ack-pricing-ready`.

### Audit steps:

**A. Legacy cases count** — Run a read query to count cases in `READY_TO_PRICE` status. This determines if a backfill/rebuild strategy is needed.

**B. Decision workflow path verification** — Read key lines in `commit-decision` and `ack-pricing-ready` to confirm they correctly handle the new `DECISIONS_PENDING` flow without regression.

**C. UI path verification** — Check `QuotationSheet.tsx` and `DecisionSupportPanel.tsx` to confirm the decision UI renders correctly for `DECISIONS_PENDING` status.

### Deliverable

A short audit summary with:
- Count of legacy `READY_TO_PRICE` cases
- Confirmed non-regression on `commit-decision` / `ack-pricing-ready`
- UI rendering confirmation for `DECISIONS_PENDING`
- Recommendation: backfill needed or not

## Files modified

- `docs/MASTER_CONTEXT.md` — line 3 only (add latest patch reference)

## Confirmations

- No FROZEN module touched
- No migration
- No business logic change
- Audit is read-only

