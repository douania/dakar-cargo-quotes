

# PLAN D'IMPLEMENTATION PHASE 10.1

## UI GATE "Lancer le pricing" (STRICT, EXPLICITE, SANS CALCUL)

---

## 1. VERIFICATION DU CODEBASE

### 1.1 Ressources confirmees existantes

| Ressource | Chemin | Statut |
|-----------|--------|--------|
| Edge Function `run-pricing` | `supabase/functions/run-pricing/index.ts` | OK - PHASE 11 EXISTANTE |
| Edge Function `ack-pricing-ready` | `supabase/functions/ack-pricing-ready/index.ts` | OK - GATE PHASE 10 |
| Hook `useQuoteCaseData` | `src/hooks/useQuoteCaseData.ts` | OK - Lecture quote_case |
| Page `QuotationSheet` | `src/pages/QuotationSheet.tsx` | OK - Integration cible |
| Composant `DecisionSupportPanel` | `src/components/puzzle/DecisionSupportPanel.tsx` | OK - Pattern reference |

### 1.2 Statut gate confirme

```typescript
// Dans src/integrations/supabase/types.ts (lignes 3199-3201, 3349-3351)
quote_case_status: [
  "DECISIONS_PENDING",
  "DECISIONS_COMPLETE", 
  "ACK_READY_FOR_PRICING"  // <-- GATE OUVERT = VISIBLE
]
```

### 1.3 Integration actuelle DecisionSupportPanel (pattern a suivre)

```typescript
// QuotationSheet.tsx lignes 1001-1007
{!quotationCompleted && quoteCase?.id && 
 ['DECISIONS_PENDING', 'DECISIONS_COMPLETE'].includes(quoteCase.status) && (
  <div className="mb-6">
    <DecisionSupportPanel caseId={quoteCase.id} />
  </div>
)}
```

### 1.4 Edge Function run-pricing confirmee

- Statut requis actuel: `READY_TO_PRICE` (ligne 104)
- Ownership check: `created_by` ou `assigned_to` (ligne 97)
- Guard gaps bloquants: Oui (lignes 116-132)

**Note importante**: `run-pricing` attend `READY_TO_PRICE`, pas `ACK_READY_FOR_PRICING`. 
Ceci sera corrige dans Phase 11, mais pour Phase 10.1 l'UI appellera `run-pricing` et gerera l'erreur de statut gracieusement.

---

## 2. ARCHITECTURE PHASE 10.1

```text
+------------------------------------------------------------------+
|                      QuotationSheet.tsx                          |
|                                                                  |
|  +------------------------------------------------------------+  |
|  |  DecisionSupportPanel (Phase 9.4)                          |  |
|  |  Visible si: DECISIONS_PENDING, DECISIONS_COMPLETE         |  |
|  +------------------------------------------------------------+  |
|                                                                  |
|  +------------------------------------------------------------+  |
|  |  PricingLaunchPanel (Phase 10.1) <-- NOUVEAU               |  |
|  |  Visible si: ACK_READY_FOR_PRICING uniquement              |  |
|  |                                                             |  |
|  |  +-------------------------------------------------------+  |  |
|  |  |  Card (amber/warning accent)                          |  |  |
|  |  |                                                        |  |  |
|  |  |  Title: "Lancer le pricing"                           |  |  |
|  |  |  Description: Decisions validees, pret pour calcul    |  |  |
|  |  |                                                        |  |  |
|  |  |  [Alert info: tracabilite]                            |  |  |
|  |  |                                                        |  |  |
|  |  |  [Button: Lancer le pricing]                          |  |  |
|  |  |      |                                                 |  |  |
|  |  |      v                                                 |  |  |
|  |  |  AlertDialog de confirmation                          |  |  |
|  |  |      |                                                 |  |  |
|  |  |      v                                                 |  |  |
|  |  |  Appel run-pricing Edge Function                      |  |  |
|  |  +-------------------------------------------------------+  |  |
|  +------------------------------------------------------------+  |
|                                                                  |
|  [Reste du formulaire...]                                        |
+------------------------------------------------------------------+
```

---

## 3. LIVRABLES

### 3.1 Fichier a creer

| Fichier | Responsabilite |
|---------|----------------|
| `src/components/puzzle/PricingLaunchPanel.tsx` | Bouton explicite pour lancer le pricing |

### 3.2 Fichier a modifier

| Fichier | Modification |
|---------|--------------|
| `src/pages/QuotationSheet.tsx` | Importer et afficher PricingLaunchPanel |

---

## 4. SPECIFICATION TECHNIQUE

