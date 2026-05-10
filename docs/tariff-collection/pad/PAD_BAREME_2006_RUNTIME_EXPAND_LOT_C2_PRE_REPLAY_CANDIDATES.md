# PAD-BAREME-2006-RUNTIME-EXPAND — Lot C.2-pre : Candidats rejeu shadow

**Verdict :** `LOT_C2_PRE_BLOCKED_NO_ALIAS_CANDIDATE`  
**Branche :** `work`  
**Date :** 2026-05-10  
**Flag :** `PAD_RESOLVER_SHADOW` — **non activé** (aucun rejeu effectué)

---

## Périmètre strict

- Lecture seule uniquement (requêtes `SELECT`).
- Aucun patch code, aucune migration, aucune écriture DB.
- Aucun changement runtime applicatif.
- Pas d'activation de `PAD_RESOLVER_SHADOW`.
- Pas de rejeu de dossier.
- Pas de décision Lot D.
- Aucune donnée inventée.

---

## Objectif

Identifier une short-list de dossiers IMPORT / CONTENEUR (`SEA_FCL_IMPORT`, `SEA_LCL_IMPORT`, `MULTIMODAL_IMPORT`) dont la `cargo.description` (fact `cargo.description` `is_current=true`) croise un alias `pad_designation_aliases` (`is_validated=true`), pour rejeu shadow après activation future de `PAD_RESOLVER_SHADOW=true`.

---

## Méthode de croisement (read-only)

### Requête 1 — Périmètre alias

```sql
SELECT COUNT(*) AS total,
       COUNT(*) FILTER (WHERE is_validated=true) AS validated
FROM pad_designation_aliases;
```

Résultat : **384 alias validés** / 384 total.

### Requête 2 — Périmètre dossiers conteneur

```sql
SELECT qc.request_type::text, COUNT(DISTINCT qc.id) AS cases,
       COUNT(DISTINCT qf.case_id) FILTER (
         WHERE qf.fact_key='cargo.description' AND qf.is_current=true
       ) AS with_cargo_desc
FROM quote_cases qc
LEFT JOIN quote_facts qf ON qf.case_id = qc.id
WHERE qc.request_type::text IN (
  'SEA_FCL_IMPORT', 'SEA_LCL_IMPORT', 'MULTIMODAL_IMPORT'
)
GROUP BY qc.request_type;
```

Résultat :

| request_type      | cases | with_cargo_desc |
|-------------------|-------|-----------------|
| SEA_FCL_IMPORT    | 29    | 20              |
| SEA_LCL_IMPORT    | 5     | 5               |

Total dossiers conteneur avec `cargo.description` : **25**.

### Requête 3 — Croisement cargo.description × alias validé

Normalisation legacy (`normalizePricingText`) : lowercase, strip accents via `translate(...)`, collapse spaces.

```sql
WITH cargo AS (
  SELECT qf.case_id, qf.value_text AS cargo_description,
    lower(translate(qf.value_text,
      'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',
      'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY')) AS norm
  FROM quote_facts qf
  JOIN quote_cases qc ON qc.id = qf.case_id
  WHERE qf.fact_key='cargo.description' AND qf.is_current = true
    AND qc.request_type::text IN (
      'SEA_FCL_IMPORT', 'SEA_LCL_IMPORT', 'MULTIMODAL_IMPORT'
    )
)
SELECT c.case_id, c.cargo_description, a.normalized_term, a.pad_category
FROM cargo c
JOIN pad_designation_aliases a ON a.is_validated = true
WHERE c.norm LIKE '%' || lower(a.normalized_term) || '%'
LIMIT 30;
```

Résultat : **0 ligne**.

Aucun dossier IMPORT / CONTENEUR ne contient une `cargo.description` croisant un alias PAD validé.

### Requête 4 — Match hors périmètre conteneur (informationnel)

```sql
WITH cargo AS (
  SELECT qf.case_id, qf.value_text AS cargo_description,
    lower(translate(qf.value_text,
      'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',
      'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY')) AS norm
  FROM quote_facts qf
  WHERE qf.fact_key='cargo.description' AND qf.is_current=true
)
SELECT c.case_id, c.cargo_description, a.normalized_term, a.pad_category
FROM cargo c
JOIN pad_designation_aliases a ON a.is_validated=true
WHERE c.norm LIKE '%' || lower(a.normalized_term) || '%'
LIMIT 30;
```

Résultat : **1 ligne**.

