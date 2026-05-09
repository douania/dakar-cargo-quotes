# PAD-NST-2E-B-R3 — Rapport forensic pré-migration

**Date** : 2026-05-08
**Phase** : PAD-NST-2E-B-R3 — Correction de ré-alignement DB
**Statut** : 🔴 EN COURS — Migration R3 préparée, application en attente (Lovable/Supabase)
**Auteur** : Claude Code
**Dépendance** : PAD-NST-2E-B-R2 (RÉOUVERT)

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

> **⚠️ ACTION LOVABLE REQUISE AVANT APPLICATION R3**
>
> Le fichier `docs/tariff-collection/pad/rules/pad_nst_rules_forensic_pre_r3.csv` est un **placeholder**. Il doit être remplacé par l'export SQL réel de la table actuelle **avant** d'appliquer la migration R3.
>
> Commande d'export recommandée :
> ```sql
> COPY (
>   SELECT id, nst_level, nst_code, pad_category, confidence, evidence_level,
>          validation_status, notes, source_document, source_reference,
>          requires_operator_validation, is_active, created_at, updated_at
>   FROM public.pad_nst_recommendation_rules
>   ORDER BY nst_level, nst_code, pad_category
> ) TO STDOUT CSV HEADER;
> ```

### Contrôles de validation du backup (à vérifier par Lovable)

| # | Contrôle | Attendu |
|---|----------|---------|
| B1 | Nombre de lignes données (hors header) | 88 |
| B2 | Présence de `group\|15.1\|T02` | Oui |
| B3 | Présence des 9 règles extras | Oui |
| B4 | Colonnes : id, nst_level, nst_code, pad_category, confidence, evidence_level, validation_status, notes, source_document, source_reference, requires_operator_validation, is_active, created_at, updated_at | Oui |

---

## 4. Migration R3

### Fichier créé

| Champ | Valeur |
|-------|--------|
| Chemin migration | `supabase/migrations/20260508200000_pad_nst_2e_b_r3_corrective.sql` |
| Lignes totales | 1 223 (11 lignes d'en-tête + 1 212 lignes body) |
| SHA-256 migration | `6746835CF1E2960953210A2A47C03C929B619E63899739712FA06DF541227AF6` |
| Fichier source du body | `docs/tariff-collection/pad/rules/pad_nst_2e_b_r2_corrective.sql` |
| SHA-256 source | `160B5D684A50198CE50F6C8C9B8224DA0F9ED22903F6728F87FDF874CA5282B1` |
| Méthode | Copie conforme — body SQL identique au fichier source, sans modification |
| En-tête ajouté | Oui (11 lignes de commentaires traçables uniquement) |

### Ce que fait la migration R3

La migration R3 est une **ré-application exacte de R2** :

1. **PHASE 1** : Crée une table temporaire `expected_rules` (ON COMMIT DROP)
2. **PHASE 2** : Insère les 88 règles attendues dans `expected_rules` (88 INSERT générés par script Python)
3. **Contrôles E1–E5** : Vérifie count=88, validation_status, requires_operator_validation, evidence_level, confidence range dans `expected_rules`
4. **PHASE 3** : `DELETE FROM public.pad_nst_recommendation_rules` + `INSERT … SELECT FROM expected_rules`
5. **Contrôles F1–F6** : Vérifie count=88, validation_status, requires_operator_validation, is_active, evidence_level, confidence range dans la table finale
6. **Contrôles EQ1–EQ2** : Égalité exacte bidirectionnelle `EXCEPT` — table finale ↔ expected_rules

En cas d'échec d'un seul contrôle : `RAISE EXCEPTION` → rollback automatique.

### Garde-fous préservés

| Invariant | Statut |
|-----------|--------|
| SQL généré automatiquement par script Python | ✅ (inchangé depuis R2) |
| Aucun INSERT écrit/corrigé/compacté manuellement | ✅ |
| Table temporaire `expected_rules` comme source de vérité | ✅ |
| Contrôles d'égalité EXCEPT bidirectionnels | ✅ |
| 13 contrôles intégrés dans la migration | ✅ |

---

## 5. Contrôles post-R3 obligatoires

> **Tous ces contrôles doivent passer avant de clôturer R3.**
> Si un seul échoue : stop immédiat, R3 non clos, C-D non débloquée.

| # | Contrôle SQL | Attendu |
|---|-------------|---------|
| P1 | `SELECT count(*) FROM public.pad_nst_recommendation_rules` | **88** |
| P2 | Extra : `SELECT count(*) FROM pad_nst_recommendation_rules EXCEPT SELECT … FROM expected_rules` | **0** |
| P3 | Manquant : `SELECT count(*) FROM expected_rules EXCEPT SELECT … FROM pad_nst_recommendation_rules` | **0** |
| P4 | `SELECT count(*) FROM … WHERE confidence NOT IN (SELECT confidence …)` — confidence_mismatch | **0** |
| P5 | `SELECT count(*) FROM … WHERE evidence_level NOT IN ('expert_rule','nstr_bridge_inferred')` | **0** |
| P6 | `SELECT count(*) WHERE validation_status != 'candidate'` | **0** |
| P7 | `SELECT count(*) WHERE requires_operator_validation = false` | **0** |
| P8 | `SELECT count(*) WHERE is_active = false` | **0** |
| P9 | Group orphelins : `SELECT nst_code FROM … WHERE nst_level='group' AND nst_code NOT IN (SELECT nst_code FROM nst_groups)` | **0** |
| P10 | Division orphelines : idem avec `nst_level='division'` | **0** |
| P11 | `group\|15.1\|T02` absent de la table finale | **absent** |

---

## 6. Statuts attendus après R3 validé

| Élément | Statut avant R3 | Statut après R3 validé |
|---------|-----------------|------------------------|
| PAD-NST-2E-B-R2 | 🔴 RÉOUVERT | ✅ CLOS (remplacé par R3) |
| PAD-NST-2E-B-R3 | 🔴 EN COURS | ✅ CLOS |
| C-D implémentation | 🔒 BLOQUÉE | 🔒 EN ATTENTE GO CTO (déblocage séparé) |
| C-B Edge Function | ⚠️ FONCTIONNELLE / données non conformes | ✅ FONCTIONNELLE / données conformes R3 |
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
