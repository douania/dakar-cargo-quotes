
# PLAN D'IMPLÉMENTATION PHASE 9.4

## UI DecisionSupportPanel (Aide a la decision humaine)

---

## 1. VERIFICATION DU CODEBASE

### 1.1 Ressources confirmees existantes

| Ressource | Chemin | Statut |
|-----------|--------|--------|
| Edge Function `suggest-decisions` | `supabase/functions/suggest-decisions/index.ts` | OK - STATELESS |
| Edge Function `commit-decision` | `supabase/functions/commit-decision/index.ts` | OK - SEUL WRITE POINT |
| Hook `useQuoteCaseData` | `src/hooks/useQuoteCaseData.ts` | OK - Lecture quote_case + gaps |
| Page `QuotationSheet` | `src/pages/QuotationSheet.tsx` | OK - Integration cible |
| Composant `BlockingGapsPanel` | `src/components/puzzle/BlockingGapsPanel.tsx` | OK - Pattern existant |
| Composant `ClarificationPanel` | `src/components/puzzle/ClarificationPanel.tsx` | OK - Pattern existant |

### 1.2 Composants UI existants a reutiliser

- `Card`, `CardHeader`, `CardContent`, `CardTitle`, `CardDescription`
- `Button` (variants: default, outline, ghost)
- `Badge` (variants: default, secondary, outline, destructive)
- `RadioGroup`, `RadioGroupItem`
- `AlertDialog` + sous-composants (confirmation)
- `Textarea`, `Input`, `Label`
- `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent`
- `Loader2`, `CheckCircle`, `AlertTriangle` (icones)

### 1.3 Contrats API confirmes

**suggest-decisions (INPUT)**:
```typescript
{ case_id: string; decision_types?: DecisionType[] }
```

**suggest-decisions (OUTPUT)**:
```typescript
{ 
  proposals: DecisionProposal[]; 
  missing_info: string[]; 
  can_proceed: false 
}
```

**commit-decision (INPUT)**:
```typescript
{
  case_id: string;
  decision_type: DecisionType;
  proposal_json: { options: any[]; source_fact_ids: string[] };
  selected_key: string;
  override_value?: string;
  override_reason?: string;
}
```

**commit-decision (OUTPUT)**:
```typescript
{ decision_id: string; remaining_decisions: number; all_complete: boolean }
```

---

## 2. ARCHITECTURE DES COMPOSANTS

```text
+------------------------------------------------------------------+
|                      QuotationSheet.tsx                          |
|                                                                  |
|  +------------------------------------------------------------+  |
|  |  BlockingGapsPanel (Phase 8.7)                             |  |
|  +------------------------------------------------------------+  |
|                                                                  |
|  +------------------------------------------------------------+  |
|  |  ClarificationPanel (Phase 8.8)                            |  |
|  +------------------------------------------------------------+  |
|                                                                  |
|  +------------------------------------------------------------+  |
|  |  DecisionSupportPanel (Phase 9.4) <-- NOUVEAU              |  |
|  |                                                             |  |
|  |  +-------------------------------------------------------+  |  |
|  |  |  [Generer les options de decision]  <-- Bouton manuel |  |  |
|  |  +-------------------------------------------------------+  |  |
|  |                                                             |  |
|  |  +-------------------------------------------------------+  |  |
|  |  |  DecisionProgressIndicator <-- NOUVEAU                |  |  |
|  |  |  Decisions validees: 3 / 5                            |  |  |
|  |  +-------------------------------------------------------+  |  |
|  |                                                             |  |
|  |  +-------------------------------------------------------+  |  |
|  |  |  DecisionTypeSection x 5                              |  |  |
|  |  |  - Regime douanier                                    |  |  |
|  |  |  - Routage                                            |  |  |
|  |  |  - Services                                           |  |  |
|  |  |  - Incoterm                                           |  |  |
|  |  |  - Conteneur                                          |  |  |
|  |  +-------------------------------------------------------+  |  |
|  +------------------------------------------------------------+  |
+------------------------------------------------------------------+
```

---

## 3. LIVRABLES

### 3.1 Fichiers a creer

| Fichier | Responsabilite |
|---------|----------------|
| `src/components/puzzle/DecisionSupportPanel.tsx` | Panneau principal aide a la decision |
| `src/components/puzzle/DecisionProgressIndicator.tsx` | Indicateur avancement 0-5 |
| `src/hooks/useDecisionSupport.ts` | Hook orchestration appels API |

