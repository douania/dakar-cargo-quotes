# PAD-NST-2E-B — Rapport d'import

**Date** : 2026-05-07
**Phase** : PAD-NST-2E-B — Import contrôlé des 88 règles candidates
**Méthode** : Script Python → SQL généré → Migration data-only Lovable Cloud (voie unique)
**Statut** : ✅ EXÉCUTÉ — Tous contrôles conformes

## Résumé

88 règles candidates issues de l'audit PAD-NST-2E-AUDIT-R1 ont été importées dans la table `pad_nst_recommendation_rules` via une migration data-only transactionnelle unique.

## Compteurs vérifiés post-import

| Contrôle | Attendu | Résultat |
|----------|---------|----------|
| `count(*)` | 88 | **88** ✅ |
| `validation_status != 'candidate'` | 0 | **0** ✅ |
| `requires_operator_validation = false` | 0 | **0** ✅ |
| `is_active = false` | 0 | **0** ✅ |
| `evidence_level hors (expert_rule, nstr_bridge_inferred)` | 0 | **0** ✅ |
| `min(confidence)` | 0.45 | **0.45** ✅ |
| `max(confidence)` | 0.85 | **0.85** ✅ |
| `nst_level = 'division'` | 19 | **19** ✅ |
| `nst_level = 'group'` | 69 | **69** ✅ |

## Répartition par tier d'audit

| Tier | Règles importées |
|------|-----------------|
| TIER-A | 35 |
| TIER-B | 53 |
| TIER-C | 0 (exclu) |
| **Total importé** | **88** |

## Règles NON importées (24)

- **20 différées** (action = `defer`) — TIER-C
- **4 retirées** (action = `remove`) — TIER-C

## Evidence levels

| evidence_level | Count |
|---------------|-------|
| expert_rule | 84 |
| nstr_bridge_inferred | 4 |

## Invariants respectés

- ✅ Aucune règle `validated`
- ✅ Aucune règle `requires_operator_validation = false`
- ✅ Aucune règle `pad_official_extract`
- ✅ Aucune règle `operator_override`
- ✅ Aucune modification `src/`
- ✅ Aucune Edge Function
- ✅ Aucun `config.toml`
- ✅ Aucun runtime impacté

## Livrables

| Fichier | Rôle |
|---------|------|
| `docs/tariff-collection/pad/scripts/pad_nst_2e_import.py` | Script générateur SQL |
| `docs/tariff-collection/pad/rules/pad_nst_2e_import.sql` | SQL généré (88 INSERT + contrôles) |
| `docs/tariff-collection/pad/PAD_NST_2E_IMPORT_REPORT.md` | Ce rapport |

## Méthode d'import

1. Script Python lit le manifest CSV + audit CSV R1
2. Fusionne les données (confidence R1, evidence_level, notes enrichies)
3. Génère un fichier SQL transactionnel avec :
   - Vérification table vide avant import
   - 88 INSERT explicites
   - 6 contrôles post-import avec `RAISE EXCEPTION` si écart
4. Migration data-only exécutée via Lovable Cloud (voie unique)
5. Vérifications post-import via requêtes DB

## Prochaines étapes possibles

- **PAD-NST-2E-C** : Intégration runtime (lecture des règles dans le moteur de pricing) — requiert validation CTO
- **Audit opérateur** : Validation individuelle des règles par l'opérateur via l'interface
