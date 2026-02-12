

# Phase V4.1.4e — Extraire la synchro package/services du useEffect bloqué

## Diagnostic final (preuve irréfutable)

Le problème N'EST PI le filtre `is_current` (celui-ci est correct dans le code). Le problème est le **flag `factsApplied`** :

```
Ligne 562: if (factsApplied || !quoteFacts || ...) return;
Ligne 677: setFactsApplied(true);
```

Sequence reelle :
1. Premier chargement : `factsApplied=false` -> useEffect s'execute -> injecte services BREAKBULK -> `factsApplied=true`
2. Re-analyse lancee -> backend corrige `service.package` en `DAP_PROJECT_IMPORT`
3. React Query invalide et re-fetch `quote_facts` avec les bons faits
4. useEffect se re-evalue mais `factsApplied=true` -> **RETURN IMMEDIAT** -> services jamais mis a jour

Le filtre `is_current=true` est necessaire mais pas suffisant : il empeche le mauvais affichage du badge, mais la synchro des services est bloquee par le guard `factsApplied`.

## Solution : Separer la synchro package du useEffect principal

### Volet A : Extraire la synchro services dans un useEffect dedie

Fichier : `src/pages/QuotationSheet.tsx`

Deplacer le bloc "M3.6: Auto-populate service lines" (lignes 632-675) dans un useEffect **separe** qui ne depend PAS de `factsApplied` :

```typescript
// useEffect dedie pour synchro package -> services
// Reactif au changement de package, independant du flag factsApplied
useEffect(() => {
  if (!quoteFacts || quoteFacts.length === 0) return;
  
  const packageFact = quoteFacts.find(f => f.fact_key === 'service.package');
  if (!packageFact?.value_text) return;
  
  const packageKey = packageFact.value_text;
  if (!SERVICE_PACKAGES[packageKey]) return;
  
  // Deja applique ce package -> skip
  if (packageKey === lastAppliedPackageRef.current) return;
  
  // Protection edits manuels : ne remplacer que si tous sont AI
  const allAI = serviceLines.length === 0 || 
    serviceLines.every(s => s.source === 'ai_assumption');
  if (!allAI) return;
  
  // Injecter les services du nouveau package
  lastAppliedPackageRef.current = packageKey;
  const serviceKeys = SERVICE_PACKAGES[packageKey];
  const autoLines: ServiceLine[] = serviceKeys.map(key => {
    const template = serviceTemplates.find(t => t.service === key);
    return {
      id: crypto.randomUUID(),
      service: template?.service || key,
      description: template?.description || key,
      unit: template?.unit || 'forfait',
      quantity: 1,
      rate: undefined,
      currency: 'FCFA',
      source: 'ai_assumption' as const,
    };
  }).filter(Boolean);
  
  if (autoLines.length > 0) {
    setServiceLines(autoLines);
    // Auto-pricing
    const caseId = quoteCase?.id;
    if (caseId) {
      callPriceServiceLines(caseId, autoLines).catch(err => {
        console.warn('[M3.7] Auto-pricing failed:', err);
      });
    }
  }
}, [quoteFacts, serviceLines, quoteCase?.id]);
```

### Volet B : Retirer le bloc package du useEffect principal

Dans le useEffect principal (ligne 561-678), supprimer les lignes 632-675 (le bloc `M3.6`) car elles sont maintenant dans le useEffect dedie.

Le useEffect principal garde uniquement : company, email, destination, cargo lines.

### Volet C : Initialiser lastAppliedPackageRef au chargement

Pour eviter un re-inject inutile au premier chargement quand les services sont deja corrects, initialiser le ref dans le useEffect principal :

```typescript
// Dans le useEffect principal, apres injection initiale :
const pkgFact = factsMap.get('service.package');
if (pkgFact?.value_text) {
  lastAppliedPackageRef.current = pkgFact.value_text;
}
```

## Fichiers impactes

| Fichier | Modification |
|---|---|
| `src/pages/QuotationSheet.tsx` | Extraction du bloc M3.6 dans un useEffect dedie (~40 lignes deplacees + 5 lignes ajoutees) |

Aucun autre fichier modifie. Aucune migration SQL. Aucune edge function.

## Resultat attendu

1. Au premier chargement : comportement inchange (injection des services du package detecte)
2. Apres re-analyse qui change le package : les services sont REMPLACES automatiquement
3. Si l'operateur a edite manuellement un service : pas d'ecrasement (guard `allAI`)
4. Idempotent : recharger la page donne le meme resultat

## Risques

- Risque de double-injection si les deux useEffect courent en parallele au premier rendu -> mitige par `lastAppliedPackageRef` qui empeche le deuxieme useEffect de re-injecter le meme package
- Le `staleTime: 30000` de React Query peut retarder la mise a jour de 30s maximum apres invalidation -> acceptable pour ce cas d'usage
