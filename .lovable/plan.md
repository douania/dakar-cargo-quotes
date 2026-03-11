

# Fix: Ajouter KHORFAKKAN (et autres ports UAE manquants) au PORT_COUNTRY_MAP

## Diagnostic
L'IA a supersédé `routing.destination_port` de "Khalifa" vers **"Khorfakkan"** lors du rerun. Le fix precedent (`KHALIFA → AE`) est actif mais ne couvre pas ce nouveau port. `resolveCountry()` retourne vide, `flowType` reste `UNKNOWN`, pas de `service.package`.

Khorfakkan est un port majeur des UAE (Sharjah). Le probleme de fond est le meme : referentiel incomplet.

## Fix
**Fichier : `supabase/functions/build-case-puzzle/index.ts`** — ligne 344

Actuel :
```
'DUBAI': 'AE', 'JEBEL ALI': 'AE', 'KHALIFA': 'AE',
```

Nouveau :
```
'DUBAI': 'AE', 'JEBEL ALI': 'AE', 'KHALIFA': 'AE', 'KHORFAKKAN': 'AE', 'KHOR FAKKAN': 'AE', 'FUJAIRAH': 'AE', 'ABU DHABI': 'AE',
```

Ajouts : KHORFAKKAN, KHOR FAKKAN (variante orthographique), FUJAIRAH, ABU DHABI — les 4 ports UAE les plus courants encore absents.

## Resultat attendu
1. `resolveCountry("KHORFAKKAN")` → `AE`
2. Rule 2 EXPORT_SENEGAL declenche (origin=SN, dest=AE, AE != SN)
3. `service.package` = EXPORT_SENEGAL injecte
4. Pricing debloque

## Scope
- 1 fichier, 1 ligne modifiee
- Pas de migration, pas de changement UI

