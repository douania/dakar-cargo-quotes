

# Phase P2 — Correct EXW Origin/Destination Mapping

## 1 file, 2 edits, 0 migrations

### Edit 1 — Prompt Rule 7 (line ~3712)

Add after Rule 6 in the `CRITICAL RULES` block:

```
7. INCOTERM LOCATION SEMANTICS (CRITICAL):
   - EXW, FCA, FAS: the location next to the incoterm is the PICKUP / ORIGIN, NOT the destination.
     - If clearly a port → routing.origin_port
     - If clearly an airport → routing.origin_airport
     - If neither (city, warehouse, industrial zone) → do NOT force it into origin_port or origin_airport.
       Simply do not extract a destination from this location.
   - DAP, DDP, CIF, CFR, CPT: the location next to the incoterm is the DESTINATION.
   - Never map an EXW/FCA/FAS location to routing.destination_city or routing.destination_port.
```

### Edit 2 — Post-extraction guard: remove false destination (before line 1773)

Instead of rekeying `destination_city → origin_port` (which would be semantically wrong for non-port locations like "Moissy Cramayel"), **remove** the misleading `destination_city` fact when it was clearly extracted from an EXW/FCA/FAS location clause.

Insert before the `for (const fact of extractedFacts)` loop at line 1773:

```typescript
// P2: Remove destination_city extracted from EXW/FCA/FAS origin location
const ORIGIN_INCOTERMS = new Set(["EXW", "FCA", "FAS"]);
const p2IncotermFact = extractedFacts.find(f => f.key === "routing.incoterm");
const p2IncotermValue = String(p2IncotermFact?.value || "").toUpperCase();

if (ORIGIN_INCOTERMS.has(p2IncotermValue)) {
  const destCityIdx = extractedFacts.findIndex(f => f.key === "routing.destination_city");
  if (destCityIdx >= 0) {
    const excerpt = String(extractedFacts[destCityIdx]?.sourceExcerpt || "").toUpperCase();
    const looksIncotermBound =
      excerpt.includes("EXW") || excerpt.includes("FCA") || excerpt.includes("FAS");

    if (looksIncotermBound) {
      console.log(`[P2] Removing destination_city "${extractedFacts[destCityIdx].value}" extracted from ${p2IncotermValue} origin location (excerpt: ${excerpt})`);
      extractedFacts.splice(destCityIdx, 1);
    }
  }
}
```

### Why this is safer than rekeying

- Does not write a false `origin_port` for non-port locations (e.g., "Moissy Cramayel")
- The system falls into a gap on `routing.destination_city`, which is correct: the destination is genuinely unknown if only an EXW pickup was stated
- Works for the SETER case even though `origin_port = Le Havre` already exists — it removes the false `destination_city` without touching the correct origin

### What does NOT change

- `build-case-puzzle` injection loop (FROZEN) — untouched
- DB schema, RLS, migrations — none
- Other edge functions — none

