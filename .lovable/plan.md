# Plan courant

## Lot 0 sécurisé — clôturé sur périmètre Lovable ✅

### Lot 0-A : runtime appliqué ✅
- `supabase/config.toml` : 3 entrées ajoutées (`backfill-case-documents`, `healthz`, `upsert-exchange-rate`)
- `src/pages/CaseView.tsx` : `QUOTED_VERSIONED` ajouté au guard principal auto-pricing
- `supabase/functions/generate-response/index.ts` : `created_by: userId` ajouté à l'insert `email_drafts`

### SEC-001 : Git hygiene — `closed_pending_rotation_review` ✅ (snapshot courant)
- `.gitignore` contient désormais `.env`, `.env.local`, `.env.*.local` (corrigé hors Lovable)
- `.env` n'est plus présent dans le snapshot ZIP/repo courant
- Statut : `closed_pending_rotation_review` côté snapshot Lovable

**Reste hors Lovable (condition de clôture définitive)** :
1. Audit historique Git : `git log --all --full-history -- .env`
2. Si une clé sensible a été exposée par un commit antérieur (service_role Supabase, secrets API tiers, SMTP) → rotation immédiate obligatoire
3. Si seul anon key + URL publique exposés → risque faible, rotation optionnelle
4. Documenter le résultat de l'audit pour passer à `closed`

---

## Lot 1 — TO_CONFIRM export 0 XOF : ✅ closed (2026-04-21)
- Fichier impacté : `supabase/functions/price-service-lines/index.ts`
- Marquage `source: "TO_CONFIRM"` pour services export placeholder (whitelist : `THC_EXPORT`, `DOCUMENTATION_BL`, `VGM_WEIGHING`, `STUFFING_FACTORY`, `STUFFING_CFS`, `EMPTY_REPO`, `PORT_CHARGES`, `CUSTOMS_EXPORT`, `SEA_FREIGHT`)
- `rate: null` conservé, lignes maintenues dans `missing[]`, `missing_quantity` non converti
- `normalizeSourceForAudit` mappe TO_CONFIRM → no_match côté audit DB uniquement

## Lot 1-A — humanExplanation TO_CONFIRM : ✅ closed (2026-04-21)
- Fichier impacté : `supabase/functions/price-service-lines/index.ts`
- Court-circuit explicite dans `humanExplanation(pl)` préservant `"Tarif export à confirmer..."`

## Lot 1-B — Catalogue 0 XOF export placeholders : ✅ closed (2026-04-21)
- Fichier impacté : `supabase/functions/price-service-lines/index.ts` uniquement
- Constante `EXPORT_PLACEHOLDER_SERVICE_KEYS` hissée au niveau module (lève la dette stylistique notée en Lot 1)
- Helper `isTarifAConfirmer(value)` (normalisation NFD + lowercase + trim)
- Garde `isCatalogPlaceholder` dans le bloc catalogue : 5 conditions strictes (scope export + whitelist + FIXED + base_price=0 + description normalisée `"tarif a confirmer"`)
- Lignes interceptées bypassent `catalogue_sodatra` et tombent dans la branche TO_CONFIRM existante du Lot 1 si aucun resolver aval ne fournit de tarif réel
- `CUSTOMS_EXPORT` à 300 000 XOF non affecté ; imports non affectés ; aucun FROZEN ; aucune migration DB

---

## Lot 2 — Auth cleanup ciblé `getClaims` → `requireUser` : ✅ closed (2026-04-21)
- Fichiers impactés (2) :
  - `supabase/functions/find-similar-quotations/index.ts`
  - `supabase/functions/import-historical-quotation/index.ts`
- Migration : suppression du bloc inline (header check + anon client + `getClaims`) → remplacement par `requireUser(req)` + post-check `logRuntimeEvent` (`AUTH_INVALID_JWT`)
- `import-historical-quotation` : `serviceClient` hissé avant `requireUser` pour permettre logging des échecs auth ; docstring corrigée (`requireUser` au lieu de `getClaims()`)
- Trade-off observabilité S1.2 accepté : tous les échecs auth loggés `AUTH_INVALID_JWT` (perte distinction `AUTH_MISSING_JWT`)
- **Exclu** : `suggest-historical-lines` — dual-path service-role intentionnel (`AUTH-HIST-1`, patché 2026-04-15), seul fichier conservant un appel réel à `getClaims(`
- Aucun FROZEN modifié ; `supabase/config.toml` inchangé ; aucune migration DB ; aucun changement UI/métier

---

## Lot 3D — QQM harmonisation TO_CONFIRM : ✅ closed (2026-04-21)

Sous-lot du backlog `QUOTE-QUALIFICATION-MODEL` (qui reste `in_progress` car Lot 4 DDP reste `planned`).

