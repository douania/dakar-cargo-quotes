# MAPPING-TAX-CHAIN-0 — Audit V2 (refresh post-MAP-7B)

**Date** : 2026-05-14
**Type** : Audit read-only / documentation-only — refresh de l'audit V1 du 2026-05-09
**Périmètre** : Re-vérifier l'état de la chaîne `CN 2024 / NHM 2025 / NSTR 1967 → NST 2007 → PAD → taxe portuaire` après les changements introduits par **MAP-7B** (propagation runtime de `cargo.hs_code` et `cargo.pad_category`).
**Garde-fous respectés** : aucune écriture DB, aucune migration, aucun patch runtime, aucune modification `src/` ni `supabase/functions/` ni `supabase/config.toml`, aucun seed, aucun dossier client touché. Audit V1 (`MAPPING_TAX_CHAIN_0_AUDIT.md`) **non modifié** — V2 est un document additif.

---

## §1 — Refresh exécutif Q1 / Q2 / Q3 (post-MAP-7B)

| # | Question | Réponse V2 | Évolution vs V1 |
|---|----------|-----------|-----------------|
| **Q1** | La chaîne peut-elle proposer **automatiquement une catégorie PAD** depuis un code CN, NHM ou NSTR figurant sur un document client ? | **NON automatique — partiellement débloqué côté HS10/PAD** | V1 : NON (chaîne ne pouvait pas démarrer car aucun pivot). V2 : **MAP-7B propage désormais `cargo.hs_code` (HS10 UEMOA, regex `^\d{10}$`) et `cargo.pad_category` (regex `^[TPC][0-9]{2}$`) en runtime**. Mais CN/NHM/NSTR/NST **toujours bloqués** : refusés par le wrapper avec `candidate_kind_not_whitelisted` + `deferred_to: MAPPING-TAX-CHAIN-0`. Aucun bridge `nst_cn_mappings` / `nst_nhm_mappings` / `nstr_nst2007_mappings` / `nst_cpa_mappings` lu par aucune Edge Function. |
| **Q2** | La chaîne peut-elle calculer **automatiquement un montant PAD / taxe portuaire** depuis cette chaîne ? | **NON pour `PORT_TAX` ; PARTIEL côté `DROIT_PASSAGE` / `THD`** | V1 : `port_tariffs.PORT_TAX` = 2 lignes TRANSIT only. V2 : **toujours 2 lignes PORT_TAX TRANSIT only**, mais `port_tariffs` a doublé (98 → **218** lignes actives) et **`DROIT_PASSAGE` (38 IMPORT × 14 T-classes) + `THD` (19 IMPORT × 14 T-classes) sont désormais joignables sur `cargo.pad_category`** (T01..T14). Donc une fois `cargo.pad_category` fixé par MAP-7B, un montant DROIT_PASSAGE/THD IMPORT peut être résolu — mais **pas un PORT_TAX IMPORT** (toujours absent). |
| **Q3** | La chaîne peut-elle proposer **automatiquement une charge compagnie / carrier** ? | **HORS CHAÎNE** (inchangé) | Couvert par `CARRIER-PORT-TAX-1B`. Aucun lien CN/NHM/NSTR → carrier charges. |

**Verdict net V2** : chaîne automatique complète CN/NHM/NSTR → NST → PAD → taxe portuaire = **toujours NON**. Mais la **partie aval** (PAD → taxe portuaire IMPORT) est **désormais activée pour `DROIT_PASSAGE` et `THD`** via `cargo.pad_category`, sous réserve que la catégorie PAD soit fixée à la main ou via MAP-7B (propagation depuis un candidat operator-validated). La **partie amont** (CN/NHM/NSTR → NST → PAD) reste dormante.

---

## §2 — Delta DB vs audit V1

| Table | V1 (2026-05-09) | V2 (2026-05-14) | Δ | Commentaire |
|-------|-----------------|-----------------|---|-------------|
| `nst_divisions` | 20 | **20** | 0 | divisions 15 et 20 toujours absentes en `nst_groups` (gap inchangé) |
| `nst_groups` | 73 | **73** | 0 | toujours 73/81 attendus |
| `nst_cn_mappings` | 9 762 | **9 762** | 0 | dormant |
| `nst_nhm_mappings` | 15 079 | **15 079** | 0 | dormant |
| `nstr_nst2007_mappings` | 9 781 (5 quarantine) | **9 781 (5 quarantine)** | 0 | dormant |
| `nst_cpa_mappings` | 1 759 | **1 759** | 0 | dormant |
| `pad_nst_recommendation_rules` | 88 (60 group + 14 div actifs) | **88 (88 actifs)** | + actifs | passage de 74 → 88 actifs (toutes les règles en `is_active=true`). Toujours uniquement lue par `get-pad-nst-suggestions`. |
| `pad_designation_aliases` | 384 | **384** | 0 | active runtime (run-pricing + recommend-pad-category) |
| `port_tariffs` | 98 | **218** | **+120** | **doublement** : enrichissement DROIT_PASSAGE / THD / autres catégories. PORT_TAX inchangé (2). |
| `commodity_categories` | 19 | **19** | 0 | inchangé |

