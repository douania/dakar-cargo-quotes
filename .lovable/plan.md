

# Phase V4.1.4b — Fix flow detection ignoring stale service.package

## Diagnostic

Les logs montrent que le patch precedent fonctionne partiellement :
- `hasContainers=true` (correct)
- `detectFlowType` retourne `UNKNOWN` au lieu de `IMPORT_PROJECT_DAP`

**Cause racine** : Ligne 362 de `detectFlowType`, la condition `!servicePackage` bloque la regle 4 car `service.package = BREAKBULK_PROJECT` est deja persiste dans `quote_facts` (residue du run precedent bugge). La fonction charge les facts existants AVANT de re-detecter le flow, ce qui cree une dependance circulaire : le flow ne peut pas etre corrige car l'ancien `service.package` errone empeche la re-detection.

```
factMap contient : service.package = BREAKBULK_PROJECT (ai_assumption, confiance 0.70)
  -> detectFlowType voit servicePackage = "BREAKBULK_PROJECT"
  -> Rule 4: destCountry === 'SN' && !servicePackage => FALSE (car servicePackage n'est pas vide)
  -> Retourne UNKNOWN
  -> Pas d'assumptions appliquees
  -> service.package reste BREAKBULK_PROJECT
```

## Solution

### Volet unique : Ignorer service.package dans detectFlowType

`detectFlowType` est cense DETERMINER le flow type, pas le lire. Le fait `service.package` est un OUTPUT de cette detection, pas un INPUT. Il faut supprimer la lecture de `service.package` dans la condition.

**Fichier** : `supabase/functions/build-case-puzzle/index.ts`

**Ligne 339** : Supprimer la lecture de `service.package` du factMap.

**Ligne 362** : Retirer la condition `!servicePackage`.

Avant :
```typescript
const servicePackage = factMap.get('service.package')?.value || '';
// ...
if (destCountry === 'SN' && !servicePackage) {
```

Apres :
```typescript
// service.package is REMOVED from detectFlowType inputs — it's an OUTPUT, not an INPUT
// ...
if (destCountry === 'SN') {
```

### Nettoyage du fait errone

Pas de migration SQL necessaire. Le fait `service.package = BREAKBULK_PROJECT` sera automatiquement remplace par `IMPORT_PROJECT_DAP` via le RPC `supersede_fact` lors du prochain run, car `ai_assumption` n'est pas une source protegee.

### Impact

| Element | Modification |
|---|---|
| build-case-puzzle/detectFlowType | 2 lignes modifiees (suppression servicePackage) |
| Autres fichiers | Zero changement |
| Migration SQL | Aucune |

### Resultat attendu

1. `detectFlowType` retourne `IMPORT_PROJECT_DAP` (destCountry=SN + hasContainers + weightKg > 5000)
2. Les assumptions pour `IMPORT_PROJECT_DAP` sont appliquees (DTHC, Transport, Restitution vide, Douane)
3. `service.package` est mis a jour de `BREAKBULK_PROJECT` a `IMPORT_PROJECT_DAP`
4. Les services breakbulk (dechargement navire, survey) sont remplaces par les services conteneur

### Validation

1. Redeployer `build-case-puzzle`
2. Relancer "Analyser la demande"
3. Verifier dans les logs : `Detected flow type: IMPORT_PROJECT_DAP`
4. Verifier que les services pre-remplis sont ceux du package DAP (pas breakbulk)

