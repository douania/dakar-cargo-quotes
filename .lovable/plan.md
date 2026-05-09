## PAD-NST-2E-B-R3 v2 — Plan d'exécution stricte (révisé étape 4)

### Objectif
Ré-aligner `public.pad_nst_recommendation_rules` sur les 88 règles attendues R2 via exécution **intégrale** du fichier `supabase/migrations/20260508200000_pad_nst_2e_b_r3_corrective.sql` par l'outil `supabase--migration` (rôle service).

### Contraintes (rappel)
- Pas de reconstruction d'INSERT, pas de VALUES P2 manuel, pas de compactage, pas de modification du body SQL.
- Pas de SQL Editor, pas de `psql -f`, pas de `src/`, pas de run-pricing, pas d'Edge Function, pas de `config.toml`.
- Pas de C-D, pas de C-C, pas de commit/push.

---

### Étape 1 — Pré-flight read-only (aucun effet DB)

Sur `supabase/migrations/20260508200000_pad_nst_2e_b_r3_corrective.sql` :

| Contrôle | Attendu |
|---|---|
| Fichier présent | OUI |
| `wc -l` | **1223** lignes |
| Présence `-- Rule 88/88` | OUI |
| Présence `v_expected = 88` (E1) | OUI |
| Présence des 2 blocs `EXCEPT` (EQ1, EQ2) | OUI |
| SHA-256 body (`tail -n +12 \| sha256sum`) | `fe9fab1d35ec2423196c60c47bd92e1c6b281d9df87cb2f72e522e664ffd9e50` |

État DB pré-R3 (read-only via `supabase--read_query`) : count=88, orphelin `group|15.1|T02` confirmé.

**Si un seul contrôle KO → STOP.**

---

### Étape 2 — Correction cosmétique en-tête (optionnelle)

Si le commentaire d'en-tête mentionne le mauvais SHA source (`160B5D684A50198…`), le remplacer par `fe9fab1d35ec2423196c60c47bd92e1c6b281d9df87cb2f72e522e664ffd9e50` via `code--line_replace` ciblé **lignes 1–11 uniquement**. Re-vérifier ensuite que le SHA du body (ligne 12+) est inchangé.

**Si la modification altère le SHA du body → STOP**, restaurer le fichier.

---

### Étape 3 — Exécution via `supabase--migration`

1. Lecture intégrale du fichier disque (header + body).
2. Mesure de taille payload.
3. Transmission **complète** au paramètre `query` de `supabase--migration` (rôle service).

**Garde-fous SQL internes** (déjà dans le fichier, déclenchent rollback transactionnel automatique en cas d'anomalie) :
- E1 : `count(expected_rules) = 88` → détecte toute troncature de transmission (cas R3 v1).
- E2–E5 : intégrité de la table temporaire.
- F1–F6 : intégrité table finale après DELETE+INSERT.
- **EQ1** : `pad_nst_recommendation_rules EXCEPT expected_rules = 0` (pas d'extra).
- **EQ2** : `expected_rules EXCEPT pad_nst_recommendation_rules = 0` (pas de manquant).

**Si erreur, rollback ou sortie ambiguë → STOP**, ne pas clôturer R3.

---

### Étape 4 — Contrôles post-exécution (révisés)

> **Correction CTO** : `expected_rules` est une `TEMP TABLE … ON COMMIT DROP` créée à l'intérieur de la migration. Elle **n'existe plus** après commit. Les comparaisons table finale ↔ expected ne sont donc **pas re-exécutables** en post-R3 via `supabase--read_query`.

**Preuve primaire d'égalité stricte** = exécution intégrale de la migration sans exception → les contrôles internes **EQ1 et EQ2** sont, par définition, passés (sinon `RAISE EXCEPTION` + rollback complet, donc DB inchangée).

**Reporting post-R3 livré au CTO** :

A. **Preuves de transmission/exécution** :
- Sortie brute complète de `supabase--migration`.
- Confirmation que le fichier complet a été transmis (taille payload + nombre de lignes).
- Confirmation que le SHA-256 body pré-exécution = `fe9fab1d35ec2423196c60c47bd92e1c6b281d9df87cb2f72e522e664ffd9e50`.

B. **Validation M2/M3/M4 (égalité stricte)** : option (a) par défaut :
- (a) Mention explicite : *« validés par contrôles internes EQ1/EQ2 (égalité EXCEPT bidirectionnelle) + E1/F1 (count=88) + F5 (evidence_level) de la migration exécutée sans exception »*.
- (b) Optionnel : fournir une requête read-only `WITH expected AS (VALUES …)` reconstruite **sans modifier la DB ni le fichier source**, à des fins de double-check documentaire uniquement. Cette option n'est pas requise si (a) est acceptée.

C. **Contrôles read-only directs sur la DB finale** (via `supabase--read_query`) :

| # | Contrôle | Attendu |
|---|---|---|
| M1 | `count(*) FROM pad_nst_recommendation_rules` | 88 |
| M5 | `evidence_level NOT IN ('expert_rule','nstr_bridge_inferred')` | 0 |
| M6 | `validation_status != 'candidate'` | 0 |
| M7 | `requires_operator_validation = false` | 0 |
| M8 | `is_active = false` | 0 |
| M9 | group orphelins (nst_code absent de `nst_groups`) | 0 |
| M10 | présence `group\|15.1\|T02` | absent |

**Si un seul de M1/M5–M10 ≠ attendu → STOP**, R3 non clôturé, pas de mise à jour `DEFERRED_BACKLOG`, pas de C-D.

---

### Étape 5 — Reporting (sans clôture)

Remontée CTO :
- Sortie brute outil migration.
- Preuves A + déclaration B(a) [ou B(b) si demandée] + résultats C (M1, M5–M10).
- Diff réel des fichiers touchés (uniquement lignes 1–11 du fichier migration si étape 2 effectuée).

**Décision de clôture R3 + déblocage éventuel C-D** = arbitrage CTO ultérieur, hors périmètre.

---

### Périmètre touché
- **Lecture** : fichier migration disque, tables `pad_nst_recommendation_rules`, `nst_groups`.
- **Écriture potentielle** : lignes 1–11 fichier migration (commentaire SHA), table `pad_nst_recommendation_rules` (DELETE + INSERT 88 via la migration).
- **Aucune autre modification** : src/, Edge Functions, config.toml, schéma, autres tables → intacts.

### Points d'arrêt explicites (STOP)
1. Pré-flight : un seul contrôle KO.
2. SHA body altéré après correction d'en-tête.
3. Outil migration : erreur, rollback, ou sortie ambiguë sur l'intégrité de transmission.
4. Contrôles M1, M5–M10 : un seul ≠ attendu.

Dans tous ces cas : ne rien clôturer, ne rien documenter comme succès, attendre arbitrage CTO.
