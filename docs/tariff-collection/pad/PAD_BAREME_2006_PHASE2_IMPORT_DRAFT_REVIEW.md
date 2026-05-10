# PAD-BAREME-2006-PHASE2-IMPORT-DRAFT — Revue ligne à ligne (2c)

> **Statut** : Audit / revue documentaire only.
> **Aucune écriture DB** ; uniquement `SELECT` read-only.
> **Aucune migration**, aucun INSERT/UPDATE/DELETE/DDL/RPC/Edge Function.
> **SQL draft non modifié.**

| Champ | Valeur |
|---|---|
| Date | 2026-05-10 |
| Lot | `PAD-BAREME-2006-DROIT-PASSAGE` |
| Fichier audité | `docs/tariff-collection/pad/PAD_BAREME_2006_PHASE2_IMPORT_DRAFT.sql` (561 lignes, version v2 verrouillée 2b) |
| CSV source | `PAD_BAREME_2006_DROIT_PASSAGE_FULL.csv` |
| SHA-256 CSV (recalculé) | `1c34c05fe596eb48831aa5bc53bf16008b4b6076f541fef27d93de7b0b396be0` |
| SHA-256 manifest (`expected_sha256`) | `1c34c05fe596eb48831aa5bc53bf16008b4b6076f541fef27d93de7b0b396be0` ✅ match |

---

## Verdict global

**`SQL_REVIEW_GO`**

Aucune erreur bloquante. Les 15 points CTO sont conformes. Le brouillon est prêt pour un GO 2d séparé (migration appliquée).

---

## Synthèse exécutive

- 120 lignes `INSERT` payload alignées strictement avec les 120 lignes `PRESENT` du CSV (clés et montants exacts).
- 4 lignes `BLANK_IN_PDF` correctement exclues.
- Cardinalités H2 (10 valeurs) identiques entre CSV, dict JSONB SQL et grille CTO.
- 19 montants legacy hardcodés `v_expected_legacy_amounts` strictement égaux à `port_tariffs` IMPORT/CONTENEUR (vérifié `SELECT` read-only).
- Transaction unique propre (`BEGIN; … COMMIT;`), `RAISE EXCEPTION` partout, aucun `EXCEPTION WHEN OTHERS`, aucun `ROLLBACK` manuel, aucun `ON CONFLICT`, aucun `COUNT()` invalide, aucun `COALESCE` en `WHERE`.
- Index unique partiel créé **avant** `INSERT` (ordre v2 §6 respecté).

---

## Section par section (15 points CTO)

### 1. Syntaxe PostgreSQL générale — ✅ OK
Lecture intégrale lignes 1–561. Pas d'incohérence syntaxique détectée. Constantes `CONSTANT TEXT/DATE/INT/JSONB`, casts `::numeric`, `::text`, `::int` corrects.

### 2. Validité DO block PL/pgSQL — ✅ OK
- Un seul `DO $$ … $$;` (l. 41 → l. 559).
- Bloc `DECLARE` complet (l. 42–96).
- `BEGIN` / `END $$;` cohérents.
- Aucun `EXCEPTION WHEN OTHERS` (vérifié `grep` : seules les mentions doctrinales en commentaires l. 21).

### 3. CREATE TEMP TABLE — ✅ OK
- `CREATE TEMP TABLE _pad2006_payload` (l. 189) avec `ON COMMIT DROP` implicite (déclaré dans la transaction unique).
- Scope strictement limité à la transaction `BEGIN;…COMMIT;`.
- Utilisé en lecture seule par P1..P6bis (l. 320–388), INSERT final (l. 423–432), H4 (l. 487–489), H4bis (l. 514–518).

### 4. CREATE UNIQUE INDEX dans transaction — ✅ OK
- Étape 2 (l. 391) : exécutée **après** désactivation R2 (l. 374) et **avant** INSERT 120 (l. 423).
- Définition partielle : `WHERE is_active = true`.
- Conforme à v2 §6.

### 5. Robustesse comparaison définition d'index — ✅ OK
- Bloc l. 50–60 : la définition canonique est construite par concat string et comparée à `pg_get_indexdef(indexrelid)` (l. 396–407).
- Si l'index existe déjà avec une définition divergente, abort via `RAISE EXCEPTION` (l. 405).
- Robuste aux différences de présentation : la chaîne canonique respecte le format normalisé `pg_get_indexdef`.

### 6. Absence de `ON CONFLICT` — ✅ OK
- `grep -i "ON CONFLICT"` → 1 occurrence **en commentaire doctrinal** (l. 420 : "pas de ON CONFLICT (l'index partiel doit échouer en cas de doublon)").
- Aucun `ON CONFLICT` exécuté.

### 7. Absence de rollback manuel — ✅ OK
- `grep -i "ROLLBACK"` → 2 occurrences **en commentaires** (l. 20–21).
- `grep -i "EXCEPTION WHEN OTHERS"` → 1 occurrence **en commentaire** (l. 21).
- Toutes les gardes utilisent `RAISE EXCEPTION` → rollback natif PostgreSQL.

