
# Correction transport : mapping zone + container type strict

## Contexte

Le bloc `isPortDelivery` actuel force `amount: 0` pour Dakar, ce qui est **metier faux**. Dakar = FORFAIT ZONE 1 = 82 600 FCFA (20' Dry).

## Donnees en base `local_transport_rates`

### Destinations disponibles
26 destinations dont les zones forfaitaires :
- `FORFAIT ZONE 1 <18 km` : 82 600 / 123 900 / 371 700 FCFA
- `FORFAIT ZONE 2, SEIKHOTANE ET POUT` : 135 700 / 218 300 / 654 900 FCFA
- Plus des villes nommees : THIES / POPONGUINE, KAOLACK, MBOUR, ZIGUINCHOR, etc.

### Container types en base
- `20' Dry`
- `40' Dry`
- `Low Bed`

## Modifications dans `supabase/functions/quotation-engine/index.ts`

### 1. Supprimer le bloc `isPortDelivery` (lignes 1629-1732)

Retirer entierement :
- La constante `portCity`, `destNorm`, `isPortDelivery` (lignes 1629-1631)
- Le bloc `if (isPortDelivery) { ... }` (lignes 1633-1651)
- Le `} else {` ligne 1652
- Le `} // end else !isPortDelivery` ligne 1732

Le flux redevient lineaire : pour chaque conteneur, chercher historique puis `local_transport_rates` puis TO_CONFIRM.

### 2. Ajouter ZONE_MAPPING en haut du fichier (apres DPW_PROVIDERS)

```text
const ZONE_MAPPING: Record<string, string> = {
  'dakar': 'FORFAIT ZONE 1',
  'plateau': 'FORFAIT ZONE 1',
  'medina': 'FORFAIT ZONE 1',
  'almadies': 'FORFAIT ZONE 1',
  'pikine': 'FORFAIT ZONE 1',
  'guediawaye': 'FORFAIT ZONE 1',
  'rufisque': 'FORFAIT ZONE 1',
  'keur massar': 'FORFAIT ZONE 1',
  'parcelles': 'FORFAIT ZONE 1',
  'diamniadio': 'FORFAIT ZONE 1',
  'pout': 'FORFAIT ZONE 2',
  'seikhotane': 'FORFAIT ZONE 2',
  'sebikhotane': 'FORFAIT ZONE 2',
};
```

### 3. Ajouter CONTAINER_TYPE_MAPPING en haut du fichier

```text
const CONTAINER_TYPE_MAPPING: Record<string, string> = {
  '20': "20' Dry",
  '40': "40' Dry",
};
```

### 4. Remplacer la recherche `local_transport_rates` (lignes 1686-1691)

Au lieu de :
```text
.ilike('destination', `%${request.finalDestination.split(' ')[0]}%`)
.limit(1);
```

Faire :
1. Normaliser la destination via `normalize()` (deja defini)
2. Chercher dans ZONE_MAPPING via `includes()` (pas exact match) pour gerer "Dakar Plateau", "Dakar - Port", etc.
3. Si zone trouvee, chercher avec `ILIKE '%{zone}%'` sur destination
4. Sinon, garder la recherche ILIKE existante sur le premier mot
5. Ajouter filtre `.eq('container_type', mappedContainerType)` via CONTAINER_TYPE_MAPPING

La recherche via `includes()` :

```text
const destKey = normalize(request.finalDestination);
const mappedZone = Object.entries(ZONE_MAPPING)
  .find(([key]) => destKey.includes(key))?.[1];
const searchTerm = mappedZone || request.finalDestination.split(' ')[0];
```

Pour le container type :

```text
const sizePrefix = container.type.slice(0, 2); // "20" ou "40"
const mappedContainerType = CONTAINER_TYPE_MAPPING[sizePrefix];
```

Puis requete :

```text
let rateQuery = supabase
  .from('local_transport_rates')
  .select('*')
  .eq('is_active', true)
  .ilike('destination', `%${searchTerm}%`);

if (mappedContainerType) {
  rateQuery = rateQuery.eq('container_type', mappedContainerType);
}

const { data: localRates } = await rateQuery.limit(1);
```

## Impact attendu

| Ligne | Avant | Apres |
|-------|-------|-------|
| Transport 20ST Dakar | 0 FCFA (COMPUTED) | 82 600 FCFA (OFFICIAL) |
| Transport 40HC Dakar | 0 FCFA (COMPUTED) | 123 900 FCFA (OFFICIAL) |
| THC | OK (DPW_PROVIDERS) | Inchange |
| Sources | >= 3 | >= 4 |

## Ce qui ne change PAS

- Tables DB (zero migration)
- Transport Mali (bloc separe)
- Logique THC (DPW_PROVIDERS reste en place)
- Logique fiscale (droits, taxes, CAF)
- Historique tarifs (toujours prioritaire avant local_transport_rates)

## Risques

| Risque | Mitigation |
|--------|-----------|
| ZONE_MAPPING incomplet | Fallback sur recherche ILIKE existante |
| Container type inconnu (Low Bed, etc.) | Si pas dans mapping, pas de filtre container (comportement actuel) |
| Destinations composees ("Dakar Plateau") | `includes()` au lieu de match exact |
