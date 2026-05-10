# PAD-BAREME-2006-RUNTIME-EXPAND — Lot A : plan de patch chirurgical

**Date :** 2026-05-10
**Repo :** `douania/dakar-cargo-quotes`
**Branche :** `work`
**Mode :** CTO / Architecte production-grade — read-only, zéro patch runtime, zéro migration, zéro écriture DB.
**Périmètre Lot A :** documentaire uniquement. Aucune ligne de code, aucune migration, aucun appel DB.

---

## 1. Confirmation repo + branche

- Repo cible : `douania/dakar-cargo-quotes`.
- Branche cible : `work`.
- Réserve héritée de l'audit RUNTIME_EXPAND : la vérification technique de la branche `.git` n'est pas possible depuis l'archive locale (déjà signalée dans `PAD_BAREME_2006_RUNTIME_EXPAND_AUDIT_AND_ROADMAP.md`, section 0). Cette réserve ne bloque pas le Lot A documentaire.

---

## 2. Liste des fichiers lus

### Documents canoniques de gouvernance

- `docs/MASTER_CONTEXT.md`
- `docs/STATUS_REGISTRY.md`
- `docs/SECURITY_CONTRACT.md`
- `docs/DEFERRED_BACKLOG.md`
- `.lovable/plan.md`

### Rapport d'audit RUNTIME_EXPAND (cadrage)

- `docs/tariff-collection/pad/PAD_BAREME_2006_RUNTIME_EXPAND_AUDIT_AND_ROADMAP.md`

### Artefacts PAD 2006

- `docs/tariff-collection/pad/PAD_BAREME_2006_DROIT_PASSAGE_FULL.csv`
- `docs/tariff-collection/pad/PAD_BAREME_2006_MANIFEST.json`
- `docs/tariff-collection/pad/PAD_BAREME_2006_PHASE2_IMPORT_REPORT.md`
- `docs/tariff-collection/pad/PAD_BAREME_2006_PHASE2_SMOKE_TEST.md`
- `docs/tariff-collection/pad/PAD_BAREME_2006_CSV_IMPORT_VALIDATOR_1_REPORT.md`
- `docs/tariff-collection/pad/PAD_BAREME_2006_CSV_IMPORT_VALIDATOR_1_REPORT.json`
- `docs/tariff-collection/pad/PAD_BAREME_2006_PHASE2_IMPORT_STRATEGY.md`
- `docs/tariff-collection/pad/PAD_BAREME_2006_PHASE2_IMPORT_DRAFT.sql`
- `docs/tariff-collection/pad/PAD_BAREME_2006_PHASE2_IMPORT_DRAFT_REVIEW.md`
- `docs/tariff-collection/pad/PAD_R1B_GOVERNANCE_DECISION.md`
- `docs/tariff-collection/pad/PAD_NST_2E_C_A_RUNTIME_PLAN.md`
- `docs/tariff-collection/pad/PAD_NST_2E_C_B_VERIFICATION_REPORT.md`

### Edge functions inspectées (lecture seule, non modifiées)

- `supabase/functions/run-pricing/index.ts`
- `supabase/functions/recommend-pad-category/index.ts`
- `supabase/functions/get-pad-nst-suggestions/index.ts`
- `supabase/functions/build-case-puzzle/index.ts`
- `supabase/functions/price-service-lines/index.ts`
- `supabase/functions/quotation-engine/index.ts`
- `supabase/functions/set-case-fact/index.ts`

### Frontend inspecté (lecture seule, non modifié)

- `src/components/case/DesignationSuggestionBlock.tsx`
- `src/components/case/PadNstSuggestionsPanel.tsx`
- `src/components/case/padNstConstants.ts`
- `src/lib/commoditySynonyms.ts`
- `src/lib/normalizeForMatch.ts`
- `src/pages/admin/PortTariffs.tsx`
- `src/pages/admin/CommodityCategories.tsx`

---

## 3. Confirmation de lecture du rapport d'audit RUNTIME_EXPAND

