

## Correction Phase 6D.x — Déblocage sauvegarde brouillon

### Problème actuel
L'utilisateur est bloqué sur `/quotation/new` avec le message "Veuillez d'abord sauvegarder le brouillon" en boucle infinie.

**Cause racine** : `saveDraft()` est importé mais jamais appelé, et `setCurrentDraft` n'est pas déstructuré du hook.

---

### Modifications (3 fichiers, ~60 lignes)

#### 1. QuotationSheet.tsx — Déstructurer `setCurrentDraft` du hook

**Ligne 193-199** : Ajouter `setCurrentDraft` à la déstructuration

```typescript
const {
  currentDraft,
  isSaving,
  saveDraft,
  markAsSent,
  generateQuotation,
  setCurrentDraft,  // AJOUT CRITIQUE
} = useQuotationDraft();
```

---

#### 2. QuotationSheet.tsx — Ajouter `handleSaveDraft`

Insérer après `buildSnapshot` (vers ligne 712) :

```typescript
/**
 * Phase 6D.x: Sauvegarde explicite du brouillon
 * Crée currentDraft.id pour débloquer generateQuotation
 */
const handleSaveDraft = useCallback(async () => {
  if (!destination) {
    toast.error('Destination requise');
    return;
  }

  const params = {
    route_origin: cargoLines[0]?.origin || null,
    route_port: destination,
    route_destination: finalDestination || destination,
    cargo_type: cargoLines.some(c => c.cargo_type === 'container') && cargoLines.some(c => c.cargo_type === 'breakbulk')
      ? 'combined'
      : cargoLines[0]?.cargo_type || 'container',
    container_types: [...new Set(cargoLines.filter(c => c.container_type).map(c => c.container_type!))],
    client_name: projectContext.requesting_party || null,
    client_company: projectContext.requesting_company || null,
    partner_company: projectContext.partner_company || null,
    project_name: projectContext.project_name || null,
    incoterm: incoterm || null,
    tariff_lines: serviceLines
      .filter(s => s.rate && s.rate > 0)
      .map(s => ({
        service: s.service || '',
        description: s.description || '',
        amount: (s.rate || 0) * (s.quantity || 1),
        currency: s.currency || 'FCFA',
        unit: s.unit || '',
      })),
    total_amount: quotationTotals.total_ht,
    total_currency: 'FCFA',
    source_email_id: isNewQuotation ? null : emailId,
    regulatory_info: regulatoryInfo ? { ...regulatoryInfo } : null,
  };

  const draft = await saveDraft(params);
  if (draft?.id) {
    setCurrentDraft(draft);  // LIGNE CRITIQUE CTO
    toast.success('Brouillon sauvegardé');
  }
}, [destination, finalDestination, cargoLines, serviceLines, projectContext, incoterm, quotationTotals, regulatoryInfo, isNewQuotation, emailId, saveDraft, setCurrentDraft]);
```

---

#### 3. QuotationSheet.tsx — Passer les props au Header

**Ligne 818-827** : Ajouter les nouvelles props

```tsx
<QuotationHeader
  isNewQuotation={isNewQuotation}
  quotationCompleted={quotationCompleted}
  selectedEmailSubject={selectedEmail?.subject ?? null}
  threadCount={threadEmails.length}
  isGenerating={isGenerating}
  onBack={() => navigate('/')}
  onGenerateResponse={handleGenerateResponse}
  currentDraft={currentDraft}
  onSaveDraft={handleSaveDraft}  // NOUVEAU
  isSaving={isSaving}            // NOUVEAU
/>
```

---

#### 4. QuotationHeader.tsx — Ajouter le bouton Sauvegarder

**Import** : Ajouter `Save` aux imports Lucide

```typescript
import { ArrowLeft, CheckCircle, MessageSquare, Loader2, Send, Save } from 'lucide-react';
```

**Interface** : Étendre les props

```typescript
interface QuotationHeaderProps {
  isNewQuotation: boolean;
  quotationCompleted: boolean;
  selectedEmailSubject: string | null;
  threadCount: number;
  isGenerating: boolean;
  onBack: () => void;
  onGenerateResponse: () => void;
  currentDraft?: { status: string; version: number; id?: string } | null;
  onSaveDraft?: () => void;    // NOUVEAU
  isSaving?: boolean;          // NOUVEAU
}
```

**JSX** : Remplacer le bouton unique par un groupe de 2 boutons

```tsx
{!quotationCompleted && (
  <div className="flex gap-2">
    {onSaveDraft && (
      <Button 
        variant="outline"
        onClick={onSaveDraft}
        disabled={isSaving}
      >
        {isSaving ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Save className="h-4 w-4 mr-2" />
        )}
        {currentDraft?.id ? 'Sauvegarder' : 'Sauvegarder le brouillon'}
      </Button>
    )}
    <Button 
      onClick={onGenerateResponse}
      disabled={isGenerating || !currentDraft?.id}
    >
      {isGenerating ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Send className="h-4 w-4 mr-2" />
      )}
      Générer la réponse
    </Button>
  </div>
)}
```

---

### Résumé des changements critiques

| Fichier | Modification | Raison |
|---------|--------------|--------|
| QuotationSheet.tsx | Déstructurer `setCurrentDraft` | Accès au setter |
| QuotationSheet.tsx | Ajouter `handleSaveDraft` avec `setCurrentDraft(draft)` | **Correction CTO non négociable** |
| QuotationSheet.tsx | Passer `onSaveDraft` et `isSaving` au Header | Connexion UI |
| QuotationHeader.tsx | Ajouter bouton "Sauvegarder" + désactiver "Générer" si pas de draft | UX cohérente |

---

### Workflow corrigé

```text
1. Utilisateur remplit le formulaire
2. Clique "Sauvegarder le brouillon"
   → saveDraft() appelé
   → setCurrentDraft(draft) exécuté (CRITIQUE)
   → Badge "Brouillon" affiché
   → Bouton "Générer" devient actif
3. Clique "Générer la réponse"
   → Guard `currentDraft?.id` passe
   → Snapshot généré
   → Toast succès
```

---

### Impact

| Critère | Valeur |
|---------|--------|
| Fichiers modifiés | 2 |
| Lignes ajoutées | ~60 |
| Changement DB | Aucun |
| Changement Edge Function | Aucun |
| Risque régression | Minimal |

