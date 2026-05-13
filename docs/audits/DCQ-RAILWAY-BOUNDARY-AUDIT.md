# DCQ-RAILWAY-BOUNDARY-AUDIT

**Date** : 2026-05-13  
**Type** : Audit documentaire — read-only, aucun patch, aucune migration, aucun changement runtime.  
**Périmètre** : Cartographier toutes les dépendances Railway (`https://web-production-8afea.up.railway.app`) encore présentes dans le repo, statuer sur leur criticité, et proposer un plan de migration progressive vers Supabase Edge Functions.

---

## 1. Résumé exécutif

**Verdict CTO** : ne pas supprimer Railway aujourd'hui. Le **figer**, le **documenter**, puis **migrer l'intake en premier**. Le truck loading est un sujet séparé.

Statut global :

- **Railway intake (`createIntake`)** : ACTIF, branché sur `/intake` manuel. À migrer (Phase 2) — sans casser la chaîne `parse-document` → `ensure-quote-case` → `build-case-puzzle` déjà éprouvée.
- **Railway casefile (`fetchCaseFile`, `runWorkflow`)** : **MORT** côté `src/` (zéro consommateur). Candidats à `@deprecated` puis suppression dans un lot ultérieur (hors de cet audit).
- **Railway truck loading** : ACTIF avec **architecture proxy-first** : `truckLoadingService` (`getTruckSpecs`, `runOptimization`, `getVisualization`, `suggestFleet`) appelle d'abord `truck-optimization-proxy` (Edge Function avec `requireUser`), puis retombe en `fetch` direct Railway en cas d'échec proxy. **Hors scope** ici → audit dédié `DCQ-RAILWAY-TRUCK-LOADING-AUDIT` pour décider du devenir du fallback direct.
- **Pipeline email** (import-thread / ensure-quote-case / build-case-puzzle) : **100 % indépendant de Railway**. Aucun risque de régression côté chaîne email/quotation/pricing si Railway tombe.

Une suppression brutale de `railwayApi.ts` aujourd'hui casserait `/intake` ET tous les flux truck loading. Le chemin sûr est : geler → documenter → feature flag → migrer intake → désactiver intake Railway → supprimer après migration truck loading.

---

## 2. Cartographie des dépendances Railway

### 2.1 Inventaire des points d'appel

