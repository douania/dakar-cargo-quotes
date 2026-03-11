

# Fix: Ajouter KHALIFA au PORT_COUNTRY_MAP

## Probleme
Le port "Port of Khalifa" (Abu Dhabi, UAE) n'est pas dans `PORT_COUNTRY_MAP`. `resolveCountry()` retourne une chaine vide pour `destCountry`, ce qui bloque Rule 2 (EXPORT_SENEGAL) car elle exige `destCountry` non-vide.

## Fix
**Fichier : `supabase/functions/build-case-puzzle/index.ts`** — 1 ligne modifiee

Ligne 344, ajouter KHALIFA apres JEBEL ALI :

```
'DUBAI': 'AE', 'JEBEL ALI': 'AE',
```
devient :
```
'DUBAI': 'AE', 'JEBEL ALI': 'AE', 'KHALIFA': 'AE',
```

## Resultat attendu apres rerun

1. `resolveCountry()` : "PORT OF KHALIFA" contient "KHALIFA" → `destCountry` = `AE`
2. `detectFlowType()` Rule 2 : `isOriginSN=true`, `destCountry=AE`, `AE !== SN` → retourne **EXPORT_SENEGAL**
3. `ASSUMPTION_RULES.EXPORT_SENEGAL` injecte :
   - `service.package` = EXPORT_SENEGAL
   - `tax.vat_rate` = 0.18
4. Pricing debloque

## Scope
- 1 fichier, 1 ligne
- Pas de migration, pas de changement UI, pas de zone FROZEN touchee

