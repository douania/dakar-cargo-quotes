# PAD-NST-2E-C-A — Plan d'intégration runtime (documentaire uniquement)

**Date** : 2026-05-08
**Phase** : PAD-NST-2E-C-A — Plan runtime documentaire
**Statut** : DOCUMENT DE PLAN — Aucun code, aucune migration, aucun runtime
**Prérequis validé** : PAD-NST-2E-B-R2 ✅ CLOS (88 règles TIER-A/B réconciliées)
**Auteur** : Lovable / CTO

---

## 1. Contexte et dépendances

### Dépendances résolues

| Dépendance | Statut |
|------------|--------|
| PAD-NST-2E-B-R2 | ✅ CLOS — 88 règles TIER-A/B dans `pad_nst_recommendation_rules`, conformes à l'audit R1 |
| PAD-R1B-GOVERNANCE | ✅ DÉCISION ACTÉE — Option A coexistence réglementée, doctrine amount C modifiée |
| PAD-TOTALS-1 | ✅ CLOS — total_ht corrigé |
| PAD-NST-1 | ✅ Doctrine documentée (PAD_NST_RECOMMENDATION_ENGINE.md) |
| PAD-NST-2 (tables structurelles) | ✅ 7 tables NST créées, 26 600+ correspondances importées |

### Table concernée

`pad_nst_recommendation_rules` :
- 88 lignes (35 TIER-A + 53 TIER-B)
- `validation_status = 'candidate'` (toutes)
- `requires_operator_validation = true` (toutes)
- `is_active = true` (toutes)
- `confidence` : 0.45–0.85
- `evidence_level` : `expert_rule` (84), `nstr_bridge_inferred` (4)

---

## 2. Objectif

Définir **comment** et **quand** le moteur de pricing (`run-pricing`) lira les règles de la table `pad_nst_recommendation_rules` lorsque le lookup PAD standard échoue.

**Ce document est un plan.** Il ne contient aucune implémentation, aucun patch, aucune migration.

---

## 3. Architecture cible (documentation — pas de code)

### Hiérarchie de résolution PAD

```text
1. opérateur cargo.pad_category        → OFFICIAL (fait opérateur, priorité absolue)
2. lookup PAD standard actuel :
   alias exact validé (pad_designation_aliases, is_validated=true)
                                        → OFFICIAL
3. NST group rule
   (pad_nst_recommendation_rules, nst_level='group')
                                        → TO_CONFIRM (amount=0)
4. NST division rule
   (pad_nst_recommendation_rules, nst_level='division')
                                        → TO_CONFIRM (amount=0)
5. aucun match                          → gap pricing.pad_category (bloquant)
```

> **Note importante** : le lookup PAD standard actuel est basé sur un alias exact validé (`pad_designation_aliases` avec `is_validated=true`). Toute logique substring/fuzzy éventuelle doit être documentée séparément si elle existe réellement dans le runtime. Ce plan ne présume pas de l'existence d'un lookup substring.

### Flux simplifié

```text
[Description marchandise]
        ↓
  Fait opérateur pad_category ?
        ↓ non
  Lookup alias PAD exact validé
        ↓ échec
  Requête pad_nst_recommendation_rules (SELECT, read-only)
        ↓ match trouvé
  Suggestion TO_CONFIRM (amount=0, estimated_amount éventuel)
        ↓
  Validation opérateur obligatoire
        ↓
  set-case-fact → re-run pricing → OFFICIAL
```

---

## 4. Contrat d'interface table ↔ moteur

| Aspect | Spécification |
|--------|---------------|
| Requête DB | `SELECT ... FROM pad_nst_recommendation_rules WHERE nst_level = ? AND nst_code = ? AND is_active = true AND validation_status = 'candidate' ORDER BY confidence DESC` |
| Écriture DB | **Aucune** — le moteur ne modifie jamais la table |
| Sortie moteur | `source.type = "TO_CONFIRM"`, `amount = 0`, `estimated_amount` éventuel (séparé) |
| Validation | `requires_operator_confirmation = true` toujours |
| Inclusion totaux | **Aucune** — pas d'inclusion dans `total_ht` / `total_ttc` |
| Appel IA | **Aucun** — scoring local uniquement (grille statique NST → PAD) |

---

## 5. Garde-fous métier (invariants non négociables)

| # | Garde-fou | Source |
|---|-----------|--------|
| 1 | Aucune catégorie PAD estimée ne produit `amount > 0` | PAD-R1B |
| 2 | Aucune écriture dans `pad_designation_aliases` sans action opérateur | PAD-R1B |
| 3 | Aucun appel IA dans le scoring NST | PAD-NST-1 §10 |
| 4 | `requires_operator_confirmation = true` toujours | PAD-R1B |
| 5 | `source.type = "TO_CONFIRM"` pour toute catégorie estimée | PAD-R1B |
| 6 | Scoring local uniquement (grille statique NST → PAD) | PAD-NST-1 §6 |
| 7 | Aucune inclusion dans `total_ht` / `total_ttc` | PAD-R1B doctrine amount C |
| 8 | `estimated_amount` séparé, jamais confondu avec `amount` | PAD-R1B |
| 9 | Validation opérateur obligatoire avant qu'une catégorie PAD devienne officielle | PAD-R1B, PAD-NST-1 §8 |

---

## 6. Séquence d'intégration runtime (phases futures)

