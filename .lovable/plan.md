

# Phase M3.3.1 — Fact extraction debug + form population from quote_facts

## Diagnostic

Investigation complete. Two distinct issues identified:

### Issue 1: "Extraction des faits partiellement echouee" toast (false alarm)

The toast fires at line 391-393 of `QuotationSheet.tsx`:
```
if (puzzleError) {
  toast.warning('Extraction des faits partiellement échouée');
}
```

However, the `supabase.functions.invoke` method sets `error` when the HTTP response is non-2xx. The edge function returns status **207** (Multi-Status) when there are partial fact errors. But in reality, the current case has **zero errors** -- all 7 facts were successfully stored. The toast was from a previous invocation attempt.

The real problem: on subsequent clicks of "Demarrer l'analyse", the function skips `build-case-puzzle` entirely (because `factsCount > 0` at line 383), so no new extraction happens. The toast is stale/misleading.

**Fix**: Distinguish HTTP 207 from real errors. If the response has `facts_added > 0`, treat as partial success, not failure.

### Issue 2: Form fields not populated (the REAL problem)

The form fields (Demandeur, Societe, Port de destination, Marchandises, etc.) are populated by `applyConsolidatedData()` which reads from **email text parsing** (`consolidateThreadData`). This is pattern-matching on email body text -- it does NOT read from `quote_facts`.

Meanwhile, `quote_facts` contains correctly extracted data:

| fact_key | value |
|---|---|
| contacts.client_email | bilal@aboudisa.com |
| contacts.client_company | ABOUDI Logistics Services Co. |
| routing.origin_port | Dammam |
| routing.destination_port | Dakar |
| routing.destination_city | Bamako |
| cargo.description | Fortuner (Vehicle), Pickup (Vehicle) |
| cargo.containers | [{type: "40'", quantity: 2}] |

But the form shows empty fields because `consolidateThreadData()` fails to parse this particular email's format (MIME-encoded, plain text with headers).

**Fix**: After `applyConsolidatedData`, overlay any missing fields with data from `quote_facts` if a quote_case exists.

## Solution

### File 1: `src/pages/QuotationSheet.tsx`

**Change A** -- Fix the 207 toast handling (lines 387-397):

```text
Before:
  if (puzzleError) {
    toast.warning('Extraction des faits partiellement échouée');
  } else {
    toast.success('...');
  }

After:
  if (puzzleError) {
    // Check if it's a 207 partial success (facts were added despite some errors)
    const isPartialSuccess = puzzleData?.facts_added > 0;
    if (isPartialSuccess) {
      toast.info(`Extraction partielle: ${puzzleData.facts_added} faits extraits`);
    } else {
      toast.warning('Extraction des faits échouée');
    }
  } else {
    toast.success(`Extraction terminée: ${puzzleData?.facts_added || 0} faits`);
  }
```

**Change B** -- Add a new function `applyFactsToForm()` that reads `quote_facts` and fills empty form fields:

After `applyConsolidatedData` completes (and after `useQuoteCaseData` returns data), overlay empty fields:

```text
function applyFactsToForm():
  1. Query quote_facts for the case_id (via useQuoteCaseData or direct query)
  2. For each fact_key, if the corresponding form field is still empty/default:
     - contacts.client_email -> projectContext.requesting_party (extract name from email)
     - contacts.client_company -> projectContext.requesting_company
     - routing.destination_port -> destination
     - routing.destination_city -> finalDestination
     - routing.origin_port -> (not directly shown, but useful for context)
     - cargo.description -> cargoLines[0].description
     - cargo.containers -> cargoLines (create lines from container data)
```

### File 2: `src/hooks/useQuoteCaseData.ts`

**Change C** -- Expose the facts array (currently only exposes `factsCount` and `blockingGaps`):

Add a `facts` field to the return value so `QuotationSheet` can read the actual fact values.

## Implementation detail

The fact overlay will use a `useEffect` that watches `quoteCase` and `facts`:

```text
useEffect(() => {
  if (!facts || facts.length === 0) return;

  const factsMap = new Map(facts.map(f => [f.fact_key, f]));

  // Only fill if form field is empty/default
  if (!projectContext.requesting_party && factsMap.has('contacts.client_email')) {
    // Extract name from email or use company
    const company = factsMap.get('contacts.client_company')?.value_text;
    if (company) setProjectContext(prev => ({...prev, requesting_company: company}));
  }

  if (destination === 'Dakar' && factsMap.has('routing.destination_port')) {
    setDestination(factsMap.get('routing.destination_port').value_text);
  }

  if (!finalDestination && factsMap.has('routing.destination_city')) {
    setFinalDestination(factsMap.get('routing.destination_city').value_text);
  }

  if (cargoLines.length === 0 && factsMap.has('cargo.containers')) {
    const containers = factsMap.get('cargo.containers').value_json;
    // Create cargo lines from container facts
  }
}, [facts]);
```

## Files modified

| File | Change |
|---|---|
| `src/hooks/useQuoteCaseData.ts` | Expose `facts` array in return value |
| `src/pages/QuotationSheet.tsx` | Fix 207 toast + add `applyFactsToForm` overlay |

## What does NOT change

- No edge function modifications
- No database migration
- No new tables
- No UI component changes
- The existing email text parsing continues to work as before; facts just fill any gaps it misses

## Risk

Low -- facts overlay only fills empty/default fields, never overwrites user input.

