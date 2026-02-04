

# PLAN D'IMPLEMENTATION PHASE 11

## Modification run-pricing : ACK_READY_FOR_PRICING au lieu de READY_TO_PRICE

---

## 1. CONTEXTE

La Phase 10 a introduit le statut `ACK_READY_FOR_PRICING` comme gate obligatoire avant le pricing.
L'Edge Function `run-pricing` doit maintenant accepter ce nouveau statut.

### Statut actuel (incorrect)

| Ligne | Code actuel | Problème |
|-------|-------------|----------|
| 104 | `caseData.status !== "READY_TO_PRICE"` | Ancien statut |
| 109 | `required_status: "READY_TO_PRICE"` | Message d'erreur incorrect |
| 147-148 | `previous_value: "READY_TO_PRICE"` | Timeline incorrecte |
| 161, 187, 216 | Rollback vers `"READY_TO_PRICE"` | Rollback vers mauvais statut |

---

## 2. MODIFICATIONS REQUISES

### 2.1 Header de version (lignes 1-5)

```text
AVANT:
/**
 * Phase 7.0.4-fix: run-pricing
 * ...
 */

APRES:
/**
 * Phase 11: run-pricing
 * Executes deterministic pricing via quotation-engine
 * CTO Update: Now requires ACK_READY_FOR_PRICING status (Phase 10 gate)
 * CTO Fixes: Atomic run_number, Status rollback compensation, Blocking gaps guard
 */
```

### 2.2 Verification de statut (lignes 104-113)

```typescript
AVANT:
if (caseData.status !== "READY_TO_PRICE") {
  return new Response(
    JSON.stringify({ 
      error: "Case not ready for pricing",
      current_status: caseData.status,
      required_status: "READY_TO_PRICE"
    }),
    { status: 400, ... }
  );
}

APRES:
if (caseData.status !== "ACK_READY_FOR_PRICING") {
  return new Response(
    JSON.stringify({ 
      error: "Case not ready for pricing",
      current_status: caseData.status,
      required_status: "ACK_READY_FOR_PRICING"
    }),
    { status: 400, ... }
  );
}
```

### 2.3 Timeline event transition (lignes 144-150)

```typescript
AVANT:
await serviceClient.from("case_timeline_events").insert({
  case_id,
  event_type: "status_changed",
  previous_value: "READY_TO_PRICE",
  new_value: "PRICING_RUNNING",
  actor_type: "system",
});

APRES:
await serviceClient.from("case_timeline_events").insert({
  case_id,
  event_type: "status_changed",
  previous_value: "ACK_READY_FOR_PRICING",
  new_value: "PRICING_RUNNING",
  actor_type: "system",
});
```

### 2.4 Rollback status (lignes 159-163)

```typescript
AVANT:
await rollbackToPreviousStatus(serviceClient, case_id, "READY_TO_PRICE", "facts_load_failed");

APRES:
await rollbackToPreviousStatus(serviceClient, case_id, "ACK_READY_FOR_PRICING", "facts_load_failed");
```

### 2.5 Rollback status RPC error (lignes 185-189)

```typescript
AVANT:
await rollbackToPreviousStatus(serviceClient, case_id, "READY_TO_PRICE", "run_number_failed");

APRES:
await rollbackToPreviousStatus(serviceClient, case_id, "ACK_READY_FOR_PRICING", "run_number_failed");
```

### 2.6 Rollback status insert error (ligne 216)

```typescript
AVANT:
await rollbackToPreviousStatus(serviceClient, case_id, "READY_TO_PRICE", "run_insert_failed");

APRES:
await rollbackToPreviousStatus(serviceClient, case_id, "ACK_READY_FOR_PRICING", "run_insert_failed");
```

---

## 3. FICHIER A MODIFIER

| Fichier | Modifications |
|---------|---------------|
| `supabase/functions/run-pricing/index.ts` | 6 modifications ciblées |

---

## 4. FLUX APRES MODIFICATION

```text
Phase 10 (ack-pricing-ready)
         |
         v
quote_cases.status = ACK_READY_FOR_PRICING
         |
         v
Phase 11 (run-pricing)
         |
         +-- Verification: status === ACK_READY_FOR_PRICING
         |
         +-- Transition: ACK_READY_FOR_PRICING -> PRICING_RUNNING
         |
         +-- [Si erreur] Rollback: -> ACK_READY_FOR_PRICING
         |
         +-- [Si succes] Transition: PRICING_RUNNING -> PRICED_DRAFT
```

---

## 5. CONFORMITE CTO

| Regle | Application |
|-------|-------------|
| Gate Phase 10 requis | ACK_READY_FOR_PRICING obligatoire |
| Timeline coherente | previous_value correct |
| Rollback coherent | Retour vers ACK_READY_FOR_PRICING |
| Pas de breaking change | Workflow preserve |
| Audit trail | Events timeline corrects |

---

## 6. TESTS POST-MODIFICATION

| Test | Resultat attendu |
|------|------------------|
| Appel avec status DECISIONS_COMPLETE | 400 - required ACK_READY_FOR_PRICING |
| Appel avec status ACK_READY_FOR_PRICING | 200 - Pricing execute |
| Erreur facts_load | Rollback vers ACK_READY_FOR_PRICING |
| Timeline event | previous_value = ACK_READY_FOR_PRICING |

---

## 7. CE QUI NE CHANGE PAS

- Logique de pricing (quotation-engine)
- Guard gaps bloquants
- Atomic run_number RPC
- Compensation sur erreur
- Transition finale vers PRICED_DRAFT

---

**Modification simple, ciblée, sans impact structurel.**

