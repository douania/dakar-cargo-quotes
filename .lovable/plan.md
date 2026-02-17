
# Filtrage contextuel des services supplementaires

## Probleme

Le panneau "Services supplementaires" affiche tous les services de `serviceTemplates` qui ne sont pas dans le package actuel, sans tenir compte du type de dossier. Un dossier maritime FCL Dakar propose donc "Fret aerien", "Dedouanement Bamako", "Frais frontiere", etc.

## Solution

Ajouter une fonction `isServiceRelevant(service, mode)` et un filtre de services exclusifs dans `ServiceOverridePanel` (CaseView.tsx). Patch de ~20 lignes, zero impact backend.

## Modifications

### Fichier unique : `src/pages/CaseView.tsx`

**1. Lire le fait `service.mode` depuis les facts existants**

Dans `ServiceOverridePanel`, apres la lecture de `packageFact`, lire aussi :

```text
const modeFact = facts.find(f => f.fact_key === "service.mode" && f.is_current);
const serviceMode = modeFact?.value_text || "";
```

**2. Ajouter la fonction de filtrage contextuel**

```text
function isServiceRelevant(service: string, mode: string): boolean {
  if (mode.startsWith("SEA")) {
    if (service.startsWith("AIR_")) return false;
    if (service === "CUSTOMS_BAMAKO") return false;
    if (service === "BORDER_FEES") return false;
  }
  if (mode.startsWith("AIR")) {
    if (service.startsWith("PORT_")) return false;
    if (service === "DTHC") return false;
    if (service === "EMPTY_RETURN") return false;
    if (service === "DISCHARGE") return false;
  }
  return true;
}
```

**3. Ajouter un filtre de services exclusifs (anti-doublons)**

```text
const EXCLUSIVE_GROUPS = [["TRUCKING", "ON_CARRIAGE"]];
```

Si un service du groupe est deja dans le package de base, les autres membres du groupe ne sont pas proposes en supplementaire.

**4. Modifier le calcul de `extraServices` (ligne 156)**

Remplacer :

```text
const extraServices = serviceTemplates.filter(
  (t) => !packageServices.includes(t.service)
);
```

par :

```text
const excludedByExclusive = new Set(
  EXCLUSIVE_GROUPS.flatMap(group => {
    const inPackage = group.filter(k => packageServices.includes(k));
    return inPackage.length > 0 ? group.filter(k => !packageServices.includes(k)) : [];
  })
);

const extraServices = serviceTemplates.filter((t) => {
  if (packageServices.includes(t.service)) return false;
  if (!isServiceRelevant(t.service, serviceMode)) return false;
  if (excludedByExclusive.has(t.service)) return false;
  return true;
});
```

## Impact

- ~20 lignes ajoutees dans CaseView.tsx
- Zero modification backend
- Zero modification QuotationSheet
- Zero migration SQL
- Le panneau "Services supplementaires" n'affichera que les services coherents avec le type de dossier

## Resultat attendu

Pour un dossier SEA_FCL_IMPORT destination Dakar :

| Avant | Apres |
|-------|-------|
| 12+ services proposes | 3-4 services pertinents |
| Fret aerien visible | Masque |
| Dedouanement Bamako visible | Masque |
| Frais frontiere visible | Masque |
| TRUCKING + ON_CARRIAGE | Un seul visible |

## Tests operateur

**Test 1** — Dossier maritime : verifier que AIR_FREIGHT, AIR_HANDLING, CUSTOMS_BAMAKO, BORDER_FEES sont absents des services supplementaires.

**Test 2** — Dossier aerien : verifier que PORT_CHARGES, DTHC, EMPTY_RETURN, DISCHARGE sont absents.

**Test 3** — Dossier sans service.mode : verifier que tous les services restent visibles (pas de filtrage, comportement de fallback).

**Test 4** — Doublons exclusifs : si TRUCKING est dans le package, ON_CARRIAGE ne doit pas apparaitre en supplementaire.
