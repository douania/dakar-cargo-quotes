# PAD-BAREME-2006-RUNTIME-EXPAND / HS-NST-PAD Resolver — Audit read-only et roadmap

**Date :** 2026-05-10  
**Repo audité :** `douania/dakar-cargo-quotes` — archive locale `dakar-cargo-quotes-work`  
**Branche demandée :** `work`  
**Vérification branche :** non vérifiable techniquement depuis l'archive fournie, car aucun dossier `.git` n'est présent. Le nom du dossier extrait contient toutefois `work`.  
**Mode :** CTO / Architecte production-grade — lecture seule, zéro patch runtime, zéro migration, zéro écriture DB.

---

## 0. Périmètre et garde-fous appliqués

### Documents canoniques lus

- `docs/MASTER_CONTEXT.md`
- `docs/STATUS_REGISTRY.md`
- `docs/SECURITY_CONTRACT.md`
- `docs/DEFERRED_BACKLOG.md`
- `.lovable/plan.md`

### Artefacts PAD 2006 lus

- `docs/tariff-collection/pad/PAD_BAREME_2006_DROIT_PASSAGE_FULL.csv`
- `docs/tariff-collection/pad/PAD_BAREME_2006_MANIFEST.json`
- `docs/tariff-collection/pad/validate_pad_csv.py`
- `docs/tariff-collection/pad/PAD_BAREME_2006_CSV_IMPORT_VALIDATOR_1_REPORT.md`
- `docs/tariff-collection/pad/PAD_BAREME_2006_CSV_IMPORT_VALIDATOR_1_REPORT.json`
- `docs/tariff-collection/pad/PAD_BAREME_2006_PHASE2_IMPORT_STRATEGY.md`
- `docs/tariff-collection/pad/PAD_BAREME_2006_PHASE2_IMPORT_DRAFT.sql`
- `docs/tariff-collection/pad/PAD_BAREME_2006_PHASE2_IMPORT_DRAFT_REVIEW.md`
- `docs/tariff-collection/pad/PAD_BAREME_2006_PHASE2_IMPORT_REPORT.md`
- `docs/tariff-collection/pad/PAD_BAREME_2006_PHASE2_SMOKE_TEST.md`

### Fichiers runtime et UI inspectés

- `supabase/functions/run-pricing/index.ts`
- `supabase/functions/recommend-pad-category/index.ts`
- `supabase/functions/get-pad-nst-suggestions/index.ts`
- `supabase/functions/build-case-puzzle/index.ts`
- `supabase/functions/price-service-lines/index.ts`
- `supabase/functions/quotation-engine/index.ts`
- `supabase/functions/set-case-fact/index.ts`
- `src/pages/CaseView.tsx`
- `src/components/case/DesignationSuggestionBlock.tsx`
- `src/components/case/PadNstSuggestionsPanel.tsx`
- `src/components/case/padNstConstants.ts`
- `src/lib/commoditySynonyms.ts`
- `src/lib/normalizeForMatch.ts`
- `src/pages/admin/CommodityCategories.tsx`
- `src/components/admin/PadAliasTab.tsx`
- `src/components/admin/CorrespondancesTab.tsx`
- `src/pages/admin/PortTariffs.tsx`

### Vérifications complémentaires

- Recherche ciblée `rg` sur : `pad_`, `PAD`, `DROIT_PASSAGE`, `PORT_TAX`, `taxe de port`, `port tax`, `NST`, `HS`, `hs_code`, `nst_code`, `classification`, `port_tariffs`, `recommend-pad-category`, `run-pricing`, `price-service-lines`, `build-case-puzzle`, `quotation-engine`.
- Inspection des migrations structurantes : `port_tariffs`, `commodity_categories`, `pad_designation_aliases`, tables NST, `pad_nst_recommendation_rules`, lignes legacy `PORT_TAX / Taleb_Quote_2024`.
- Inspection des fichiers racine `nst_cn2024.xlsx` et `nst_nhm2024.xlsx`.

### Garde-fous respectés

- Aucun code modifié dans `src/`.
- Aucun code modifié dans `supabase/functions/`.
- Aucune migration créée.
- Aucune écriture DB.
- Aucun import de données.
- Aucune modification de `run-pricing`, `recommend-pad-category`, `quotation-engine`, `build-case-puzzle`, `price-service-lines`.
- Aucune modification des rapports PAD Phase 2.
- Aucun runtime expand activé.

---

## 1. Résumé exécutif

### État actuel vérifié

Le chantier PAD Phase 2 data import est clos côté documentation et source SQL : le rapport Phase 2 indique `PHASE2_IMPORT_APPLIED`, avec 120 lignes `PRESENT` importées dans `port_tariffs`, 4 cellules `BLANK_IN_PDF` exclues, 19 lignes legacy `IMPORT / CONTENEUR` désactivées, et l'index unique partiel `port_tariffs_active_unique_key` appliqué.