| Phase | Nom | Action | Invariants | GO CTO requis |
|-------|-----|--------|------------|---------------|
| **C-A** | **Plan documentaire (ce document)** | Création du plan | 0 src/, 0 run-pricing, 0 Edge Function, 0 migration, 0 config.toml | ✅ (ce plan) |
| C-B | Lecture DB isolée | Fonction Deno `getPadNstSuggestions(nstCode, materialTokens)` — lecture SELECT uniquement | 0 écriture DB, 0 appel IA, 0 modification run-pricing | **GO CTO séparé requis** |
| C-C | Branchement run-pricing | Intégration dans le lookup PAD après échec alias exact validé | TO_CONFIRM uniquement, amount=0 | **GO CTO séparé requis** |
| C-D | UI opérateur | Affichage suggestion + justification + confiance + sources | Pas de bouton auto-valider | **GO CTO séparé requis** |
| C-E | Audit terrain | Analyse qualité sur N dossiers réels | Calibration seuils | **GO CTO séparé requis** |

> **PAD-NST-2E-C-B reste une phase future.** Il nécessite un GO CTO séparé et ne doit pas être lancé à l'issue de C-A.

---

## 7. Journal d'audit des recommandations

**Objectif futur.** Aucune table nouvelle n'est créée en C-A.

Si une table `pad_recommendation_audit_log` est nécessaire pour tracer les recommandations NST émises et les décisions opérateur, elle fera l'objet d'une **phase séparée avec migration dédiée** (probablement C-B ou C-C).

Structure indicative (documentation uniquement) :

| Colonne | Type | Rôle |
|---------|------|------|
| `id` | uuid | PK |
| `case_id` | uuid | Dossier concerné |
| `input_description` | text | Description marchandise en entrée |
| `nst_code_matched` | text | Code NST ayant matché |
| `recommended_pad_category` | text | Catégorie PAD suggérée |
| `confidence` | numeric | Confiance de la règle |
| `operator_decision` | text | Décision opérateur (accepted/rejected/modified) |
| `operator_category` | text | Catégorie choisie par l'opérateur |
| `created_at` | timestamptz | Date de la recommandation |
| `decided_at` | timestamptz | Date de la décision opérateur |

---

## 8. Tests documentés — exigences pour phases futures

Les cas tests ci-dessous ne valident pas une catégorie PAD officielle.
Ils servent à vérifier que le moteur :

1. ne force jamais une catégorie en OFFICIAL ;
2. retourne uniquement TO_CONFIRM ;
3. affiche les candidates issues des règles R2 ;
4. bloque ou demande validation opérateur en cas d'ambiguïté ;
5. ne produit jamais amount > 0.

| # | Description | Résultat attendu |
|---|-------------|-----------------|
| 1 | HDPE geomembrane pour projet minier | TO_CONFIRM — candidates à déterminer via règles NST plastics/manufactured products ; opérateur obligatoire |
| 2 | Matériel informatique | OFFICIAL si alias exact validé ; sinon TO_CONFIRM avec T01 probable |
| 3 | Pièces détachées industrielles | TO_CONFIRM ou BLOCKED_OPERATOR_REQUIRED selon précision |
| 4 | Résine plastique brute | TO_CONFIRM — famille plastiques/matières premières industrielles ; candidate probable T08 selon règle applicable |
| 5 | Tuyaux PVC | TO_CONFIRM — produit plastique manufacturé ; candidate probable T12 selon règle applicable |
| 6 | Engrais | TO_CONFIRM — candidates probables T03/T08 selon composition |
| 7 | Équipements de chantier | OFFICIAL si alias exact validé ; sinon TO_CONFIRM — T09 probable si matériel roulant/transport |
| 8 | Produits chimiques industriels | TO_CONFIRM — candidates probables T10/T03 selon nature chimique |
| 9 | Matériaux de construction divers | TO_CONFIRM ou BLOCKED selon précision ; T05/T07/T12 possibles selon produit |
| 10 | Marchandises de groupage mixtes | BLOCKED_OPERATOR_REQUIRED |

---

## 9. Critères de GO / NO-GO pour passage C-A → C-B

| Critère | GO si |
|---------|-------|
| Plan C-A approuvé par CTO | ✅ |
| PAD-NST-2E-B-R2 clos | ✅ |
| Aucune migration nécessaire pour C-B | Fonction Deno pure, lecture SELECT uniquement |
| Aucun changement RLS nécessaire | Table déjà en RLS SELECT pour authenticated |
| run-pricing non modifié dans C-B | Fonction isolée, pas de branchement |
| GO CTO séparé pour C-B | **Requis** |

---

## 10. Exclusions explicites de ce plan (C-A)

- ✅ Aucune modification `src/`
- ✅ Aucune modification `run-pricing/`
- ✅ Aucune Edge Function créée ou modifiée
- ✅ Aucune migration SQL
- ✅ Aucun changement `config.toml`
- ✅ Aucun changement de schéma
- ✅ Aucun patch runtime
- ✅ Aucune table nouvelle créée
- ✅ Aucun branchement de code

---

## 11. Références

| Document | Rôle |
|----------|------|
| `PAD_NST_RECOMMENDATION_ENGINE.md` | Doctrine NST 2007 pour recommandation PAD (PAD-NST-1) |
| `PAD_NST_2E_B_R2_RECONCILIATION_REPORT.md` | Rapport de réconciliation finale R2 |
| `PAD_R1B_GOVERNANCE_DECISION.md` | Décision d'architecture PAD-R1B |
| `PAD_NST_2E_AUDIT_REPORT.md` | Audit R1 des 112 règles |
| `Rapport_Audit_CTO_Manus_PAD_NST.md` | Audit CTO Manus (pièce documentaire) |
| `docs/DEFERRED_BACKLOG.md` | Backlog différé (DEFER-PAD-NST-2E-B-R2 clos) |
