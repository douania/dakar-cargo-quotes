
# Plan Minimal - Bouton "Démarrer l'analyse" pour Phase 12

## Objectif
Ajouter un trigger UI minimal pour appeler `ensure-quote-case` afin de créer des données réelles pour valider Phase 12.

---

## Corrections CTO appliquées

| Correction | Status |
|------------|--------|
| CTO #1 - threadRef canonique (pas `[0]`) | Appliquée via `stableThreadRef` |
| CTO #2 - Anti double-clic + disabled + erreur exacte | Appliquée |
| CTO #3 - Pas de PuzzleControlPanel.tsx | Respectée |
| CTO #4 - DecisionSupportPanel non modifié | Respectée (commit-decision prouvé) |
| CTO #5 - Remplacer `window.location.reload()` | Corrigée via `queryClient.invalidateQueries()` |

---

## Modifications (2 fichiers uniquement)

### Fichier 1 : `src/pages/QuotationSheet.tsx`

#### Modification 1.1 - Ajouter import React Query (après ligne 54)
```typescript
import { useQueryClient } from '@tanstack/react-query';
```

#### Modification 1.2 - Ajouter les states (après ligne 167)
```typescript
// CTO #1: thread_ref canonique - évite dépendance threadEmails[0]
const [stableThreadRef, setStableThreadRef] = useState<string | null>(null);

// CTO #2: Anti double-clic pour ensure-quote-case
const [isStartingAnalysis, setIsStartingAnalysis] = useState(false);
```

#### Modification 1.3 - Déclarer queryClient (après ligne 213)
```typescript
// CTO #5: Invalidation React Query au lieu de reload
const queryClient = useQueryClient();
```

#### Modification 1.4 - Remplacer threadRef fragile (lignes 219-220)
Remplacer :
```typescript
const threadRef = threadEmails[0]?.thread_ref || null;
const { quoteCase, blockingGaps, isLoading: isLoadingQuoteCase } = useQuoteCaseData(threadRef ?? undefined);
```

Par :
```typescript
// CTO #1: Utiliser stableThreadRef au lieu de threadEmails[0]
const threadRef = stableThreadRef;
const { quoteCase, blockingGaps, isLoading: isLoadingQuoteCase } = useQuoteCaseData(stableThreadRef ?? undefined);
```

#### Modification 1.5 - Stocker stableThreadRef dans fetchThreadData (après ligne 372)
Dans le bloc `if (emailData.thread_ref)` :
```typescript
setStableThreadRef(emailData.thread_ref);  // CTO: source canonique
```

#### Modification 1.6 - Ajouter handler handleStartAnalysis (après ligne 294)
```typescript
// ============================================================================
// Phase 12 Validation - Trigger ensure-quote-case
// CTO #2: Anti double-clic + idempotence + message d'erreur exact
// CTO #5: Invalidation React Query (pas de reload)
// ============================================================================
const handleStartAnalysis = useCallback(async () => {
  if (!stableThreadRef) {
    toast.error('Fil email introuvable - impossible de créer le dossier');
    return;
  }
  
  if (isStartingAnalysis) return;
  
  setIsStartingAnalysis(true);
  try {
    const { data, error } = await supabase.functions.invoke('ensure-quote-case', {
      body: { thread_id: stableThreadRef }
    });
    
    if (error) throw error;
    
    if (data.is_new) {
      toast.success(`Dossier créé : ${data.case_id.slice(0, 8)}...`);
    } else {
      toast.info(`Dossier existant : ${data.status}`);
    }
    
    // CTO #5: Invalidation React Query au lieu de window.location.reload()
    queryClient.invalidateQueries({ queryKey: ['quote-case', stableThreadRef] });
    
  } catch (err: unknown) {
    console.error('[ensure-quote-case] Error:', err);
    const message = err instanceof Error ? err.message : 'Erreur création du dossier';
    toast.error(message);
  } finally {
    setIsStartingAnalysis(false);
  }
}, [stableThreadRef, isStartingAnalysis, queryClient]);
```