Le smoke test Phase 2 indique `PAD_PHASE2_SMOKE_OK` : les 19 classifications `IMPORT / CONTENEUR` continuent d'être servies par exactement une ligne active, avec `T10 IMPORT / CONTENEUR = 0` conservé.

Le runtime actif reste volontairement étroit : `run-pricing` et `recommend-pad-category` ne consomment aujourd'hui que le scope sécurisé :

```text
provider = PAD
category = DROIT_PASSAGE
operation_type = IMPORT
cargo_type = CONTENEUR
classification = pad_category
is_active = true
```

### Objectif final

Construire une résolution fiable :

```text
désignation produit / code HS / code NST / libellé facture
→ catégorie PAD canonique
→ famille canonique DROIT_PASSAGE
→ ligne port_tariffs pertinente selon operation_type + cargo_type + container_size si nécessaire
→ ligne pricing traçable
```

### Verdict GO / NO-GO

**Verdict Phase 1 : `RUNTIME_EXPAND_AUDIT_READY`**, avec réserve stricte : la branche Git `work` n'est pas vérifiable depuis l'archive fournie, car `.git` est absent.

**GO pour préparer un plan de patch chirurgical.**  
**NO-GO pour activer directement le runtime expand.**

La raison du NO-GO runtime immédiat est structurelle : les données existent partiellement, mais il n'existe pas encore de resolver canonique qui combine désignation, HS, NST, libellé facture, opération, cargaison et taille conteneur. Brancher directement les tables existantes dans `run-pricing` risquerait de servir un tarif correct dans certains cas et faux dans d'autres.

---

## 2. Inventaire des tables et fichiers

| Table / fichier | Rôle vérifié ou supposé | Colonnes / champs importants | Couverture HS/NST/PAD | PORT_TAX / taxe de port | Statut |
|---|---|---|---|---|---|
| `port_tariffs` | Table tarifaire générique port / terminal / PAD | `provider`, `category`, `operation_type`, `classification`, `cargo_type`, `amount`, `unit`, `source_document`, `effective_date`, `is_active`, `evidence_level` | Contient les lignes PAD `DROIT_PASSAGE` Phase 2 | Contient aussi 2 lignes legacy `PORT_TAX` TRANSIT issues Taleb, selon audits existants | Actif mais hétérogène |
| `PAD_BAREME_2006_DROIT_PASSAGE_FULL.csv` | Source CSV PAD 2006 droits de passage | `rate_family`, `operation_type`, `cargo_type`, `classification`, `container_size_hint`, `amount_fcfa_per_tonne`, `cell_status` | 124 lignes dont 120 `PRESENT`, 4 `BLANK_IN_PDF` | `rate_family = DROIT_PASSAGE` partout ; pas de `PORT_TAX` | Source officielle locale gelée |
| `PAD_BAREME_2006_MANIFEST.json` | Manifest de contrôle CSV | Hash, cardinalités, enums, spots critiques | Confirme 124 lignes, 120 `PRESENT`, opérations IMPORT/EXPORT/TRANSIT/TRANSBORDEMENT | Pas de `PORT_TAX` | Source de contrôle gelée |
| `pad_designation_aliases` | Alias désignation / BL vers catégorie PAD | `bl_term`, `normalized_term`, `commodity_category_id`, `pad_category`, `is_validated`, `source_type` | Source PAD active dans `run-pricing`, `recommend-pad-category`, UI | Peut recevoir des alias facture si validés, mais n'a pas encore une typologie dédiée `invoice_label` | Actif |
| `commodity_categories` | Référentiel catégories marchandise | `designation_raw`, `designation_normalized`, `hs_chapter`, `pad_category`, `pad_category_label`, `cargo_type`, `evidence_level`, `is_validated` | Contient `pad_category` et seulement `hs_chapter`, pas HS complet | Pas de champ dédié aux libellés facture | Actif / incomplet pour HS-NST |
| `commodity_designation_matches` | Historique / corrections opérateur de correspondances désignation | `observed_term`, `normalized_term`, `commodity_category_id`, `pad_category_candidate`, `is_validated` | Utilisé par `DesignationSuggestionBlock` | Pas une famille tarifaire ; peut porter des termes observés | Actif UI |
| `nst_divisions` | Référentiel divisions NST 2007 | `division_code`, `label_en`, `label_fr` | 20 divisions d'après audit existant | Aucun | Donnée référentielle |
| `nst_groups` | Référentiel groupes NST 2007 | `group_code`, `division_code`, `label_en`, `label_fr` | 73 groupes présents selon audit existant, alors que 81 documentés | Aucun | Incomplet avant activation runtime complète |
| `nst_cn_mappings` | Mapping CN 2024 → NST 2007 | `cn_code`, `hs6_prefix`, `nst_group_code` | 9 762 lignes selon audit existant ; déterministe vers NST | Aucun | Donnée dormante |
| `nst_nhm_mappings` | Mapping NHM 2025 → NST 2007 | `nhm_code`, `nst_group_code` | 15 079 lignes selon audit existant ; déterministe vers NST | Aucun | Donnée dormante |
| `nstr_nst2007_mappings` | Mapping NST/R 1967 → NST 2007 | `nstr_code`, `nst2007_code`, `is_quarantined` | 9 781 lignes selon audit existant, 5 quarantaine ; ambiguïté forte | Aucun | Donnée dormante, non automatisable seule |
| `nst_cpa_mappings` | Mapping CPA → NST 2007 | `cpa_code`, `nst_group_code` | 1 759 lignes selon audit existant | Aucun | Donnée dormante |
| `nst_mapping_sources` | Traçabilité sources mappings NST | `source_name`, `source_type`, `sha256_hash`, `row_count`, `local_path` | Support de provenance | Aucun | Actif data |
| `pad_nst_recommendation_rules` | Recommandations NST → PAD | `nst_level`, `nst_code`, `pad_category`, `confidence`, `evidence_level`, `validation_status`, `requires_operator_validation`, `is_active` | 88 règles selon audit existant ; 60 group + 14 division actifs documentés | Aucun | Actif uniquement via assistance opérateur |
| `get-pad-nst-suggestions` | Edge function SELECT-only NST → PAD | Lit `pad_nst_recommendation_rules` | Retourne suggestions TO_CONFIRM uniquement | Aucun | Actif, non branché au pricing |
| `PadNstSuggestionsPanel.tsx` | UI opérateur NST → PAD | Charge `nst_groups`, `nst_divisions`, appelle `get-pad-nst-suggestions` | Suggestions affichées, copie presse-papiers uniquement | Aucun | Assistance opérateur |
| `recommend-pad-category` | Edge function IA PAD par désignation | Lit alias validés + tarifs IMPORT/CONTENEUR | IA propose ; code valide catégories et choisit conservateur | Ne traite pas `PORT_TAX` | Actif, TO_CONFIRM par opérateur |
| `nst_cn2024.xlsx`, `nst_nhm2024.xlsx` | Fichiers racine nommés xlsx | Inspection locale : documents HTML Cloudflare, pas des xlsx valides | Non exploitables | Aucun | Résidus à supprimer après validation |
| `PORT_TAX / Taleb_Quote_2024` dans `port_tariffs` | Lignes historiques | `provider=PAD`, `category=PORT_TAX`, `operation_type=TRANSIT`, `cargo_type=CONTENEUR_20/40` | Hors chaîne PAD 2006 | Libellé commercial / legacy, pas preuve de famille officielle distincte | Legacy / à confirmer |

