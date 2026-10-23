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


---

## 11. Préparation locale de sortie — 22 octobre 2026

GO utilisateur « oui go » du 22/10 : préparation locale des deux remplacements, sans bascule Cloud ni réduction du contrat V1. Base vérifiée : dépôt principal `C:/Users/DELL/Projects/dakar-cargo-quotes`, `work/e79b1c5c9ab3164e1f16f84e265ed7a5068b8023`, même SHA sur GitHub. `.claude/` et anciennes copies préservées. Les sections 1–10 restent historiques ; leur proposition LLM n'est pas une preuve de nécessité : le classificateur Python effectivement consulté est une heuristique déterministe.

### 11.1 Périmètre livré localement et limites

**PARTIAL : aucun remplacement complet, raccord runtime ou arrêt Railway.** Services actifs `railwayApi.ts`, `truckLoadingService.ts`, routes UI, Edge proxy et configuration restent inchangés. Aucun sélecteur/flag nouveau n'est activé.

- `src/services/railwayReplacement/` : contrats d'entrée/sortie, adaptateurs à driver explicitement fourni, classification pure, catalogue historique exact et qualification des résultats camion. Pas d'URL par défaut, de fetch interne, de repli ni de retry implicite.
- `scripts/railway-exit/reference/` : huit sources non secrètes fixées au commit backend `c34c6dc1e925e3e09b4229dcb6279e88f51d4103`, empreintes dans `manifest.json`. Aucun clone, dépendance installée, fichier env ou config de credentials copié.
- `generate-fixtures.py` : oracle local utilisant les moteurs Python originaux, hashes vérifiés, bytecode désactivé et sockets interdits. Données entièrement synthétiques. Catalogue standard 12 entrées / complet 19 ; ce sont des capacités/coûts historiques, pas une homologation réglementaire ou tarifaire.
- Suite dédiée `vitest.config.ts`, `envDir:false` : aucun fichier env chargé. Classification comparée sur 21 textes et 12 seuils de complexité ; enveloppes de catalogue/flotte/chargement et refus indépendants vérifiés. Les résultats datés du lot ne certifient aucune parité connectée ni capacité CPU du runtime cible.

### 11.2 Contrats à préserver

| Parcours | Entrée réelle actuelle | Sortie / invariants |
|---|---|---|
| Intake manuel | `source:{type:email_text,text}`, `client_name?`, `client_email?`, `customer_ref?` ; extraction documentaire en amont | `success,case_id,status,workflow_key,complexity_level,confidence,missing_fields,assumptions,normalized_request` ; UUID durable et provenance à assurer avant raccord. Les `WF_*` du backend ne sont pas des synonymes des `SEA_*`/`AIR_*` du contrat canonique. Aucun mapping inventé. |
| Catalogue | `truck-specs` | Enveloppe `success,trucks[]`, IDs stables, dimensions cm / charge kg, tous les champs conservés. La conversion en objet UI reste celle du service existant. |
| Flotte | `items[]` avec IDs/quantités/cm/kg, `available_trucks[]`, `distance_km`, `run_3d:false`, `algorithm:simple` dans le parcours actif | `success,scenarios[]`, allocations, métriques, coûts historiques et recommandation. Un pré-dimensionnement est qualifié `allocation_only`, jamais preuve de placement 3D ; `no_solution`/`exception` restent incomplets. |
| Optimisation | `items[]`, `truck`, `algorithm:simple|genetic`, options reconnues de rotation/support/marge/hauteur | Enveloppe `success,result` avec placements plats cm/kg, total/placé et efficacités. Vérifier couverture des IDs expansés, dimensions/poids conservés, camion inchangé, charge maximale, limites spatiales, non-chevauchement, support, non-empilable et métriques honnêtes. Les unités non placées restent explicites. |

Les adaptateurs candidat imposent des déclarations finies sans conversion heuristique et des capacités flotte explicites (le parcours UI actuel les fournit). Les identités unitaires sont dérivées de la requête réellement soumise ; une expansion ambiguë est refusée. Les options explicites ne sont pas ignorées. La validation d'enveloppe seule n'est pas la preuve qu'un moteur a été porté.

### 11.3 Écarts bloquant un port automatique

1. **Capacité et unités legacy** : l'oracle reproduit un chargement de deux unités de 600 kg dans un camion déclaré à 800 kg ; le moteur simple ne contrôle pas la somme des poids. Une unité explicitement déclarée à 1 500 cm peut être réinterprétée à 150 cm par la normalisation heuristique. Les tests gardent ces résultats comme constats, mais le candidat les marque `CAPACITY_EXCEEDED` / `DIMENSIONS_CHANGED`. Copier ces défauts ne constitue pas une parité acceptable ; les corriger dans le futur moteur exige une divergence explicitement qualifiée, pas une approximation silencieuse.
2. **Persistance intake** : `quote_cases` ne porte pas les identités client, texte original, demande normalisée et cinq familles historiques de Postgres. Le classificateur pur n'émet volontairement ni `case_id` ni `success` de création. Il ne faut pas remplacer l'appel par extraction + UUID et perdre ce qui n'entre pas dans les 11 faits autorisés du batch.
3. **Moteur cible** : aucun port complet simple/génétique/flotte, endpoint authentifié ni schéma nouveau n'est prétendu livré. Preuves manquantes : comportements aléatoires/temps, unités répétées/identités, charges limites/exceptionnelles, parité fonctionnelle et ressources Lovable. Le rendu local Three.js ne remplace pas les algorithmes serveur.

**Décision d'architecture proposée** : conserver Lovable comme runtime canonique ; prévoir un snapshot intake durable, lié au dossier et à son acteur, sans détourner le whitelist de faits ; porter les moteurs en conservant leurs règles explicables, avec cm/kg explicites et contrôle des capacités déclarées. Alternative à arbitrer : réhéberger le Python intact puis ajouter des gardes, ce qui conserve un autre hébergement et ses coûts/credentials. Aucun nouvel hébergeur, schéma ou tarif choisi par ce lot. Ne pas certifier les coûts hérités comme tarifs approuvés.

### 11.4 Conservation / restauration à préparer sous GO distinct

**Aucun export réel effectué.** Le SQL source déclare `case_files`, `case_inputs`, `case_events`, `case_tasks`, `case_outputs`, reliés par `case_id` (suppression cascade). Schéma réellement installé, cardinalités, dates, blobs externes et recouvrement avec Lovable : UNKNOWN. Dernière observation UI : aucune sauvegarde de volume / planification et PITR off ; à revérifier avant intervention.

1. Inventaire autorisé limité aux métadonnées/schéma, types/contraintes/index/versions et agrégats nécessaires ; repérer les objets externes désignés par `storage_uri` / `file_uri`, sans publier de contenu métier ni credential. Aucune table présumée vide ou déjà migrée.
2. Sous autorisation d'export précise : sauvegarde cohérente hors Railway du schéma et des cinq familles, rôles/privileges nécessaires sans diffuser les credentials, versions/extensions, identifiants stables, références aux fichiers et manifest d'intégrité. Destination privée et accès à approuver. Un snapshot local du code n'est pas une sauvegarde de données.
3. Restauration dans une cible isolée autorisée : comparer schéma/FK/index/IDs/cardinalités/empreintes et accessibilité des fichiers ; vérifier rejouabilité et absence de doublon, puis décider archive consultable ou migration explicite. Aucune fusion par simple égalité d'UUID ni écriture dans le runtime canonique sans mapping attesté.
4. Après conservation attestée, remplacements livrés et recettes connectées autorisées : supprimer les appels réels restants, vérifier la version active, puis arrêt réversible du déploiement avec procédure de reprise. Service/base/volume conservés ; cette phase ne vaut ni destruction ni fin de facturation.
5. Suppression de service, base/volume et résiliation de l'abonnement workspace : décisions séparées, seulement après sauvegarde/restauration attestées et accords spécifiques. Vérifier ressources résiduelles, périmètre workspace, rétention et facture ; aucune action dans ce lot.

L'incident de sécurité reste ouvert pendant cette transition. Une future migration ou un arrêt du service ne révoque pas les clés externes potentiellement exposées ; inventaire et révocation/rotation auprès de leurs fournisseurs restent une action sensible distincte à traiter sans attendre une preuve fictive de retrait de Railway.

### 11.5 Commandes de preuve locale

- `python -I -B scripts/railway-exit/generate-fixtures.py --check` : intégrité des références et absence de dérive des fixtures/catalogue.
- `node node_modules/vitest/vitest.mjs run --config scripts/railway-exit/vitest.config.ts` : seuls tests synthétiques du sous-lot, sans env ni endpoints réels.
- `npm run typecheck` ; `node node_modules/eslint/bin/eslint.js src/services/railwayReplacement scripts/railway-exit/vitest.config.ts` ; `git diff --check`.
- CI complète, recette authentifiée, moteurs natifs complets, backup/restauration et bascule Cloud : NOT_RUN. Retour local : retirer uniquement les nouveaux fichiers de ce sous-lot et ses ajouts documentaires après vérification du diff ; préserver toutes les copies et données. Aucun rollback distant applicable.


### 11.6 Clôture de ce sous-lot

Reçu réel `scripts/railway-exit/verification.json`, 22/10/2026 11:49:56 UTC : **60 tests synthétiques PASS**, intégrité des huit sources/fixtures/catalogue PASS, TypeScript frontend/node et ESLint ciblé PASS, diff-check PASS. Contre-revue indépendante ciblée PASS après correction des trois blocages (chargement partiel, qualification flotte, options explicites) ; son contrôle Python PASS, sa tentative Vitest bloquée avant tests par EPERM sur le fichier temporaire Vite, sans rejeu. Tests Vitest exécutés avec succès par l'exécuteur ; ne pas attribuer leur contre-exécution au réviseur. Aucun maintien éveillé activé. Le remplacement global reste PARTIAL, moteurs et persistance non implémentés, aucune bascule ni action Cloud.


## 12. Snapshot durable et moteur natif - préparation locale du 22 octobre 2026

**Décisions validées** après §11 : snapshot lié au dossier/acteur et port natif cm/kg. GO limité au développement local, conditionné à la préservation V1. **PASS pour ce sous-lot inactif ; sortie Railway globale PARTIAL.** Base `work/e79b1c5c9ab3164e1f16f84e265ed7a5068b8023`, identique à GitHub. Les constats §11 décrivent le premier sous-lot et restent historiques. Aucun parcours actif, FROZEN, flag ou accès Cloud modifié.

### 12.1 Snapshot intake préparé

- Migration locale non appliquée `supabase/migrations/20261022130000_prepare_durable_intake_snapshot.sql` : nouvelle table append-only `intake_snapshots`, FK dossier et acteur avec `ON DELETE RESTRICT`, clé unique dossier/opération, horodatage, source originale/identités, classification/version, requête du batch et reçu. Aucun import des cinq tables Railway.
- `record_intake_snapshot` exige JWT utilisateur/admission workspace et droit d'écriture existant. Acteur issu de `auth.uid()` ; ni paramètre acteur ni chemin service_role. Lecture RLS sous droit de lecture dossier/admission ; INSERT/UPDATE/DELETE directs interdits. Les helpers/RLS/Auth existants ne sont pas modifiés.
- Verrou advisory `sifb:<case_id>` partagé avec la RPC canonique, puis verrou ligne du dossier existant. Snapshot, dossier, faits autorisés et timeline du batch sont dans **une transaction PostgreSQL** ; échec d'insertion snapshot => rollback total. La RPC `set_intake_facts_batch` et `supersede_fact` sont réutilisées sans modification, y compris protection des faits validés et confiance serveur.
- Même opération/requête/acteur => reçu stocké, zéro nouvelle écriture. Toute divergence => conflit. Un ancien batch sans snapshot ne peut être adopté silencieusement. Une autre opération peut ajouter un snapshot sans effacer l'historique ; aucun nettoyage automatique.
- `durableIntake.ts` est un candidat sans transport par défaut : classification pure, préparation stable dossier/clé, **un seul appel de persistance injecté**, rapprochement exact du reçu (dossier/opération/classification/provenance/faits/rejeu). Le dossier existant garde son type canonique ; les WF_* restent distincts des six types de service.
- La classification est une **preuve heuristique non validée** (`heuristic_unverified`), pas une décision opérateur ; SQL vérifie sa structure, pas sa vérité métier. Le batch reste l'unique porte des 11 faits. Texte/source et identités peuvent être sensibles : taille source/classification 256 KiB chacune, batch 64 KiB, limites techniques explicites. Politique de rétention/effacement, accès partagés et incidence du RESTRICT doivent être acceptés avant application Cloud.
- Le stockage de documents et l'extraction amont restent hors de cette transaction ; leur succès n'est pas affirmé par le snapshot. Le raccord futur doit conserver les états d'échec/reprise actuels et la séparation entre informations partielles et dossier opérationnel.

### 12.2 Port moteur livré, sans bascule

- `nativeLoading.ts` : heuristique points extrêmes + grille + score source, rotations horizontales seules, support/non-empilable, puis algorithme génétique initialisé par l'heuristique (sélection, croisement et mutation source). `nativeFleet.ts` : trois scénarios, pré-dimensionnement/allocation et 3D optionnelle par camion ; catalogue standard 12/complet 19 conservé séparément.
- **Écarts correctifs étayés** : aucune inférence mm/m/cm (cm/kg déclarés conservés) ; poids cumulé strictement limité ; clearance respectée aussi aux bornes de grille ; entrées/IDs ambigus/non finis refusés. Les résultats legacy défectueux restent dans l'oracle ; le port ne les présente pas comme parité physique.
- Marges de flotte 0,88 volume / 0,95 poids / 0,90 surface et facteur empilable 0,35 repris du code épinglé, sans nouvelle règle métier. Filtrage legacy par maxima conservé : il peut écarter un mélange qui nécessiterait des classes de camion différentes ; aucun nouvel optimiseur mixte inventé.
- Quantités, IDs expansés, dimensions/poids/capacités et placements sont qualifiés indépendamment. Chargement incomplet => liste des unités non placées ; l'adaptateur qualifié le refuse. `no_solution`/`exception` ne deviennent pas des flux opérationnels. Allocation seule reste `allocation_only` ; 3D partielle ne produit pas de recommandation.
- Coûts et ordre de recommandation sont des calculs historiques explicitement `historical_unverified`, **pas des tarifs approuvés**, ni une étude d'essieux/arrimage/stabilité. `fragile` est conservé comme métadonnée : aucune règle mécanique additionnelle n'est inventée. Convoi exceptionnel sans specs/étude reste non pris en charge.
- Génétique : même famille d'algorithme, pas identité bit à bit de Python random ni garantie d'optimalité globale. Parité exacte sur cas positifs simples/seed sûrs et allocation historique ; invariants sur mélanges synthétiques. Arrondis JS/Python peuvent diverger au voisinage des demi-centièmes : les métriques sont contrôlées avec tolérance documentée, jamais transformées en garantie tarifaire.
- `ExecutionBudget` **obligatoire et fourni explicitement** : maxUnits/maxTrucks distincts des capacités métier, opérations et échéance monotone. Expansion unique, tri, recherche et qualification comptées ; compteur partagé entre scénarios/3D. Dépassement => erreur explicite, aucun fallback ni résultat prétendu complet. Les valeurs de test ne sont pas un dimensionnement production.
- Mesure locale bornée `verification-benchmark.json` (26T catalogue, colis synthétiques 100×80×80 cm / 100 kg) : à 2 millions d'opérations, les trois sondes sont refusées ; à 20 millions/2 s, simple place 8/8 en 181 ms et 20/20 en 1 046 ms sur cet hôte, génétique 8 colis épuise encore le budget en 1 725 ms. Ces valeurs sont des observations locales/JIT, pas des quotas Lovable. Les quatre refus de budget ne sont pas des flux opérationnels. **Raccordement calcul maintenu bloqué**, recommandation worker isolé avec annulation/budget, puis qualification d'un corpus V1 et du génétique ; aucune réduction du contrat silencieuse.
- Le port est un module TypeScript pur local, sans endpoint nouvellement déployable ni appel réseau. Point d'exécution/worker, limites CPU/mémoire Lovable et corpus V1 représentatif restent à qualifier avant raccord ; le moteur génétique/grille ne doit pas être branché au thread UI ou à un runtime non mesuré par simple hypothèse.

