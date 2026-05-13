## MAP-3 — Schema design only (commodity_classification_candidates)

**Périmètre strict** : schema-design uniquement. Aucun fichier `supabase/migrations/*.sql`, aucune migration exécutée, aucune DB write, aucun changement `src/`, `supabase/functions/`, `run-pricing`, ni de la DB. **Pas de recopie du contenu MAP-2** (audits Manus/ChatGPT/Claude, état runtime, algorithme cascade, NSTR, HS10, PAD→DROIT_PASSAGE) — ces sujets sont déjà traités dans `docs/tariff-collection/pad/MAP_2_TECHNICAL_DESIGN_MULTI_SOURCE_PAD_SUGGESTION.md` et seront cités par référence en une ligne.

### Diff autorisé (2 fichiers max)

- **A** `docs/tariff-collection/pad/MAP_3_SCHEMA_DESIGN_COMMODITY_CLASSIFICATION_CANDIDATES.md`
- **M** `docs/DEFERRED_BACKLOG.md` — ajout entrée `📋 MAP-3 SCHEMA DESIGN DRAFT — awaiting CTO review` uniquement

### Plan exact du livrable (17 sections)

1. **Contexte court** — 1 paragraphe : « MAP-2 accepté (`MAP_2_TECHNICAL_DESIGN_READY_ACCEPTED`). MAP-3 arbitre le schéma de stockage avant toute migration. Voir `MAP_2_TECHNICAL_DESIGN_MULTI_SOURCE_PAD_SUGGESTION.md` pour la cascade fonctionnelle. » Pas de recopie.
2. **Périmètre schema-design only** — interdictions explicites (pas de migration, pas de runtime, pas de DB write, pas d'Edge Function, pas de clôture MAPPING-TAX-CHAIN-0).
3. **Modèle retenu B + C** — 1 paragraphe rappelant la décision : Option C (table candidats) + Option B (facts validés dans `quote_facts` via `supersede_fact` uniquement). Interdiction d'écrire un candidat suggéré dans `quote_facts`.
4. **Design table `commodity_classification_candidates`** — liste structurée des colonnes (sans SQL ici, le DDL est en §14) :
   - identité : `id`, `case_id` (NOT NULL, FK quote_cases), `article_id` (NULLABLE, sans FK forte), `source_fact_id` (NULLABLE, FK quote_facts SET NULL)
   - classification : `designation_normalized`, `candidate_kind` (cn8/hs6/hs10_uemoa/nhm/nst2007/nstr/pad_label/pad_category), `candidate_value`, `pad_category`, `droit_passage_value/_currency/_unit`
   - provenance : `source` (operator/structured_code_exact/validated_alias/pad_label_2_3/reference_label_cn_nhm_nst_nstr/ai_suggestion/web_hs_lookup), `evidence jsonb`, `confidence`, `score`, `rank`
   - cycle de vie : `status`, `is_current`, `validated_by`, `validated_at`, `rejection_reason`, `supersedes_id`
   - timestamps : `created_at`, `updated_at`
5. **Design facts validés `quote_facts`** — whitelist `fact_key` pivots autorisés (validés uniquement) : `commodity.cn_code`, `commodity.hs_code` (avec `value_json.scheme`), `commodity.nhm_code`, `commodity.nst_code`, `commodity.nstr_code`, `pricing.pad_category`, `pricing.pad_droit_passage_value`. Rappel contrainte `uq_quote_facts_current_key` → incompatibilité native avec top-N candidats (justifie la table dédiée).
6. **Règles `case_id` / `article_id` / `source_fact_id`** — `case_id` obligatoire ; `article_id` nullable, sans FK tant que table article non stable (dette assumée) ; `source_fact_id` nullable mais recommandé pour traçabilité.
7. **Contraintes proposées** — CHECK sur `candidate_kind`, `source`, `status`, `confidence` (0..1) ; FK ON DELETE CASCADE pour `case_id`, ON DELETE SET NULL pour `source_fact_id` et `supersedes_id`.
8. **Index proposés** — `(case_id)`, `(case_id, article_id)`, `(case_id, candidate_kind) WHERE is_current`, partiel UNIQUE d'idempotence (cf §11), `(status) WHERE status='suggested'`, `(source_fact_id) WHERE NOT NULL`.
9. **RLS proposées** — alignées sur `quote_facts` : SELECT pour utilisateurs ayant accès au `case_id` (réutilisation fonction d'accès existante, **non créée** ici) ; INSERT/UPDATE service_role + opérateur ; DELETE interdit en RLS. **Aucune policy n'est créée dans ce lot** — uniquement décrite.
10. **Triggers proposés** — `BEFORE UPDATE` → `update_updated_at_column()` (existant) ; garde-fou cohérence `status`/`is_current`. **Aucun trigger qui écrit dans `quote_facts`** (séparation runtime stricte, MAP-4/5).
11. **Idempotence & supersession** — clé naturelle `(case_id, COALESCE(article_id, sentinel), candidate_kind, source, candidate_value) WHERE is_current=true` → UPSERT `ON CONFLICT DO NOTHING`. Re-scoring = nouvelle ligne `is_current=true` + ancienne `is_current=false, status='superseded', supersedes_id=<new>`.
12. **Statuts** — diagramme texte : `suggested → accepted | rejected | superseded`. Sémantique de chaque transition. `accepted` ⇒ déclenche écriture fact pivot (hors MAP-3).
13. **Règles d'écriture future vers `quote_facts`** — uniquement via `supersede_fact` RPC (futur MAP-5), uniquement sur whitelist §5, uniquement après `accepted` opérateur, jamais auto depuis `ai_suggestion`/`web_hs_lookup`.
14. **DDL illustratif** — bloc unique préfixé :
    ```text
    -- DRAFT ONLY — DO NOT EXECUTE
    -- Schema design MAP-3. Migration réelle = MAP-3b (lot séparé, GO CTO requis).
    ```
    Contient : `CREATE TABLE`, contraintes CHECK/FK, `CREATE INDEX` (dont partiel UNIQUE), `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, exemples de `CREATE POLICY` (commentés `-- DRAFT`), exemple `CREATE TRIGGER` (commenté `-- DRAFT`).
15. **Tests attendus pour MAP-3b** — checklist : insertion candidat ; idempotence (réinsertion identique = no-op) ; supersession (re-scoring) ; transitions de statut interdites bloquées par trigger ; RLS lecture/écriture par rôle ; cascade ON DELETE case ; comportement `article_id NULL` vs UUID.
16. **Critères GO / NO-GO MAP-3b**
    - GO : DDL accepté sans refonte structurelle ; fonction `has_case_access(case_id)` (ou équivalent) confirmée ; whitelist `fact_key` validée ; pas de table article stable bloquante.
    - NO-GO : décision de fusionner candidats dans `quote_facts` ; apparition table article stable avec FK obligatoire ; refus du modèle hybride article_id nullable.
17. **Verdict** — `MAP_3_SCHEMA_DESIGN_READY` (ou `MAP_3_BLOCKED` si une décision bloquante est levée à la revue).

### Entrée DEFERRED_BACKLOG.md (M, ajout en fin de section MAP)

| Champ | Valeur |
|-------|--------|
| ID | `MAP-3` |
| Catégorie | Schema design — stockage candidats classification commodity |
| Statut | `📋 MAP-3 SCHEMA DESIGN DRAFT — awaiting CTO review` |
| Priorité | P1 |
| Phase d'origine | Post MAP-2 |
| Date | 2026-05-13 |
| Constat | Livrable `docs/tariff-collection/pad/MAP_3_SCHEMA_DESIGN_COMMODITY_CLASSIFICATION_CANDIDATES.md` — design schema-only table `commodity_classification_candidates` (Option C) + whitelist facts pivots `quote_facts` (Option B). DDL marqué `DRAFT ONLY — DO NOT EXECUTE`. |
| Déclencheur de réouverture | Revue CTO + GO MAP-3b (migration réelle). |
| Recommandation | Schema-design only. Aucune migration, aucune DB write, aucun runtime. MAPPING-TAX-CHAIN-0 reste ouvert. Séquence : MAP-3b (migration) → MAP-4 (Edge read-only) → MAP-5 (UI) → MAP-6 (shadow) → MAP-7 (activation partielle). |

### Interdictions absolues (rappel)

- Pas de `src/`, `supabase/functions/`, `supabase/migrations/`, `supabase/config.toml`.
- Pas de DB write, pas de création de table, pas de policy/trigger appliqués.
- Pas d'Edge Function, pas d'INSERT alias, pas d'activation `PAD_RESOLVER_SHADOW`.
- Pas de décision Lot D, pas de clôture MAPPING-TAX-CHAIN-0.
- Pas de copie des fichiers externes joints dans le repo.
- **Pas de recopie du contenu MAP-2** (audits, runtime, algorithme cascade, NSTR/HS10, DROIT_PASSAGE).

### Verdict attendu après exécution

`MAP_3_SCHEMA_DESIGN_READY`
