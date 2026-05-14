# MAP-3b — Plan migration candidate (commodity_classification_candidates)

> **Statut** : `📋 MAP-3B MIGRATION PLAN DRAFT — awaiting CTO review`
> **Type de lot** : Plan migration **candidate documentaire only**
> **Date** : 2026-05-13
> **Branche** : `work`

---

## 1. Contexte & statut

MAP-3 a été accepté par le CTO (`MAP_3_SCHEMA_DESIGN_READY_ACCEPTED`). Ce lot MAP-3b produit le **plan de migration candidate** matérialisant le schéma MAP-3 sous forme :

- d'un document de plan (le présent fichier),
- d'un fichier SQL **candidate documentaire**, placé **hors `supabase/migrations/`** :
  `docs/tariff-collection/pad/sql-drafts/20260513_map_3b_commodity_classification_candidates_DRAFT.sql`.

L'exécution réelle est différée à un lot séparé `MAP-3b-exec` qui exigera un GO CTO explicite (`MAP_3B_MIGRATION_EXECUTED`) et utilisera l'outil `supabase--migration`.

Référence schema : `docs/tariff-collection/pad/MAP_3_SCHEMA_DESIGN_COMMODITY_CLASSIFICATION_CANDIDATES.md`.

---

## 2. Périmètre strict — interdictions

- **Aucune exécution DB.** L'outil `supabase--migration` n'est PAS appelé dans ce lot.
- **Aucun fichier dans `supabase/migrations/*.sql`.** Le SQL candidate vit dans `docs/tariff-collection/pad/sql-drafts/` pour éliminer tout risque d'auto-apply.
- Aucun changement `src/`, `supabase/functions/`, `supabase/config.toml`.
- Aucune Edge Function créée ou modifiée.
- Aucune activation `PAD_RESOLVER_SHADOW`. Aucune décision Lot D.
- Aucune clôture `MAPPING-TAX-CHAIN-0` (reste **ouvert**).
- Aucun INSERT alias. Aucun seed de données.
- Aucun test DB déclaré PASS — seuls des **tests attendus** pour `MAP-3b-exec` sont listés (§11).
- Aucune copie de fichiers externes joints dans le repo.

---

## 3. Prérequis DB confirmés

| Élément | État | Note |
|---------|------|------|
| `public.quote_cases` | ✅ Présente | FK CASCADE sur les enfants standards. |
| `public.quote_facts` | ✅ Présente | Contrainte `uq_quote_facts_current_key` sur `(case_id, fact_key) WHERE is_current=true` confirme l'incompatibilité native avec un modèle top-N → justifie la table dédiée. |
| `public.update_updated_at_column()` | ✅ Présente | Réutilisée par le trigger `trg_ccc_updated_at`. |
| `public.has_case_access(uuid)` | ❌ **Absente** | À créer dans la migration candidate (§4). |
| Entrée MAP-3 dans `docs/DEFERRED_BACKLOG.md` | ✅ Présente (lignes 1485+) | Modification ciblée possible : statut → `ACCEPTED`. |

---

## 4. Fonction `has_case_access` — politique shared workspace

### Spécification

```sql
CREATE OR REPLACE FUNCTION public.has_case_access(_case_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM public.quote_cases qc WHERE qc.id = _case_id
    );
$$;
```

### Politique : **shared workspace**

Tout utilisateur **authentifié** accède à **tout dossier existant**. Cette politique est explicitement alignée avec `docs/SECURITY_CONTRACT.md` § *Access Model* :

> "All authenticated operators can access all cases. Case ownership (`created_by`) is **not enforced** for access control."

### Avertissement (commentaire SQL obligatoire)

Le `COMMENT ON FUNCTION` rappelle :

- politique shared workspace explicite ;
- **interdiction** de réutiliser la fonction comme garde owner-scoped sans redesign dédié (par exemple `has_case_owner_access()` consultant `quote_cases.created_by` / `assigned_to`).

Cette fonction n'est **pas** owner-scoped. Toute affirmation contraire dans un futur lot doit être traitée comme un bug de gouvernance.

---

## 5. Schéma `commodity_classification_candidates` — résumé

Le DDL complet vit dans le fichier SQL candidate (§10). Résumé fonctionnel :

- **Identité** : `id`, `case_id` (NOT NULL, FK `quote_cases` CASCADE), `article_id` (NULLABLE, sans FK forte), `source_fact_id` (NULLABLE, FK `quote_facts` SET NULL).
- **Classification** : `designation_normalized`, `candidate_kind` ∈ {`cn8`, `hs6`, `hs10_uemoa`, `nhm`, `nst2007`, `nstr`, `pad_label`, `pad_category`}, `candidate_value`, `pad_category`, `droit_passage_value/_currency/_unit`.
- **Provenance & scoring** : `source` ∈ {`operator`, `structured_code_exact`, `validated_alias`, `pad_label_2_3`, `reference_label_cn_nhm_nst_nstr`, `ai_suggestion`, `web_hs_lookup`}, `evidence jsonb`, `confidence` (0..1), `score`, `rank`.
- **Cycle de vie** : `status` ∈ {`suggested`, `accepted`, `rejected`, `superseded`}, `is_current`, `validated_by`, `validated_at`, `rejection_reason`, `supersedes_id` (FK self SET NULL).
- **Audit** : `created_at`, `updated_at`.