Le rapport `docs/tariff-collection/pad/PAD_BAREME_2006_RUNTIME_EXPAND_AUDIT_AND_ROADMAP.md` a été intégralement lu. Verdict porté par ce rapport :

> **`RUNTIME_EXPAND_AUDIT_READY`** — GO pour préparer un plan de patch chirurgical, NO-GO pour activer directement le runtime expand. Réserve : branche Git `work` non vérifiable depuis l'archive locale (`.git` absent).

Le présent plan Lot A s'appuie strictement sur les sections 2, 3, 5, 6, 7, 8, 10, 11, 12, 13 de cet audit. Aucune contradiction n'est introduite ; toute divergence est explicitement signalée.

---

## 4. Inventaire précis des tables / fichiers utiles HS / NST / PAD / aliases facture

### 4.1 Tables tarifaires et catégorielles

| Table | Rôle | Champs clés | Couverture HS/NST/PAD | Statut runtime |
|---|---|---|---|---|
| `port_tariffs` | Table tarifaire générique port / terminal / PAD | `provider`, `category`, `operation_type`, `cargo_type`, `classification`, `amount`, `unit`, `source_document`, `effective_date`, `is_active`, `evidence_level` | Contient les 120 lignes PAD `DROIT_PASSAGE` Phase 2 + 2 lignes legacy `PORT_TAX/Taleb_Quote_2024` | Actif. Index unique partiel `port_tariffs_active_unique_key` posé. Lookup runtime PAD verrouillé sur `IMPORT/CONTENEUR`. |
| `pad_designation_aliases` | Alias désignation / BL → catégorie PAD | `bl_term`, `normalized_term`, `commodity_category_id`, `pad_category`, `is_validated`, `source_type` | Source PAD active dans `run-pricing`, `recommend-pad-category`, UI | Actif. Pas de typage `alias_kind` aujourd'hui. |
| `commodity_categories` | Référentiel marchandises | `designation_raw`, `designation_normalized`, `hs_chapter`, `pad_category`, `pad_category_label`, `cargo_type`, `evidence_level`, `is_validated` | `pad_category` + `hs_chapter` (chapitre HS uniquement, pas HS complet) | Actif. Insuffisant pour HS exact ou NST. |
| `commodity_designation_matches` | Historique correspondances opérateur désignation | `observed_term`, `normalized_term`, `commodity_category_id`, `pad_category_candidate`, `is_validated` | Utilisé par `DesignationSuggestionBlock` | Actif UI. Pas une famille tarifaire. |

### 4.2 Tables NST / mappings codes

| Table | Rôle | Champs clés | Volume audit | Statut |
|---|---|---|---|---|
| `nst_divisions` | Référentiel divisions NST 2007 | `division_code`, `label_en`, `label_fr` | 20 divisions | Référentiel |
| `nst_groups` | Référentiel groupes NST 2007 | `group_code`, `division_code`, `label_en`, `label_fr` | 73/81 selon audit | Incomplet |
| `nst_cn_mappings` | CN 2024 → NST 2007 | `cn_code`, `hs6_prefix`, `nst_group_code` | 9 762 lignes | Dormant |
| `nst_nhm_mappings` | NHM 2025 → NST 2007 | `nhm_code`, `nst_group_code` | 15 079 lignes | Dormant |
| `nstr_nst2007_mappings` | NST/R 1967 → NST 2007 | `nstr_code`, `nst2007_code`, `is_quarantined` | 9 781 lignes (5 quarantaine) | Dormant, ambigu |
| `nst_cpa_mappings` | CPA → NST 2007 | `cpa_code`, `nst_group_code` | 1 759 lignes | Dormant |
| `nst_mapping_sources` | Provenance mappings NST | `source_name`, `source_type`, `sha256_hash`, `row_count`, `local_path` | — | Actif data |
| `pad_nst_recommendation_rules` | NST → PAD | `nst_level`, `nst_code`, `pad_category`, `confidence`, `evidence_level`, `validation_status`, `requires_operator_validation`, `is_active` | 88 règles (60 group + 14 division actifs) | TO_CONFIRM uniquement |