### 12.3 Preuves réelles et limites

- `node scripts/railway-exit/run-local-ci.mjs` : mêmes portes que la CI canonique, avec `envDir:false` Vite/Vitest et refus fetch/http/https réels pendant Vitest ; tests Deno sans `--allow-net`. **9 contrôles exit 0 / PASS_WITH_BASELINE** : 1 133 Vitest, 82 fichiers ; 2 671 Deno, 0 échec, 6 ignorés ; types app/node/build PASS ; dette Deno 49 diagnostics/5 buckets inchangée ; lint 708/16 contre baseline 732/16. Commande adaptée explicitement, pas attribution à une exécution littérale de `npm run ci`.
- Suite ciblée finale : 132 tests, dont source/classification/catalogue, positifs/partiels, données incomplètes, doublons, cm/kg/poids, rotations, support, flotte/3D, reçus conflictuels et budgets ; réseau synthétique seulement. Les anciens 60 tests restent verts. Lint ciblé TypeScript sans diagnostic.
- `test-intake-sql.cjs` : **16 scénarios PostgreSQL 15 PASS**, véritable RPC candidate + batch/supersede/helpers extraits du dépôt avec ACL attendues, schéma minimal synthétique. Atomicité avec échec injecté, rejeu/conflits, droits/banni/non-membre/service, lecture RLS, append-only, faits validés et chevauchement concurrent réel. Cela ne vaut pas reconstruction du schéma Cloud ni contrôle de son ledger/ACL.
- Reçu SQL final `scripts/railway-exit/verification-sql.json`, run `dcq-railway-exit-sql-1792671503614`, 12:18:23–12:18:41 UTC. Image déjà présente, réseau `none`, zéro port/bind hôte, données tmpfs ; seul conteneur du run stoppé/supprimé et disparition vérifiée. Première tentative : erreur de syntaxe CASE corrigée, issue de nettoyage initialement incertaine résolue par inspection exacte ; reçus antérieurs conservés. Aucun volume existant touché.
- Contre-revue indépendante **PASS limité à la préparation locale inactive**, après corrections reçus/structure SQL/budgets et dossier déjà typé. Relecteur sans écriture ni contre-exécution des tests sur cette passe ; preuves d'exécution attribuées à l'exécuteur. Reçus CI/SQL et état final dans `scripts/railway-exit/verification-*.json`.

### 12.4 Plan de bascule non exécuté et retours

1. Finir le raccord candidat dans un lot local : entrée serveur sous `requireUser`/JWT utilisateur pour la RPC, politique de budget/worker mesurée et gestion UI des refus/incomplets, sans modifier silencieusement les contrats. Fournir un corpus V1 représentatif approuvé (y compris document analysé, dossier existant, flotte limite/exceptionnelle) ; aucun nouvel appel IA réel dans ce lot.
2. Avant application/publication Cloud : confirmer schéma/versions/ACL/ledger et prérequis SIFB/admission ; approuver rétention des snapshots/RESTRICT, point d'exécution et budgets. GO spécifique pour migration, déploiement coordonné et recette connectée. Les fichiers de migration présents dans Git ne valent pas GO d'application automatique après un push.
3. Conservation Railway inchangée §11.4 : **case_files, case_inputs, case_events, case_tasks, case_outputs** et fichiers externes, schéma runtime/cardinalités UNKNOWN. Export cohérent privé hors Railway et restauration isolée avec IDs/FK/comptes/empreintes et fichiers accessibles à attester sous GO distinct. Aucun export, archive métier ou restauration réelle fait ; les snapshots nouveaux ne remplacent pas cet historique.
4. Après recettes positives et absence d'appels résiduels attestées : bascule explicite coordonnée avec plan de retour et observation autorisée, puis arrêt réversible web (base/volume conservés). Aucun double-write automatique. En cas d'échec, conserver les nouveaux snapshots/faits et revenir au routage validé seulement après analyse des opérations déjà validées ; rejouer la même clé, jamais créer un dossier neuf par retry aveugle.
5. Avant publication, retour local = retirer uniquement le diff de ce lot après revue, en préservant premier lot/copies/.claude. Après migration, désactiver le nouveau point d'entrée/routage, garder snapshots/RLS/admission ; correction en avant privilégiée. Aucun DROP/table/effacement d'historique proposé comme rollback automatique.
6. Suppression service/base/volume et résiliation abonnement sont des accords séparés, après sauvegarde/restauration attestées. Retenir les coûts résiduels possibles. **L'incident et les credentials potentiellement exposés restent ouverts** : arrêt ou migration ne révoquent aucune clé externe ; rotation/révocation reste une action sensible distincte, non exécutée ici.

Aucun commit/push, migration Cloud, déploiement, recette connectée, changement d'accès/réseau/visibilité, rotation, arrêt, suppression ou abonnement. Aucun maintien éveillé activé, aucun PID ancien réutilisé. L'application active n'utilise aucun de ces nouveaux modules.


## 13. Qualification CPU bornée et worker inactif - 22 octobre 2026

**PARTIAL pour la couverture V1 ; aucun raccordement.** GO local existant limité à la qualification CPU, aux optimisations étayées et au worker isolé, sans changer les règles métier ou remplacer silencieusement le génétique. Base `work/e79b1c5` alignée GitHub ; snapshot/migration du §12, données réelles, UI/services actifs et `.claude` préservés. Les observations §12 restent datées du moteur précédent, dont une copie exacte est maintenant figée.

### 13.1 Changements et preuve de conservation

- `scripts/railway-exit/cpu-reference/manifest.json` : source native du sous-lot 2 et bundle autonome, empreintes vérifiées avant les comparaisons. Les huit références Python c34c6dc d'origine restent inchangées.
- `nativeLoading.ts` : extrema des placements calculés une fois par unité ; score inchangé, ordre des rotations/points/grille et départage strict conservés. Avant collision/support, un candidat de score supérieur ou égal au meilleur ne peut plus gagner. Pour une orientation donnée, les bornes de score en x/y/z sont monotones : les lignes dominées sont élaguées. Aucune règle d'arrimage, capacité, tarif ou nouvelle heuristique métier ajoutée.
- Arrêt génétique anticipé **sur opt-in explicite** `enableProvenSeedExit` seulement : la solution initiale doit placer toutes les unités, dimensions/poids et termes poids×1000/volume être séparément entiers sûrs, somme et fitness totale rester sous `Number.MAX_SAFE_INTEGER`. Le maximum exact de l'objectif est alors atteint et tous les ordres complets sont à égalité ; la sélection stable historique garde cette solution. Hors de ce domaine, le génétique conserve population/générations et recherche. Un résultat partiel ne déclenche pas ce raccourci.
- Le raccourci reste désactivé par défaut pour les appels natifs avec RNG injecté : consommation/erreurs du callback historique conservées. Le protocole worker l'autorise explicitement avec PRNG propre à chaque job. **Désactivé en flotte 3D**, même si demandé, pour ne pas décaler le flux aléatoire partagé entre camions/scénarios ; régression sortie ET nombre de tirages sur un premier camion complet puis partiel/fractionnaire.
- `cpu.test.ts` : comparaison exacte à la référence sur 45 mélanges × 2 algorithmes, cas numériques/égalités, génétique réellement nécessaire (simple4/5 contre génétique5/5), défauts de reçu worker et cycle de vie/concurrence. Tests précédents conservés. Aucun résultat de budget ou entrée invalide ne compte comme chargement opérationnel.

### 13.2 Worker, limites et cycle de vie

- `workerProtocol.ts`, `workerClient.ts`, `loading.worker.ts` : nouveau worker par tâche, messages bornés avant clone/envoi, quotas explicites unités/camions/opérations/temps/profondeur/nœuds/octets entrée-sortie, version/ID/action rapprochés. Pas de credentials, persistance, service externe, retry ni fallback. Le worker refuse fetch/XHR/WebSocket/EventSource/importScripts ; le harness Node bloque également les transports réseau usuels.
- Annulation par **terminate du parent**, car un simple message cancel ne peut interrompre un calcul synchrone. Deadline parent inclut le démarrage, deadline/compteur moteur restent séparés. Contrôleur à concurrence explicitement bornée, sans file implicite : refus BUSY avant création ; réutilisation bloquée si nettoyage incertain. Les tests utilisent une seule tâche simultanée, pas une limite métier nouvelle.
- Tests réels sous Node22.23.1 `worker_threads` : heap ancienne génération V8 64 MiB et pile4 MiB par worker. Ce n'est pas un plafond RSS global. Terminaison attendue/ACK et ensemble final des workers vides attestés. Les valeurs heap avant/après sont des échantillons, pas un pic mémoire.
- Banc réel Chrome via outil navigateur officiel : source worker Vite réellement compilée, uniquement serveur de fixture `127.0.0.1`, CSP locale et données synthétiques. Aucun appel DCQ/Railway/IA, réglage de navigateur, extension ou pilote ajouté. Le navigateur confirme des demandes de terminaison et un contrôleur revenu à zéro ; il n'offre pas ici l'ACK d'exit Node. **Plafond mémoire par worker navigateur non démontré.** La concurrence, la taille et les compteurs limitent la charge admise, pas une garantie universelle de RAM/CPU.
- Deux serveurs de fixture temporaires fermés/vérifiés et onglet de test fermé ; builds temporaires conservés. Aucun maintien éveillé activé ni PID ancien réutilisé.

### 13.3 Corpus, budgets et résultats réellement observés

`cpu-corpus.json` : **19 cas entièrement synthétiques**, rattachés aux requêtes V1 `truckLoadingService.ts`/`FleetSuggestionResults.tsx` et au contrat d'acceptation. Catalogue26T historique (1000×248×260cm,18000kg), quantités8/20/80, poids/volumes, rotations, stack/support, marge/hauteur, cm petits/grands, données partielles/doublons, fractions et flotte/3D. Ce corpus ne couvre pas à lui seul tous les dossiers V1, convois étudiés, essieux/arrimage, appareils opérateurs ni prix approuvés.

Politique courte mesurée : 20millions d'opérations, 2s moteur/3,5s parent, max1000unités/100camions, entrée128KiB/sortie2MiB, profondeur20/nœuds40000. Politique étendue diagnostique : 200millions,8s/10s parent. **Valeurs de laboratoire, pas limites commerciales ni politique de production approuvée**, et aucune réduction implicite du timeout historique300s. Les temps varient selon hôte/JIT/charge et incluent séparément startup/compute dans les reçus.

| Cas | Résultat et limite |
|---|---|
| Node26T,8/20 unités | Optimisations : sorties complètes sous politique courte ; référence génétique dépasse le budget. Comparaison exacte seulement quand les deux versions terminent ; preuve du raccourci fondée sur le domaine numérique explicite. |
| Chrome26T,8 unités | Simple8/8 en59ms, génétique8/8 en34ms par optimum initial prouvé. |
| Chrome26T,20 unités | Simple20/20 en426ms, génétique20/20 en441ms par optimum initial prouvé. |
| Cas nécessitant réellement la recherche génétique | Chrome : simple4/5 ; génétique paramètres30/50 inchangés dépasse2s puis5/5 en3380ms sous politique8s. Aucun remplacement par simple ni diminution de générations. |
| 80 unités26T | Court : simple ET génétique refusés. Étendu Node : simple67/80 en7307ms, génétique encore refusé après8s. **Non qualifié**, pas opérationnel sous ces politiques. |
| Témoin indépendant80 | Une disposition synthétique construite à la main (10×3 par couche,3 couches partielles) satisfait les invariants et place80/80. Ce n'est pas une sortie du moteur ni un nouvel algorithme livré ; l'entrée ne peut être écartée comme physiquement impossible pour obtenir PASS. |
| Flotte, pré-dimensionnement | Trois allocations retournées, statut allocation_only ; aucune preuve3D inventée. |
| Flotte3D génétique | Deux sondes avec raccourci demandé on/off dépassent20M ; flux RNG conservé, aucune réussite revendiquée. Mix complet puis partiel/fractionnaire retourne une sortie identique on/off ; les géométries partielles restent explicites. |

Reçu Node `verification-cpu.json` : **106 lignes de mesure**, **74 comparaisons de sorties achevées identiques**,6 contrôles,109 exits ACK,0 worker restant. Sous-variante candidate-bound courte : dénominateur36,30 retours (15 optimisations complètes,13 incomplètes,2 flotte),2 refus de budget et4 refus d'entrées invalides ; **30 retours ne signifie pas30 parcours opérationnels**. Les timeouts ne prouvent aucune équivalence de sortie. Supplément flotte `verification-fleet-cpu.json` :6 mesures ; ses compteurs enfants pack/générations non instrumentés (zéros), seul compteur opérations externe est interprétable.

Reçu navigateur `verification-browser-worker.json` :9 mesures,1 contrôle annulation en tâche en cours,10 demandes de terminaison, contrôleur final0 ; heartbeat10ms, retard maximal observé15,3ms sur cet hôte. Observation locale de réactivité uniquement, sans SLA ni garantie appareils modestes/arrière-plan. Première politique2s conservée dans `verification-browser-worker-2s.json`, capture `worker-cpu-local.png`. Reçu de faisabilité distinct `verification-cpu-witness.json`.

