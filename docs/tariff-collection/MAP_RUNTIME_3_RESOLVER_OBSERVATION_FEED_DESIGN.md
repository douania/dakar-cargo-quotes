# MAP-RUNTIME-3 — Design observation-only d’alimentation réelle du resolver PAD

**Repo** : `douania/dakar-cargo-quotes`  
**Branche cible** : `work`  
**Date** : 2026-05-16  
**Mode** : design-only / documentation-only  
**Verdict** : `MAP_RUNTIME_3_RESOLVER_OBSERVATION_FEED_DESIGN_READY_NO_PATCH`

---

## 0. Statut d’exécution

Ce lot définit le design CTO pour alimenter réellement le resolver PAD existant en mode observation-only.

Aucun patch runtime n’est exécuté dans ce lot.

Périmètre respecté :

- aucun changement `src/` ;
- aucun changement `supabase/functions/` ;
- aucune migration ;
- aucun changement `supabase/config.toml` ;
- aucun insert / update / delete DB ;
- aucun dossier client touché ;
- aucun composant FROZEN modifié ;
- aucun appel Lovable Agent ;
- aucun SELECT DB live nouveau.

---

## 1. Objectif

L’objectif est de préparer une future alimentation observation-only de :

```text
supabase/functions/_shared/pad/resolvePadClassification.ts
```

avec les vraies données disponibles :

```text
quote_facts
pad_designation_aliases
nst_cn_mappings
nst_nhm_mappings
nstr_nst2007_mappings
nst_cpa_mappings
pad_nst_recommendation_rules
```

Le but n’est pas encore de calculer une ligne tarifaire. Le but est de produire un diagnostic non compté :

```text
input observé
→ contexte resolver construit
→ catégorie PAD candidate éventuelle
→ source / confiance / warnings
→ aucun montant
→ aucun total modifié
→ aucune création de fact
```

---

## 2. Sources relues

### Documents

- `docs/tariff-collection/MAP_RUNTIME_2_UPSTREAM_CN_NHM_NST_PAD_AUDIT.md`
- `docs/tariff-collection/MAPPING_TAX_CHAIN_0_AUDIT_V2.md`
- `docs/tariff-collection/MAPPING_TAX_CHAIN_2_TAXE_PORT_ALIAS_DESIGN.md`
- `docs/tariff-collection/MAP_8B_RUNTIME_SMOKE_LIMITS_AND_EVIDENCE.md`
- `docs/tariff-collection/pad/PAD_NST_2E_B_R3_FORENSIC_REPORT.md`

### Code

- `supabase/functions/run-pricing/index.ts`
- `supabase/functions/_shared/pad/resolvePadClassification.ts`
- `supabase/functions/_shared/pad/types.ts`

---

## 3. Faits vérifiés repris de MAP-RUNTIME-2

### 3.1 Chaîne aval déjà cadrée

La chaîne aval actuelle reste :

```text
cargo.pad_category
→ cargo.pad_rate_fcfa_per_ton
→ run-pricing
→ PAD_DROIT_PASSAGE
```

Cette chaîne ne doit pas être modifiée par MAP-RUNTIME-3.

### 3.2 Chaîne amont dormante

MAP-RUNTIME-2 confirme que les bridges amont existent selon les rapports précédents, mais restent dormants côté runtime principal :

```text
nst_cn_mappings
nst_nhm_mappings
nstr_nst2007_mappings
nst_cpa_mappings
```

Le shadow actuel de `run-pricing` appelle le resolver avec :

```text
nstRules: []
hsToNstMapping: []
designationMatches: []
```

Il ne prouve donc pas la chaîne :

```text
HS/CN/NHM/NSTR/NST → PAD
```

### 3.3 Le resolver existe déjà

Le resolver pur existe déjà et impose des garde-fous :

```text
- aucune lecture DB ;
- aucun appel réseau ;
- ne calcule jamais de montant ;
- ne lit jamais port_tariffs ;
- canonical_rate_family = DROIT_PASSAGE ;
- PORT_TAX n’est jamais retourné comme famille canonique ;
- HS → NST uniquement via context.hsToNstMapping explicite.
```

Conclusion : MAP-RUNTIME-3 ne doit pas créer un nouveau resolver. Il doit définir comment nourrir proprement celui qui existe.

---

## 4. Principe d’architecture

### 4.1 Design retenu

Créer plus tard un **feeder observation-only** autour du resolver existant.

Le feeder est responsable de :

