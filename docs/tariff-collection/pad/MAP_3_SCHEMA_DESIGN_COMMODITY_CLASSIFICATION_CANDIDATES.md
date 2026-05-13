# MAP-3 — Schema Design : `commodity_classification_candidates`

> **Statut** : `📋 MAP-3 SCHEMA DESIGN DRAFT — awaiting CTO review`
> **Type de lot** : Schema-design **only** (documentation)
> **Date** : 2026-05-13
> **Branche** : `work`

---

## 1. Contexte court

MAP-2 a été accepté (`MAP_2_TECHNICAL_DESIGN_READY_ACCEPTED`). MAP-3 arbitre **uniquement** le schéma de stockage qui supportera la cascade multi-source `Désignation → code structuré → NST → PAD → DROIT_PASSAGE` avant toute migration. Pour la cascade fonctionnelle, les audits (Manus MAP-RUNTIME-1, NSTR forensic, ChatGPT agent, Claude 2006), l'état runtime, l'algorithme de résolution, la gestion HS10/NSTR/CPA et le passage PAD → DROIT_PASSAGE, voir `docs/tariff-collection/pad/MAP_2_TECHNICAL_DESIGN_MULTI_SOURCE_PAD_SUGGESTION.md`. **Aucun de ces sujets n'est recopié ici.**

---

## 2. Périmètre — schema-design only

**Inclus dans MAP-3 :**
- Design de la table `commodity_classification_candidates` (DDL illustratif marqué DRAFT).
- Whitelist des `fact_key` pivots dans `quote_facts` pour les valeurs validées.
- Contraintes, index, RLS, triggers, idempotence, statuts (proposés, non appliqués).
- Critères GO / NO-GO pour MAP-3b (migration réelle, lot séparé).

**Exclu de MAP-3 (interdictions absolues) :**
- Pas de fichier `supabase/migrations/*.sql`.
- Pas de migration exécutée, pas de DB write, pas de création de table.
- Pas de policy RLS appliquée, pas de trigger appliqué.
- Pas de changement `src/`, `supabase/functions/`, `supabase/config.toml`, `run-pricing`, `get-pad-nst-suggestions`, `recommend-pad-category`, `quotation-engine`.
- Pas d'Edge Function, pas d'INSERT alias, pas d'activation `PAD_RESOLVER_SHADOW`.
- Pas de décision Lot D, pas de clôture `MAPPING-TAX-CHAIN-0` (qui reste **ouvert**).
- Pas de copie des fichiers externes joints dans le repo.

---

## 3. Modèle retenu — Option B + Option C (conforme MAP-2)

| Option | Rôle | Stockage |
|--------|------|----------|
| **C** | Propositions, top-N candidats, scoring, sources, preuves, statuts, historique | Nouvelle table `commodity_classification_candidates` |
| **B** | Valeurs **validées** par opérateur uniquement (pivot pricing) | `quote_facts` via `supersede_fact` RPC |

**Règle d'architecture stricte** : il est **interdit** d'écrire un candidat simplement « suggéré » dans `quote_facts`. `quote_facts` reste réservé aux faits validés / confirmés. Toute proposition (operator, structured_code_exact, validated_alias, pad_label, reference_label, ai_suggestion, web_hs_lookup) vit d'abord dans `commodity_classification_candidates`, et ne migre vers `quote_facts` qu'après acceptation explicite par l'opérateur (cf. §13).

---

## 4. Design table `commodity_classification_candidates`

Liste structurée des colonnes (DDL en §14).

### 4.1 Identité
- `id uuid PK DEFAULT gen_random_uuid()`
- `case_id uuid NOT NULL` — FK `quote_cases(id) ON DELETE CASCADE`.
- `article_id uuid NULL` — pas de FK forte (cf. §6, dette assumée).
- `source_fact_id uuid NULL` — FK `quote_facts(id) ON DELETE SET NULL`. Recommandé quand le candidat dérive d'un fact extrait (ex. `cargo.designation_raw`).

