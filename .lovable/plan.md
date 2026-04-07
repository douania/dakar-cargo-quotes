


# Plan — Correction HS normalization Phase A + enrichissement package EXPORT_SENEGAL

## Statut : LIVRÉ (2026-04-07)

### Périmètre livré : 2 fichiers frontend + 2 edge functions + 1 migration DB + 2 docs

#### Frontend (livré phase précédente)
- `src/features/quotation/constants.ts` : 6 serviceTemplates export + EXPORT_SENEGAL enrichi à 7 services
- `src/pages/case-view/constants.ts` : EXCLUSIVE_GROUPS + ["STUFFING_FACTORY", "STUFFING_CFS"]

#### Backend (livré 2026-04-07)
- `supabase/functions/price-service-lines/index.ts` : 6 codes ajoutés à VALID_SERVICE_KEYS
- `supabase/functions/run-pricing/index.ts` :
  - SERVICE_PACKAGES.EXPORT_SENEGAL aligné avec frontend (7 services)
  - PACKAGE_SERVICE_DEFAULT_UNITS : THC_EXPORT=EVP, DOCUMENTATION_BL=BL, VGM_WEIGHING=EVP, STUFFING_FACTORY=EVP, STUFFING_CFS=EVP, EMPTY_REPO=EVP
  - SERVICE_KEY_LABELS : labels français ajoutés
  - DEDUP_GROUP_MAP : 6 entrées identitaires ajoutées
  - `resolveServicePackageForLot()` : accepte globalServicePackage, respecte les packages EXPORT_* sans les écraser par la résolution import
  - Appel lot-level passe désormais `lotInputs.servicePackage` au resolver
  - `pricingCtxOverride.scope` : dynamique — 'export' si package EXPORT_*, sinon 'import'
  - `buildPricingInputs()` : fallback finalDestination depuis destinationPort/destinationAirport
  - **HS-NORMALIZATION Phase A** : garde dans `mergeFactsForLot()` — empêche un lot-level < 10 digits d'écraser un global 10 digits avec même SH6
- Migration DB :
  - `service_quantity_rules` : 6 règles de quantité (EVP/FLAT)
  - `pricing_service_catalogue` : 6 entrées FIXED à 0 XOF, mode_scope=NULL, description="Tarif à confirmer"

#### HS-NORMALIZATION Phase A (livré 2026-04-07)
- `supabase/functions/quotation-engine/index.ts` : résolution SH6 "candidat unique seulement"
  - Exact match prioritaire (comportement original préservé)
  - Fallback SH6 : si code 6-9 digits, cherche candidats par préfixe SH6
  - Auto-résolution uniquement si 1 seul candidat 10 digits existe
  - Si 0 ou >1 candidats → non-résolu (comportement actuel préservé)
- `supabase/functions/run-pricing/index.ts` : garde mergeFactsForLot()
  - Si lot-level `cargo.hs_code` < 10 digits et global = 10 digits avec même SH6 → garde le global

#### Documentation (livré 2026-04-07)
- `docs/MASTER_CONTEXT.md` : exception contrôlée HS-NORMALIZATION Phase A documentée
- `docs/DEFERRED_BACKLOG.md` :
  - EXPORT-HS-NORMALIZATION-MULTILOT : statut `confirmed → Phase A livrée et validée runtime`
  - HS-MULTI-LAYER-ARCHITECTURE : nouvelle entrée Phase B (deferred)

### Résultat (confirmé run #3 dossier 76c9819c — 2026-04-07)
Les 6 codes export sont maintenant :
- Acceptés par la whitelist moteur
- Auto-injectés via le package EXPORT_SENEGAL backend
- Quantifiés via service_quantity_rules
- Résolus par le catalogue avec rate=0, source="catalogue_sodatra"
- Non écrasés par la résolution import lot-level (packages EXPORT_* respectés)
- Traités en scope 'export' par price-service-lines
- **Run #3 success** : 5 lots, 750 000 XOF HT, 885 000 XOF TTC, 7 lignes P5/lot cohérentes

### Validation runtime Phase A HS (confirmé run #6 dossier 76c9819c — 2026-04-07)
- Phase A livrée dans le repo, puis validée runtime après redéploiement des edge functions
- **Run #6** : 5 lots homogènes sur `0801310000`, warning `Code HS 08013100 non trouvé` disparu
- Garde `mergeFactsForLot()` active : lots 1-2 ne dégradent plus le global 10 digits
- Fallback SH6 candidat unique dans `quotation-engine` : opérationnel (1 seul candidat pour 080131)
- Prochain chantier HS : Phase B architecture multi-couche (HS-MULTI-LAYER-ARCHITECTURE, backlogé)

### Limitation connue
- Les tarifs réels restent à alimenter séparément (EXPORT-PRICING-SOURCING dans DEFERRED_BACKLOG.md).
- Le moteur FROZEN quotation-engine continue de produire des honoraires import génériques (EXPORT-QE-FROZEN dans DEFERRED_BACKLOG.md).

### Dettes ajoutées au backlog (2026-04-07)
- **EXPORT-HS-NORMALIZATION-MULTILOT** (`confirmed — Phase A livrée et validée runtime`) : cause racine prouvée par audit DB. Phase A livrée dans le repo puis validée runtime après redéploiement (run #6, 2026-04-07). 5 lots homogènes sur `0801310000`.
- **HS-MULTI-LAYER-ARCHITECTURE** (`deferred`) : architecture multi-couche HS source → ancrage SH6 → code Sénégal. Phase B du chantier HS.
- **EXPORT-CUSTOMS-SEMANTICS** (`watchlist`) : sémantique CUSTOMS_EXPORT / duties_total en contexte export sénégalais — clarifier labels avant première offre client.
- Tableau de sourcing tarifaire export ajouté dans DEFERRED_BACKLOG.md avec priorités et nature tarif.

### Prochain audit technique ciblé
Phase B architecture HS multi-couche (HS-MULTI-LAYER-ARCHITECTURE) — backlogé, hors scope de ce lot.

### Hors périmètre
- `EXPORT_SENEGAL_EXW` — décision produit, pas dans ce lot
- Tarifs réels pour les 6 codes — sourcing opérateur requis
- Mapping spécifique port_tariffs pour THC_EXPORT (contrairement à DTHC côté import)
- Phase B architecture HS multi-couche (HS-MULTI-LAYER-ARCHITECTURE)
