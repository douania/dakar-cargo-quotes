

# P5.4 — Deduplication by engine category group

## Problem confirmed

The `quotation-engine` produces these categories for honoraires lines:

| Engine line | `category` field | P5 service key equivalent |
|---|---|---|
| Honoraires de dédouanement | `Dédouanement` | `CUSTOMS_DAKAR` |
| Suivi opérationnel | `Suivi` | `AGENCY` |
| Ouverture de dossier | `Administratif` | `AGENCY` |
| Frais de documentation | `Administratif` | `AGENCY` |

P5.3 already maps `'Dédouanement' → CUSTOMS_DAKAR` (this should work for that pair). But `'Suivi'` and `'Administratif'` are unmapped, so P5 injects `AGENCY` as a duplicate of the 3 fine-grained engine lines.

## Fix — single constant update

**File:** `supabase/functions/run-pricing/index.ts`, lines 106-112

Expand the mapping:

```typescript
const ENGINE_CATEGORY_TO_SERVICE_KEY: Record<string, string> = {
  'DTHC': 'DTHC',
  'Retour conteneur vide': 'EMPTY_RETURN',
  'Dédouanement': 'CUSTOMS_DAKAR',
  'Transport': 'TRUCKING',
  'Transport Mali': 'TRUCKING',
  // P5.4: Agency sub-components
  'Suivi': 'AGENCY',
  'Administratif': 'AGENCY',
};
```

No other file changes needed. The existing `inferCoveredServiceKeys()` logic handles multiple categories mapping to the same service key — as soon as one engine line with `category: 'Suivi'` is found, `AGENCY` is added to the covered set and skipped by P5 enrichment.

## Expected result after rerun

- `CUSTOMS_DAKAR` line disappears (already covered by P5.3 `'Dédouanement'` mapping)
- `AGENCY` line disappears (now covered by `'Suivi'` and `'Administratif'` mappings)
- Fine-grained engine lines (Suivi opérationnel, Ouverture dossier, Frais documentation) are preserved
- All other P5 lines (PICKUP_ORIGIN, PRE_CARRIAGE, SEA_FREIGHT, PORT_DAKAR_HANDLING, TRUCKING) remain

## Risk

Zero — purely additive to the dedup constant. No logic change. No FROZEN zone touched.

