

# Phase 2 — Bouton "Analyser la demande" dans CaseView.tsx

## Résumé

3 micro-modifications chirurgicales dans un seul fichier : `src/pages/CaseView.tsx`.

## Modifications

### 1. Nouveau state (ligne 525)
Ajouter `isServiceScopeAnalyzing` après `isAnalyzing` (ligne 524).

### 2. Nouveau handler (après ligne 632)
`handleAnalyzeServiceScope()` :
- Guard : `if (!caseId || isServiceScopeAnalyzing) return`
- `supabase.functions.invoke("analyze-service-scope", { body: { case_id: caseId } })`
- En succès : `refetchEvents()`
- En erreur ou `ok: false` : `toast.error("Analyse impossible pour ce dossier")`
- State géré dans `finally`

### 3. Bouton UI (avant ligne 1776)
Insérer un `<div className="mb-3 flex justify-end">` avec un `<Button variant="outline" size="sm">` "Analyser la demande", avec spinner `Loader2` conditionnel sur `isServiceScopeAnalyzing`.

## Fichiers impactés

| Fichier | Lignes touchées |
|---------|----------------|
| `src/pages/CaseView.tsx` | ~525, ~633, ~1775 |

## Risques
- Nul. State séparé, aucun couplage avec `isAnalyzing`.

