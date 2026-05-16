# MAP-RUNTIME-2 — Audit read-only amont CN/NHM/NST/PAD

**Repo** : `douania/dakar-cargo-quotes`  
**Branche cible** : `work`  
**Date** : 2026-05-16  
**Mode** : audit statique / documentation-only  
**Verdict** : `MAP_RUNTIME_2_UPSTREAM_AUDIT_READY_NO_PATCH`

---

## 0. Statut d'exécution

Ce lot audite la partie amont de la chaîne de détermination du droit de passage :

```text
Désignation / codes structurés
→ HS / CN / NHM / CPA / NSTR
→ NST 2007
→ catégorie PAD candidate
→ validation opérateur
→ cargo.pad_category
→ cargo.pad_rate_fcfa_per_ton
→ PAD_DROIT_PASSAGE
```

Périmètre respecté :

- aucun changement `src/` ;
- aucun changement `supabase/functions/` ;
- aucune migration ;
- aucun changement `supabase/config.toml` ;
- aucun insert / update / delete DB ;
- aucun dossier client touché ;
- aucun composant FROZEN modifié ;
- aucun appel Lovable Agent ;
- aucun SELECT DB live nouveau dans ce lot.

Ce document s'appuie sur l'état GitHub `work` et sur les rapports déjà versionnés. Les mesures DB live reprises proviennent de `MAPPING_TAX_CHAIN_0_AUDIT_V2.md`, pas d'un SELECT nouveau.

---

## 1. Sources relues

### Documents GitHub

- `docs/tariff-collection/MAPPING_TAX_CHAIN_0_AUDIT_V2.md`
- `docs/tariff-collection/MAPPING_TAX_CHAIN_2_TAXE_PORT_ALIAS_DESIGN.md`
- `docs/tariff-collection/MAP_8B_RUNTIME_SMOKE_LIMITS_AND_EVIDENCE.md`
- `docs/tariff-collection/pad/PAD_R1_AUDIT_AND_PLAN.md`
- `docs/tariff-collection/pad/PAD_NST_2E_B_R3_FORENSIC_REPORT.md`

### Code GitHub

- `supabase/functions/run-pricing/index.ts`
- `supabase/functions/_shared/pad/resolvePadClassification.ts`
- `supabase/functions/_shared/pad/types.ts`

### Input externe non canonique

Le rapport externe `MAP-RUNTIME-1 — Rapport d’architecture pour l’acheminement « Désignation → DROIT_PASSAGE »` a été traité comme input stratégique seulement. Il ne remplace pas les fichiers GitHub `work` ni les rapports déjà versionnés.

---

## 2. Faits vérifiés — état actuel de la chaîne

### 2.1 La chaîne aval est déjà cadrée

MAP-8B a documenté le maillon aval :

```text
cargo.pad_category
→ cargo.pad_rate_fcfa_per_ton
→ run-pricing
→ PAD_DROIT_PASSAGE
```

`MAPPING_TAX_CHAIN_2_TAXE_PORT_ALIAS_DESIGN.md` indique que le wrapper `public.propagate_classification_candidate_to_fact(uuid,text)` matérialise `cargo.pad_rate_fcfa_per_ton` depuis `port_tariffs` avec le filtre strict :

```text
provider = PAD
category = DROIT_PASSAGE
operation_type = IMPORT
cargo_type = CONTENEUR
classification = <pad_category>
is_active = true
```

Limitation documentée : import conteneur standard.

### 2.2 Le runtime sait produire `PAD_DROIT_PASSAGE` si les facts sont présents

`run-pricing/index.ts` consomme :

```text
cargo.pad_category → inputs.padCategory
cargo.pad_rate_fcfa_per_ton → inputs.padRateFcfaPerTon
```

La ligne `PAD_DROIT_PASSAGE` est émise seulement si :

```text
inputs.padCategory présent
inputs.padRateFcfaPerTon > 0
poids > 0
```

