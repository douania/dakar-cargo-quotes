# PAD Barème 2006 — Phase 2 Import — Rapport final d'exécution

**Date d'exécution :** 2026-05-10
**Source SQL :** `docs/tariff-collection/pad/PAD_BAREME_2006_PHASE2_IMPORT_DRAFT.sql` (v2, revue 2c — `SQL_REVIEW_GO`)
**Périmètre :** application unique de la migration PAD Phase 2.

---

## Verdict

**`PHASE2_IMPORT_APPLIED`**

Migration appliquée avec succès. Toutes les gardes G0..G4, tous les checks payload P1..P6bis, et tous les post-checks H1..H6 + H4bis ont **passé** dans une transaction unique. Aucune `RAISE EXCEPTION` déclenchée.

---

## Environnement ciblé

| Élément | Valeur |
|---|---|
| Projet Supabase (Lovable Cloud) | `snjewofqxfsdmaszapux` |
| URL | `https://snjewofqxfsdmaszapux.supabase.co` |
| Base | `postgres` (managed Lovable Cloud) |
| Contexte Lovable | sandbox unique du projet `c3b5e3c2-511e-4e1e-b88d-a47fe5ff5aef` (pas de séparation staging/production sur ce projet) |
| Confirmation | environnement prévu — projet Lovable Cloud unique attaché à ce workspace |

---

## Pré-checks (avant exécution)

| # | Pré-check | Résultat |
|---|---|---|
| 1 | `python docs/tariff-collection/pad/validate_pad_csv.py` | `VERDICT: GO` — `PASS=24 FAIL=0 WARN=0`, exit 0 |
| 2 | SHA-256 CSV vs manifest vs SQL draft | `1c34c05fe596eb48831aa5bc53bf16008b4b6076f541fef27d93de7b0b396be0` — identique aux 3 sources |
| 3 | SQL draft = v2 revue 2c | confirmé : H4bis présent (l. 495, 523, 2 sous-requêtes pré-filtrées + FULL OUTER JOIN), 0 `COALESCE` en `WHERE`, 0 `COUNT()`, gardes H1/H3 renforcées avec `provider`/`category` |
| 4 | Comportement runner Supabase | runner Supabase ouvre sa propre transaction → `BEGIN;`/`COMMIT;` retirés de la string transmise (uniquement). Le draft sur disque **n'a pas été modifié**. Rollback natif assuré par `RAISE EXCEPTION` dans le `DO` block. |

---

## Adaptation pour le runner

Le brouillon contient un `BEGIN;` ligne 39 et `COMMIT;` ligne 561. Comme `supabase--migration` enveloppe déjà l'appel dans sa propre transaction, ces deux lignes ont été **retirées de la chaîne SQL passée au runner** (lignes 41–559 conservées : `DO $$ ... END; $$ LANGUAGE plpgsql;`). Le fichier `PAD_BAREME_2006_PHASE2_IMPORT_DRAFT.sql` reste **strictement intact** sur disque.

---

## Sortie d'exécution

Migration runner : **completed successfully** (1 transaction, aucune `RAISE EXCEPTION`).

Notice attendue émise par le bloc `DO` (non capturée par le runner mais déductible du succès et des post-checks read-only) :

> `PAD-BAREME-2006-PHASE2-IMPORT-DRAFT: all gates and post-checks PASS (120 inserted, 19 deactivated)`

Aucune erreur SQL. Aucune garde en échec. Aucun rollback.

---

## Statut des gardes G0..G4

| Garde | Vérification | Statut |
|---|---|---|
| **G0** | 19 lignes legacy actives IMPORT/CONTENEUR | PASS |
| **G1** | Montants legacy strictement = `v_expected_legacy_amounts` (19 valeurs) | PASS |
| **G2** | 0 doublon actif sur clé composite (pré-état) | PASS |
| **G3** | 0 FK référençant `port_tariffs.id` | PASS |
| **G4** | `quotation_versions` présente, 0 référence textuelle aux IDs legacy | PASS |

## Statut des checks payload P1..P6bis

| Check | Vérification | Statut |
|---|---|---|
| **P1** | Payload count = 120 | PASS |
| **P2** | 0 doublon dans payload sur `(op, cargo, class)` | PASS |
| **P3** | `operation_type` ∈ {IMPORT, EXPORT, TRANSBORDEMENT, TRANSIT_IMPORT, TRANSIT_EXPORT} | PASS |
| **P4** | `cargo_type` ∈ {CONTENEUR, CONVENTIONNEL} | PASS |
| **P5** | `amount` non-NULL et ≥ 0 | PASS |
| **P6** | Cardinalités payload par `(op,cargo)` = grille v2 | PASS |
| **P6bis** | 10 paires `(op,cargo)` distinctes présentes | PASS |

---

## Comptes appliqués

| Étape | Cible | Effectif | Conforme |
|---|---|---|---|
| Étape 1 — Désactivation legacy R2 (`UPDATE is_active=false`) | 19 | 19 | OUI |
| Étape 2 — `CREATE UNIQUE INDEX port_tariffs_active_unique_key` | présent et valide | présent et valide | OUI |
| Étape 3 — `INSERT` payload 120 lignes PRESENT | 120 | 120 | OUI |

