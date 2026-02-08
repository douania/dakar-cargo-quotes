

# Fix Phase S1.1 — Filtrage transport mode sur les tarifs knowledge base

## Diagnostic

Le `SimilarQuotationsPanel` utilise deux sources de donnees independantes :

1. `useSimilarQuotations` (quotation_history) -- filtre Phase S1 actif, fonctionne correctement
2. `useTariffSuggestions` (learned_knowledge via data-admin/search_tariffs) -- **aucun filtre transport mode**

La deuxieme source remonte des tarifs breakbulk/projet lourd (ex: transport routier 3.5M FCFA pour un transformateur 60t) qui sont affiches comme suggestions pour un envoi aerien de 3.2t. C'est la source du resultat errone persistant.

## Correction en 3 points

### 1. Passer `transportMode` a `useTariffSuggestions`

**Fichier : `src/components/SimilarQuotationsPanel.tsx`** (ligne 64)

Actuellement :
```typescript
const { data: knowledgeTariffs } = useTariffSuggestions(destination, cargoType);
```

Apres :
```typescript
const { data: knowledgeTariffs } = useTariffSuggestions(destination, cargoType, undefined, transportMode);
```

### 2. Ajouter le parametre `transportMode` au hook

**Fichier : `src/hooks/useTariffSuggestions.ts`** (ligne 35-42)

Ajouter un 4e parametre optionnel `transportMode` a la signature de `useTariffSuggestions` et le passer dans le body de l'appel edge function :

```typescript
export function useTariffSuggestions(
  destination?: string,
  cargoType?: string,
  service?: string,
  transportMode?: string  // NOUVEAU
) {
  return useQuery({
    queryKey: ['tariff-suggestions', destination, cargoType, service, transportMode],
    queryFn: async (): Promise<TariffSuggestion[]> => {
      const { data, error } = await supabase.functions.invoke('data-admin', {
        body: { 
          action: 'search_tariffs', 
          data: { destination, cargoType, service, transportMode } 
        }
      });
      // ...reste inchange
    },
  });
}
```

### 3. Filtrer cote serveur dans `data-admin`

**Fichier : `supabase/functions/data-admin/index.ts`** (lignes 256-324)

Dans le case `search_tariffs`, ajouter un filtre dur apres le scoring :

```typescript
case 'search_tariffs': {
  const { destination, cargoType, service, transportMode } = data;
  
  // ... chargement learned_knowledge inchange ...
  
  // Phase S1.1: Helper de categorisation mode
  const modeCategory = (mode: string | null | undefined): string | null => {
    if (!mode) return null;
    const m = mode.toLowerCase();
    if (m.includes('air')) return 'AIR';
    if (m.includes('sea') || m.includes('fcl') || m.includes('lcl') 
        || m.includes('container') || m.includes('breakbulk')) return 'SEA';
    if (m.includes('road') || m.includes('truck')) return 'ROAD';
    return null;
  };
  
  const inputMode = modeCategory(transportMode);
  
  for (const k of knowledge || []) {
    const kData = k.data as Record<string, unknown>;
    const kTransportType = kData.type_transport as string | undefined;
    
    // Phase S1.1: Hard exclusion par mode transport
    if (inputMode) {
      const kMode = modeCategory(kTransportType);
      if (kMode && kMode !== inputMode) continue;
    }
    
    // ... reste du scoring inchange ...
  }
}
```

## Resume des fichiers modifies

| Fichier | Changement |
|---------|-----------|
| `src/hooks/useTariffSuggestions.ts` | Ajouter parametre `transportMode`, le passer dans le body |
| `src/components/SimilarQuotationsPanel.tsx` | Passer `transportMode` a `useTariffSuggestions` |
| `supabase/functions/data-admin/index.ts` | Filtrage dur par `modeCategory` dans `search_tariffs` |

## Resultat attendu

- Tarifs knowledge base breakbulk/projet lourd exclus pour un cas AIR
- Seuls les tarifs dont `type_transport` est compatible (ou null) sont affiches
- Si aucun tarif compatible n'existe, le panel affiche "Aucune reference historique" au lieu de suggestions erronees

## Risque

- Faible : filtre permissif si `type_transport` est null dans la knowledge base (pas de faux negatif)
- Aucun impact sur les autres fonctionnalites
- Aucune modification DB/schema/auth