### 8. Absence de `COUNT()` invalide — ✅ OK
- `grep -E "COUNT\(\)|count\(\)"` → **0 occurrence**.
- Tous les `COUNT(*)` sont valides.

### 9. Cohérence G0 à G4 — ✅ OK
| Garde | Ligne | Vérification | Statut |
|---|---|---|---|
| G0 | l. 99–115 | `count = c_expected_legacy (19)` sur legacy actif | OK |
| G1 | l. 117–145 | Boucle sur `v_expected_legacy_amounts` (19 montants) | OK |
| G2 | l. 147–158 | `count active dup composite key = 0` | OK |
| G3 | l. 160–172 | `count FK referencing port_tariffs.id = 0` (`pg_constraint`) | OK |
| G4 | l. 174–186 | `count quotation_versions.snapshot::text references = 0` | OK |

Cross-check `SELECT` read-only DB : 19 lignes legacy IMPORT/CONTENEUR, montants identiques à `v_expected_legacy_amounts`.

### 10. Cohérence P1 à P6bis (payload checks) — ✅ OK
| Check | Ligne | Vérification | Statut |
|---|---|---|---|
| P1 | l. 320–328 | `count(payload) = 120` | OK |
| P2 | l. 330–336 | aucun doublon `(op,cargo,classification)` | OK |
| P3 | l. 338–344 | `operation_type ∈ {…5 valeurs…}` | OK |
| P4 | l. 346–352 | `cargo_type ∈ {CONTENEUR,CONVENTIONNEL}` | OK |
| P5 | l. 353–358 | `amount IS NOT NULL AND amount ≥ 0` | OK |
| P6 | l. 360–370 | cardinalités par `(op,cargo)` strictement = grille | OK |
| P6bis | l. 371–373 | exactement 10 paires `(op,cargo)` distinctes | OK |

### 11. Cohérence H1 à H6 + H4bis — ✅ OK
| Check | Ligne | Filtres | Statut |
|---|---|---|---|
| H1 | l. 444–455 | `provider`+`category`+`source_doc`+`is_active=true`+`effective_date` → 120 | OK (renforcé 2b) |
| H2 | l. 457–470 | cardinalités par `(op,cargo)` post-état | OK |
| H3 | l. 472–483 | `provider`+`category`+`source_doc`+`is_active=false` → 19 | OK (renforcé 2b) |
| H4 | l. 485–498 | sum amount IMPORT/CONTENEUR DB == sum payload | OK |
| H4bis | l. 500–530 | FULL OUTER JOIN USING(classification) ligne par ligne IMPORT/CONTENEUR (sous-requêtes pré-filtrées, sans COALESCE en WHERE) | OK (forme CTO 2b) |
| H5 | l. 532–547 | 0 doublon actif sur clé composite (post-état) | OK |
| H6 | l. 549–558 | index unique partiel présent + définition match | OK |

### 12. 120 VALUES = CSV PRESENT uniquement — ✅ OK

Recomptage Python read-only :

```
SQL VALUES tuples : 120
CSV PRESENT       : 120
CSV-SQL diff      : ∅
SQL-CSV diff      : ∅
Amount diffs      : ∅
```

Match strict 1-pour-1 (clé `(op, cargo, classification)` + `amount`).

### 13. 4 BLANK_IN_PDF absents de l'INSERT — ✅ OK

Liste BLANK CSV :
- `page 7 / EXPORT / CONVENTIONNEL / T13`
- `page 8 / TRANSBORDEMENT / CONVENTIONNEL / T10`
- `page 8 / TRANSIT_IMPORT / CONVENTIONNEL / T10`
- `page 8 / TRANSIT_EXPORT / CONVENTIONNEL / T10`

Intersection `BLANK_keys ∩ SQL_keys = ∅`. Aucune ligne BLANK insérée.

### 14. Cardinalités H2 exactes (10 valeurs) — ✅ OK

| Paire | CSV | SQL VALUES | JSONB H2 SQL | Statut |
|---|---|---|---|---|
| IMPORT/CONTENEUR | 19 | 19 | 19 | OK |
| IMPORT/CONVENTIONNEL | 19 | 19 | 19 | OK |
| EXPORT/CONTENEUR | 19 | 19 | 19 | OK |
| EXPORT/CONVENTIONNEL | 18 | 18 | 18 | OK |
| TRANSBORDEMENT/CONTENEUR | 3 | 3 | 3 | OK |
| TRANSBORDEMENT/CONVENTIONNEL | 12 | 12 | 12 | OK |
| TRANSIT_IMPORT/CONTENEUR | 3 | 3 | 3 | OK |
| TRANSIT_IMPORT/CONVENTIONNEL | 12 | 12 | 12 | OK |
| TRANSIT_EXPORT/CONTENEUR | 3 | 3 | 3 | OK |
| TRANSIT_EXPORT/CONVENTIONNEL | 12 | 12 | 12 | OK |
| **TOTAL** | **120** | **120** | **120** | OK |

### 15. Risques bloquants avant exécution future — ✅ Aucun

Aucun risque bloquant identifié.

---

## Erreurs bloquantes

**Aucune.**

---

## Points à corriger (non bloquants pour la revue)

