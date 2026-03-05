

## Plan — 4 Patchs P0 (3 fichiers, 0 migration, 0 RLS)

### PATCH 0 — Fix TDZ `gapsIdentified` ✅ DÉJÀ FAIT
Ligne 1657 : `let gapsIdentified = 0;` déclarée early. Ligne 2941 : commentaire. Rien à faire.

---

### PATCH 1 — Gate pricing UI + backend alignés sur ACK (2 fichiers)

**1A) `src/pages/CaseView.tsx` — ligne 1687**

```text
AVANT:  {caseData.status === 'READY_TO_PRICE' && (
APRÈS:  {caseData.status === 'ACK_READY_FOR_PRICING' && (
```

**1B) `supabase/functions/run-pricing/index.ts` — lignes 112-119**

Retirer `"READY_TO_PRICE"` du tableau `pricingAllowedStatuses` :
```typescript
const pricingAllowedStatuses = [
  "ACK_READY_FOR_PRICING",
  "PRICED_DRAFT",
  "HUMAN_REVIEW",
  "QUOTED_VERSIONED",
  "SENT",
];
```

---

### PATCH 2 — `scope_debug` dans réponses "blocked" (1 fichier)

**`supabase/functions/run-pricing/index.ts`** — 3 retours bloquants à enrichir :

**HS blocker (ligne 219-224)** : ajouter `scope_debug` dans le JSON de retour :
```typescript
JSON.stringify({
  pricing_blockers: blockerOutputs.pricing_blockers,
  message: blockerOutputs.message,
  run_number: blockerRunNumber || 1,
  scope_debug: { servicePackage: pkg, incoterm: incotermEarly, scopeWantsDuties },
})
```

**Regime blocker (ligne 273-278)** : même ajout `scope_debug`.

**FOB freight blocker (ligne 367-372)** : même ajout `scope_debug`.

---

### PATCH 3 — Final sync Facts → Gaps (1 fichier)

**`supabase/functions/build-case-puzzle/index.ts`** — Insérer avant la section "11. Calculate completeness" (avant ligne 3288).

Logique :
1. Charger tous les gaps `status = 'open'` du dossier
2. Pour chaque gap, chercher un fact `is_current = true` correspondant au `gap_key`
3. Valider le fact selon son type :
   - `cargo.hs_code` : `value_text` match `/^\d{10}$/`
   - `cargo.freight_cost` : `value_number > 0`
   - Tout autre : `value_text?.trim().length > 0` OU `value_number != null`
4. Si valide → update gap `status = 'resolved'`, `resolved_at = now()` + timeline `gap_resolved` avec `{ gap_key, reason: "final_sync", phase: "final" }`
5. Compteur `gapsSyncResolved` pour log

```text
Pseudocode:
const { data: openGaps } = await serviceClient.from("quote_gaps")
  .select("id, gap_key, status").eq("case_id", case_id).eq("status", "open");

// existingDbFacts already loaded above (line 2944)
const factsMap = new Map(existingDbFacts.map(f => [f.fact_key, f]));
let gapsSyncResolved = 0;

for (const gap of openGaps) {
  const fact = factsMap.get(gap.gap_key);
  if (!fact) continue;
  
  let isValid = false;
  if (gap.gap_key === "cargo.hs_code") {
    isValid = /^\d{10}$/.test(String(fact.value_text ?? "").trim());
  } else if (gap.gap_key === "cargo.freight_cost") {
    isValid = fact.value_number != null && fact.value_number > 0;
  } else {
    isValid = (fact.value_text?.trim().length > 0) || (fact.value_number != null);
  }
  
  if (isValid) {
    await serviceClient.from("quote_gaps")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("id", gap.id);
    await serviceClient.from("case_timeline_events").insert({
      case_id, event_type: "gap_resolved",
      event_data: { gap_key: gap.gap_key, reason: "final_sync", phase: "final" },
      related_gap_id: gap.id, actor_type: "system",
    });
    gapsSyncResolved++;
  }
}
if (gapsSyncResolved > 0) {
  console.log(`[FinalSync] Resolved ${gapsSyncResolved} phantom gaps for case ${case_id}`);
}
```

---

### Résumé des impacts

| Fichier | Changements |
|---------|------------|
| `CaseView.tsx` | 1 ligne (condition gate) |
| `run-pricing/index.ts` | 1 ligne supprimée + 3x `scope_debug` ajouté |
| `build-case-puzzle/index.ts` | ~30 lignes (bloc final sync) |
| Migration DB | 0 |
| RLS | 0 |