### 13.4 Vérifications, reproduction et décision

- Régressions isolées : **241 PASS**, dont109 nouvelles ; nouvelle suite vérifiée aussi sous le véritable setup jsdom de CI, après correction du marqueur Node incompatible avec le setup global. Échec initial archivé ; aucun code de setup applicatif modifié pour le contourner. CI finale complète locale `run-local-ci.mjs stage3` : **9 contrôles exit0 / PASS_WITH_BASELINE**,1 242 Vitest/83fichiers,2 671 Deno/0échec/6ignorés, types/build PASS, dette Deno49/5 et lint708/16 inchangées. Reçu `verification-ci-stage3.json`, première tentative échouée sur configuration du test conservée séparément ; correction vérifiée sans affaiblir le setup ou les refus réseau.
- Contre-revue indépendante code/preuves locale PASS, sans écriture ni contre-exécution des tests. Domaine d'entiers renforcé, RNG flotte conservé et ambiguïté des compteurs enfants explicitée ; revue ne vaut pas réception V1.
- Reproduction : `node scripts/railway-exit/qualify-cpu.mjs`, `qualify-fleet-cpu.mjs`, `verify-cpu-witness.mjs` ; `serve-browser-fixture.mjs` pour banc navigateur explicitement lancé, auto-arrêt15min et écoute127.0.0.1 seulement ; `run-local-ci.mjs stage3` pour CI sans env ni transports réels. Les scripts ne touchent aucune base ni donnée métier.
- **Recommandation** : calcul interactif dans un Dedicated Web Worker explicite, hors thread UI, avec annulation/concurrence/diagnostics. Ce placement est étayé pour les cas locaux mesurés. Ne pas brancher par défaut la grille/GA dans une Edge synchrone à quota CPU supposé, et ne pas considérer qu'un budget augmenté résout la qualité de placement.
- **Blocages conservés** : cas volumineux faisable non achevé et flotte3D génétique sous politiques testées ; corpus opérateur et limites appareils navigateur/mémoire non qualifiés. Décision technique suivante : qualifier une stratégie de chargement/corpus volumineux et la politique de tâches longues ; si une limite mémoire dure ou une exécution serveur longue devient obligatoire, étudier un vrai worker/job CPU avant choix d'hébergement. Aucun nouvel hébergeur, aucune approximation d'algorithme ou quota de production choisi ici.
- Raccordement actif, retrait Railway, conservation/restauration des cinq tables, recette connectée et sécurisation des credentials restent inchangés/gatés au §12. Aucun commit/push, migration appliquée, déploiement, rotation ou arrêt. Retour local limité au diff CPU identifié par reçu stage3 ; préserver source figée, sous-lots précédents et copies.


## 14. Arbitrage métier et candidat intake authentifié — 22 octobre 2026

### 14.1 Portée de la décision

GO « go » : reporter le seul module avancé de chargement/optimisation des camions, inutilisé actuellement, pour privilégier les cotations simples. Amendement canonique roadmap §2.39.5 : **DEFERRED_OUT_OF_V1**, pas un PASS ni une preuve d'équivalence. Catalogue de cet outil, suggestion automatisée de flotte/nombre/type, placement/visualisation3D et CPU/génétique reportés. Tous les flux métier breakbulk/project cargo, transport, packages et modes restent requis ; les complexes restent soumis à l'opérateur avec limites explicites. Code, défauts et preuves §11–13 conservés, aucune extension CPU ni nettoyage. Page/proxy/fallback déployés toujours inchangés ; leur neutralisation explicite sera un préalable au retrait, distinct du report documentaire.

### 14.2 Raccord local préparé, inactif

- `manualIntakeCommand.ts` accepte une commande versionnée `case_id,request,analysis,has_extracted_document`. Le client alloue le UUID une fois ; la clé existante `intake:<case_id>:v1` ne change pas au rejeu. Source originale et identités client restent dans le snapshot lié au dossier/acteur, aucune insertion libre de fait/acteur/classification proposée par le client.
- Le serveur recalcule la classification déterministe c34c6dc et les faits avec **les propriétaires existants** `parseTextOverrides/buildIntakeFactBatch`, puis valide le contrat existant `validateIntakeBatchCommand`. Aucun tarif ou algorithme métier inventé. Conteneurs, dimensions sans faux conteneurs, priorité texte sur extraction, inland et données partielles gardent leurs règles. Limite technique explicite262144octets JSON, profondeur16/nœuds12000 ; aucun grand document auparavant accepté n'est déclaré opérationnel sans recette adaptée.
- `supabase/functions/manual-intake/index.ts` réutilise `requireUser` (getUser JWT puis admission workspace) et crée un client **anon sous le JWT utilisateur**, aucun service_role. Handler : OPTIONS/méthode, Auth, JSON borné, dérivation serveur, puis **une seule RPC** `record_intake_snapshot` et reçu durable validé. La transaction SQL locale existante snapshot+batch/faits/timeline, verrous, RLS, provenance et protections manuels/validés reste inchangée et NON APPLIQUÉE en Cloud.
- Le bundle `prepare.generated.js` est généré depuis les sources TypeScript, sans import de client/env actif ; générateur `build-manual-server.mjs --check` et `manual-server-manifest.json` fixent les propriétaires/empreintes. Configuration locale explicite `verify_jwt=false` conforme ES256 + Auth en code ; ce fichier n'est ni déploiement ni changement d'accès distant.
- `manualIntakeClient.ts` exige un transport explicitement fourni. Session courante à chaque soumission, exclusion des doubles appels, reçu rapproché, aucun fallback Railway/retry automatique. Un refus SQL n'est BLOCKED que sur couple SQLSTATE/message exact connu ; les marqueurs dans une erreur transport restent UNKNOWN. Le SDK installé retourne `data:null` sur non2xx : seule une `FunctionsHttpError` avec vraie Response et JSON structuré borné permet de lire un refus ; HTTP seul/fetch/relay ne prouvent pas le rollback.
- `analysis`/`has_extracted_document` gardent la provenance historique déclarée par le client, sans attestation serveur de lecture documentaire ; confiance0,7/0,8 et `heuristic_unverified`, jamais fait opérateur validé. Upload/storage/extraction restent hors transaction canonique comme actuellement ; aucun appel documentaire/IA réel de ce lot.
- **Raccord formulaire injecté uniquement localement** : `Intake.tsx` accepte une prop optionnelle `manualCandidate`, jamais fournie par `App.tsx`. La branche par défaut reste Railway + batch existant, les routes/flags/services actifs inchangés ; le candidat confirmé saute ce second batch. Le vrai formulaire, le SDK installé et le handler sont composés dans le banc ; le banc PostgreSQL séparé exerce la RPC réelle sur fixture minimale. Cela ne vaut pas recette Cloud.
- `createManualFormSession` conserve en mémoire la commande exacte et le UUID. Pending/UNKNOWN/conflit verrouillent les champs ; un refus Auth ultérieur ne résout jamais une incertitude antérieure. Le rejeu explicite garde la même clé, seul le reçu vérifié lève le verrou. « Nouvelle analyse » ouvre une nouvelle opération uniquement après résolution, même pour un texte intentionnellement identique. Double soumission refusée ; ouverture du dossier après reçu seulement, assumptions corrigées par la fonction existante.
- Le candidat UI couvre **saisie texte seule** : fichier sélectionné refusé avant soumission, action d'analyse documentaire désactivée et garde avant parse-document/analyze-document ; aucun appel IA/storage implicite. Le parcours documentaire legacy reste inchangé et requis par V1 ; ce refus sûr n'en prouve pas l'équivalence. La provenance documentaire du contrat backend est seulement simulée dans les tests.
- **Gate d'activation non levé** : mémoire seule, pas de reprise durable de la commande après reload/crash. beforeunload avertit fermeture/rechargement ; il ne couvre pas une navigation interne React Router qui démonte le propriétaire. Définir un propriétaire de session au-dessus de la route, une garde de navigation/récupération et une stratégie de reprise durable sous Auth avant activation, sans stockage PII nouveau décidé ici. Les références anciennes et copies restent conservées.

### 14.3 Preuves locales et limites

Résultats finaux et empreintes : `scripts/railway-exit/verification-stage4.json`, reçu SQL `verification-manual-sql.json`, CI `verification-ci-stage4.json`. Les recettes utilisent uniquement des données synthétiques, le SDK installé avec customFetch interne (aucun réseau), le handler réel et PostgreSQL15 jetable réseau none/0port/0bind/tmpfs. Auth/ES256/getUser et PostgREST réels, schéma/ACL complets Lovable, tarification/PDF connectés restent **NOT_RUN/UNKNOWN** ; contrôles du formulaire navigateur local consignés séparément dans `verification-browser-intake.json`. Le fixture réutilise les vrais corps RPC/helpers existants sur schéma minimal ; ses deux appels SDK sont sérialisés par execFileSync, tandis que le scénario SQL historique crée un vrai chevauchement de sessions/verrou. Ne pas confondre les preuves.

Clôture locale : **59 tests ciblés PASS (56 nouveaux +3 legacy), CI9portes exit0,1 298Vitest/85fichiers et2 671Deno/0échec/6ignorés**, type endpoint Deno explicite et bundle reproductible PASS ; Deno49/5, lint708/16 inchangés. SQL26scénarios PASS et conteneur supprimé/absence vérifiée. Contre-revue indépendante intégrité PASS après corrections, sans contre-exécution attribuée au réviseur. Chrome155 réel : état pending/UNKNOWN avec verrou, rejeu au clavier, 2RPC→1dossier/1UUID puis unresolved=false ; résultat partiel honnête, action d'ouverture utilisable à390px et navigation de fixture vérifiée, pas CaseView réel. Source navigateur et DB Auth simulées, reçu `verification-browser-intake.json` et capture `intake-success-local.png`. Les compteurs legacy_calls/real_service_calls du banc sont des déclarations de garde, pas une télémétrie réseau mesurée ; alias bloquants/customFetch/CSP constituent l'isolation. Premier reçu de fixture capturé trop tôt conservé en attempt1, capture finale après résolution du submitter. Premier essai screenshot full-page a expiré sans action formulaire ; capture viewport finale réussie. CI initiale et essais de banc conservés, délais de tests inchangés. Serveurs/onglet fermés, ports50540/53956/55425 absents, viewport rétabli ; builds/préuves préservés, aucun maintien éveillé activé.

### 14.4 Prochain lot utile et gates externes, aucun exécuté

1. **Local — demandes simples** : terminer la reprise durable UNKNOWN/navigation interne/reload du raccord injecté, puis étendre explicitement le candidat au parcours documentaire (stockage/extraction/reprise post-upload), sans bascule silencieuse ; préserver la branche Railway courante tant que non validée. Tests UI de reprise et non-régression des documents, réception après erreur partielle sans recréation ; aucune extension camion. La V1 simple exige toujours sa recette prix/version/PDF et ses références métier, pas seulement intake.
2. **Livraison Lovable à soumettre** : GO ciblé commit/push après revue/CI distante ; vérifier identité/version cible, migration baseline et ACL, absence de collision intake_snapshots/RPC, politique de rétention/FK RESTRICT et sauvegarde de la cible. Appliquer une fois `20261022130000_prepare_durable_intake_snapshot.sql`, vérifier définitions/ACL/contraintes, déployer `manual-intake` et frontend privé coordonnés. Aucun DROP, service_role canonique, changement Auth/RLS existants ou flag global implicite. Retour avant adoption : revenir au frontend précédent en conservant tous les snapshots et protections ; après données, correction en avant, ne pas supprimer table/histoire.
3. **Recette connectée à soumettre** : compte opérateur admis et sandbox synthétique nommés, budget/écritures précis autorisés ; positif source manuelle/conteneurs/route, données partielles, source documentaire si requise, refus anonyme/non-membre/banni, fait protégé, atomicité, concurrence et accusé perdu/rejeu exact. Vérifier dossier/acteur/source/faits/timeline, absence de doublons, relecture/reload et zéro appel Railway. Puis un parcours simple complet jusqu'au prix/version/PDF selon §2.39, sans tarif validé par simulation. Aucune écriture sur donnée réelle ou IA payante implicite.
4. **Conservation Railway à soumettre** : cible projet `0aa0f712-dc83-4c3b-aa7e-76de271ca328`, gleaming-respect/production, service web et Postgres/postgres-volume à reconfirmer par métadonnées. Inventaire schéma réel, versions/extensions/FK/index et agrégats des cinq tables `case_files,case_inputs,case_events,case_tasks,case_outputs`, UUID/dates et objets `storage_uri/file_uri`. Schéma réel, volumes/cardinalités, couverture Lovable et fichiers sont UNKNOWN. Ne pas lire/exporter de contenu ni secret sans GO précis.
5. **Backup/restauration à soumettre** : destination privée hors Railway, responsables/accès et rétention approuvés ; export cohérent transactionnel des cinq tables/schéma/dépendances et conservation des fichiers, manifeste/hashes/horodatage/version. Aucune prétention de sauvegarde par code/snapshot local. Restaurer dans cible isolée autorisée, comparer schéma/IDs/FK/index/cardinalités/empreintes et fichiers, documenter le mode de consultation et le retour Railway. Pas de fusion automatique avec Lovable. **Conservation inconnue = arrêt bloqué.**
6. **Retrait à soumettre après preuves** : neutraliser les accès/appels camion reportés sans retirer transport/breakbulk et vérifier le binaire actif ne dépend plus de Railway ; arrêt réversible de web avec service/base/volume conservés, procédure et critères de reprise, contrôle sans appels applicatifs payants non autorisés. L'arrêt ne supprime pas les données et ne garantit pas fin de facturation. Suppression web, base et volume sont chacune destructives et exigent sauvegarde/restauration attestées et accord spécifique ; elles ne sont pas nécessaires par défaut à une simple suspension. Résiliation/abonnement workspace est distincte, périmètre/ressources résiduelles/facture à vérifier avec le propriétaire avant GO, aucune résiliation automatique.

L'incident credentials reste ouvert et séparé. Migration, report camion, arrêt et résiliation ne révoquent pas les clés externes potentiellement exposées ; toute sécurisation fournisseur/rotation exige sa cible et son autorisation propre. Aucun contact client. Aucun commit/push, déploiement, migration Cloud, export réel, arrêt/suppression, abonnement ou accès modifié dans ce lot.


## 15. Reprise durable intake et préparation documentaire locale — 22 octobre 2026

