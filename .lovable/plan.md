

# Correction : les champs manquants ne sont pas filtres malgre les donnees disponibles

## Diagnostic

Railway renvoie `missing_fields: [{ field: "route.destinations" }]` car son analyse interne ne detecte pas la destination. Mais cote application, la destination a bien ete extraite ("DAKAR ZONE 1") et injectee en base via `set-case-fact`.

Le probleme : `correctAssumptions()` met a jour les hypotheses mais ne filtre jamais `missing_fields`. L'UI affiche donc "1 champ manquant" alors que l'information est deja disponible.

## Correction dans `src/pages/Intake.tsx`

### Modification de `correctAssumptions`

Ajouter un filtrage de `missing_fields` base sur les donnees effectivement disponibles (textOverrides + extractedAnalysis) :

```text
// Mapping: Railway field name -> data keys that resolve it
const FIELD_RESOLVERS: Record<string, (analysis: Record<string,any>, overrides: Record<string,any>) => boolean> = {
  "route.destinations": (a, o) => !!(o.destination || a.destination),
  "cargo.container_count": (a, o) => !!(o.container_count || a.container_count),
  "cargo.weight": (a, o) => !!(a.weight_kg),
};

// Inside correctAssumptions, filter out resolved missing fields:
const filteredMissing = (data.missing_fields || []).filter(field => {
  const resolver = FIELD_RESOLVERS[field.field];
  if (resolver && resolver(analysis, textOverrides)) {
    return false; // field is resolved, remove from missing
  }
  return true;
});

return { ...data, missing_fields: filteredMissing, assumptions: ... };
```

Cela supprime les champs manquants qui ont deja ete resolus par l'analyse du document ou les corrections de l'operateur.

## Fichier modifie

| Fichier | Modification |
|---------|-------------|
| `src/pages/Intake.tsx` | Filtrer `missing_fields` dans `correctAssumptions` en fonction des donnees disponibles |

## Risques

- Aucune regression : si aucune donnee ne resout le champ, il reste dans la liste
- Pas de modification backend
- Le filtrage est explicite et extensible via `FIELD_RESOLVERS`