### 4.2 Classification proposée
- `designation_normalized text NOT NULL` — désignation en clair après normalisation (uppercase, accents, ponctuation).
- `candidate_kind text NOT NULL` — type de code candidat. Domaine fermé :
  - `cn8` (CN8 EU)
  - `hs6` (HS6 Système Harmonisé)
  - `hs10_uemoa` (HS10 UEMOA — distinct de CN8)
  - `nhm` (NHM ferroviaire)
  - `nst2007` (NST/R 2007)
  - `nstr` (NSTR legacy)
  - `pad_label` (libellé PAD §2.3)
  - `pad_category` (catégorie PAD canonique : `T01`..`T14`, `C01`..`C03`, etc.)
- `candidate_value text NOT NULL` — code ou libellé brut tel que résolu.
- `pad_category text NULL` — catégorie PAD résolue en aval (peut différer de `candidate_value` quand `candidate_kind ≠ 'pad_category'`).
- `droit_passage_value numeric NULL`
- `droit_passage_currency text NULL`
- `droit_passage_unit text NULL`

### 4.3 Provenance & scoring
- `source text NOT NULL` — origine du candidat. Domaine fermé :
  - `operator`
  - `structured_code_exact`
  - `validated_alias`
  - `pad_label_2_3`
  - `reference_label_cn_nhm_nst_nstr`
  - `ai_suggestion`
  - `web_hs_lookup`
- `evidence jsonb NULL` — preuve (extrait texte, URL, hash document, ligne CSV…).
- `confidence numeric(3,2) NOT NULL DEFAULT 0` — CHECK 0..1.
- `score numeric NULL` — score interne du resolver.
- `rank smallint NULL` — rang top-N par `(case_id, article_id, candidate_kind)`.

### 4.4 Cycle de vie
- `status text NOT NULL DEFAULT 'suggested'` — domaine fermé : `suggested`, `accepted`, `rejected`, `superseded`.
- `is_current boolean NOT NULL DEFAULT true`.
- `validated_by uuid NULL` — FK `auth.users(id)`.
- `validated_at timestamptz NULL`.
- `rejection_reason text NULL`.
- `supersedes_id uuid NULL` — FK self `ON DELETE SET NULL`.

### 4.5 Audit
- `created_at timestamptz NOT NULL DEFAULT now()`
- `updated_at timestamptz NOT NULL DEFAULT now()` — maintenu par trigger (cf. §10).

---

## 5. Design facts validés `quote_facts` — whitelist pivots

Seules les `fact_key` ci-dessous peuvent être écrites dans `quote_facts` à partir d'un candidat accepté (via `supersede_fact` RPC, futur MAP-5). **Pas d'extension hors whitelist sans amendement formel.**

| `fact_key` | `fact_category` | Notes |
|------------|-----------------|-------|
| `commodity.cn_code` | `cargo` | CN8 EU — strict 8 chiffres. |
| `commodity.hs_code` | `cargo` | HS6 ou HS10 UEMOA. **Doit** porter `value_json.scheme ∈ {'hs6','hs10_uemoa'}`. |
| `commodity.nhm_code` | `cargo` | NHM ferroviaire. |
| `commodity.nst_code` | `cargo` | NST/R 2007. |
| `commodity.nstr_code` | `cargo` | NSTR legacy — réservé audit/migration. |
| `pricing.pad_category` | `pricing` | **Pivot pricing** — gate run-pricing. |
| `pricing.pad_droit_passage_value` | `pricing` | Informationnel — calcul reste côté `port_tariffs`. |

### 5.1 Justification de la table dédiée

`quote_facts` impose la contrainte unique partielle :
```
uq_quote_facts_current_key UNIQUE (case_id, fact_key) WHERE is_current = true
```
Cette contrainte est **incompatible** par construction avec un modèle top-N candidats multi-source : on ne peut pas avoir simultanément trois candidats `commodity.cn_code` `is_current=true` issus de sources différentes. La table `commodity_classification_candidates` est donc structurellement nécessaire pour préserver la traçabilité multi-source sans casser l'invariant pivot de `quote_facts`.

---

## 6. Règles `case_id` / `article_id` / `source_fact_id`

