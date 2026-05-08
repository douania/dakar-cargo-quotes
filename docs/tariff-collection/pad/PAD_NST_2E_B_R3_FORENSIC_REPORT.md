# PAD-NST-2E-B-R3 — Rapport forensic et rerun correctif R2

**Date** : 2026-05-08
**Phase** : PAD-NST-2E-B-R3 — Rerun correctif R2 avec preuve forensic
**Statut pré-rerun** : ⚠️ DB active divergente des artefacts versionnés R2
**GO CTO** : ✅ accordé (option C — forensic minimale + rerun)

---

## 1. Contexte

La phase précédente **PAD-NST-2E-B-R2** était documentée comme `✅ CLOS` dans `DEFERRED_BACKLOG.md`. La réconciliation read-only **PAD-NST-R2-DB-RECON** a démontré que ce statut était **factuellement incorrect** : le SQL versionné `pad_nst_2e_b_r2_corrective.sql` n'a jamais été appliqué end-to-end à la base.

Preuve : ce SQL est un `DO $$ ... END $$` transactionnel qui purge la table puis réinsère 88 règles, avec contrôles `EXCEPT` symétriques (EQ1/EQ2) qui lèveraient une exception (et roll-back) en cas d'écart. Si la migration avait réussi, l'égalité stricte serait garantie.

Or la DB contient 88 règles actives, mais avec divergences systémiques.

---

## 2. Constats pré-rerun (read-only)

### 2.1 Counts

| Métrique | Valeur | Attendu |
|----------|--------|---------|
| `expected_rules` (filtres CSV stricts) | **88** | 88 ✅ |
| DB active (`is_active = true`) | **88** | 88 ✅ |
| Égalité exacte expected ↔ DB | **❌ NON** | OUI |

### 2.2 Diff complet

#### 9 EXTRA_IN_DB (règles présentes interdites)

| rule_key | Tracé candidates | Tier audit | Action audit | Verdict |
|----------|------------------|-----------|--------------|---------|
| `group\|01.6\|T02` | ✅ | TIER-C | **defer** | À retirer |
| `group\|14.1\|T08` | ✅ | TIER-C | **defer** | À retirer |
| `group\|01.A\|T06` | ❌ | — | — | Fantôme — non sourcé |
| `group\|04.4\|T06` | ❌ | — | — | Fantôme — non sourcé |
| `group\|08.1\|T10` | ❌ | — | — | Fantôme — non sourcé |
| `group\|10.4\|T14` | ❌ | — | — | Fantôme — non sourcé |
| `group\|11.5\|T09` | ❌ | — | — | Fantôme — non sourcé |
| `group\|11.6\|T09` | ❌ | — | — | Fantôme — non sourcé |
| `group\|15.1\|T02` | ❌ | — | — | Fantôme + orphelin `nst_groups` |

→ 2 TIER-C déférées + 7 fantômes hors-source.

#### 9 MISSING_IN_DB (règles attendues absentes)

| rule_key | conf attendue | evidence | Tier | Action |
|----------|--------------|----------|------|--------|
| `group\|08.1\|T03` | 0.80 | expert_rule | **TIER-A** | keep_as_is |
| `group\|09.2\|T05` | 0.85 | expert_rule | **TIER-A** | enrich_notes |
| `group\|10.4\|T12` | 0.75 | expert_rule | **TIER-A** | keep_as_is |
| `group\|11.5\|T01` | 0.80 | expert_rule | **TIER-A** | keep_as_is |
| `group\|11.6\|T01` | 0.85 | expert_rule | **TIER-A** | keep_as_is |
| `group\|03.3\|T08` | 0.60 | expert_rule | TIER-B | enrich_notes |
| `group\|04.4\|T02` | 0.55 | expert_rule | TIER-B | keep_as_is |
| `group\|09.3\|T12` | 0.60 | expert_rule | TIER-B | keep_as_is |
| `group\|13.2\|T12` | 0.60 | expert_rule | TIER-B | keep_as_is |

→ 5 règles **TIER-A** absentes.

#### Pattern : substitutions `pad_category` sur 5 codes

