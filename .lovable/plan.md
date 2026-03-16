

# Fix: Enriched service lines not showing in UI

## Problem
The P5.1 backend fix correctly sets `category` and `label` on enriched lines, but the `PricingResultPanel` UI component reads different field names:
- **Service column**: `line.service_code || line.charge_code || \`L\${idx+1}\``
- **Description column**: `line.description || line.charge_name || ''`

The enriched lines have `category` and `label` — neither is in the fallback chain, so lines L7-L13 show blank descriptions.

## Fix
In `src/components/puzzle/PricingResultPanel.tsx`, add `category` and `label` as fallbacks in **both** the multi-lot table (around L224-240) and mono-lot table (around L290-306):

**Service column** — change:
```
line.service_code || line.charge_code || `L${idx + 1}`
```
to:
```
line.service_code || line.charge_code || line.category || `L${idx + 1}`
```

**Description column** — change:
```
line.description || line.charge_name || ''
```
to:
```
line.description || line.charge_name || line.label || ''
```

This applies to 4 locations total (2 per table × 2 tables).

### Files modified
- `src/components/puzzle/PricingResultPanel.tsx`

