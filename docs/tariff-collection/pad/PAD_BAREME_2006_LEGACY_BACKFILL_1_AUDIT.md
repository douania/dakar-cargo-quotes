# PAD-BAREME-2006-LEGACY-BACKFILL-1 — Rapport d'audit (Étape 1 read-only)

**Date** : 2026-05-10  
**Périmètre** : qualification des 19 lignes legacy `port_tariffs` (PAD / DROIT_PASSAGE / IMPORT / `cargo_type IS NULL`) en `cargo_type='CONTENEUR'`.  
**Mode** : read-only strict — aucune écriture DB, aucun patch runtime, aucun import des 124 lignes.

## Source CSV
- Fichier canonique : `docs/tariff-collection/pad/PAD_BAREME_2006_DROIT_PASSAGE_FULL.csv`
- SHA-256 (upload utilisateur) : `1c34c05fe596eb48831aa5bc53bf16008b4b6076f541fef27d93de7b0b396be0`
- SHA-256 (copie repo) : `1c34c05fe596eb48831aa5bc53bf16008b4b6076f541fef27d93de7b0b396be0`
- ✅ **Hash identiques** — copie 1:1 confirmée.
- Lignes : 124 data + 1 header (125 total).

## Pré-check DB
| Contrôle | Attendu | Observé | Statut |
|---|---|---|---|
| Lignes actives `cargo_type='CONTENEUR'` (PAD/DROIT_PASSAGE/IMPORT) | 0 | **0** | ✅ |
| Lignes actives `cargo_type IS NULL` (PAD/DROIT_PASSAGE/IMPORT) | 19 | **19** | ✅ |

## Filtrage CSV
Critères stricts (Python `csv.DictReader`, normalisation `source_page` en string, montants en `Decimal`) :
- `source_page == '7'`
- `operation_type == 'IMPORT'`
- `cargo_type == 'CONTENEUR'`
- `cell_status == 'PRESENT'`

**Résultat : 19 lignes CSV.**

## Tableau comparatif strict

| classification | legacy_amount | csv_amount | unit_csv | statut |
|---|---:|---:|---|---|
| P01 | 28100 | 28100 | PER_TONNE | MATCH |
| P02 | 2325 | 2325 | PER_TONNE | MATCH |
| P03 | 13000 | 13000 | PER_TONNE | MATCH |
| P04 | 1850 | 1850 | PER_TONNE | MATCH |
| P05 | 3350 | 3350 | PER_TONNE | MATCH |
| T01 | 19239 | 19239 | PER_TONNE | MATCH |
| T02 | 9678 | 9678 | PER_TONNE | MATCH |
| T03 | 1416 | 1416 | PER_TONNE | MATCH |
| T04 | 3069 | 3069 | PER_TONNE | MATCH |
| T05 | 1180 | 1180 | PER_TONNE | MATCH |
| T06 | 885 | 885 | PER_TONNE | MATCH |
| T07 | 484 | 484 | PER_TONNE | MATCH |
| T08 | 1062 | 1062 | PER_TONNE | MATCH |
| T09 | 4367 | 4367 | PER_TONNE | MATCH |
| T10 | 0 | 0 | PER_TONNE | MATCH |
| T11 | 1770 | 1770 | PER_TONNE | MATCH |
| T12 | 4780 | 4780 | PER_TONNE | MATCH |
| T13 | 11803 | 11803 | PER_TONNE | MATCH |
| T14 | 4072 | 4072 | PER_TONNE | MATCH |

**Total mismatches : 0**  
**Orphelins DB : 0** | **Orphelins CSV : 0**  
**Set classifications** : `{T01..T14, P01..P05}` strictement identique des deux côtés.  
**Unités** : toutes `PER_TONNE` des deux côtés.  
**Comparaisons numériques** : effectuées en `Decimal` (jamais `float`).

## Conditions cumulatives BACKFILL GO

| # | Condition | Statut |
|---|---|---|
| 1 | Pré-check `cargo_type='CONTENEUR'` actif = 0 | ✅ |
| 2 | 19 lignes legacy trouvées | ✅ |
| 3 | 19 lignes CSV correspondantes | ✅ |
| 4 | Set classifications identique `{T01..T14, P01..P05}` | ✅ |
| 5 | Montants strictement identiques (Decimal) | ✅ |
| 6 | Unités strictement identiques (PER_TONNE) | ✅ |
| 7 | Aucun orphelin DB ni CSV | ✅ |

## Verdict

# ✅ BACKFILL GO

Les 19 lignes legacy `cargo_type IS NULL` correspondent **strictement** aux 19 lignes officielles CSV Page 7 / IMPORT / CONTENEUR / PRESENT. Le backfill `cargo_type='CONTENEUR'` est sémantiquement justifié et mathématiquement neutre (aucun changement de montant).

## Suite

Brouillon SQL renforcé livré dans :
`docs/tariff-collection/pad/PAD_BAREME_2006_LEGACY_BACKFILL_1_MIGRATION_DRAFT.sql`

**Non appliqué.** Application conditionnée à un GO CTO explicite séparé.

## Interdictions maintenues
- ❌ Aucune migration appliquée.
- ❌ Aucun patch runtime (`run-pricing`, `recommend-pad-category`, `quotation-engine`).
- ❌ Aucun import des 124 lignes CSV.
- ❌ Aucune modification du CSV.
- ❌ Aucun `src/`.

Ce GO **ne vaut pas** GO migration, **ni** GO patch runtime, **ni** GO import CSV 124 lignes.
