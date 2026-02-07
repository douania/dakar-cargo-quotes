

# Correctif M3.6-fix2 : L'overlay ne re-execute pas apres l'analyse

## Probleme identifie

Les faits sont correctement en base de donnees (`service.package = DAP_PROJECT_IMPORT` confirme dans `quote_facts`). Cependant, l'overlay qui lit ces faits et pre-remplit les services ne s'execute qu'une seule fois grace au flag `factsApplied`.

Chronologie du bug :

```text
1. Page charge -> overlay execute avec les anciens facts (pas de service.package) -> factsApplied = true
2. Utilisateur clique "Analyser la demande"
3. build-case-puzzle injecte service.package = DAP_PROJECT_IMPORT
4. React Query invalide le cache, quoteFacts se met a jour
5. MAIS factsApplied est deja "true" -> l'overlay ne re-execute jamais
6. Les services restent vides
```

## Solution

### Fichier unique : `src/pages/QuotationSheet.tsx`

Dans les deux handlers qui re-executent `build-case-puzzle` :

**1. `handleRequestClarification`** (ligne ~314, apres `queryClient.invalidateQueries`) :
- Ajouter `setFactsApplied(false)` pour forcer le re-passage de l'overlay avec les nouveaux facts

**2. `handleStartAnalysis`** (ligne ~443, apres `queryClient.invalidateQueries` dans le bloc factsCount === 0) :
- Ajouter `setFactsApplied(false)` pour le meme effet

**3. `handleForceReanalyze`** (si present, meme logique) :
- Ajouter `setFactsApplied(false)` apres l'invalidation du cache

Cela permet a l'overlay de re-executer avec les facts mis a jour, y compris `service.package`, et d'injecter les services automatiquement.

## Ce qui ne change pas

Aucun autre fichier, aucune edge function, aucun schema DB, aucune RLS.

## Resultat attendu

1. Utilisateur clique "Analyser la demande"
2. `build-case-puzzle` injecte `service.package = DAP_PROJECT_IMPORT`
3. Cache invalide + `factsApplied` remis a `false`
4. L'overlay re-execute, detecte le package, injecte les 5 lignes de service
5. Badge "DAP PROJECT IMPORT" visible