---

## 3. Architecture actuelle de résolution

### 3.1 Chemin actif principal dans `run-pricing`

```text
cargo.description
→ normalizePricingText
→ pad_designation_aliases.normalized_term exact + is_validated=true
→ pad_category
→ port_tariffs(provider=PAD, category=DROIT_PASSAGE, operation_type=IMPORT, cargo_type=CONTENEUR, classification=pad_category, is_active=true)
→ inputs.padCategory + inputs.padRateFcfaPerTon
→ ligne PAD_DROIT_PASSAGE si poids > 0
```

Caractéristiques vérifiées :

- Les facts opérateur `cargo.pad_category` priment sur l'alias automatique.
- Les collisions d'alias validés avec plusieurs catégories distinctes sont ignorées pour éviter une auto-résolution fausse.
- Le lookup tarif est limité à `IMPORT / CONTENEUR`.
- `.maybeSingle()` est utilisé sur le lookup tarif, ce qui reste acceptable tant que l'index unique partiel garantit une seule ligne active par clé complète.
- Si aucune catégorie PAD n'est résolue sur flux maritime, `run-pricing` crée un gap bloquant `pricing.pad_category` et ajoute une ligne placeholder `PAD_DROIT_PASSAGE` à 0 avec source `TO_CONFIRM`.

### 3.2 Chemin assistance IA / désignation

```text
goods_description
→ DesignationSuggestionBlock
→ commodity_designation_matches + commodity_categories + pad_designation_aliases
→ suggestions locales
→ si faibles : recommend-pad-category
→ IA propose catégories parmi T01..T14/P01..P05
→ opérateur confirme
→ set-case-fact(cargo.pad_category)
→ set-case-fact(cargo.pad_rate_fcfa_per_ton) si tarif trouvé
```

Caractéristiques vérifiées :