**Aucun.** Le draft v2 verrouillé en 2b est complet.

---

## Risques non bloquants

1. **Recomptage SHA hors SQL (déjà documenté)** — l'en-tête (l. 14–16) précise que le SHA CSV est contrôlé hors SQL par `validate_pad_csv.py` et le manifest. Aucune action requise pour 2d ; le validator doit être ré-exécuté **immédiatement avant** la migration.
2. **Re-vérification G3/G4 juste avant exécution** — `pg_constraint` et `quotation_versions.snapshot` sont déjà couverts par G3/G4 dans la transaction. Pas d'action préalable nécessaire ; les gardes elles-mêmes lèveront `RAISE EXCEPTION` si l'état évolue entre 2c et 2d.
3. **Lookup runtime futur sans filtre `cargo_type`** — risque connu, déjà tracé pour le lot `PAD-BAREME-2006-RUNTIME-EXPAND`.

---

## Recommandations CTO

1. **Valider 2d** sur la base de ce verdict `SQL_REVIEW_GO`.
2. **Ré-exécuter `validate_pad_csv.py`** juste avant 2d, pour garantir 24 PASS / 0 FAIL et SHA inchangé.
3. **Exécuter la migration 2d via `supabase--migration`** en collant le contenu intégral du DO block (sans BEGIN/COMMIT externes — Supabase migration runner gère sa propre transaction). Vérifier ce point précis avant exécution : si le runner ouvre déjà une transaction, retirer le `BEGIN;` / `COMMIT;` du draft pour éviter le `BEGIN` imbriqué (PostgreSQL `WARNING: there is already a transaction in progress`).
4. **Capturer un snapshot DB read-only** avant 2d (`pg_dump --table=public.port_tariffs --data-only`, hors scope agent — opération CTO).
5. **Après 2d**, produire `PAD_BAREME_2006_PHASE2_IMPORT_REPORT.md` (post-checks H1..H6 + H4bis effectifs).

---

## Annexes

### A. Sortie des grep de contrôle

```
grep -nE "COUNT\(\)|count\(\)"           → 0 occurrence
grep -niE "ON CONFLICT"                  → 1 (l.420, commentaire doctrinal)
grep -niE "EXCEPTION WHEN OTHERS"        → 1 (l.21, commentaire doctrinal)
grep -niE "\bROLLBACK\b"                 → 2 (l.20, l.21, commentaires)
grep -niE "WHERE.*COALESCE|^\s*AND\s+COALESCE" → 0 occurrence
BEGIN; (l.39)  /  COMMIT; (l.561)        → transaction unique
DO $$ (l.41)                             → 1 seul bloc PL/pgSQL
CREATE TEMP TABLE _pad2006_payload (l.189)
CREATE UNIQUE INDEX (l.411, dynamique)   → après désactivation, avant INSERT
INSERT INTO public.port_tariffs (l.423)
```

### B. Recomptage CSV (Python read-only)

```
CSV total=124 PRESENT=120 BLANK_IN_PDF=4
SHA-256 CSV recalculé == manifest.expected_sha256 ✅
```

### C. Cross-check 4 BLANK_IN_PDF

```
BLANK_keys ∩ SQL_keys = ∅
```

### D. Cross-check 19 valeurs G1 (DB SELECT read-only)

```sql
SELECT classification, amount::numeric
FROM public.port_tariffs
WHERE provider='PAD' AND category='DROIT_PASSAGE'
  AND operation_type='IMPORT' AND cargo_type='CONTENEUR'
  AND is_active=true
ORDER BY classification;
```

| Classification | DB | `v_expected_legacy_amounts` | CSV PRESENT | Statut |
|---|---|---|---|---|
| T01 | 19239 | 19239 | 19239 | OK |
| T02 | 9678 | 9678 | 9678 | OK |
| T03 | 1416 | 1416 | 1416 | OK |
| T04 | 3069 | 3069 | 3069 | OK |
| T05 | 1180 | 1180 | 1180 | OK |
| T06 | 885 | 885 | 885 | OK |
| T07 | 484 | 484 | 484 | OK |
| T08 | 1062 | 1062 | 1062 | OK |
| T09 | 4367 | 4367 | 4367 | OK |
| T10 | 0 | 0 | 0 | OK |
| T11 | 1770 | 1770 | 1770 | OK |
| T12 | 4780 | 4780 | 4780 | OK |
| T13 | 11803 | 11803 | 11803 | OK |
| T14 | 4072 | 4072 | 4072 | OK |
| P01 | 28100 | 28100 | 28100 | OK |
| P02 | 2325 | 2325 | 2325 | OK |
| P03 | 13000 | 13000 | 13000 | OK |
| P04 | 1850 | 1850 | 1850 | OK |
| P05 | 3350 | 3350 | 3350 | OK |

Match strict 19/19.

---

## Rappel gouvernance

Ce verdict `SQL_REVIEW_GO` ne vaut **pas** :
- GO 2d (migration appliquée)
- GO import DB
- GO patch runtime
- GO edge function

Toute exécution future requiert un GO CTO **séparé** par étape (2d, 2f).