Définition d'index appliquée (vérifiée read-only post-migration) :

```
CREATE UNIQUE INDEX port_tariffs_active_unique_key ON public.port_tariffs
USING btree (provider, category, operation_type, classification, cargo_type)
WHERE (is_active = true)
```

---

## Post-checks H1..H6 + H4bis

| Post-check | Vérification | Résultat read-only |
|---|---|---|
| **H1** | 120 lignes actives `provider=PAD ∧ category=DROIT_PASSAGE ∧ source=pdf_redevances_portuaires_2006 ∧ effective_date=2006-01-01` | **120** — PASS |
| **H2** | Cardinalités exactes par `(operation_type, cargo_type)` | 10 paires conformes (voir tableau ci-dessous) — PASS |
| **H3** | 19 lignes inactives legacy `provider=PAD ∧ category=DROIT_PASSAGE ∧ source=pdf_redevances_portuaires_2006 ∧ is_active=false` | **19** — PASS |
| **H4** | `SUM(amount)` IMPORT/CONTENEUR actif DB = `SUM(amount)` payload équivalent | identiques (PASS dans `DO` block, sinon `RAISE EXCEPTION`) |
| **H4bis** | Comparaison ligne à ligne IMPORT/CONTENEUR (FULL OUTER JOIN sur classification, deux sous-requêtes pré-filtrées) | aucune divergence — PASS |
| **H5** | 0 doublon actif sur clé composite (post-état) | **0** — PASS |
| **H6** | Index unique partiel présent ET définition strictement = `c_expected_index_def` | définition exacte confirmée — PASS |

---

## Cardinalités finales par `(operation_type, cargo_type)`

| operation_type | cargo_type | n | attendu |
|---|---|---|---|
| EXPORT | CONTENEUR | 19 | 19 |
| EXPORT | CONVENTIONNEL | 18 | 18 |
| IMPORT | CONTENEUR | 19 | 19 |
| IMPORT | CONVENTIONNEL | 19 | 19 |
| TRANSBORDEMENT | CONTENEUR | 3 | 3 |
| TRANSBORDEMENT | CONVENTIONNEL | 12 | 12 |
| TRANSIT_EXPORT | CONTENEUR | 3 | 3 |
| TRANSIT_EXPORT | CONVENTIONNEL | 12 | 12 |
| TRANSIT_IMPORT | CONTENEUR | 3 | 3 |
| TRANSIT_IMPORT | CONVENTIONNEL | 12 | 12 |
| **TOTAL** | | **120** | **120** |

---

## Confirmation BLANK_IN_PDF

Les 4 cellules `BLANK_IN_PDF` du PDF source ont été **exclues du payload** (jamais insérées). Vérification read-only : aucune ligne `pdf_redevances_portuaires_2006` active n'a `amount IS NULL`. **0 BLANK_IN_PDF présent** en DB.

---

## Confirmation runtime IMPORT / CONTENEUR

| Vérification | Valeur |
|---|---|
| `IMPORT/CONTENEUR` actif (lignes Phase 2) | **19** |
| `T10` `IMPORT/CONTENEUR` actif — `amount` | **0** (cellule officielle PDF page 7 = 0, conforme CSV PRESENT, conforme attente CTO « T10 IMPORT/CONTENEUR = 0 ») |

---

## Périmètre — fichiers

| Fichier | Action |
|---|---|
| `docs/tariff-collection/pad/PAD_BAREME_2006_PHASE2_IMPORT_REPORT.md` | **créé** (ce rapport) |
| `docs/tariff-collection/pad/PAD_BAREME_2006_PHASE2_IMPORT_DRAFT.sql` | **non modifié** |
| `docs/tariff-collection/pad/PAD_BAREME_2006_DROIT_PASSAGE_FULL.csv` | **non modifié** |
| `docs/tariff-collection/pad/PAD_BAREME_2006_MANIFEST.json` | **non modifié** |
| `docs/tariff-collection/pad/validate_pad_csv.py` | **non modifié** |
| `supabase/functions/run-pricing/*` | **non modifié** |
| `supabase/functions/recommend-pad-category/*` | **non modifié** |
| `supabase/functions/quotation-engine/*` | **non modifié** |
| `src/**` | **non modifié** |
| Edge functions (création) | **aucune** |

---

## Hors périmètre rappelé

Ce GO 2d **ne vaut pas** :
- GO runtime expand (consommation des 120 lignes par les flux non-IMPORT/CONTENEUR) ;
- GO edge function (modification ou création) ;
- GO modification `quotation-engine`.

Toute exploitation runtime des 101 nouvelles lignes (EXPORT, TRANSBORDEMENT, TRANSIT_*, IMPORT/CONVENTIONNEL) nécessite un GO séparé.

---

## Note sécurité

Le runner Supabase a remonté 96 warnings linter (RLS permissive sur diverses tables, fonctions sans `search_path`, etc.). Ces warnings sont **pré-existants** et **sans rapport** avec cette migration : Phase 2 n'a touché aucune RLS policy, aucune fonction, aucune table autre que `port_tariffs` (rows uniquement, pas de DDL sur la table). Hors périmètre 2d.
