

# Phase M3.6 -- Auto-population des services depuis service.package

## Modifications

### Fichier 1 : `src/features/quotation/constants.ts`

**1a. Enrichir `serviceTemplates`** avec les services metier manquants. Les services existants restent inchanges, on ajoute :

| Cle service | Libelle | Unite |
|---|---|---|
| PORT_DAKAR_HANDLING | Frais port Dakar | tonne |
| CUSTOMS_DAKAR | Dedouanement Dakar | declaration |
| CUSTOMS_EXPORT | Dedouanement export | declaration |
| BORDER_FEES | Frais frontiere | forfait |
| AGENCY | Frais agence | forfait |
| SURVEY | Survey port + site | forfait |

**1b. Ajouter `SERVICE_PACKAGES`** -- mapping package vers cles de services :

```text
DAP_PROJECT_IMPORT    -> PORT_DAKAR_HANDLING, DTHC, TRUCKING, EMPTY_RETURN, CUSTOMS_DAKAR
TRANSIT_GAMBIA_ALL_IN -> PORT_DAKAR_HANDLING, DTHC, TRUCKING, BORDER_FEES, AGENCY
EXPORT_SENEGAL        -> PORT_CHARGES, CUSTOMS_EXPORT, AGENCY
BREAKBULK_PROJECT     -> DISCHARGE, PORT_DAKAR_HANDLING, TRUCKING, SURVEY, CUSTOMS_DAKAR
```

### Fichier 2 : `src/pages/QuotationSheet.tsx`

Dans le `useEffect` d'overlay (ligne 551-619), juste avant `setFactsApplied(true)` (ligne 618), ajouter :

1. Lire `service.package` depuis `factsMap`
2. Si `serviceLines.length === 0` et package connu dans `SERVICE_PACKAGES`
3. Pour chaque cle, trouver le template dans `serviceTemplates`
4. Creer des `ServiceLine` avec `source: 'ai_assumption'`, `rate: undefined`, `quantity: 1`
5. Appeler `setServiceLines(autoLines)`

Ajouter `serviceLines` et `setServiceLines` aux dependances du useEffect (ligne 619).

Import `SERVICE_PACKAGES` depuis constants.ts.

### Fichier 3 : `src/features/quotation/components/ServiceLinesForm.tsx`

Ajouter un indicateur visuel du package detecte en haut du formulaire :
- Accepte une nouvelle prop optionnelle `detectedPackage?: string`
- Si presente, affiche un `Badge` avec le nom du package (ex: "DAP Project Import")
- Permet a l'operateur de voir la decision principale du systeme

### Ce qui ne change pas

| Element | Impact |
|---|---|
| Edge functions | Aucun |
| Schema DB | Aucun |
| Moteur M3.5.1 | Aucun |
| Pricing engine | Aucun |
| RLS | Aucun |
| useServiceLines hook | Aucun (on utilise le setServiceLines existant) |

### Resultat attendu (cas Aboudi)

1. Clic "Analyser la demande"
2. M3.5.1 injecte `service.package = DAP_PROJECT_IMPORT`
3. Overlay detecte le fait, pre-remplit 5 lignes de service
4. Badge "DAP Project Import" visible en haut du formulaire services
5. Operateur ajuste si besoin, puis genere la reponse

### Notes pour la suite

- M3.6.1 : ajout `CUSTOMS_BAMAKO` pour les corridors Mali
- M3.7 : auto-pricing par service (remplissage des tarifs depuis grilles PAD, historique, regles corridor)