### 3.2 Fichiers a modifier

| Fichier | Modification |
|---------|--------------|
| `src/pages/QuotationSheet.tsx` | Integrer DecisionSupportPanel apres ClarificationPanel |

---

## 4. SPECIFICATION TECHNIQUE

### 4.1 Hook `useDecisionSupport.ts`

```typescript
// src/hooks/useDecisionSupport.ts

interface DecisionOption {
  key: string;
  label_fr: string;
  label_en: string;
  justification_fr: string;
  justification_en: string;
  pros: string[];
  cons: string[];
  confidence_level: 'low' | 'medium' | 'high';
  is_recommended: boolean;
}

interface DecisionProposal {
  decision_type: DecisionType;
  options: DecisionOption[];
  source_fact_ids: string[];
}

type DecisionType = 'regime' | 'routing' | 'services' | 'incoterm' | 'container';

interface LocalDecisionState {
  selectedKey: string | null;
  overrideValue: string | null;
  overrideReason: string | null;
  isCommitted: boolean;
  committedAt: string | null;
}

interface UseDecisionSupportReturn {
  // Donnees
  proposals: DecisionProposal[];
  missingInfo: string[];
  isLoading: boolean;
  isCommitting: boolean;
  error: string | null;
  
  // Etat local par decision_type
  localState: Record<DecisionType, LocalDecisionState>;
  
  // Actions
  generateOptions: () => Promise<void>;
  selectOption: (type: DecisionType, key: string) => void;
  setOverride: (type: DecisionType, value: string, reason: string) => void;
  commitDecision: (type: DecisionType) => Promise<CommitResult>;
  
  // Statistiques
  committedCount: number;
  remainingCount: number;
  allComplete: boolean;
}
```

**Regles du hook**:
- Aucune logique metier
- Orchestration pure des appels Edge Functions
- Etat local pour selections (pas de write DB direct)
- Utilise `supabase.functions.invoke()`

### 4.2 Composant `DecisionProgressIndicator.tsx`

```typescript
// src/components/puzzle/DecisionProgressIndicator.tsx

interface Props {
  decisions: {
    type: DecisionType;
    label: string;
    isCommitted: boolean;
  }[];
}

// Affiche:
// Decisions validees: 3 / 5
// - Regime       [check]
// - Routage      [check] 
// - Services     [pending]
// - Incoterm     [pending]
// - Conteneur    [check]

// REGLES CTO:
// - Aucun bouton "continuer"
// - Aucun changement de statut
// - Lecture pure
```

### 4.3 Composant `DecisionSupportPanel.tsx`

Structure interne:
```text
DecisionSupportPanel
|
+-- Bouton "Generer les options" (manuel)
|
+-- DecisionProgressIndicator (lecture)
|
+-- Pour chaque DecisionProposal:
    |
    +-- Card avec titre du type
    |
    +-- RadioGroup (choix exclusif)
    |   |
    |   +-- Pour chaque option:
    |       +-- RadioGroupItem
    |       +-- Label + Badge "Recommande" (si is_recommended)
    |       +-- Justification (collapsed)
    |       +-- Pros/Cons (collapsed)
    |       +-- Badge confiance
    |
    +-- Option "Autre choix" avec champ libre
    |   +-- Si selectionne: champ justification OBLIGATOIRE
    |
    +-- Bouton "Valider ce choix"
    |   +-- Disabled si aucune selection
    |   +-- Disabled si override sans reason
    |
    +-- AlertDialog de confirmation
        +-- Resume du choix
        +-- Avertissement tracabilite
        +-- [Annuler] [Confirmer]
```

---

## 5. REGLES CTO STRICTES

### 5.1 Interdits absolus (verifies dans le code)

```typescript
// JAMAIS dans DecisionSupportPanel.tsx:
supabase.from(...).insert(...)
supabase.from(...).update(...)
supabase.from(...).delete(...)

// JAMAIS d'auto-selection:
const [selectedKey, setSelectedKey] = useState(null); // OK
const [selectedKey, setSelectedKey] = useState(options[0]?.key); // INTERDIT

// JAMAIS de bouton auto:
onClick={() => navigate('/pricing')} // INTERDIT
```

