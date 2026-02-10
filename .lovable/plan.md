


# Phase PRICING V4.1 — Transport Resolver (IMPLÉMENTÉ)

## Statut : ✅ IMPLÉMENTÉ avec corrections CTO

## Modifications appliquées sur `supabase/functions/price-service-lines/index.ts`

### 1. PricingContext enrichi
- Ajout `destination_city: string | null` (extrait de `routing.destination_city`)

### 2. Nouvelle fonction `findLocalTransportRate` (~95 lignes)
- Scope : TRUCKING et ON_CARRIAGE uniquement
- **CTO Correction B** : `if (isAirMode) return null;` — interdit en mode AIR
- Matching destination : exact → partiel (single match only, ambiguïté → null)
- Matching container : mapping 20DV→"20'", 40DV/40HC→"40'"
- **CTO Correction A** : `if (!bestRate) return null;` — pas de fallback arbitraire

### 3. Preload dans Promise.all
- `local_transport_rates` chargée une seule fois au démarrage (is_active=true)

### 4. Cascade mise à jour
```
1. Client Override (FIXED/UNIT_RATE/PERCENTAGE)
2. Customs Tier CAF
3. Customs Tier Weight
4. Catalogue SODATRA
5. LOCAL TRANSPORT RATES ← NOUVEAU
6. Rate Card
7. Port Tariff (DTHC)
```

### 5. resolveWithoutClientOverride mis à jour
- Transport resolver ajouté entre catalogue (étape 3) et rate card (étape 4)
- Garantit que les overrides PERCENTAGE sur TRUCKING utilisent le tarif transport comme base

### 6. Attributs de sortie
- `source: "local_transport_rate"` ou `"local_transport_rate+modifiers"`
- `confidence: 0.90`
- `explanation` inclut destination, container_type, provider, rate

## Corrections CTO appliquées
| Correction | Description |
|---|---|
| A | Pas de fallback premier candidat si container non matché → `return null` |
| B | Resolver transport interdit en mode AIR → `return null` |
| Ajust. | Match partiel interdit si plusieurs destinations distinctes → `return null` |