**Statut : préparation locale inactive vérifiée ; parité PJ et retrait Railway PARTIAL.** Ce point actualise les limites mémoire/navigation de §14, sans transformer les preuves antérieures ni la qualification camion reportée. Dépôt `C:/Users/DELL/Projects/dakar-cargo-quotes`, `work/e79b1c5c9ab3164e1f16f84e265ed7a5068b8023`, GitHub identique. Les 48 fichiers du lot4 ont été vérifiés et 137 fichiers préexistants copiés dans `C:/Users/DELL/Documents/Codex/2026-10-22/task-2/manual-intake-stage5-before/` avant écriture ; aucun nettoyage, commit ou push.

### 15.1 Reprise et intégrité

- `recoverySession.ts` conserve uniquement l'UUID opaque dans la référence URL `intake_operation`, écrit et relu avant le premier effet. Aucun texte, identité, résultat, fichier ou token en localStorage/sessionStorage/IndexedDB. Le texte en cours de frappe avant sa première sauvegarde confirmée reste en mémoire : pas d'autosauvegarde prétendue. Perdre l'URL n'est pas couvert par un inventaire automatique de demandes.
- `recoveryClient.ts` relit la session avant et après réponse ; l'acteur n'est jamais fourni par le navigateur au SQL. Une ancienne incertitude survit à un refus Auth ultérieur. Changement d'acteur/démontage invalide le contexte, supprime le cache sensible et interdit les effets tardifs après `await`, y compris l'interleaving microtâche. Même source/opération, même UUID et même clé canonique ; aucun retry ou fallback Railway implicite.
- `IntakeRecoveryCandidate.tsx` est un écran candidat **absent d'App et de tout routage actif**. Après reload/navigation vers une référence existante, « Reprendre ma demande » effectue une lecture sous Auth ; aucune recréation si ligne absente ou accès refusé. Navigation sur la même route A→B/retour remonte la frontière sensible et exige une nouvelle lecture ; props gateway/allocateur recréées ne recréent pas la session en cours. L'affichage d'un reçu restauré réutilise `correctAssumptions/parseTextOverrides`, sans reclassement ni second batch. Le parcours App existant reste inchangé.
- Migration **locale/non appliquée** `20261022170000_prepare_intake_recovery.sql`, après `20261022130000` : opérations acteur/dossier UUID, révision CAS, préparation figée/version/hash, reçu ; étapes avec ticket unique ; journal append-only d'actions. Tables sans grants clients/service directs, RLS activée, accès RPC vérifié, FK RESTRICT et aucune expiration/destruction automatique. Réserve + source durable précèdent la préparation ; source figée et reçu survivent à une perte d'accusé.
- Préparation attestée serveur uniquement (`manual_intake_prepare`, service_role limité au journal), refus du prepare libre authentifié. L'endpoint `manual-intake-recovery` réutilise `requireUser` et l'admission. Écriture **canonique** toujours sous le JWT utilisateur : snapshot/faits/batch/timeline et reçu d'opération sont une même transaction via `record_intake_snapshot`. Aucune classification historique recalculée au rejeu ; validation du reçu par `validateDurableIntakeReceipt`.
- Ordre de verrou : opération → SIFB → dossier/faits → dernier contrôle d'admission verrouillé jusqu'à fin de transaction ; révocation pendant l'attente testée, y compris nouveau dossier sans fait. CAS concurrent, collision legacy, fait protégé et échec snapshot n'adoptent ni n'effacent une histoire existante. Une opération explicitement abandonnée reste en tombstone, y compris si sa première réserve n'est pas confirmée : aucune suppression. L'UI de gestion d'abandon/référence manquante n'est pas raccordée ; ce refus sûr n'est pas une résolution métier complète.

### 15.2 Pièces jointes : contrats préparés et écart restant

Chaîne existante inspectée : Intake → parse-document autonome (upload `documents`, document_id non déterministe, éventuellement OCR) → analyze-document transit_order → préremplissage → création canonique → upload `case-documents`/ligne/timeline/backfill best-effort. L'analyse peut annoncer succès malgré un échec de sauvegarde ; aucun ticket stable d'opération/source ne permet actuellement un rattrapage sûr d'une issue inconnue. Aucun de ces appels n'a été exécuté ici.

| Capacité | Préparation et preuve locale | Limite avant activation |
|---|---|---|
| Source fichier | `intakeDocument.ts` : formats legacy PDF/XLSX/XLS/JPG/JPEG/PNG/CSV, 10MiB, nom sûr, document_id/path stables, SHA256 des octets réels ; nom/taille seuls insuffisants | Aucun vrai fichier ou bucket Cloud consulté |
| Upload | `recoveryUpload.ts` : ticket enregistré avant effet, acteur revérifié, port explicite `upsert:false`, mêmes octets/chemin ; accusé perdu → observation seulement, jamais upload implicite supplémentaire | Port Storage réel non raccordé à l'écran ; absence/403/erreur après UNKNOWN ne prouvent pas absence de fichier, donc pas de nouvel upload aveugle |
| Extraction/analyse | `document-worker.ts` : claim avant fournisseur, résultat lié opération/claim/fileSHA ; analyse liée au claim et SHA du texte extrait ; lookup observation seule, résultat connu mis en journal avant succès | `canRun:false`, aucun perform/lookup parse/OCR/IA réel. Les ports synthétiques et sorties simulées ne prouvent pas la parité documentaire |
| Liaison au dossier | `link` sous JWT : case_documents + événement + reçu document même transaction, ID stable, collision sans adoption ; reçu dossier distinct du reçu document. Texte manuel + fichier non analysé et parcours extrait simulé positifs en SQL | Storage est hors transaction : fichier à conserver/rapprocher explicitement si liaison échoue ; pas de suppression d'orphelin ni succès PJ déduit du seul reçu dossier |
| Confidentialité | Journal/source acteur privé et relecture Auth ; aucun secret ajouté ou exposé. Vérification octets avant commit/link et lors de reprise | Bucket case-documents privé mais ACL existantes partagées au workspace (lecture/ajout/suppression), inchangées. Ne pas le déclarer acteur privé ou immuable ; la vérification SHA n'élimine pas une modification concurrente des octets entre contrôle et transaction |

Freeze refusé si une extraction/analyse engagée est `running/unknown` : impossible de classer la PJ comme « non analysée » puis d'en perdre tardivement le texte. Un timeout ne devient ni succès ni autorisation d'une nouvelle consommation IA. Le texte du mode case_document legacy et celui du contrat candidat sont bornés à200000 caractères, la commande manuelle à262144 octets UTF8 ; certaines sources Unicode ne tiennent pas dans la commande. Correction précisée au §16 : le standalone réellement utilisé par Intake conserve jusqu’à2000000caractères, et ne doit pas être assimilé à cette borne200000. Aucun tronquage silencieux ni affirmation de parité sur ces cas.

**Prochain incrément local utile :** rendre les fonctions documentaires existantes récupérables sur ticket/source persistés, puis raccorder l'upload et l'écran ; réutiliser leurs mécanismes et tests, sans refonte générale. Prouver les résultats persistés avant/après perte d'accusé, et fermer les écarts d'affichage/tailles/fichiers protégés. Si le fournisseur ne permet pas de retrouver une réponse perdue avant sa persistance, l'incertitude reste réelle : une nouvelle tentative potentiellement facturée exige une politique explicite, pas une relance cachée ni un UNKNOWN permanent déclaré opérationnel. Aucun choix fournisseur, coût supplémentaire ou baisse de contrat n'est autorisé par ce lot.

### 15.3 Preuves et limites

- `verification-recovery-sql.json` : **39 scénarios PASS** (16 snapshot existants +23 reprise/documents) sur vrai PostgreSQL15 jetable, réseau none/0port/0bind/tmpfs, suppression du seul conteneur vérifiée. Verrous concurrentiels réels pour doublon/révocation ; schéma minimal et claims JWT synthétiques. Auth ES256/getUser, PostgREST, Storage/ACL et fournisseurs réels **NOT_RUN**. Hash/texte en SQL attestés par worker synthétique, aucune lecture de PJ métier.
- Tests ciblés finaux : **32 PASS** (29 contrats/session/fichiers/worker +3 React). SDK installé réellement exercé dans le navigateur, handler réel avec RPC en mémoire ; les tests unitaires séparés ne doivent pas être décrits comme Auth ou DB réelles. CI locale complète9portes **PASS_WITH_BASELINE**,1328Vitest/87fichiers,2671Deno/0échec/6ignorés, types/build PASS, dette Deno49/5 et lint708/16 inchangée. Après les deux derniers guards d'intégrité, types app et32tests revérifiés ; passe Vitest complète finale **1330 PASS/87fichiers** consignée dans `verification-recovery-vitest-final.log` et bilan final `verification-stage5.json`. Première CI FAIL sur avertissement Fast Refresh du seul banc puis corrigée sans changer la baseline ; tentatives préservées.
- Chrome155 officiel : commande avec503UNKNOWN synthétique après commit, navigation interne/démontage, reload réel, retour au même UUID et lecture explicite → texte et corrections restaurés,1dossier/1commit puisread. `verification-browser-recovery.json` décrit un registre **en mémoire serveur**, qui survit au reload navigateur, pas au redémarrage de serveur ; ce n'est pas une preuve de persistance DB connectée. Première erreur d'option SDK0action et simulation socket2commit/1case conservées distinctement ; aucun fallback applicatif inféré. Capture `C:/Users/DELL/Documents/Codex/2026-10-22/task-2/stage5-intake-recovery-local.png` ; tentative d'écriture capture dans le dépôt refusée EPERM, cible non retentée. Onglet et trois serveurs temporaires fermés, écoute vérifiée ; aucun maintien éveillé ni override viewport activé.
- Contre-revue indépendante statique PASS sur les corrections SQL, ticket/source/résultat, navigation, restitution et guards post-await ; aucune contre-exécution de tests attribuée au réviseur. La parité PJ complète reste PARTIAL ; aucun nouveau refus de sécurité ou blocage d'outil sur le code. Le binaire déployé, prix/version/PDF et dossiers réels restent hors preuve.

### 15.4 Passage connecté, conservation et retrait — préparés, non exécutés

1. **Finir localement le raccord documentaire ci-dessus**, adapter le cas de source Unicode sans réduire le contrat, documenter récupération/rétention des sources et objets ; dossier incomplet, document conservé non analysé et échec du flux restent distincts. La préparation du texte peut être revue séparément, mais ne justifie pas un retrait V1 silencieux de la PJ.
2. **Soumettre un GO de livraison/recette Lovable précis** : SHA/diff/CI/revue exacts, projet et environnement canonique confirmés, baseline schéma/migrations/ACL/rétention lue sans secret, points d'entrée `manual-intake` et `manual-intake-recovery` nommés. Migrations130000 puis170000 une seule fois via ledger, aucune application autorisée ici ; déploiements/route candidat explicites seulement après accord. Garder le parcours actuel jusqu'à validation, pas de fallback masquant un échec. Service authority journal seulement, canonical JWT ; aucun affaiblissement Auth/RLS.
3. **Recette synthétique connectée sous GO** : acteurs admis/non admis/révoqués, absence de fuite lors de changement session, A→B/retour, refresh/accusé perdu avant/après transaction, doublons et CAS, facts manuels/validés, texte partiel, chaque format fichier/OCR/analyse/résultat persisté/liaison atomique et échecs, tailles/Unicode et octets modifiés. Vérifier un UUID/snapshot/batch/dossier et l'absence de vrai appel Railway dans le build candidat, puis parcours simple jusqu'au prix/version/PDF. Une réussite locale ou un refus sûr ne remplace aucune de ces preuves ; IA/upload/écritures connectées ont leurs autorisations et limites nommées.
4. **Conservation réelle séparée** : projet Railway `0aa0f712-dc83-4c3b-aa7e-76de271ca328`, gleaming-respect/production, web, Postgres et postgres-volume à reconfirmer par métadonnées. Les cinq tables `case_files,case_inputs,case_events,case_tasks,case_outputs` restent historiques à conserver : schéma/version/extensions/FK/index, cardinalités/IDs/dates, dépendances et références storage_uri/file_uri **UNKNOWN**, aucun contenu/export lu ici. Faire approuver destination privée hors Railway, responsable/accès/rétention, périmètre données/fichiers et moyens de restauration ; export cohérent transactionnel + schéma/dépendances + objets référencés, manifeste/hashes/date/version sans secrets en dépôt.
5. **Restauration attestée avant arrêt** : cible isolée approuvée, comparer schéma/FK/index/IDs/cardinalités/empreintes et disponibilité fichiers, démontrer consultation et retour/restauration, décider archive vs mapping/import explicite. Aucun rapprochement automatique Lovable par simple UUID, aucune nouvelle table locale assimilée à un backup de l'histoire Railway. Conserver aussi nouveaux snapshots/journaux/objets et leurs contraintes RESTRICT ; politique de rétention nouvelle à valider. **Conservation inconnue bloque l'arrêt.**
6. **Retrait ultérieur seulement après preuves et accords** : neutraliser explicitement page/proxy/fallback du seul module camion reporté, sans supprimer transport/breakbulk. Arrêt réversible de web avec base/volume/service conservés et procédure de rétablissement testée ; fin de facturation non déduite de l'arrêt. Suppression web/base/volume est destructive, chacune nécessite sauvegarde-restauration attestée et accord spécifique ; résiliation abonnement workspace distincte, ressources et facture à contrôler. Incident credentials reste ouvert : arrêt/migration ne révoquent pas les clés externes, sécurisation séparée sans rotation non autorisée.

Retour local : rétablir seulement le delta identifié dans `verification-stage5.json` depuis les copies avant lot, préserver les48fichiers précédents, `.claude`, copies et toutes preuves. Aucun rollback exécuté ni fichier supprimé. Après adoption future : désactiver le seul nouveau routage sous GO, garder sources/snapshots/journaux/RLS et corriger en avant ; aucun DROP automatique de données.


## 16. Lot6 PJ — analyse bornée et choix de conservation avant raccordement, 22 octobre 2026

**Statut : PENDING_DESIGN / parité PJ PARTIAL.** Le GO impose d'arrêter à l'analyse si le raccord exige une transformation plus large. Préflight `work/e79b1c5c9ab3164e1f16f84e265ed7a5068b8023` local/GitHub identique ;64empreintes du lot5 vérifiées,190fichiers copiés et vérifiés dans `C:/Users/DELL/Documents/Codex/2026-10-22/task-2/manual-intake-stage6-before/`. Aucun code, moteur, migration, contrat exécutable ou test de dépôt modifié ; seules ces notes et le reçu d'analyse sont ajoutés. Aucun outil refusé, appel externe, tentative incertaine ou remédiation exécutée dans ce lot.

### 16.1 Écart confirmé au contrat documentaire actuel