Le smoke runtime a cependant été clôturé comme limité par gouvernance/outillage : la preuve de propagation depuis zéro n'a pas été obtenue, mais aucun échec fonctionnel MAP-8B n'a été établi.

### 2.3 La chaîne amont CN/NHM/NSTR/NST reste dormante côté runtime principal

`MAPPING_TAX_CHAIN_0_AUDIT_V2.md` conclut que la chaîne automatique complète :

```text
CN / NHM / NSTR → NST → PAD → taxe portuaire
```

reste **NON automatique**.

État V2 documenté :

```text
cargo.hs_code : pivot actif
cargo.pad_category : pivot actif
commodity.cn_code : 0 fact, wrapper refuse cn8
commodity.nhm_code : 0 fact, wrapper refuse nhm
commodity.nst_code : 0 fact, wrapper refuse nst2007
commodity.nstr_code : 0 fact, wrapper refuse nstr
```

Les tables bridges `nst_cn_mappings`, `nst_nhm_mappings`, `nstr_nst2007_mappings` et `nst_cpa_mappings` sont documentées comme dormantes côté code applicatif.

### 2.4 Les mesures DB reprises de MAPPING-TAX-CHAIN-0 V2

Mesures documentées dans le rapport V2 :

| Table / mapping | État documenté |
|---|---:|
| `nst_divisions` | 20 |
| `nst_groups` | 73 |
| `nst_cn_mappings` | 9 762 |
| `nst_nhm_mappings` | 15 079 |
| `nstr_nst2007_mappings` | 9 781 dont 5 quarantine |
| `nst_cpa_mappings` | 1 759 |
| `pad_nst_recommendation_rules` | 88 règles actives |
| `pad_designation_aliases` | 384 |
| `port_tariffs` | 218 lignes actives |

Ces chiffres n'ont pas été re-mesurés dans MAP-RUNTIME-2. Ils sont repris comme source GitHub déjà documentée.

### 2.5 Unicité / ambiguïté documentée

Selon `MAPPING_TAX_CHAIN_0_AUDIT_V2.md` :

| Mapping | Unicité documentée | Verdict |
|---|---:|---|
| `cn_code → nst_group_code` | 100,0 % | déterministe côté table |
| `nhm_code → nst_group_code` | 100,0 % | déterministe côté table |
| `nstr_code → nst2007_code` | 52,6 % unique | 47,4 % ambigu |
| `nst_code → pad_category` | 81,1 % unique | 18,9 % ambigu |

Conclusion : CN/NHM sont de bons candidats si un code structuré fiable est disponible. NSTR ne peut pas être une voie automatique principale.

### 2.6 Les règles NST → PAD sont des recommandations, pas des vérités OFFICIAL

`PAD_NST_2E_B_R3_FORENSIC_REPORT.md` confirme que la table `pad_nst_recommendation_rules` a été réalignée en DB réelle avec 88 règles. Les contrôles post-R3 sont passés : count 88, extras 0, manquants 0, hash conforme, règles actives, pas d'orphelin `group|15.1|T02`.

Mais les contrôles indiquent aussi :

```text
validation_status = candidate
requires_operator_validation = true
```

pour l'ensemble des règles finales contrôlées.

Conclusion : `pad_nst_recommendation_rules` ne doit pas être utilisée pour produire directement une ligne OFFICIAL comptée. Elle doit produire une proposition opérateur, sauf futur arbitrage documenté plus strict.

### 2.7 Le resolver PAD existe déjà, mais il n'est pas alimenté par les vraies tables en runtime

`resolvePadClassification.ts` existe et impose les garde-fous suivants :

```text
- aucune lecture DB ;
- aucun appel réseau ;
- aucune dépendance React/DOM ;
- ne calcule jamais de montant ;
- ne lit jamais port_tariffs ;
- canonical_rate_family = DROIT_PASSAGE ;
- PORT_TAX n'est jamais retourné comme famille canonique ;
- HS → NST uniquement via context.hsToNstMapping explicite ;
- pas de découpage HS10 → CN8 / chapitre HS hardcodé.
```

