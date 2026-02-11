

# Phase V4.1.2 — Resolver transport : mapping zone pour Dakar

## Diagnostic

Le patch V4.1.1 fonctionne : `routing.destination_city = "DAKAR"` est correctement extrait (confidence 1.00).

Le probleme est en aval : le resolver `findLocalTransportRate` ne trouve pas "DAKAR" dans `local_transport_rates` car la table utilise des noms de zones, pas des noms de villes.

**Destinations existantes dans la table** :
```text
BAMBEY / TAYBA, BIGNONA, CAP SKIRING, Chaux, DAGANA / MAKA,
DIOURBEL, FORFAIT ZONE 1 <18 km, FORFAIT ZONE 2 SEIKHOTANE ET POUT,
JOAL, KAFFRINE, KAOLACK, KEBEMER / FATICK, LOUGA / TOUBA, MBACKE,
MBOUR, MECKHE, NIORO / Saint Louis, PODOR, RICHARD TOLL, SOKONE,
TAMBACOUNDA, THIAYES, THIES / POPONGUINE, TIVAOUANE, ZIGUINCHOR...
```

Pas de "DAKAR" explicite. La livraison Dakar correspond a **"FORFAIT ZONE 1 <18 km"**.

## Solution proposee

Patch chirurgical dans `findLocalTransportRate` : ajouter un mapping ville-vers-zone **avant** le matching par destination.

### Modification unique

**Fichier** : `supabase/functions/price-service-lines/index.ts`
**Fonction** : `findLocalTransportRate` (ligne ~464)

Apres `const destNorm = destCity.toUpperCase().trim();`, inserer un mapping de villes connues vers les destinations de la table :

```typescript
// Phase V4.1.2: City-to-zone mapping for destinations
// that use zone-based naming in local_transport_rates
const CITY_TO_ZONE: Record<string, string> = {
  "DAKAR": "FORFAIT ZONE 1 <18 KM",
  "GUEDIAWAYE": "FORFAIT ZONE 1 <18 KM",
  "PIKINE": "FORFAIT ZONE 1 <18 KM",
  "RUFISQUE": "FORFAIT ZONE 1 <18 KM",
  "DIAMNIADIO": "FORFAIT ZONE 2, SEIKHOTANE ET POUT",
  "SEIKHOTANE": "FORFAIT ZONE 2, SEIKHOTANE ET POUT",
  "POUT": "FORFAIT ZONE 2, SEIKHOTANE ET POUT",
};

const resolvedDest = CITY_TO_ZONE[destNorm] || destNorm;
```

Puis remplacer `destNorm` par `resolvedDest` dans le matching exact et partiel (lignes 475 et 481).

### Impact

| Element | Modification |
|---|---|
| findLocalTransportRate | +15 lignes (mapping + variable) |
| Logique de matching existante | 2 lignes changees (destNorm vers resolvedDest) |
| Autres resolvers | Zero changement |
| Frontend | Zero modification |
| build-case-puzzle | Zero changement |

### Cas couverts apres patch

| destination_city extraite | Zone resolue | Rate attendu |
|---|---|---|
| DAKAR | FORFAIT ZONE 1 <18 KM | Tarif zone 1 |
| DIAMNIADIO | FORFAIT ZONE 2, SEIKHOTANE ET POUT | Tarif zone 2 |
| MBOUR | MBOUR (match direct) | Tarif Mbour |
| KAOLACK | KAOLACK (match direct) | Tarif Kaolack |

### Risque technique

| Risque | Niveau | Commentaire |
|---|---|---|
| Mapping incomplet | Faible | Extensible, fallback = matching existant |
| Regression sur villes hors-map | Nul | Le code existant reste inchange (OR fallback) |
| Conflit avec matching partiel | Nul | Le mapping est applique AVANT le matching |

### Validation E2E

1. Redeployer `price-service-lines`
2. Relancer le pricing sur le dossier `4f2baa5b`
3. Verifier que TRUCKING resout via `local_transport_rate` avec le tarif "FORFAIT ZONE 1"
4. Verifier le montant (devrait etre le tarif zone 1 pour 40' x2, pas 3 500 000)

