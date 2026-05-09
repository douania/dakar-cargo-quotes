# PAD-NST-2E-B-R3 — Rapport forensic pré-migration

**Date** : 2026-05-08 → clôture 2026-05-09
**Phase** : PAD-NST-2E-B-R3 — Correction de ré-alignement DB
**Statut** : ✅ CLOS — R3 v3 appliqué en DB réelle (2026-05-09)
**Auteur** : Claude Code
**Dépendance** : PAD-NST-2E-B-R2 (RÉOUVERT — remplacé par R3 v3)

---

## 1. Contexte

Après déploiement de PAD-NST-2E-B-R2 (déclaré ✅ APPLIQUÉ ET VÉRIFIÉ le 2026-05-08), une réconciliation DB active vs `expected_rules` R2 a révélé que la table `public.pad_nst_recommendation_rules` contient 88 lignes mais **pas les bonnes 88**. Des extras, des manquants, des mismatches de confidence et d'evidence_level ont été détectés.

**Conséquence** :
- PAD-NST-2E-B-R2 = RÉOUVERT
- PAD-NST-2E-B-R3 = REQUIS P0
- C-D implémentation = BLOQUÉE jusqu'à R3 validé
- C-B Edge Function = fonctionnelle mais sert des données non conformes R2

---

## 2. État DB active avant R3

| Métrique | Valeur |
|----------|--------|
| `count(*)` DB active | **88** |
| `count(*)` expected_rules R2 | **88** |
| extra_in_db (présentes en DB, absentes de expected) | **9** |
| missing_in_db (absentes de DB, présentes dans expected) | **9** |
| confidence_mismatch | **16** |
| evidence_level_mismatch | **5** |
| Règle orpheline group-level identifiée | **`group\|15.1\|T02`** |

### Conclusion

La table contient 88 lignes mais **n'est pas alignée avec le jeu expected_rules R2**. La somme des déviations (9 extras + 9 manquants + 16 confidence mismatches + 5 evidence mismatches) indique une divergence structurelle incompatible avec les invariants R2. La règle `group|15.1|T02` est un orphelin : aucune règle group-level sur la division 15 (Courrier/colis) ne figure dans le jeu expected_rules R2.

---

## 3. Backup forensic (pré-purge)

Le fichier `docs/tariff-collection/pad/rules/pad_nst_rules_forensic_pre_r3.csv` contient l'export **réel** de la table `public.pad_nst_recommendation_rules` tel qu'elle se trouvait **avant** l'application de R3 v3.

Export réalisé via `supabase--read_query` (SELECT read-only), copié en local, séparateur `;`, 1 ligne header + 88 lignes de données.

### Contrôles de validation du backup (vérifiés)

| # | Contrôle | Attendu | Résultat |
|---|----------|---------|----------|
| B1 | Nombre de lignes données (hors header) | 88 | **88** ✅ |
| B2 | Présence de `group\|15.1\|T02` | Oui | **Présent — ligne 89** ✅ |
| B3 | Présence des 9 règles extras identifiées | Oui | **Oui** ✅ |
| B4 | Colonnes attendues présentes | Oui | **Oui** ✅ |
| B5 | Aucun `PLACEHOLDER` dans le fichier | 0 | **0** ✅ |

---

## 4. Migration R3 v3

### Version appliquée en DB réelle

