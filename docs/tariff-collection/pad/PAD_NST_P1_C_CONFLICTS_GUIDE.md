# PAD-NST-P1-C — Guide des conflits critiques NST→PAD

**Date** : 2026-05-08  
**Phase** : P1-C — Documentation conflits critiques  
**Statut** : DOCUMENT DOCTRINAIRE — Aucun code, aucune migration, aucun runtime  
**Auteur** : Cowork / CTO  
**Prérequis** : PAD-NST-2E-C-B ✅ DÉPLOYÉ

---

## Périmètre

Ce document fixe la **doctrine de résolution opérateur** pour les 5 conflits NST→PAD où les règles de la table `pad_nst_recommendation_rules` produisent plusieurs candidats avec une ambiguïté non résolvable par le seul code NST.

**Invariants stricts :**

- ✅ 0 modification `src/`
- ✅ 0 modification `run-pricing/`
- ✅ 0 Edge Function créée ou modifiée
- ✅ 0 migration SQL
- ✅ 0 modification `config.toml`
- ✅ 0 changement aux 88 règles R2 dans `pad_nst_recommendation_rules`

Ce document est une **référence doctrinaire**. Il guide l'opérateur humain et sert de base pour la future UI C-D et le protocole de pilote terrain C-E.

---

## Labels PAD de référence (réels, base de données)

| Catégorie | Label réel (DB) |
|-----------|----------------|
| T01 | Biens de valeur, électronique, informatique et mobilier |
| T02 | Marchandises générales |
| T03 | Acides, sucres et matières premières |
| T04 | Bois et produits divers |
| T05 | Céréales, ciment, riz et produits assimilés |
| T06 | Gasoil, fuel oil, diesel, butane en vrac, phosphates |
| T07 | Clinker, farine, charbon, sable et vracs pondéreux |
| T08 | Attapulgite, phosphates, ferrailles, tourteaux, cellulose |
| T09 | Tracteurs, véhicules industriels et matériel de transport |
| T10 | Sel de production locale |
| T11 | Pétrole brut, essences, bitumes, hydrocarbures raffinés |
| T12 | Matériaux et produits manufacturés |
| T13 | Marchandises diverses en groupage |
| T14 | Fil machine et feuillard |

> **Source** : colonne `pad_category_label` de `pad_nst_2e_rule_candidates.csv`, vérifiée contre la base en R2.

---

## Conflit 1 — Ciment / Clinker : T05 vs T07

### Origine du conflit

Les deux labels PAD mentionnent explicitement ces produits :
- T05 = « Céréales, **ciment**, riz et produits assimilés »
- T07 = « **Clinker**, farine, charbon, sable et vracs pondéreux »

### Règles R2 impliquées

| Groupe NST | Libellé | Candidat | Confiance |
|-----------|---------|---------|-----------|
| division 09 | Other non-metallic mineral products | T07 | 0.45 |
| division 09 | Other non-metallic mineral products | T05 | 0.35 |
| group 03.5 | Stone, sand, gravel, clay, peat | T07 | 0.55 |

### Doctrine de résolution

| Produit | Catégorie | Justification |
|---------|-----------|---------------|
| Clinker | **T07** | Matière première semi-finie de cimenterie. Label T07 explicite. Vrac pondéreux non conditionné. |
| Ciment en vrac (citerne, vrac) | **T07** | Vrac pondéreux. Même famille que clinker. |
| Ciment en sacs (emballé, conditionné) | **T05** | Produit conditionné. Assimilable à la famille céréales/ciment conditionnée de T05. |
| Sable, gravier de carrière | **T07** | Vracs pondéreux. Label T07 explicite (group 03.5@0.55). |
| Chaux, plâtre | **T07** | Produits minéraux non métalliques vrac. Division 09 → T07. |
| Béton prêt à l'emploi, éléments préfabriqués | **T12** | Produits manufacturés à forme définie. Pas un vrac. |

### Règle opérateur