| Champ | Règle |
|-------|-------|
| `case_id` | **Obligatoire**. FK `quote_cases ON DELETE CASCADE`. |
| `article_id` | **Nullable**. **Pas de FK forte** tant qu'aucune table article stable n'est confirmée dans le repo / schéma. Si une telle table émerge, MAP-3b ajoutera la FK. **Dette assumée et documentée.** |
| `source_fact_id` | Nullable mais **recommandé** quand le candidat provient d'un fact précis (ex. extraction PDF → `cargo.designation_raw`). FK `quote_facts ON DELETE SET NULL` pour préserver les candidats même si un fact source est supprimé. |

**Justification du modèle hybride** : permet (1) candidats case-level pour dossiers mono-marchandise, (2) candidats article-level pour dossiers multi-marchandises, (3) traçabilité fact source, (4) migration future sans refactor global. MAP-3 ne bloque pas sur l'absence de table article.

---

## 7. Contraintes proposées

- `CHECK (candidate_kind IN ('cn8','hs6','hs10_uemoa','nhm','nst2007','nstr','pad_label','pad_category'))`
- `CHECK (source IN ('operator','structured_code_exact','validated_alias','pad_label_2_3','reference_label_cn_nhm_nst_nstr','ai_suggestion','web_hs_lookup'))`
- `CHECK (status IN ('suggested','accepted','rejected','superseded'))`
- `CHECK (confidence >= 0 AND confidence <= 1)`
- `CHECK (rank IS NULL OR rank > 0)`
- FK `case_id → quote_cases(id) ON DELETE CASCADE`
- FK `source_fact_id → quote_facts(id) ON DELETE SET NULL`
- FK `supersedes_id → commodity_classification_candidates(id) ON DELETE SET NULL`
- FK `validated_by → auth.users(id) ON DELETE SET NULL`

---

## 8. Index proposés

| Index | Définition | Usage |
|-------|------------|-------|
| `idx_ccc_case` | `(case_id)` | Lookup par dossier (CaseView). |
| `idx_ccc_case_article` | `(case_id, article_id)` | Lookup par article. |
| `idx_ccc_case_kind_current` | `(case_id, candidate_kind) WHERE is_current = true` | Top-N courants par type. |
| `uq_ccc_current` (UNIQUE partiel — idempotence, cf. §11) | `(case_id, COALESCE(article_id,'00000000-0000-0000-0000-000000000000'::uuid), candidate_kind, source, candidate_value) WHERE is_current = true` | Empêche doublons courants. |
| `idx_ccc_status_suggested` | `(status) WHERE status = 'suggested'` | File de revue opérateur. |
| `idx_ccc_source_fact` | `(source_fact_id) WHERE source_fact_id IS NOT NULL` | Reverse lookup depuis un fact. |

---

## 9. RLS proposées (alignées sur `quote_facts`)

> **Aucune policy n'est créée dans ce lot.** Description uniquement.

- `ALTER TABLE public.commodity_classification_candidates ENABLE ROW LEVEL SECURITY;`
- **SELECT** : utilisateurs authentifiés ayant accès au `case_id`. Réutilisation de la fonction d'accès existante (ex. `has_case_access(case_id)` ou équivalent), **non créée ici**. Si elle n'existe pas dans la DB au moment de MAP-3b, sa création devient un pré-requis bloquant.
- **INSERT / UPDATE** : `service_role` (Edge Functions futures MAP-4) **+** opérateur authentifié validé via `has_role(auth.uid(), 'operator')` (ou rôle équivalent existant).
- **DELETE** : interdit en RLS. Purge candidats `rejected/superseded` = job admin futur, hors périmètre MAP-3.

---

## 10. Triggers proposés

> **Aucun trigger n'est créé dans ce lot.** Description uniquement.

1. `BEFORE UPDATE` → réutilisation de la fonction existante `public.update_updated_at_column()`.
2. `BEFORE INSERT OR UPDATE` → garde-fou de cohérence `status` / `is_current` :
   - `status = 'rejected'` ⇒ `is_current = false` obligatoire.
   - `status = 'superseded'` ⇒ `is_current = false` obligatoire.
   - `status = 'accepted'` ⇒ `is_current = true` autorisé (un seul accepté courant par `(case_id, article_id, candidate_kind)`).
