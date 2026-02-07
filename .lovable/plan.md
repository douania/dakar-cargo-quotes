

# Phase S0 -- Securisation Edge Functions (P0 Hotfix) -- FINAL VALIDE

## Corrections CTO integrees

### Correction #1 -- Ordre d'execution
S0-4 (unifier les 4 fonctions faussement securisees) remonte AVANT les lots P0-A a P0-D. Ces fonctions critiques (pricing, draft, generation) ne doivent pas rester en etat "auth ambigu" pendant que les lots INSECURE sont patches.

### Correction #2 -- config.toml : exception formelle Phase S0
Modification minimale de `supabase/config.toml` strictement pour declarer `quotation-engine` en `verify_jwt = false`, car le signing ES256 de Lovable Cloud rend `verify_jwt = true` non fonctionnel. Cette modification est une condition d'appel, pas un refactor. Actee comme exception Phase S0.

### Correction #3 -- requireUser : client anon standard + token explicite
`requireUser` cree un client anon **standard** (sans passer le header Authorization au constructeur). La source de verite est le `token` passe explicitement a `auth.getUser(token)`. Cela reduit la surface d'erreur "header vs token" dans le contexte ES256.

---

## Fichier cree : `supabase/functions/_shared/auth.ts`

### `requireUser(req)`
1. Extrait `Authorization: Bearer <token>` du header
2. Si absent : retourne Response 401 + corsHeaders + `{ error: "Missing authorization header" }`
3. Cree un client anon **standard** (sans header Authorization)
4. Appelle `auth.getUser(token)` avec token explicite
5. Si erreur ou pas de user : retourne Response 401 + corsHeaders + `{ error: "Invalid or expired token" }`
6. Retourne `{ user, token }`

### `requireAdmin(req)`
1. Appelle `requireUser(req)` -- si Response, retourner directement
2. Charge `ADMIN_EMAIL_ALLOWLIST` depuis `Deno.env.get()`
3. Parse (split virgule, trim, lowercase)
4. Si `user.email` absent de la liste : retourne Response 403 + corsHeaders + `{ error: "Forbidden: admin access required" }`
5. Retourne `{ user, token }`

---

## Fonctions a patcher (38 total)

### 4 fonctions faussement securisees (S0-4, executees en premier)

| Fonction | Correction |
|---|---|
| price-service-lines | Remplacer auth inline par `requireUser(req)` |
| create-quotation-draft | Remplacer auth inline par `requireUser(req)` |
| generate-quotation | Remplacer auth inline par `requireUser(req)` |
| generate-response | Remplacer auth inline par `requireUser(req)` |

### Lot P0-A -- Admin / Email / Data (7 fonctions)

| Fonction | Guard |
|---|---|
| email-admin | `requireAdmin` -- service-role APRES guard |
| data-admin | `requireAdmin` -- service-role APRES guard |
| sync-emails | `requireUser` |
| search-emails | `requireUser` |
| import-thread | `requireUser` |
| force-download-attachment | `requireUser` |
| analyze-attachments | `requireUser` |

### Lot P0-B -- IA / Scraping (5 fonctions)

| Fonction | Guard | Rate limit |
|---|---|---|
| chat | `requireUser` | 30 req/min |
| firecrawl-search | `requireUser` | 20 req/min |
| firecrawl-scrape | `requireUser` | 20 req/min |
| firecrawl-map | `requireUser` | 20 req/min |
| market-surveillance | `requireUser` | -- |

### Lot P0-C -- Documents / Learning (8 fonctions)

| Fonction | Guard |
|---|---|
| parse-document | `requireUser` |
| analyze-document | `requireUser` |
| learn-from-content | `requireUser` |
| extract-pdf-descriptions | `requireUser` |
| learn-from-expert | `requireUser` |
| learn-from-contact | `requireUser` |
| learn-quotation-puzzle | `requireUser` (supprime mode anonyme null) |
| analyze-tender | `requireUser` |

### Lot P0-D -- Calcul / Generation (15 fonctions)

| Fonction | Guard |
|---|---|
| import-hs-codes | `requireUser` |
| hs-lookup | `requireUser` |
| calculate-duties | `requireUser` |
| suggest-regime | `requireUser` |
| analyze-pricing-patterns | `requireUser` |
| audit-coherence | `requireUser` |
| arbitrage-incoterm | `requireUser` |
| analyze-risks | `requireUser` |
| generate-quotation-attachment | `requireUser` |
| suggest-hs-codes | `requireUser` |
| parse-packing-list | `requireUser` |
| truck-optimization-proxy | `requireUser` |
| reclassify-threads | `requireUser` |
| generate-excel-quotation | `requireUser` |
| quotation-engine | `requireUser` |

---

## Rate limiting

Ajout dans `DEFAULT_RATE_LIMITS` de `_shared/runtime.ts` :

```text
'chat': { limit: 30, windowSeconds: 60 }
'firecrawl-search': { limit: 20, windowSeconds: 60 }
'firecrawl-scrape': { limit: 20, windowSeconds: 60 }
'firecrawl-map': { limit: 20, windowSeconds: 60 }
```

Cle de bucket : `user.id` + `functionName` + fenetre 60s (deja gere par `upsert_rate_limit_bucket`).

---

## Ordre d'execution final

1. Demander le secret `ADMIN_EMAIL_ALLOWLIST`
2. Creer `supabase/functions/_shared/auth.ts`
3. Ajouter `quotation-engine` dans `config.toml` (exception S0)
4. Mettre a jour `DEFAULT_RATE_LIMITS` dans `_shared/runtime.ts`
5. **S0-4 : Unifier les 4 fonctions faussement securisees**
6. Lot P0-A (7 fonctions admin/email)
7. Lot P0-B (5 fonctions IA/scraping + rate limit)
8. Lot P0-C (8 fonctions documents/learning)
9. Lot P0-D (15 fonctions calcul/generation)
10. Deployer toutes les fonctions modifiees

## Ce qui ne change pas

- Aucune logique metier
- Aucun schema DB
- Les 15 fonctions deja securisees ne sont pas touchees
- `healthz` reste public

## Bilan

- 1 secret : `ADMIN_EMAIL_ALLOWLIST`
- 1 fichier cree : `_shared/auth.ts`
- 1 fichier modifie : `config.toml` (exception S0)
- 1 fichier modifie : `_shared/runtime.ts` (rate limits)
- 38 fichiers patches (guard en debut de handler)
- Total : **41 fichiers**

## Tests de validation

| Test | Appel | Attendu |
|---|---|---|
| Sans JWT | `chat` | 401 |
| Sans JWT | `email-admin` | 401 |
| Sans JWT | `build-case-puzzle` | 401 (deja secure) |
| Sans JWT | `search-emails` | 401 |
| Sans JWT | `quotation-engine` | 401 |
| JWT user normal | `build-case-puzzle` | 200 |
| JWT user normal | `email-admin` | 403 |
| JWT user normal | `chat` | 200 |
| JWT user normal | `price-service-lines` | 200 |
| JWT admin | `email-admin` | 200 |
| JWT admin | `data-admin` | 200 |
| Rate limit | `chat` x31 en 1min | 429 |
| Rate limit | `firecrawl-search` x21 en 1min | 429 |