`types.ts` montre que le resolver accepte déjà les pivots :

```text
hs_code
cn_code
nhm_code
nstr_code
nst_code
```

et un contexte injecté :

```text
aliases
nstRules
designationMatches
hsToNstMapping
containerSizeToCxxMapping
```

Donc le resolver cible existe déjà. Le problème n'est pas l'absence de moteur pur, mais l'absence d'alimentation runtime contrôlée de ce moteur.

### 2.8 Le shadow actuel ne prouve pas la chaîne amont

Dans `run-pricing`, le bloc `PAD_SHADOW` appelle `resolvePadClassification` mais avec :

```text
nstRules: []
hsToNstMapping: []
designationMatches: []
```

Donc le shadow actuel compare surtout le comportement legacy alias/opérateur. Il ne teste pas réellement :

```text
HS/CN/NHM → NST → PAD
```

---

## 3. Analyse CTO — ce qu'il faut accepter / refuser

### 3.1 Accepté

- Les codes structurés explicitement présents dans des documents doivent être prioritaires sur une désignation libre.
- CN et NHM sont des voies fortes si le code est explicitement fourni et si le mapping exact vers NST est confirmé.
- NSTR doit rester une voie secondaire, opérateur-obligatoire, à cause de l'ambiguïté forte.
- NST → PAD doit produire une proposition, pas un montant OFFICIAL automatique, tant que les règles restent `candidate` et `requires_operator_validation=true`.
- `resolvePadClassification.ts` doit être réutilisé ; il ne faut pas créer un moteur parallèle.
- La chaîne doit rester observation-only avant toute activation.

### 3.2 Refusé / NO-GO

- Calculer une taxe de port depuis une simple suggestion IA/web.
- Déduire automatiquement CN/NST depuis un HS10 par découpage arbitraire.
- Brancher NSTR en auto-pricing.
- Transformer une règle `pad_nst_recommendation_rules` candidate en montant OFFICIAL sans validation opérateur.
- Ajouter des colonnes directes sans audit schéma ; privilégier d'abord `quote_facts` / candidates.
- Créer `PORT_TAX IMPORT` pour résoudre le problème : la famille canonique reste `DROIT_PASSAGE` / `PAD_DROIT_PASSAGE` pour l'import conteneur standard.

---

## 4. Architecture cible recommandée

### 4.1 Séparation obligatoire des couches

```text
Couche A — extraction / observation
- lire codes explicites dans documents ;
- détecter désignations ;
- ne pas calculer de montant.

Couche B — résolution candidate
- mapper code explicite → NST ;
- mapper NST → PAD candidates ;
- scorer ;
- marquer ambiguïtés.

Couche C — validation opérateur
- confirmer ou corriger la catégorie PAD ;
- produire cargo.pad_category.

Couche D — aval MAP-8B
- matérialiser cargo.pad_rate_fcfa_per_ton ;
- run-pricing produit PAD_DROIT_PASSAGE.
```

### 4.2 Pivots recommandés

Ne pas commencer par des colonnes nouvelles.

Utiliser d'abord des facts / candidates versionnés :

```text
cargo.hs_code                    déjà actif
cargo.pad_category               déjà actif
commodity.cn_code                futur / à arbitrer
commodity.nhm_code               futur / à arbitrer
commodity.nst_code               futur / à arbitrer
commodity.nstr_code              futur / à arbitrer
cargo.pad_category_candidate     futur éventuel
cargo.pad_resolution_source      futur éventuel
```

### 4.3 Hiérarchie de confiance proposée

```text
1. operator_confirmed PAD category
2. code structuré explicite dans document + mapping unique + PAD unique
3. alias designation exact validé
4. code structuré explicite mais PAD multiple → TO_REVIEW
5. NSTR convergent → TO_REVIEW / faible confiance
6. suggestion IA/web → TO_CONFIRM strict, amount 0
7. aucune source → gap pricing.pad_category
```

