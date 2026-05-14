# MAP-3b-exec — Plan d'exécution migration `commodity_classification_candidates`

> **Statut** : `📋 MAP-3B-EXEC PLAN DRAFT — awaiting CTO GO`
> **Type de lot** : Plan d'exécution **documentaire only** — aucune exécution DB dans ce lot.
> **Date** : 2026-05-14
> **Branche** : `work`
> **Verdict cible** : `MAP_3B_EXECUTION_PLAN_READY`

---

## 1. Contexte & statut

MAP-3b a été accepté par le CTO (`MAP_3B_MIGRATION_PLAN_READY_ACCEPTED`), puis patché 2026-05-14 (`MAP_3B_RLS_DRAFT_ALIGNED_WITH_QUOTE_FACTS`) suite au verdict préflight `MAP_3B_EXEC_BLOCKED_RLS_REGRESSION_ACCEPTED`. Le présent lot MAP-3b-exec produit le **plan d'exécution réel** de la migration `commodity_classification_candidates` + fonctions `has_case_read_access` / `has_case_write_access`, **sans exécuter la migration**.

L'exécution effective sera ouverte par un lot séparé après GO CTO explicite, et utilisera l'outil `supabase--migration` pour matérialiser dans `supabase/migrations/` une copie adaptée du SQL candidate documentaire :

- Source : `docs/tariff-collection/pad/sql-drafts/20260513_map_3b_commodity_classification_candidates_DRAFT.sql`
- Plan associé : `docs/tariff-collection/pad/MAP_3B_MIGRATION_PLAN.md`
- Schema design : `docs/tariff-collection/pad/MAP_3_SCHEMA_DESIGN_COMMODITY_CLASSIFICATION_CANDIDATES.md`

Verdict cible **après exécution réelle** (lot suivant) : `MAP_3B_MIGRATION_EXECUTED`.

---

## 2. Périmètre strict — interdictions

Ce lot ne produit **que** ce document et une entrée backlog ciblée. Aucune exécution.

- ❌ `supabase--migration` n'est pas appelé.
- ❌ Aucun fichier créé dans `supabase/migrations/*.sql`.
- ❌ Le SQL draft n'est ni déplacé, ni copié, ni exécuté.
- ❌ Aucune création de la table `commodity_classification_candidates`.
- ❌ Aucune création des fonctions `has_case_read_access` / `has_case_write_access`.
- ❌ Aucune RLS / index / trigger appliqué.
- ❌ Aucun changement `src/`, `supabase/functions/`, `supabase/config.toml`.
- ❌ Aucune activation `PAD_RESOLVER_SHADOW`. Aucune décision Lot D.
- ❌ Aucune clôture `MAPPING-TAX-CHAIN-0` (reste **ouvert**).
- ❌ Aucun test DB déclaré PASS — uniquement tests **prescriptifs** pour MAP-3b-exec (§7).

---

## 3. Préchecks repo (à exécuter au début de MAP-3b-exec, pas ici)

| # | Check | Attendu |
|---|-------|---------|
| R1 | Repo `douania/dakar-cargo-quotes` confirmé | OK |
| R2 | Branche `work` confirmée | OK |
| R3 | `git status` propre (aucun fichier modifié hors périmètre du lot) | OK |
| R4 | Relecture obligatoire — schema design | `docs/tariff-collection/pad/MAP_3_SCHEMA_DESIGN_COMMODITY_CLASSIFICATION_CANDIDATES.md` |
| R5 | Relecture obligatoire — plan migration candidate | `docs/tariff-collection/pad/MAP_3B_MIGRATION_PLAN.md` |
| R6 | Relecture obligatoire — SQL draft | `docs/tariff-collection/pad/sql-drafts/20260513_map_3b_commodity_classification_candidates_DRAFT.sql` |
| R7 | Relecture obligatoire — contrat sécurité | `docs/SECURITY_CONTRACT.md` |
| R8 | Relecture obligatoire — backlog différé | `docs/DEFERRED_BACKLOG.md` |

Tout écart sur R1–R3 → **NO-GO immédiat**.

---

## 4. Préchecks DB read-only (exécutés via `supabase--read_query` dans MAP-3b-exec uniquement)