| nst_code | DB (extra) | Expected (missing) |
|----------|------------|--------------------|
| `04.4` | T06 ❌ | **T02** ✅ |
| `08.1` | T10 ❌ | **T03** ✅ TIER-A |
| `10.4` | T14 ❌ | **T12** ✅ TIER-A |
| `11.5` | T09 ❌ | **T01** ✅ TIER-A |
| `11.6` | T09 ❌ | **T01** ✅ TIER-A |

Signature d'écrasement par draft pré-audit.

#### 16 confidence_mismatch

```
group|01.4|T02   db=0.55  exp=0.50
group|03.2|T03   db=0.70  exp=0.60
group|03.4|T10   db=0.85  exp=0.80
group|04.1|T02   db=0.60  exp=0.55
group|04.3|T02   db=0.60  exp=0.55
group|05.1|T12   db=0.70  exp=0.60
group|06.2|T04   db=0.80  exp=0.75
group|08.5|T01   db=0.70  exp=0.60
group|09.1|T12   db=0.65  exp=0.60
group|10.3|T12   db=0.70  exp=0.75
group|10.5|T12   db=0.65  exp=0.60
group|11.1|T09   db=0.70  exp=0.80
group|11.3|T01   db=0.80  exp=0.85
group|11.4|T01   db=0.80  exp=0.60
group|11.8|T09   db=0.60  exp=0.55
group|14.2|T08   db=0.65  exp=0.60
```

Les `adjusted_confidence` issues de l'audit R1 n'ont pas été appliquées.

#### 5 evidence_level_mismatch

| rule_key | DB | Expected |
|----------|-----|----------|
| `group\|07.2\|T11` | expert_rule | nstr_bridge_inferred |
| `group\|10.1\|T14` | expert_rule | nstr_bridge_inferred |
| `group\|11.8\|T09` | nstr_bridge_inferred | expert_rule |
| `group\|12.1\|T09` | expert_rule | nstr_bridge_inferred |
| `group\|14.2\|T08` | expert_rule | nstr_bridge_inferred |

#### Statut & flags

- `validation_status_mismatch` (≠ candidate) = **0** ✅
- `requires_operator_validation_mismatch` (≠ true) = **0** ✅

#### Orphelins référentiel

- division-level vs `nst_divisions` : **0** ✅
- group-level vs `nst_groups` : **1** = `15.1`

---

## 3. Backup forensic pré-rerun

| Fichier | Lignes | Format |
|---------|--------|--------|
| `docs/tariff-collection/pad/rules/PAD_NST_2E_B_R3_PRE_RERUN_BACKUP.csv` | 88 + header | CSV (id, nst_level, nst_code, pad_category, confidence, evidence_level, validation_status, requires_operator_validation, is_active, notes, source_document, source_reference, created_at, updated_at) |

Vérifications :

- ✅ 89 lignes (88 lignes + 1 header)
- ✅ `group,15.1,T02` présent
- ✅ Les 9 extras présents :
  - `group,01.6,T02`
  - `group,01.A,T06`
  - `group,04.4,T06`
  - `group,08.1,T10`
  - `group,10.4,T14`
  - `group,11.5,T09`
  - `group,11.6,T09`
  - `group,14.1,T08`
  - `group,15.1,T02`

---

## 4. Migration R3 — rerun exact du SQL versionné

### 4.1 Source

| Élément | Valeur |
|---------|--------|
| Fichier source | `docs/tariff-collection/pad/rules/pad_nst_2e_b_r2_corrective.sql` |
| SHA-256 source | `fe9fab1d35ec2423196c60c47bd92e1c6b281d9df87cb2f72e522e664ffd9e50` |
| Lignes source | 1212 |
| Octets source | 74828 |

### 4.2 Garde-fous appliqués

- ✅ Aucune modification du fichier source `pad_nst_2e_b_r2_corrective.sql`
- ✅ Migration R3 = **copie conforme** du body SQL source (DO $$ ... END $$)
- ✅ Aucun INSERT modifié
- ✅ Aucun confidence/evidence_level/notes modifié
- ✅ Aucune compaction, réindentation ou reformatage du SQL
- ✅ Aucun src/, run-pricing, Edge Function, config.toml touché
- ✅ Aucune modification de schéma, RLS, trigger
- ✅ Aucune modification de `nst_groups` / `nst_divisions`