### Sous-lot 3D-1 — Backend snapshot writer
- Fichiers : `supabase/functions/generate-quotation-version/qqm-resolver.ts` (nouveau, helper pur isolé sans dépendance Deno/Supabase) + `supabase/functions/generate-quotation-version/index.ts` (intégration `resolveSnapshotQualification`)
- Test : `supabase/functions/_tests/qqm_lot3d_snapshot_resolver.test.ts` (9/9 PASS)
- Garantie : un snapshot ne peut jamais être stocké `firm` si `tariff_lines` contient TO_CONFIRM → upgrade `provisional` + `RATE_PENDING_CONFIRMATION` + `firmTotalPolicy: "excludes_reserved_items"`

### Sous-lot 3D-2 — Garde lecture historique (3 helpers consommateurs)
- `supabase/functions/export-quotation-version-pdf/index.ts`
- `supabase/functions/create-quotation-email-draft/index.ts`
- `src/components/puzzle/QuotationVersionCard.tsx`
- Garde miroir appliquée à la lecture pour upgrader les versions persistées `firm` avant Lot 3D-1 (validée par diff réel, pas par les tests Deno de 3D-1 qui couvrent uniquement le writer)

### Sous-lot 3D-3 — Preview pricing
- Fichier unique : `src/components/puzzle/PricingResultPanel.tsx`
- Helper local `resolveQualificationFromRun` lit `outputs_json.quoteQualification` + `tariff_lines`
- Badges `Ferme` / `Provisoire` / `Partiel` ajoutés ; badge legacy `isProvisional` renommé "Communication en cours" (sémantique PRICING-GUARD distincte de QQM)
- Bandeau étendu : `provisional` sans TO_CONFIRM (cas DDP `MISSING_CARGO_VALUE`) affiche désormais la reason principale ; carte "✓ Tout confirmé" remplacée par "⚠ Sous réserve" si `qualification.level !== 'firm'`

### Détection TO_CONFIRM uniforme
Les 5 surfaces (writer + 3 consumers historiques + preview pricing) supportent `source: "TO_CONFIRM"` (legacy string) ET `source: { type: "TO_CONFIRM" }` (format actuel).

### Hors périmètre Lot 3D
- Aucun FROZEN modifié
- Aucune migration DB
- Aucun `STATUS_REGISTRY` (QQM = qualification commerciale, pas statut FSM dossier)
- Aucun `supabase/config.toml`
- Aucun pricing recalculé
- Dette `QQM-FACTORIZE` documentée en `deferred` (P3) dans `docs/DEFERRED_BACKLOG.md`

---

## TARIFF-COLLECTION-CAMPAIGN — Grilles de collecte tarifaire : 🟡 in_progress (2026-04-22)

Chantier purement documentaire ouvert après clôture Lot 4-A.

### Livrables (11 fichiers `docs/tariff-collection/`)
- `TARIF_MASTER_INDEX.md` — index général + inventaire base read-only + légendes statuts
- `TARIF_AIR_IMPORT_DDP.md` — package `AIR_IMPORT_DDP` (P0)
- `TARIF_AIR_IMPORT_DAP.md` — packages `AIR_IMPORT_DAP` + `AIR_IMPORT_EXW` (P0)
- `TARIF_SEA_LCL_IMPORT_DDP.md` — package `LCL_IMPORT_DDP` (P0)
- `TARIF_SEA_LCL_IMPORT_DAP.md` — packages `LCL_IMPORT_DAP` + `DAP_PROJECT_IMPORT` + variantes EXW (P0)
- `TARIF_EXPORT_SENEGAL.md` — whitelist Lot 1 + `CUSTOMS_EXPORT` 300k (P0)
- `TARIF_TRANSPORT_ROUTIER.md` — `local_transport_rates` + Mali + frontières (P1)
- `TARIF_FRAIS_COMPAGNIES_MARITIMES.md` — `carrier_billing_templates` + demurrage (P0)
- `TARIF_PORT_TERMINAL.md` — PAD T01–T14 + Dakar Terminal + DTHC (P0)
- `TARIF_AEROPORT.md` — `AIR_HANDLING` + `AIR_FREIGHT` (P1)
- `TARIF_PARTENAIRES.md` — RFQ partenaires + workflow cockpit (P1)

### Schéma colonnes (26 champs)
Famille / Service key / Libellé / Mode / Sens / Incoterm / Unité / Quantité / Tarif HT XOF / **Valeur existante en base** / **Validation SODATRA** / Devise / TVA / Min / Max / Base de calcul / Conditions / Exemple / Source / Fournisseur / Date validité / Statut / **Priorité** / **Impact si non renseigné** / **Table cible future** / Commentaire SODATRA.