- L'IA ne crée pas une vérité officielle directement dans `run-pricing`.
- `recommend-pad-category` charge les tarifs `DROIT_PASSAGE / IMPORT / CONTENEUR` uniquement.
- La confirmation opérateur écrit dans `commodity_designation_matches` ou applique les facts dossier via `set-case-fact`.

### 3.3 Chemin NST actuel

```text
opérateur sélectionne manuellement un groupe/division NST dans l'UI
→ get-pad-nst-suggestions
→ pad_nst_recommendation_rules
→ suggestions PAD TO_CONFIRM
→ copie presse-papiers uniquement
→ aucune écriture quote_facts
→ aucun déclenchement run-pricing
```

Caractéristiques vérifiées :

- `PadNstSuggestionsPanel` lit `nst_groups` et `nst_divisions`.
- `get-pad-nst-suggestions` lit uniquement `pad_nst_recommendation_rules` avec `validation_status='candidate'` et `requires_operator_validation=true`.
- Le panneau ne persiste pas `nst_code`.
- Le bouton disponible est une copie presse-papiers ; il ne fait pas `set-case-fact`.

### 3.4 Chemin HS actuel

```text
cargo.hs_code
→ utilisé pour droits & taxes douane / DDP
→ validation contre hs_codes
→ pas de mapping HS → NST → PAD
```

Caractéristiques vérifiées :

- `cargo.hs_code` est accepté par `set-case-fact`.
- `build-case-puzzle` et `run-pricing` valident HS pour les flux DDP/droits & taxes douaniers.
- Aucun code actif ne transforme `cargo.hs_code` en `nst_code` puis en `pad_category`.

### 3.5 Chemin `PORT_TAX` legacy dans `quotation-engine`

`quotation-engine` contient encore une section qui cherche `t.category === 'PORT_TAX'` dans les tarifs PAD chargés. Ce chemin est distinct du bloc `run-pricing` PAD Droit de Passage. Les audits existants indiquent que les lignes `PORT_TAX` actives en base sont uniquement TRANSIT et issues `Taleb_Quote_2024`, avec statut `observed` après correction de provenance.

---

## 4. Diagramme textuel cible

```text
Entrées disponibles
  ├─ désignation marchandise
  ├─ code HS / CN / NHM / NST / NSTR si présent
  ├─ libellé facture : "taxe de port", "port tax", "taxe PAD", etc.
  ├─ operation_type : IMPORT / EXPORT / TRANSIT_IMPORT / TRANSIT_EXPORT / TRANSBORDEMENT
  ├─ cargo_type : CONTENEUR / CONVENTIONNEL
  └─ container_size : 20 / 40 / autre, si nécessaire

resolvePadClassification(...)
  ├─ priorité 1 : catégorie PAD déjà confirmée par opérateur
  ├─ priorité 2 : alias validé facture/désignation
  ├─ priorité 3 : mapping HS/CN exact vers NST, puis règles NST → PAD
  ├─ priorité 4 : mapping NST exact ou division fallback
  ├─ priorité 5 : désignation produit / référentiel local
  └─ priorité 6 : IA comme suggestion uniquement

Sortie resolver
  ├─ canonical_rate_family = DROIT_PASSAGE
  ├─ classification = Txx / Pxx / Cxx
  ├─ operation_type effectif
  ├─ cargo_type effectif
  ├─ container_size si requis
  ├─ confidence
  ├─ source
  ├─ reason
  ├─ needs_human_review
  └─ blocking_gap éventuel

Lookup tarif
  └─ port_tariffs(provider=PAD, category=DROIT_PASSAGE, operation_type, cargo_type, classification, is_active=true)

Pricing
  └─ ligne PAD_DROIT_PASSAGE traçable, OFFICIAL seulement si catégorie + tarif prouvés
```

---

## 5. Problèmes identifiés

### 5.1 Bloquants avant runtime expand