```text
1. lire les facts courants du dossier ;
2. construire ResolvePadInput ;
3. lire les tables de référence nécessaires ;
4. construire ResolvePadContext ;
5. appeler resolvePadClassification(input, context) ;
6. journaliser le résultat ;
7. ne rien modifier dans les montants ni dans les facts métier.
```

### 4.2 Emplacement futur recommandé

Le premier branchement futur doit être dans le bloc `PAD_SHADOW` existant de `run-pricing`, car ce bloc est déjà :

```text
- observation-only ;
- OFF par défaut via PAD_RESOLVER_SHADOW ;
- non bloquant ;
- limité au périmètre import conteneur.
```

Ce choix évite de créer une nouvelle Edge Function et réduit le risque de pipeline parallèle.

### 4.3 Aucun moteur parallèle

NO-GO : créer un deuxième resolver `codeToPad`, `hsNstResolver`, `mapRuntimeResolver` ou équivalent.

Le moteur canonique reste :

```text
resolvePadClassification(input, context)
```

---

## 5. Données d’entrée à construire

### 5.1 ResolvePadInput cible

Le feeder doit construire un objet `ResolvePadInput` à partir des facts existants :

```text
known_pad_category  ← cargo.pad_category si déjà confirmé
hs_code             ← cargo.hs_code
cn_code             ← commodity.cn_code si futur fact disponible
nhm_code            ← commodity.nhm_code si futur fact disponible
nstr_code           ← commodity.nstr_code si futur fact disponible
nst_code            ← commodity.nst_code si futur fact disponible
designation         ← cargo.description / cargo.goods_description / description utilisée par run-pricing
invoice_label       ← null au départ sauf ingestion facture dédiée
operation_type      ← IMPORT pour le premier périmètre
cargo_type          ← CONTENEUR pour le premier périmètre
container_size      ← null au départ, sauf cas transit/transbordement T13 futur
ai_suggestion       ← null en observation runtime initiale
```

### 5.2 Périmètre initial strict

Le premier mode observation réelle doit rester limité à :

```text
operation_type = IMPORT
cargo_type = CONTENEUR
non export
non transit
non transbordement
maritime uniquement
```

Le transit, l’export, le transbordement, les C01/C02/C03 et T13 doivent rester hors périmètre du premier branchement.

### 5.3 Priorité des pivots

Ordre recommandé :

```text
1. known_pad_category déjà présent
2. cn_code explicite si disponible
3. nhm_code explicite si disponible
4. hs_code explicite si bridge fiable confirmé
5. nst_code explicite si disponible
6. nstr_code explicite uniquement en TO_REVIEW
7. designation alias exact validé
8. ai_suggestion = null dans ce lot
```

Note : `cargo.hs_code` est actif aujourd’hui, mais le mapping exact HS10 → NST n’est pas encore prouvé. Il ne faut pas inventer un découpage HS10 → CN8.

---

## 6. Construction de ResolvePadContext

### 6.1 aliases

Source cible :

```text
pad_designation_aliases
```

Mode initial recommandé :

```text
- limiter à normalized_term = normalize(cargoDescription) ;
- is_validated = true ;
- alias_kind = designation ;
- ne pas utiliser invoice_label comme source classifiante.
```

Rappel : les alias facture “taxe de port” servent à reconnaître `DROIT_PASSAGE`, mais ne classifient jamais seuls une catégorie T/P/C.

### 6.2 hsToNstMapping

Le resolver attend un tableau de type :

```text
source_code
source_kind = hs | cn | nhm
nst_code
nst_level
pad_category
is_unique
```

Le feeder futur doit produire ce tableau à partir des bridges disponibles.

#### CN

Source cible :

```text
nst_cn_mappings
```

Règle :

```text
cn_code explicite → nst_group_code → pad_nst_recommendation_rules
```

Condition GO future : confirmer les noms exacts des colonnes par SELECT live ou types Supabase avant patch.

#### NHM

Source cible :

```text
nst_nhm_mappings
```

Règle :

```text
nhm_code explicite → nst_group_code → pad_nst_recommendation_rules
```

Condition GO future : vérifier que des documents SODATRA contiennent réellement des NHM exploitables. Sinon NHM reste secondaire.

#### HS

Source actuelle :

```text
cargo.hs_code
```

Risque : `resolvePadClassification` interdit d’inventer HS10 → CN8 / chapitre HS.

Donc deux options restent ouvertes :

```text
Option H1 — disposer d’une vraie table hs10→nst ;
Option H2 — documenter que cargo.hs_code ne nourrit pas hsToNstMapping tant qu’aucune table explicite n’existe.
```