- Le parcours Intake appelle parse-document **standalone**, puis analyze-document (`src/pages/Intake.tsx`, action handleAnalyzeDocument). `parse-document/index.ts` stocke `content_text:extractedText.substring(0,2000000)` dans `documents` ; la borne200000 concerne seulement `case_document` et son backfill, pas l'archive standalone actuelle. Le résultat conserve aussi tags/detected_type, extracted_data (dont échantillons CSV/XLS de100lignes), nom/type/taille. Les sources binaires sont distinctes,10MiB maximum.
- Le candidat lot5 borne l'extraction à200000caractères (`intakeDocument.ts`), la sortie de chaque étape/journal à1MiB JSON (migration170000), le formulaire à262144octets. L'analyse existante consomme8000caractères et l'écran un aperçu500 ; ces portions ne remplacent pas le texte et les métadonnées archivés. Un raccord direct tronquant l'archive ou présentant le refus comme une équivalence réduirait le contrat.
- Sondes en mémoire réellement exécutées, sans fournisseur ni base : validateur généré lot5 accepte200000 et refuse200001/2000000 (`EXTRACTION_UNCONFIRMED`) ; JSON simple `{text}` de2Mcaractères ASCII =2000011octets, Unicode `é` =4000011octets, tous deux au-delà de1MiB. Ce sont des preuves de bornes, pas une extraction réelle ou une recette de parité.
- `analyze-document` teste les tags `cotation` puis `douane` **avant** `analysisType==='transit_order'`, puis BL. Intake envoie transit_order, mais les tags détectés peuvent sélectionner un autre prompt. Tout raccord doit conserver tags, ordre des branches, substring8000, modèle/options existants et parser JSON/raw fallback ; ne pas forcer un nouveau prompt. Aucun arbitrage métier sur ce comportement n'a été déduit.

### 16.2 Choix de conservation à valider avant code

| Option locale à préparer | Effets et limites |
|---|---|
| **Recommandée : archive SQL protégée séparée, référencée par opération/ticket/source/hash** | Conserver le texte jusqu'à la borne legacy2Mcaractères et les métadonnées existantes ; sorties de tickets et vues de reprise portent référence/empreinte/aperçu, pas toute l'archive. Accès serveur sous acteur/admission, intégrité append-only et rétention explicite. Évite un nouveau bucket ou changement d'accès, mais exige un contrat de persistance/lecture et une migration locale supplémentaire à revoir avant application future. Les bornes de métadonnées réelles doivent être spécifiées sans troncature implicite. |
| Élargir explicitement le registre JSON existant | Moins de séparation, mais agrandit sorties, événements, réponses de reprise et mémoire ;1MiB→2M caractères n'est pas une conversion valide pour Unicode/échappement/métadonnées. Il faut dimensionner et vérifier les bornes de tous les lecteurs/écrivains, duplication et confidentialité ; ne pas simplement augmenter une constante. |

Une archive objet pourrait aussi exister, mais ses ACL/versionnement/immutabilité ne sont pas attestés ; le bucket workspace actuel ne permet pas de revendiquer une archive acteur privée immuable. Aucun nouveau bucket, accès, stockage externe ou transformation n'est engagé. Le choix SQL recommandé reste **proposé**, pas validé ni implémenté par cette analyse.

### 16.3 Raccord fournisseur minimal après ce choix

Branche ticket optionnelle aux deux points d'entrée existants : même Auth, octets téléchargés sous droits et vérifiés, algorithmes/prompts inchangés ; éviter leurs insert/update legacy non idempotents en mode ticket, persister résultats et tags dans l'archive choisie puis terminer le journal. Lookup = lecture persistée sur acteur/opération/claim/source exacts. Les jobs de documents du19/10 fournissent un précédent de begin/finish/source snapshot, mais exigent un quote_case et des sources case_documents existants ; l'intake avant création canonique ne peut pas les adopter en créant prématurément un dossier ou en omettant leurs protections.

| État observable sûr | Reprise permise |
|---|---|
| Jamais autorisé au lancement : aucun begin durable pour ce ticket | Action utilisateur explicite, CAS serveur avant fournisseur ; seul gagnant d'un accusé CAS confirmé peut appeler le fournisseur |
| Résultat confirmé persisté, source/ticket/acteur conformes | Retour du résultat conservé, aucun nouvel appel ni rattachement sur simple nom/document_id |
| Lancement possible sans résultat confirmé : begin accusé perdu, crash après begin, appel/résultat/persistance incertains | UNKNOWN et lookup seulement ; aucun reset/expiration/retry implicite |

Le CAS service-only doit verrouiller opération/étape, recontrôler admission/acteur/source et consigner l'autorisation une seule fois **avant** fetch. Un crash après CAS mais avant fetch est indistinguable d'un appel parti sans résultat : `started` n'est ni exécution prouvée ni facturation prouvée. Empêcher deux autorisations par ticket ne garantit pas exactement-une-exécution ou récupération de toute réponse externe perdue. Sans idempotence/lookup fournisseur attestés, une nouvelle tentative peut doubler la consommation : sa politique explicite (nouvel identifiant, ancienne tentative conservée, information/accord opérateur et limites) reste à valider ; aucun refus permanent déclaré opérationnel, aucun nouveau coût autorisé ici.

### 16.4 Vérifications et actions externes restantes

- Contre-revue indépendante **statique** : arrêt sur choix de conservation, conservation tags/priorité prompts et limites CAS confirmés ; aucun test contre-exécuté. CI/tests applicatifs complets du lot6 **NOT_RUN**, justifié par absence de modification exécutable ; résultats1330Vitest/2671Deno/39SQL du lot5 restent historiques. Contrôle diff, empreintes/copies et trois sondes du validateur seulement effectués ici. Reçu `scripts/railway-exit/verification-stage6-analysis.json`.
- **Aucune action externe nécessaire pour trancher puis développer localement** le choix ci-dessus. Après implémentation, tests locaux et revue : soumettre GO séparé du SHA/diff pour commit/push work et livraison Lovable ciblée ; vérifier projet/env/schéma/ACL/rétention en lecture autorisée ; appliquer seulement migrations nommées et déployer endpoints nommés. Effets : nouveaux schéma/binaire/routage candidat ; aucun de ces effets engagé par ce GO local.
- Recette connectée ensuite sous cible/acteurs/fixtures et limites explicites : Auth/RLS/Storage, formats/OCR/analyse/accusés/doublons/fichiers modifiés, puis cotation prix/version/PDF. Uploads/écritures de fixtures et éventuelle consommation IA nécessitent autorisation précise ; aucun test réel engagé ni fournisseur actuel déclaré idempotent sans preuve.
- Conservation Railway inchangée§15.4 : inventaire réel puis export privé/restauration isolée des cinq tables+fichiers sous GO précis, résultats UNKNOWN ; neutralisation du seul module camion reporté, arrêt web réversible puis destructions/abonnement sous accords distincts seulement après preuves. Incident credentials ouvert ; ni cette analyse ni l'arrêt futur ne révoquent une clé externe.

Retour local de ce lot : seulement les quatre notes et le reçu d'analyse depuis la copie stage6 ; préserver tous fichiers/copies/preuves antérieurs. Aucun rollback, effacement, serveur/conteneur temporaire ou maintien éveillé lancé.


## 17. Lot7 PJ — archive protégée et raccord backend récupérable, 22 octobre 2026

**Préparation backend locale PASS ; parité PJ/application PARTIAL.** Le choix SQL séparé et UNKNOWN sans relance a été validé après le lot6. Frontière livrée : API candidate et persistance testables, écran PJ toujours non raccordé ; aucun trafic actif modifié. Base `work/e79b1c5c9ab3164e1f16f84e265ed7a5068b8023` locale/GitHub inchangée au préflight ;193 fichiers copiés avant modification dans `C:/Users/DELL/Documents/Codex/2026-10-22/task-2/manual-intake-stage7-before/`. Reçu final `scripts/railway-exit/verification-stage7.json` : delta exact, empreintes et préservation. `.claude`, copies, preuves, moteurs camions reportés et migrations précédentes conservés.

### 17.1 Contrats et intégrité préparés

- Migration **`20261022183000_prepare_intake_document_archive.sql` locale NON APPLIQUÉE** : archives séparées append-only, acteur/opération/étape/claim/empreinte fichier/texte/payload liés ; texte complet legacy jusqu'à2000000 unités UTF16, métadonnées/tags/types et analyse conservés. Le journal ne duplique pas le texte complet : références/empreintes et vues bornées. Aucun plafond arbitraire supplémentaire de métadonnées, aucune nouvelle durée de conservation ni purge automatique inventés ; RESTRICT empêche l'effacement de l'histoire liée.
- Auth/admission existantes, propriétaire de l'opération et octets sous JWT vérifiés ; begin/source/result/complete recontrôlent acteur et admission après attente/verrou. Tables privées sans accès direct ; seuls RPC de lecture sous JWT/propriétaire ou attestations service-only. Écritures canoniques dossier/faits/snapshot restent sous JWT. La complétion archive+étape+événement est atomique ; l'ancien finisher ne peut pas contourner une archive après dispatch.
- Les branches ticket optionnelles de `parse-document` et `analyze-document` réutilisent extraction/OCR/détection, tags et prompts existants. Priorité cotation puis douane avant transit_order puis BL conservée ; découpe8000, modèle/options, parser JSON/raw fallback inchangés. Comparaisons exactes avant/après dans `verification-archive-legacy-owners.json`, confirmées par contre-revue. Mode ticket évite les insert/update `documents` legacy non idempotents ; mode autonome courant inchangé.
- `manual-intake-recovery/archive-worker.ts` orchestre les étapes existantes via JWT ; fichiers retéléchargés/vérifiés par SHA et réutilisés, ticket exact requis. `document_result` restitue aperçu/tags/type ou analyse et références correspondantes, jamais l'archive complète ou ses métadonnées internes. Les contrats client décodent/vérifient ces références. Aucun branchement App ou écran PJ ajouté.

| État durable | Conduite implémentée |
|---|---|
| Ticket jamais autorisé au lancement | Action explicite, CAS avant effet ; seul `started:true` effectivement reçu autorise l'appel. Lecture/reprise seule ne lance rien. |
| Complétion confirmée | Relecture du même UUID/claim/source ; perte d'accusé après transaction récupérable, sans nouvel appel fournisseur ni nouvelle archive. |
| Begin accusé perdu, crash ou résultat/persistance incertains | UNKNOWN conservé ; aucun retry/reset/expiration automatique, aucune relance manuelle payante autorisée. Begin prouve une autorisation, pas une exécution ou facturation. |

Le CAS ne garantit pas exactement une exécution fournisseur et ne récupère pas une réponse perdue avant sa persistance. UNKNOWN sans issue attestée reste un flux bloqué, pas un succès opérationnel ; une politique d'intervention future exige un choix explicite distinct.

### 17.2 Bornes, confidentialité et écarts conservés

- **Unicode corrigé sans détruire l'archive** : si le préfixe legacy200000 coupe une paire de surrogates, le texte complet valide reste archivé ; `case_text` est NULL avec preuve du préfixe valide et marqueur `legacy_prefix_invalid_utf16`. Le lien crée le reçu **`unconfirmed_legacy_prefix_utf16`**, sans annoncer « extracted ». L'UI devra restituer cette réserve. Une découpe legacy à2M qui rend le texte complet lui-même invalide reste non prise en charge ; pas de réparation/troncature inventée ni PASS global Unicode.
- Accès candidat borné au propriétaire et admission du journal, sans élargir les ACL existantes. **Parité des droits de collaboration UNKNOWN** : les migrations legacy `documents` ont évolué (anciennes politiques publiques retirées, restriction workspace), et le lecteur service actuel ne prouve pas une politique acteur. Aucun droit actuel modifié ; confirmer le besoin de partage et la baseline Cloud avant activation, ne pas inventer un droit ou une durée. Le bucket `case-documents` garde ses ACL workspace et mutabilité actuelles ; un contrôle SHA ne constitue pas une garantie d'immutabilité après contrôle.
- Fichier10MiB et sept formats legacy conservés. L'archive2M est séparée du journal1MiB ; formulaire manuel262144octets toujours borné. Une analyse trop volumineuse peut donc rester refusée au formulaire : refus sûr, pas parité métier. Limites réelles Edge/PostgREST/Storage/JSON/mémoire et grands payloads connectés non attestées. Les métadonnées JSONB legacy ne sont pas tronquées.
- Preuve positive nouvelle sur CSV/extracteur et handler d'analyse réels avec transports simulés. Les régressions des moteurs PDF/image existants passent, mais cela ne certifie pas chaque format/OCR via cette nouvelle branche ticket. Aucun vrai mail, PJ, Storage, secret ou IA utilisé ; aucune tarification/règle métier modifiée. Écran candidat encore texte seul, flux PJ complet et résolution opérateur de UNKNOWN non livrés.

### 17.3 Vérifications effectivement exécutées

- **56 scénarios PostgreSQL15 PASS** :39 antérieurs+17 archive, données/claims synthétiques, vrai verrouillage de sessions concurrentes (CAS et révocation pendant lecture), propriété/grants, références/hash, rollback archive/étape/événement, rejeu, anti-contournement legacy, conservation2M/UTF16 et liaison réservée. `verification-archive-sql.json` : réseau none,0port,0bind,tmpfs ; seul conteneur jetable supprimé, **REMOVED_VERIFIED**. Auth réelle/PostgREST/Storage/fournisseurs absents du banc SQL minimal.
- **10 tests Deno ticket PASS**, handlers parse/analyze/recovery réels ; transports Auth/RPC/Storage/IA strictement simulés, sans permission réseau. Pipeline positif extraction→archive→analyse→projection→freeze→commit→link, tags/priorité prompts, source modifiée/acteur/révocation, pertes d'accusés avant/après transaction, UNKNOWN sans doublon, Unicode. RPC de ce banc en mémoire : ne pas confondre avec les56 tests PostgreSQL séparés. Multipart Storage SDK intercepté avant sérialisation : pas de preuve de l'upload HTTP Cloud.
- **CI locale complète9portes PASS_WITH_BASELINE**, `verification-ci-stage7.json` : **1330Vitest/87fichiers,2681Deno/0échec/6ignorés**, types app/node, fonctions/bundles/build PASS ; Deno49erreurs/5buckets et lint708erreurs/16warnings inchangés, seuil hérité732/16. Tests isolés des services réels. Premières erreurs de fixtures/alias SQL et tentatives intermédiaires conservées dans les logs/reçus, pas promues en succès ; répétitions après résultat connu et nettoyage vérifié.
- Contre-revue indépendante **statique PASS après corrections** : verrou/admission avant lecture, garde de l'ancien finisher et coupure UTF16 signalés/corrigés ; extraction/prompts comparés inchangés. Aucun test contre-exécuté par le réviseur. Aucun outil refusé ce lot, aucune opération externe à résultat incertain ; pas de serveur navigateur ou maintien éveillé lancé.

