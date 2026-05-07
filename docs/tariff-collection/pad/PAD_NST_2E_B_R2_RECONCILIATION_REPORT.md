# PAD-NST-2E-B-R2 — Rapport de réconciliation finale

**Date** : 2026-05-08
**Phase** : PAD-NST-2E-B-R2 — Correction finale des règles de recommandation
**Statut** : ✅ APPLIQUÉE ET VÉRIFIÉE
**Cause racine** : Migration 2E-B initiale divergente du SQL généré par le script

## Historique des tentatives

| Phase | Résultat | Problème |
|-------|----------|----------|
| PAD-NST-2E-B (initial) | ❌ REJETÉ | 88 lignes importées mais pas les bonnes 88 (6 TIER-C incluses, 32 TIER-A/B manquantes) |
| PAD-NST-2E-B-R1 | ❌ ÉCHOUÉ | Correction déclarée mais jamais appliquée (aucune migration dans le dépôt) |
| **PAD-NST-2E-B-R2** | **✅ APPLIQUÉ** | Purge complète + réimport exact depuis script Python |

## Diagnostic pré-correction

| Métrique | Valeur avant R2 |
|----------|-----------------|
| total en base | 88 (mauvaises) |
| TIER-C présentes (interdites) | 6 |
| TIER-A/B manquantes | 32 |

### Règles TIER-C qui étaient présentes (interdites)

| Rule key | Audit R1 action | Confidence |
|----------|-----------------|------------|
| `group\|01.9\|T02` | remove | 0.45 |
| `group\|02.3\|T11` | defer | 0.70 |
| `group\|03.6\|T03` | remove | 0.45 |
| `group\|08.7\|T03` | remove | 0.45 |
| `group\|16.1\|T09` | defer | 0.75 |
| `group\|17.1\|T02` | defer | 0.60 |

## Méthode de correction

### Chaîne de génération (stricte)

```
pad_nst_2e_b_r2_corrective.py → pad_nst_2e_b_r2_corrective.sql → migration data-only
```

### Garde-fous appliqués

1. ✅ SQL généré automatiquement par script Python
2. ✅ Aucun INSERT écrit, corrigé, compacté ou reconstruit manuellement
3. ✅ Table temporaire `expected_rules` contenant exactement les 88 règles
4. ✅ Insertion dans `pad_nst_recommendation_rules` depuis `expected_rules` (SELECT)
5. ✅ Contrôles d'égalité EXCEPT bidirectionnels
6. ✅ 13 contrôles intégrés dans la migration (5 sur expected + 6 sur table finale + 2 EXCEPT)

### Sources de vérité

| Fichier | Rôle |
|---------|------|
| `pad_nst_2e_rule_candidates.csv` | Manifest original (evidence_level, source_document, notes) |
| `pad_nst_2e_audit_results.csv` | Audit R1 (adjusted_confidence, action, audit_tier) |
| `pad_nst_2e_b_r2_corrective.py` | Script de génération SQL R2 |
| `pad_nst_2e_b_r2_corrective.sql` | SQL généré (lecture seule, ne pas modifier) |

### Filtres appliqués

- `action NOT IN ('defer', 'remove')`
- `audit_tier IN ('TIER-A', 'TIER-B')`
- `evidence_level IN ('expert_rule', 'nstr_bridge_inferred')`

## Contrôles post-migration (tous vérifiés)

| # | Contrôle | Attendu | Résultat |
|---|----------|---------|----------|
| 1 | `count(*)` | 88 | **88** ✅ |
| 2 | `validation_status != 'candidate'` | 0 | **0** ✅ |
| 3 | `requires_operator_validation = false` | 0 | **0** ✅ |
| 4 | `is_active = false` | 0 | **0** ✅ |
| 5 | `evidence_level` invalide | 0 | **0** ✅ |
| 6 | `min(confidence)` | 0.45 | **0.45** ✅ |
| 7 | `max(confidence)` | 0.85 | **0.85** ✅ |
| 8 | 6 TIER-C présentes | 0 | **0** ✅ |
| 9 | 32 TIER-A/B anciennement manquantes | 32 | **32** ✅ |
| 10 | `nst_level = 'division'` | 19 | **19** ✅ |
| 11 | `nst_level = 'group'` | 69 | **69** ✅ |
| 12 | EQ1: table finale EXCEPT expected = 0 | 0 | **0** ✅ (dans migration) |
| 13 | EQ2: expected EXCEPT table finale = 0 | 0 | **0** ✅ (dans migration) |

## Répartition

| Tier | Règles |
|------|--------|
| TIER-A | 35 |
| TIER-B | 53 |
| TIER-C | 0 (exclu) |
| **Total** | **88** |

| evidence_level | Count |
|---------------|-------|
| expert_rule | 84 |
| nstr_bridge_inferred | 4 |

## Invariants respectés

- ✅ Aucune modification `src/`
- ✅ Aucune Edge Function
- ✅ Aucun `config.toml`
- ✅ Aucun runtime impacté
- ✅ Aucune modification de schéma
- ✅ Aucun `run-pricing`
- ✅ Script Python = seule source de génération SQL

## Audit documentaire

Le rapport d'audit CTO Manus est archivé comme pièce documentaire dans :
`docs/tariff-collection/pad/Rapport_Audit_CTO_Manus_PAD_NST.md`

Ce rapport sert à justifier le diagnostic, **pas** à générer les règles.

## Prochaines étapes

- **PAD-NST-2E-C-A** : Intégration runtime — DÉBLOQUÉ après validation de ce rapport
- **Audit opérateur** : Validation individuelle des 88 règles candidates via l'interface
