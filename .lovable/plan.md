

# Plan — Enrichir le package EXPORT_SENEGAL (patch minimal)

## Statut : LIVRÉ (2026-04-07)

### Périmètre livré : 2 fichiers frontend + 2 edge functions + 1 migration DB

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
- Migration DB :
  - `service_quantity_rules` : 6 règles de quantité (EVP/FLAT)
  - `pricing_service_catalogue` : 6 entrées FIXED à 0 XOF, mode_scope=NULL, description="Tarif à confirmer"

### Résultat
Les 6 codes export sont maintenant :
- Acceptés par la whitelist moteur
- Auto-injectés via le package EXPORT_SENEGAL backend
- Quantifiés via service_quantity_rules
- Résolus par le catalogue avec rate=0, source="catalogue_sodatra"

### Limitation connue
Les tarifs réels restent à alimenter séparément (EXPORT-PRICING-SOURCING dans DEFERRED_BACKLOG.md).

### Hors périmètre
- `EXPORT_SENEGAL_EXW` — décision produit, pas dans ce lot
- Tarifs réels pour les 6 codes — sourcing opérateur requis
- Mapping spécifique port_tariffs pour THC_EXPORT (contrairement à DTHC côté import)
