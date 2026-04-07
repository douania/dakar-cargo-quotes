

# Plan — Enrichir le package EXPORT_SENEGAL (patch minimal)

## Périmètre : 2 fichiers, 0 migration, 0 changement moteur

### Fichier 1 — `src/features/quotation/constants.ts`

**A. Ajouter 6 serviceTemplates export**

| service | description | unit |
|---------|-------------|------|
| `THC_EXPORT` | THC export (Terminal Handling) | EVP |
| `DOCUMENTATION_BL` | Documentation / B/L fees | BL |
| `VGM_WEIGHING` | VGM / Pesée conteneur | EVP |
| `STUFFING_FACTORY` | Empotage usine | EVP |
| `STUFFING_CFS` | Empotage CFS / port | EVP |
| `EMPTY_REPO` | Repositionnement conteneur vide vers site | EVP |

**B. Enrichir `EXPORT_SENEGAL`**

Remplacer :
```
EXPORT_SENEGAL: ['PORT_CHARGES', 'CUSTOMS_EXPORT', 'AGENCY']
```
Par :
```
EXPORT_SENEGAL: [
  'PORT_CHARGES', 'THC_EXPORT', 'CUSTOMS_EXPORT',
  'DOCUMENTATION_BL', 'VGM_WEIGHING', 'SEA_FREIGHT', 'AGENCY',
]
```

Les services `STUFFING_FACTORY`, `STUFFING_CFS`, `EMPTY_REPO`, `PICKUP_ORIGIN`, `PRE_CARRIAGE` restent hors package — disponibles dans "Services supplémentaires" du `ServiceOverridePanel`.

### Fichier 2 — `src/pages/case-view/constants.ts`

**C. Ajouter le groupe exclusif stuffing**

Dans `EXCLUSIVE_GROUPS`, ajouter :
```
["STUFFING_FACTORY", "STUFFING_CFS"]
```

## Hors périmètre (Phase 2)

- `EXPORT_SENEGAL_EXW` — décision produit, pas dans ce lot
- Support pricing automatique des nouveaux codes — à vérifier séparément via audit `run-pricing`

## Limitation connue

Les 6 nouveaux services seront visibles et sélectionnables dans le `ServiceOverridePanel`, mais leur calcul automatique par `run-pricing` n'est pas garanti sans audit ciblé du moteur de pricing.

