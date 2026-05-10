# PAD Barème 2006 — Phase 2 — Smoke test fonctionnel léger

**Date :** 2026-05-10
**Périmètre :** lecture seule. Aucun runtime modifié, aucune écriture DB, aucune migration.
**Pattern reproduit :** `supabase/functions/run-pricing/index.ts:1981-1990 / 2004-2013` et `supabase/functions/recommend-pad-category/index.ts:78-82`.

---

## Verdict

**`PAD_PHASE2_SMOKE_OK`**

Les 19 classifications PAD `IMPORT / CONTENEUR` sont servies par exactement 1 ligne active issue du lot Phase 2, avec montant strictement conforme aux 19 valeurs legacy pré-migration.

---

## Test 1 — Couverture déterministe DB-level (19 classifications)

Requête exécutée (read-only) reproduisant le filtre exact de `run-pricing` + `recommend-pad-category`, enrichie par `source_document`, `effective_date`, `is_active` (ajout CTO).

| classification | expected | served | unit | source_document | effective_date | is_active | match_ok |
|---|---:|---:|---|---|---|---|:---:|
| P01 | 28100 | 28100 | PER_TONNE | pdf_redevances_portuaires_2006 | 2006-01-01 | true | OK |
| P02 | 2325 | 2325 | PER_TONNE | pdf_redevances_portuaires_2006 | 2006-01-01 | true | OK |
| P03 | 13000 | 13000 | PER_TONNE | pdf_redevances_portuaires_2006 | 2006-01-01 | true | OK |
| P04 | 1850 | 1850 | PER_TONNE | pdf_redevances_portuaires_2006 | 2006-01-01 | true | OK |
| P05 | 3350 | 3350 | PER_TONNE | pdf_redevances_portuaires_2006 | 2006-01-01 | true | OK |
| T01 | 19239 | 19239 | PER_TONNE | pdf_redevances_portuaires_2006 | 2006-01-01 | true | OK |
| T02 | 9678 | 9678 | PER_TONNE | pdf_redevances_portuaires_2006 | 2006-01-01 | true | OK |
| T03 | 1416 | 1416 | PER_TONNE | pdf_redevances_portuaires_2006 | 2006-01-01 | true | OK |
| T04 | 3069 | 3069 | PER_TONNE | pdf_redevances_portuaires_2006 | 2006-01-01 | true | OK |
| T05 | 1180 | 1180 | PER_TONNE | pdf_redevances_portuaires_2006 | 2006-01-01 | true | OK |
| T06 | 885 | 885 | PER_TONNE | pdf_redevances_portuaires_2006 | 2006-01-01 | true | OK |
| T07 | 484 | 484 | PER_TONNE | pdf_redevances_portuaires_2006 | 2006-01-01 | true | OK |
| T08 | 1062 | 1062 | PER_TONNE | pdf_redevances_portuaires_2006 | 2006-01-01 | true | OK |
| T09 | 4367 | 4367 | PER_TONNE | pdf_redevances_portuaires_2006 | 2006-01-01 | true | OK |
| T10 | 0 | 0 | PER_TONNE | pdf_redevances_portuaires_2006 | 2006-01-01 | true | OK |
| T11 | 1770 | 1770 | PER_TONNE | pdf_redevances_portuaires_2006 | 2006-01-01 | true | OK |
| T12 | 4780 | 4780 | PER_TONNE | pdf_redevances_portuaires_2006 | 2006-01-01 | true | OK |
| T13 | 11803 | 11803 | PER_TONNE | pdf_redevances_portuaires_2006 | 2006-01-01 | true | OK |
| T14 | 4072 | 4072 | PER_TONNE | pdf_redevances_portuaires_2006 | 2006-01-01 | true | OK |

**Résultat : 19/19 match_ok = true.** Provenance Phase 2 confirmée pour chaque ligne (source_document + effective_date + is_active conformes).

---

## Test 2 — Unicité runtime (`.maybeSingle()` safe)

Requête : `GROUP BY classification HAVING COUNT(*) > 1` sur le filtre exact runtime (`provider=PAD ∧ category=DROIT_PASSAGE ∧ operation_type=IMPORT ∧ cargo_type=CONTENEUR ∧ is_active=true`).

**Résultat : 0 ligne** — aucune classification servie par plusieurs lignes actives. `.maybeSingle()` runtime sûr.

---

## Test 3 — Replay snapshot historique (optionnel, non bloquant)

Dossier candidat trouvé via `quotation_versions` :

| case_id | version | classification | quantité (t) | tarif servi (DB) | snapshot amount | calcul attendu | match |
|---|---|---|---:|---:|---:|---:|:---:|
| `29b96eec-2b85-489f-937e-0da8190c9787` | v1 | T12 (PAD_DROIT_PASSAGE) | 840 | 4 780 FCFA/t | 4 015 200 FCFA | 840 × 4 780 = **4 015 200** | OK |

Le snapshot historique pré-migration utilise exactement le même tarif T12 (4 780 FCFA/t) que celui actuellement servi par `port_tariffs` post-migration. Ré-évaluation arithmétique conforme au snapshot. Aucun appel à `run-pricing`.

---

## Conclusion

| Test | Statut |
|---|---|
| Test 1 — 19 classifications, montants + provenance | **OK** |
| Test 2 — Unicité runtime | **OK** |
| Test 3 — Replay snapshot T12 | **OK** |

**Verdict global : `PAD_PHASE2_SMOKE_OK`**

Le runtime `run-pricing` / `recommend-pad-category` continue de résoudre les tarifs PAD `IMPORT / CONTENEUR` à l'identique d'avant la migration Phase 2. Le chantier PAD Phase 2 est totalement clos côté data + runtime actuel.

---

## Périmètre — fichiers

| Fichier | Action |
|---|---|
| `docs/tariff-collection/pad/PAD_BAREME_2006_PHASE2_SMOKE_TEST.md` | **créé** (ce rapport) |
| Tout autre fichier (`src/`, `supabase/functions/`, migrations, CSV, manifest, validator, draft) | **non modifié** |
| Base de données | **aucune écriture** (3 `SELECT` read-only uniquement) |

## Hors périmètre rappelé

Aucun GO `RUNTIME-EXPAND`. Aucune modification de `run-pricing`, `recommend-pad-category`, `quotation-engine`. Toute exploitation runtime des 101 nouvelles lignes EXPORT / TRANSBORDEMENT / TRANSIT_* / IMPORT-CONVENTIONNEL nécessite un GO séparé sur un nouveau chantier.
