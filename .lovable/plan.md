

# PHASE 3B.1 — EXTRACTION QuotationHeader (P1)

## Périmètre identifié

| Attribut | Valeur |
|----------|--------|
| Lignes source | 732-774 (43 lignes) |
| Fichier cible | `src/features/quotation/components/QuotationHeader.tsx` |
| Type | Composant UI P1 (callbacks simples) |
| Risque | **Moyen** (navigation + action générer) |

---

## JSX à extraire (lignes 732-774)

```tsx
{/* Header */}
<div className="flex items-center gap-4 mb-6">
  <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
    <ArrowLeft className="h-5 w-5" />
  </Button>
  <div className="flex-1">
    <div className="flex items-center gap-2">
      <h1 className="text-xl font-bold">
        {isNewQuotation ? 'Nouvelle cotation' : 'Fiche de cotation'}
      </h1>
      {quotationCompleted && (
        <Badge className="bg-green-500/20 text-green-600 border-green-500/30">
          <CheckCircle className="h-3 w-3 mr-1" />
          Cotation réalisée
        </Badge>
      )}
    </div>
    {selectedEmail && (
      <p className="text-sm text-muted-foreground truncate">
        {selectedEmail.subject}
      </p>
    )}
    {threadEmails.length > 1 && (
      <Badge variant="outline" className="mt-1">
        <MessageSquare className="h-3 w-3 mr-1" />
        {threadEmails.length} emails dans le fil
      </Badge>
    )}
  </div>
  {!quotationCompleted && (
    <Button 
      onClick={handleGenerateResponse}
      disabled={isGenerating}
    >
      {isGenerating ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Send className="h-4 w-4 mr-2" />
      )}
      Générer la réponse
    </Button>
  )}
</div>
```

---

## Props nécessaires

```typescript
interface QuotationHeaderProps {
  isNewQuotation: boolean;
  quotationCompleted: boolean;
  selectedEmailSubject: string | null;
  threadCount: number;
  isGenerating: boolean;
  onBack: () => void;
  onGenerateResponse: () => void;
}
```

| Prop | Type | Source dans QuotationSheet |
|------|------|---------------------------|
| `isNewQuotation` | `boolean` | Variable locale |
| `quotationCompleted` | `boolean` | State |
| `selectedEmailSubject` | `string \| null` | `selectedEmail?.subject` |
| `threadCount` | `number` | `threadEmails.length` |
| `isGenerating` | `boolean` | State |
| `onBack` | `() => void` | `() => navigate('/')` |
| `onGenerateResponse` | `() => void` | `handleGenerateResponse` |

---

## Imports requis pour le composant

```typescript
import { ArrowLeft, CheckCircle, MessageSquare, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
```

---

## Structure du composant

```typescript
// src/features/quotation/components/QuotationHeader.tsx

import { ArrowLeft, CheckCircle, MessageSquare, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface QuotationHeaderProps {
  isNewQuotation: boolean;
  quotationCompleted: boolean;
  selectedEmailSubject: string | null;
  threadCount: number;
  isGenerating: boolean;
  onBack: () => void;
  onGenerateResponse: () => void;
}

export function QuotationHeader({
  isNewQuotation,
  quotationCompleted,
  selectedEmailSubject,
  threadCount,
  isGenerating,
  onBack,
  onGenerateResponse,
}: QuotationHeaderProps) {
  return (
    <div className="flex items-center gap-4 mb-6">
      {/* JSX identique lignes 733-773 */}
    </div>
  );
}
```

---

## Modifications dans QuotationSheet.tsx

### 1. Ajouter l'import (après ligne 65)

```typescript
import { QuotationHeader } from '@/features/quotation/components/QuotationHeader';
```

### 2. Remplacer le bloc (lignes 732-774)

**Avant :**
```tsx
{/* Header */}
<div className="flex items-center gap-4 mb-6">
  ...43 lignes...
</div>
```

**Après :**
```tsx
<QuotationHeader
  isNewQuotation={isNewQuotation}
  quotationCompleted={quotationCompleted}
  selectedEmailSubject={selectedEmail?.subject ?? null}
  threadCount={threadEmails.length}
  isGenerating={isGenerating}
  onBack={() => navigate('/')}
  onGenerateResponse={handleGenerateResponse}
/>
```

---

## Ce qui reste dans QuotationSheet.tsx

| Élément | Statut |
|---------|--------|
| `handleGenerateResponse` | **Conservé** (passé en prop) |
| `navigate` | **Conservé** (utilisé dans onBack) |
| `isNewQuotation` | **Conservé** (variable locale) |
| `quotationCompleted` | **Conservé** (state) |
| `isGenerating` | **Conservé** (state) |

---

## Fichiers à créer/modifier

| Fichier | Action |
|---------|--------|
| `src/features/quotation/components/QuotationHeader.tsx` | **Créer** |
| `src/pages/QuotationSheet.tsx` | **Modifier** (import + remplacement JSX) |

---

## Réduction attendue

| Métrique | Valeur |
|----------|--------|
| Lignes supprimées | ~43 |
| Lignes ajoutées (appel) | ~8 |
| **Réduction nette** | **~35 lignes** |

---

## Validation obligatoire après exécution

- [ ] Build TypeScript OK (`tsc --noEmit`)
- [ ] Ouverture cotation existante OK
- [ ] Header affiché IDENTIQUE
- [ ] Bouton "Retour" fonctionne
- [ ] Bouton "Générer la réponse" fonctionne
- [ ] Badge "Cotation réalisée" affiché si applicable
- [ ] Badge "X emails dans le fil" affiché si applicable

---

## Signaux d'alerte (ROLLBACK)

- Erreur TypeScript
- Navigation cassée
- Bouton "Générer" ne déclenche pas l'action
- Badges non affichés

---

## Message de clôture attendu

```
Phase 3B.1 exécutée.
Composant créé : src/features/quotation/components/QuotationHeader.tsx
Lignes supprimées dans QuotationSheet.tsx : ~35
Build OK.
En attente de validation avant 3B.2.
```

