
# Correction des 4 incohérences de filtrage contextuel des services

## Probleme

Le filtrage contextuel actuel dans `isServiceRelevant` et `EXCLUSIVE_GROUPS` laisse passer 4 services incoherents pour un dossier SEA_FCL_IMPORT :
1. DISCHARGE (breakbulk) visible en FCL
2. CUSTOMS_EXPORT visible en mode IMPORT
3. PORT_CHARGES doublon de PORT_DAKAR_HANDLING
4. CUSTOMS doublon de CUSTOMS_DAKAR

## Modifications

### Fichier unique : `src/pages/CaseView.tsx`

**1. Ajouter `DISCHARGE` dans le filtre SEA (ligne 107)**

Ajout d'une ligne : `if (service === "DISCHARGE") return false;`

Le dechargement breakbulk n'a pas de sens en conteneurise.

**2. Ajouter regles IMPORT/EXPORT croisees (apres les blocs SEA/AIR)**

```text
if (mode.includes("IMPORT") && service === "CUSTOMS_EXPORT") return false;
if (mode.includes("EXPORT") && service === "CUSTOMS_DAKAR") return false;
```

**3. Enrichir EXCLUSIVE_GROUPS (ligne 118)**

```text
const EXCLUSIVE_GROUPS = [
  ["TRUCKING", "ON_CARRIAGE"],
  ["PORT_DAKAR_HANDLING", "PORT_CHARGES"],
  ["CUSTOMS_DAKAR", "CUSTOMS"],
];
```

## Impact

| Element | Impact |
|---------|--------|
| Backend | Aucun |
| QuotationSheet | Aucun |
| Pricing | Aucun |
| Migration SQL | Aucune |
| Lignes modifiees | ~8 lignes |

## Resultat attendu

Pour un dossier SEA_FCL_IMPORT / DAP_PROJECT_IMPORT, les services supplementaires se reduisent a :
- Frais agence (AGENCY)
- Survey (SURVEY)

Tous les services incoherents (DISCHARGE, CUSTOMS_EXPORT, PORT_CHARGES, CUSTOMS) disparaissent.
