

# Phase 8.7 Ajustements CTO — Verrouillage Final

## Contexte

Deux ajustements mineurs obligatoires demandés par le CTO pour finaliser Phase 8.7 :

1. **Garde-fou #1 étendu** : Bloquer "Générer" si l'analyse quote_case n'est pas encore chargée
2. **UX explicite** : Afficher un loader pendant le chargement de l'analyse

Ces ajustements ne modifient aucune logique métier — ils renforcent la gouvernance visuelle.

---

## Ajustement 1 : Gating Étendu du Bouton "Générer"

### Fichier
`src/features/quotation/components/QuotationHeader.tsx`

### Modification

**Ligne 64** — Ajouter `quoteCaseStatus !== undefined` à la condition :

| Avant | Après |
|-------|-------|
| `const canGenerate = !isGenerating && currentDraft?.id && !hasBlockingGaps;` | `const canGenerate = !isGenerating && !!currentDraft?.id && !hasBlockingGaps && quoteCaseStatus !== undefined;` |

### Logique

```
canGenerate = 
  !isGenerating              // pas en cours de génération
  && !!currentDraft?.id      // brouillon sauvegardé
  && !hasBlockingGaps        // pas de gaps bloquants
  && quoteCaseStatus !== undefined  // NOUVEAU: analyse disponible
```

### Tooltip Supplémentaire

Ajouter un cas dans le tooltip pour expliquer le blocage si `quoteCaseStatus === undefined` :

```
{quoteCaseStatus === undefined && currentDraft?.id && (
  <p>Analyse de qualification en cours...</p>
)}
```

---

## Ajustement 2 : Loader Pendant Chargement Quote Case

### Fichier
`src/pages/QuotationSheet.tsx`

### Modification

**Lignes 917-926** — Ajouter un bloc loader explicite :

| Avant | Après |
|-------|-------|
| Condition : `!isLoadingQuoteCase && (blockingGaps.length > 0 \|\| quoteCase)` | Ajouter un bloc séparé pour `isLoadingQuoteCase` |

### Code à Ajouter (avant BlockingGapsPanel)

```text
{/* Phase 8.7: Loader pendant chargement quote_case */}
{!quotationCompleted && isLoadingQuoteCase && (
  <div className="mb-6 text-sm text-muted-foreground flex items-center gap-2">
    <Loader2 className="h-4 w-4 animate-spin" />
    Analyse de qualification en cours…
  </div>
)}
```

### Position dans le DOM

```
<QuotationHeader ... />

{/* NOUVEAU: Loader explicite */}
{!quotationCompleted && isLoadingQuoteCase && (
  <div className="mb-6 ...">...</div>
)}

{/* BlockingGapsPanel existant */}
{!quotationCompleted && !isLoadingQuoteCase && ...}
```

---

## Fichiers Modifiés

| Fichier | Modification | Lignes |
|---------|--------------|--------|
| `src/features/quotation/components/QuotationHeader.tsx` | Condition `canGenerate` + tooltip | L64, L179-182 |
| `src/pages/QuotationSheet.tsx` | Loader pendant chargement | L917-918 (insertion) |

---

## Impact

| Aspect | Évaluation |
|--------|------------|
| Risque | Nul — ajout de conditions défensives |
| UX | Amélioré — plus de silence système |
| Performance | Aucun impact |
| Backend | Aucun changement |

---

## Résultat Attendu

### Scénario 1 : Quote Case Non Encore Chargé

- Loader visible : "Analyse de qualification en cours…"
- Bouton "Générer" : **Désactivé**
- Tooltip : "Analyse de qualification en cours..."
- Badge header : "Dossier non analysé"

### Scénario 2 : Quote Case Chargé avec Gaps

- BlockingGapsPanel visible avec liste des gaps
- Bouton "Générer" : **Désactivé**
- Tooltip : "Cotation bloquée : X informations manquantes"
- Bouton "Demander clarification" : Visible

### Scénario 3 : Quote Case Chargé sans Gaps

- BlockingGapsPanel : Message positif "Dossier prêt"
- Bouton "Générer" : **Activé**
- Workflow normal

