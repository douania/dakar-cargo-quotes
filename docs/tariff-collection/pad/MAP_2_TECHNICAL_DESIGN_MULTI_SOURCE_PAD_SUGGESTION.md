# MAP-2 — Design technique du moteur de suggestion PAD multi-source

**Date** : 2026-05-13
**Repo / branche** : `douania/dakar-cargo-quotes` / `work`
**Type** : Documentation only — design technique production-grade
**Statut backlog** : `📋 MAP-2 DESIGN DRAFT — awaiting CTO review`
**Garde-fous appliqués** : aucun patch `src/`, aucune migration, aucune écriture DB, aucune modification de `run-pricing` / `get-pad-nst-suggestions` / `recommend-pad-category` / `quotation-engine`, aucune Edge Function créée, `PAD_RESOLVER_SHADOW` non activé, aucun INSERT alias, aucune décision Lot D, MAPPING-TAX-CHAIN-0 non clôturé, aucun fichier externe joint copié dans le repo.

---

## 1. Verdict exécutif

**`MAP_2_TECHNICAL_DESIGN_READY`**

Toutes les sources requises (repo + externes opérateur) ont été lues. Le design technique du moteur multi-source `Désignation client → code structuré candidat → NST 2007 → catégorie PAD → DROIT_PASSAGE` est **complet et cohérent** avec :

- l'architecture FROZEN documentée dans `docs/MASTER_CONTEXT.md` ;
- la doctrine PAD-R1B (coexistence IA UI / runtime déterministe) ;
- les invariants `DROIT_PASSAGE` famille canonique unique et `PORT_TAX` libellé commercial uniquement ;
- le helper pur `src/lib/pad/resolvePadClassification.ts` (Lot B) qui sert de référence d'algorithme et de typage.

Aucune implémentation n'est livrée dans ce lot. Le présent rapport définit le contrat technique et la séquence de lots MAP-3 → MAP-8 nécessaires à une activation progressive, **operator-in-the-loop** par construction.

---

## 2. Sources lues

### 2.1 Sources repo (versionnées sur `work`)

| Fichier | Rôle | Lu |
|---|---|:-:|
| `docs/MASTER_CONTEXT.md` | Source de vérité architecture | ✅ |
| `docs/STATUS_REGISTRY.md` | États globaux | ✅ |
| `docs/SECURITY_CONTRACT.md` | Garde-fous sécurité | ✅ |
| `docs/DEFERRED_BACKLOG.md` | Backlog différé (MAPPING-TAX-CHAIN-0, PAD-NST-2E-*, HS10-AUTO-INJECTION-GUARD, DCQ-RAILWAY-*) | ✅ |
| `.lovable/plan.md` | Plan en cours | ✅ |
| `docs/tariff-collection/MAPPING_TAX_CHAIN_0_AUDIT.md` | Audit chaîne CN/NHM/NSTR → NST → PAD (253 l.) | ✅ |
| `docs/tariff-collection/pad/PAD_BAREME_2006_PHASE2_IMPORT_REPORT.md` | Import 120 lignes PRESENT | ✅ |
| `docs/tariff-collection/pad/PAD_BAREME_2006_PHASE2_SMOKE_TEST.md` | Smoke test conformité PDF | ✅ |
| `docs/tariff-collection/pad/PAD_BAREME_2006_RUNTIME_EXPAND_LOT_A_PATCH_PLAN.md` | Plan Lot A | ✅ |
| `docs/tariff-collection/pad/PAD_BAREME_2006_RUNTIME_EXPAND_LOT_C_REPORT.md` | Rapport Lot C | ✅ |
| `docs/tariff-collection/pad/PAD_BAREME_2006_DROIT_PASSAGE_FULL.csv` | Référentiel canonique 124 lignes (120 PRESENT + 4 BLANK_IN_PDF) | ✅ |
| `docs/tariff-collection/pad/Rapport_Audit_CTO_Manus_PAD_NST.md` | Audit CTO Manus chantier PAD-NST (155 l.) — **présent** dans le repo (chemin vérifié `ls`) | ✅ |
| `src/lib/pad/types.ts`, `src/lib/pad/resolvePadClassification.ts`, `src/lib/pad/invoiceLabelAliases.ts` | Helper Lot B + types canoniques | ✅ |
| `supabase/functions/_shared/pad/types.ts` | Miroir types côté Deno | ✅ |

### 2.2 Sources externes opérateur (hors repo, jointes ce jour)

Ces fichiers ont été lus dans le namespace `user-uploads://` mais **ne sont pas copiés dans le repo** (hors scope MAP-2). Ils sont cités comme références opérateur.

| Fichier | Auteur | Volume | Lu |
|---|---|---|:-:|
| `MAP_RUNTIME_1_DESIGNATION_TO_DROIT_PASSAGE_STRATEGY.md` | ChatGPT agent | 767 lignes | ✅ |
| `MAP-RUNTIME-1_Stratégie_de_Résolution_Désignation_→_Droit_de_Passage_PAD.md` | Manus AI | 222 lignes | ✅ |
| `Audit_Forensic_Ambiguïté_du_Mapping_NSTR_→_NST_2007.md` | Manus AI | 95 lignes | ✅ |
| `Analyse_tarifaire_portuaire_2006.pdf` | Claude Opus 4.7 | PDF | Référencé — non transcrit (garde-fou « ne pas modifier les sources ») |
| `REDEVANCES_PORTUAIRES_2006-5.pdf` | PDF officiel PAD 2006 | 40 pages | Référencé — déjà couvert par `PAD_BAREME_2006_DROIT_PASSAGE_FULL.csv` (124 lignes conformes cellule par cellule selon Phase 2 smoke test) |
| `NST2007_CN2024_Table.xlsx`, `NST_2007_-_NHM_2025.xlsx`, `NST2007_CPA21_Table.xlsx`, `NST_2007_-_NST_R_1967.zip` | Eurostat | 4 fichiers d'équivalence | Référencés — déjà importés en DB par PAD-NST-2C |