Toutes les requêtes ci-dessous sont **read-only**. Aucune n'est exécutée dans le présent lot.

| # | But | Requête | Attendu pour GO |
|---|-----|---------|-----------------|
| P1 | Table absente | `SELECT to_regclass('public.commodity_classification_candidates') AS oid;` | `oid IS NULL` |
| P2 | Fonctions absentes | `SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('has_case_read_access','has_case_write_access');` | 0 ligne pour chacun des deux noms |
| P3 | `quote_cases` présente | `SELECT to_regclass('public.quote_cases') AS oid;` | `oid IS NOT NULL` |
| P4 | `quote_facts` présente | `SELECT to_regclass('public.quote_facts') AS oid;` | `oid IS NOT NULL` |
| P5 | `update_updated_at_column` présente | `SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'update_updated_at_column';` | ≥ 1 ligne |
| P6 | RLS actuelle de `quote_facts` | `SELECT polname, polcmd, polroles::regrole[], pg_get_expr(polqual, polrelid) AS qual, pg_get_expr(polwithcheck, polrelid) AS withcheck FROM pg_policy WHERE polrelid = 'public.quote_facts'::regclass;` | SELECT au moins partiellement shared (`quote_facts_select_team` ouvert) ; INSERT/UPDATE owner/assigned (`created_by = auth.uid() OR assigned_to = auth.uid()`) — modèle aligné avec `has_case_read_access` / `has_case_write_access` |
| P7 | Aucun lot pricing concurrent ouvert sur `quote_facts` | Revue manuelle de `docs/DEFERRED_BACKLOG.md` + `docs/STATUS_REGISTRY.md` | Aucun lot bloquant |

> Note : `update_updated_at_column()` est déjà confirmée présente dans la liste des `db-functions` du projet. La revérification P5 reste obligatoire au moment de MAP-3b-exec pour figer l'état.

Tout écart sur P1–P7 → **NO-GO** avec cause exacte (§8).

---

## 5. Contrôle sécurité avant GO

### 5.1 Confirmations explicites requises

- ✅ `has_case_read_access(_case_id uuid)` est **shared workspace** (lecture) : tout utilisateur authentifié → tout `quote_cases` existant.
- ✅ `has_case_write_access(_case_id uuid)` est **owner/assigned** (écriture) : aligné sur les policies INSERT/UPDATE réelles de `quote_facts` (`created_by = auth.uid() OR assigned_to = auth.uid()`).
- ✅ Divergence assumée `SECURITY_CONTRACT.md` ↔ DB réelle documentée dans `MAP_3B_MIGRATION_PLAN.md` §4bis. Réconciliation hors périmètre MAP-3/3b.
- ✅ Les policies `ccc_select_case_access`, `ccc_insert_owner_assigned`, `ccc_update_owner_assigned` ne dépassent **pas** le modèle déjà appliqué à `quote_facts` en écriture (vérifié via P6).
- ✅ Aucune policy DELETE n'est créée → DELETE refusé par défaut RLS pour le rôle `authenticated`. `service_role` reste autorisé (bypass RLS standard).

### 5.2 STOP condition — `MAP_3B_EXEC_BLOCKED_SECURITY_MISMATCH`

Si **au moins un** des constats suivants est vrai au moment de MAP-3b-exec :

- `docs/SECURITY_CONTRACT.md` a basculé en modèle owner-scoped / RBAC strict en lecture (rendrait `has_case_read_access` plus permissive que la cible).
- Les policies INSERT/UPDATE actives sur `quote_facts` (résultat P6) sont **plus restrictives** que `has_case_write_access` (e.g. RBAC, claims dédiés).
- L'une des fonctions `has_case_read_access` ou `has_case_write_access` existe déjà avec une signature ou logique **différente**.

→ Exécution **annulée** avec verdict `MAP_3B_EXEC_BLOCKED_SECURITY_MISMATCH` consigné dans `docs/DEFERRED_BACKLOG.md`.

---

## 6. Procédure de migration (à exécuter dans MAP-3b-exec uniquement)

### 6.1 Source

`docs/tariff-collection/pad/sql-drafts/20260513_map_3b_commodity_classification_candidates_DRAFT.sql`

### 6.2 Cible

