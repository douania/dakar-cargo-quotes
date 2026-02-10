

# Phase SET-CASE-FACT + Tests E2E B/C

## Resume

Creation d'une edge function minimale `set-case-fact` qui encapsule le RPC `supersede_fact` existant, avec whitelist stricte de fact_keys. Puis execution sequentielle des tests E2E pour valider V3.2.

## 1. Nouvelle Edge Function : `set-case-fact/index.ts`

### Specification

- **Auth** : `requireUser(req)` (pattern standard)
- **Runtime** : `getCorrelationId`, `respondOk`, `respondError`, `logRuntimeEvent`
- **Body** :
  ```json
  {
    "case_id": "uuid",
    "fact_key": "client.code",
    "value_text": "AI0CARGO",
    "value_number": null
  }
  ```

### Logique

1. CORS preflight
2. `requireUser(req)` -- auth obligatoire
3. Validation body : `case_id` (uuid) + `fact_key` (string) requis
4. **Whitelist stricte** :
   ```text
   ALLOWED_FACT_KEYS = {
     "client.code",
     "cargo.caf_value",
     "cargo.weight_kg",
     "cargo.chargeable_weight_kg"
   }
   ```
   Tout autre key -> `VALIDATION_FAILED` (400)
5. Detection automatique `fact_category` depuis le prefixe :
   - `client.*` -> `contacts`
   - `cargo.*` -> `cargo`
   - fallback -> `other`
6. Verification ownership du case via client JWT (RLS)
7. Appel RPC `supersede_fact` avec :
   - `p_source_type: 'operator'`
   - `p_confidence: 1.0`
   - `p_source_excerpt: '[set-case-fact] Manual injection by operator'`
8. Log timeline event `fact_injected_manual`
9. Retour `respondOk({ fact_id })` avec correlation_id
10. `logRuntimeEvent` avant chaque retour

### Config

Ajout dans `supabase/config.toml` :
```toml
[functions.set-case-fact]
verify_jwt = false
```

## 2. Fichiers modifies

| Fichier | Changement |
|---|---|
| `supabase/functions/set-case-fact/index.ts` | Nouvelle edge function (~90 lignes) |
| `supabase/config.toml` | Ajout entry `set-case-fact` |

## 3. Ce qui ne change PAS

- `price-service-lines` (aucune modification)
- `build-case-puzzle` (aucune modification)
- `supersede_fact` RPC (deja en DB, inchange)
- Frontend (aucune modification)
- Tables existantes (aucune migration)

## 4. Execution des tests E2E apres deploiement

### Etape 1 -- Test C (fallback customs_tier)

1. Appeler `set-case-fact` :
   ```json
   { "case_id": "240167ed-8674-44e1-a27a-ff6ee75dce91", "fact_key": "cargo.caf_value", "value_number": 8000000 }
   ```
2. Appeler `price-service-lines` :
   ```json
   { "case_id": "240167ed-8674-44e1-a27a-ff6ee75dce91", "service_lines": [{ "service_code": "CUSTOMS_DAKAR", "quantity": 1 }] }
   ```
3. Resultat attendu : `rate=250000, source=customs_tier, confidence=0.90`

### Etape 2 -- Test B (override AI0CARGO)

1. Appeler `set-case-fact` :
   ```json
   { "case_id": "240167ed-8674-44e1-a27a-ff6ee75dce91", "fact_key": "client.code", "value_text": "AI0CARGO" }
   ```
2. Appeler `price-service-lines` (memes parametres)
3. Resultat attendu : `rate=200000, source=client_override, confidence=1.0`

## 5. Points CTO

- **Whitelist const** : `ALLOWED_FACT_KEYS` en `Set` immutable, refuse tout key non liste
- **Source `operator`** : priorite maximale dans la hierarchie des facts
- **Confidence 1.0** : decision explicite operateur, pas d'incertitude
- **Idempotence** : `supersede_fact` gere la supersession atomique (advisory lock)
- **Timeline** : chaque injection est tracee dans `case_timeline_events`
- **Runtime contract** : correlation_id + respondOk/respondError + logRuntimeEvent