### Distinctions clés introduites
- `Valeur existante en base` ≠ `Validation SODATRA` (à valider / validé / à corriger / à supprimer)
- `Table cible future` (préparation de l'ingestion runtime sans risque de cible erronée)
- `Statut` : confirmé / à confirmer / à renseigner / non applicable
- `Priorité` : P0 (devis impossible) / P1 (fiabilité) / P2 (amélioration)

### Hors périmètre
- Aucun runtime modifié
- Aucune migration DB
- Aucun changement edge function / UI / hook / types
- Aucun STATUS_REGISTRY
- Aucun `.env` / `.gitignore`
- Aucun tarif inventé
- Conversion Markdown → Word/PDF/Excel laissée au métier

### Déclencheur de clôture
Grilles remplies, relues et validées par SODATRA → ouverture du futur lot `TARIFF-INGESTION-CAMPAIGN` (runtime).

---

## Lot 4-A — DDP mono-lot provisional : ✅ closed (2026-04-22)

Mono-lot DDP du backlog `QUOTE-QUALIFICATION-MODEL` (parent désormais clôturable côté DDP mono-lot ; multi-lot DDP reste hors scope tant que non déclenché).

### Sous-lots livrés
- **Lot 4-A** : DDP mono-lot sans `cargo.value` autorisé en `provisional` ; ligne `CUSTOMS_RESERVE` typée `TO_CONFIRM` ; total ferme exclut éléments en réserve.
- **Lot 4-A-ter** : rendu PDF/email "À confirmer" sur la ligne droits/taxes (plus de "0 FCFA").
- **Lot 4-A-quinquies** : sync UI — `QuotationVersionCard` recharge auto après création version via `PricingResultPanel` (lift state up `versionRefreshToken` dans `CaseView`).

### Validation PDF v2 (2026-04-22)
- Badge `[v2]` ✅
- Bandeau `DEVIS PROVISOIRE` ✅
- Reason `MISSING_CARGO_VALUE` + `RATE_PENDING_CONFIRMATION` affichées ✅
- Ligne droits/taxes = `À confirmer` (pas `0 FCFA`) ✅
- `TOTAL HT FERME (hors éléments en réserve) = 200 000 XOF` ✅

### Réserves tracées (non bloquantes)
- `SNAPSHOT-V1-LOT4-LEGACY` (P3, historical_note) : v1 antérieures non réécrites — décision d'immutabilité.
- `LOT4A-LINE12-ZERO` (P3, ouvert) : lignes `LINE_1` / `LINE_2` à 0 dans PDF v2, hors périmètre droits/taxes DDP, à auditer séparément.

### Hors périmètre Lot 4-A
- Aucun fichier FROZEN modifié
- Aucune migration DB
- Aucun changement edge function `run-pricing` / `quotation-engine` / `qqm-resolver`
- Aucun snapshot historique réécrit
- Aucun `STATUS_REGISTRY` modifié
- Aucun `.env` / `.gitignore`

---

## Statut Lot 0
**Clôturé sur périmètre Lovable** : runtime 4/4 validé, SEC-001 en `closed_pending_rotation_review` (audit historique + rotation conditionnelle restent à faire hors plateforme).

## Garde-fous
- Ne pas modifier `.gitignore` ni `.env` côté Lovable (gérés hors plateforme)
- Aucune autre action runtime à exécuter dans ce lot
- **Lot 1 — TO_CONFIRM export 0 XOF** : ✅ livré et clôturé (non rouvrable sans nouveau déclencheur métier)
- **Lot 1-A — humanExplanation TO_CONFIRM** : ✅ livré et clôturé
- **Lot 1-B — Catalogue 0 XOF export placeholders** : ✅ livré et clôturé (non rouvrable sans nouveau déclencheur métier)
- **Lot 2 — auth cleanup `getClaims` → `requireUser`** : ✅ livré et clôturé (non rouvrable sans nouveau déclencheur ; `suggest-historical-lines` reste explicitement exclu — dual-path)
- **Lot 3D — QQM harmonisation TO_CONFIRM** : ✅ livré et clôturé (sous-lots 3D-1/2/3 ; non rouvrable sans nouveau déclencheur ; dette `QQM-FACTORIZE` différée en P3)
- **Lot 4-A — DDP mono-lot provisional droits/taxes à confirmer** : ✅ livré et clôturé (sous-lots 4-A / 4-A-ter / 4-A-quinquies ; PDF v2 validé visuellement ; non rouvrable sans nouveau déclencheur ; réserves `SNAPSHOT-V1-LOT4-LEGACY` et `LOT4A-LINE12-ZERO` tracées en P3)
- **SEC-001** : conserver `closed_pending_rotation_review` tant que l'audit historique Git + rotation conditionnelle ne sont pas effectués hors Lovable
- Ne pas créer de "Lot 0-B" Lovable : la finalisation SEC-001 est manuelle hors plateforme
- Prochaine étape : Lot 4 multi-lot DDP reste `planned` (à ouvrir uniquement sur déclencheur produit explicite)