### 4.3 Mécanisme de sécurité du SQL (rappel)

Le SQL source est transactionnel et autonome :

1. Phase 1 : crée TEMP `expected_rules` (88 lignes hardcodées générées par `pad_nst_2e_b_r2_corrective.py`)
2. Phase 2 : contrôles E1–E5 (count=88, statuses, evidence, confidence range 0.45-0.85)
3. Phase 3 : `DELETE FROM public.pad_nst_recommendation_rules` puis `INSERT ... SELECT FROM expected_rules`
4. Phase 4 : contrôles F1–F6 sur la table finale
5. Phase 5 : contrôles EQ1+EQ2 (EXCEPT symétriques) — égalité stricte expected ↔ table finale

Toute défaillance lève une `RAISE EXCEPTION` qui roll-back la transaction. Idempotent par design.

---

## 5. Vérification post-R3

À renseigner après application de la migration R3.

| Contrôle | Attendu | Observé | Statut |
|----------|---------|---------|--------|
| `expected_rules` count | 88 | _à remplir_ | _à remplir_ |
| DB active count | 88 | _à remplir_ | _à remplir_ |
| `extra_in_db` | 0 | _à remplir_ | _à remplir_ |
| `missing_in_db` | 0 | _à remplir_ | _à remplir_ |
| `confidence_mismatch` | 0 | _à remplir_ | _à remplir_ |
| `evidence_level_mismatch` | 0 | _à remplir_ | _à remplir_ |
| `validation_status_mismatch` (≠ candidate) | 0 | _à remplir_ | _à remplir_ |
| `requires_operator_validation_mismatch` (≠ true) | 0 | _à remplir_ | _à remplir_ |
| Orphelins group-level vs `nst_groups` | 0 | _à remplir_ | _à remplir_ |
| Orphelins division-level vs `nst_divisions` | 0 | _à remplir_ | _à remplir_ |

**Règle stricte** : si **un seul** contrôle ≠ 0, R3 est en échec, aucune mise à jour `clos` dans `DEFERRED_BACKLOG`, aucune mise à jour `R3 appliqué` dans `PAD_NST_2E_IMPORT_REPORT`, aucun déblocage C-D.

---

## 6. Décisions actées

| Phase | Statut |
|-------|--------|
| PAD-NST-2E-B-R2 | ⚠️ Réouvert — statut antérieur `CLOS` factuellement incorrect |
| PAD-NST-2E-B-R3 | _à compléter post-rerun_ |
| PAD-NST-2E-C-A | ✅ Inchangé (documentaire, pas affecté) |
| PAD-NST-2E-C-B | ⚠️ Edge Function fonctionnelle mais sert temporairement données pré-R2 (jusqu'à R3 OK) |
| PAD-NST-2E-C-C | 🚫 NO-GO strict (inchangé) |
| PAD-NST-2E-C-D | 🚫 NO-GO — reste bloqué jusqu'au succès complet R3 |

---

## 7. Hors-scope (différé)

- Enquête forensic poussée sur l'origine des 7 règles fantômes (qui les a insérées et quand) → à ajouter au backlog après R3
- Réouverture documentaire de l'historique du commit prétendant clôturer R2 → à traiter séparément

---

## Références

| Document | Rôle |
|----------|------|
| `docs/tariff-collection/pad/rules/pad_nst_2e_b_r2_corrective.sql` | Source SQL exécutée par R3 (SHA-256 ci-dessus) |
| `docs/tariff-collection/pad/scripts/pad_nst_2e_b_r2_corrective.py` | Générateur Python du SQL source |
| `docs/tariff-collection/pad/rules/pad_nst_2e_rule_candidates.csv` | 113 règles candidates pré-audit |
| `docs/tariff-collection/pad/rules/pad_nst_2e_audit_results.csv` | Résultats audit R1 (TIER + actions) |
| `docs/tariff-collection/pad/rules/PAD_NST_2E_B_R3_PRE_RERUN_BACKUP.csv` | État DB pré-purge |
| `docs/tariff-collection/pad/PAD_NST_2E_B_R2_RECONCILIATION_REPORT.md` | Rapport R2 d'origine (à requalifier) |
