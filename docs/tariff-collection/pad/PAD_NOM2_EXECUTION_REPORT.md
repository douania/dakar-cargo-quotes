# PAD-NOM-2 — Rapport d'exécution

**Date d'exécution :** 2026-05-07  
**Statut :** ✅ SUCCÈS — tous les post-checks passent  
**Migration :** idempotente, exécutée en une seule transaction via outil migration Lovable Cloud

---

## Résumé chiffré

| Métrique | Valeur |
|----------|--------|
| Alias **avant** migration | 60 |
| Alias **après** migration | 384 |
| Alias `official_nomenclature` insérés | 324 |
| Alias ignorés (ON CONFLICT) | 4 |
| Catégories créées | 9 (P01–P05, T06, T08, T10, T11) |
| CHECK `source_type` étendu | ✅ `official_nomenclature` ajouté |

---

## Distribution par `pad_category` (384 alias totaux)

| Catégorie | Avant | Après | Δ |
|-----------|------:|------:|--:|
| P01 | 0 | 1 | +1 |
| P02 | 0 | 1 | +1 |
| P03 | 0 | 4 | +4 |
| P04 | 0 | 1 | +1 |
| P05 | 0 | 1 | +1 |
| T01 | 3 | 37 | +34 |
| T02 | 6 | 89 | +83 |
| T03 | 1 | 25 | +24 |
| T04 | 7 | 29 | +22 |
| T05 | 2 | 16 | +14 |
| T06 | 0 | 8 | +8 |
| T07 | 2 | 29 | +27 |
| T08 | 0 | 7 | +7 |
| T09 | 3 | 10 | +7 |
| T10 | 0 | 1 | +1 |
| T11 | 0 | 12 | +12 |
| T12 | 22 | 101 | +79 |
| T13 | 4 | 5 | +1 |
| T14 | 6 | 7 | +1 |
| **Total** | **60** | **384** | **+324** |

---

## Post-checks (11/11 PASS)

| # | Check | Résultat |
|---|-------|----------|
| 1 | Nombre total alias avant/après | 60 → 384 ✅ |
| 2 | Alias `source_type='official_nomenclature'` | 324 ✅ |
| 3 | Alias réellement insérés | 324 (328 − 4 conflits) ✅ |
| 4 | Lignes ignorées par ON CONFLICT | 4 (clinker→T07, farine de ble→T07, materiel de chantier→T09, tracteurs agricoles→T09) ✅ |
| 5 | Distribution par pad_category | 19 catégories couvertes ✅ |
| 6 | Zéro collision cross-category | 0 normalized_term avec 2+ catégories ✅ |
| 7 | 9 nouvelles catégories créées | P01–P05, T06, T08, T10, T11 présents ✅ |
| 8 | Conflits exclus absents | `alcool industriel` = 0, `sport` = 0 ✅ |
| 9 | Lignes retirées absentes | `ACOOLISEES` = 0, `¨` (diaeresis) = 0 ✅ |
| 10 | `geomembranes` absent | 0 ✅ |
| 11 | Tests de résolution | `gasoil→T06` ✅, `crustaces nda→P01` ✅, `biscuits→T12` ✅ |

---

## Exclusions confirmées

- ❌ 0 conflit (`alcool industriel`, `sport`) injecté
- ❌ 0 ligne `operator_review_required` injectée
- ❌ 0 alias secondaire (41 suggestions) injecté
- ❌ 0 `geomembranes` injecté
- ❌ 0 alias existant modifié ou supprimé
- ❌ 0 modification runtime / frontend / edge function

---

## Source

- CSV source : `docs/tariff-collection/pad/PAD_2006_NOMENCLATURE_INJECTABLE_FINAL.csv`
- Préflight : `docs/tariff-collection/pad/PAD_NOM2_PREFLIGHT_REPORT.json`
- Migration SQL : `docs/tariff-collection/pad/PAD_NOM2_MIGRATION.sql`
- Lignes retirées : `docs/tariff-collection/pad/PAD_2006_OPERATOR_REVIEW_REQUIRED.csv`