### 4.3 Aliases facture (libellés commerciaux)

Aucune table dédiée aujourd'hui. Les libellés `taxe de port`, `port tax`, `taxe PAD`, `frais de passage portuaire`, `PORT_TAX`, `TXI`, `port charges`, `port dues` ne sont pas indexés en base. Décision canonique de l'audit RUNTIME_EXPAND (section 8) :

- Ces libellés pointent vers `canonical_rate_family = DROIT_PASSAGE`.
- Ils ne créent pas la famille `category = PORT_TAX` sans décision CTO documentée.
- Lot A : reconnaissance documentaire uniquement, pas de table.
- Lot B futur : constante statique versionnée `pad_invoice_label_aliases.ts` (read-only en mémoire), avec migration optionnelle `alias_kind` (option 1 audit) repoussée à un GO CTO séparé.

### 4.4 Fichiers source PAD 2006

| Fichier | Rôle | Statut |
|---|---|---|
| `PAD_BAREME_2006_DROIT_PASSAGE_FULL.csv` | Source officielle locale gelée (124 lignes : 120 PRESENT + 4 BLANK_IN_PDF) | Frozen |
| `PAD_BAREME_2006_MANIFEST.json` | Manifest contrôle (hash, cardinalités, spots critiques) | Frozen |
| `PAD_BAREME_2006_PHASE2_IMPORT_REPORT.md` | Rapport import Phase 2 → `PHASE2_IMPORT_APPLIED` | Clos |
| `PAD_BAREME_2006_PHASE2_SMOKE_TEST.md` | Smoke test Phase 2 → `PAD_PHASE2_SMOKE_OK` | Clos |

### 4.5 Fichiers résiduels signalés

- `nst_cn2024.xlsx` et `nst_nhm2024.xlsx` à la racine : audit RUNTIME_EXPAND signale qu'il s'agit de réponses HTML Cloudflare déguisées en `.xlsx`, non exploitables. Recommandation : suppression / quarantaine après décision CTO. Pas dans le périmètre Lot A.

---

## 5. Chemins runtime actuellement actifs

### 5.1 PAD via alias désignation (chemin principal)

```text
cargo.description
  → normalizePricingText
  → pad_designation_aliases.normalized_term exact (is_validated=true)
  → pad_category
  → port_tariffs(provider=PAD, category=DROIT_PASSAGE,
                 operation_type=IMPORT, cargo_type=CONTENEUR,
                 classification=pad_category, is_active=true)
  → ligne PAD_DROIT_PASSAGE
```