### 4.1 Interface Props

```typescript
interface PricingLaunchPanelProps {
  caseId: string;
}
```

### 4.2 Structure du composant

```typescript
// src/components/puzzle/PricingLaunchPanel.tsx

// ============================================================================
// Phase 10.1 — UI GATE "Lancer le pricing"
// 
// ⚠️ CTO RULES ABSOLUES:
// ❌ AUCUN calcul de prix ici
// ❌ AUCUNE logique metier
// ❌ AUCUNE lecture des tables pricing
// ❌ AUCUNE transition de statut (geree par run-pricing)
// ❌ AUCUN auto-trigger
// 
// ✅ UI uniquement
// ✅ Declenchement explicite Phase 11 (run-pricing)
// ✅ Confirmation utilisateur obligatoire
// ============================================================================

import { useState } from 'react';
import { Loader2, Calculator, Info, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
```

### 4.3 Etats internes

```typescript
const [isLoading, setIsLoading] = useState(false);
const [confirmOpen, setConfirmOpen] = useState(false);
const [error, setError] = useState<string | null>(null);
```

### 4.4 Handler de lancement

```typescript
const handleLaunchPricing = async () => {
  setIsLoading(true);
  setError(null);
  
  try {
    // ❌ AUCUN calcul de prix ici
    // ❌ AUCUNE logique metier
    // ❌ AUCUNE lecture des tables pricing
    // ❌ AUCUNE transition de statut
    // ✅ Appel unique run-pricing
    
    const { data, error: fnError } = await supabase.functions.invoke('run-pricing', {
      body: { case_id: caseId }
    });
    
    if (fnError) throw fnError;
    
    toast.success(`Pricing lance - ${data.lines_count} lignes calculees`);
    setConfirmOpen(false);
    
    // Pas de redirection automatique - l'UI se mettra a jour via le hook
    
  } catch (err: any) {
    console.error('[PricingLaunchPanel] Error:', err);
    
    // Gestion des erreurs specifiques
    const message = err.message || 'Erreur inconnue';
    if (message.includes('not ready') || message.includes('status')) {
      setError('Le dossier n\'est pas pret pour le pricing');
    } else if (message.includes('Access denied')) {
      setError('Vous n\'avez pas acces a ce dossier');
    } else {
      setError(message);
    }
    
    toast.error('Erreur lors du lancement du pricing');
  } finally {
    setIsLoading(false);
  }
};
```

---

## 5. STRUCTURE UI COMPLETE

### 5.1 Card principale

```typescript
<Card className="border-amber-200 bg-amber-50/30">
  <CardHeader className="pb-3">
    <div className="flex items-center gap-2">
      <Calculator className="h-5 w-5 text-amber-600" />
      <CardTitle className="text-base">Lancer le pricing</CardTitle>
    </div>
    <CardDescription>
      Toutes les decisions sont validees. 
      Vous pouvez maintenant lancer le calcul de prix.
    </CardDescription>
  </CardHeader>
  
  <CardContent className="space-y-4">
    {/* Alert info tracabilite */}
    <Alert className="border-blue-200 bg-blue-50">
      <Info className="h-4 w-4 text-blue-600" />
      <AlertDescription className="text-sm text-blue-800">
        Cette action est tracee et auditee. 
        Le calcul peut prendre plusieurs secondes.
      </AlertDescription>
    </Alert>
    
    {/* Erreur si presente */}
    {error && (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )}
    
    {/* Bouton principal */}
    <Button
      onClick={() => setConfirmOpen(true)}
      disabled={isLoading}
      className="w-full gap-2 bg-amber-600 hover:bg-amber-700"
    >
      {isLoading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Calcul en cours...
        </>
      ) : (
        <>
          <Calculator className="h-4 w-4" />
          Lancer le pricing
        </>
      )}
    </Button>
  </CardContent>
</Card>
```

### 5.2 AlertDialog de confirmation