| case_id                              | cargo_description     | alias_match | alias_pad_category | request_type | transport_mode |
|--------------------------------------|----------------------|-------------|--------------------|--------------|----------------|
| 15462edd-23f7-494c-b581-5569cf26e357 | Diesel Oil Burners   | diesel oil  | T06                | AIR_IMPORT   | —              |

Ce dossier est **hors périmètre conteneur** (`AIR_IMPORT`). Il n'est donc **pas éligible** au rejeu shadow PAD (Lot C v3.1 restreint à IMPORT / CONTENEUR).

---

## Métriques agrégées

| Métrique                                      | Valeur |
|-----------------------------------------------|--------|
| Alias PAD validés (`is_validated=true`)       | 384    |
| Dossiers conteneur avec `cargo.description`   | 25     |
| Croisements conteneur × alias validé          | **0**  |
| Matchs hors-périmètre (informationnel)        | 1 (AIR_IMPORT) |

---

## Conclusion CTO

**Verdict : `LOT_C2_PRE_BLOCKED_NO_ALIAS_CANDIDATE`.**

Il n'existe **aucun dossier IMPORT / CONTENEUR** dont la `cargo.description` croise un alias `pad_designation_aliases` validé. Par conséquent :

- Activer `PAD_RESOLVER_SHADOW=true` et rejouer l'un des 25 dossiers conteneur actuels **ne prouverait pas le chemin alias** du resolver.
- Le Lot C.2 v3 (observation shadow) resterait insuffisant même après activation du flag.

Ce blocage est **data**, pas code. Le resolver et le shadow logging sont prêts (Lot C v3.1 validé). Il manque la couverture alias sur le portefeuille conteneur actuel.

---

## Recommandations opérationnelles (sans décision Lot D)

**Option A — Enrichir les alias (recommandée)**

Créer de nouveaux alias `pad_designation_aliases` à partir des descriptions cargo réelles des 25 dossiers conteneur, après validation opérateur. Cela exige un mini-lot data séparé (alias suggestion + validation).

**Option B — Attendre un dossier éligible**

Attendre l'arrivée naturelle d'un nouveau dossier conteneur dont la description match un alias existant. Non déterministe.

**Option C — Fournir un dossier conteneur historique connu**

Si les ops disposent d'un `case_id` conteneur ayant historiquement déclenché le chemin alias legacy (`inputs.padCategory` rempli via `pad_designation_aliases`), le fournir pour rejeu. Ce rapport n'a pas accès à l'historique legacy.

**Option D — Vérifier la normalisation legacy**

Si le legacy `normalizePricingText` diffère de la normalisation appliquée ici (accents, ponctuation, abréviations), un match pourrait exister mais être masqué par une divergence de normalisation. Vérification possible via comparaison `inputs.padCategory` legacy vs `cargo.description` brute.

---

## Entrée DEFERRED_BACKLOG recommandée

| Champ | Valeur |
|-------|--------|
| ID | `LOT_C2_PRE_NO_ALIAS_COVERAGE` |
| Catégorie | tariff-collection / PAD shadow |
| Statut | différé (blocage data, pas blocage code) |
| Priorité | moyenne |
| Phase d'origine | PAD_BAREME_2006_RUNTIME_EXPAND Lot C.2 |
| Déclencheur de réouverture | enrichissement aliases OU nouveau dossier conteneur match |
| Recommandation | ne pas activer `PAD_RESOLVER_SHADOW=true` tant qu'aucun candidat alias conteneur n'est disponible |

*(Entrée appliquée dans `docs/DEFERRED_BACKLOG.md` par ce lot.)*

---

## Garde-fous respectés

- ✅ Lecture seule uniquement
- ✅ Aucun patch code
- ✅ Aucune migration
- ✅ Aucune écriture DB
- ✅ Aucun changement runtime applicatif
- ✅ Pas d'activation `PAD_RESOLVER_SHADOW`
- ✅ Pas de rejeu de dossier
- ✅ Aucune donnée inventée
- ✅ Aucune décision Lot D
- ✅ Aucune modification du rapport C.2 shadow observation existant

---

## Hors scope (différé, ne pas trancher ici)

- Bascule resolver → source de vérité (Lot D)
- Activation / rejeu shadow (attendre déblocage data)
- Élargissement EXPORT / TRANSIT / TRANSBORDEMENT / CONVENTIONNEL
- Ingestion HS-NST mappings, NST rules, AI suggestions
- `containerSizeToCxxMapping` pour T13