### 2.3 Fichiers cités par les rapports externes mais absents du repo

| Fichier mentionné | État repo | Action |
|---|---|---|
| `docs/tariff-collection/pad/NSTR_NST_AMBIGUITY_FORENSIC_AUDIT.md` | **Absent** | Contenu équivalent fourni par la pièce-jointe utilisateur `Audit_Forensic_Ambiguïté_du_Mapping_NSTR_→_NST_2007.md` |
| `docs/tariff-collection/pad/PAD_BAREME_2006_RUNTIME_EXPAND_LOT_B_REPORT.md` | **Absent** (vérifié `ls`) | Contenu déduit de `src/lib/pad/resolvePadClassification.ts` + types ; à formaliser ultérieurement |

### 2.4 Limites de vérification

- Le présent rapport n'a **pas requêté la base** (lecture read-only via Supabase non utilisée). Les chiffres DB (88 règles, 384 alias, 120 lignes PRESENT, 5 lignes NSTR quarantine) sont repris des audits antérieurs et du rapport ChatGPT agent.
- L'intégrité des PDFs externes n'a pas été re-validée par hash ; les conclusions reposent sur les rapports tiers.
- Aucun test de résolution end-to-end n'a été exécuté : ce lot est strictement design.

---

## 3. Synthèse des audits Manus / ChatGPT agent / Claude

Le rapport **ChatGPT agent (767 lignes)** est traité comme **base technique principale** car il est le plus exhaustif, intègre les vérifications croisées avec le code source (`run-pricing` L1964-2206, `recommend-pad-category` L55, `quotation-engine` L1441), et formalise les règles HS10 UEMOA / CN8 / HS6 et T13 transit/transbordement avec une granularité supérieure aux deux autres rapports.

### 3.1 Convergences (3 rapports)

