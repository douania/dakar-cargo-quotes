

# P5.4b — Root Cause Found: Edge Function Not Deployed

## Diagnosis

The edge function logs show the **exact error**:

```
ReferenceError: inferCoveredServiceDiagnostics is not defined
```

This means the **old version** of `run-pricing` is still running in production. The P5.4b code changes (adding `inferCoveredServiceDiagnostics`, `normalizePricingText`, description fallbacks) were written to the file but **never deployed**.

Because the enrichment code calls `inferCoveredServiceDiagnostics` (which doesn't exist in the deployed version), the entire P5 enrichment block crashes silently (caught by the `try/catch` at line 797), and **all** P5 service lines (PICKUP_ORIGIN, PRE_CARRIAGE, AIR_FREIGHT, AIR_HANDLING, TRUCKING, etc.) are lost.

## Fix

**Redeploy the `run-pricing` edge function.** No code changes needed — the file already contains the correct P5.4b logic.

## Expected Result After Deploy + Rerun

- Engine lines preserved: Dédouanement, Suivi, Administratif, Magasinage, Droits & Taxes
- P5 enriched lines restored: PICKUP_ORIGIN, PRE_CARRIAGE, AIR_FREIGHT, AIR_HANDLING, TRUCKING
- AGENCY and CUSTOMS_DAKAR correctly deduplicated (covered by engine lines)