| ID | Problème | Pourquoi c'est bloquant | Recommandation |
|---|---|---|---|
| B1 | Pas de resolver canonique PAD | La logique est dispersée entre alias runtime, UI, IA, NST suggestions et engine legacy | Créer un helper pur `resolvePadClassification` avant intégration runtime |
| B2 | Pas de démarrage automatique HS/CN/NHM/NST depuis dossier | `quote_facts` accepte `cargo.hs_code`, mais aucun `nst_code`, `cn_code`, `nhm_code`, `nstr_code` n'est persisté | Ajouter d'abord modèle de facts / extraction, ou resolver depuis `cargo.hs_code` uniquement si mapping exact disponible |
| B3 | HS UEMOA 10 chiffres ≠ CN 8 chiffres directement garanti | Le mapping existant est CN 2024 → NST via `cn_code` et `hs6_prefix`. Utiliser directement un HS 10 sans règle de normalisation validée peut produire de faux liens | Définir normalisation HS10 → CN8/HS6 avec preuve métier avant automatisation |
| B4 | `pad_nst_recommendation_rules` reste TO_CONFIRM | Les règles NST → PAD sont candidates et nécessitent validation opérateur | Ne pas en faire une source OFFICIAL automatique |
| B5 | `operation_type` et `cargo_type` non intégrés dans la résolution PAD actuelle | Le lookup actif est hardcodé `IMPORT / CONTENEUR` | Le resolver doit exiger opération + cargaison avant lookup tarif élargi |
| B6 | T13 transit/transbordement ne se résout pas directement comme T13 conteneur | Page 8 utilise C01/C02/C03 pour conteneurs en pays tiers/transit/transbordement | Mapper T13 transit conteneur vers C01/C02/C03 selon taille seulement après validation |
| B7 | `PORT_TAX` legacy peut être confondu avec famille canonique | Il existe des lignes `PORT_TAX` historiques dans `port_tariffs`, mais le barème PAD 2006 source utilise `DROIT_PASSAGE` | Traiter `PORT_TAX` comme alias facture, pas comme famille active parallèle |
| B8 | P01–P05 pêche ont des tarifs de base, mais les réductions pêche ne sont pas modélisées | Appliquer automatiquement une réduction sans moteur dédié créerait un faux montant | Ne servir que le tarif de base, réductions dans un moteur séparé validé |

### 5.2 Non bloquants mais à traiter

| ID | Problème | Impact | Recommandation |
|---|---|---|---|
| N1 | `nst_groups` incomplet selon audit existant : 73/81 | Risque de trou si activation globale | Compléter ou documenter explicitement les 8 groupes absents avant go runtime large |
| N2 | `nstr_nst2007_mappings` ambigu | NSTR peu fiable pour décision automatique | Utiliser NSTR uniquement comme suggestion opérateur |
| N3 | Fichiers racine `nst_cn2024.xlsx`, `nst_nhm2024.xlsx` sont HTML Cloudflare | Confusion future | Supprimer ou déplacer en quarantaine après validation CTO |
| N4 | `commodity_categories.hs_chapter` trop large | Un chapitre HS ne suffit pas pour NST/PAD | Ne pas l'utiliser pour décision automatique |
| N5 | `DesignationSuggestionBlock` lookup taux ne filtre pas explicitement `cargo_type` | Aujourd'hui limité par usage UI, mais ambigu avec Phase 2 multi-cargo | Ajouter cargo_type au modèle cible avant runtime expand |

---

## 6. Modèle cible recommandé

### 6.1 Signature fonctionnelle

```ts
resolvePadClassification({
  designation,
  hs_code,
  cn_code,
  nhm_code,
  nstr_code,
  nst_code,
  invoice_label,
  operation_type,
  cargo_type,
  container_size,
  known_pad_category,
})
```

### 6.2 Sortie attendue

```ts
{
  canonical_rate_family: "DROIT_PASSAGE",
  classification: "T12",
  operation_type: "IMPORT",
  cargo_type: "CONTENEUR",
  container_size: null,
  confidence: 1.0,
  source: "operator_confirmed | validated_alias | hs_to_nst | nst_rule | designation_match | ai_suggestion",
  reason: "Explication courte et traçable",
  needs_human_review: false,
  blocking_gap: null,
  warnings: []
}
```

### 6.3 Règles strictes

1. `canonical_rate_family` doit rester `DROIT_PASSAGE` pour le barème PAD 2006.
2. `PORT_TAX`, `taxe de port`, `port tax`, `taxe PAD`, `frais de passage portuaire` sont des alias commerciaux vers `DROIT_PASSAGE`, pas une nouvelle famille tarifaire.
3. Aucune cellule `BLANK_IN_PDF` ne doit être transformée en 0.
4. `T10 = 0` uniquement si la ligne source est `PRESENT` dans le CSV/PDF.
5. L'IA ne peut jamais produire une source `OFFICIAL` sans validation opérateur ou alias validé.
6. Un tarif ne peut être servi que si la clé complète est déterminée : `provider`, `category`, `operation_type`, `classification`, `cargo_type`, et `container_size` si requis.
7. En cas de collision ou ambiguïté NST/PAD, le resolver doit retourner `needs_human_review=true`, pas un montant.

---

## 7. Priorité des sources

Hiérarchie recommandée :

1. **Catégorie PAD confirmée manuellement** : `cargo.pad_category` + tarif résolu sur clé complète.
2. **Alias validé facture ou désignation** : `pad_designation_aliases.is_validated=true`, avec typage futur recommandé `alias_kind = designation | invoice_label`.
3. **Mapping HS/CN/NHM exact** : uniquement si normalisation HS/CN validée et résultat NST unique.
4. **Mapping NST exact** : groupe NST prioritaire, division en fallback, toujours avec revue si ambigu.
5. **Désignation produit** : `commodity_designation_matches` / `commodity_categories`, score et statut de validation.
6. **IA** : suggestion uniquement, jamais source officielle sans confirmation.