3. **Aucun trigger qui écrit dans `quote_facts`**. La séparation runtime est stricte : l'écriture pivot est portée par MAP-4/5 via RPC explicite.

---

## 11. Idempotence & supersession

### 11.1 Idempotence

Clé naturelle d'unicité courante :
```
(case_id, COALESCE(article_id, sentinel_uuid), candidate_kind, source, candidate_value) WHERE is_current = true
```
- Réinjection identique = no-op via `INSERT ... ON CONFLICT DO NOTHING` sur l'index unique partiel `uq_ccc_current`.
- Le `sentinel_uuid = '00000000-0000-0000-0000-000000000000'` neutralise la sémantique NULL de Postgres dans la clé d'unicité.

### 11.2 Supersession (re-scoring)

Un re-scoring d'un candidat existant **ne mute pas** la ligne précédente. Il insère une nouvelle ligne :
```
nouvelle_ligne.is_current = true
nouvelle_ligne.supersedes_id = ancienne_ligne.id
ancienne_ligne.is_current = false
ancienne_ligne.status = 'superseded'
```
La transition est portée par l'Edge Function MAP-4 (transaction atomique). Hors périmètre MAP-3.

---

## 12. Statuts — diagramme & sémantique

```text
              ┌──────────┐
              │ suggested │  (état initial à l'INSERT)
              └─────┬─────┘
        ┌───────────┼───────────────┐
        │           │               │
   accept│      reject│       new scoring│
        ▼           ▼               ▼
   ┌────────┐  ┌──────────┐  ┌────────────┐
   │accepted│  │ rejected │  │ superseded │
   └───┬────┘  └──────────┘  └────────────┘
       │
       │ new validated value
       ▼
   ┌────────────┐
   │ superseded │
   └────────────┘
```

| Transition | Effet |
|------------|-------|
| `suggested → accepted` | Marque l'opérateur comme validateur. **Déclenche** l'écriture du fact pivot dans `quote_facts` via `supersede_fact` (hors MAP-3). |
| `suggested → rejected` | Conservé pour audit. `is_current = false`. `rejection_reason` requis (logique côté UI). |
| `suggested → superseded` | Re-scoring : nouvelle ligne courante remplace l'ancienne. `supersedes_id` de la nouvelle pointe l'ancienne. |
| `accepted → superseded` | Nouvelle valeur validée remplace l'ancienne. Le fact pivot dans `quote_facts` est lui-même superseded en parallèle (RPC MAP-5). |

---

## 13. Règles d'écriture future vers `quote_facts`

Toute écriture pivot dans `quote_facts` à partir d'un candidat accepté **doit** respecter :

