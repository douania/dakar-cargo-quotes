# PAD-NST-2E-B — Rapport d'import

**Date** : 2026-05-07 → clôture définitive 2026-05-09
**Phase** : PAD-NST-2E-B — Import contrôlé des 88 règles candidates
**Méthode** : Script Python → SQL généré → Migration data-only (voie unique)
**Statut** : ✅ ALIGNEMENT DÉFINITIF — R3 v3 appliqué en DB réelle (2026-05-09)

> **Historique complet** :
> 1. **Import initial (2026-05-07)** : 88 lignes importées mais pas les bonnes 88 (6 TIER-C incluses, 32 TIER-A/B manquantes). Invalidé.
> 2. **R1** : Correction préparée mais jamais appliquée en DB.
> 3. **R2 (2026-05-08)** : Migration `20260508200000_pad_nst_2e_b_r3_corrective.sql` exécutée. Réalignement constaté incomplet après réconciliation DB active : 9 extras, 9 manquants, 16 écarts confidence, 5 écarts evidence_level, orphan `group|15.1|T02`. R2 **réouvert**.
> 4. **R3 v3 (2026-05-09)** : Migration `20260509120000_pad_nst_2e_b_r3_v3_corrective.sql` exécutée via `supabase--migration` rôle service. Garde E0 (MD5 `H_source = 4fba07069aa5f7eaa487cb33838f3c6f`) vérifiée. Tous contrôles internes passés (E0+E1–E5+F1–F6+EQ1+EQ2). DB finale = 88 règles TIER-A/B conformes.
>
> Voir `PAD_NST_2E_B_R3_FORENSIC_REPORT.md` et `PAD_NST_2E_B_R3_V3_DIFF_VERIFICATION.md` pour le détail complet.

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

## État DB finale post-R3 v3 (2026-05-09)

| Contrôle | Attendu | Résultat |
|----------|---------|----------|
| `count(*)` | 88 | **88** ✅ |
| `validation_status != 'candidate'` | 0 | **0** ✅ |
| `requires_operator_validation = false` | 0 | **0** ✅ |
| `is_active = false` | 0 | **0** ✅ |
| `evidence_level hors whitelist` | 0 | **0** ✅ |
| Group orphelins | 0 | **0** ✅ |
| `group\|15.1\|T02` absent | absent | **absent** ✅ |
| `H_db = H_source` (garde E0) | égaux | **égaux** ✅ |

**Evidence levels post-R3 v3** :

| evidence_level | Count |
|---------------|-------|
| expert_rule | 84 |
| nstr_bridge_inferred | 4 |

## Prochaines étapes possibles

- **PAD-NST-2E-C-D** : Implémentation UI opérateur — EN ATTENTE GO CTO séparé (précondition R3 levée)
- **Audit opérateur** : Validation individuelle des règles par l'opérateur via l'interface
