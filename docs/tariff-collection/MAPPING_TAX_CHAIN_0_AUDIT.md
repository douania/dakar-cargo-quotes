# MAPPING-TAX-CHAIN-0 — Audit READ-ONLY de la chaîne CN/NHM/NSTR → NST → PAD → taxe portuaire

**Date** : 2026-05-09
**Type** : Audit read-only / documentation-only
**Périmètre** : Vérifier si la chaîne `CN 2024 / NHM 2025 / NSTR 1967 → NST 2007 → PAD → taxe portuaire` est réellement automatique en runtime, ou seulement présente comme données dormantes.
**Garde-fous respectés** : aucune écriture DB, aucune migration, aucun patch runtime, aucune modification `src/` ni `supabase/functions/` ni `supabase/config.toml`, aucun C-D/C-C, aucun commit/push.

---

## §1 — Verdict exécutif (Q1 / Q2 / Q3 séparés)

| # | Question | Réponse | Justification synthétique |
|---|----------|---------|---------------------------|
| **Q1** | La chaîne peut-elle proposer **automatiquement une catégorie PAD** depuis un code CN, NHM ou NSTR figurant sur un document client ? | **NON automatique — PARTIEL en théorie** | Les bridges CN→NST, NHM→NST, NSTR→NST existent en DB et sont propres (0 orphelin), et `pad_nst_recommendation_rules` couvre 60 codes group + 14 codes division. Mais (a) aucun champ `cn_code` / `nhm_code` / `nstr_code` / `nst_code` n'existe sur `quote_facts`, `cargo` ou `commodity_categories` — la chaîne **ne peut pas démarrer depuis un dossier** ; (b) **aucune edge function ni composant** ne lit `nst_cn_mappings`, `nst_nhm_mappings`, `nstr_nst2007_mappings`, `nst_cpa_mappings`, `nst_groups`, `nst_divisions`. La seule source PAD réellement utilisée est `pad_designation_aliases` (alias texte → catégorie PAD). |
| **Q2** | La chaîne peut-elle calculer **automatiquement un montant PAD / taxe portuaire** depuis cette chaîne ? | **NON** | `port_tariffs.PORT_TAX` ne contient que **2 lignes, toutes `operation_type = TRANSIT`**. Aucun montant PORT_TAX IMPORT. Et même côté TRANSIT, il n'existe aucune jointure `pad_category × port_tariffs` qui produirait un montant à partir d'une catégorie PAD. La chaîne s'arrête à la catégorie PAD, jamais au montant. |
| **Q3** | La chaîne peut-elle proposer **automatiquement une charge compagnie / carrier** ? | **HORS CHAÎNE** | Les charges compagnie sont dans `carrier_billing_templates`, **chaîne distincte** déjà couverte par l'audit CARRIER-PORT-TAX-1B (3 trous structurels G1/G2/G3 documentés). Aucun lien CN/NHM/NSTR → carrier charges. |

**Verdict net** : **chaîne automatique complète = NON**. **Chaîne partielle = OUI** (bridges populés mais dormants ; PAD aliases actifs en runtime ; PAD recommendation rules actives mais isolées dans `get-pad-nst-suggestions`, non branchées à `run-pricing`).

---

## §2 — Inventaire DB (counts définitifs + clarification 73 vs 81)

### 2.1 Tables et volumétrie

| Table | Lignes | Colonnes | Usage runtime |
|-------|--------|----------|---------------|
| `nst_divisions` | **20** | 5 | ❌ jamais lue |
| `nst_groups` | **73** | 6 | ❌ jamais lue |
| `nstr_nst2007_mappings` | **9 781** (dont 5 quarantaine) | 15 | ❌ jamais lue |
| `nst_cn_mappings` | **9 762** | 10 | ❌ jamais lue |
| `nst_nhm_mappings` | **15 079** | 9 | ❌ jamais lue |
| `nst_cpa_mappings` | **1 759** | 9 | ❌ jamais lue |
| `nst_mapping_sources` | 4 | 9 | ❌ jamais lue |
| `pad_nst_recommendation_rules` | **88** (69 group + 19 division actifs) | 14 | ✅ `get-pad-nst-suggestions` uniquement |
| `pad_designation_aliases` | **384** | 12 | ✅ `recommend-pad-category`, `run-pricing` L1964, `DesignationSuggestionBlock`, `PadAliasTab` |
| `port_tariffs` | 98 | 17 | ✅ ailleurs (pricing) — mais `PORT_TAX` = 2 lignes TRANSIT only |
| `commodity_categories` | 19 | 21 | ✅ |