Cette hiérarchie ne doit pas écraser le comportement existant : l'alias exact validé reste opérationnel et ne doit pas être cassé.

---

## 5. Plan recommandé après MAP-RUNTIME-2

### MAP-RUNTIME-3 — Design d'alimentation observation-only du resolver

Objectif : définir comment alimenter `resolvePadClassification` avec les vraies données sans modifier les totaux.

Périmètre : design-only, aucun patch.

Questions à trancher :

```text
- Quelle source pour hsToNstMapping ?
- Le HS10 actuel peut-il matcher nst_cn_mappings directement ou faut-il une table dédiée hs10→nst ?
- CN8 doit-il devenir un fact distinct commodity.cn_code ?
- NHM est-il réellement présent dans les documents SODATRA ?
- Faut-il exposer nst_code comme fact opérateur ?
- Quelle politique pour les 18,9 % NST→PAD ambigus ?
```

### MAP-RUNTIME-4 — SELECT live ciblé si nécessaire

Objectif : revalider uniquement les points non prouvables statiquement :

```text
- colonnes exactes des tables bridge ;
- exemples de 5 lignes CN→NST ;
- exemples de 5 lignes NHM→NST ;
- exemples de NSTR ambigu ;
- exemples de NST→PAD multi-catégories ;
- possibilité ou non de matcher cargo.hs_code sur nst_cn_mappings.cn_code.
```

Ce lot doit rester read-only.

### MAP-RUNTIME-5 — Shadow feeder minimal

Seulement après MAP-RUNTIME-3/4.

Objectif : brancher observation-only :

```text
resolver input + context réel
→ output candidate
→ log / timeline / diagnostic
→ aucun amount compté
→ aucun changement des totaux
```

---

## 6. Tests futurs indispensables

### T1 — HS/CN explicite unique

Entrée : code structuré exact qui mène à un NST unique puis PAD unique.

Attendu : proposition PAD candidate avec source `hs_to_nst`, pas de montant si non validé.

### T2 — NST multi-PAD

Entrée : NST dont les règles mappent vers plusieurs catégories PAD.

Attendu : `pricing.pad_classification_needs_review`, aucun montant.

### T3 — NSTR ambigu non convergent

Entrée : NSTR mappant vers plusieurs NST puis plusieurs PAD.

Attendu : revue opérateur obligatoire, aucun montant.

### T4 — Alias exact validé

Entrée : désignation déjà présente dans `pad_designation_aliases`.

Attendu : comportement legacy inchangé.

### T5 — Suggestion IA/web

Entrée : proposition HS/PAD non sourcée officiellement.

Attendu : `TO_CONFIRM`, `amount = 0`, validation opérateur obligatoire.

### T6 — Après validation opérateur

Entrée : opérateur confirme PAD T12.

Attendu : MAP-8B matérialise le taux, puis `run-pricing` produit `PAD_DROIT_PASSAGE` si poids présent.

---

## 7. Verdict final

```text
MAP_RUNTIME_2_UPSTREAM_AUDIT_READY_NO_PATCH
```

Décision CTO :

```text
- La chaîne amont CN/NHM/NST/PAD reste non branchée en runtime principal.
- Les données de mapping existent selon les rapports, mais restent dormantes côté code.
- Le resolver pur existe déjà et doit être réutilisé.
- Les règles NST→PAD sont candidates et opérateur-obligatoires.
- Aucun calcul automatique de taxe ne doit partir d'une suggestion IA/web ou d'un NSTR ambigu.
- Prochaine étape recommandée : MAP-RUNTIME-3 design observation-only, puis SELECT live ciblé si nécessaire.
```

Aucune exécution technique n'est ouverte par ce rapport sans GO CTO séparé.