```typescript
<AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Confirmer le lancement du pricing ?</AlertDialogTitle>
      <AlertDialogDescription asChild>
        <div className="space-y-3">
          <p>Cette action va declencher le moteur de pricing.</p>
          
          <ul className="list-disc list-inside text-sm space-y-1">
            <li>Le calcul est base sur les decisions validees</li>
            <li>L'operation est tracee et auditee</li>
            <li>Le calcul peut prendre plusieurs secondes</li>
          </ul>
          
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg mt-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
            <p className="text-sm text-amber-800">
              Une fois lance, le pricing ne peut pas etre annule.
            </p>
          </div>
        </div>
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel disabled={isLoading}>Annuler</AlertDialogCancel>
      <AlertDialogAction 
        onClick={handleLaunchPricing}
        disabled={isLoading}
        className="bg-amber-600 hover:bg-amber-700"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Calcul...
          </>
        ) : (
          'Confirmer'
        )}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

---

## 6. INTEGRATION QUOTATIONSHEET

### 6.1 Import

```typescript
// Ligne ~67 apres DecisionSupportPanel
// Phase 10.1: Pricing launch panel
import { PricingLaunchPanel } from '@/components/puzzle/PricingLaunchPanel';
```

### 6.2 Condition d'affichage (STRICTE)

```typescript
// Apres DecisionSupportPanel (ligne ~1007)
{/* Phase 10.1: PricingLaunchPanel - visible UNIQUEMENT si ACK_READY_FOR_PRICING */}
{!quotationCompleted && quoteCase?.id && 
 quoteCase.status === 'ACK_READY_FOR_PRICING' && (
  <div className="mb-6">
    <PricingLaunchPanel caseId={quoteCase.id} />
  </div>
)}
```

---

## 7. REGLES CTO STRICTES

### 7.1 Interdits absolus (commentaires dans le code)

```typescript
// ============================================================================
// Phase 10.1 — UI GATE "Lancer le pricing"
// 
// ⚠️ CTO RULES ABSOLUES:
// ❌ AUCUN calcul de prix ici
// ❌ AUCUNE logique metier
// ❌ AUCUNE lecture des tables pricing
// ❌ AUCUNE transition de statut (geree par run-pricing)
// ❌ AUCUN auto-trigger
// 
// ✅ UI uniquement
// ✅ Declenchement explicite Phase 11 (run-pricing)
// ✅ Confirmation utilisateur obligatoire
// ============================================================================
```

### 7.2 Condition d'affichage stricte

```typescript
// GATE unique autorise
quoteCase.status === 'ACK_READY_FOR_PRICING'

// JAMAIS:
// - status !== 'ACK_READY_FOR_PRICING' → Panel NON visible
// - Aucun affichage conditionnel autre
```

---

## 8. TESTS UI OBLIGATOIRES

| Test | Resultat attendu |
|------|------------------|
| status != ACK_READY_FOR_PRICING | Panel NON visible |
| status = ACK_READY_FOR_PRICING | Panel visible |
| Clic bouton | AlertDialog s'ouvre |
| Confirmer | 1 appel run-pricing |
| Double clic | Bouton disabled (isLoading) |
| Refresh page | Bouton toujours visible (si statut inchange) |
| Aucune navigation auto | OK |
| Erreur API | Message affiche, pas de crash |

---

## 9. GESTION DES ERREURS

| Scenario | Comportement |
|----------|--------------|
| run-pricing retourne 400 (statut invalide) | Afficher "Le dossier n'est pas pret" |
| run-pricing retourne 403 (acces refuse) | Afficher "Acces refuse" |
| run-pricing retourne 500 (erreur serveur) | Afficher message d'erreur |
| Succes | Toast + UI mise a jour via hook |

---

## 10. SEQUENCE D'IMPLEMENTATION

1. **Creer `src/components/puzzle/PricingLaunchPanel.tsx`**
   - Header avec regles CTO
   - Props interface
   - Etats internes
   - Handler handleLaunchPricing
   - Card UI
   - AlertDialog confirmation

2. **Modifier `src/pages/QuotationSheet.tsx`**
   - Import PricingLaunchPanel
   - Condition d'affichage stricte
   - Placement apres DecisionSupportPanel

---

## 11. CONFORMITE CTO

| Regle | Application |
|-------|-------------|
| Gate deja ouvert requis | ✅ ACK_READY_FOR_PRICING uniquement |
| Action humaine explicite | ✅ Clic bouton obligatoire |
| Confirmation obligatoire | ✅ AlertDialog |
| Aucun calcul | ✅ Appel run-pricing uniquement |
| Aucun auto-flow | ✅ Pas de navigation auto |
| UI uniquement | ✅ Pas de logique metier |
| Phase 11 appelee explicitement | ✅ supabase.functions.invoke('run-pricing') |

---

## 12. CE QUI N'EST PAS DANS CETTE PHASE

| Element | Phase |
|---------|-------|
| Correction statut run-pricing (READY_TO_PRICE → ACK_READY_FOR_PRICING) | Phase 11 |
| Affichage des resultats pricing | Phase 11+ |
| Generation PDF apres pricing | Phase 12 |

---

**Ce plan est pret pour validation CTO et implementation.**

