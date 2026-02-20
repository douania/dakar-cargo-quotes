
# Corrections de securite pre-relance pricing

## 3 micro-corrections dans `supabase/functions/quotation-engine/index.ts`

### Correction A — Safe access `container.type` (ligne 1691)

Avant :
```text
const sizePrefix = container.type.slice(0, 2);
```

Apres :
```text
const sizePrefix = container.type?.slice(0, 2) || '';
```

Empeche un crash runtime si `container.type` est `undefined`.

### Correction B — Normalisation du fallback searchTerm (ligne 1688)

Avant :
```text
const searchTerm = mappedZone || request.finalDestination.split(' ')[0];
```

Apres :
```text
const searchTerm = mappedZone || normalize(request.finalDestination?.split(' ')[0] || '');
```

Le fallback passe desormais par `normalize()` pour gerer accents et espaces.

### Correction C — Tri par longueur decroissante du ZONE_MAPPING (lignes 1686-1687)

Avant :
```text
const mappedZone = Object.entries(ZONE_MAPPING)
  .find(([key]) => destKey.includes(key))?.[1];
```

Apres :
```text
const mappedZone = Object.entries(ZONE_MAPPING)
  .sort((a, b) => b[0].length - a[0].length)
  .find(([key]) => destKey.includes(key))?.[1];
```

Garantit que `'keur massar'` est teste avant un eventuel `'keur'`, evitant les collisions.

## Apres corrections

Deploiement automatique de la edge function, puis relance pricing sur dossier `7eab135d`.

## Ce qui ne change PAS

- Les mappings ZONE_MAPPING et CONTAINER_TYPE_MAPPING (inchanges)
- La logique THC / DPW_PROVIDERS
- Le flux general du moteur
- Zero migration DB