### 2.1 Re-mesure ambiguïtés

| Mapping | V2 unicité | Note |
|---------|-----------|------|
| `cn_code → nst_group_code` | **100,0 %** unique sur 9 762 codes CN distincts | non ambigu |
| `nhm_code → nst_group_code` | **100,0 %** unique sur 15 079 codes NHM distincts | non ambigu |
| `nstr_code → nst2007_code` | **52,6 %** unique sur 173 codes NSTR distincts (hors quarantine) | **ambiguïté forte** — 47,4 % des NSTR mappent vers ≥2 codes NST |
| `nst_code → pad_category` | **81,1 %** unique sur 74 règles NST actives | ambiguïté résiduelle 18,9 % |

→ Les bridges CN et NHM sont déterministes ; NSTR et NST→PAD requièrent une politique de désambiguïsation (priorité, confiance, contexte).

### 2.2 Re-mesure `port_tariffs.PORT_TAX`

```
PORT_TAX | TRANSIT | Conteneur léger <15t      → 1 ligne
PORT_TAX | TRANSIT | Conteneur standard 15-25t → 1 ligne
```

→ **Aucune ligne IMPORT ajoutée depuis V1**. Le pivot `pad_category × PORT_TAX × IMPORT` reste **vide**.

### 2.3 Découverte V2 — catégories nouvellement joignables sur `pad_category`

```
DROIT_PASSAGE  IMPORT          : 38 lignes  (14 T-classes T01..T14)
DROIT_PASSAGE  EXPORT          : 37 lignes
DROIT_PASSAGE  TRANSBORDEMENT  : 15 lignes
DROIT_PASSAGE  TRANSIT_EXPORT  : 15 lignes
DROIT_PASSAGE  TRANSIT_IMPORT  : 15 lignes
THD            IMPORT          : 19 lignes  (14 T-classes T01..T14)
THC            IMPORT          : 8 lignes
THC            EXPORT          : 7 lignes
```

→ Un dossier IMPORT avec `cargo.pad_category` fixé peut désormais résoudre automatiquement DROIT_PASSAGE et THD. C'est un changement structurel important non couvert par V1.

---

## §3 — État des clés pivots runtime

| Clé pivot | Présence DB (`quote_facts.fact_key`) | Propagation MAP-7B | Consommateurs runtime | Verdict |
|-----------|--------------------------------------|--------------------|-----------------------|---------|
| `cargo.hs_code` | ✅ 175 facts (15 `is_current`), sources : `manual_input`, `document_regex`, `attachment_extracted`, `ai_extraction`, `email_body` | ✅ wrapper accepte `hs10_uemoa` (regex `^\d{10}$`) | `run-pricing`, `set-case-fact`, `analyze-case-coherence`, `qualify-quotation-minimal`, `client-gap-policy`, `useQualifiedScopeGate`, `scopeQualification`, `case-view/constants` | **Pivot actif** |
| `cargo.pad_category` | ✅ 5 facts (3 `is_current`), sources : `manual_input`, `operator` | ✅ wrapper accepte `pad_category` (regex `^[TPC][0-9]{2}$`) | `run-pricing`, `set-case-fact`, `PricingResultPanel`, `PadNstSuggestionsPanel`, `DesignationSuggestionBlock`, `CaseView`, `case-view/constants` | **Pivot actif** |
| `commodity.cn_code` | ❌ 0 fact en DB | ❌ wrapper refuse `cn8` → `candidate_kind_not_whitelisted` | aucun consommateur runtime | **Bloqué** |
| `commodity.hs_code` | ❌ 0 fact en DB | n/a (HS10 propagé sous `cargo.hs_code`) | aucun consommateur runtime | **Obsolète** (remplacé par `cargo.hs_code`) |
| `commodity.nhm_code` | ❌ 0 fact en DB | ❌ wrapper refuse `nhm` | aucun consommateur runtime | **Bloqué** |
| `commodity.nst_code` | ❌ 0 fact en DB | ❌ wrapper refuse `nst2007` | aucun consommateur runtime | **Bloqué** |
| `commodity.nstr_code` | ❌ 0 fact en DB | ❌ wrapper refuse `nstr` | aucun consommateur runtime | **Bloqué** |
| `pricing.pad_category` | ❌ 0 fact en DB | n/a (PAD propagé sous `cargo.pad_category`) | aucun consommateur runtime | **Obsolète** (remplacé par `cargo.pad_category`) |

