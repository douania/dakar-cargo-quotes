# PAD-NST-2B — Rapport de migration structurelle

**Date** : 2026-05-07
**Statut** : ✅ EXÉCUTÉ
**Phase** : PAD-NST-2B

---

## 1. Tables créées (7, toutes vides)

| # | Table | Colonnes clés | CHECK |
|---|-------|--------------|-------|
| 1 | `nst_divisions` | `division_code` (UNIQUE) | `~ '^[0-9]{2}$'` |
| 2 | `nst_groups` | `group_code` (UNIQUE), FK → `nst_divisions.division_code` | `~ '^[0-9]{2}\.[0-9A-Z]$'` |
| 3 | `nst_mapping_sources` | `source_name`, `sha256_hash`, `phase` | — |
| 4 | `nst_cn_mappings` | FK → `nst_groups.group_code`, FK → `nst_mapping_sources.id` | `cn_code ~ '^[0-9]{8}$'`, `hs6_prefix ~ '^[0-9]{6}$'` |
| 5 | `nst_cpa_mappings` | FK → `nst_groups.group_code`, FK → `nst_mapping_sources.id` | — |
| 6 | `nst_nhm_mappings` | FK → `nst_groups.group_code`, FK → `nst_mapping_sources.id` | — |
| 7 | `nstr_nst2007_mappings` | FK → `nst_groups.group_code`, FK → `nst_mapping_sources.id` | `nstr_code ~ '^[0-9]{3}$'`, `nstr_chapter ~ '^[0-9]{2}$'`, `nst2007_code <> '.'` |

## 2. Index créés (15)

| Index | Table | Colonne(s) |
|-------|-------|-----------|
| `idx_nst_groups_division_code` | `nst_groups` | `division_code` |
| `idx_nst_cn_mappings_group_code` | `nst_cn_mappings` | `nst_group_code` |
| `idx_nst_cn_mappings_cn_code` | `nst_cn_mappings` | `cn_code` |
| `idx_nst_cn_mappings_hs6_prefix` | `nst_cn_mappings` | `hs6_prefix` |
| `idx_nst_cn_mappings_source_id` | `nst_cn_mappings` | `source_id` |
| `idx_nst_cpa_mappings_group_code` | `nst_cpa_mappings` | `nst_group_code` |
| `idx_nst_cpa_mappings_cpa_code` | `nst_cpa_mappings` | `cpa_code` |
| `idx_nst_cpa_mappings_source_id` | `nst_cpa_mappings` | `source_id` |
| `idx_nst_nhm_mappings_group_code` | `nst_nhm_mappings` | `nst_group_code` |
| `idx_nst_nhm_mappings_nhm_code` | `nst_nhm_mappings` | `nhm_code` |
| `idx_nst_nhm_mappings_source_id` | `nst_nhm_mappings` | `source_id` |
| `idx_nstr_mappings_nstr_code` | `nstr_nst2007_mappings` | `nstr_code` |
| `idx_nstr_mappings_nstr_chapter` | `nstr_nst2007_mappings` | `nstr_chapter` |
| `idx_nstr_mappings_nst2007_code` | `nstr_nst2007_mappings` | `nst2007_code` |
| `idx_nstr_mappings_source_id` | `nstr_nst2007_mappings` | `source_id` |

## 3. Policies RLS (7)

Toutes les tables : `ENABLE ROW LEVEL SECURITY` + une seule policy :

```
SELECT TO authenticated USING (true)
```

Aucune policy INSERT, UPDATE ou DELETE côté client.

## 4. Confirmations

- ✅ Aucune donnée importée (tables vides)
- ✅ Aucune modification `src/`
- ✅ Aucune Edge Function
- ✅ Aucun `config.toml` modifié
- ✅ Aucun runtime modifié
- ✅ Aucun run-pricing
- ✅ Tables règles/audit restent déférées (PAD-NST-2C/2D)

## 5. Prochaine étape

**PAD-NST-2C** — Import contrôlé des données référentielles dans les 7 tables.