> Si la description mentionne **clinker** ou un vrac minéral non conditionné → **T07**.  
> Si la description mentionne **ciment en sacs** ou un conditionnement explicite → **T05**.  
> En cas de doute sur le conditionnement → valider **T07 par défaut** (confiance R2 plus haute, 0.45 vs 0.35).

---

## Conflit 2 — Phosphates / Engrais : T06 vs T08

### Origine du conflit

Les phosphates apparaissent **explicitement** dans deux labels PAD distincts — conflit structurel dans la nomenclature PAD elle-même :
- T06 = « Gasoil, fuel oil, diesel, butane en vrac, **phosphates** »
- T08 = « Attapulgite, **phosphates**, ferrailles, tourteaux, cellulose »

### Règles R2 impliquées

| Groupe NST | Libellé | Candidat | Confiance |
|-----------|---------|---------|-----------|
| group 03.3 | Chemical and natural fertilizer minerals | T08 | **0.50** |
| group 03.3 | Chemical and natural fertilizer minerals | T06 | 0.40 |
| group 08.3 | Nitrogen compounds and fertilizers | T08 | **0.50** |

### Doctrine de résolution

| Produit | Catégorie | Justification |
|---------|-----------|---------------|
| Phosphates minéraux bruts (roche phosphatée) | **T08** | Match direct, confiance 0.50 > 0.40 dans R2. T08 = minéraux industriels. |
| Phosphates traités / superphosphates | **T08** | Engrais phosphatés dérivés de minéraux. T08 = tourteaux, cellulose, minéraux. |
| Engrais azotés (urée, ammonitrate), composés NPK | **T08** | Groupe 08.3 → T08@0.50 explicite. Famille minéraux fertilisants. |
| Phosphates en contexte hydrocarbure / vrac pétrolier | **T06** | Uniquement si le dossier associe explicitement les phosphates à un chargement d'hydrocarbures en vrac. Cas extrêmement rare. |

### Règle opérateur

> Pour tous les phosphates bruts ou engrais phosphatés/azotés → **T08** (confiance R2 plus haute + contexte métier Dakar port minéralier).  
> T06 ne doit être retenu pour les phosphates que si le dossier associe explicitement les phosphates à une cargaison d'hydrocarbures en vrac.  
> En cas de doute → **T08**.

---

## Conflit 3 — Pétrole brut / Produits raffinés : T11 vs T06

### Origine du conflit

Les hydrocarbures se répartissent entre deux catégories selon leur nature et stade de raffinage.

| Catégorie | Label | Produits types |
|-----------|-------|----------------|
| T11 | Pétrole brut, essences, bitumes, hydrocarbures raffinés | Brut, essences, naphta, bitume |
| T06 | Gasoil, fuel oil, diesel, butane en vrac, phosphates | Gasoil, diesel, fuel, GPL |

### Règles R2 impliquées

| Groupe NST | Libellé | Candidat | Confiance |
|-----------|---------|---------|-----------|
| division 02 | Coal, crude petroleum, natural gas | T11 | 0.45 |
| division 07 | Coke and refined petroleum products | T11 | 0.50 |
| group 07.3 | Gaseous, liquefied, compressed petroleum | T06 | **0.55** |
| group 02.3 | Natural gas | T06 | 0.45 |
| group 02.3 | Natural gas | T11 | 0.40 |

### Doctrine de résolution

| Produit | Catégorie | Justification |
|---------|-----------|---------------|
| Pétrole brut | **T11** | Label explicite T11. |
| Essences (super, sans-plomb, SP95, SP98) | **T11** | Hydrocarbures raffinés légers. Label T11. |
| Bitume, asphalte | **T11** | Label T11 explicite. |
| Naphta | **T11** | Coupe pétrolière légère. Famille T11. |
| Huiles lubrifiantes | **T11** | Produits pétroliers raffinés. |
| Gasoil | **T06** | Label T06 explicite. |
| Fuel oil | **T06** | Label T06 explicite. |
| Diesel | **T06** | Label T06 explicite. |
| Butane / propane en bouteilles ou vrac | **T06** | Label T06 explicite : « butane en vrac ». |
| Kérosène, jet fuel | **T11** | Coupe pétrolière moyenne. Famille essences/hydrocarbures raffinés. |