**Note sur les facts MAP-7B en production** : la requête `value_json->>'origin' = 'MAP-7B'` retourne **0 résultat** — aucune propagation MAP-7B effective n'a encore été enregistrée sur un dossier réel. Les 175 / 5 facts `cargo.hs_code` / `cargo.pad_category` actuels proviennent des chemins existants pré-MAP-7B (extraction email, manual_input via `set-case-fact`, AI extraction). MAP-7B est donc **disponible** mais **jamais déclenché en runtime client à ce jour**.

---

## §4 — Liste des consommateurs runtime réels (par table / clé)

### 4.1 Edge Functions

| Table / clé | Consommateurs Edge |
|-------------|-------------------|
| `cargo.hs_code` | `run-pricing`, `set-case-fact`, `analyze-case-coherence`, `qualify-quotation-minimal`, `_shared/client-gap-policy` |
| `cargo.pad_category` | `run-pricing`, `set-case-fact` |
| `pad_designation_aliases` | `run-pricing` (L1964), `recommend-pad-category` |
| `pad_nst_recommendation_rules` | `get-pad-nst-suggestions` **uniquement** (isolé, non branché à `run-pricing`) |
| `nst_cn_mappings` | **aucun** (dormant) |
| `nst_nhm_mappings` | **aucun** (dormant) |
| `nstr_nst2007_mappings` | **aucun** (dormant) |
| `nst_cpa_mappings` | **aucun** (dormant) |
| `nst_groups` | **aucun** (dormant) |
| `nst_divisions` | **aucun** (dormant) |
| `port_tariffs` | `run-pricing`, `quotation-engine`, `price-service-lines`, `analyze-attachments`, `ack-pricing-ready`, `generate-response`, `_shared/pad/resolvePadClassification` |

### 4.2 Frontend `src/`

| Table / clé | Consommateurs `src/` |
|-------------|----------------------|
| `cargo.hs_code` | `pages/case-view/constants.ts`, `hooks/useQualifiedScopeGate.ts`, `lib/scopeQualification.ts` |
| `cargo.pad_category` | `pages/case-view/constants.ts`, `pages/CaseView.tsx`, `components/puzzle/PricingResultPanel.tsx`, `components/case/PadNstSuggestionsPanel.tsx`, `components/case/DesignationSuggestionBlock.tsx` |
| `pad_designation_aliases` | `components/case/DesignationSuggestionBlock.tsx`, `components/admin/PadAliasTab.tsx`, `lib/pad/resolvePadClassification.ts` |
| `pad_nst_recommendation_rules` | référence types uniquement (`integrations/supabase/types.ts`) |
| `nst_cn_mappings` / `nst_nhm_mappings` / `nstr_nst2007_mappings` / `nst_cpa_mappings` | **aucun** consommateur applicatif — uniquement `integrations/supabase/types.ts` (auto-généré) |
| `port_tariffs` | `pages/admin/PortTariffs.tsx`, `pages/admin/TariffOverview.tsx`, `components/puzzle/PartnerScopeCard.tsx`, `components/puzzle/PartnerSuggestionPanel.tsx`, `features/quotation/components/ServiceLinesForm.tsx`, `components/AnalysisResultsDisplay.tsx`, `components/case/CaseUnderstandingPanel.tsx` |

→ **Confirmation V2** : les 4 tables-bridges NST (`nst_cn_mappings`, `nst_nhm_mappings`, `nstr_nst2007_mappings`, `nst_cpa_mappings`) sont **complètement dormantes** côté code applicatif. Seul le générateur de types Supabase les référence.

---

## §5 — Re-cadrage des options A / B / C / D (post-MAP-7B)

### Option A — Connecter les bridges runtime CN/NHM/NSTR → NST → PAD
- **V1** : option lourde, nécessite création de 4 jointures runtime + politique de désambiguïsation NSTR (47,4 % ambigus) + NST→PAD (18,9 % ambigus).
- **V2 — portée réduite** : `cargo.hs_code` (HS10) déjà propagé par MAP-7B → si l'on accepte que **HS10 est le pivot canonique amont**, les bridges CN/NHM/NSTR deviennent secondaires (HS10 → NST direct via `nst_cn_mappings.cn_code` n'existe pas — il faudrait une table `nst_hs10_mappings` non présente).
- **Pré-requis bloquants** : (i) couverture `nst_groups` 73/81 ; (ii) divisions 15 et 20 absentes ; (iii) politique de désambiguïsation NSTR ; (iv) politique NST→PAD pour les 18,9 % ambigus ; (v) **table `nst_hs10_mappings` à créer ou à brancher** si on souhaite partir de HS10 plutôt que CN/NHM/NSTR.

