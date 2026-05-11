# PAD-BAREME-2006-RUNTIME-EXPAND — Lot C.2-pre+2 : Pack de décision opérateur (`carreaux` → T12)

**Verdict :** `LOT_C2_PRE_PLUS_2_OPERATOR_PACK_READY`
**Branche :** `work`
**Date :** 2026-05-11
**Mode :** documentaire — aucune injection, aucune migration, aucune écriture DB
**Flag `PAD_RESOLVER_SHADOW`** : **non activé**
**Décision opérateur** : **non simulée** — attend opérateur réel hors de ce lot

---

## 1. Contexte

| Lot | Verdict | Sortie clé |
|---|---|---|
| C.2 (shadow observation) | bloqué | flag `PAD_RESOLVER_SHADOW` non activé, 0 dossier rejoué exploitable |
| C.2-pre | `LOT_C2_PRE_BLOCKED_NO_ALIAS_CANDIDATE` | 0 croisement entre 25 dossiers conteneur et 384 alias validés |
| C.2-pre+1 | `LOT_C2_PRE_PLUS_1_CANDIDATES_READY_FOR_OPERATOR_VALIDATION` | 1 seul candidat near-match : `carreaux` → T12 (TO_VALIDATE_OPERATOR), 24 `NO_PAD_MATCH_FOUND`, 0 conflit |

Ce lot **C.2-pre+2** ne fait que matérialiser le pack que devra trancher l'opérateur. **Aucune injection** n'est exécutée ici. Si la décision opérateur est `OUI sans réserve`, un Lot **C.2-pre+3** séparé (GO CTO requis) portera la migration ciblée.

---

## 2. Périmètre strict

- Lecture seule uniquement (SELECT + lecture rapports existants).
- Aucune modification de `pad_designation_aliases`, `commodity_designation_matches`, `commodity_categories`, `quote_facts`, `pricing_runs`, `quote_cases`.
- Aucun patch code, aucune migration, aucune Edge Function, aucun `config.toml`.
- Pas d'activation `PAD_RESOLVER_SHADOW`, pas de rejeu de dossier.
- Aucune décision Lot D (bascule resolver source de vérité).
- Aucune modification des rapports C.2, C.2-pre, C.2-pre+1.
- Aucune décision opérateur simulée — la réponse réelle viendra hors de ce lot.

---

## 3. Question à l'opérateur (formalisée)

> **Dans le contexte SODATRA, un cargo libellé "carreaux" sans qualificatif (ni "céramiques", ni "verre", ni "pierre", ni "métal") doit-il être systématiquement traité comme T12 (matériaux, chimie et produits manufacturés divers) ?**

Trois options et trois seules. **Une seule autorise un futur Lot C.2-pre+3 d'injection.**

### Option 1 — OUI sans réserve **(seule option qui ouvre Lot C.2-pre+3)**
Tous les "carreaux" reçus en pratique chez SODATRA sont en céramique ou équivalent T12. Aucune autre famille (verre / pierre / métal) n'apparaît avec une `pad_category` différente.
→ Permet la création d'un alias validé `carreaux` → T12 dans un Lot C.2-pre+3 séparé (GO CTO requis).

### Option 2 — NON
Le terme `carreaux` seul est trop polysémique. SODATRA traite régulièrement (ou pourrait traiter) des carreaux dans des matières dont la `pad_category` diverge de T12.
→ Ne pas injecter d'alias. Créer une règle opératoire : pour tout cargo libellé seulement `carreaux`, demander au client la précision de matière avant pricing.
→ Le gap `pad_category` reste ouvert sur ce dossier et tout dossier futur similaire.

### Option 3 — CONDITIONNEL / NO-INSERT
L'opérateur a une réserve (cas marginal possible mais rare).
→ **Ne pas injecter** `carreaux` seul comme alias validé. Une simple note ne protège pas contre le caractère déterministe de `pad_designation_aliases` au runtime.
→ Appliquer la même règle opératoire que l'Option 2 : demander la matière au client quand le libellé est seulement `carreaux`.

> **Important** : l'Option 3 ne permet PAS d'injection automatique avec note. Tout alias validé est lu de manière déterministe par le runtime ; un commentaire en colonne libre n'empêche pas la classification automatique. Si l'opérateur n'est pas catégorique, c'est NO-INSERT.

---

## 4. Évidence chiffrée à présenter à l'opérateur

### 4.1 Dossier source unique