### 5.2 Pattern de confirmation obligatoire

```typescript
// Sequence obligatoire pour commit:
// 1. Selection humaine (RadioGroup)
// 2. Clic "Valider ce choix"
// 3. AlertDialog s'ouvre
// 4. Clic "Confirmer" dans AlertDialog
// 5. Appel commit-decision
// 6. UI mise a jour

// JAMAIS de commit sans confirmation dialog
```

### 5.3 Override avec justification

```typescript
// Si override_value !== null:
if (!overrideReason || overrideReason.trim() === '') {
  // Bouton "Valider" = DISABLED
  // Message: "Justification obligatoire pour un choix personnalise"
}
```

---

## 6. CONDITIONS D'AFFICHAGE

Le DecisionSupportPanel sera visible UNIQUEMENT si:
```typescript
const showDecisionSupport = 
  !quotationCompleted && 
  quoteCase?.status && 
  ['DECISIONS_PENDING', 'DECISIONS_COMPLETE'].includes(quoteCase.status);
```

Position dans QuotationSheet:
1. BlockingGapsPanel (Phase 8.7)
2. ClarificationPanel (Phase 8.8)
3. **DecisionSupportPanel (Phase 9.4)** <-- ICI
4. Reste du formulaire...

---

## 7. LABELS FRANCAIS

```typescript
const DECISION_TYPE_LABELS: Record<DecisionType, { label: string; icon: LucideIcon }> = {
  regime: { label: 'Regime douanier', icon: FileText },
  routing: { label: 'Itineraire logistique', icon: MapPin },
  services: { label: 'Perimetre de services', icon: Settings },
  incoterm: { label: 'Incoterm', icon: FileSignature },
  container: { label: 'Strategie conteneur', icon: Container },
};

const CONFIDENCE_LABELS: Record<string, { label: string; variant: string }> = {
  low: { label: 'Faible confiance', variant: 'destructive' },
  medium: { label: 'Confiance moyenne', variant: 'secondary' },
  high: { label: 'Haute confiance', variant: 'default' },
};
```

---

## 8. GESTION DES ERREURS

```typescript
// Erreur 409 (statut invalide)
if (error.status === 409) {
  toast.error("Le dossier n'est pas pret pour les decisions");
}

// Erreur 403 (ownership)
if (error.status === 403) {
  toast.error("Vous n'avez pas acces a ce dossier");
}

// Erreur 400 (validation)
if (error.status === 400) {
  toast.error(error.message || "Donnees invalides");
}
```

---

## 9. TESTS UI A REUSSIR

| Test | Verification |
|------|--------------|
| Impossible de valider sans selection | Bouton disabled |
| Impossible de valider "Autre" sans justification | Bouton disabled + message |
| Impossible de commit sans confirmation | AlertDialog obligatoire |
| Chaque clic confirme = 1 appel commit-decision | Logs reseau |
| Refresh page = decisions deja validees visibles | Persistance |
| Aucune option masquee | Toutes visibles |
| Aucun auto-flow vers pricing | Pas de navigation auto |
| Badge "Recommande" ne change pas l'ordre | Ordre stable |

---

## 10. SEQUENCE D'IMPLEMENTATION

1. **Creer `useDecisionSupport.ts`**
   - Types
   - Appels suggest-decisions / commit-decision
   - Gestion etat local

2. **Creer `DecisionProgressIndicator.tsx`**
   - Composant simple lecture
   - Affichage 0/5 -> 5/5

3. **Creer `DecisionSupportPanel.tsx`**
   - Structure complete
   - Integration RadioGroup
   - Integration AlertDialog
   - Gestion override

4. **Modifier `QuotationSheet.tsx`**
   - Import DecisionSupportPanel
   - Condition d'affichage
   - Placement apres ClarificationPanel

---

## 11. CONFORMITE CTO

| Regle | Application |
|-------|-------------|
| Aucune ecriture DB frontend | Appels Edge Functions uniquement |
| Aucune auto-selection | useState(null) par defaut |
| Aucun bouton auto | Pas de navigation |
| Options toutes visibles | Pas de filtre |
| Badge discret | Pas de reordonnancement |
| Confirmation obligatoire | AlertDialog avant commit |
| Justification override | Validation frontend + backend |

---

**Ce plan est pret pour validation CTO et implementation.**