#### Modification 1.7 - Props QuotationHeader (vers ligne 970)
Ajouter 3 props après `isLoadingClarification` :
```typescript
onStartAnalysis={handleStartAnalysis}
isStartingAnalysis={isStartingAnalysis}
hasQuoteCase={!!quoteCase}
```

---

### Fichier 2 : `src/features/quotation/components/QuotationHeader.tsx`

#### Modification 2.1 - Import Plus (ligne 6)
```typescript
import { ArrowLeft, CheckCircle, MessageSquare, Loader2, Send, Save, HelpCircle, AlertTriangle, Plus } from 'lucide-react';
```

#### Modification 2.2 - Props interface (après ligne 32)
```typescript
// Phase 12: Trigger ensure-quote-case
onStartAnalysis?: () => void;
isStartingAnalysis?: boolean;
hasQuoteCase?: boolean;
```

#### Modification 2.3 - Déstructuration (vers ligne 64)
Ajouter :
```typescript
onStartAnalysis,
isStartingAnalysis = false,
hasQuoteCase = false,
```

#### Modification 2.4 - Bouton conditionnel (après ligne 150, avant le bloc onRequestClarification)
```typescript
{/* Phase 12: Bouton "Démarrer l'analyse" si pas de quote_case */}
{onStartAnalysis && !hasQuoteCase && (
  <Button 
    variant="secondary"
    onClick={onStartAnalysis}
    disabled={isStartingAnalysis}
  >
    {isStartingAnalysis ? (
      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
    ) : (
      <Plus className="h-4 w-4 mr-2" />
    )}
    Démarrer l'analyse
  </Button>
)}
```

---

## Exclusions CTO

| Élément | Action |
|---------|--------|
| PuzzleControlPanel.tsx | NON créé |
| DecisionSupportPanel.tsx | NON modifié |
| window.location.reload() | INTERDIT - remplacé par invalidateQueries |
| Renommages | AUCUN |
| Refactor structurel | AUCUN |

---

## Tests de non-régression

### Test A - Idempotence start-analysis
1. Cliquer "Démarrer l'analyse" → `Dossier créé : xxx`
2. Re-cliquer immédiatement → aucune action (disabled)
3. Après refresh, re-cliquer → `Dossier existant : NEW_THREAD` (pas d'erreur 500)

### Test B - Visibilité panels par status
| Status quote_case | Éléments visibles |
|-------------------|-------------------|
| `null` | Bouton "Démarrer l'analyse" + Badge "Dossier non analysé" |
| `NEW_THREAD` | BlockingGapsPanel |
| `PRICED_DRAFT` | PricingResultPanel + QuotationVersionCard |

---

## Séquence REAL FLOW Phase 12

1. Naviguer vers `/quotation/3f4e845f-25d0-4d21-b0fb-a481fa97eeea`
2. Cliquer "Démarrer l'analyse" → `ensure-quote-case`
3. Cliquer "Analyser la demande" → `build-case-puzzle`
4. Prendre les 5 décisions → `commit-decision`
5. Valider pour pricing → `ack-pricing-ready`
6. Lancer le pricing → `run-pricing`
7. Créer version → `generate-quotation-version`
8. Exécuter les 5 tests Phase 12

---

## Section technique

### Import React Query requis
Le fichier `QuotationSheet.tsx` n'utilise pas encore directement `@tanstack/react-query`. L'import sera ajouté à la ligne 55.

### Pattern validé dans le codebase
Le pattern `queryClient.invalidateQueries()` est déjà utilisé dans 8 autres fichiers admin (HsCodes, Tenders, Documents, etc.) avec la même syntaxe.

### Résumé des modifications

| Fichier | Lignes impactées | Ajouts |
|---------|------------------|--------|
| `QuotationSheet.tsx` | ~55, ~167, ~213, ~219-220, ~294, ~372, ~970 | 1 import, 2 states, 1 queryClient, 1 handler, 1 ligne fetchThreadData, 3 props |
| `QuotationHeader.tsx` | ~6, ~32, ~64, ~150 | 1 import, 3 props, 1 bouton |

**Total** : ~35 lignes ajoutées, 0 fichier créé, 0 renommage, 0 reload.