1. **Canal unique** : RPC `supersede_fact` (jamais d'INSERT direct dans `quote_facts`).
2. **Whitelist** : `fact_key` ∈ liste §5 uniquement.
3. **Pré-requis statut** : `commodity_classification_candidates.status = 'accepted'` ET `validated_by IS NOT NULL` ET `validated_at IS NOT NULL`.
4. **Sources interdites en auto** : `source IN ('ai_suggestion','web_hs_lookup')` ne peut **jamais** déclencher une écriture pivot sans validation opérateur explicite (doctrine PAD-R1B + operator-in-the-loop).
5. **Traçabilité** : le `quote_facts.source_type` reflète `operator` (validation humaine), et `value_json` peut référencer `commodity_classification_candidates.id` pour audit.

Cette logique est **hors périmètre MAP-3** (implémentation = MAP-5).

---

## 14. DDL illustratif

```sql
-- DRAFT ONLY — DO NOT EXECUTE
-- Schema design MAP-3. Migration réelle = MAP-3b (lot séparé, GO CTO requis).

-- =========================
-- Table candidats
-- =========================
CREATE TABLE public.commodity_classification_candidates (
  id                       uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                  uuid          NOT NULL,
  article_id               uuid          NULL,
  source_fact_id           uuid          NULL,

  designation_normalized   text          NOT NULL,
  candidate_kind           text          NOT NULL,
  candidate_value          text          NOT NULL,
  pad_category             text          NULL,
  droit_passage_value      numeric       NULL,
  droit_passage_currency   text          NULL,
  droit_passage_unit       text          NULL,

  source                   text          NOT NULL,
  evidence                 jsonb         NULL,
  confidence               numeric(3,2)  NOT NULL DEFAULT 0,
  score                    numeric       NULL,
  rank                     smallint      NULL,

  status                   text          NOT NULL DEFAULT 'suggested',
  is_current               boolean       NOT NULL DEFAULT true,
  validated_by             uuid          NULL,
  validated_at             timestamptz   NULL,
  rejection_reason         text          NULL,
  supersedes_id            uuid          NULL,

  created_at               timestamptz   NOT NULL DEFAULT now(),
  updated_at               timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT ccc_kind_chk CHECK (candidate_kind IN (
    'cn8','hs6','hs10_uemoa','nhm','nst2007','nstr','pad_label','pad_category'
  )),
  CONSTRAINT ccc_source_chk CHECK (source IN (
    'operator','structured_code_exact','validated_alias',
    'pad_label_2_3','reference_label_cn_nhm_nst_nstr',
    'ai_suggestion','web_hs_lookup'
  )),
  CONSTRAINT ccc_status_chk CHECK (status IN (
    'suggested','accepted','rejected','superseded'
  )),
  CONSTRAINT ccc_confidence_chk CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT ccc_rank_chk CHECK (rank IS NULL OR rank > 0),

  CONSTRAINT ccc_case_fk
    FOREIGN KEY (case_id) REFERENCES public.quote_cases(id) ON DELETE CASCADE,
  CONSTRAINT ccc_source_fact_fk
    FOREIGN KEY (source_fact_id) REFERENCES public.quote_facts(id) ON DELETE SET NULL,
  CONSTRAINT ccc_supersedes_fk
    FOREIGN KEY (supersedes_id) REFERENCES public.commodity_classification_candidates(id) ON DELETE SET NULL,
  CONSTRAINT ccc_validated_by_fk
    FOREIGN KEY (validated_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

-- =========================
-- Index
-- =========================
CREATE INDEX idx_ccc_case
  ON public.commodity_classification_candidates (case_id);

CREATE INDEX idx_ccc_case_article
  ON public.commodity_classification_candidates (case_id, article_id);

CREATE INDEX idx_ccc_case_kind_current
  ON public.commodity_classification_candidates (case_id, candidate_kind)
  WHERE is_current = true;

CREATE UNIQUE INDEX uq_ccc_current
  ON public.commodity_classification_candidates (
    case_id,
    COALESCE(article_id, '00000000-0000-0000-0000-000000000000'::uuid),
    candidate_kind,
    source,
    candidate_value
  )
  WHERE is_current = true;

CREATE INDEX idx_ccc_status_suggested
  ON public.commodity_classification_candidates (status)
  WHERE status = 'suggested';

CREATE INDEX idx_ccc_source_fact
  ON public.commodity_classification_candidates (source_fact_id)
  WHERE source_fact_id IS NOT NULL;

-- =========================
-- RLS (DRAFT — non appliquée dans MAP-3)
-- =========================
ALTER TABLE public.commodity_classification_candidates ENABLE ROW LEVEL SECURITY;

-- DRAFT: SELECT — accès dossier
-- CREATE POLICY "ccc_select_case_access"
--   ON public.commodity_classification_candidates
--   FOR SELECT
--   TO authenticated
--   USING (public.has_case_access(case_id));

-- DRAFT: INSERT/UPDATE — service_role + opérateur
-- CREATE POLICY "ccc_write_service_or_operator"
--   ON public.commodity_classification_candidates
--   FOR INSERT
--   TO authenticated
--   WITH CHECK (public.has_role(auth.uid(), 'operator'));
-- (policy équivalente pour UPDATE)

-- DRAFT: pas de policy DELETE → refusé par défaut

-- =========================
-- Triggers (DRAFT — non appliqués dans MAP-3)
-- =========================
-- DRAFT: timestamps
-- CREATE TRIGGER trg_ccc_updated_at
--   BEFORE UPDATE ON public.commodity_classification_candidates
--   FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- DRAFT: garde-fou status / is_current
-- CREATE FUNCTION public.ccc_status_consistency() RETURNS trigger
-- LANGUAGE plpgsql AS $$
-- BEGIN
--   IF NEW.status IN ('rejected','superseded') AND NEW.is_current = true THEN
--     RAISE EXCEPTION 'is_current must be false when status=%', NEW.status;
--   END IF;
--   RETURN NEW;
-- END $$;
--
-- CREATE TRIGGER trg_ccc_status_consistency
--   BEFORE INSERT OR UPDATE ON public.commodity_classification_candidates
--   FOR EACH ROW EXECUTE FUNCTION public.ccc_status_consistency();
```

---

## 15. Tests attendus pour MAP-3b (migration réelle)

Checklist non exécutée ici. Doit être validée lors de MAP-3b avant GO production.

1. **Insertion candidat** — INSERT minimal (`case_id`, `designation_normalized`, `candidate_kind`, `candidate_value`, `source`) → ligne créée avec `status='suggested'`, `is_current=true`.
2. **Idempotence** — réinsertion identique avec `ON CONFLICT DO NOTHING` sur `uq_ccc_current` → no-op (count inchangé).
3. **Supersession (re-scoring)** — INSERT nouvelle ligne + UPDATE ancienne (`is_current=false`, `status='superseded'`) en transaction → invariant unicité courante préservé.
4. **Garde-fou statut** — UPDATE `status='rejected'` avec `is_current=true` → exception trigger.
5. **RLS lecture** — utilisateur non lié au case → 0 ligne. Opérateur lié → lignes visibles.
6. **RLS écriture** — utilisateur non opérateur → INSERT refusé. Opérateur → INSERT autorisé. `service_role` → INSERT autorisé.
7. **RLS DELETE** — DELETE par n'importe quel rôle authentifié → refusé.
8. **Cascade ON DELETE case** — suppression `quote_cases` → candidats associés supprimés.
9. **`article_id NULL` vs UUID** — deux candidats avec mêmes `(case_id, candidate_kind, source, candidate_value)` mais `article_id` différents (NULL vs UUID) → coexistent grâce au `COALESCE` sentinel.
10. **FK source_fact_id SET NULL** — suppression d'un `quote_facts` source → candidat conservé avec `source_fact_id = NULL`.

---

## 16. Critères GO / NO-GO MAP-3b

### GO MAP-3b si :
1. CTO accepte le DDL §14 sans refonte structurelle majeure.
2. Fonction d'accès dossier (`has_case_access(case_id)` ou équivalent) confirmée présente, ou créée en pré-requis explicite.
3. Whitelist `fact_key` pivots §5 validée par opérations + CTO.
4. Pas de table article stable bloquante (modèle hybride `article_id` nullable accepté).
5. Pas de conflit avec un lot pricing en cours.

### NO-GO MAP-3b si :
1. Décision de fusionner candidats + facts dans `quote_facts` (rejette MAP-2 — non recommandé, casse l'invariant `uq_quote_facts_current_key`).
2. Apparition d'une table `cargo_articles` stable avec FK obligatoire (refonte du modèle de granularité — `article_id` devient NOT NULL + FK).
3. Refus du modèle hybride `article_id` nullable.
4. Refus de la whitelist `fact_key` pivots §5.

---

## 17. Verdict

`MAP_3_SCHEMA_DESIGN_READY`

> En cas de blocage levé à la revue (cf. §16 NO-GO), le verdict bascule en `MAP_3_BLOCKED` avec motif explicite à consigner dans `docs/DEFERRED_BACKLOG.md`.

---

## Références

- `docs/tariff-collection/pad/MAP_2_TECHNICAL_DESIGN_MULTI_SOURCE_PAD_SUGGESTION.md` (cascade fonctionnelle, audits, doctrine PAD-R1B).
- `docs/MASTER_CONTEXT.md` (gouvernance globale, RPC `supersede_fact`).
- `docs/DEFERRED_BACKLOG.md` (suivi des lots différés).

---

**Fin du document MAP-3 — schema-design only.**
