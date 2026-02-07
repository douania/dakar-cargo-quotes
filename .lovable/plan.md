
# Phase M2.1 — Import historique reel des cotations (corrections CTO appliquees)

## Corrections CTO integrees

### Correction 1 — Securite Edge Function

`verify_jwt = false` dans config.toml (JWT valide explicitement dans le code via `getClaims()`). Ce choix preserve la tracabilite complete via le runtime contract (correlationId, logRuntimeEvent, taxonomie d'erreurs). Coherent avec `commit-decision` et les autres fonctions sensibles.

### Correction 2 — Transaction atomique via RPC SQL

L'insertion des 3 tables se fait via une fonction RPC `insert_historical_quotation_atomic` qui execute tout dans une seule transaction PostgreSQL. Si une insertion echoue, tout est rollback automatiquement.

---

## Etape 1 — Migration SQL

### 1a. Tables (identiques au plan initial)

- `historical_quotations` : cotation principale (source, client, route, cargo, valeur)
- `historical_quotation_lines` : lignes tarifaires avec FK CASCADE
- `historical_quotation_metadata` : metadonnees avec FK CASCADE

### 1b. RLS

- RLS active sur les 3 tables
- SELECT : public read (`true`)
- INSERT/UPDATE/DELETE : aucune policy client (service role uniquement)

### 1c. Fonction RPC transactionnelle

```text
insert_historical_quotation_atomic(
  p_quotation jsonb,
  p_lines jsonb,
  p_metadata jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
```

Logique :
1. INSERT dans `historical_quotations` -> recupere `v_quotation_id`
2. Pour chaque element de `p_lines` : INSERT dans `historical_quotation_lines` avec `quotation_id = v_quotation_id`
3. Si `p_metadata` est non-null : INSERT dans `historical_quotation_metadata` avec `quotation_id = v_quotation_id`
4. Si erreur a n'importe quelle etape : rollback automatique (comportement natif PL/pgSQL)
5. RETURN `v_quotation_id`

Acces : `REVOKE ALL ON FUNCTION ... FROM PUBLIC; GRANT EXECUTE ON FUNCTION ... TO service_role;`

---

## Etape 2 — Edge Function

Fichier : `supabase/functions/import-historical-quotation/index.ts`

Config.toml :
```text
[functions.import-historical-quotation]
verify_jwt = true
```

Pattern d'authentification (identique a `commit-decision`) :
1. Extraire `Authorization` header
2. Creer `userClient` avec le token
3. Appeler `getUser()` pour valider le JWT
4. Utiliser `serviceClient` (service_role) pour appeler la RPC

Logique :
1. Valider le JWT (AUTH_MISSING_JWT / AUTH_INVALID_JWT si echec)
2. Valider l'entree (VALIDATION_FAILED si `source_type` ou `destination_country` manquant)
3. Appeler la RPC `insert_historical_quotation_atomic` via `serviceClient.rpc(...)`
4. Retourner `respondOk` avec l'ID et le nombre de lignes
5. `logRuntimeEvent` avant chaque return

Runtime Contract respecte : correlationId, respondOk/respondError, logRuntimeEvent, taxonomie d'erreurs standard.

---

## Etape 3 — Test

Appel via curl avec JWT valide + JSON de test :
```text
{
  "quotation": { "source_type": "manual", "client_name": "Test Client", ... },
  "lines": [{ "bloc": "debours", "category": "THC", "amount": 110000, ... }],
  "metadata": { "hs_code": "870899", "carrier": "MSC", ... }
}
```

Verifications :
1. Insertion OK (3 tables)
2. FK coherentes
3. Suppression cascade
4. Rejet si JWT absent (401)
5. Rejet si champs obligatoires manquants (400)

---

## Fichiers crees/modifies

| Fichier | Action |
|---------|--------|
| Migration SQL | 3 tables + RLS + RPC `insert_historical_quotation_atomic` |
| `supabase/functions/import-historical-quotation/index.ts` | Nouveau |
| `supabase/config.toml` | Ajout `[functions.import-historical-quotation] verify_jwt = true` |

## Fichiers NON modifies

- Zero fichier UI
- Zero modification moteur quotation-engine
- Zero modification API existante

## Verification post-execution

1. 3 tables creees avec RLS active
2. RPC `insert_historical_quotation_atomic` presente, acces restreint a `service_role`
3. Edge Function deployee sans erreur
4. Test curl avec JWT : insertion transactionnelle OK
5. Test curl sans JWT : rejet 401
6. Test cascade : suppression quotation supprime lines + metadata