### 17.4 Suite minimale et actions externes à soumettre, aucune exécutée

1. **Prochain lot local utile** : raccorder upload et UI PJ aux tickets/projections préparés, afficher réserves/UNKNOWN et récupération explicite, protéger changement d'acteur/navigation ; tests synthétiques de l'écran et de chacun des formats nécessaires. Le présent GO ne transforme pas ce backend candidat en parcours opérationnel ; ne pas activer App ni détourner le trafic. Pas d'action externe indispensable pour ce lot local.
2. **Avant livraison**, soumettre le SHA/diff exact pour commit/push `work` et CI GitHub ; aucun commit/push réalisé. Confirmer en lecture le projet Lovable canonique `c3b5e3c2-511e-4e1e-b88d-a47fe5ff5aef`, environnement privé et correspondance runtime, ledger/schema/ACL/droits de collaboration/rétention. Cette identité historique doit être revalidée, aucune cible Supabase Cloud directe.
3. **GO Cloud distinct**, après ces contrôles : appliquer une fois via Lovable les migrations candidates `20261022130000_prepare_durable_intake_snapshot.sql`, `20261022170000_prepare_intake_recovery.sql`, puis `20261022183000_prepare_intake_document_archive.sql` ; comparer signatures/grants/triggers/contraintes et empreintes au ledger avant répétition. Effets : nouveaux snapshots/journal/archive privés et RPC ; aucun droit supplémentaire, TTL ou DROP implicite. Déployer explicitement **manual-intake, manual-intake-recovery, parse-document, analyze-document**, puis build privé revu ; activation de la route candidate seulement après recette et GO précis. Aucun de ces effets engagé ici.
4. **GO recette connectée borné** : acteurs/fixtures synthétiques nommés, Auth/Storage/RLS et sept formats/OCR, tags/prompts, grandes sources/Unicode, doublons/pertes d'accusés/session/révocation, puis cotation simple prix/version/PDF sans Railway. L'upload, écritures Cloud et éventuels appels IA nécessitent leurs cibles, limites et budget explicitement autorisés ; aucun nouvel essai réel implicite. Une bascule reste bloquée si un cas V1 requis n'est pas opérationnel.
5. **Conservation réelle Railway avant arrêt**, projet `0aa0f712-dc83-4c3b-aa7e-76de271ca328` / gleaming-respect / production / web / Postgres / postgres-volume à reconfirmer : inventaire métadonnées puis export cohérent privé des cinq tables **case_files,case_inputs,case_events,case_tasks,case_outputs**, schéma/FK/index/extensions et fichiers référencés. Destination/responsable/accès/rétention approuvés, manifeste/hashes/version/date, restauration isolée attestée avec cardinalités/IDs/contraintes/fichiers. **UNKNOWN**, aucun export ou contenu lu, aucun snapshot Lovable assimilé à ce backup. Conservation inconnue bloque l'arrêt.
6. Après équivalence et restauration, soumettre neutralisation du seul module camion reporté, arrêt **réversible** web en conservant base/volume et procédure de rétablissement, puis retrait définitif séparé. Suppression web/base/volume destructive et résiliation abonnement sont des cibles/effets distincts, avec sauvegarde attestée et accords spécifiques ; l'arrêt seul ne certifie aucune fin de facturation. Incident credentials distinct ouvert : ni migration ni arrêt ne révoquent les clés externes ; aucune rotation autorisée ici.

Retour local : restaurer seulement les fichiers du delta stage7 depuis `manual-intake-stage7-before/files/` après contrôle des empreintes ; les nouveaux fichiers sont identifiés au reçu, ne pas nettoyer ni supprimer les preuves. Après adoption future : désactiver le nouveau routage sous GO, conserver archives/dispatch/journaux/snapshots/objets/RLS et corriger en avant ; ne pas DROP l'histoire adoptée.


## 18. Lot8 — écran/PJ candidat raccordés localement, clôture du 23 octobre 2026

**PASS du lot local borné ; équivalence connectée/V1 et sortie Railway PARTIAL/UNKNOWN.** Le raccord écran/upload aux tickets du lot7 est terminé dans le banc uniquement, sans refonte ni nouveau module métier. App reste `<Intake/>` sans injection du candidat. Préflight reprise : `work/e79b1c5c9ab3164e1f16f84e265ed7a5068b8023` local/GitHub identique ;235copies avant lot8 valides et238fichiers d'état interrompu recopiés/vérifiés le23/10 dans `manual-intake-stage8-resume-20261023/`, sous `C:/Users/DELL/Documents/Codex/2026-10-22/task-2/`. Aucun fichier/copie/preuve/.claude nettoyé. Delta final et empreintes : `scripts/railway-exit/verification-stage8.json`.

### 18.1 Frontière livrée et garanties

- `recoverySession.ts` réutilise le registre existant : même UUID enregistré en URL avant effet, descriptor réel (nom/type/taille/SHA des octets), upload sans écrasement, extraction/analyse sous tickets et projection archivée, préremplissage enregistré avant restitution. Le formulaire reste corrigible avant préparation, puis dossier/snapshot/faits et rattachement ont leurs reçus distincts vérifiés. Un reçu dossier seul ne rend pas la PJ liée ; un reçu document doit correspondre exactement au dossier/document/path/SHA. Relecture après accusé perdu ne réexécute ni upload ni fournisseur.
- `IntakeRecoveryCandidate`/props optionnelles d'`Intake` exposent sélection/retrait avant engagement, progression honnête, interruption, reprise explicite et réserve Unicode. Une absence/refus/UNKNOWN ne crée pas une nouvelle demande. Retour/navigation/reload restaure les informations effectivement enregistrées côté serveur, pas une promesse de persistance de chaque frappe non soumise. Aucun contenu/token en stockage navigateur ; URL UUID seul. Une PJ enregistrée ne peut pas être remplacée silencieusement ; un fichier rechoisi doit être rapproché des octets d'origine avant analyse ou soumission.
- Corrections de contre-revue : garde de contexte au point d'upload et après la dernière sauvegarde ; interruption avant UUID retourne au formulaire ; fichier B affiché ne peut pas être soumis en liant A ; **Nouvelle analyse efface explicitement fichier/source/analyse** après clôture confirmée et alloue un UUID distinct. Les réserves `unconfirmed_legacy_prefix_utf16` restent visibles, sans faux succès d'extraction. Retour à la ligne des seuls nouveaux états PJ testé en390px, composants/tokens existants conservés.
- `createRecoveryUploadPort` dans le fichier existant `recoveryUpload.ts` fournit la liaison SDK explicite à la future recette : JWT capturé, acteur vérifié, en-tête Authorization épinglé, `upsert:false`, garde après attente Auth et avant SDK. Le SDK installé accepte et conserve cet en-tête par upload. Aucun client/URL/secret par défaut ni appel automatique. Le banc navigateur utilise un port localhost simulé ; la liaison SDK est testée séparément sur transports synthétiques. **Interrompre ne garantit pas l'annulation d'un upload déjà confié au SDK** : son issue reste à vérifier, sans nouvel envoi aveugle ni suppression d'objet.
- Aucun moteur extraction/IA/prompts/règle métier, code camion ou SQL modifié dans ce lot. Les trois migrations candidates restent locales NON APPLIQUÉES.56tests PostgreSQL du lot7 sont historiques, pas réexécutés ici ; leurs fichiers SQL sont restés identiques par empreinte.

### 18.2 Preuves réellement acquises

- **70 tests ciblés PASS** (`test-stage8-final.log`) : formulaire texte/PJ et session, entrée fichier seule, sept extensions au niveau descriptor/upload simulé, invalides/octets changés, UNKNOWN, pertes d'accusés upload/étape/save/commit/link, même UUID/absence de doublon, interruption/Auth/acteur, préfixe UTF16, reset et liaison SDK. Les sept extensions factices ne constituent pas une preuve de parsing/OCR de sept formats.
- **CI locale finale9portes PASS_WITH_BASELINE :1359Vitest/87fichiers,2681Deno/0échec/6ignorés**, types app/node, configuration/bundles/build PASS ; dette Deno49/5 et lint708/16 inchangée (seuil732/16). Réseau live interdit aux tests, fichiers env désactivés ; reçus `verification-ci-stage8.json` et logs voisins. Échecs intermédiaires conservés : message texte seul rétabli, deux signatures de mocks corrigées ; aucun FAIL effacé ni présenté comme preuve finale.
- **Navigateur intégré officiel IAB, localhost uniquement** : CSV du banc→upload/préremplissage Unicode→navigation/lecture explicite→accusé de link perdu/UNKNOWN visible→lecture du reçu→reload réel après confirmation→nouvelle lecture. Premier parcours :1upload/1extraction/1analyse/1dossier lié. Puis Nouvelle analyse : formulaire sans ancienne PJ/analyse,2eUUID texte seul ; totaux2dossiers/1upload/2archives, pas de nouveau traitement documentaire. `verification-stage8-browser-ui.json`, `verification-browser-stage8-one-request.json` et `verification-browser-stage8.json`. Captures bureau/mobile dans le dossier task-2 (`stage8-intake-document-final.jpg`, `stage8-intake-document-mobile.jpg`). Auth/RPC/Storage/fournisseur du navigateur sont simulés ; registre Node en mémoire survivant au reload, pas au redémarrage serveur.
- Export de preuve du premier banc en échec (adaptateur Vitest minimal sans mock.calls) conservé en `verification-browser-stage8-attempt1.json`, puis compteur corrigé et scénario rejoué sur registre neuf. Ancien port59762 trouvé fermé à la reprise ; ports51567/55352/57526 ensuite fermés et0processus de banc vérifié. Dernier serveur : `RECOVERY_SERVER_CLOSED`, exit0 ; onglet propre fermé, override viewport réinitialisé, aucun fichier supprimé, conteneur ou maintien éveillé créé. Reçu `verification-stage8-cleanup.json`.
- Contre-revue indépendante **statique PASS borné**, corrections et port SDK relus sans contre-exécution. Audit statique limité aux deux fichiers UI projetés avant/après :5→3constats hérités,0nouvelle violation ; strict exit2 pour contrats DESIGN/UX/carte absents dans la projection, donc pas un PASS de conformité globale. Aucun nouveau contrat Markdown créé sous prétexte de ce contrôle ; les règles métier/permissions restent celles du dépôt et du GO.

### 18.3 Limites et minimum externe à soumettre

**Aucun défaut local bloquant détecté dans le périmètre du banc ; pas de mise en service attestée.** Restent ouverts : droits collaboratifs réels et ACL/ledger/rétention Cloud, Auth/JWT/PostgREST/Storage réels, chaque format/OCR via ticket, tailles/ressources connectées, prix/version/PDF, fournisseur dont la réponse serait perdue avant archive. UNKNOWN ne devient jamais opérationnel par son refus sûr ; aucune relance manuelle payante autorisée. Limites héritées du §17 (découpe2M pouvant produire un surrogate invalide, formulaire262144octets, bucket partagé/mutable, pas de nouvelle durée/droit) conservées ; une variante V1 requise encore bloquée interdit une bascule complète.

1. **GO publication distinct** du diff agrégé revu/des empreintes pour commit/push `work` et CI GitHub exacte. Aucun commit/push réalisé. Préserver les changements des lots antérieurs ; aucun .claude/secret/copie de données dans le lot à publier.
2. **Préflight connecté en lecture autorisée**, reconfirmer projet Lovable `c3b5e3c2-511e-4e1e-b88d-a47fe5ff5aef`, environnement privé/runtime canonique, ledger/schema/signatures/grants/bucket. Minimum à trancher pour les droits : qui doit lire l'archive/résultat de l'intake, propriétaire seul ou collaborateurs déjà admis ; accès aux binaires workspace et règles de conservation/suppression existantes. Aucune nouvelle politique inventée ; divergence avec le candidat privé bloque son activation.
3. **GO Cloud précis** après ce préflight : migrations130000→170000→183000 nommées au §17.4, une fois selon ledger ; déployer `manual-intake`, `manual-intake-recovery`, `parse-document`, `analyze-document`. Effets : tables/RPC candidats protégés et branches ticket optionnelles. Build privé/banc connecté explicitement injecté avec `createRecoveryGateway` et `createRecoveryUploadPort` du client Auth existant, acteur issu du même provider ; aucun fallback, flag global ou route par défaut activé implicitement. Lovable Cloud seulement, jamais Supabase Cloud direct.
4. **GO recette connecté synthétique** avec acteurs/fixtures/destination/budget fournisseur nommés : Auth/RLS/Storage et sessions/révocation, sept formats/OCR/tags/résultats, tailles/Unicode, accusés/doublons/rattachement, puis demande simple jusqu'au prix/version/PDF sans Railway. Écritures, uploads et IA réels ont leurs autorisations propres. Basculer uniquement après preuves et accord explicite ; les succès du banc ne valent pas recette Cloud ou réception V1.
5. **Conservation avant arrêt** inchangée : Railway projet `0aa0f712-dc83-4c3b-aa7e-76de271ca328`/production/web/Postgres/volume à reconfirmer, cinq tables `case_files,case_inputs,case_events,case_tasks,case_outputs` et fichiers référencés. Inventaire/export privé cohérent/manifeste puis restauration isolée attestée sous destination/responsable/accès/rétention approuvés restent **UNKNOWN**, bloquent arrêt. Ensuite neutralisation ciblée du module camion reporté et arrêt web réversible sous GO ; suppression web/base/volume et résiliation abonnement sont des opérations distinctes avec accords spécifiques. Incident credentials distinct ouvert, aucune rotation ; arrêt/migration ne révoquent pas les clés externes.

Retour local : restaurer seulement le delta manifeste depuis `manual-intake-stage8-before/files/` ou l'état de reprise du23/10 selon la cible souhaitée, après contrôle d'empreintes ; conserver preuves, copies et lots antérieurs. Après adoption future, désactiver le candidat sous GO et corriger en avant sans DROP des archives/journaux/snapshots/objets/RLS. Rien de cela exécuté ici.

## 19. Préflight Lovable en lecture seule — 23 octobre 2026

**PARTIAL : métadonnées vérifiées, aucune livraison ni recette applicative.** GO limité aux catalogues nécessaires aux trois migrations et quatre fonctions candidates. Connecteur officiel Lovable, six SELECT réussis comme postgres : pas de test JWT ni de RPC exécutée. Aucun contenu métier, mail/PJ, objet Storage, attribution de rôle ou secret lu ; ancienne lecture refusée du cache PJ IMAP non rejouée. Aucun navigateur nécessaire, aucun appel applicatif/IA ou changement Cloud.