MAP-RUNTIME-3 recommande H2 par défaut tant que H1 n’est pas prouvée.

### 6.3 nstRules

Source cible :

```text
pad_nst_recommendation_rules
```

Mode initial :

```text
- filtrer is_active = true ;
- matcher nst_code exact ;
- conserver toutes les règles candidates ;
- ne pas convertir candidate en official ;
- respecter requires_operator_validation.
```

Conséquence : même si une seule catégorie PAD ressort, le résultat initial doit rester proposition / observation, pas montant compté.

### 6.4 designationMatches

Source possible :

```text
commodity_categories
ou table dédiée future si disponible
```

Statut : optionnel pour le premier feeder.

Recommandation : ne pas intégrer `designationMatches` dans le premier patch observation-only tant qu’une source exacte et validée n’est pas auditée.

### 6.5 containerSizeToCxxMapping

Statut : hors périmètre initial.

À réserver au transit / transbordement T13, après design dédié.

---

## 7. Format de sortie observation-only

Le feeder doit produire un diagnostic structuré, jamais une ligne comptée.

Format recommandé :

```json
{
  "tag": "PAD_RESOLVER_OBSERVATION",
  "version": "MAP-RUNTIME-3",
  "case_id": "...",
  "scope": "IMPORT/CONTENEUR",
  "input": {
    "designation_present": true,
    "known_pad_category": "T12",
    "hs_code_present": true,
    "cn_code_present": false,
    "nhm_code_present": false,
    "nst_code_present": false,
    "nstr_code_present": false
  },
  "context_counts": {
    "aliases": 0,
    "hsToNstMapping": 0,
    "nstRules": 0,
    "designationMatches": 0
  },
  "resolver": {
    "classification": "T12",
    "source": "operator_confirmed",
    "confidence": 1.0,
    "needs_human_review": false,
    "blocking_gap": null,
    "warnings": []
  },
  "policy": {
    "amount_policy": "DO_NOT_COUNT_FROM_OBSERVATION",
    "creates_fact": false,
    "modifies_total": false
  }
}
```

### Où journaliser ?

Phase initiale recommandée :

```text
console.log(JSON.stringify(...))
```

Pas de table nouvelle.
Pas de timeline event au premier patch.
Pas de fact nouveau.

Raison : limiter la surface de régression et éviter une migration.

Une phase ultérieure pourra créer un événement timeline `pad_resolver_observation_v1` si un besoin d’audit persistant est validé.

---

## 8. Politique de montant

Règle absolue :

```text
MAP-RUNTIME-3 ne calcule aucun montant.
```

Le feeder peut observer une catégorie PAD candidate, mais il ne doit jamais créer :

```text
PAD_DROIT_PASSAGE amount > 0
cargo.pad_rate_fcfa_per_ton
pricing line counted
```

Seul le flux validé existant doit produire le montant :

```text
operator confirmation / candidate accepted
→ propagate_classification_candidate_to_fact
→ cargo.pad_category
→ cargo.pad_rate_fcfa_per_ton
→ run-pricing
→ PAD_DROIT_PASSAGE
```

---

## 9. Politique d’ambiguïté

### CN / NHM

Si un code explicite mène à un NST unique puis à une seule catégorie PAD candidate :

```text
source = hs_to_nst ou nst_rule
needs_human_review = true si la règle NST→PAD l’exige
amount_policy = DO_NOT_COUNT_FROM_OBSERVATION
```

### NST multi-PAD

Si plusieurs catégories PAD ressortent :

```text
classification = null
blocking_gap = pricing.pad_classification_needs_review
needs_human_review = true
```

### NSTR

NSTR est toujours prudent :

```text
source = nst_rule ou none selon convergence
needs_human_review = true
confidence ≤ 0.5 recommandé
```

Aucun auto-pricing NSTR.

### HS sans mapping explicite

Si seul `cargo.hs_code` est disponible mais aucune table explicite HS/CN/NHM → NST ne peut être construite :

```text
ne pas appeler cela hs_to_nst réussi
context.hsToNstMapping = []
resolver doit retourner gap ou fallback alias/opérateur
```

---

## 10. Plan futur recommandé

### MAP-RUNTIME-4 — SELECT live ciblé des bridges

Objectif : vérifier les colonnes exactes et 5 exemples par table :

```text
nst_cn_mappings
nst_nhm_mappings
nstr_nst2007_mappings
nst_cpa_mappings
pad_nst_recommendation_rules
```