### Règle opérateur

> **T11 est le dominant pour tout hydrocarbure brut ou raffiné** : pétrole brut, essences, bitumes, naphta, kérosène → **T11** sans hésitation.  
> Si le produit est un combustible courant de consommation en vrac (gasoil, diesel, fuel oil, butane) → **T06**.  
> L'opérateur n'est indispensable que pour les **cas ambigus** : gaz naturel (voir conflit 5), produits énergétiques non standards, huiles spéciales à destination incertaine, libellés incomplets ou mixtes hydrocarbures.

---

## Conflit 4 — Plastiques bruts vs manufacturés : T03 vs T12

### Origine du conflit

Les plastiques couvrent un spectre allant de la matière première brute (résines, granules) aux produits finis (tuyaux, films, géomembranes). Le stade de transformation détermine la catégorie.

| Catégorie | Label | Famille produits |
|-----------|-------|-----------------|
| T03 | Acides, sucres et matières premières | Résines, granules, formes primaires |
| T12 | Matériaux et produits manufacturés | Tuyaux, films, profilés, articles finis |

### Règles R2 impliquées

| Groupe NST | Libellé | Candidat | Confiance |
|-----------|---------|---------|-----------|
| group 08.4 | Basic plastics, synthetic rubber in primary forms | T03 | **0.45** |
| group 08.4 | Basic plastics, synthetic rubber in primary forms | T12 | 0.40 |
| group 08.6 | Rubber or plastic products | T12 | **0.50** |
| division 08 | Chemicals, plastics, rubber, nuclear fuel | T03 | 0.35 |
| division 08 | Chemicals, plastics, rubber, nuclear fuel | T12 | 0.30 |

### Doctrine de résolution

| Produit | Catégorie | Justification |
|---------|-----------|---------------|
| Résines plastiques en granules / pellets (HDPE, PVC, PP, PE brut) | **T03** | Forme primaire. Matière première industrielle. Groupe 08.4 → T03@0.45. |
| HDPE brut en sacs / big bags | **T03** | Forme primaire. Matière première. |
| Caoutchouc synthétique en blocs non vulcanisés | **T03** | Forme primaire. Matière première. |
| Plaques, films, profilés en plastique | **T12** | Produits semi-finis manufacturés à forme géométrique définie. |
| Tuyaux PVC, tubes polyéthylène | **T12** | Produits finis manufacturés. Groupe 08.6 → T12@0.50. |
| Géomembranes HDPE | **T12** | Produit fini manufacturé (film à épaisseur contrôlée). Groupe 08.6 → T12. |
| Pneus, joints, articles en caoutchouc | **T12** | Produits finis manufacturés. |

### Règle opérateur

> Critère discriminant : **état de transformation**.  
> Granules / poudres / blocs bruts sans forme définie → **T03** (matière première).  
> Tout produit ayant une forme géométrique définie (tuyau, feuille, profilé, film calibré) → **T12** (produit manufacturé).  
> En cas de doute : si le produit est utilisable directement par l'acheteur final → **T12** ; s'il doit encore passer en machine industrielle → **T03**.

---

## Conflit 5 — Gaz naturel : ambiguïté forte, validation opérateur obligatoire

### Origine du conflit

Le gaz naturel (groupe NST 02.3) est le **seul groupe des 88 règles R2 où aucune catégorie PAD n'atteint la confiance 0.60**, et où les deux candidats sont tous deux dans la zone d'incertitude haute.

| Catégorie | Confiance R2 | Label |
|-----------|-------------|-------|
| T06 | **0.45** | Gasoil, fuel oil, diesel, butane en vrac, phosphates |
| T11 | **0.40** | Pétrole brut, essences, bitumes, hydrocarbures raffinés |

Le label T06 mentionne « butane en vrac », ce qui est proche du GPL/gaz naturel liquéfié. Mais le gaz naturel n'est **nommé dans aucun label PAD**. C'est une limite documentée de la nomenclature PAD 2006.

### Doctrine de résolution