Contraintes CHECK : `candidate_kind`, `source`, `status`, `confidence`, `rank`. FK : `case_id` CASCADE, `source_fact_id` SET NULL, `supersedes_id` SET NULL, `validated_by` SET NULL.

---

## 6. RLS proposées

Politique alignée sur `quote_facts` + utilisation de `has_case_access` (shared workspace) :

| Opération | Policy | Règle |
|-----------|--------|-------|
| SELECT | `ccc_select_case_access` | `USING (public.has_case_access(case_id))` |
| INSERT | `ccc_insert_authenticated` | `WITH CHECK (public.has_case_access(case_id))` |
| UPDATE | `ccc_update_authenticated` | `USING (...)` + `WITH CHECK (...)` |
| DELETE | *(aucune policy)* | Refusé par défaut RLS. Purge admin = job futur, hors périmètre. |

Le `service_role` Supabase contourne RLS comme d'habitude (Edge Functions futures MAP-4/5).

---

## 7. Triggers proposés

1. `trg_ccc_updated_at` — `BEFORE UPDATE`, exécute `public.update_updated_at_column()` (existante).
2. `trg_ccc_status_consistency` — `BEFORE INSERT OR UPDATE`, exécute `public.ccc_status_consistency()` (créée par la migration). Empêche `status ∈ {'rejected','superseded'} AND is_current=true`. Lève `RAISE EXCEPTION` (`ERRCODE = 'check_violation'`).

**Aucun trigger n'écrit dans `quote_facts`.** La séparation runtime est stricte : l'écriture pivot est portée par MAP-4/5 via RPC explicite (`supersede_fact`).

---

## 8. Idempotence & supersession

### Idempotence (UNIQUE partiel)

```text
uq_ccc_current UNIQUE (
  case_id,
  COALESCE(article_id, '00000000-0000-0000-0000-000000000000'::uuid),
  candidate_kind,
  source,
  candidate_value
) WHERE is_current = true
```

Le sentinel UUID `00000000-…` neutralise la sémantique NULL de Postgres dans la clé d'unicité. Réinjection identique = no-op via `INSERT ... ON CONFLICT DO NOTHING` (logique applicative MAP-4, hors périmètre MAP-3b).

### Supersession (re-scoring)

Logique applicative future (MAP-4, transaction atomique) :
1. INSERT nouvelle ligne `is_current=true`, `supersedes_id=<ancien>`.
2. UPDATE ancienne ligne `is_current=false`, `status='superseded'`.

Aucun trigger ne pilote cette logique automatiquement — elle est portée par l'Edge Function MAP-4.

---

## 9. Localisation du fichier SQL candidate — décision CTO

Le SQL est placé dans :

```
docs/tariff-collection/pad/sql-drafts/20260513_map_3b_commodity_classification_candidates_DRAFT.sql
```

**Et explicitement PAS dans `supabase/migrations/`.**

### Justification

1. Tout fichier dans `supabase/migrations/` peut être interprété comme une migration prête à appliquer par le pipeline Lovable / Supabase.
2. La frontière `docs/` rend l'intention documentaire évidente, indépendamment de la garde anti-exécution en tête du fichier.
3. Le passage à `supabase/migrations/` sera fait par le lot `MAP-3b-exec`, qui copiera/adaptera le contenu via `supabase--migration` après GO CTO.

Le dossier `docs/tariff-collection/pad/sql-drafts/` est créé par ce lot (premier fichier déposé).

---

## 10. DDL candidate — référence

Le DDL complet vit dans `docs/tariff-collection/pad/sql-drafts/20260513_map_3b_commodity_classification_candidates_DRAFT.sql`. Il est précédé de la garde anti-exécution :

```text
-- =====================================================================
-- MIGRATION CANDIDATE ONLY — DO NOT APPLY
-- This file is documentation/draft only.
-- Execution requires separate CTO GO and a separate MAP-3b-exec lot.
-- =====================================================================
```

Le fichier SQL contient, dans cet ordre :

1. Création de `public.has_case_access(_case_id uuid)` + `COMMENT ON FUNCTION` rappelant la politique shared workspace.
2. `CREATE TABLE public.commodity_classification_candidates` (colonnes, CHECK, FK).
3. `CREATE INDEX` × 6 (dont `uq_ccc_current` UNIQUE partiel).
4. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + 3 `CREATE POLICY` (SELECT/INSERT/UPDATE).
5. `CREATE TRIGGER trg_ccc_updated_at` + `CREATE FUNCTION public.ccc_status_consistency()` + `CREATE TRIGGER trg_ccc_status_consistency`.

