

# Phase V4.1.1 — Patches CTO appliqués

## Patch 1 — Guidage extraction destination (build-case-puzzle)

**Fichier** : `supabase/functions/build-case-puzzle/index.ts`  
**Ligne 1264** : Ajout règle 5 après règle 4, backtick fermant propre

Règle ajoutée :
- Extraction du nom de ville uniquement (pas d'adresse complète)
- Gestion Google Plus Codes (PGQH+J2 Dakar → Dakar)
- Gestion format "Door delivery: [Company], [City] [PostCode], [Country]"
- Exclusion hôtels/resorts/adresses de rue
- Ville reconnue obligatoire (Dakar, Kaolack, Mbour, etc.)

## Patch 2 — normalizeContainerKey (price-service-lines)

**Fichier** : `supabase/functions/price-service-lines/index.ts`  
**Lignes 275-282** : Fonction normalizeContainerKey

Corrections appliquées :
- Regex `^(\d{2})FT` pour supprimer suffixe "FT" (40FTHC → 40HC)
- Nettoyage élargi : tirets et underscores inclus (`/['\s_-]/g`)

## Séquence validation E2E

1. Redéployer `build-case-puzzle` et `price-service-lines`
2. Re-lancer "Analyser la demande" sur le dossier
3. Vérifier `quote_facts` : `fact_key='routing.destination_city'`, `is_current=true`, `value_text='Dakar'`
4. Relancer pricing
5. Vérifier TRUCKING : `source='local_transport_rate'`

## Impact

| Élément | Modification |
|---|---|
| build-case-puzzle prompt | +5 lignes (règle 5) |
| normalizeContainerKey | +1 ligne regex, regex nettoyage élargi |
| Logique pricing | Zéro changement |
| Frontend | Zéro modification |