### 2.2 Réconciliation `nst_groups` 73 vs 81 (point obligatoire C1)

- **Documentation antérieure** (PAD-NST initial) : 81 groupes NST 2007 attendus.
- **DB active** : **73 groupes**, répartis sur **18 divisions** distinctes (manquent les divisions `15` et `20` dans `nst_groups`, mais ces deux divisions existent bien dans `nst_divisions` avec `label_fr = NULL`).
- **Distribution observée** :

  ```text
  div 01 → 11 groupes      div 09 →  3      div 17 → 2
  div 02 →  3              div 10 →  5      div 18 → 1
  div 03 →  6              div 11 →  8      div 19 → 2
  div 04 →  8              div 12 →  2      (div 15 → 0 — absente)
  div 05 →  3              div 13 →  2      (div 20 → 0 — absente)
  div 06 →  3              div 14 →  2
  div 07 →  4              div 16 →  1
  div 08 →  7
  ```

- **Écart explicatif** : 81 − 73 = **8 groupes manquants**, vraisemblablement répartis sur :
  - division 15 (« Autres produits non classés ailleurs ») — non peuplée ;
  - division 20 (« Marchandises non identifiables ») — non peuplée ;
  - éventuels sous-groupes niveau 2 chiffres dans d'autres divisions non importés.