| Champ | Valeur |
|---|---|
| `case_id` | `a5a58d25-7e9d-4884-9ba9-2bf3f631a302` |
| `request_type` | `SEA_FCL_IMPORT` |
| `cargo.description` | `carreaux` *(source : `manual_input`)* |
| `cargo.containers` | `4 × 40FT HC` |
| `cargo.freight_cost` | `11 069 EUR` |
| `routing.incoterm` | `DAP` |
| `routing.origin_country` | `Inde` |
| `routing.origin_port` | `Ennore` |
| `routing.destination_port` | `DAKAR` |

> Source : `quote_facts WHERE case_id='a5a58d25-…' AND is_current=true`. Lecture seule.

### 4.2 Couverture historique du terme `carreaux`

Recherche en lecture seule (formulation prudente — Garde-fou n°3) :

| Source consultée | Résultat | Conclusion |
|---|---|---|
| `quote_facts` (`fact_key='cargo.description' AND value_text ILIKE '%carreaux%' AND is_current=true`) | **1 ligne** : uniquement `a5a58d25-…` | Pas d'autre dossier actif avec `carreaux` dans la description |
| `pricing_runs.inputs_json -> 'padCategory'` (et `inputs.padCategory`) sur `a5a58d25-…` | `null` (2 runs : `run_number` 1 et 2) | Aucune `padCategory` injectée à l'engine pour ce dossier |
| `pricing_runs.outputs_json -> 'classification'` sur `a5a58d25-…` | `null` | L'engine n'a produit aucune classification PAD pour ce dossier |
| Autres `quote_facts` `pricing.pad_category` historiques pour `carreaux` | aucun croisement détecté | Historique non concluant pour étayer ou contredire T12 |

**Conclusion historique** : *historique non concluant*. L'opérateur ne peut pas s'appuyer sur un usage SODATRA passé documenté ; sa décision doit reposer sur la connaissance métier (typologie réelle des carreaux importés via SODATRA) plutôt que sur une majorité observée.

### 4.3 Évidence référentiel (rappel C.2-pre+1)

| Source | Match | `pad_category` |
|---|---|---|
| `pad_designation_aliases` `carreaux ceramiques` (validé) | near match (substring) | T12 |
| `pad_designation_aliases` `carreaux en ceramique` (validé) | near match (substring) | T12 |
| `commodity_categories.designation_normalized` | aucun match exact | — |
| `PAD_2006_NOMENCLATURE_INJECTABLE_FINAL.csv` | aucun terme `carreaux` seul | — |
| `PAD_2006_ALIAS_CONFLICTS_OPUS.csv` | non listé | — (pas de conflit listé) |
| Multi-sources dynamique | toutes les sources qui matchent pointent T12 | pas de conflit dynamique |

---

## 5. Plan d'injection conditionnel (DRAFT — exécution interdite dans ce lot)

> Ce plan ne s'applique **que si** l'opérateur valide **Option 1 — OUI sans réserve**. Il sera porté par un **Lot C.2-pre+3** séparé avec **GO CTO requis**. Les options 2 et 3 ne déclenchent aucun INSERT.

### 5.1 Schéma confirmé `pad_designation_aliases` (lecture `information_schema`)

Colonnes effectivement présentes :