### 19.1 Cibles et état constatés

- Projet Dakar Cargo Quotes, c3b5e3c2-511e-4e1e-b88d-a47fe5ff5aef, Cloud activé ; configuration source project_id=snjewofqxfsdmaszapux. Dépôt C:/Users/DELL/Projects/dakar-cargo-quotes, work ; HEAD/GitHub/Lovable tous e79b1c5c9ab3164e1f16f84e265ed7a5068b8023, sans avancement depuis11:06 ni réconciliation. Les68empreintes lot8 correspondaient avant ces notes ; code/SQL/copies/.claude préservés.
- API projet : visibility=workspace_edit et is_published=false ; ces métadonnées concernent l'éditeur/publication et ne démontrent pas les droits aux données applicatives ni une exposition de secrets.
- Ledger dernière version 20261020115000_unknown_container_fields_comparison, zéro des trois versions candidates ; six nouvelles tables candidates et RPC record_intake_snapshot/manual_intake_% absentes. Pas de collision détectée dans les objets examinés ; pas une garantie d'applicabilité générale.
- Prérequis observés : quote_cases,quote_facts,intake_fact_batches,case_timeline_events,case_documents,documents,app_roles, colonnes Auth nécessaires, signatures helpers et set_intake_facts_batch(uuid,text,text,text,text,jsonb). RLS active sur ces sept tables ; intake_fact_batches sans politique/grant client. Contraintes : lot unique(case_id,batch_key), PJ unique(case_id,file_name), fait courant unique(case_id,fact_key). Aucune FK case_documents.case_id retournée : ne pas lui attribuer une intégrité inexistante.
- supersede_fact protège les faits validés/opérateur et l'ordre des révisions ; trigger quote_facts_ordered_source_guard actif. Un refus protège l'existant, sans prouver une parité positive sur un dossier existant. Comparaison des corps SQL avec les migrations locales dans le reçu, sans exécution.

### 19.2 Droits techniques, intention métier encore à confirmer

| Périmètre | Définition connectée observée | Conséquence pour le candidat |
|---|---|---|
| Admission | workspace_operator ou role_admin, compte non banni | Même admission prévue ; identité/renouvellement/révocation réels NOT_RUN |
| Dossiers/faits | Lecture partagée des membres admis ; modification dossier créateur/assigné | Snapshot partagé via case-read, mais journal/reprise/archive complète/résultat réservés à l'acteur initial |
| case_documents | Lecture équipe ; insertion/suppression uploaded_by ; pas de politique permissive UPDATE | Unicité nom/dossier à tester ; aucune nouvelle permission |
| documents legacy | Lecture et suppression par utilisateur admis ; pas de politique permissive INSERT/UPDATE | Archive candidate plus restrictive ; aucune reprise implicite du droit de suppression |
| Storage case-documents | Privé ; SELECT/INSERT/DELETE pour membre admis sans restriction propriétaire/chemin ; pas UPDATE permissif | Partagé et mutable, même avec empreinte et upsert:false |
| Storage documents | Privé ; SELECT membre admis ; pas de politique INSERT/UPDATE/DELETE applicable relevée | Conservation/restauration des anciens binaires toujours non attestée |

Les grants seuls ne démontrent pas l'accès effectif : les politiques permissives se combinent avec la restrictive workspace. RLS storage.objects active ; ensemble des politiques lu pour vérifier celles applicables aux deux buckets, sans lire d'objet. Les deux buckets ont file_size_limit=NULL et allowed_mime_types=NULL ; les limites applicatives restent distinctes. Requête administrative, pas preuve d'accès d'un utilisateur concret.

**Décisions avant activation :** les collaborateurs doivent-ils seulement lire les éléments du dossier canonique partagé, ou également consulter/reprendre le journal, l'archive complète et l'analyse d'un autre acteur ? L'écart de portée est attesté ; son acceptabilité métier reste UNKNOWN. Conserver les politiques existantes, sans ouvrir l'archive par défaut. L'absence de TTL ne prouve pas la politique de conservation : les RESTRICT candidats peuvent bloquer suppression dossier/acteur, à distinguer des liens CASCADE existants. Responsable, obligations et procédure de conservation/suppression/restauration à confirmer ; aucune durée ni nouveau droit inventé.

### 19.3 Contre-revue : deux écarts de qualification locale

Revue indépendante statique **PARTIAL**, sans SQL/tests/accès externe. Le banc test-intake-sql.cjs:13 charge supersede_fact du18/10 à15h ; il ne charge pas le writer avec révisions ordonnées et trigger observés. Un PT409 non traduit dans manual-intake-recovery/handler.ts:51–57 peut devenir RECOVERY_UNCONFIRMED/UNKNOWN après refus transactionnel. Le corps distant est composé par la migration181900 via pg_get_functiondef/replace : une absence de correspondance littérale CREATE dans le reçu ne démontre pas une dérive Cloud inattendue.

La fixture recovery-sql-scenarios.cjs:5 omet UNIQUE(case_id,file_name). Le candidat SQL183000:237–240 contrôle la collision UUID, puis insère ; un conflit de nom peut refuser le lien PJ alors que le dossier est déjà commité par une transaction antérieure, avec 23505 brut classé UNKNOWN. Atteignabilité et récupération explicite de ce cas non testées, aucun écrasement/corruption démontré. Les56PASS SQL historiques ne prouvent donc pas la compatibilité avec ce schéma/writer exacts. **Avant activation : qualifier localement sur synthétique la fixture alignée et ces diagnostics/reprises, sous lot distinct ; aucun correctif ici.** Refus sûr/UNKNOWN ne vaut pas fonctionnement opérationnel.

### 19.4 Paquet externe minimal à soumettre, non exécuté

1. Arbitrer audience/cycle de vie, qualifier les écarts locaux §19.3 et accepter les limites §18.3 ; revue du diff agrégé puis GO distinct commit/push work et CI GitHub exacte. Aucun correctif applicatif dans ce préflight, candidat toujours inactif.
2. Destination unique : **Lovable Cloud projet c3b5e3c2-511e-4e1e-b88d-a47fe5ff5aef / backend snjewofqxfsdmaszapux**. Recontrôler ledger/schéma avant tout GO d'application ; ordre exact : **20261022130000_prepare_durable_intake_snapshot.sql → 20261022170000_prepare_intake_recovery.sql → 20261022183000_prepare_intake_document_archive.sql**. Effets : snapshot transactionnel dossier/acteur, journal idempotent protégé, archive/tickets persistants et RPC à grants restreints. Migrations locales NON APPLIQUÉES ; aucune nouvelle durée de conservation.
3. Sous GO distinct et artefacts revus, déployer exactement **manual-intake, manual-intake-recovery, parse-document, analyze-document** et leurs dépendances partagées. Config commit e79b1c5 : parse/analyze présents avec verify_jwt=false, nouveaux candidats absents du fichier ; handlers sources requireUser/admission workspace. verify_jwt=false seul ne signifie pas endpoint public. **Versions/empreintes binaires Edge déployées UNKNOWN** : le connecteur exposé ne les liste pas ; aucun appel de fonction pour les inférer. Attester ces métadonnées avant remplacement sous autorisation adaptée.
4. Banc privé explicitement injecté avec createRecoveryGateway/createRecoveryUploadPort, même client/provider Auth, sans activation App par défaut. Recette connectée synthétique sous GO nommant acteurs, fixtures, destination Storage et budget IA : Auth/RLS/Storage/collaboration décidée, conflits nom/dossier/faits protégés, sessions/révocation, formats/OCR/Unicode/tailles, incertitudes/reprises, demande simple jusqu'au prix/version/PDF. Tests connectés NOT_RUN ; CI applicative NOT_RUN dans ce tour sans code modifié.
5. Railway : conservation/export privé/restauration isolée des cinq tables case_files,case_inputs,case_events,case_tasks,case_outputs et fichiers référencés **UNKNOWN**, arrêt bloqué. Projet0aa0f712-dc83-4c3b-aa7e-76de271ca328 à reconfirmer avant autorisation séparée. Neutralisation du seul module camion reporté puis arrêt réversible, suppression service/base/volume et résiliation restent des actions distinctes. Incident credentials ouvert ; aucune rotation ni modification d'accès.

Preuve : scripts/railway-exit/verification-lovable-preflight.json (requêtes/résultats métadonnées, corps SQL comparés, empreintes et delta documentaire). Sauvegardes quatre documents/reçu lot8 : C:/Users/DELL/Documents/Codex/2026-10-22/task-2/lovable-preflight-before/. Aucun UNKNOWN applicatif promu PASS ; retour local limité aux notes par sauvegardes/empreintes, préserver les lots antérieurs. Aucun commit/push/déploiement/migration appliquée/arrêt/résiliation.

## 20. Collaboration intake et conflits attestés — lot local du23/10/2026

**PASS du lot local ; activation/connecté/V1/sortie Railway PARTIAL/UNKNOWN.** GO métier : lecture des nouvelles archives/reprises par l'équipe autorisée au dossier ; reprise/modification par créateur ou responsable assigné, aucune purge automatique. Code, migrations candidates et tests synthétiques uniquement. Work local/GitHub toujours e79b1c5c9ab3164e1f16f84e265ed7a5068b8023 ; aucun commit/push.292fichiers avant lot sauvegardés et vérifiés dans C:/Users/DELL/Documents/Codex/2026-10-22/task-2/intake-collaboration-before/. Copies, preuves, .claude et module camion reporté conservés.

### 20.1 Comportement préparé, toujours inactif

- Candidats170000/183000 adaptés localement,130000 inchangé ; aucune migration Cloud appliquée. Après rattachement attesté, le helper contrôlé exige committed, dossier courant, snapshot exact (clé intake:UUID:v1, identifiant, origine, reçu, source, classification et batch). UUID ou dossier préexistant seul ne partage pas un brouillon. Snapshot canonique préexistant hors journal refusé explicitement MIR_SNAPSHOT_COLLISION, sans adoption implicite.
- Lecture opération/projection/archive complète selon has_case_read_access du demandeur admis ; mutation autorisée seulement selon has_case_write_access courant et l'état déjà permis. Verrous opération→SIFB→dossier→admission, avec relecture après attente : réassignation, bannissement et retrait de rôle ne sont pas contournés. Aucun grant de lecture directe sur les nouvelles tables, fonctions service de début/fin inchangées.
- Avant dossier attesté, origine seule : pas d'équipe ou responsable inventé. La reprise par un collègue d'un brouillon/étape UNKNOWN non rattaché reste non prise en charge ; elle demanderait une décision supplémentaire si souhaitée. Après commit, reprendre ne réécrit pas l'intake figé : restitution du reçu d'origine ou achèvement d'un lien permis ; les corrections de faits du dossier conservent leurs parcours existants et protections.
- Origine actor_user_id immuable, viewer JWT distinct dans la projection access, gardes de session/acteur conservées. Un lecteur sans écriture restaure les informations mais sa session bloque les mutations. Le rejeu du responsable assigné restitue le reçu original sans rappeler SIFB sous son JWT. Une trace resume unique par acteur et les événements de modification distinguent l'auteur courant de l'origine.
- uploaded_by demeure le déposant initial ; l'événement de rattachement conserve actor_user_id courant et evidence.uploaded_by/linked_by distincts. Pas de transfert implicite du droit de suppression d'une ligne documentaire. Archives/tickets/historique conservés, RESTRICT existants du candidat maintenus, aucune purge ou nouvelle suppression manuelle.
- manual-intake-recovery propose archive_read via manual_intake_archive_read sous mêmes contrôles ; texte complet/métadonnées disponibles aux lecteurs autorisés, sans duplication dans le journal. UI/default App inchangés, candidat non injecté ; aucun flag, fallback ou trafic déployé modifié. Ce lot ne construit pas un nouvel écran de gestion collaborative.
- manual-intake et manual-intake-recovery classent PT409 seulement pour les trois diagnostics ordonnés observés, et 23505 pour les diagnostics candidats connus ou contraintes explicitement reconnues. Une erreur de transport, un marqueur/code seul ou un message inconnu restent UNKNOWN. Un refus atteste l'échec de la transaction courante, pas l'absence d'un dossier enregistré auparavant ; il n'efface pas une incertitude antérieure. Collision nom/dossier refuse le lien sans adopter/écraser une autre PJ ; dossier déjà commité et lien non confirmé restent distingués.

### 20.2 Preuves actualisées et limites du modèle

- **80 scénarios PostgreSQL PASS**, dont14nouveaux collaboration/conflits, par invocation exacte : node scripts/railway-exit/test-intake-sql.cjs --manual --archive --collaboration. Reçu verification-sql-dcq-railway-exit-sql-1792775828868.json ; source/writer réels copiés des seules métadonnées du préflight, toutes données synthétiques. Ce sont de nouvelles exécutions, distinctes des56PASS historiques du lot7.
- Comparaison exécutée : **87colonnes capturées/types udt/nullabilité,42contraintes publiques,27politiques publiques,7empreintes de corps SQL identiques**, sur sept tables publiques et les deux colonnes Auth recueillies. supersede_fact et guard_ordered_email_fact correspondent aux corps observés, y compris révisions ordonnées. UNIQUE(case_id,file_name) reproduit et testé. Le modèle ne prétend pas reconstruire toute la base.
- Tests positifs : lecteur équipe/projection/archive HTTP complète2MUnicode, responsable assigné/reçu identique et compteurs faits/batches/timeline inchangés ; identité origine/courant conservée ; dossiers/UUID non attestés et preuves altérées refusés ; deux liens concurrents créent une seule ligne/un seul événement ; assignation/rôle retirés pendant attente refusés. PT409 réellement produit par writer ordonné et23505nomPJ classés BLOCKED ; commit réel local suivi d'accusé perdu classé UNKNOWN, résolu par lecture explicite.
- **18 nouvelles régressions Vitest** ; passe ciblée finale refus65PASS (47existantes+18nouvelles), puis **CI complète9portes PASS_WITH_BASELINE :1377Vitest/88fichiers,2681Deno/0échec/6ignorés**. Deno49/5 et lint708/16 inchangés (seuil732/16). Configuration, bundles, types et build PASS ; reçu verification-ci-stage10.json. Réseau live refusé/env files désactivés ; aucun appel fournisseur réel.
- Contre-revue indépendante finale **PASS borné**, sources et reçus lus, sans contre-exécution. Correctif conservateur après un échec CI : code23505 seul avait été accepté trop largement ; reconnaissance resserrée et ancienne régression rétablie. Les preuves échouées sont conservées (logs/receipt attempt1).
- SQL : première tentative avant moteur disponible NOT_CREATED ; puis fixture source_evidence obligatoire omise après72PASS, et erreur de séparateur lors du regroupement de l'installation. Deux conteneurs de ces tentatives supprimés/vérifiés ; logs attempt2/attempt3 et reçus uniques conservés. Dernier conteneur141dda64c67f… REMOVED_VERIFIED, liste étiquetée vide ensuite. Aucun reset global, port, bind hôte ou volume persistant ; PostgreSQL15/tmpfs/réseau none.
- Docker Desktop était absent des processus, lancé normalement une fois (PID24036) après autorisation précise ; backend présent mais API/statut indisponibles sans cause prouvée, puis moteur29.8.0 disponible après confirmation utilisateur17:10. Aucun forçage, installation, élévation/configuration système ou manipulation de conteneur tiers. Docker Desktop reste ouvert pour l'utilisateur ; commandes temporaires CI/banc/statut terminées, aucun serveur ou maintien éveillé créé.
- **Limites explicites** : Auth/JWT simulés, pas de vrai ES256/PostgREST/Storage/fournisseur/binaire Lovable. Defaults générateurs synthétiques ; typmods/précision/collation/defaults réels non collectés ; seulement statut INTAKE et six types connus, FK externes sur stubsUUID et table révisions issue de la migration locale. PostgreSQL15 ne représente pas le grant administratif MAINTAIN. Comparaison aux métadonnées capturées, pas équivalence du runtime entier. Aucune recette navigateur nouvelle dans ce lot sans changement visuel.
- Les limites §18.3 restent ouvertes : formats/OCR/budgets réels, réponses fournisseur perdues, texte2M/projection Unicode et gros formulaires, prix/version/PDF. Un refus sûr ou une archive préservée ne prouve pas un parcours métier requis opérationnel. Aucune règle métier/tarif/parser/IA ou moteur camion modifié.