- **Cause technique probable** : import partiel lors du chargement initial NST 2007 ; aucun champ `is_active` sur `nst_groups` (il n'existe pas), donc la différence n'est **pas due à un filtrage logique** mais à une **absence physique en table**.
- **Impact** : faible aujourd'hui (table jamais lue par le runtime), mais **bloquant** si on ouvre Q1 en automatique : un dossier portant un produit relevant des divisions 15 ou 20 ne pourra jamais résoudre vers une catégorie PAD via cette chaîne.
- **Action recommandée** (sans exécution) : à traiter avant tout chantier d'activation runtime — soit reconstruction depuis source officielle Eurostat NST 2007, soit acceptation explicite de la couverture 73/81 documentée dans le backlog.

---

## §3 — Cartographie FK physique / lien logique / orphelins (point obligatoire C2)

| Lien (de → vers) | FK physique (`pg_constraint`) | Lien logique testable | Orphelins |
|------------------|------------------------------|-----------------------|-----------|
| `nst_groups.division_code` → `nst_divisions.division_code` | ✅ `nst_groups_division_code_fkey` | ✅ JOIN | **0** |
| `nst_cn_mappings.nst_group_code` → `nst_groups.group_code` | ✅ `nst_cn_mappings_nst_group_code_fkey` | ✅ JOIN | **0** |
| `nst_nhm_mappings.nst_group_code` → `nst_groups.group_code` | ✅ `nst_nhm_mappings_nst_group_code_fkey` | ✅ JOIN | **0** |
| `nst_cpa_mappings.nst_group_code` → `nst_groups.group_code` | ✅ `nst_cpa_mappings_nst_group_code_fkey` | ✅ JOIN | **0** |
| `nstr_nst2007_mappings.nst2007_code` → `nst_groups.group_code` | ✅ `nstr_nst2007_mappings_nst2007_code_fkey` | ✅ JOIN | **0** actifs (5 quarantine) |
| `pad_nst_recommendation_rules.nst_code` → `nst_groups.group_code` (level=`group`) | ❌ pas de FK | ✅ JOIN logique | non bloquant — couvre 60 / 73 groupes |
| `pad_nst_recommendation_rules.nst_code` → `nst_divisions.division_code` (level=`division`) | ❌ pas de FK | ✅ JOIN logique | non bloquant — couvre 14 / 20 divisions |
| `pad_designation_aliases.commodity_category_id` → `commodity_categories.id` | ✅ FK | ✅ | — |

**Constat structurel** : intégrité référentielle CN/NHM/NSTR/CPA → NST = **parfaite** côté FK physique. Les jointures runtime fonctionneraient sans bruit. Les 5 lignes NSTR `is_quarantined=true` sont correctement isolées.

**Couverture NST→PAD** : 60/73 groupes (82 %) et 14/20 divisions (70 %) ont au moins une règle PAD. **13 groupes** restent sans règle PAD directe (dégradation possible vers la règle de leur division parente).

---

## §4 — Tests de chaînage avec distribution d'ambiguïté (point obligatoire C3)

| Source | Codes distincts testés | 1 NST exact | n NST (ambigu) | 0 NST |
|--------|------------------------|-------------|----------------|-------|
| **CN 2024** | 9 762 | **9 762 (100 %)** | 0 | 0 |
| **NHM 2025** | 15 079 | **15 079 (100 %)** | 0 | 0 |
| **NSTR 1967** | 173 | 91 (52,6 %) | **82 (47,4 %)** | 0 |

| Étape suivante | Codes distincts | 1 PAD | n PAD (ambigu) |
|----------------|-----------------|-------|----------------|
| **NST → PAD** (rules actives) | 74 | 60 (81 %) | **14 (19 %)** |

**Lecture** :
- **CN et NHM** sont déterministes vers NST 2007 — un code CN ou NHM donne toujours **exactement un** code NST 2007.
- **NSTR** est ambigu à 47 % — un code NSTR remonte fréquemment à plusieurs codes NST 2007 (chaîne difficile à automatiser sans arbitrage).
- **NST → PAD** présente 19 % d'ambiguïté (un code NST peut recommander plusieurs catégories PAD selon `evidence_level` / `confidence`). C'est compatible avec un usage **assistance opérateur** (ce qui est le cas actuel via `get-pad-nst-suggestions`), mais incompatible avec une décision automatique sans arbitrage.

**Conclusion §4** : automatisation crédible **uniquement** par les voies CN→NST et NHM→NST, et seulement jusqu'à la **suggestion** de catégorie PAD — pas la décision.

---

## §5 — Inventaire runtime exhaustif (point obligatoire — hors `types.ts`)

Recherche `rg` sur `supabase/functions/**` et `src/**` pour les 7 tables clés de la chaîne :

| Fichier | Tables lues |
|---------|-------------|
| `supabase/functions/get-pad-nst-suggestions/index.ts` (L87) | `pad_nst_recommendation_rules` |
| `supabase/functions/recommend-pad-category/index.ts` (L55) | `pad_designation_aliases` |
| `supabase/functions/run-pricing/index.ts` (L1964) | `pad_designation_aliases` |
| `src/components/case/DesignationSuggestionBlock.tsx` (L84, L181) | `pad_designation_aliases` |
| `src/components/admin/PadAliasTab.tsx` (L69, L99, L118, L137, L149) | `pad_designation_aliases` (CRUD admin) |
| `supabase/functions/_tests/pad_nom3_runtime_smoke.test.ts` | tests |
| `supabase/functions/_tests/pad_alias_smoke.test.ts` | tests |

**Tables JAMAIS lues par le runtime** :
- `nst_divisions`
- `nst_groups`
- `nstr_nst2007_mappings`
- `nst_cn_mappings`
- `nst_nhm_mappings`
- `nst_cpa_mappings`
- `nst_mapping_sources`

**Confirmation** : les bridges CN/NHM/NSTR/CPA sont des **entrepôts de données dormants**, pas des chaînes runtime actives.

---

## §6 — Champs absents côté dossier (point obligatoire)

Recherche colonnes `nst_code`, `cn_code`, `nhm_code`, `nstr_code`, `pad_category` sur `quote_facts`, `cargo`, `commodity_categories` :

| Table | `nst_code` | `cn_code` | `nhm_code` | `nstr_code` | `pad_category` |
|-------|:---------:|:---------:|:----------:|:-----------:|:--------------:|
| `quote_facts` | ❌ | ❌ | ❌ | ❌ | ❌ |
| `cargo` | ❌ | ❌ | ❌ | ❌ | ❌ |
| `commodity_categories` | ❌ | ❌ | ❌ | ❌ | ✅ + `pad_category_label`, `hs_chapter`, `terminal_handling_code` |

**Constat T2 confirmé** : un dossier ne porte **aucun** code pivot CN/NHM/NSTR/NST. La chaîne **ne peut pas démarrer depuis un fact existant** — elle pourrait au mieux démarrer depuis `commodity_categories.pad_category` (qui est l'aboutissement, pas le point d'entrée) ou depuis `commodity_categories.hs_chapter` (chapitre HS uniquement, granularité trop large pour résoudre vers NST).

---

## §7 — Classification des fichiers `nst_cn2024.xlsx` et `nst_nhm2024.xlsx` (point obligatoire C5)

Présents à la racine du repo : `nst_cn2024.xlsx` (4561 octets) et `nst_nhm2024.xlsx` (4561 octets).

**Inspection binaire** (`head -c 300`) : les deux fichiers commencent par `<!DOCTYPE html>` et la chaîne `cloudflare/no-js`. Ce **ne sont pas des fichiers xlsx valides** — ce sont des **pages d'erreur HTML Cloudflare** (challenge anti-bot ou 403) capturées lors d'une tentative de download avortée.

**Recherche `rg`** : aucune référence à ces deux fichiers dans `scripts/`, `docs/`, `supabase/migrations/`, `supabase/functions/`, `src/`. Aucun consommateur.

**Statut** : **résidus d'import raté**, jamais exploités. **Recommandation** (sans exécution) : suppression à valider — non bloquant tant que la chaîne CN/NHM reste dormante. La data CN et NHM en DB (`nst_cn_mappings` 9 762 lignes, `nst_nhm_mappings` 15 079 lignes) provient d'une autre source d'import (cf. `nst_mapping_sources`, 4 entrées).

---

## §8 — Trous structurels

| ID | Nature | Sévérité | Impact |
|----|--------|----------|--------|
| **T1** | Bridges CN/NHM/NSTR/CPA → NST = entrepôts dormants (jamais lus par le runtime). | 🟡 moyen | Investissement data sans retour fonctionnel. |
| **T2** | Aucun code pivot (`nst_code`/`cn_code`/`nhm_code`/`nstr_code`) sur `quote_facts` ni `cargo`. | 🔴 bloquant Q1 | La chaîne ne peut pas démarrer depuis un dossier. |
| **T3** | Aucune résolution `CN→NST` ou `NHM→NST` dans une edge function. | 🔴 bloquant Q1 | Aucune voie d'entrée codée. |
| **T4** | `pad_nst_recommendation_rules` lue uniquement par `get-pad-nst-suggestions` — **non branchée à `run-pricing`** (cohérent avec NO-GO C-C en cours). | 🟡 attendu | Point arbitré séparément (PAD-NST C-C). |
| **T5** | Aucun calcul automatique de **montant** taxe portuaire depuis `pad_category` — `port_tariffs.PORT_TAX` n'existe que pour TRANSIT (2 lignes), 0 ligne IMPORT. | 🔴 bloquant Q2 | La chaîne s'arrête à la catégorie. |
| **T6** | Carrier charges = chaîne distincte, traitée par CARRIER-PORT-TAX-1B. | ℹ️ renvoi | Pas du périmètre. |
| **T7** | Couverture `nst_groups` = 73/81 documentés ; divisions 15 et 20 non peuplées en groupes. | 🟡 latent | Bloque Q1 sur produits non-classés. |
| **T8** | NSTR ambigu à 47 % (1 NSTR → n NST 2007). | 🟡 | Voie NSTR non automatisable sans arbitrage opérateur. |
| **T9** | NST→PAD ambigu à 19 % (14 codes NST → plusieurs PAD). | 🟡 | Aboutit à suggestion, pas décision. |

---

## §9 — Options de chantier futur (sans exécution)

| Option | Description | Pré-requis | Risque |
|--------|-------------|------------|--------|
| **A** | **Connecter les bridges au runtime** : créer une edge function `resolve-nst-from-code(code, type)` lisant `nst_cn_mappings` / `nst_nhm_mappings` / `nstr_nst2007_mappings` puis chaînant vers `pad_nst_recommendation_rules`. | T2 résolu (champs codes pivots ajoutés aux facts). Comble Q1 partiellement (CN/NHM seulement, NSTR reste ambigu). | Moyen — touche `quote_facts` et expose ambiguïté NSTR/PAD. |
| **B** | **Ajouter colonnes pivots aux facts** : `cn_code`, `nhm_code`, `nstr_code`, `nst_code` sur `quote_facts` (extraction depuis documents). | Migration + extraction AI à entraîner. Sans A, ne sert à rien. | Faible structurellement, fort en data engineering. |
| **C** | **Statu quo + consolider C-D PAD-NST** d'abord. Garder bridges en data, ne pas activer en runtime tant que l'écran C-D opérateur n'est pas en place. | Aucun. Aligné avec gouvernance opérateur-in-the-loop. | Nul — option par défaut. |
| **D** | **Construire une table `pad_port_tax_amounts(pad_category, operation_type, amount, unit)`** alimentée depuis source officielle PAD pour combler T5. | Source officielle PAD à valider. | Hors périmètre actuel. |

**Recommandation CTO suggérée** : **Option C** (statu quo) jusqu'à clôture PAD-NST C-D. Ouvrir Option A uniquement si le besoin métier d'auto-suggestion PAD depuis CN/NHM se confirme dans plus de 3 dossiers récents.

---

## §10 — Annexes

### 10.1 Requêtes SQL exécutées

Toutes via `supabase--read_query` (SELECT seul, aucun DML).

```sql
-- Inventaire tables
SELECT table_name, count(*) FROM information_schema.tables
 WHERE table_schema='public' AND table_name ILIKE '%nst%' OR ...

-- Counts
SELECT count(*) FROM nst_groups;            -- 73
SELECT count(*) FROM nst_divisions;         -- 20
SELECT count(*) FROM nstr_nst2007_mappings; -- 9781 (5 quarantine)
SELECT count(*) FROM nst_cn_mappings;       -- 9762
SELECT count(*) FROM nst_nhm_mappings;      -- 15079
SELECT count(*) FROM nst_cpa_mappings;      -- 1759
SELECT count(*) FROM pad_nst_recommendation_rules; -- 88

-- Ambiguïté
WITH cn AS (SELECT cn_code, count(DISTINCT nst_group_code) n FROM nst_cn_mappings GROUP BY cn_code)
SELECT count(*) total, count(*) FILTER (WHERE n=1) one, count(*) FILTER (WHERE n>1) multi FROM cn;
-- (idem NHM, NSTR, NST→PAD)

-- FK
SELECT conname, conrelid::regclass, confrelid::regclass FROM pg_constraint WHERE contype='f' AND ...

-- PORT_TAX
SELECT operation_type, classification, amount, unit FROM port_tariffs
 WHERE category='PORT_TAX' AND is_active;
-- → 2 lignes TRANSIT, 0 IMPORT
```

### 10.2 Confirmation diff réel final

Modifications effectuées par cet audit :

```text
docs/tariff-collection/MAPPING_TAX_CHAIN_0_AUDIT.md  (créé)
docs/DEFERRED_BACKLOG.md                             (entrée MAPPING-TAX-CHAIN-0 ajoutée)
```

Confirmation garde-fous :
- `src/`                    → **0 fichier modifié**
- `supabase/functions/`     → **0 fichier modifié**
- `supabase/config.toml`    → **0 modification**
- `supabase/migrations/`    → **0 nouvelle migration**
- DB                        → **0 écriture** (uniquement SELECT via `supabase--read_query`)
- C-D / C-C                 → **non touchés**
- Commit/push               → **non exécuté**

---

## Verdict net final

**Chaîne automatique complète CN/NHM/NSTR → NST → PAD → taxe portuaire = NON.**
**Chaîne partielle = OUI** :
- CN→NST et NHM→NST sont déterministes et populés en DB, mais **dormants** (non lus par le runtime) ;
- NSTR→NST est populé mais ambigu à 47 % ;
- NST→PAD est populé (74 codes couverts) mais **isolé dans `get-pad-nst-suggestions`**, non branché à `run-pricing` ;
- Aucun champ pivot (`cn_code`/`nhm_code`/`nstr_code`/`nst_code`) sur `quote_facts` ou `cargo` → la chaîne **ne peut pas démarrer** depuis un dossier ;
- `port_tariffs.PORT_TAX` ne couvre que TRANSIT (2 lignes), **aucun montant IMPORT** → la chaîne **ne peut pas aboutir** à un montant.

En attente arbitrage CTO sur les options A / B / C / D.
