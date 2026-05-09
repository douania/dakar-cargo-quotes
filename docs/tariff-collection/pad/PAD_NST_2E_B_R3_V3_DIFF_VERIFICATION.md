# PAD-NST-2E-B-R3 v3 — Rapport de vérification du diff

**Date** : 2026-05-09  
**Phase** : R3 v3 — préparation locale  
**Statut** : ✅ Artefacts générés et vérifiés. Exécution DB en attente de GO CTO séparé.  
**Auteur** : Lovable (build mode)

---

## 1. Périmètre respecté

| Contrainte | Statut |
|---|---|
| Aucune exécution DB | ✅ |
| Aucune transmission `supabase--migration` | ✅ |
| Aucun SQL Editor inline | ✅ |
| Aucun `psql` sandbox | ✅ |
| Aucun commit/push GitHub | ✅ |
| Fichier source R2 inchangé | ✅ |
| Fichier R3 v2 existant inchangé | ✅ |
| 88 INSERT inchangés | ✅ |
| confidence / evidence_level / notes inchangés | ✅ |
| `src/`, `run-pricing/`, Edge Function, `config.toml`, schéma : aucune modification | ✅ |
| C-D / C-C bloqués | ✅ |

---

## 2. Livrables produits

| # | Fichier | Type |
|---|---------|------|
| 1 | `docs/tariff-collection/pad/scripts/compute_r3_source_hash.py` | Script de calcul `H_source` (gardes 1+2+3) |
| 2 | `docs/tariff-collection/pad/scripts/build_r3v3_migration.py` | Script de construction de la migration R3 v3 |
| 3 | `supabase/migrations/20260509120000_pad_nst_2e_b_r3_v3_corrective.sql` | Migration R3 v3 (préparée, non exécutée) |
| 4 | `docs/tariff-collection/pad/PAD_NST_2E_B_R3_V3_diff.txt` | Diff unified entre source R2 et R3 v3 |
| 5 | Ce rapport (`PAD_NST_2E_B_R3_V3_DIFF_VERIFICATION.md`) | Rapport de vérification CTO |

---

## 3. Sortie complète de `compute_r3_source_hash.py`

```
======================================================================
PAD-NST-2E-B-R3 v3 — compute_r3_source_hash
======================================================================
[Garde 1] OK — SHA-256 source = fe9fab1d35ec2423196c60c47bd92e1c6b281d9df87cb2f72e522e664ffd9e50
[Garde 2] OK — reconstruction Python = SQL source (88 lignes)
[Garde 3] OK — 88 clés distinctes (nst_level|nst_code|pad_category)

======================================================================
RÉSULTAT
======================================================================
H_source         = 4fba07069aa5f7eaa487cb33838f3c6f
sha256_source    = fe9fab1d35ec2423196c60c47bd92e1c6b281d9df87cb2f72e522e664ffd9e50
count            = 88
distinct_keys    = 88
confidence_range = 0.45-0.85

Sérialisation (règle UNIQUE — alignée Python ↔ SQL) :
  - Texte non-null : '<octet_length_utf8>:<valeur>;'
  - Texte NULL    : 'N;' (distinct de '0:;' chaîne vide)
  - confidence    : f'{x:.2f}' Python ↔ to_char(x, 'FM0.00') SQL,
                    puis sérialisé comme texte non-null
  - Booléen TRUE  : '1:t;'
  - Booléen FALSE : '1:f;'
  - Tri lignes    : ORDER BY nst_level, nst_code, pad_category
  - Séparateur    : '\n' (LF unique) entre lignes
  - Hash final    : md5(payload_global).hexdigest()
```

---

## 4. Hash et SHA — preuves d'intégrité

| Élément | Valeur |
|---------|--------|
| **`H_source`** (MD5 du dataset 88 règles, sérialisation déterministe) | `4fba07069aa5f7eaa487cb33838f3c6f` |
| SHA-256 fichier source R2 | `fe9fab1d35ec2423196c60c47bd92e1c6b281d9df87cb2f72e522e664ffd9e50` (vérifié, attendu identique) |
| SHA-256 nouveau fichier R3 v3 | `e60e60c3f01a7c3c29340f5e3baef4a9bc6e48c13698aeade8d72965c60dbfca` |
| **SHA-256 « R3 v3 moins les 3 zones autorisées »** | `fe9fab1d35ec2423196c60c47bd92e1c6b281d9df87cb2f72e522e664ffd9e50` |

**Preuve byte-for-byte** : SHA-256 du R3 v3 après suppression exacte des 3 zones d'injection = SHA-256 du fichier source R2. Cela garantit que les 88 INSERT et tous les contrôles existants (E1–E5, F1–F6, EQ1–EQ2) sont préservés byte-for-byte, sans aucune altération.

---

## 5. Vérification encodage DB

Exécuté via `supabase--read_query` (read-only) :

```sql
SHOW server_encoding;
```

**Résultat** : `UTF8` ✅

L'encodage DB correspond à celui utilisé par `octet_length()` côté SQL et `len(s.encode("utf-8"))` côté Python. Les longueurs en octets seront strictement identiques entre Python et PostgreSQL pour toute chaîne UTF-8.

---

## 6. Diff complet — analyse des 3 zones

Diff produit (`docs/tariff-collection/pad/PAD_NST_2E_B_R3_V3_diff.txt`, 73 lignes / 3790 caractères).

