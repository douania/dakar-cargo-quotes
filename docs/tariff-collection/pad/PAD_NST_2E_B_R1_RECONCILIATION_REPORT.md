# PAD-NST-2E-B-R1 — Rapport de réconciliation

**Date** : 2026-05-07
**Phase** : PAD-NST-2E-B-R1 — Réconciliation import réel vs audit R1
**Statut** : ✅ CORRECTION APPLIQUÉE
**Cause** : Migration 2E-B initiale non alignée avec l'audit R1

## Diagnostic

### Problème identifié

La migration `20260507192300_4b2c5072-8c20-411b-bc09-f8ca1a2139c2.sql` appliquée lors de PAD-NST-2E-B a inséré **88 lignes**, mais **pas les bonnes 88**. Le script Python `pad_nst_2e_import.py` produit un SQL correct (`pad_nst_2e_import.sql`), mais la migration réellement appliquée a été générée avec un filtrage différent du CSV d'audit R1.

### Cause racine

La migration a été construite à partir du manifest original (`pad_nst_2e_rule_candidates.csv`) sans correctement cross-référencer le fichier d'audit R1 (`pad_nst_2e_audit_results.csv`). Résultat : elle a pris 88 règles sur 112, mais en incluant 6 TIER-C et en excluant 32 TIER-A/B.

## Compteurs avant correction

| Métrique | Valeur |
|----------|--------|
| Lignes en base | 88 |
| Lignes attendues (audit R1 filtré) | 88 |
| Règles correctement importées | 56 |
| Règles **wrongly imported** (TIER-C en base) | **6** |
| Règles **missing** (TIER-A/B absentes) | **32** |

## Règles wrongly imported (6)

Ces règles sont marquées `remove` ou `defer` dans l'audit R1, TIER-C, et n'auraient **jamais dû être importées** :

| Rule key | Tier | Action audit R1 | Confidence en base | Problème |
|----------|------|------------------|--------------------|----------|
| `group\|01.9\|T02` | TIER-C | remove | 0.45 | Catégorie résiduelle trop hétérogène |
| `group\|02.3\|T11` | TIER-C | defer | 0.70 | Gaz naturel ≠ T11, pas de catégorie PAD dédiée |
| `group\|03.6\|T03` | TIER-C | remove | 0.45 | Catégorie résiduelle |
| `group\|08.7\|T03` | TIER-C | remove | 0.45 | Fibres synthétiques, confiance trop faible |
| `group\|16.1\|T09` | TIER-C | defer | 0.75 | Conteneurs vides, classification incertaine |
| `group\|17.1\|T02` | TIER-C | defer | 0.60 | Déménagement, catégorie par défaut |

## Règles missing (32)

Ces règles sont marquées `keep_as_is`, `adjust_confidence` ou `enrich_notes` dans l'audit R1, TIER-A ou TIER-B, et **auraient dû être importées** :

| Rule key | Tier | Action audit R1 | Confidence R1 |
|----------|------|-----------------|---------------|
| `group\|01.3\|T03` | TIER-B | adjust_confidence | 0.50 |
| `group\|01.5\|T04` | TIER-A | keep_as_is | 0.80 |
| `group\|01.7\|T03` | TIER-B | keep_as_is | 0.55 |
| `group\|01.B\|P05` | TIER-A | keep_as_is | 0.80 |
| `group\|02.3\|T06` | TIER-B | enrich_notes | 0.55 |
| `group\|03.3\|T06` | TIER-B | adjust_confidence | 0.50 |
| `group\|03.5\|T07` | TIER-A | keep_as_is | 0.80 |
| `group\|04.2\|P05` | TIER-A | keep_as_is | 0.75 |
| `group\|04.5\|T02` | TIER-B | keep_as_is | 0.50 |
| `group\|04.6\|T05` | TIER-A | keep_as_is | 0.80 |
| `group\|04.6\|T07` | TIER-B | adjust_confidence | 0.50 |
| `group\|04.7\|T01` | TIER-B | adjust_confidence | 0.50 |
| `group\|04.7\|T02` | TIER-B | keep_as_is | 0.50 |
| `group\|04.8\|T01` | TIER-B | adjust_confidence | 0.45 |
| `group\|04.8\|T02` | TIER-B | keep_as_is | 0.55 |
| `group\|05.3\|T12` | TIER-B | keep_as_is | 0.60 |
| `group\|06.3\|T12` | TIER-B | keep_as_is | 0.55 |
| `group\|07.1\|T07` | TIER-A | keep_as_is | 0.80 |
| `group\|07.2\|T06` | TIER-B | enrich_notes | 0.55 |
| `group\|07.3\|T06` | TIER-A | keep_as_is | 0.80 |
| `group\|07.4\|T11` | TIER-A | keep_as_is | 0.80 |
| `group\|08.2\|T03` | TIER-B | keep_as_is | 0.60 |
| `group\|08.3\|T08` | TIER-B | keep_as_is | 0.65 |
| `group\|08.4\|T03` | TIER-B | enrich_notes | 0.55 |
| `group\|08.4\|T12` | TIER-B | adjust_confidence | 0.45 |
| `group\|08.6\|T12` | TIER-A | keep_as_is | 0.75 |
| `group\|09.2\|T07` | TIER-B | enrich_notes | 0.55 |
| `group\|09.3\|T07` | TIER-B | keep_as_is | 0.55 |
| `group\|10.2\|T12` | TIER-B | keep_as_is | 0.60 |
| `group\|11.2\|T01` | TIER-B | keep_as_is | 0.60 |
| `group\|11.7\|T01` | TIER-A | keep_as_is | 0.80 |
| `group\|13.2\|T01` | TIER-B | adjust_confidence | 0.45 |

## Correction appliquée

### Stratégie

- `DELETE FROM public.pad_nst_recommendation_rules;` (purge complète)
- Réimport exact des 88 règles autorisées par l'audit R1
- Source de vérité : `pad_nst_2e_audit_results.csv` filtré `action NOT IN ('defer', 'remove')` + `audit_tier IN ('TIER-A', 'TIER-B')`

### Contrôles post-correction (10)

| # | Contrôle | Attendu |
|---|----------|---------|
| 1 | `count(*)` | 88 |
| 2 | `validation_status != 'candidate'` | 0 |
| 3 | `requires_operator_validation = false` | 0 |
| 4 | `is_active = false` | 0 |
| 5 | `evidence_level` invalide | 0 |
| 6 | `min(confidence)` | 0.45 |
| 7 | `max(confidence)` | 0.85 |
| 8 | Aucune rule_key `defer`/`remove` en base | 0 (24 vérifiées) |
| 9 | Aucune rule_key attendue absente | 0 |
| 10 | Aucune TIER-C en base | 0 |

## Invariants respectés

- ✅ Migration data-only uniquement
- ✅ Aucune modification `src/`
- ✅ Aucune Edge Function
- ✅ Aucun `config.toml`
- ✅ Aucun runtime impacté
- ✅ Aucune modification de schéma
- ✅ Aucun `run-pricing`

## Source de vérité

Le fichier `docs/tariff-collection/pad/rules/pad_nst_2e_audit_results.csv` filtré avec `action NOT IN ('defer', 'remove')` est la source de vérité unique. Le script `pad_nst_2e_import.py` produit le SQL correct.