| Champ | Valeur |
|-------|--------|
| Fichier migration appliqué | `supabase/migrations/20260509120000_pad_nst_2e_b_r3_v3_corrective.sql` |
| Lignes totales | 1 265 (16 lignes d'en-tête + body R2 + zones E0) |
| SHA-256 migration (LF, autoritatif) | `e60e60c3f01a7c3c29340f5e3baef4a9bc6e48c13698aeade8d72965c60dbfca` |
| Fichier source du body | `docs/tariff-collection/pad/rules/pad_nst_2e_b_r2_corrective.sql` |
| Méthode d'exécution | `supabase--migration` rôle service (voie unique autorisée) |
| Sortie migration | **"The migration completed successfully"** |
| `H_source` (MD5 dataset 88 règles) | `4fba07069aa5f7eaa487cb33838f3c6f` |

**Fichier de référence précédent** (R3 v1, non appliqué en DB réelle) :
- `supabase/migrations/20260508200000_pad_nst_2e_b_r3_corrective.sql` — 1 223 lignes (11 en-tête + 1 212 body verbatim R2), versionné pour traçabilité.

### Ce que fait la migration R3 v3

R3 v3 = R2 source byte-for-byte + 3 zones d'injection autorisées :

1. **PHASE 1** : Crée une table temporaire `expected_rules` (ON COMMIT DROP)
2. **PHASE 2** : Insère les 88 règles attendues dans `expected_rules` (88 INSERT générés par script Python — **inchangés depuis R2**)
3. **PHASE 1bis (E0 — nouveau)** : Calcule `H_db = md5(string_agg(row_payload, '\n' ORDER BY nst_level, nst_code, pad_category))` sur `expected_rules` et compare NULL-safe à la constante `'4fba07069aa5f7eaa487cb33838f3c6f'`. Si `H_db IS DISTINCT FROM H_source` → `RAISE EXCEPTION` → rollback.
4. **Contrôles E1–E5** : Vérifie count=88, validation_status, requires_operator_validation, evidence_level, confidence range dans `expected_rules`
5. **PHASE 3** : `DELETE FROM public.pad_nst_recommendation_rules` + `INSERT … SELECT FROM expected_rules`
6. **Contrôles F1–F6** : Vérifie count=88, validation_status, requires_operator_validation, is_active, evidence_level, confidence range dans la table finale
7. **Contrôles EQ1–EQ2** : Égalité exacte bidirectionnelle `EXCEPT` — table finale ↔ expected_rules

En cas d'échec d'un seul contrôle : `RAISE EXCEPTION` → rollback transactionnel complet → DB inchangée.

### Garde-fous préservés

| Invariant | Statut |
|-----------|--------|
| SQL généré automatiquement par script Python | ✅ (inchangé depuis R2) |
| Aucun INSERT écrit/corrigé/compacté manuellement | ✅ |
| Table temporaire `expected_rules` comme source de vérité | ✅ |
| Contrôles d'égalité EXCEPT bidirectionnels (EQ1/EQ2) | ✅ |
| E0 — garde MD5 byte-level anti-corruption silencieuse | ✅ (nouveau en R3 v3) |
| 14 contrôles intégrés dans la migration (E0+E1–E5+F1–F6+EQ1–EQ2) | ✅ |

---

## 5. Contrôles post-R3 — résultats (tous passés ✅)

> Migration exécutée le 2026-05-09. Contrôles M1, M5–M10 vérifiés via `supabase--read_query` post-migration. M2/M3/M4 validés en interne par E0 + EQ1/EQ2 (aucune exception levée).

| # | Contrôle | Attendu | Résultat |
|---|----------|---------|----------|
| M1 | `count(*)` table finale | **88** | **88** ✅ |
| M2 | Extra (table finale EXCEPT expected_rules) | **0** | **0** ✅ (EQ1 interne) |
| M3 | Manquant (expected_rules EXCEPT table finale) | **0** | **0** ✅ (EQ2 interne) |
| M4 | `H_db = H_source` (garde E0) | **égaux** | **égaux** ✅ (E0 interne — aucune exception) |
| M5 | `evidence_level NOT IN ('expert_rule','nstr_bridge_inferred')` | **0** | **0** ✅ |
| M6 | `validation_status != 'candidate'` | **0** | **0** ✅ |
| M7 | `requires_operator_validation = false` | **0** | **0** ✅ |
| M8 | `is_active = false` | **0** | **0** ✅ |
| M9 | Group orphelins (`nst_level='group'` hors `nst_groups`) | **0** | **0** ✅ |
| M10 | `group\|15.1\|T02` absent de la table finale | **absent** | **absent** ✅ |

---

## 6. Statuts après R3 v3 validé

| Élément | Statut avant R3 | Statut après R3 v3 (actuel) |
|---------|-----------------|------------------------------|
| PAD-NST-2E-B-R2 | 🔴 RÉOUVERT | ✅ CLOS — remplacé historiquement par R3 v3 |
| PAD-NST-2E-B-R3 | 🔴 EN COURS | ✅ CLOS — appliqué en DB réelle (2026-05-09) |
| C-D implémentation | 🔒 BLOQUÉE (R3 requis) | ⏳ EN ATTENTE GO CTO séparé (précondition R3 levée) |
| C-B Edge Function | ⚠️ FONCTIONNELLE / données non conformes | ✅ FONCTIONNELLE / données conformes R3 v3 |
| C-C | 🚫 NO-GO strict | 🚫 NO-GO strict (inchangé) |

---

## 7. Périmètre respecté

| Périmètre | Statut |
|-----------|--------|
| Migration data-only | ✅ |
| 0 src/ modifié | ✅ |
| 0 run-pricing modifié | ✅ |
| 0 Edge Function modifiée | ✅ |
| 0 config.toml | ✅ |
| 0 modification de schéma | ✅ |
| 0 UPDATE isolé | ✅ |
| 0 correction manuelle de `group\|15.1\|T02` | ✅ |
| C-D non lancée | ✅ |
| C-C non lancée | ✅ |
| SQL source non modifié | ✅ |
