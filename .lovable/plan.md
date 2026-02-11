

# Phase V4.1.4c — Forcer la re-injection des services quand le package change

## Diagnostic

Le backend est **deja corrige** :
- `detectFlowType` retourne `IMPORT_PROJECT_DAP` (confirme dans les logs)
- `service.package = DAP_PROJECT_IMPORT` est le fact actif en base (is_current=true)
- L'ancien `BREAKBULK_PROJECT` est bien desactive (is_current=false)

**Le probleme est cote frontend** dans `QuotationSheet.tsx` ligne 632 :

```typescript
if (packageFact?.value_text && serviceLines.length === 0) {
```

Cette condition verifie `serviceLines.length === 0`. Comme les services breakbulk ont deja ete injectes lors du run precedent, la liste n'est pas vide, et les services DAP ne remplacent jamais les anciens. Le package change en base mais les lignes de services restent celles du breakbulk.

## Solution

### Volet unique : Detecter le changement de package et re-injecter

Modifier la condition ligne 632 pour aussi re-injecter quand le **package a change** par rapport aux services actuellement affiches :

```typescript
// Avant :
if (packageFact?.value_text && serviceLines.length === 0) {

// Apres :
const currentServicesFromAI = serviceLines.every(s => s.source === 'ai_assumption');
const packageChanged = packageFact?.value_text && 
  SERVICE_PACKAGES[packageFact.value_text] && 
  (serviceLines.length === 0 || (currentServicesFromAI && 
    packageFact.value_text !== lastAppliedPackageRef.current));

if (packageChanged) {
  lastAppliedPackageRef.current = packageFact.value_text;
  // ... injection des services (code existant)
}
```

**Logique** :
1. Si aucun service n'existe (`length === 0`) : injecter (comme avant)
2. Si tous les services existants viennent de l'IA (`source === 'ai_assumption'`) ET que le package a change : **remplacer** les services par ceux du nouveau package
3. Si l'operateur a modifie/ajoute des services manuellement : ne pas ecraser (protection des edits manuels)

Un `useRef` (`lastAppliedPackageRef`) evite les boucles de re-injection.

### Impact

| Element | Modification |
|---|---|
| QuotationSheet.tsx | ~10 lignes (ref + condition + guard) |
| Autres fichiers | Zero changement |
| Edge functions | Zero modification |
| Migration SQL | Aucune |

### Resultat attendu

1. Au rechargement de la page ou apres "Analyser la demande", le badge affiche `DAP PROJECT IMPORT`
2. Les services affiches passent de breakbulk (Dechargement navire, Survey) a conteneur (DTHC, Transport, Restitution vide, Douane)
3. Si l'operateur a manuellement edite des services, ils ne sont pas ecrases

### Validation

1. Relancer "Analyser la demande" ou recharger la page
2. Verifier que les services sont ceux du package DAP (pas breakbulk)
3. Verifier que le badge affiche "DAP PROJECT IMPORT"
4. Tester qu'apres une modification manuelle d'un service, le remplacement automatique ne se declenche plus