| Colonne | Type | Nullable | Default |
|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` |
| `bl_term` | text | NO | — |
| `normalized_term` | text | NO | — |
| `commodity_category_id` | uuid | **NO** | — |
| `pad_category` | text | NO | — |
| `is_validated` | boolean | NO | `false` |
| `validated_by` | uuid | YES | — |
| `validated_at` | timestamptz | YES | — |
| `source_type` | text | NO | `'seed'` |
| `source_reference` | text | YES | — |
| `created_at` | timestamptz | NO | `now()` |
| `updated_at` | timestamptz | NO | `now()` |

> **Réserves Garde-fou n°2** :
> - **Pas de colonne `notes_operator`** confirmée — toute note opérateur devra passer par `source_reference` ou un autre mécanisme à valider en C.2-pre+3. Ne pas supposer.
> - `commodity_category_id` est **NOT NULL** : avant tout INSERT, C.2-pre+3 devra résoudre l'UUID de la `commodity_category` rattachée à T12 (à confirmer en lecture sur `commodity_categories` au moment de la migration).
> - Contraintes d'unicité (vraisemblablement sur `normalized_term` ou `(normalized_term, pad_category)`) à revérifier dans `pg_constraint` au moment de C.2-pre+3 — ne pas écrire `ON CONFLICT` à l'aveugle.

### 5.2 SQL DRAFT (à revérifier avant exécution)

```sql
-- DRAFT ONLY — DO NOT EXECUTE IN THIS LOT
-- À revérifier en Lot C.2-pre+3 :
--   1) UUID exact de la commodity_category cible (T12) via SELECT id FROM commodity_categories WHERE pad_category='T12'
--   2) Contraintes uniques réelles sur pad_designation_aliases (pg_constraint)
--   3) Existence éventuelle d'un mécanisme "note opérateur" (source_reference suffit normalement)
INSERT INTO public.pad_designation_aliases (
    bl_term,
    normalized_term,
    commodity_category_id,
    pad_category,
    is_validated,
    source_type,
    source_reference,
    validated_by,
    validated_at
)
VALUES (
    'carreaux',
    'carreaux',
    '<commodity_category_id_T12_a_resoudre_en_C2_pre_plus_3>'::uuid,
    'T12',
    true,
    'operator_validated',
    'LOT_C2_PRE_PLUS_2_OPERATOR_DECISION_PACK',
    '<operator_uuid_a_resoudre_en_C2_pre_plus_3>'::uuid,
    now()
);
-- DRAFT ONLY — DO NOT EXECUTE IN THIS LOT
```

### 5.3 Smoke test post-injection (à exécuter en Lot C.2-pre+3 séparé, pas ici)

1. Re-run de la requête de croisement C.2-pre : doit retourner ≥ 1 ligne pour `a5a58d25-…`.
2. Vérification idempotence : second INSERT doit lever ou no-op selon contrainte d'unicité.
3. Aucun effet de bord sur les 384 alias existants (count inchangé +1).

### 5.4 Pré-requis pour Lot C.2 v3 (resolver shadow)

- C.2-pre+3 effectué et smoke OK.
- GO CTO **explicite et séparé** pour activer `PAD_RESOLVER_SHADOW=true`.
- Rejeu de `a5a58d25-…` et capture des logs `PAD_SHADOW`.
- Comparaison `legacy inputs.padCategory` vs `resolver classification` documentée.

---

## 6. Hors scope (différé, lots futurs distincts)

- **24 familles `NO_PAD_MATCH_FOUND`** (Energy storage, Steel tubes, Wooden posts, Salt/sel, Avions jouets, Vehicles, Aluminium minerai, Raw Cashew Nuts, PET Flakes, Indian Pellets, Geomembranes, Used machine, Water equipment, General cargo, Power Generators, accumulator, Materiel electrique, rechange) → revue opérateur famille par famille en mini-lots data dédiés. **Pas dans ce lot.**
- **Lot C.2-pre+3** : migration `INSERT` ciblée si Option 1 retenue. GO CTO séparé.
- **Lot C.2 v3** : réactivation `PAD_RESOLVER_SHADOW` après enrichissement alias suffisant.
- **Lot D** : bascule resolver source de vérité. Interdit tant que C.2 v3 non concluant.

---

## 7. Garde-fous respectés (récapitulatif)

| Garde-fou CTO | Application |
|---|---|
| Reformulation Option 3 → NO-INSERT | ✅ § 3 |
| Seule l'Option 1 (OUI sans réserve) ouvre Lot C.2-pre+3 | ✅ § 3 + § 5 |
| SQL marqué `DRAFT ONLY — DO NOT EXECUTE IN THIS LOT` | ✅ § 5.2 |
| Pas d'hypothèse de colonne `notes_operator` | ✅ § 5.1 (réserve explicite) |
| Vérification colonnes/contraintes reportée à C.2-pre+3 | ✅ § 5.1 + § 5.2 |
| Historique formulé prudemment (`quote_facts` + `pricing_runs.inputs_json` + `outputs_json`) | ✅ § 4.2 (`historique non concluant` documenté) |
| Aucune injection, aucune migration, aucune écriture DB | ✅ |
| Aucun patch code, aucune Edge Function, aucun `config.toml` | ✅ |
| Aucune activation `PAD_RESOLVER_SHADOW`, aucun rejeu | ✅ |
| Aucune modification rapports C.2 / C.2-pre / C.2-pre+1 | ✅ |
| Aucune décision Lot D | ✅ |
| Aucune décision opérateur simulée | ✅ |

---

## 8. Verdict

**`LOT_C2_PRE_PLUS_2_OPERATOR_PACK_READY`** — pack publié, en attente de décision opérateur réelle. Aucune action runtime ni DB déclenchée.