- Scope verrouillé `IMPORT / CONTENEUR`.
- `cargo.pad_category` (fact opérateur) prime sur l'alias automatique.
- Collision multi-catégories sur même alias → ignorée pour éviter auto-résolution fausse.
- Lookup tarif via `.maybeSingle()` (sûr grâce à l'index unique partiel).
- Si pas de catégorie résolue sur flux maritime : gap bloquant `pricing.pad_category` + ligne placeholder `TO_CONFIRM`.

### 5.2 PAD via assistance IA (`recommend-pad-category`)

```text
goods_description
  → DesignationSuggestionBlock
  → suggestions locales (commodity_designation_matches + commodity_categories + pad_designation_aliases)
  → si faibles : recommend-pad-category (Edge IA)
  → IA propose T01..T14 / P01..P05
  → opérateur confirme
  → set-case-fact(cargo.pad_category) [+ cargo.pad_rate_fcfa_per_ton si trouvé]
```

- IA jamais consommée par `run-pricing`.
- IA jamais source `OFFICIAL` directe.
- Pick conservateur côté CODE (max rate parmi candidats) — pas l'IA.

### 5.3 NST → PAD (assistance UI)

```text
opérateur sélectionne groupe/division NST
  → get-pad-nst-suggestions (Edge SELECT-only)
  → pad_nst_recommendation_rules (validation_status=candidate, requires_operator_validation=true)
  → suggestions TO_CONFIRM
  → copie presse-papiers
```

- Aucune écriture `quote_facts`.
- Aucun déclenchement `run-pricing`.

### 5.4 HS douane (orthogonal)

```text
cargo.hs_code
  → set-case-fact accepté
  → build-case-puzzle / run-pricing utilisent HS pour DDP/droits & taxes douaniers
  → AUCUN mapping HS → NST → PAD aujourd'hui
```

### 5.5 Bloc legacy `PORT_TAX` dans `quotation-engine`

```text
fetchOfficialTariffs / quotation-engine
  → recherche t.category === 'PORT_TAX' dans tarifs PAD chargés
  → distinct du bloc run-pricing PAD DROIT_PASSAGE
  → ne consomme que les 2 lignes legacy Taleb_Quote_2024 (TRANSIT/CONTENEUR_20|40, statut observed)
```

- À ne pas confondre avec la famille canonique PAD 2006 `DROIT_PASSAGE`.
- À documenter avant d'approcher `quotation-engine` (FROZEN sans GO).

---

## 6. Risques exacts à corriger avant resolver

Repris fidèlement de l'audit RUNTIME_EXPAND (section 5).

### 6.1 Bloquants

| ID | Risque | Action prérequise |
|---|---|---|
| B1 | Pas de resolver canonique PAD | Créer helper pur `resolvePadClassification` (Lot B) |
| B2 | Pas de persistance `nst_code` / `cn_code` / `nhm_code` / `nstr_code` dans `quote_facts` | Ne pas brancher mapping HS/NST tant que modèle facts non décidé |
| B3 | HS UEMOA 10 chiffres ≠ CN 8 chiffres direct | Définir normalisation HS10 → CN8/HS6 avec preuve métier |
| B4 | `pad_nst_recommendation_rules` reste TO_CONFIRM | Jamais source OFFICIAL automatique |
| B5 | Lookup actif hardcodé `IMPORT/CONTENEUR` | Resolver doit exiger `operation_type` + `cargo_type` avant lookup élargi |
| B6 | T13 transit conteneur ≠ classification T13 directe | Mapper vers C01/C02/C03 selon taille après validation |
| B7 | `PORT_TAX` legacy ≠ famille canonique | Traiter `PORT_TAX` comme alias facture, jamais famille active parallèle |
| B8 | P01–P05 pêche : tarifs de base seulement | Aucune réduction pêche automatique sans moteur dédié validé |

### 6.2 Non-bloquants à traiter

| ID | Sujet | Action |
|---|---|---|
| N1 | `nst_groups` 73/81 | Documenter ou compléter avant runtime large |
| N2 | `nstr_nst2007_mappings` ambigu | NSTR = suggestion opérateur uniquement |
| N3 | Fichiers racine `nst_cn2024.xlsx` / `nst_nhm2024.xlsx` HTML Cloudflare | Quarantaine / suppression après CTO |
| N4 | `commodity_categories.hs_chapter` trop large | Pas de décision automatique sur chapitre HS |
| N5 | `DesignationSuggestionBlock` ne filtre pas `cargo_type` | Ajouter cargo_type au modèle cible avant runtime expand |

---

## 7. Proposition de design du resolver pur

### 7.1 Principes

- **Fonction pure** : pas d'appel réseau, pas d'appel DB, pas d'écriture, pas d'appel edge.
- **Inputs explicites** : tout ce que le runtime sait sur le dossier passe en arguments. Aucun import implicite de `supabase`.
- **Données de référence** : injectées en argument optionnel (`context: { aliases, padTariffsIndex, nstRules, invoiceLabelAliases }`) — l'appelant les charge une fois et les passe. Pour Lot A, cette interface n'est que documentaire.
- **Hiérarchie déterministe à 6 niveaux** (audit §7) :
  1. `operator_confirmed` — `known_pad_category` posée par opérateur.
  2. `validated_alias` — `pad_designation_aliases.is_validated=true` (désignation ou facture).
  3. `hs_to_nst` — `cargo.hs_code` → CN/HS6 normalisé → `nst_cn_mappings` ou `nst_nhm_mappings` → NST → règle NST→PAD validée.
  4. `nst_rule` — `nst_code` direct → `pad_nst_recommendation_rules` (groupe puis division en fallback).
  5. `designation_match` — `commodity_designation_matches` / `commodity_categories` validés.
  6. `ai_suggestion` — sortie IA déjà présente, jamais OFFICIAL sans confirmation.
- **Famille canonique invariante** : `canonical_rate_family = "DROIT_PASSAGE"` toujours. `PORT_TAX` interdit en sortie.
- **Refus de lookup partiel** : si `operation_type` ou `cargo_type` manque, le resolver ne propose pas de classification utilisable pour pricing — il retourne un `blocking_gap`.
- **Cas T13 transit** : si `operation_type ∈ {TRANSIT_IMPORT, TRANSIT_EXPORT, TRANSBORDEMENT}` et `cargo_type=CONTENEUR`, ne pas retourner `T13` ; exiger `container_size` puis remap vers `C01/C02/C03` après validation taille (Lot B/C).
- **BLANK_IN_PDF** : la sortie ne doit jamais déclencher la lecture d'une cellule `BLANK_IN_PDF`. La protection vient à la fois du resolver (ne pas pointer vers une classification absente du barème pour la combinaison) et du lookup `port_tariffs` (déjà filtré `is_active=true` et lignes BLANK non insérées en Phase 2).
- **T10 = 0** : préservé par le simple fait que le resolver pointe sur la classification, pas sur un montant. Le 0 vient de `port_tariffs` réellement présent.
- **Conflits / collisions** : retour `needs_human_review=true` + `blocking_gap`, jamais un montant.

### 7.2 Garde-fous explicites en sortie

- IA → `confidence ≤ medium`, `needs_human_review=true`, `source="ai_suggestion"`.
- Alias multi-PAD → `needs_human_review=true`, `blocking_gap="pricing.pad_classification_needs_review"`.
- Libellé facture sans alias mappé → `blocking_gap="pricing.invoice_label_unmapped"` non bloquant initialement.
- Libellé `PORT_TAX` détecté → `warnings += "port_tax_alias_treated_as_droit_passage"`.

---

## 8. Contrat d'entrée / sortie du resolver

### 8.1 Entrée

```ts
type ResolvePadInput = {
  // Catégorie déjà confirmée par l'opérateur (priorité 1 absolue)
  known_pad_category?: string | null;

  // Désignation marchandise (texte libre)
  designation?: string | null;

  // Codes nomenclatures
  hs_code?: string | null;        // HS UEMOA (souvent 10 chiffres)
  cn_code?: string | null;        // Combined Nomenclature 8
  nhm_code?: string | null;       // NHM rail
  nstr_code?: string | null;      // NST/R 1967
  nst_code?: string | null;       // NST 2007 (group XX.X ou division XX)

  // Libellé facture / commercial éventuel
  invoice_label?: string | null;

  // Contexte transport (obligatoires pour pouvoir mapper sur port_tariffs)
  operation_type:
    | "IMPORT"
    | "EXPORT"
    | "TRANSIT_IMPORT"
    | "TRANSIT_EXPORT"
    | "TRANSBORDEMENT";
  cargo_type: "CONTENEUR" | "CONVENTIONNEL";
  container_size?: 20 | 40 | string | null; // requis pour C01/C02/C03 transit conteneur
};
```

### 8.2 Sortie

```ts
type ResolvePadOutput = {
  canonical_rate_family: "DROIT_PASSAGE";  // invariant
  classification: string | null;            // T01..T14 / P01..P05 / C01..C03 ; null si gap
  operation_type: ResolvePadInput["operation_type"];
  cargo_type: ResolvePadInput["cargo_type"];
  container_size: ResolvePadInput["container_size"] | null;

  confidence: number;                       // 0.0 .. 1.0
  source:
    | "operator_confirmed"
    | "validated_alias"
    | "hs_to_nst"
    | "nst_rule"
    | "designation_match"
    | "ai_suggestion"
    | "none";
  reason: string;                           // explication courte traçable
  needs_human_review: boolean;
  blocking_gap:
    | "pricing.pad_category_required"
    | "pricing.cargo_type_required"
    | "pricing.operation_type_required"
    | "pricing.container_size_required_for_T13_transit"
    | "pricing.hs_or_nst_required"
    | "pricing.pad_classification_needs_review"
    | "pricing.invoice_label_unmapped"
    | "pricing.port_tax_alias_needs_review"
    | null;
  warnings: string[];
};
```

### 8.3 Invariants contractuels

1. `canonical_rate_family` est **toujours** `"DROIT_PASSAGE"`.
2. Si `classification === null` ou `needs_human_review === true`, **aucun lookup `port_tariffs` ne doit être lancé** par l'appelant.
3. Si `source === "ai_suggestion"`, `needs_human_review === true` obligatoirement.
4. `blocking_gap` est non-null dès qu'une donnée structurelle manque (operation/cargo/container_size pour transit conteneur).
5. Sortie déterministe : mêmes inputs → mêmes sortie (pas d'aléa, pas de timestamp, pas de RNG).

---

## 9. Emplacement recommandé du resolver

- Fichier helper pur : `src/lib/pad/resolvePadClassification.ts`.
- Types associés : `src/lib/pad/types.ts`.
- Tables de référence statiques (libellés facture) : `src/lib/pad/invoiceLabelAliases.ts`.
- Tests unitaires : `src/lib/pad/__tests__/resolvePadClassification.test.ts` (Vitest).
- Réutilisation côté Edge Functions : au Lot C, copie miroir locale dans `supabase/functions/_shared/pad/` (Deno n'importe pas `src/` directement). Le helper doit rester sans dépendance React/DOM pour permettre cette duplication.

Aucun de ces fichiers n'est créé au Lot A. Cette section décrit uniquement la cible Lot B.

---

## 10. Liste des fichiers à modifier dans un futur Lot B

**Création uniquement** (aucune édition de fichier existant) :

- `src/lib/pad/resolvePadClassification.ts` — helper pur.
- `src/lib/pad/types.ts` — types `ResolvePadInput` / `ResolvePadOutput`.
- `src/lib/pad/invoiceLabelAliases.ts` — constante statique versionnée (`taxe de port`, `port tax`, `taxe PAD`, `frais de passage portuaire`, `droit(s) de passage`, `PORT_TAX`, `TXI`, `port charges`, `port dues` → `DROIT_PASSAGE`). Marquage `confidence` + `requires_review` par entrée.
- `src/lib/pad/__tests__/resolvePadClassification.test.ts` — tests unitaires Vitest couvrant la matrice section 12.
- `docs/tariff-collection/pad/PAD_BAREME_2006_RUNTIME_EXPAND_LOT_B_REPORT.md` — rapport de réalisation Lot B.

Aucune migration. Aucune écriture DB. Aucun appel réseau dans le helper.

---

## 11. Liste des fichiers à NE SURTOUT PAS modifier

### Edge Functions (FROZEN sans `STRUCTURAL_PATCH_ALLOWED`)

- `supabase/functions/run-pricing/index.ts`
- `supabase/functions/recommend-pad-category/index.ts`
- `supabase/functions/get-pad-nst-suggestions/index.ts`
- `supabase/functions/build-case-puzzle/index.ts`
- `supabase/functions/price-service-lines/index.ts`
- `supabase/functions/quotation-engine/index.ts`
- `supabase/functions/set-case-fact/index.ts`
- Tout autre `supabase/functions/*` non listé.

### Données / DB

- Table `port_tariffs` (lignes Phase 2 + index unique partiel).
- Table `pad_designation_aliases`.
- Table `pad_nst_recommendation_rules`.
- Toutes les tables NST (`nst_*`, `nstr_*`).
- Aucune migration nouvelle.

### Sources PAD 2006

- `docs/tariff-collection/pad/PAD_BAREME_2006_DROIT_PASSAGE_FULL.csv`
- `docs/tariff-collection/pad/PAD_BAREME_2006_MANIFEST.json`
- `docs/tariff-collection/pad/PAD_BAREME_2006_PHASE2_IMPORT_REPORT.md`
- `docs/tariff-collection/pad/PAD_BAREME_2006_PHASE2_SMOKE_TEST.md`
- `docs/tariff-collection/pad/PAD_BAREME_2006_CSV_IMPORT_VALIDATOR_1_REPORT.{md,json}`
- `docs/tariff-collection/pad/PAD_BAREME_2006_PHASE2_IMPORT_DRAFT.sql`

### Fichiers générés par Supabase

- `src/integrations/supabase/client.ts`
- `src/integrations/supabase/types.ts`
- `.env`
- `supabase/config.toml`

### UI sensibles à PAD (lecture seule au Lot B)

- `src/components/case/DesignationSuggestionBlock.tsx`
- `src/components/case/PadNstSuggestionsPanel.tsx`
- `src/pages/admin/PortTariffs.tsx`

Toute modification de ces fichiers nécessite un GO CTO séparé (Lot C ou Lot D).

---

## 12. Stratégie de tests minimum

Tests unitaires Vitest sur `resolvePadClassification`. Tous purs, zéro DB.

| # | Cas | Inputs | Sortie attendue |
|---|---|---|---|
| 1 | Operator confirmed prime | `known_pad_category="T12"`, IMPORT/CONTENEUR | `source=operator_confirmed`, `classification="T12"`, `needs_human_review=false` |
| 2 | Alias validé désignation | `designation="riz"`, IMPORT/CONTENEUR (alias mappé T01) | `source=validated_alias`, `classification="T01"` |
| 3 | T10 = 0 réel (PRESENT) | `known_pad_category="T10"`, IMPORT/CONTENEUR | classification servie ; le 0 vient du lookup `port_tariffs`, pas du resolver |
| 4 | BLANK_IN_PDF jamais 0 | `known_pad_category="T13"`, EXPORT/CONVENTIONNEL | resolver retourne classification mais lookup en aval doit ne rien trouver ; resolver ajoute `warnings += "blank_in_pdf_possible_check_port_tariffs"` |
| 5 | T13 transit conteneur | `known_pad_category="T13"`, TRANSIT_IMPORT/CONTENEUR sans `container_size` | `blocking_gap="pricing.container_size_required_for_T13_transit"`, `classification=null`, `needs_human_review=true` |
| 6 | T13 transit conteneur 20' | idem + `container_size=20` | classification remap C01/C02/C03 selon table de mapping validée (table à fournir au Lot B ; sinon `needs_human_review=true`) |
| 7 | Collision multi-alias | `designation` matchant 2 alias validés vers T05 et T08 | `source=none`, `needs_human_review=true`, `blocking_gap="pricing.pad_classification_needs_review"` |
| 8 | NST ambigu | `nst_code="01.1"` retournant 2 règles `candidate` | `source=nst_rule`, mais `needs_human_review=true`, suggestions TO_CONFIRM seulement |
| 9 | HS exact connu | `hs_code="1006300000"` → CN8 → NST → règle PAD validée | `source=hs_to_nst`, `confidence=high` |
| 10 | HS inconnu / non normalisable | `hs_code="9999999999"` | `blocking_gap="pricing.hs_or_nst_required"` |
| 11 | Libellé facture `taxe de port` | `invoice_label="Taxe de port"`, IMPORT/CONTENEUR, sans `known_pad_category` | `canonical_rate_family="DROIT_PASSAGE"`, `warnings += "invoice_label_recognized_as_droit_passage"`, mais `classification=null` si pas d'autre signal → `blocking_gap="pricing.pad_category_required"` |
| 12 | Libellé `port tax` | idem | même comportement que #11 |
| 13 | Libellé legacy `PORT_TAX` | `invoice_label="PORT_TAX"` | jamais `category=PORT_TAX` en sortie ; `warnings += "port_tax_alias_treated_as_droit_passage"` |
| 14 | IA only | uniquement `designation` floue, alias absent, HS/NST absents | `source=ai_suggestion`, `needs_human_review=true`, `confidence ≤ medium` |
| 15 | `operation_type` manquant | absent | `blocking_gap="pricing.operation_type_required"` |
| 16 | `cargo_type` manquant | absent | `blocking_gap="pricing.cargo_type_required"` |
| 17 | P01–P05 pêche tarif de base | `known_pad_category="P02"`, IMPORT/CONTENEUR | classification servie ; resolver n'applique aucune réduction pêche |
| 18 | Idempotence | mêmes inputs deux fois | mêmes outputs strictement |
| 19 | Smoke T12 historique | reproduire le scénario smoke Phase 2 (T12, IMPORT, CONTENEUR) | classification `T12` ; arithmétique `840 t × 4 780 = 4 015 200 FCFA` reste vraie via lookup en aval (non testé dans le helper pur) |

Lot B livre tests 1, 2, 3, 5, 7, 8, 11, 13, 14, 15, 16, 17, 18 au minimum. Tests 4, 6, 9, 10, 19 dépendent de décisions data (mapping HS10, taille C01/C02/C03) à confirmer avant Lot C.

---

## 13. Risques de régression

### 13.1 Risques Lot A

**Aucun.** Lot A crée 2 fichiers Markdown documentaires. Zéro impact runtime, zéro impact DB, zéro impact build.

### 13.2 Risques anticipés Lot B (création helper pur)

| Risque | Mitigation |
|---|---|
| Le helper introduit une dépendance non isolée (React, fetch, Supabase) qui empêche sa réutilisation côté Deno | Helper pur, pas d'import `@/integrations/supabase/*`, pas de DOM, pas de `fetch`. Lint dédié dans la PR. |
| Drift entre `src/lib/pad/` et copie future `supabase/functions/_shared/pad/` | Repoussé au Lot C ; fichier source unique tant qu'aucun appel runtime |
| Tests Vitest cassent build CI | Tests scopés à `src/lib/pad/__tests__/` ; aucun changement ailleurs |
| Constante `invoiceLabelAliases` incomplète et activée trop tôt | Lot B = constante uniquement, jamais consommée par `run-pricing` ni `recommend-pad-category` |

### 13.3 Risques anticipés Lot C (intégration runtime)

À traiter au moment du GO CTO Lot C, hors scope de ce plan :

- Casser le smoke T12 (840 t × 4 780 = 4 015 200 FCFA).
- Casser T10 = 0 réel.
- Servir une cellule `BLANK_IN_PDF` comme 0.
- Réactiver inadvertance des lignes legacy `PORT_TAX`.
- Briser `.maybeSingle()` en élargissant le filtre sans clé complète.
- Activer EXPORT/TRANSIT/TRANSBORDEMENT sans validation métier des cas C01/C02/C03 et P01–P05.

---

## 14. Verdict final

### Garde-fous respectés au Lot A

- Aucun fichier `src/` modifié.
- Aucun fichier `supabase/functions/` modifié.
- Aucune migration créée.
- Aucune écriture DB.
- Aucune modification `port_tariffs`, `pad_designation_aliases`, `pad_nst_recommendation_rules`.
- Aucune modification CSV / manifest PAD 2006.
- Aucune modification des rapports PAD Phase 2.
- Aucune nouvelle Edge Function.
- Aucun mapping HS/NST/PAD inventé.
- Aucune transformation `BLANK_IN_PDF` → 0.
- Aucune réduction P01–P05 automatique.
- `DROIT_PASSAGE` reste la famille canonique unique.
- `PORT_TAX` reste un alias / legacy, pas une famille parallèle.

### Verdict

**`LOT_A_PATCH_PLAN_READY`**

Prochaine étape autorisée uniquement sur GO CTO séparé : **Lot B — création du helper pur `resolvePadClassification` + tests Vitest, sans intégration runtime**.
