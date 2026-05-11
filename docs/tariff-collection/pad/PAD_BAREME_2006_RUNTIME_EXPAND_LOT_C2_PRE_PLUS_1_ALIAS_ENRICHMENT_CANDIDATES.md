# PAD-BAREME-2006-RUNTIME-EXPAND — Lot C.2-pre+1 : Candidats enrichissement alias (validation opérateur)

**Verdict :** `LOT_C2_PRE_PLUS_1_CANDIDATES_READY_FOR_OPERATOR_VALIDATION`
**Branche :** `work`
**Date :** 2026-05-11
**Mode :** lecture seule — préparation matière à validation opérateur
**Flag `PAD_RESOLVER_SHADOW`** : **non activé** (aucun rejeu effectué)

---

## Périmètre strict

- Lecture seule uniquement (`SELECT` + lecture CSV référentiels).
- Aucune insertion/update dans `pad_designation_aliases`, `commodity_designation_matches`, `commodity_categories`.
- Aucun patch code, aucune migration, aucune écriture DB.
- Pas d'activation `PAD_RESOLVER_SHADOW`, pas de rejeu, pas de décision Lot D.
- Aucune invention d'alias, marchandise, `pad_category` ou source documentaire.
- Aucune modification des rapports `LOT_C2_SHADOW_OBSERVATION` ni `LOT_C2_PRE_REPLAY_CANDIDATES`.
- Aucune `pad_category` proposée à partir d'un token isolé générique.

---

## Objectif

Suite au verdict `LOT_C2_PRE_BLOCKED_NO_ALIAS_CANDIDATE` (C.2-pre, 0 croisement entre les 25 dossiers conteneur et les 384 alias PAD validés), produire une **short-list de candidats à validation opérateur** pour enrichir `pad_designation_aliases` à partir des `cargo.description` réelles observées.

Aucune injection automatique. La validation opérateur reste un lot séparé (`Lot C.2-pre+2`).

---

## État des sources de référence (Garde-fou n°4)

Vérification d'existence préalable des sources :

| Source | Statut | Vérification |
|---|---|---|
| `pad_designation_aliases` (`is_validated=true`) | **available** | 384 lignes |
| `commodity_categories.designation_normalized` | **available** | Colonne présente (vérifiée via `information_schema.columns`). 19 lignes utilisables. |
| `PAD_2006_NOMENCLATURE_INJECTABLE_FINAL.csv` | **available** | 328 lignes injectables |
| `PAD_2006_ALIAS_CONFLICTS_OPUS.csv` | **available** | 2 conflits documentés (`alcool industriel` T07/T12, `sport` T01/T02) |

```sql
-- Vérification effectuée
SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public'
    AND table_name='commodity_categories'
    AND column_name='designation_normalized'
) AS has_column;
-- → true
```

> **Note** : `commodity_categories.designation_normalized` contient des **groupes haut niveau** (ex. *"Marchandises générales"*, *"Vracs secs et minéraux"*) plutôt que des termes marchandises bruts. Aucune description cargo conteneur n'a matché exactement cette source. Aucun candidat n'a été classé `commodity_reference_match` dans ce lot.

---

## Méthodologie

1. **Re-extraction** des 25 `cargo.description` conteneur identifiés en C.2-pre (`SEA_FCL_IMPORT` + `SEA_LCL_IMPORT`, `cargo.description` `is_current=true`).
2. **Normalisation legacy** (`normalizeForMatch`) : `lower` → NFD strip accents → collapse spaces.
3. **Tokenisation** (`extractTokens` + stop-words) : tokens ≥ 3 chars, hors mots logistiques :
   `container, containers, fcl, lcl, carton, cartons, pallet, pallets, bag, bags, box, boxes, unit, units, pcs, piece, pieces, en, de, la, le, les, et, ou, du, des, nda, nenda`.
4. **Cross-check** par priorité :
   - **Exact** sur `normalized_term` complet : alias, commodity_categories, nomenclature CSV.
   - **Near match** (substring bidirectionnelle, longueur ≥ 4 chars) : alias, nomenclature CSV — **uniquement si le terme matché n'est pas un token isolé générique** (`general, cargo, material, equipment, machine, system, products, divers, used, indian, wooden, steel, power, vehicle, energy, storage, core`).
5. **Détection conflits** :
   - **Listés** : terme matché ∈ `PAD_2006_ALIAS_CONFLICTS_OPUS.csv` → `IN_CONFLICT_ZONE`.
   - **Dynamiques** (Garde-fou n°5) : ≥ 2 sources proposent des `pad_category` distinctes pour la même description → `IN_CONFLICT_ZONE` même si non listé.

---

## Tableau principal — 25 dossiers conteneur