---

## 8. Gestion des synonymes facture

### Synonymes à reconnaître

- `taxe de port`
- `port tax`
- `taxe PAD`
- `frais de passage portuaire`
- `droit de passage`
- `droits de passage`
- libellés carrier proches à inventorier : `TXI`, `port charges`, `port dues`, selon preuves factures

### Décision canonique

Ces libellés doivent pointer vers :

```text
canonical_rate_family = DROIT_PASSAGE
```

Ils ne doivent pas produire :

```text
category = PORT_TAX
```

sauf décision CTO documentée et source officielle distincte.

### Recommandation data model

Ne pas mélanger sans typage les alias désignation et les alias facture. Deux options propres :

- Option 1 : ajouter `alias_kind` à `pad_designation_aliases` (`designation`, `invoice_label`, `carrier_label`).
- Option 2 : créer une table dédiée `pad_invoice_label_aliases` avec `normalized_label`, `canonical_rate_family`, `confidence`, `validation_status`, `source_document`.

Pour un patch chirurgical initial, l'option 1 est moins lourde, mais elle nécessite une migration. Tant que cette migration n'est pas validée, la reconnaissance des libellés facture doit rester documentaire / UI, pas runtime automatique.

---

## 9. Gaps opérateur nécessaires

| Gap key proposé | Condition | Blocking | Message métier |
|---|---|---:|---|
| `pricing.pad_category_required` | Marchandise maritime taxable, aucune catégorie PAD résolue | Oui | Catégorie PAD nécessaire pour calculer les droits de passage |
| `pricing.cargo_type_required` | `cargo_type` absent alors que PAD doit être résolu | Oui | Conteneur ou conventionnel requis pour choisir la ligne PAD |
| `pricing.operation_type_required` | Opération non déterminée | Oui | IMPORT / EXPORT / TRANSIT / TRANSBORDEMENT requis |
| `pricing.container_size_required_for_T13_transit` | Transit/transbordement conteneur et catégorie conteneur à déterminer | Oui | Taille conteneur requise pour C01/C02/C03 |
| `pricing.hs_or_nst_required` | Désignation insuffisante et aucun code exploitable | Selon cas | Code HS/CN/NHM/NST demandé pour assistance classification |
| `pricing.pad_classification_needs_review` | Plusieurs catégories PAD plausibles | Oui avant montant | Validation opérateur requise |
| `pricing.invoice_label_unmapped` | Libellé facture inconnu | Non au début | Libellé à classer ou ignorer |
| `pricing.port_tax_alias_needs_review` | Libellé `PORT_TAX` ou équivalent détecté | Oui si montant demandé | Confirmer que le libellé correspond bien à `DROIT_PASSAGE` |

Note : le runtime actuel utilise déjà `pricing.pad_category`. La proposition ci-dessus recommande des clés plus explicites pour éviter de mélanger absence de catégorie, absence cargo type et ambiguïté facture.

---

## 10. Cas spéciaux à documenter obligatoirement

### 10.1 T13 transit / transbordement

Ne pas chercher automatiquement `classification = T13` pour un conteneur en transit/transbordement. Pour les pays tiers / transit / transbordement conteneur, les catégories page 8 sont `C01`, `C02`, `C03`. Le mapping C01/C02/C03 doit dépendre de la taille conteneur uniquement après validation métier de la nomenclature.

### 10.2 C01 / C02 / C03

Catégories conteneur page 8. Le CSV indique que la taille n'est pas explicitement nommée dans le tableau page 8 et renvoie à la nomenclature 2.3 pour confirmation. Donc :

- pas de mapping dur `C01=20`, `C02=40`, `C03=...` sans preuve documentaire ;
- si taille absente ou mapping non validé : gap `pricing.container_size_required_for_T13_transit` ou `pricing.pad_classification_needs_review`.

### 10.3 P01–P05 pêche

Les lignes `P01` à `P05` sont des tarifs de base dans le barème. Les réductions pêche ne doivent jamais être appliquées automatiquement sans règle dédiée, source officielle, critères d'éligibilité et tests.

### 10.4 BLANK_IN_PDF

Une cellule `BLANK_IN_PDF` signifie absence dans le PDF source. Elle ne doit jamais être convertie en 0, ni en fallback.

### 10.5 T10

`T10 = 0` est un vrai 0 uniquement sur les lignes confirmées `PRESENT` dans le CSV/PDF. Le 0 ne doit pas être généralisé aux cellules vides.

### 10.6 Taxe de port / port tax