Questions à trancher :

```text
- peut-on matcher cargo.hs_code sur une colonne existante ?
- cn_code est-il CN8 ou CN10 dans la table ?
- quel champ exact porte le NST group ?
- quelles règles NST→PAD exigent revue ?
- comment identifier les NST multi-PAD ?
```

### MAP-RUNTIME-5 — Patch observation-only minimal

Périmètre futur si MAP-RUNTIME-4 PASS :

```text
- modifier uniquement le bloc PAD_SHADOW de run-pricing ;
- charger contexte réel minimal ;
- appeler resolvePadClassification ;
- log JSON structuré ;
- aucun montant ;
- aucune mutation DB ;
- aucun changement de totals.
```

### MAP-RUNTIME-6 — UI opérateur / candidate flow

Seulement après shadow probant.

Objectif : transformer un résultat observation-only fiable en proposition opérateur, sans montant :

```text
PAD category candidate
→ affichage opérateur
→ validation humaine
→ propagation existante
```

---

## 11. Tests futurs indispensables

### T1 — Aucun contexte réel

`hsToNstMapping = []`, `nstRules = []`, `aliases = []`.

Attendu : résultat identique au shadow actuel, aucun montant, aucun effet.

### T2 — Alias exact legacy

Désignation exacte présente dans `pad_designation_aliases`.

Attendu : comportement legacy inchangé.

### T3 — CN explicite unique

CN explicite → NST unique → une seule PAD candidate.

Attendu : observation candidate, aucune ligne comptée.

### T4 — NST multi-PAD

NST → plusieurs PAD candidates.

Attendu : revue opérateur, aucun montant.

### T5 — NSTR ambigu

NSTR → plusieurs NST / plusieurs PAD.

Attendu : revue opérateur, aucun montant.

### T6 — HS sans table explicite

`cargo.hs_code` présent, mais aucune correspondance explicite utilisable.

Attendu : pas de dérivation arbitraire, aucun montant.

### T7 — Aval inchangé

Si `cargo.pad_category` et `cargo.pad_rate_fcfa_per_ton` existent déjà, `run-pricing` continue à produire `PAD_DROIT_PASSAGE` comme avant.

---

## 12. Risques

### R1 — Auto-pricing prématuré

Brancher les mappings dans `run-pricing` pourrait être interprété comme permission de produire un montant. Mitigation : observation-only, `amount_policy = DO_NOT_COUNT_FROM_OBSERVATION`.

### R2 — HS10 mal interprété

Risque de dériver CN8 depuis HS10 par découpage. Mitigation : interdit par le resolver ; mapping explicite obligatoire.

### R3 — NSTR ambigu

Risque élevé de mauvaise catégorie PAD. Mitigation : NSTR jamais auto-pricing.

### R4 — Écrasement du legacy alias

Le comportement actuel par alias exact validé fonctionne. Mitigation : shadow seulement, aucune mutation.

### R5 — Pollution logs

Le log observation peut devenir verbeux. Mitigation : garder `PAD_RESOLVER_SHADOW` OFF par défaut et limiter le scope import conteneur.

---

## 13. Conditions GO / NO-GO

### GO conceptuel

```text
- réutiliser resolvePadClassification ;
- alimenter par contexte réel ;
- rester observation-only ;
- ne créer aucun montant ;
- ne modifier aucun fact ;
- ne modifier aucun total ;
- limiter initialement à import conteneur ;
- passer par SELECT live ciblé avant patch.
```

### NO-GO

```text
- créer un nouveau resolver parallèle ;
- brancher directement CN/NHM/NST vers PAD_DROIT_PASSAGE compté ;
- utiliser une suggestion IA/web pour calculer une taxe ;
- déduire HS10 → CN8 sans table explicite ;
- activer NSTR en automatique ;
- créer PORT_TAX IMPORT ;
- modifier quotation-engine FROZEN pour ce besoin.
```

---

## 14. Verdict final

```text
MAP_RUNTIME_3_RESOLVER_OBSERVATION_FEED_DESIGN_READY_NO_PATCH
```

Décision CTO :

```text
Le prochain vrai travail technique n’est pas un patch runtime.
Il faut d’abord lancer MAP-RUNTIME-4 : SELECT live ciblé des bridges CN/NHM/NSTR/NST/PAD pour valider les colonnes, les exemples et la faisabilité de l’alimentation contextuelle.
```

Aucune exécution technique n’est ouverte par ce rapport sans GO CTO séparé.