| case_id (8) | request_type | cargo.description | normalisée | tokens (post stop-words) | evidence_level | source(s) | pad_category | status |
|---|---|---|---|---|---|---|---|---|
| `03ccf66d` | SEA_FCL_IMPORT | Energy storage cabinet | energy storage cabinet | energy, storage, cabinet | `no_reference_match` | — | `null` | `NO_PAD_MATCH_FOUND` |
| `0edbc620` | SEA_FCL_IMPORT | STEEL TUBES | steel tubes | steel, tubes | `no_reference_match` | — | `null` | `NO_PAD_MATCH_FOUND` |
| `10ffeee7` | SEA_FCL_IMPORT | Salt (packed in 25 kg bags) | salt (packed in 25 kg bags) | salt, packed | `no_reference_match` | — | `null` | `NO_PAD_MATCH_FOUND` |
| `18accd26` | SEA_FCL_IMPORT | AVIONS (jouets) | avions (jouets) | avions, jouets | `no_reference_match` | — | `null` | `NO_PAD_MATCH_FOUND` |
| `240167ed` | SEA_FCL_IMPORT | Fortuner (Vehicle), Pickup (Vehicle) | fortuner (vehicle), pickup (vehicle) | fortuner, vehicle, pickup | `no_reference_match` | — | `null` | `NO_PAD_MATCH_FOUND` |
| `29b96eec` | SEA_FCL_IMPORT | BATTERY ENERGY STORAGE SYSTEM | battery energy storage system | battery, energy, storage, system | `no_reference_match` | — | `null` | `NO_PAD_MATCH_FOUND` |
| `31efcc01` | SEA_FCL_IMPORT | WOODEN POSTS | wooden posts | wooden, posts | `no_reference_match` | — | `null` | `NO_PAD_MATCH_FOUND` |
| `535fdd9d` | SEA_FCL_IMPORT | ALUMINIUM MINERAI (en vrac) | aluminium minerai (en vrac) | aluminium, minerai, vrac | `no_reference_match` | — | `null` | `NO_PAD_MATCH_FOUND` |
| `5514fedc` | SEA_FCL_IMPORT | WOODEN POSTS | wooden posts | wooden, posts | `no_reference_match` | — | `null` | `NO_PAD_MATCH_FOUND` |
| `5ab8d0ba` | SEA_FCL_IMPORT | Energy storage cabinet | energy storage cabinet | energy, storage, cabinet | `no_reference_match` | — | `null` | `NO_PAD_MATCH_FOUND` |
| `76c9819c` | SEA_FCL_IMPORT | Raw Cashew Nuts (RCN) | raw cashew nuts (rcn) | raw, cashew, nuts, rcn | `no_reference_match` | — | `null` | `NO_PAD_MATCH_FOUND` |
| `788ddc4c` | SEA_FCL_IMPORT | P.E.T Flakes // General cargo | p.e.t flakes // general cargo | flakes, general, cargo | `no_reference_match` | — | `null` | `NO_PAD_MATCH_FOUND` |
| `7eab135d` | SEA_FCL_IMPORT | INDIAN PELLETS Cereal Halloween Pellets | indian pellets cereal halloween pellets | indian, pellets, cereal, halloween | `no_reference_match` | — | `null` | `NO_PAD_MATCH_FOUND` |
| `7f7eb215` | SEA_FCL_IMPORT | core material, non hazardous | core material, non hazardous | core, material, hazardous | `no_reference_match` | — | `null` | `NO_PAD_MATCH_FOUND` |
| **`a5a58d25`** | **SEA_FCL_IMPORT** | **carreaux** | **carreaux** | **carreaux** | **`official_near_match_to_validate`** | **`pad_designation_aliases`** (`carreaux ceramiques` T12, `carreaux en ceramique` T12) | **T12** | **`TO_VALIDATE_OPERATOR`** |
| `b11f49d0` | SEA_FCL_IMPORT | geomembranes | geomembranes | geomembranes | `no_reference_match` | — | `null` | `NO_PAD_MATCH_FOUND` |
| `c47f0b50` | SEA_FCL_IMPORT | USED MACHINE (2ND HAND) | used machine (2nd hand) | used, machine, 2nd, hand | `no_reference_match` | — | `null` | `NO_PAD_MATCH_FOUND` |
| `d14b1e46` | SEA_FCL_IMPORT | water equipment | water equipment | water, equipment | `no_reference_match` | — | `null` | `NO_PAD_MATCH_FOUND` |
| `f2ba5d01` | SEA_FCL_IMPORT | sel | sel | sel | `no_reference_match` | — | `null` | `NO_PAD_MATCH_FOUND` |
| `f922d7ce` | SEA_FCL_IMPORT | General cargo | general cargo | general, cargo | `no_reference_match` | — | `null` | `NO_PAD_MATCH_FOUND` |
| `0963f6cf` | SEA_LCL_IMPORT | Power Generators | power generators | power, generators | `no_reference_match` | — | `null` | `NO_PAD_MATCH_FOUND` |
| `6d4d996f` | SEA_LCL_IMPORT | Power Generators | power generators | power, generators | `no_reference_match` | — | `null` | `NO_PAD_MATCH_FOUND` |
| `7f935002` | SEA_LCL_IMPORT | accumulator | accumulator | accumulator | `no_reference_match` | — | `null` | `NO_PAD_MATCH_FOUND` |
| `ab959454` | SEA_LCL_IMPORT | MATERIEL ELECTRIQUE | materiel electrique | materiel, electrique | `no_reference_match` | — | `null` | `NO_PAD_MATCH_FOUND` |
| `acddafa7` | SEA_LCL_IMPORT | rechange (circuit de contrôle et batteries) | rechange (circuit de controle et batteries) | rechange, circuit, controle, batteries | `no_reference_match` | — | `null` | `NO_PAD_MATCH_FOUND` |