`taxe de port` et `port tax` sont des libellés commerciaux probables pour la même charge métier que les droits de passage PAD. Ils doivent être normalisés vers `DROIT_PASSAGE`, pas créer une famille parallèle `PORT_TAX`.

---

## 11. Risques runtime détaillés

### 11.1 Lookups `port_tariffs`

| Chemin | Filtre actuel | Risque | Action cible |
|---|---|---|---|
| `run-pricing` PAD alias | PAD + DROIT_PASSAGE + IMPORT + CONTENEUR + classification + active | Sûr pour IMPORT/CONTENEUR, insuffisant pour runtime expand | Remplacer par resolver + clé complète dynamique |
| `recommend-pad-category` | PAD + DROIT_PASSAGE + IMPORT + CONTENEUR + active | Sûr pour suggestions import conteneur, pas pour autres flux | Ajouter contexte opération/cargo ou garder explicitement IMPORT/CONTENEUR |
| `DesignationSuggestionBlock` | PAD + DROIT_PASSAGE + IMPORT + active + classifications, sans cargo_type explicite | Risque d'ambiguïté avec multi-cargo après Phase 2 | Ajouter `cargo_type` au moment d'appliquer au dossier |
| `quotation-engine` `PORT_TAX` | Recherche `PORT_TAX` dans PAD tariffs chargés | Risque de confusion si `PORT_TAX` est réactivé/étendu | Ne pas utiliser pour barème PAD 2006 ; documenter legacy |
| `quotation-engine` `fetchOfficialTariffs` | `classification ilike %...%` si classification fournie | Risque de match large | Ne pas utiliser pour resolver PAD canonique |

### 11.2 `.maybeSingle()`

Les usages critiques PAD dans `run-pricing` reposent sur `.maybeSingle()`. Cela est acceptable uniquement avec l'index unique actif sur la clé complète. Si le runtime expand omet `cargo_type`, `operation_type` ou `classification`, `.maybeSingle()` pourrait casser ou masquer une ambiguïté. Le resolver doit donc refuser de chercher un tarif si la clé complète n'est pas connue.

### 11.3 IA

`recommend-pad-category` restreint les catégories à une liste valide, mais la source reste IA. Le code marque `requires_operator_confirmation=true`. Cette propriété doit rester inchangée : l'IA ne doit jamais écrire seule `cargo.pad_category` ni produire un montant officiel.

### 11.4 `PORT_TAX`

Les lignes legacy `PORT_TAX / Taleb_Quote_2024` ne doivent pas être utilisées comme barème officiel. Leur présence justifie une règle de nommage stricte : `PORT_TAX` = alias / legacy / libellé facture à requalifier, pas une famille tarifaire PAD active sans source officielle distincte.

---

## 12. Stratégie de patch par lots

### Lot A — Consolidation read-only mappings HS/NST/PAD + aliases facture

Objectif : figer l'inventaire utile sans runtime.

- Confirmer la couverture réelle des tables NST en DB.
- Confirmer la politique HS10 → CN8/HS6.
- Classer `PORT_TAX / Taleb_Quote_2024` : alias facture, mapping legacy ou désactivation hygiène.
- Définir la structure minimale pour les alias facture.

**Sortie attendue :** rapport data + décision CTO.

### Lot B — Resolver pur sans effet de bord

Objectif : créer une fonction pure testable, sans écriture DB, sans appel edge.

- Entrées : désignation, HS/CN/NHM/NST/NSTR, invoice_label, operation_type, cargo_type, container_size, known_pad_category.
- Sortie : classification, famille canonique, confidence, source, reason, gaps.
- Aucun appel direct `run-pricing` au départ.

**Sortie attendue :** helper + tests unitaires.

### Lot C — Intégration `run-pricing` contrôlée

Objectif : remplacer le bloc PAD hardcodé uniquement après tests Lot B.

- Garder le scope `IMPORT / CONTENEUR` en fallback sûr.
- Activer d'abord `IMPORT / CONVENTIONNEL` si tests passent.
- Puis activer EXPORT / TRANSIT / TRANSBORDEMENT par feature flag ou garde documentaire.

**Sortie attendue :** patch chirurgical `run-pricing` avec tests de non-régression.

### Lot D — UI / gaps opérateur

Objectif : transformer les ambiguïtés en décisions opérateur.

- Ajouter gaps spécifiques.
- Afficher source, confiance, raisons, alternatives.
- Ne jamais auto-appliquer NST/IA.

### Lot E — Tests métier

Objectif : prouver les cas critiques avant runtime expand.

- Tests unitaires resolver.
- Tests edge read-only.
- Smoke runtime contrôlés sur dossiers réels/synthétiques.

### Lot F — Runtime expand multi-opérations

Objectif : consommer les 120 lignes Phase 2 en production.