### Zone 1 — En-tête R3 v3
- **Position** : 16 lignes ajoutées avant le contenu original (qui commence par `-- PAD-NST-2E-B-R2 — Migration corrective finale`).
- **Contenu** : commentaires uniquement, traçabilité (date, statut, SHA source vérifié, `H_source`, méthode, garde E0). Aucun SQL exécutable.

### Zone 2 — `DECLARE` extra
- **Position** : 2 lignes ajoutées entre `v_missing INTEGER;` et `BEGIN`.
- **Contenu** :
  ```
  v_db_hash text;
  v_expected_hash text;
  ```

### Zone 3 — `PHASE 1bis` (garde E0)
- **Position** : 35 lignes ajoutées entre la fermeture du dernier INSERT (rule 88/88) et le marqueur `-- ============ PHASE 2: CONTRÔLES SUR expected_rules ============`.
- **Contenu** :
  - Calcul de `v_db_hash` via `md5(string_agg(row_payload, …))` sur la table temporaire `expected_rules`.
  - Sérialisation déterministe identique à celle calculée côté Python.
  - Comparaison NULL-safe : `IF v_db_hash IS DISTINCT FROM v_expected_hash THEN RAISE EXCEPTION …`
  - `v_expected_hash` est la constante littérale `'4fba07069aa5f7eaa487cb33838f3c6f'`.

**Aucune autre zone n'a été modifiée.**

---

## 7. Contrôles internes préservés byte-for-byte

| Contrôle | Origine | Préservation byte-for-byte |
|----------|---------|----------------------------|
| 88 INSERT dans `expected_rules` | R2 source | ✅ (preuve par SHA section 4) |
| E1 — count expected_rules = 88 | R2 source | ✅ |
| E2 — validation_status = candidate | R2 source | ✅ |
| E3 — requires_operator_validation = true | R2 source | ✅ |
| E4 — evidence_level whitelist | R2 source | ✅ |
| E5 — confidence range 0.45-0.85 | R2 source | ✅ |
| `DELETE FROM public.pad_nst_recommendation_rules` | R2 source | ✅ |
| `INSERT INTO public.pad_nst_recommendation_rules ... SELECT FROM expected_rules` | R2 source | ✅ |
| F1–F6 — contrôles table finale | R2 source | ✅ |
| EQ1 — table finale → expected = 0 | R2 source | ✅ |
| EQ2 — expected → table finale = 0 | R2 source | ✅ |

**Nouveau** :
- E0 — `md5` indépendant `expected_rules` ↔ `H_source` injecté (PHASE 1bis).

---

## 8. Pourquoi la garde E0 résout le problème CTO

**Risque identifié par le CTO** : les contrôles internes EQ1/EQ2 prouvent uniquement que `table finale = expected_rules du payload exécuté`. Ils ne prouvent **pas** que `expected_rules du payload exécuté = fichier source byte-for-byte`. Une corruption silencieuse qui conserverait 88 INSERT valides passerait sans détection.

**Solution E0** :
- `H_source` est calculé **hors exécution SQL**, en Python, à partir du fichier source disque dont le SHA-256 est vérifié contre une valeur connue (`fe9fab1d…`).
- `H_source` est injecté comme **constante littérale** dans la migration R3 v3.
- Au moment de l'exécution, `H_db` est recalculé **côté Postgres** sur la table temporaire `expected_rules` après les 88 INSERT, **avant** le `DELETE`.
- Si la transmission inline a corrompu **n'importe quel** caractère d'une seule ligne (note, confidence, evidence_level, etc.) → `H_db ≠ H_source` → `RAISE EXCEPTION` → rollback transactionnel complet → DB inchangée.

**Défense en profondeur** :
1. **E0** (nouveau) : détecte corruption silencieuse byte-level
2. E1 (existant) : détecte troncature de comptage
3. E2–E5, F1–F6 : intégrité métier
4. EQ1/EQ2 : égalité expected ↔ table finale

---

## 9. Points d'arrêt explicites (rappel)

| # | Garde | Statut |
|---|-------|--------|
| 1 | SHA source = `fe9fab1d…` | ✅ vérifié |
| 2 | reconstruction Python = SQL source | ✅ vérifié (88/88 lignes identiques) |
| 3 | 88 clés distinctes | ✅ vérifié |
| 4 | `server_encoding` = `UTF8` | ✅ vérifié |
| 5 | Diff R3 v3 contient uniquement les 3 zones autorisées | ✅ vérifié |
| 6 | SHA R3 v3 « moins zones autorisées » = SHA copie pure du source | ✅ vérifié |

---

## 10. Décision attendue après livraison

Tous les artefacts R3 v3 sont produits localement. **Aucune modification DB n'a été effectuée. Aucun commit/push.**

Le CTO peut désormais :
- Réviser le script `compute_r3_source_hash.py` (logique de hash + gardes).
- Réviser le script `build_r3v3_migration.py` (construction de la migration).
- Réviser le diff `PAD_NST_2E_B_R3_V3_diff.txt`.
- Réviser ce rapport.
- Vérifier que la migration `supabase/migrations/20260509120000_pad_nst_2e_b_r3_v3_corrective.sql` est conforme aux attentes.

**Décision suivante (hors périmètre du présent livrable)** : GO ou NO-GO **séparé** pour exécution future via `supabase--migration` (rôle service), suivie des contrôles M1, M5–M10.

C-D et C-C restent bloqués jusqu'à arbitrage CTO ultérieur.