| Point | Statut |
|---|---|
| `DROIT_PASSAGE` est la **famille canonique unique** des tarifs PAD 2006 | ✅ unanime |
| `PORT_TAX` est un **libellé commercial / alias facture**, jamais une famille tarifaire parallèle | ✅ unanime |
| Bridges CN 2024 → NST, NHM 2025 → NST, CPA 2.1 → NST sont **many-to-one déterministes** (0 % d'ambiguïté) | ✅ unanime |
| Bridge NSTR 1967 → NST 2007 est **many-to-many** ambigu à **47,4 %** (82 / 173 codes), structurel non-bug, documenté Eurostat | ✅ unanime |
| Aucun champ pivot `cn_code` / `nhm_code` / `nstr_code` / `nst_code` n'existe sur `quote_facts` ou `cargo` ; seul `cargo.hs_code` existe (UEMOA 10 chiffres) | ✅ unanime |
| Tables CN/NHM/NSTR/CPA → NST sont **dormantes** : peuplées en DB (PAD-NST-2C) mais **jamais lues** par aucune Edge Function ni composant UI | ✅ unanime |
| `pad_nst_recommendation_rules` : 88 règles (60 group + 14 division actifs) ; ambiguïté NST→PAD ≈ 19 % | ✅ unanime |
| `run-pricing` consomme uniquement `pad_designation_aliases` (alias texte exact) + `port_tariffs` filtré sur `category='DROIT_PASSAGE'` ; restreint en pratique à **IMPORT / CONTENEUR** | ✅ unanime |
| `get-pad-nst-suggestions` existe mais n'est **pas branché** à `run-pricing` | ✅ unanime |
| `recommend-pad-category` est une fonction IA d'aide opérateur UI, jamais appelée par le pricing (gouvernance PAD-R1B) | ✅ unanime |
| **Operator-in-the-loop obligatoire** dès qu'il y a ambiguïté, suggestion IA, ou résolution multi-PAD | ✅ unanime |
| **T13 transit/transbordement conteneur** se remappe vers C01/C02/C03 selon la taille du conteneur (PDF 2006 §2.1bis) | ✅ unanime |
| Désignation libre → catégorie PAD ne peut **jamais** être automatisée à confiance haute (text matching seul produit faux positifs systématiques : « rice in bags » → T05 vs T12, « matériel électrique » → T01/T09/T12) | ✅ unanime |

### 3.2 Divergences

| Point | ChatGPT agent | Manus MAP-RUNTIME-1 | Arbitrage CTO |
|---|---|---|---|
| Priorité de la cascade | (1) operator → (2) code structuré CN > HS/CN > NHM > NST > NSTR > CPA → (3) alias validé → (4) libellé PAD §2.3 → (5) libellé CN/NHM/NST → (6) IA/Web → (7) gap | (1) libellé PAD §2.3 → (2) alias validé → (3) libellé NST → (4) libellé CN/NHM → (5) projection NST→PAD | **ChatGPT retenu** : un code structuré explicite dans le document client (CN, NHM, HS, NST, NSTR) prime sur tout text-match, qui est par nature non déterministe. La Section 2.3 PAD reste prioritaire **uniquement** comme libellé de référence dans le branche text-match (étapes 4-5). |
| Traitement BLANK_IN_PDF | Strict : `BLANK_IN_PDF ≠ 0`, jamais transformé en zéro applicable | Mention de la règle T10=0 (gratuité explicite PDF) sans approfondir BLANK_IN_PDF | **ChatGPT retenu** : `BLANK_IN_PDF` reste une absence de tarif (gap `blocked_no_tariff`) ; `T10=0` est un zéro applicable uniquement si le PDF l'indique explicitement (cf. Phase 2 smoke test). |
| P01–P05 (réductions pêche) | Jamais appliquées sans preuve documentaire opérateur | Non traité | **ChatGPT retenu** : P01–P05 exigent une preuve documentaire (régime pêche, certificat) ; aucune application automatique. |
| Couverture runtime actuelle | Strictement IMPORT / CONTENEUR | Idem | Convergent — pas de divergence. |

### 3.3 Position du rapport Claude (`Analyse_tarifaire_portuaire_2006.pdf`)

Référencé comme analyse tarifaire complémentaire du PDF officiel. Son contenu n'est **pas re-transcrit** ici (garde-fou « ne pas modifier les sources »). Les chiffres tarifaires consolidés dans `PAD_BAREME_2006_DROIT_PASSAGE_FULL.csv` sont déjà alignés cellule par cellule avec le PDF officiel (Phase 2 smoke test). Le rapport Claude reste utilisable comme contre-vérification opérateur mais n'introduit pas de divergence retenue dans ce design.

### 3.4 Arbitrage CTO global

1. **Cascade ChatGPT retenue** (7 niveaux) — cf. §6.
2. **DROIT_PASSAGE invariant** — aucune réintroduction de `PORT_TAX` comme famille parallèle.
3. **Operator-in-the-loop par défaut** — toute résolution avec `confidence < 1.0` ou `requires_operator_validation = true` exige une action opérateur explicite avant écriture en pricing.
4. **Zéro IA dans le runtime pricing** (PAD-R1B) — l'IA reste cantonnée à l'aide UI dans `recommend-pad-category` (jamais appelée par `run-pricing`).
5. **Stockage candidat séparé des facts validés** (cf. §5).

---

## 4. État actuel du runtime

Synthèse factuelle alignée sur `MAPPING_TAX_CHAIN_0_AUDIT.md` §1-§5 et le rapport ChatGPT agent §4.

### 4.1 Tables et chemins lus

| Table | Lignes (audits antérieurs) | Lue par |
|---|---:|---|
| `nst_divisions` | 20 | ❌ jamais |
| `nst_groups` | 73 (sur 81 attendus — divisions 15 et 20 non peuplées en groupes) | ❌ jamais |
| `nstr_nst2007_mappings` | 9 781 (5 quarantine `NSTR_NULL_CPA_ONLY`) | ❌ jamais |
| `nst_cn_mappings` | 9 762 | ❌ jamais |
| `nst_nhm_mappings` | 15 079 | ❌ jamais |
| `nst_cpa_mappings` | 1 759 | ❌ jamais |
| `pad_nst_recommendation_rules` | 88 (60 group + 14 division actifs) | `get-pad-nst-suggestions` (mode `TO_CONFIRM`) |
| `pad_designation_aliases` | 384 (51 seed + 6 T14 + 327 PAD-NOM-2) | `run-pricing` L1970 + `recommend-pad-category` L55 + `DesignationSuggestionBlock` + `PadAliasTab` (admin) |
| `port_tariffs` | 120 lignes PRESENT `DROIT_PASSAGE` (Phase 2) + 2 lignes legacy `PORT_TAX` TRANSIT (Taleb_Quote_2024) | `run-pricing`, `recommend-pad-category`, `quotation-engine` |
| `commodity_categories` | 19 (porte `hs_chapter` au niveau chapitre, pas HS complet, et `pad_category`) | ✅ |

### 4.2 Facts pivots — état actuel confirmé

Confirmé par grep migrations (`MAPPING_TAX_CHAIN_0_AUDIT.md` §6 + rapport ChatGPT §4.2) :

- ❌ aucune colonne / fact key `commodity.cn_code`
- ❌ aucune colonne / fact key `commodity.nhm_code`
- ❌ aucune colonne / fact key `commodity.nstr_code`
- ❌ aucune colonne / fact key `commodity.nst_code`
- ❌ aucune colonne / fact key `pricing.pad_category` validée par opérateur (au sens MAP-2)
- ✅ `cargo.hs_code` existe (UEMOA 10 chiffres, géré par les chantiers HS10-AUTO-INJECTION-GUARD / HS10-RANKING-CONTEXT-ENRICHMENT)

**Conséquence** : la chaîne MAP cible **ne peut pas démarrer depuis un dossier réel** sans nouveau stockage. C'est précisément l'objet du futur MAP-3.

### 4.3 Helpers pré-existants (Lot B)

`src/lib/pad/resolvePadClassification.ts` est un **helper pur** (zéro DB, zéro réseau, déterministe) qui implémente déjà :

- 7 niveaux de cascade (operator_confirmed → validated_alias → hs_to_nst → nst_rule → designation_match → ai_suggestion → none/gap) ;
- `canonical_rate_family = "DROIT_PASSAGE"` invariant ;
- `PORT_TAX` filtré comme libellé facture (warning), jamais comme famille de sortie ;
- T13 transit/transbordement : remap vers C01/C02/C03 **uniquement si** `containerSizeToCxxMapping` est fourni en contexte (sinon blocage explicite « Lovable n'invente pas C01/C02/C03 ») ;
- gaps standardisés (`pricing.operation_type_required`, `pricing.cargo_type_required`, `pricing.pad_classification_needs_review`, `pricing.hs_or_nst_required`, `pricing.container_size_required_for_T13_transit`, `pricing.pad_category_required`, `pricing.invoice_label_unmapped`, `pricing.port_tax_alias_needs_review`).

Ce helper est **non branché** au runtime à ce jour. Il sera consommé par MAP-4 (Edge Function read-only).

### 4.4 Périmètre runtime actuel `run-pricing`

`run-pricing` (L1964-2206) :

1. Lookup `pad_designation_aliases.normalized_term` exact + `is_validated=true`.
2. Lecture `port_tariffs` filtrée strictement sur `category='DROIT_PASSAGE'`.
3. Restriction effective **IMPORT / CONTENEUR** (les autres `operation_type` / `cargo_type` ne sont pas couverts par les 384 alias actuels).

Aucune extension de couverture n'est prévue dans MAP-2. MAP-7 traitera l'activation partielle.

---

## 5. Décision d'architecture : où stocker les codes pivots ?

### 5.1 Option A — Colonnes / facts directs sur `cargo`

Ajouter directement sur `cargo` (table existante) :
`cargo.hs_code` (existe), `cargo.cn_code`, `cargo.nhm_code`, `cargo.nstr_code`, `cargo.nst_code`, `cargo.pad_category`.

| Avantage | Risque |
|---|---|
| Lecture simple, pas de jointure | Mélange code candidat / code validé sur le même champ |
| Pas de RLS supplémentaire | Pas d'historique des candidats rejetés |
| | Multiplie les colonnes optionnelles (sparse) |
| | Pas de provenance (`source_kind`, `evidence_level`) |

### 5.2 Option B — `quote_facts` keyed (`commodity.*`, `pricing.*`)

Utiliser le mécanisme existant `quote_facts` avec `fact_key` structurés :
`commodity.hs_code`, `commodity.cn_code`, `commodity.nhm_code`, `commodity.nstr_code`, `commodity.nst_code`, `pricing.pad_category`.

| Avantage | Risque |
|---|---|
| Réutilise infrastructure facts (RLS, source, manual_input, opérateur) | Ne porte qu'**une** valeur validée par fact_key |
| Cohérent avec `Manual Data Protection Policy v2` (priorité absolue opérateur) | Pas de top-N candidats |
| Provenance native (`source_kind` du fact existe déjà) | Pas d'historique candidats rejetés |
| `set-case-fact` connu, déjà sécurisé | |

### 5.3 Option C — Table dédiée `commodity_classification_candidates`

Schéma proposé (à formaliser en MAP-3) :

| Colonne | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `case_id` | uuid FK `cases.id` | |
| `source_fact_id` | uuid nullable | Fact à l'origine (désignation, hs_code...) |
| `raw_designation` | text | Désignation brute extraite |
| `normalized_designation` | text | Forme normalisée (lowercase, accents, espaces) |
| `proposed_code` | text | Code candidat proposé |
| `code_type` | text CHECK ∈ {`HS6`, `HS10_UEMOA`, `CN8`, `NHM`, `CPA`, `NSTR`, `NST_GROUP`, `NST_DIVISION`} | |
| `nst_candidates` | jsonb | Liste des NST candidats issus du `proposed_code` |
| `pad_candidates` | jsonb | Liste des catégories PAD candidates avec scoring |
| `confidence` | numeric (0..1) | |
| `evidence_level` | text CHECK ∈ {`pad_official_extract`, `nstr_bridge_inferred`, `expert_rule`, `text_match`, `ai_suggestion`, `operator_override`} | |
| `source_kind` | text CHECK ∈ {`document_client`, `ocr`, `web`, `ai`, `alias`, `operator`} | |
| `source_reference` | text | URL, citation source, ID document |
| `validation_status` | text CHECK ∈ {`suggested`, `accepted`, `rejected`, `superseded`} | |
| `requires_operator_validation` | boolean | |
| `validated_by` | uuid nullable FK `auth.users` | |
| `validated_at` | timestamptz nullable | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

| Avantage | Risque |
|---|---|
| Top-N candidats avec scoring | Nouvelle table → RLS à concevoir |
| Historique complet (suggested/accepted/rejected/superseded) | Coût migration + import |
| Provenance riche (`source_kind` × `evidence_level` × `source_reference`) | Risque ghost candidates si sync facts oubliée |
| Compatible shadow-mode (MAP-6) | |
| Auditabilité opérateur (`validated_by`, `validated_at`) | |

### 5.4 Recommandation CTO

**Option B + Option C combinées** pour MAP-3 :

- **Option C** = table candidats (toutes les propositions, scoring, top-N, provenance, historique) — alimentée par MAP-4 (Edge Function read-only de résolution).
- **Option B** = facts validés canoniques (`commodity.cn_code`, `commodity.nst_code`, `pricing.pad_category`...) — écrits **uniquement** par action opérateur explicite via `set-case-fact` (ou équivalent), après acceptation d'un candidat dans l'UI MAP-5.

**Aucune migration n'est créée dans MAP-2.** Le schéma C ci-dessus est une recommandation pour MAP-3 ; le CTO arbitre nom de table, contraintes finales, RLS, et FK avant exécution.

---

## 6. Algorithme cible multi-source

Cascade à 7 niveaux, alignée sur `src/lib/pad/resolvePadClassification.ts` (Lot B) et étendue avec la priorité aux codes structurés.

| # | Source | Confidence | `requires_operator_validation` | Sortie attendue / blocker |
|---|---|---:|:-:|---|
| 1 | `known_pad_category` opérateur (priorité absolue) | 1.00 | non | `classification = <Tnn/Pnn/Cnn>`, `source = operator_confirmed` |
| 2a | Code structuré exact dans document client : **CN** explicite | 0.90 | non si CN→1 NST→1 PAD ; oui sinon | `source = hs_to_nst (cn)` ; sinon `blocked_multiple_pad` |
| 2b | Code structuré : **HS10 UEMOA** → tronqué HS6 → mapping CN8 | 0.85 | oui si HS6→multi-CN8 | `source = hs_to_nst (hs)` ; sinon blocage |
| 2c | Code structuré : **NHM** | 0.85 | non si NHM→1 NST→1 PAD ; oui sinon | `source = hs_to_nst (nhm)` |
| 2d | Code structuré : **NST** explicite (group ou division) | 0.80 | oui si règle NST→PAD `requires_operator_validation` | `source = nst_rule` |
| 2e | Code structuré : **NSTR** explicite | 0.60 si convergent ; 0.0 sinon | toujours oui | suggestion forte si 1 PAD ; `blocked_multiple_pad` si ≥ 2 |
| 2f | Code structuré : **CPA** (rare en BL/factures portuaires) | 0.50 | toujours oui | dictionnaire secondaire |
| 3 | Alias PAD validé exact (`pad_designation_aliases.is_validated=true`) | 0.90 | non | `source = validated_alias` (cf. Lot B §3) |
| 4 | Match libellé **PAD §2.3** (libellés officiels PDF, normalisés) | 0.70 | oui | `source = designation_match` |
| 5 | Match libellé **CN/NHM/NST** (FR + EN) | 0.50 | toujours oui | `source = designation_match` (faible) |
| 6 | Suggestion **IA/Web** HS/CN (top 3, preuve obligatoire) | 0.50 | toujours oui | `source = ai_suggestion` ; gap `pricing.pad_classification_needs_review` |
| 7 | Aucun match | 0.00 | oui | gap bloquant `pricing.pad_category_required` ou `pricing.hs_or_nst_required` |

### 6.1 Règles transverses

- **Court-circuit** : dès qu'un niveau supérieur produit un résultat à `confidence ≥ 0.85` et `requires_operator_validation = false`, les niveaux inférieurs ne sont pas évalués (sauf logging shadow MAP-6).
- **Multi-candidat sur un niveau** : si plusieurs catégories PAD distinctes émergent au même niveau (ex. NSTR → multi-NST → multi-PAD), retourne `blocked_multiple_pad` (jamais de choix par fréquence ou par valeur tarifaire).
- **Préchecks structurels** : `operation_type` et `cargo_type` requis pour cibler `port_tariffs` (déjà implémenté Lot B).
- **T13 transit/transbordement conteneur** : remap C01/C02/C03 **uniquement si** `containerSizeToCxxMapping` est fourni en contexte ; sinon blocage explicite (déjà implémenté Lot B).

---

## 7. Gestion HS10 UEMOA / HS6 / CN8

Point obligatoire — règles strictes :

| Règle | Détail |
|---|---|
| **HS6 universel** | Les 6 premiers chiffres OMD sont communs à toutes les nomenclatures dérivées (CN8, HS10 UEMOA, NHM). |
| **CN8 = européen** | 8 chiffres, granularité Eurostat. Présent dans `nst_cn_mappings` (9 762 codes). |
| **HS10 UEMOA / Sénégal ≠ CN8** | Les 7e/8e chiffres CN8 ne correspondent pas aux 7e/8e chiffres HS10 UEMOA. **Jamais inventer un CN8 depuis un HS10**. |
| **HS10 → HS6** | Troncature à 6 chiffres autorisée et déterministe. |
| **HS6 → CN8** | Lookup dans `nst_cn_mappings` sur préfixe HS6 : si **1 seul CN8** → suggestion forte (validation opérateur recommandée) ; si **≥ 2 CN8** distincts pointant vers des NST différents → `blocked_multiple_pad` (revue opérateur obligatoire). |
| **HS6 → CN8 unique → NST → PAD unique** | Cascade complète possible avec `confidence ≈ 0.85`, `requires_operator_validation = false` (mais shadow-mode MAP-6 conseillé). |
| **Lien avec HS10-AUTO-INJECTION-GUARD** | `cargo.hs_code` UEMOA reste géré par le chantier HS10 existant ; MAP-2 n'écrase pas ce contrat (cf. mémoire `HS Code Governance — strict 10-digit validation`). |

---

## 8. Gestion NSTR

Intégration de l'audit forensic Manus et du rapport ChatGPT §3.4.

### 8.1 Faits

- 173 codes NSTR actifs (5 lignes quarantine `NSTR_NULL_CPA_ONLY`).
- 91 codes (52,6 %) → 1 seul NST 2007 group → **déterministes**.
- 82 codes (47,4 %) → ≥ 2 NST 2007 groups → **structurellement ambigus** (Eurostat `Methodology_NSTR-NST2007.doc` §3.2).
- Parmi ces 82 ambigus :
  - **18 convergent** vers une **seule** catégorie PAD finale → suggestion forte exploitable ;
  - **3** n'ont **aucune** règle PAD applicable → `blocked_no_tariff` ;
  - **61 critiques** → ≥ 2 catégories PAD distinctes possibles → `blocked_multiple_pad`.

### 8.2 Règles MAP

| Cas | Règle |
|---|---|
| NSTR explicite dans document client + NSTR → 1 NST → 1 PAD | Suggestion exploitable, validation opérateur recommandée (`confidence = 0.80`) |
| NSTR → multi-NST mais convergence vers **1 PAD** finale | Suggestion forte (`confidence = 0.60`), validation opérateur **obligatoire** |
| NSTR → multi-NST → multi-PAD | `blocked_multiple_pad`, **jamais** de choix automatique par fréquence |
| NSTR → 0 PAD | `blocked_no_tariff`, gap opérateur |
| NSTR null/quarantine | Ignoré, fallback aux niveaux inférieurs |

L'ambiguïté NSTR n'est **pas un bug** et ne doit pas être « nettoyée » — elle reflète la vérité Eurostat.

---

## 9. Gestion CPA

| Point | Statut |
|---|---|
| Cardinalité CPA → NST | Many-to-one déterministe (1 759 codes → 69 NST distincts, 0 % d'ambiguïté) |
| Présence en BL / factures / déclarations portuaires sénégalaises | **Très rare** (CPA = nomenclature économique Eurostat, pas commerciale) |
| Priorité MAP | **Secondaire** — dictionnaire de secours pour text-match (étape 5 cascade), pas extraction prioritaire |
| Note méthodologique | Garder le bridge `nst_cpa_mappings` actif en DB, ne pas l'inclure dans les patterns d'extraction OCR/IA |

---

## 10. Gestion IA / Web pour trouver HS / CN

Garde-fous absolus, alignés sur la doctrine PAD-R1B (coexistence réglementée IA UI / runtime déterministe) et sur la mémoire `Operator-in-the-loop categorization policy` :

| Garde-fou | Détail |
|---|---|
| **Zéro écriture automatique** | L'IA/Web ne peut JAMAIS écrire un fact `commodity.cn_code` / `pricing.pad_category` ni un alias dans `pad_designation_aliases`. |
| **Top 3 max** | Limite stricte de 3 candidats retournés par appel. |
| **Preuve obligatoire** | Chaque candidat doit porter `source_reference` non vide (URL, citation source, ID document). Sans preuve → rejet. |
| **Validation référentiel local** | Tout code proposé doit exister dans `nst_cn_mappings` / `nst_nhm_mappings` / `nst_groups`. Sinon rejet. |
| **Validation opérateur avant pricing** | `validation_status = suggested` jusqu'à action opérateur explicite ; jamais consommé par `run-pricing` tant que `accepted` n'est pas écrit. |
| **Log de justification** | Persisté dans `commodity_classification_candidates.source_reference` (Option C). |
| **Pas d'appel IA depuis `run-pricing`** | Doctrine PAD-R1B inviolable. L'IA reste cantonnée à `recommend-pad-category` (UI uniquement) et à une éventuelle Edge Function `suggest-commodity-classification` (MAP-8, jamais appelée par le pricing). |

---

## 11. Passage PAD → DROIT_PASSAGE

### 11.1 Lookup obligatoire

```
SELECT amount_xof, ...
FROM port_tariffs
WHERE provider = 'PAD'
  AND category = 'DROIT_PASSAGE'
  AND operation_type = <IMPORT | EXPORT | TRANSIT_IMPORT | TRANSIT_EXPORT | TRANSBORDEMENT>
  AND cargo_type = <CONTENEUR | CONVENTIONNEL>
  AND classification = <Tnn | Pnn | Cnn>
  AND is_active = true
LIMIT 1;
```

### 11.2 Règles invariantes

| Règle | Détail |
|---|---|
| `PORT_TAX` jamais famille parallèle | Géré par `findInvoiceLabelAlias` côté Lot B : warning informatif uniquement, jamais classifiant. Les 2 lignes legacy `port_tariffs.PORT_TAX` TRANSIT (Taleb_Quote_2024) restent isolées et ne sont pas la voie canonique. |
| `BLANK_IN_PDF ≠ 0` | 4 lignes BLANK_IN_PDF dans `PAD_BAREME_2006_DROIT_PASSAGE_FULL.csv` (124 lignes total, 120 PRESENT importées). Une absence de tarif PDF → gap `blocked_no_tariff`, jamais transformée en zéro applicable. |
| `T10 = 0` autorisé uniquement si PDF explicite | Le PDF 2006 stipule un tarif zéro pour T10 ; c'est un zéro applicable. Ne pas confondre avec BLANK_IN_PDF. |
| **T13 transit/transbordement conteneur → C01/C02/C03** | Remap selon taille conteneur, **uniquement** si `containerSizeToCxxMapping` est fourni en contexte (déjà implémenté Lot B). |
| **P01–P05 (réductions pêche) jamais auto** | Application réservée aux dossiers avec preuve documentaire opérateur (régime pêche, certificat). Pas d'application auto par MAP-2. |

---

## 12. Design UI opérateur (futur — MAP-5)

Écran à intégrer dans **CaseView / Cockpit** (pas de prototype dans MAP-2).

| Élément | Description |
|---|---|
| Bandeau désignation | `raw_designation` brute extraite + `normalized_designation` |
| Liste candidats code structuré | Top-N (≤ 3) avec colonnes : `code_type`, `proposed_code`, `source_kind` (badge), `evidence_level`, `source_reference` (lien) |
| Liste NST candidates | Issus de la projection `proposed_code → NST` |
| Liste PAD candidates | Issus de `pad_nst_recommendation_rules`, avec `confidence` et `requires_operator_validation` |
| Montant DROIT_PASSAGE estimé | Affiché **uniquement si** : (a) une seule catégorie PAD candidate, **ou** (b) opérateur a validé explicitement. Sinon affiché « TO_CONFIRM » sans montant. |
| Boutons d'action | `Accepter candidat` ; `Rejeter` ; `Demander précision client` (déclenche action communication cockpit) ; `Saisir manuellement catégorie PAD` ; `Copier justification` |
| Réliability indicator | Conformément à la mémoire `UI Reliability Indicators v2` : Calculated / To confirm / Estimated / Informative |
| Aucune écriture sans action opérateur | Conformément à la mémoire `Operator-in-the-loop categorization policy` |

L'UI consomme l'Edge Function read-only MAP-4 et écrit via `set-case-fact` standard sur acceptation.

---

## 13. États / statuts / gaps

| État | Gap mappé (Lot B) | Description |
|---|---|---|
| `blocked_missing_code` | `pricing.hs_or_nst_required` | Aucun code structuré exploitable, aucune désignation matchable |
| `blocked_multiple_pad` | `pricing.pad_classification_needs_review` | Plusieurs catégories PAD candidates, choix opérateur obligatoire |
| `blocked_no_tariff` | `pricing.pad_category_required` (variante) | Catégorie PAD résolue mais aucune ligne `port_tariffs` active correspondante (cas BLANK_IN_PDF, ou combinaison `operation_type × cargo_type × classification` non couverte) |
| `to_confirm_operator` | `pricing.pad_classification_needs_review` | Suggestion exploitable mais `requires_operator_validation = true` |
| `candidate_ready` | (aucun gap, à `confidence ≥ 0.85`) | Suggestion auto-applicable (sous shadow MAP-6 puis activation MAP-7) |
| `operator_confirmed` | (aucun) | Catégorie PAD écrite via `set-case-fact`, source `operator_confirmed` |
| `rejected` | — | Candidat marqué rejeté, conservé pour audit |
| `superseded` | — | Candidat remplacé par une décision opérateur ultérieure |

Mapping cohérent avec le helper `resolvePadClassification` (Lot B §1-§8) — aucun nouveau gap inventé.

---

## 14. Plan de lots recommandé MAP-3 → MAP-8

Toutes les phases ci-dessous sont **séparées** et exigent un GO CTO explicite. Aucune n'est démarrée par MAP-2.

### MAP-3 — Migration storage (migration-only)

- **Objectif** : créer la table `commodity_classification_candidates` (Option C) + whitelist des `fact_key` pivots (`commodity.cn_code`, `commodity.nhm_code`, `commodity.nstr_code`, `commodity.nst_code`, `pricing.pad_category` validée).
- **Fichiers potentiellement touchés** : nouvelle migration SQL, mise à jour `quote_facts` whitelist côté Edge Function `set-case-fact` (lecture seule du périmètre dans MAP-3 ; whitelist effective en MAP-5).
- **Interdictions** : pas de modification `run-pricing`, pas d'INSERT de candidats, pas d'UI, pas d'Edge Function de résolution.
- **Tests attendus** : migration applicable + rollback ; CHECK contraintes ; RLS validée (lecture authentifié, écriture restreinte).
- **GO** : tables créées vides, contraintes vertes, RLS conforme `SECURITY_CONTRACT.md`. **NO-GO** : conflit FK, RLS permissive.

### MAP-4 — Edge Function read-only `resolve-commodity-classification-candidates`

- **Objectif** : implémenter la cascade §6 en Edge Function read-only consommant `nst_cn_mappings`, `nst_nhm_mappings`, `nst_cpa_mappings`, `nstr_nst2007_mappings`, `pad_nst_recommendation_rules`, `pad_designation_aliases`. Réutilise `supabase/functions/_shared/pad/` (helper Lot B).
- **Fichiers potentiellement touchés** : nouvelle Edge Function `supabase/functions/resolve-commodity-classification-candidates/index.ts`, copie miroir des helpers `_shared/pad/*` si nécessaire, `supabase/config.toml` (auth/JWT bloc dédié si requis).
- **Interdictions** : pas de modification `run-pricing` ni `get-pad-nst-suggestions`, pas d'INSERT auto dans `commodity_classification_candidates` (lecture/calcul uniquement, persistance par appelant).
- **Tests attendus** : tests Deno couvrant les 7 niveaux de cascade, T13 transit, NSTR convergent/critique, HS6 multi-CN8, BLANK_IN_PDF.
- **GO** : 100 % tests verts, `verify_jwt = true`, pas d'appel IA. **NO-GO** : régression Lot B, appel IA, écriture DB.

### MAP-5 — UI opérateur CaseView

- **Objectif** : composant React de validation candidats + intégration Cockpit. Écrit les facts validés via `set-case-fact` après action opérateur explicite. Insert dans `commodity_classification_candidates` au moment du calcul (suggestion) et à l'acceptation/rejet.
- **Fichiers potentiellement touchés** : nouveau composant `src/components/case/CommodityClassificationPanel.tsx`, intégration dans `useCockpitState`, mise à jour `useQuoteCaseData`.
- **Interdictions** : pas de modification `run-pricing`, pas d'écriture sans clic opérateur, conformité stricte `Operator-in-the-loop categorization policy` + `Manual Data Protection Policy v2`.
- **Tests attendus** : tests composant + e2e (acceptation, rejet, supersedure, multi-PAD blocking).
- **GO** : zéro écriture sans interaction opérateur, gaps cockpit cohérents avec helper Lot B. **NO-GO** : auto-écriture, contournement RLS.

### MAP-6 — Shadow-mode `PAD_RESOLVER_SHADOW`

- **Objectif** : activer feature flag `PAD_RESOLVER_SHADOW=true` qui fait tourner MAP-4 **en parallèle** de la résolution actuelle `run-pricing` (alias-based) et logge les divergences. Aucune écriture pricing modifiée.
- **Fichiers potentiellement touchés** : `run-pricing` (ajout d'un appel parallèle MAP-4 sous flag, log uniquement), nouvelle table de log `pad_resolver_shadow_log` ou réutilisation existante.
- **Interdictions** : pas de modification de la résolution effective, pas de blocage pricing supplémentaire, flag OFF par défaut.
- **Tests attendus** : flag OFF = zéro impact ; flag ON = log complet, parité fonctionnelle.
- **GO** : 50+ dossiers réels comparés sans régression. **NO-GO** : impact perf > 10 % ou divergence non documentée > 30 %.

### MAP-7 — Activation partielle `OFFICIAL_EXACT_CODE_SINGLE_PAD`

- **Objectif** : dans `run-pricing`, autoriser MAP-4 à fournir la catégorie PAD **uniquement** dans le cas `OFFICIAL_EXACT_CODE_SINGLE_PAD` (code structuré explicite + 1 NST + 1 PAD). Tous les autres cas restent opérateur.
- **Fichiers potentiellement touchés** : `run-pricing` (priorité avant alias-based si fact `commodity.cn_code` ou `commodity.nhm_code` validé existe).
- **Interdictions** : pas d'activation des autres niveaux cascade, pas de text-match auto, pas d'IA.
- **Tests attendus** : couverture `OFFICIAL_EXACT_CODE_SINGLE_PAD` ≥ 95 % sur dossiers shadow MAP-6 ; régression IMPORT/CONTENEUR = 0.
- **GO** : sign-off CTO + pas de régression. **NO-GO** : régression run-pricing.

### MAP-8 — Extension IA / Web HS suggestion

- **Objectif** : Edge Function `suggest-commodity-hs-code` (IA bornée, top 3 + preuve) consommée **uniquement** par l'UI MAP-5 pour enrichir les candidats. Jamais appelée par `run-pricing`. Conformité PAD-R1B.
- **Fichiers potentiellement touchés** : nouvelle Edge Function, intégration UI MAP-5.
- **Interdictions** : zéro appel depuis `run-pricing`, top 3 strict, preuve obligatoire, validation référentiel local.
- **Tests attendus** : refus si pas de preuve, refus si code hors référentiel, top 3 max.
- **GO** : sign-off CTO + couverture tests garde-fous. **NO-GO** : sans validation opérateur intermédiaire.

---

## 15. Risques

| Risque | Niveau | Mitigation MAP |
|---|---|---|
| Faux positif textuel (« rice in bags » → T12 vs T05) | Élevé | Cascade priorise codes structurés (§6) ; text-match toujours `requires_operator_validation = true` |
| Confusion HS10 UEMOA / CN8 | Élevé | §7 : interdiction d'inventer CN8 depuis HS10 ; troncature HS6 uniquement |
| NSTR conflictuel (61 codes critiques) | Moyen | §8 : `blocked_multiple_pad`, jamais de choix par fréquence |
| BLANK_IN_PDF traité comme 0 | Élevé | §11 : `BLANK_IN_PDF ≠ 0`, gap explicite `blocked_no_tariff` |
| Réintroduction `PORT_TAX` famille parallèle | Critique | Invariant CTO : `DROIT_PASSAGE` unique ; helper Lot B le garantit |
| Auto-pricing sans validation | Critique | MAP-7 limité strictement à `OFFICIAL_EXACT_CODE_SINGLE_PAD` ; tout le reste opérateur |
| Dette data alias (`pad_designation_aliases` non maintenue) | Moyen | Alias devient fallback (étape 3 cascade), pas colonne vertébrale ; pas d'INSERT auto |
| Régression `run-pricing` IMPORT/CONTENEUR | Élevé | MAP-6 shadow-mode obligatoire avant MAP-7 ; tests régression smoke |
| RLS / sécurité table `commodity_classification_candidates` | Moyen | MAP-3 : RLS strict (lecture authentifié `case_id` du dossier opérateur, écriture via Edge Function uniquement) ; conformité `SECURITY_CONTRACT.md` |
| Régression HS10-AUTO-INJECTION-GUARD | Moyen | MAP-2 ne touche pas `cargo.hs_code` ; MAP-7 lecture seule de cette colonne |

---

## 16. Recommandation finale CTO

1. **Abandonner `pad_designation_aliases` comme chantier principal.** Le maintenir comme fallback (étape 3 de la cascade) et fermer définitivement l'élargissement du périmètre alias hors validations strictement requises. Conformité `PAD Alias Registry` mémoire (60 alias validés origine + 327 PAD-NOM-2 = 384, point d'arrêt).
2. **Prioriser CN / HS / NHM** dès qu'un code structuré est disponible ou peut être suggéré avec preuve.
3. **Construire d'abord le stockage candidat (MAP-3) + Edge Function de résolution read-only (MAP-4) + UI opérateur (MAP-5)** avant tout branchement runtime.
4. **Jamais de zero-touch.** Tout résultat `confidence < 1.0` ou `requires_operator_validation = true` exige action opérateur.
5. **Ne pas lancer Lot D** (activation `PAD_RESOLVER_SHADOW` prématurée). MAP-6 est le cadre validé pour l'activation shadow, sous flag, après MAP-3/4/5.
6. **MAPPING-TAX-CHAIN-0 reste OUVERT.** Sa clôture est conditionnée à la livraison de MAP-7 minimum (activation partielle `OFFICIAL_EXACT_CODE_SINGLE_PAD`).
7. **HS10-AUTO-INJECTION-GUARD reste indépendant.** Le contrat strict 10-digit existant (`HS Code Governance`) n'est ni renégocié ni étendu par MAP-2.

---

## 17. Verdict final

**`MAP_2_TECHNICAL_DESIGN_READY`**
**Statut backlog** : `📋 MAP-2 DESIGN DRAFT — awaiting CTO review`

Aucune implémentation runtime autorisée à ce stade. La séquence MAP-3 → MAP-8 est conditionnée à la revue CTO de ce document.