Ordre recommandé :

1. `IMPORT / CONTENEUR` déjà actif — non-régression.
2. `IMPORT / CONVENTIONNEL`.
3. `EXPORT / CONTENEUR`.
4. `EXPORT / CONVENTIONNEL`.
5. `TRANSIT_IMPORT` / `TRANSIT_EXPORT`.
6. `TRANSBORDEMENT`.
7. C01/C02/C03 après validation taille conteneur.

### Lot G — Règles pêche P01–P05 séparées

Objectif : traiter uniquement si besoin métier confirmé.

- Tarifs de base déjà disponibles.
- Réductions / exemptions / conditions : moteur séparé.
- Pas d'automatisation sans source officielle.

---

## 13. Tests minimum requis

| Test | Attendu |
|---|---|
| T10 import conteneur | Montant 0 seulement sur ligne `PRESENT` |
| T12 import conteneur cas smoke existant | 840 t × 4 780 = 4 015 200 FCFA |
| Import conventionnel T01 | Cherche `operation_type=IMPORT`, `cargo_type=CONVENTIONNEL`, classification T01 |
| Export conteneur | Ne réutilise pas les tarifs import |
| Export conventionnel avec T13 blank | Ne transforme pas `BLANK_IN_PDF` en 0 |
| Transit import conventionnel | Cherche `TRANSIT_IMPORT / CONVENTIONNEL` |
| Transit export conventionnel | Cherche `TRANSIT_EXPORT / CONVENTIONNEL` |
| Transbordement conventionnel | Cherche `TRANSBORDEMENT / CONVENTIONNEL` |
| T13 transit conteneur | Ne cherche pas T13 ; exige C01/C02/C03 ou taille validée |
| C01/C02/C03 | Mapping taille conteneur validé avant montant |
| P01–P05 | Tarif de base uniquement ; aucune réduction automatique |
| Libellé “taxe de port” | Reconnu comme alias vers `DROIT_PASSAGE`, pas `PORT_TAX` |
| Libellé “port tax” | Même comportement |
| Libellé legacy “PORT_TAX” | Ne crée pas une famille active parallèle |
| Collision alias PAD | Retour `needs_human_review=true`, aucun montant |
| NST ambigu | Retour suggestions TO_CONFIRM, aucun OFFICIAL |
| HS inconnu ou non normalisable | Gap `pricing.hs_or_nst_required` ou review |
| `BLANK_IN_PDF` | Jamais servi, jamais 0 |
| `.maybeSingle()` | Aucun lookup sans clé complète |

---

## 14. Recommandation CTO

### Ce qui peut être fait maintenant

- Créer un plan de patch Lot A/B, sans toucher aux fonctions FROZEN.
- Formaliser les alias facture `taxe de port / port tax → DROIT_PASSAGE`.
- Préparer un resolver pur avec tests, sans l'intégrer encore à `run-pricing`.
- Ajouter des tests unitaires sur les 120 lignes PAD Phase 2 depuis le CSV.

### Ce qui doit rester différé

- Activation runtime de EXPORT / TRANSIT / TRANSBORDEMENT.
- Mapping automatique T13 → C01/C02/C03.
- Application automatique des règles NST → PAD.
- Réductions pêche.
- Suppression ou désactivation des lignes `PORT_TAX` legacy tant qu'une décision CTO explicite n'est pas prise.

### Ce qui nécessite validation métier

- Normalisation HS10 UEMOA vers CN8/HS6 pour mapping NST.
- Interprétation exacte C01/C02/C03.
- Classement définitif des libellés compagnie : `TXI`, `port charges`, `port dues`, etc.
- Utilisation de NSTR dans l'assistance opérateur malgré ambiguïté.

### Ce qui ne doit jamais être automatisé sans preuve

- Convertir `BLANK_IN_PDF` en 0.
- Déclarer `PORT_TAX` comme taxe officielle distincte de `DROIT_PASSAGE` sans source officielle.
- Laisser l'IA écrire une catégorie PAD officielle sans validation.
- Servir un tarif PAD si `operation_type` ou `cargo_type` est absent.
- Appliquer une réduction pêche sans moteur dédié et source officielle.

---

## 15. Diff réel

Fichier créé uniquement :

```text
A docs/tariff-collection/pad/PAD_BAREME_2006_RUNTIME_EXPAND_AUDIT_AND_ROADMAP.md
```

Aucune autre modification volontaire.

---

## 16. Verdict final

**`RUNTIME_EXPAND_AUDIT_READY`**

Réserve : la branche Git `work` ne peut pas être confirmée techniquement depuis l'archive locale, car `.git` est absent. Cette réserve ne bloque pas l'audit read-only, mais elle devra être levée avant tout patch réel sur GitHub/Lovable.