### Option B — Colonnes / facts pivots sur dossier
- **V1** : ajouter colonnes `cn_code` / `nhm_code` / `nstr_code` / `nst_code` sur `quote_facts` ou `cargo`.
- **V2 — partiellement réalisée** : `cargo.hs_code` et `cargo.pad_category` sont déjà des `fact_key` actifs et propagés par MAP-7B. **Reste à arbitrer** la création des facts `commodity.cn_code` / `commodity.nhm_code` / `commodity.nstr_code` / `commodity.nst_code`. Si arbitrage = NON, l'Option A est de facto inopérante côté pricing.

### Option C — Statu quo
- **V1** : recommandée.
- **V2 — toujours acceptable** si l'arbitrage business confirme que **MAP-7B (HS10 + PAD) suffit au pricing actuel** et que les nomenclatures CN/NHM/NSTR/NST restent du domaine documentaire / douanier hors pricing. Cette option est cohérente avec la décision MAP-7B (`hs6` / `cn8` / `nhm` / `nst2007` / `nstr` refusés car « not_consumed_by_pricing »).

### Option D — Table `pad_port_tax_amounts`
- **V1** : indépendante, pour produire des montants PORT_TAX IMPORT depuis `pad_category`.
- **V2 — toujours nécessaire pour fermer Q2 sur PORT_TAX**. **Découverte V2** : `DROIT_PASSAGE IMPORT` (38 lignes × 14 T-classes) et `THD IMPORT` (19 lignes × 14 T-classes) **fournissent déjà** des montants joignables sur `cargo.pad_category`, donc l'urgence d'une table `pad_port_tax_amounts` dédiée dépend de ce qu'on attend précisément de la « taxe portuaire » :
  - Si « taxe portuaire » ≡ DROIT_PASSAGE / THD → **Option D inutile**, `port_tariffs` suffit.
  - Si « taxe portuaire » ≡ catégorie `PORT_TAX` au sens littéral PAD → **Option D toujours requise** (PORT_TAX IMPORT toujours absent).

→ **Question d'arbitrage CTO non tranchée par cet audit.**

---

## §6 — Pré-requis bloquants identifiés

1. **Couverture `nst_groups` 73/81** (gap V1, inchangé V2). Les divisions 15 et 20 absentes empêchent toute résolution PAD pour les marchandises de ces divisions.
2. **Ambiguïté NSTR → NST 47,4 %** : nécessite une politique explicite (priorité, confiance, contexte) avant tout branchement runtime.
3. **Ambiguïté NST → PAD 18,9 %** : 14 règles NST mappent vers ≥2 catégories PAD ; même remarque.
4. **Absence de PORT_TAX IMPORT** dans `port_tariffs` (PORT_TAX = 2 lignes TRANSIT only depuis V1). Bloquant pour Q2 si « taxe portuaire » ≡ PORT_TAX strict.
5. **Absence de pivot `nst_hs10_mappings`** : si HS10 devient pivot canonique amont (cohérent MAP-7B), la chaîne HS10 → NST → PAD nécessite une nouvelle table de bridge non présente.
6. **Absence des facts `commodity.cn_code` / `commodity.nhm_code` / `commodity.nstr_code` / `commodity.nst_code`** : 0 ligne en DB ; aucun consommateur runtime ; le wrapper MAP-7B les refuse explicitement.
7. **MAP-7B jamais déclenché en runtime client à ce jour** (0 fact `value_json->>'origin' = 'MAP-7B'`) : la propagation est disponible mais inutilisée — il faut une décision sur l'activation effective côté UI / opérateurs (déjà documentée dans `MAP_6_EXEC_UI_DONE_ACCEPTED_AND_ROLLED_BACK`).

---

## §7 — Aucune recommandation d'exécution

Ce document est strictement un audit. Aucune Option A / B / C / D n'est ouverte par cet audit. Chaque option nécessitera un **GO CTO séparé** assorti d'un plan dédié (design + tests + rollback + GRANTs + impact pricing). Aucun chantier exécuté.

---

## §8 — Verdict

`MAPPING_TAX_CHAIN_0_AUDIT_V2_READY`

`MAPPING-TAX-CHAIN-0` reste **OUVERT** pour arbitrage futur. Audit V1 conservé en historique, V2 = source de vérité actuelle.