| Symbole | Fichier:ligne | Endpoint Railway | Consommateur réel | Type d'appel | Criticité | Statut |
|---|---|---|---|---|---|---|
| `API_BASE` | `src/services/railwayApi.ts:12` | racine | interne au fichier | constante | — | actif (lu par les 3 fonctions ci-dessous) |
| `createIntake()` | `src/services/railwayApi.ts:94` | `POST /api/casefiles/intake` | `src/pages/Intake.tsx:24,590` | `fetch` direct front (Bearer JWT Supabase) | **HAUTE** — bloque `/intake` si Railway down | **ACTIF** |
| `fetchCaseFile()` | `src/services/railwayApi.ts:114` | `GET /api/casefiles/{id}` | aucun (`rg` zéro consommateur dans `src/`) | `fetch` direct front | **NULLE** | **MORT — dead export** |
| `runWorkflow()` | `src/services/railwayApi.ts:129` | `POST /api/casefiles/{id}/run` | aucun (`rg` zéro consommateur dans `src/`) | `fetch` direct front | **NULLE** | **MORT — dead export** |
| Proxy edge `truck-optimization-proxy` | `supabase/functions/truck-optimization-proxy/index.ts:5` invoqué via `callOptimizationProxy()` (`truckLoadingService.ts:276–295`) | `/api/optimization/truck-specs`, `/optimize`, `/visualize`, `/suggest-fleet` | `getTruckSpecs`, `runOptimization`, `getVisualization`, `suggestFleet` (chemin principal) | Edge Function proxy avec `requireUser` (Bearer JWT Supabase ajouté côté edge) | **HAUTE** | **ACTIF — chemin principal** |
| `RAILWAY_API_URL` (fallback direct) | `src/services/truckLoadingService.ts:110` | mêmes 4 endpoints, appelés en `catch` après échec proxy : `truck-specs` (L367), `optimize` (L446), `visualize` (L490), `suggest-fleet` (L622) | mêmes 4 fonctions, branche fallback | `fetch` direct front (sans Bearer) | MOYENNE — fallback uniquement | **ACTIF — fallback** |
| `VITE_TRUCK_LOADING_API_URL` | référencée dans le code (`railwayApi.ts`, `truckLoadingService.ts`), **absente** de `.env.example` et du `.env` du ZIP | (override d'URL, fallback hardcodé Railway) | `railwayApi.ts:12` + `truckLoadingService.ts:110` | env var partagée intake/truck | — | couplage à dénouer |

### 2.2 Pages & composants concernés

- **`src/pages/Intake.tsx`** — seul vrai consommateur Railway côté intake. Importe `createIntake` et `IntakeResponse` (L24), appelle Railway L590, mappe les `missing_fields` Railway → resolvers locaux (L315+), corrige les `assumptions` Railway via les facts extraits (L353+).
- **`src/pages/case-view/*`** — **aucune** référence Railway, `fetchCaseFile`, `runWorkflow`, ou `web-production`. CaseView ne dépend plus de Railway (vérifié par `rg`).
- **`src/components/truck-loading/*`** — dépendance Railway uniquement transitivement via `truckLoadingService`. Pattern actuel : **proxy edge `truck-optimization-proxy` comme chemin principal** pour `truck-specs`, `optimize`, `visualize`, `suggest-fleet` (helper `callOptimizationProxy()` à `truckLoadingService.ts:276`), avec **fallback `fetch` direct Railway** dans la branche `catch` de chaque fonction. `FleetSuggestionResults.tsx` contient des commentaires "format Railway" (lignes 397/405/415/432) sur les unités CM, à conserver lors d'une éventuelle migration.

### 2.3 Vérification d'indépendance du pipeline email

Recherche `railway|RAILWAY|web-production` dans :

- `supabase/functions/import-thread*/`
- `supabase/functions/ensure-quote-case/`
- `supabase/functions/build-case-puzzle/`

→ **Aucune occurrence**. Le pipeline email/quotation/pricing est entièrement Edge Functions Supabase. ✅

---

## 3. Statut par usage

| Usage | Statut | Action recommandée |
|---|---|---|
| `createIntake` | **ACTIF** — flux `/intake` manuel WhatsApp/texte libre | À migrer (Phase 2). Garder Railway en fallback jusqu'à Phase 3. |
| `fetchCaseFile` | **MORT** — zéro consommateur | À traiter dans un lot ultérieur (`@deprecated` JSDoc puis suppression). **Pas de modification de code dans cet audit.** |
| `runWorkflow` | **MORT** — zéro consommateur | À traiter dans un lot ultérieur (`@deprecated` JSDoc puis suppression). **Pas de modification de code dans cet audit.** |
| Truck loading via proxy edge (chemin principal) | **ACTIF** — `getTruckSpecs`, `runOptimization`, `getVisualization`, `suggestFleet` appellent d'abord `callOptimizationProxy()` | Hors scope. Audit séparé `DCQ-RAILWAY-TRUCK-LOADING-AUDIT`. |
| Truck loading direct Railway (fallback) | **ACTIF** — branche `catch` après échec proxy, mêmes 4 endpoints | Hors scope. À harmoniser dans l'audit truck séparé (décider du devenir du fallback). |

---

## 4. Risque si Railway tombe

| Surface | Impact si Railway down |
|---|---|
| `/intake` manuel (WhatsApp, texte libre) | **KO total** — impossible de créer une demande |
| Truck loading (suggest-fleet, optimize, visualize, truck-specs) | **KO total** — page TruckLoading inutilisable |
| Pipeline email → quote_case → puzzle → pricing | **Aucun impact** ✅ |
| CaseView, quotation, pricing, run-pricing, quotation-engine | **Aucun impact** ✅ |
| Communication cockpit, partner offers | **Aucun impact** ✅ |

**Conclusion** : la criticité Railway se concentre sur deux surfaces isolées (intake + truck). Le cœur métier (devis, pricing, communication) est déjà Supabase-only.

---

## 5. Endpoints Railway encore nécessaires

| Endpoint | Encore nécessaire ? | Justification |
|---|---|---|
| `POST /api/casefiles/intake` | OUI (jusqu'à Phase 2) | seul flux WhatsApp/texte libre |
| `GET /api/casefiles/{id}` | **NON** | aucun consommateur dans `src/` |
| `POST /api/casefiles/{id}/run` | **NON** | aucun consommateur dans `src/` |
| `GET /api/optimization/truck-specs` | OUI (audit séparé) | front + proxy edge |
| `POST /api/optimization/optimize` | OUI (audit séparé) | front + proxy edge |
| `POST /api/optimization/visualize` | OUI (audit séparé) | front + proxy edge |
| `POST /api/optimization/suggest-fleet` | OUI (audit séparé) | front + proxy edge |

---

## 6. Doublons Railway intake ↔ Supabase build-case-puzzle

### 6.1 Ce que produit Railway `POST /api/casefiles/intake`

```ts
{
  case_id, status, workflow_key, complexity_level, confidence,
  missing_fields: [{ field, question, priority }],
  assumptions: string[],
  normalized_request: any,
}
```

### 6.2 Ce que sait déjà faire Supabase

- `parse-document` → extraction texte/structure depuis fichier ou texte libre.
- `ensure-quote-case` (mode `intake`) → création d'un `quote_case` avec un `case_id` fourni par Railway, timeline event `case_created` source `intake`. **Conçu actuellement pour recevoir un `case_id` Railway** → à adapter pour générer le `case_id` côté edge lors de la migration.
- `build-case-puzzle` → extraction des facts (cargo, incoterm, transport mode, scope, HS), création des gaps.
- `set-case-fact` → écriture de facts validés (whitelist).

### 6.3 Gap fonctionnel à recréer

Pas d'équivalent Supabase pour la **classification de complexité** : `complexity_level`, `workflow_key` (`SEA_FCL_IMPORT`, `SEA_LCL_IMPORT`, `SEA_BREAKBULK_IMPORT`, `AIR_IMPORT`, `ROAD_IMPORT`, `MULTIMODAL_IMPORT`), `confidence`, `assumptions`. À recréer dans une future Edge Function `intake-case-request` (LLM via Lovable AI Gateway, modèles `google/gemini-2.5-flash` ou `openai/gpt-5-mini`), ou intégré comme étape supplémentaire de `build-case-puzzle`.

### 6.4 Dépendance UI à neutraliser

`Intake.tsx:315+` mappe les `missing_field.field` Railway vers des resolvers locaux (`destination`, `pod`, etc.). La future Edge Function devra produire **le même schéma `missing_fields[].field`** pour ne pas casser l'UI Intake (ou bien l'UI sera adaptée en parallèle).

---

## 7. Plan par phases

### Phase 0 — Documentation (ce livrable, documentation only)

- ✅ Audit Markdown (ce fichier).
- ❌ **Aucune modification de `railwayApi.ts`** dans ce lot. Pas de commentaire JSDoc `@deprecated` ajouté.
- ❌ **Aucune modification de `docs/DEFERRED_BACKLOG.md`** dans ce lot. La mise à jour backlog (3 entrées : `DCQ-RAILWAY-INTAKE-MIGRATION`, `DCQ-RAILWAY-TRUCK-LOADING-AUDIT`, `DCQ-RAILWAY-DEAD-EXPORTS`) sera traitée dans **un lot documentaire séparé** après validation de cet audit.

### Phase 1 — Feature flag / fallback

- Introduire `VITE_INTAKE_BACKEND=railway|edge` dans `.env.example` (default `railway`).
- Adapter `Intake.tsx` pour router `createIntake` vs nouvelle fonction `createIntakeViaEdge` selon le flag.
- **Aucun changement de comportement par défaut.**

### Phase 2 — Migration intake

- Créer Edge Function `intake-case-request` :
  - Étapes : `parse-document` (si fichier) → génération `case_id` UUID → `ensure-quote-case` (mode intake adapté) → `build-case-puzzle` (avec extraction enrichie) → `set-case-fact` (facts confirmés).
  - Recréer la classification complexité via Lovable AI (prompt structuré JSON, schéma identique à Railway pour préserver l'UI).
  - Retourner exactement le même schéma `IntakeResponse` que Railway (drop-in compatibilité).
- **Aucune modification de `run-pricing`, `quotation-engine`, PAD-NST.**

### Phase 3 — Désactivation Railway intake

- Flip `VITE_INTAKE_BACKEND` par défaut sur `edge`.
- Observation 1–2 semaines (logs, parité).
- Retirer la branche Railway de `Intake.tsx` après stabilisation.

### Phase 4 — Suppression `railwayApi.ts`

- Conditionnée à : (a) Phase 3 stable ET (b) audit truck loading clos avec décision (proxy unifié OU isolation dans un service dédié).
- Supprimer `railwayApi.ts`, retirer `VITE_TRUCK_LOADING_API_URL` de `Intake.tsx`/`railwayApi`.
- Conserver `VITE_TRUCK_LOADING_API_URL` côté `truckLoadingService` jusqu'à décision séparée.

**Hors scope ici** : truck loading → audit dédié `DCQ-RAILWAY-TRUCK-LOADING-AUDIT`.

---

## 8. Risques & tests à prévoir pour Phase 2

### Risques

1. **Régression `/intake`** : missing_fields ou assumptions divergents entre Railway et Edge → l'UI Intake mappe ces champs (L315+) et casserait silencieusement.
2. **Compatibilité `case_id`** : `ensure-quote-case` mode intake attend actuellement un `case_id` fourni → adapter pour générer côté edge sans casser le mode existant.
3. **Recréation `complexity_level` / `workflow_key`** : si la liste `ALLOWED_REQUEST_TYPES` de `ensure-quote-case` n'est pas respectée, `request_type` sera mis à `null` et plusieurs hooks downstream (router complexité) en seront perturbés.
4. **Coût LLM** : un appel Lovable AI par intake. À surveiller (rate-limit, cache).
5. **Perte de fidélité parsing** : Railway peut avoir un parsing texte libre plus robuste. Comparer en parallèle.

### Tests

- Matrice intake : (texte libre court, texte libre long, email forwardé, WhatsApp brut, fichier PDF, fichier image).
- **Parité Railway vs Edge sur ≥10 cas réels** (snapshot `IntakeResponse` côte à côte) avant flip Phase 3.
- Tests automatisés du schéma `missing_fields[].field` (mapping resolvers locaux conservé).
- Smoke test sur `request_type` whitelist `ensure-quote-case`.

---

## 9. Recommandations finales

| Action | Cible | Échéance |
|---|---|---|
| **GARDER** Railway `createIntake` | jusqu'à Phase 3 | court terme |
| **DEPRECATE** `fetchCaseFile`, `runWorkflow` | JSDoc `@deprecated` (lot séparé, **pas dans cet audit**) | priorité 3 |
| **MIGRER** intake vers Edge Function | Phase 2 | priorité 1 |
| **DIFFÉRER** truck loading | audit séparé | priorité 2 |
| **INTERDIRE** suppression `railwayApi.ts` | tant que truck non clos | toujours |

---

## 10. Interdictions strictes (rappel)

- ❌ Aucun patch `src/`.
- ❌ Aucune migration SQL.
- ❌ Aucune modification `build-case-puzzle`, `run-pricing`, `quotation-engine`, PAD-NST.
- ❌ Aucun changement runtime.
- ❌ Aucun feature flag effectif (Phase 1 est documentée, pas implémentée ici).
- ✅ **Documentation uniquement.**