---

## Métriques agrégées

| Niveau / statut | Nombre |
|---|---|
| `official_exact_match` | 0 |
| `official_near_match_to_validate` | **1** |
| `commodity_reference_match` | 0 |
| `no_reference_match` | 24 |
| `conflict_zone` (listé) | 0 |
| `conflict_zone` (dynamique multi-sources) | 0 |
| **Total candidats `TO_VALIDATE_OPERATOR`** | **1** |
| **Total `NO_PAD_MATCH_FOUND`** | **24** |
| **Total `IN_CONFLICT_ZONE`** | **0** |

---

## Section A — Candidats à valider opérateur (`TO_VALIDATE_OPERATOR`)

### Candidat unique : `carreaux` → **T12**

| Champ | Valeur |
|---|---|
| `case_id` | `a5a58d25-7e9d-4884-9ba9-2bf3f631a302` |
| `request_type` | `SEA_FCL_IMPORT` |
| `cargo.description` (brut) | `carreaux` |
| Normalisée | `carreaux` |
| `evidence_level` | `official_near_match_to_validate` |
| Alias proches matchés | `carreaux ceramiques` (T12), `carreaux en ceramique` (T12) |
| `pad_category` proposé | **T12** |
| Justification | Substring du cargo `carreaux` est inclus dans 2 alias validés existants, tous deux pointant vers T12. Pas de conflit listé, pas de conflit multi-sources (1 seule `pad_category` = T12). |
| Conflit détecté | Aucun |
| **Action opérateur recommandée** | Valider qu'un alias supplémentaire `carreaux` → `T12` peut être créé (le cargo brut "carreaux" sans qualificatif "ceramiques" est-il toujours T12 ? Si certains "carreaux" peuvent être en autre matériau avec catégorie différente, ne pas injecter et demander précision client.) |

> ⚠️ **Réserve forte** : `carreaux` seul est polysémique. Les 2 alias actuels qualifient explicitement la matière (céramique). Une validation opérateur doit confirmer qu'aucune autre famille `carreaux` (verre, pierre, métal, etc.) n'apparaît en pratique avec une `pad_category` différente avant injection.

---

## Section B — Sans match exploitable (`NO_PAD_MATCH_FOUND`)

24 dossiers sur 25. Aucune `pad_category` ne peut être proposée sans risque.

Catégories observées (à enrichir via mini-lot data séparé après validation opérateur, pas dans ce lot) :

| Famille observée | Exemples cargo | Aliases manquants probables (à valider opérateur) |
|---|---|---|
| Stockage énergie / batteries | Energy storage cabinet (×2), BATTERY ENERGY STORAGE SYSTEM, accumulator | Pas d'alias existant pour `battery / accumulator / energy storage` |
| Tubes / aciers EN | STEEL TUBES | Alias FR existants (`tubes acier` T12) — **pont EN→FR à proposer** |
| Sel / Salt | Salt (packed in 25 kg bags), sel | `commodity_categories.designation_normalized` = "Sel de production locale" T10 (groupe haut niveau, non utilisable comme alias direct) |
| Aviation jouets | AVIONS (jouets) | Conflit potentiel : `avion helicoptere embarcation` T09 (transport réel) vs jouets (T02 ?) — **arbitrage opérateur requis** |
| Véhicules | Fortuner (Vehicle), Pickup (Vehicle) | Aliases existants `tracteurs agricoles`, `vehicules industriels` T09 — pickup commercial ≠ industriel |
| Bois | WOODEN POSTS (×2) | Alias FR `poteaux bois` T04 — **pont EN→FR à proposer** |
| Minerais | ALUMINIUM MINERAI (en vrac) | Pas d'alias `aluminium` ou `minerai` |
| Noix | Raw Cashew Nuts (RCN) | Pas d'alias |
| PET / plastique | P.E.T Flakes // General cargo | Pas d'alias |
| Pellets | INDIAN PELLETS Cereal Halloween Pellets | Pas d'alias |
| Géomembranes | geomembranes | Pas d'alias |
| Machines occasion | USED MACHINE (2ND HAND) | Pont EN avec `tracteur d'occasion` T09 ? Ambigu |
| Eau / équipement eau | water equipment | Pas d'alias |
| General cargo | General cargo, P.E.T Flakes // General cargo | Devrait pointer vers T13 (groupage) — **à confirmer opérateur** |
| Generators | Power Generators (×2) | Pas d'alias |
| Matériel électrique | MATERIEL ELECTRIQUE | Très générique, conflit potentiel T01/T02 |
| Pièces détachées | rechange (circuit de contrôle et batteries) | Alias `pieces detachees de machines et appareils` T02 — pont à proposer |