### 20.3 Frontière de livraison et paquet externe non exécuté

1. Local prêt pour revue/publication sous GO distinct, candidat toujours inactif. Résoudre seulement les décisions restantes utiles : cycle de suppression/conservation manuelle et responsabilité, acceptation des effets RESTRICT ; collaboration d'un brouillon sans dossier si elle devient requise. L'audience des dossiers attestés est validée, ne pas la redemander comme inconnue.
2. GO précis commit/push work/CI GitHub du diff agrégé revu ; ne publier ni .claude, copies, secrets ou données. Avant livraison, recontrôler source Lovable, ledger et versions/empreintes Edge déployées, toujours UNKNOWN ; aucune réconciliation automatique. Les métadonnées du préflight restent datées, pas relues en ligne dans ce lot.
3. Destination : **Lovable Cloud c3b5e3c2-511e-4e1e-b88d-a47fe5ff5aef / backend snjewofqxfsdmaszapux**. Sous confirmation précise à l'exécution : **20261022130000_prepare_durable_intake_snapshot.sql → 20261022170000_prepare_intake_recovery.sql → 20261022183000_prepare_intake_document_archive.sql** (empreintes finales dans verification-stage10.json). Effets : snapshot, journal, archive/RPC protégés ; lecture des nouvelles archives/reprises élargie de l'acteur seul aux lecteurs du dossier attesté, mutation bornée créateur/assigné et état figé, sans nouveau rôle/tiers/purge. Ce GO local n'autorise pas ce changement d'accès en ligne.
4. Déployer sous GO les quatre fonctions **manual-intake,manual-intake-recovery,parse-document,analyze-document** et dépendances revues. Banc privé injecté explicitement avec createRecoveryGateway/createRecoveryUploadPort du même client/provider Auth, aucune activation App implicite. Recette connectée synthétique distincte : acteurs admis/lecteur/assigné, fixtures et destination Storage nommés, budget IA autorisé, droits/révocation/concurrence/formats/Unicode/tailles/incertitudes, puis cotation simple jusqu'au prix/version/PDF. Aucun upload, recette connectée ou coût fournisseur réalisé ici.
5. Conservation/restauration des cinq tables Railway case_files,case_inputs,case_events,case_tasks,case_outputs et fichiers référencés reste **UNKNOWN**, bloque tout arrêt. Projet0aa0f712-dc83-4c3b-aa7e-76de271ca328 à reconfirmer, export privé/manifeste/restauration isolée sous GO et destination/responsable/accès approuvés. Neutraliser ensuite seulement le module camion reporté ; arrêt réversible, destruction service/base/volume et résiliation sont des accords distincts. Incident credentials séparé toujours ouvert, aucune rotation ; migration/arrêt ne révoquent pas les clés externes.

Retour local : restaurer seulement les fichiers modifiés listés au manifeste depuis intake-collaboration-before/files après contrôle d'empreintes, conserver les nouveaux artefacts inactifs/preuves et toutes les anciennes copies. Retour futur Cloud sous GO : désactiver l'usage candidat puis corriger en avant, sans DROP des archives/journaux/snapshots ou affaiblissement des contrôles. Aucun commit/push/déploiement/migration Cloud/changement d'accès réel/arrêt/résiliation.

## 21. Publication du candidat intake — paquet borné du 23 octobre 2026

GO conditionnel reçu pour un commit/push ciblé vers origin/work, CI et vérification de synchronisation du projet Lovable c3b5e3c2-511e-4e1e-b88d-a47fe5ff5aef ; aucun GO de migration, déploiement Edge, modification des accès ou activation. Préflight local/GitHub/Lovable aligné sur e79b1c5c9ab3164e1f16f84e265ed7a5068b8023 ; aucun avancement divergent.

- Paquet explicite de 44 fichiers : écran/seam et wrapper inactif, contrats/services intake/reprise/upload, deux tests écran et trois suites intake/reprise/collaboration, quatre fonctions candidates et partagé ticket, bundle/générateur/fixture/gardes CI, trois migrations candidates et quatre documents techniques. La liste exacte et les empreintes avant indexation sont conservées hors Git dans C:/Users/DELL/Documents/Codex/2026-10-22/task-2/publication-stage11/.
- Exclus et préservés localement : .claude, moteurs/worker/flotte/CPU camion et tests mixtes, copies/références historiques, captures/logs/reçus et métadonnées connectées. Le banc SQL dépendant du relevé connecté reste local ; ses 80 PASS historiques ne sont pas réattribués à la future CI GitHub. Aucun contenu client ni secret destiné au paquet ; scan borné des ajouts et contre-revue de fermeture des imports.
- Automatismes vérifiés : seul workflow distant CI actif, contrôles/build sans commande de migration/déploiement ; zéro webhook de dépôt exposé par l'API, hooks locaux samples seulement. L'endpoint GitHub installations retourne404, sans conclusion sur les GitHub Apps. La [documentation officielle Git sync](https://docs.lovable.dev/integrations/git-sync-overview#backend-files-in-your-commits) précise que les commits synchronisés ne déploient pas les fonctions Edge et n'exécutent pas les migrations ajoutées ; la publication reste explicite. Un build/preview frontend peut changer.
- App conserve Intake sans injection ; le nouveau code de sa page est livré mais la branche par défaut utilise toujours le parcours actuel. Les fichiers SQL restent candidats NON APPLIQUÉS ; les droits préparés sont du code, aucun accès en ligne modifié. Le module camion reporté n'est pas raccordé/réactivé et son retrait effectif reste à préparer avant arrêt Railway.
- Preuves antérieures : CI checkout complet1377Vitest/2681Deno PASS_WITH_BASELINE et80SQL synthétiques, §20 ; elles incluent des tests exclus du paquet et ne préjugent pas du nombre GitHub. La tentative CI sur export isolé n'a démarré aucun test : lien de dépendances refusé « Accès refusé », sans relance/élévation ; commande suivante sans runner prêt, puis export/scan Git restreint interrompu. Tentatives et copies conservées. La CI du SHA poussé doit être suivie jusqu'à état terminal.
- Frontière : source reçue ≠ build réussi ≠ publication ≠ artefact servi ni binaires Edge. Lire le reçu publication-stage11 hors Git pour SHA distant, CI et métadonnées Lovable réellement obtenus ; aucun statut futur n'est inventé ici. Les contraintes et le paquet externe §20.3 restent applicables. Prochain GO éventuel : versions/ledger puis application ordonnée des trois migrations et déploiement des quatre fonctions avec confirmation précise des nouveaux accès ; recette connectée synthétique/budget fournisseur distincts. Conservation/restauration des cinq tables Railway UNKNOWN ; incident credentials ouvert.

Retour Git sous accord approprié : commit inverse ciblé, aucun reset/force-push ; sans migration ni déploiement serveur dans ce lot, aucun rollback de données à engager. Préserver toutes les copies et modifications hors paquet.

### 21.1 Résultat effectif — notes locales après push, non republiées

Commit6740f7da86a44eb51d4af56b959b770b36869b78 poussé sur origin/work,44fichiers exacts,3966insertions/68suppressions. [CI39997660575](https://github.com/douania/dakar-cargo-quotes/actions/runs/39997660575) **FAIL terminal** (page officielle : Status Failure, durée2m37). Annotations nommées Frontend tests (Vitest) : rejet du buffer par SubtleCrypto.digest à intakeDocument.ts:9 et assertions PJ de IntakeRecoveryCandidate/recovery en échec. Ce verdict vient du statut explicite et des annotations, pas du message générique de chargement de la page. Les lectures gh/API ont subi des timeouts réseau ; aucun rerun. Cause exacte à reproduire : Node20 CI/Node22 local et contexte jsdom différents sont des pistes, pas une cause prouvée. Aucune correction supplémentaire entreprise après cet échec substantiel.

Avant publication :135tests/5suites intake réexécutés PASS avec envDir:false/refus réseau ; bundle et diff-check PASS, contre-revue du paquet et des notes PASS bornée. La CI GitHub reste rouge et ces preuves locales ne la remplacent pas ; les portes postérieures au Vitest ne sont pas revendiquées PASS pour ce SHA.

Lovable latest_commit_sha égal au SHA poussé, événement developer_update completed, is_published:false ; App.tsx, wrapper candidat et SQL183000 lus à ce SHA exactement égaux au texte Git (SHA256). Premier export de preuve Unicode mal sérialisé, conservé, comparaison corrigée par JSON ASCII sans changement des sources. Build frontend autonome/artefact servi/binaires Edge restent UNKNOWN. Lecture ciblée du ledger après push : aucune des trois versions candidates130000/170000/183000 enregistrée ; zéro SQL appliqué par ce lot. Le candidat reste non injecté.

Statut livraison **PARTIAL / CI_FAIL**, aucun GO d'activation/recette Cloud/arrêt. Prochain lot utile : GO borné pour reproduire et corriger la différence du banc CI Node20/jsdom/WebCrypto, conserver les invariants fichiers/empreintes et tests positifs, contre-revoir puis publier le correctif ciblé et revérifier CI. Ne pas contourner en supprimant/ignorant les tests ni relancer sans changement justifié. Seulement ensuite soumettre les opérations externes§20.3 avec leurs effets. Preuves et liste résiduelle dans publication-stage11/publication-result.json hors Git ; tous fichiers hors paquet préservés. Ces notes postérieures restent locales pour accompagner un futur correctif, sans commit docs-only.

### 21.2 Correctif de compatibilité WebCrypto — même livraison autorisée

Le GO parent couvre la résolution ciblée et le commit/push correctif du même paquet. Préflight work/6740f7da86a44eb51d4af56b959b770b36869b78 aligné sur GitHub ; quatre documents dirty et128fichiers non suivis préservés. Sauvegarde des44fichiers du paquet avant correctif dans intake-crypto-stage12/before hors Git. Aucun camion, métier, parseur, Auth/RLS, ticket ou politique modifié.

Cause mécanique démontrée : sous Node20.20.2 déjà présent dans l'image locale postgres-meta:v0.96.6, le code intakeDocument réellement bundlé transmet un ArrayBuffer créé dans un autre contexte VM à WebCrypto et reçoit exactement ERR_INVALID_ARG_TYPE. Le même code accepte ce cas sous Node22 local. Une vue Uint8Array des mêmes octets résout ce refus sous Node20 ; le bundle corrigé produit le SHA256 abc connu. Le problème est le type BufferSource entre contextes, pas une incompatibilité générale de Node20. Les erreurs UI PJ initiales peuvent en être aval ; la nouvelle CI GitHub reste nécessaire pour les confirmer.

Correctif minimal : sha256Bytes utilise une vue typée complète, sans copie en texte, découpe, faux hash ou suppression de contrôle. Bundle et manifeste régénérés. Deux régressions supplémentaires avec le vrai WebCrypto : ArrayBuffer VM étranger/hash connu/octets inchangés et vrai FileReader jsdom/fichierUTF8+NUL/hash createHash indépendant.137tests ciblés/6suites PASS ; contre-revue indépendante du code, preuves et empreintes PASS bornée, sans contre-exécution. CI locale9portes PASS_WITH_BASELINE, détails verification-ci-stage12.json ; résultats du checkout complet distincts de la future CI du paquet publié. Aucun test/skip/assertion retiré.

Limites et échecs conservés : reproduction complète Linux/jsdom/Vitest NOT_RUN. Dépendances jsdom déjà installées copiées au banc, sans installation ; résolution initiale d'un nom npm également builtin corrigée. Docker cp vers le conteneur en lecture seule a été refusé ; pas de nouvelle tentative de cette copie ni de modification de sécurité/rootfs. Conteneur58e04c253eb1 supprimé/vérifié. Les essais VM séparés, par stdin sans écriture, reprennent le banc natif déjà exécuté ; réseau none, zéro port/bind/volume persistant, caps retirées, mémoire/CPU/temps bornés. Toutes cibles de ce lot supprimées/vérifiées. Jonction du lot précédent non retentée. Erreur de syntaxe du script préparatoire corrigée avant toute écriture applicative.

Publication corrective bornée : source/hash, test et deux artefacts générés, avec les quatre documents dirty antérieurs et ces notes. Aucune migration modifiée/appliquée, fonction déployée manuellement, accès modifié, recette réelle ou action Railway. App demeure sans injection ; les garanties Git sync officielles du§21 s'appliquent. Nouveau SHA, CI terminale et réception Lovable à lire dans intake-crypto-stage12/result.json hors Git ; aucun résultat futur n'est préjugé dans ce texte. Le FAIL39997660575 est conservé comme preuve historique, aucun rerun aveugle.

Après CI verte seulement : soumettre le paquet externe§20.3 avec ses trois migrations/quatre fonctions et effets d'accès exacts, puis une recette connectée synthétique distincte. Build/preview/source reçue et binaire servi restent distincts. Conservation/restauration réelle Railway toujours UNKNOWN, arrêt/résiliation non autorisés ; incident credentials ouvert.