`supabase/migrations/YYYYMMDDHHMMSS_map_3b_commodity_classification_candidates.sql`

(timestamp UTC réel au moment de l'exécution, **pas figé ici**.)

### 6.3 Adaptations à appliquer lors de la copie

1. **Retirer** la garde anti-exécution en tête (`MIGRATION CANDIDATE ONLY — DO NOT APPLY`) — l'exécution est explicitement autorisée par le GO CTO.
2. **Conserver** tous les `COMMENT ON FUNCTION` / `COMMENT ON TABLE`, en particulier les avertissements sur `has_case_read_access` (shared workspace read) et `has_case_write_access` (owner/assigned write, aligné `quote_facts`).
3. **Conserver l'ordre exact** :
   1. `CREATE OR REPLACE FUNCTION public.has_case_read_access(_case_id uuid)` + `COMMENT ON FUNCTION`.
   2. `CREATE OR REPLACE FUNCTION public.has_case_write_access(_case_id uuid)` + `COMMENT ON FUNCTION`.
   3. `CREATE TABLE public.commodity_classification_candidates` + CHECK + FK.
   4. `COMMENT ON TABLE`.
   5. `CREATE INDEX` × 6 (dont `uq_ccc_current` UNIQUE partiel avec sentinel COALESCE).
   6. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` × 3 (`ccc_select_case_access`, `ccc_insert_owner_assigned`, `ccc_update_owner_assigned`).
   7. `CREATE TRIGGER trg_ccc_updated_at` (utilise `public.update_updated_at_column()` existante).
   8. `CREATE OR REPLACE FUNCTION public.ccc_status_consistency()` + `CREATE TRIGGER trg_ccc_status_consistency`.
4. **Aucun INSERT** de données (pas de seed).
5. **Aucune modification** des autres tables (`quote_cases`, `quote_facts`, `auth.*`, `storage.*`, `realtime.*`, `supabase_functions.*`, `vault.*`).
6. Description `supabase--migration` rédigée pour utilisateur non-technique : ne lister que les champs fonctionnels (pas `id`, `created_at`, `updated_at`), expliquer les règles d'accès en français simple.

### 6.4 Appel `supabase--migration`

Un seul appel, contenant l'intégralité du SQL adapté. Pas de découpage en plusieurs migrations.

> Le fichier de migration n'est **pas** créé dans le présent lot.

---

## 7. Tests post-migration (prescriptifs — aucun PASS déclaré ici)

| # | Test | Méthode | Attendu |
|---|------|---------|---------|
| T1 | Insertion candidat minimal | INSERT (`case_id`, `designation_normalized`, `candidate_kind`, `candidate_value`, `source`) | Ligne créée, `status='suggested'`, `is_current=true`, `confidence=0`, `created_at`/`updated_at` renseignés |
| T2 | Idempotence | Réinsertion identique avec `ON CONFLICT DO NOTHING` sur `uq_ccc_current` | No-op, count inchangé |
| T3 | Supersession | INSERT new `is_current=true, supersedes_id=<old>` + UPDATE old `is_current=false, status='superseded'` en transaction | Invariant unicité courante préservé |
| T4 | Trigger status/is_current | UPDATE `status='rejected' AND is_current=true` (puis idem `superseded`) | `RAISE EXCEPTION` (`ERRCODE='check_violation'`) |
| T5 | RLS SELECT | Utilisateur authentifié quelconque (owner, assigned, ou ni l'un ni l'autre) sur un case existant | Toutes lignes visibles (shared workspace via `has_case_read_access`) |
| T6 | RLS INSERT/UPDATE | (a) utilisateur owner OU assigned du case ; (b) utilisateur authentifié ni owner ni assigned ; (c) `service_role` | (a) autorisé ; (b) **refusé** (`new row violates row-level security policy` / `permission denied`) ; (c) autorisé (bypass RLS) |
| T7 | RLS DELETE | (a) utilisateur authentifié (même owner/assigned) ; (b) `service_role` | (a) **refusé** — aucune policy DELETE ; (b) autorisé (bypass RLS) |
| T8 | Cascade ON DELETE case | DELETE `quote_cases` parent | Candidats associés supprimés |
| T9 | `article_id` NULL vs UUID | Deux candidats avec mêmes `(case_id, candidate_kind, source, candidate_value)` mais `article_id` différents (NULL vs UUID) | Coexistence grâce au sentinel COALESCE |
| T10 | FK `source_fact_id` SET NULL | DELETE `quote_facts` source | Candidat conservé, `source_fact_id = NULL` |

Aucun de ces tests n'est exécuté dans le présent lot.

---

## 8. Critères GO / NO-GO

### GO (`MAP_3B_EXECUTION_PLAN_READY` → ouverture MAP-3b-exec autorisée)

Toutes les conditions suivantes vraies :

- Préchecks repo R1–R8 OK.
- Préchecks DB P1–P7 OK.
- Contrôle sécurité §5 OK (shared workspace confirmé).
- SQL draft inchangé depuis acceptation MAP-3b.
- Aucun conflit table/fonction existante.
- GO CTO explicite consigné.

### NO-GO

Au moins une des conditions suivantes vraie → verdict `MAP_3B_EXECUTION_PLAN_BLOCKED` ou (au moment de l'exécution) `MAP_3B_EXEC_BLOCKED_*` avec **cause exacte** dans `docs/DEFERRED_BACKLOG.md` :

| Cause | Code verdict |
|-------|--------------|
| Table `commodity_classification_candidates` déjà existante (P1 KO) | `MAP_3B_EXEC_BLOCKED_TABLE_EXISTS` |
| Fonction `has_case_read_access` déjà existante avec logique différente (P2 KO read) | `MAP_3B_EXEC_BLOCKED_READ_FUNCTION_CONFLICT` |
| Fonction `has_case_write_access` déjà existante avec logique différente (P2 KO write) | `MAP_3B_EXEC_BLOCKED_WRITE_FUNCTION_CONFLICT` |
| `SECURITY_CONTRACT.md` ou policies DB rendent le modèle read/write proposé incohérent | `MAP_3B_EXEC_BLOCKED_SECURITY_MISMATCH` |
| Policies INSERT/UPDATE de `quote_facts` plus restrictives que `has_case_write_access` (P6) | `MAP_3B_EXEC_BLOCKED_RLS_REGRESSION` |
| Lot pricing concurrent touchant `quote_facts` ou cascade tarifaire | `MAP_3B_EXEC_BLOCKED_CONCURRENT_LOT` |
| `git status` non propre (R3 KO) | `MAP_3B_EXEC_BLOCKED_DIRTY_REPO` |

---

## 9. Séquence post-exécution (rappel)

1. **MAP-3b-exec** — exécution réelle (ce qui suit ce document, après GO CTO séparé). Verdict cible : `MAP_3B_MIGRATION_EXECUTED`.
2. **MAP-4** — Edge Function read-only (`get-commodity-classification-candidates`).
3. **MAP-5** — UI opérateur CaseView (validation explicite → `supersede_fact`).
4. **MAP-6** — shadow-mode (alimentation sans impact `run-pricing`).
5. **MAP-7** — activation partielle (`OFFICIAL_EXACT_CODE_SINGLE_PAD`).
6. **MAP-8** — extension IA / Web HS, operator-in-the-loop strict.

`MAPPING-TAX-CHAIN-0` reste **ouvert** au moins jusqu'à MAP-7.

---

## 10. Verdict du présent lot

`MAP_3B_EXECUTION_PLAN_READY`

> Aucune migration ne sera lancée tant qu'un GO CTO explicite n'aura pas ouvert un lot `MAP-3b-exec` distinct.

---

## 11. Références

- `docs/tariff-collection/pad/MAP_3_SCHEMA_DESIGN_COMMODITY_CLASSIFICATION_CANDIDATES.md`
- `docs/tariff-collection/pad/MAP_3B_MIGRATION_PLAN.md`
- `docs/tariff-collection/pad/sql-drafts/20260513_map_3b_commodity_classification_candidates_DRAFT.sql`
- `docs/SECURITY_CONTRACT.md`
- `docs/MASTER_CONTEXT.md`
- `docs/DEFERRED_BACKLOG.md`
- `docs/STATUS_REGISTRY.md`

---

**Fin du document MAP-3b-exec — plan d'exécution documentaire only.**