| Produit | Catégorie recommandée | Justification |
|---------|----------------------|---------------|
| Butane (GPL) en bouteilles ou vrac | **T06** (TO_CONFIRM) | Label T06 explicite : « butane en vrac ». |
| Propane en vrac | **T06** (TO_CONFIRM) | Assimilable au butane. |
| Gaz naturel comprimé (GNC) | **T06** (TO_CONFIRM) | Assimilable aux hydrocarbures gazeux en vrac. Validation opérateur obligatoire. |
| Gaz naturel liquéfié (GNL) | **T06 ou T11** — opérateur doit arbitrer | Ambiguïté maximale. T11 si assimilé à hydrocarbure brut/raffiné ; T06 si assimilé à combustible en vrac. |
| Méthane | **T06** (TO_CONFIRM) | Gaz combustible. Proche butane/vrac. |

### Règle opérateur

> Le gaz naturel est le **seul conflit sans catégorie dominante** dans les règles R2.  
> **Aucune validation automatique n'est autorisée pour ce groupe.**  
> L'opérateur doit toujours préciser : forme physique (bouteille / vrac / pipeline / GNL), destination (consommation directe / export / stockage).  
> Ce cas **doit figurer dans le protocole pilote terrain C-E** comme cas de test obligatoire n°1.

---

## Tableau de synthèse

| # | Conflit | Catégories en jeu | Critère discriminant | Défaut si doute |
|---|---------|-------------------|---------------------|-----------------|
| 1 | Ciment / Clinker | T05 vs T07 | Conditionné (T05) vs vrac non conditionné (T07) | **T07** |
| 2 | Phosphates / Engrais | T06 vs T08 | Contexte minéral (T08) vs contexte hydrocarbure (T06) | **T08** |
| 3 | Pétrole / Hydrocarbures | T11 vs T06 | Brut/bitumineux/essences (T11) vs combustible courant vrac (T06) | **T11** (opérateur uniquement pour cas ambigus : gaz, libellés incomplets) |
| 4 | Plastiques | T03 vs T12 | Forme primaire/granule (T03) vs produit géométrique/fini (T12) | Par stade de transformation |
| 5 | Gaz naturel | T06 vs T11 | Aucun défaut — ambiguïté structurelle | Validation manuelle obligatoire |

---

## Usage pour l'UI C-D et le pilote terrain C-E

### Pour l'UI C-D

Lorsque `get-pad-nst-suggestions` retourne plusieurs candidats pour un même `nst_code` appartenant à ces 5 conflits, l'UI C-D devra :

1. Afficher toutes les suggestions ordonnées par `confidence DESC`
2. Afficher le `pad_category_label` réel (pas uniquement le code T0X)
3. Si le `nst_code` figure dans ce guide → afficher le **nom du conflit** et les **critères discriminants** de la doctrine
4. **Bloquer toute validation automatique** pour ces 5 familles

### Pour le pilote terrain C-E

Chacun des 5 conflits doit être représenté par **au moins 3 dossiers réels** dans le protocole pilote (15 dossiers dédiés sur les 20–50 prévus). Les 5 doivent figurer dans la grille d'évaluation terrain.

---

## Références

| Document | Rôle |
|----------|------|
| `PAD_NST_RECOMMENDATION_ENGINE.md` | Doctrine NST→PAD (corrigée DOC-R1, commit 68e5e7c) |
| `PAD_NST_2E_AUDIT_REPORT.md` | Audit R1 des 88 règles, tiers et confidences |
| `pad_nst_2e_rule_candidates.csv` | Manifest règles — labels PAD réels vérifiés |
| `PAD_NST_2E_B_R2_RECONCILIATION_REPORT.md` | R2 — source de vérité des règles en base |
| `PAD_NST_2E_C_A_RUNTIME_PLAN.md` | Architecture runtime cible |
| `PAD_NST_2E_C_B_VERIFICATION_REPORT.md` | Edge Function C-B déployée |
| `DEFERRED_BACKLOG.md` | Séquence C-D → C-B-LOG → C-E → C-C |