Pas de `BEGIN;` / `COMMIT;` (laissés à `MAP-3b-exec`). Pas d'INSERT de données.

---

## 11. Tests attendus pour MAP-3b-exec

> ⚠️ **Aucun test n'est exécuté dans ce lot.** La liste ci-dessous est **prescriptive** pour le futur lot `MAP-3b-exec`. Aucun statut PASS ne peut être déclaré ici.

1. **Insertion candidat minimal** — INSERT (`case_id`, `designation_normalized`, `candidate_kind`, `candidate_value`, `source`) → ligne créée avec `status='suggested'`, `is_current=true`, `confidence=0`, `created_at`/`updated_at` renseignés.
2. **Idempotence** — réinsertion identique avec `ON CONFLICT DO NOTHING` sur `uq_ccc_current` → no-op (count inchangé).
3. **Supersession (re-scoring)** — INSERT nouvelle ligne `is_current=true` + UPDATE ancienne (`is_current=false`, `status='superseded'`, lien via `supersedes_id`) en transaction → invariant unicité courante préservé.
4. **Garde-fou statut (trigger)** — UPDATE `status='rejected'` AND `is_current=true` → `RAISE EXCEPTION` (`ERRCODE='check_violation'`). Idem pour `status='superseded'`.
5. **RLS lecture** — utilisateur authentifié quelconque → toutes lignes visibles (shared workspace).
6. **RLS écriture INSERT/UPDATE** — utilisateur authentifié → autorisé. `service_role` → autorisé.
7. **RLS DELETE** — DELETE par utilisateur authentifié → refusé (aucune policy). `service_role` → autorisé.
8. **Cascade ON DELETE case** — suppression `quote_cases` → candidats associés supprimés.
9. **`article_id NULL` vs UUID** — deux candidats avec mêmes `(case_id, candidate_kind, source, candidate_value)` mais `article_id` différents (NULL vs UUID) → coexistent grâce au sentinel `COALESCE`.
10. **FK `source_fact_id` SET NULL** — suppression d'un `quote_facts` source → candidat conservé avec `source_fact_id = NULL`.

---

## 12. Pré-requis avant GO MAP-3b-exec

- [ ] CTO valide la politique **shared workspace** explicite de `has_case_access`.
- [ ] CTO confirme la whitelist `fact_key` pivots définie dans MAP-3 §5 (`commodity.cn_code`, `commodity.hs_code`, `commodity.nhm_code`, `commodity.nst_code`, `commodity.nstr_code`, `pricing.pad_category`, `pricing.pad_droit_passage_value`).
- [ ] Aucun lot pricing concurrent en cours qui modifierait `quote_facts` ou créerait une dépendance bloquante.
- [ ] Aucune table `cargo_articles` stable apparue dans le repo / schéma — sinon `article_id` doit basculer NOT NULL + FK forte (refonte schema MAP-3).
- [ ] Verdict `MAP_3B_MIGRATION_PLAN_READY` consigné par le CTO.

---

## 13. Séquence post-MAP-3b

1. **MAP-3b-exec** — exécution réelle via `supabase--migration` (copie/adaptation du SQL candidate vers `supabase/migrations/`). GO CTO requis. Verdict cible : `MAP_3B_MIGRATION_EXECUTED`.
2. **MAP-4** — Edge Function read-only (`get-commodity-classification-candidates`) — SELECT uniquement, RLS respectée, pas d'écriture pivot.
3. **MAP-5** — UI opérateur CaseView — affichage candidats + validation explicite. Acceptation déclenche `supersede_fact` sur la whitelist §5.
4. **MAP-6** — shadow-mode — moteur alimente `commodity_classification_candidates` sans impacter `run-pricing`.
5. **MAP-7** — activation partielle (`OFFICIAL_EXACT_CODE_SINGLE_PAD` uniquement).
6. **MAP-8** — extension IA / Web HS, operator-in-the-loop strict.

`MAPPING-TAX-CHAIN-0` reste **ouvert** au moins jusqu'à MAP-7.

---

## 14. Verdict

`MAP_3B_MIGRATION_PLAN_READY`

> En cas de blocage à la revue (politique d'accès rejetée, whitelist invalidée, conflit pricing, apparition table article stable), le verdict bascule en `MAP_3B_BLOCKED` avec motif explicite à consigner dans `docs/DEFERRED_BACKLOG.md`.

---

## Références

- `docs/tariff-collection/pad/MAP_3_SCHEMA_DESIGN_COMMODITY_CLASSIFICATION_CANDIDATES.md` (schema design)
- `docs/tariff-collection/pad/MAP_2_TECHNICAL_DESIGN_MULTI_SOURCE_PAD_SUGGESTION.md` (cascade fonctionnelle)
- `docs/SECURITY_CONTRACT.md` (politique shared workspace)
- `docs/MASTER_CONTEXT.md` (gouvernance globale, RPC `supersede_fact`)
- `docs/DEFERRED_BACKLOG.md` (suivi des lots différés)

---

**Fin du document MAP-3b — migration candidate documentaire only.**