> **Recommandation** : ces familles ne doivent PAS faire l'objet d'une injection automatique. Un mini-lot data séparé devra présenter chaque famille à validation opérateur, avec :
> - décision d'injection ou de rejet (si polysémique) ;
> - choix `pad_category` ;
> - éventuels ponts EN→FR à formaliser.

---

## Section C — Zone de conflit (`IN_CONFLICT_ZONE`)

**Aucune** description conteneur observée dans ce lot ne tombe dans :
- les conflits listés `PAD_2006_ALIAS_CONFLICTS_OPUS.csv` (`alcool industriel`, `sport`) ;
- un conflit multi-sources détecté dynamiquement (Garde-fou n°5).

---

## Verdict

**`LOT_C2_PRE_PLUS_1_CANDIDATES_READY_FOR_OPERATOR_VALIDATION`**

- 1 candidat propre `TO_VALIDATE_OPERATOR` hors zone de conflit (`carreaux` → T12).
- 24 dossiers en `NO_PAD_MATCH_FOUND` — matière à enrichissement futur (mini-lot data séparé après validation opérateur).
- 0 zone de conflit.

---

## Recommandations (sans décision)

1. **Lot C.2-pre+2** (séparé, GO CTO requis) : présenter le candidat `carreaux` → T12 à un opérateur. Si validé sans réserve, injecter via migration ciblée `INSERT` dans `pad_designation_aliases` avec `source_type = 'operator_validated'`.
2. **Mini-lot data parallèle** : pour les 24 `NO_PAD_MATCH_FOUND`, organiser une revue opérateur famille par famille. Plusieurs ponts EN↔FR évidents (`steel tubes`, `wooden posts`, `salt`, `pickup`) pourraient être formalisés mais **uniquement après confirmation opérateur**, jamais automatiquement.
3. **Conflit potentiel à surveiller** : `AVIONS (jouets)` — les jouets relèvent vraisemblablement d'une catégorie différente du transport aéronautique (alias actuel `avion helicoptere embarcation` T09). À ne pas inscrire comme conflit listé tant que non documenté dans `PAD_2006_ALIAS_CONFLICTS_OPUS.csv`.
4. **Ne pas activer `PAD_RESOLVER_SHADOW=true`** tant qu'aucun alias supplémentaire n'a été injecté — le seul candidat actuel (`carreaux`) ne suffit pas à valider une couverture représentative du portefeuille conteneur.

---

## Garde-fous respectés

- ✅ Lecture seule uniquement (SELECT + lecture CSV)
- ✅ Aucune insertion/update DB
- ✅ Aucun patch code, aucune migration
- ✅ Aucune activation `PAD_RESOLVER_SHADOW`
- ✅ Aucun rejeu de dossier
- ✅ Aucune `pad_category` proposée depuis un token isolé générique
- ✅ Aucun choix automatique en cas de conflit (aucun conflit détecté ici)
- ✅ Vérification d'existence préalable `commodity_categories.designation_normalized`
- ✅ Détection de conflits multi-sources dynamique appliquée (0 trouvé)
- ✅ Aucune décision Lot D
- ✅ Aucune modification des rapports `LOT_C2_SHADOW_OBSERVATION` / `LOT_C2_PRE_REPLAY_CANDIDATES`
- ✅ Aucune invention d'alias, marchandise, source ou colonne DB

---

## Hors scope (différé)

- Injection effective des alias validés opérateur → `Lot C.2-pre+2` séparé.
- Réactivation `PAD_RESOLVER_SHADOW` et rejeu C.2 v3 → après injection alias.
- Décision Lot D (bascule resolver source de vérité) → après C.2 v3 concluant.
