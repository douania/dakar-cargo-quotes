

# PHASE 5D - Versioning / Historique des devis (AMENDÉ)

## Amendements CTO intégrés

| # | Amendement | Statut |
|---|------------|--------|
| 1 | `root_quotation_id` pour arbre de versions | INTÉGRÉ |
| 2 | `saveDraft` idempotent par `source_email_id` | INTÉGRÉ |
| 3 | RLS minimale `auth.uid() IS NOT NULL` | INTÉGRÉ |

---

## 1. Migration SQL

```sql
-- Phase 5D : Versioning des devis

-- 1. Ajouter colonnes versioning
ALTER TABLE quotation_history
ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS parent_quotation_id UUID REFERENCES quotation_history(id),
ADD COLUMN IF NOT EXISTS root_quotation_id UUID,
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft'
  CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired'));

-- 2. Migrer données existantes : was_accepted → status
UPDATE quotation_history
SET status = CASE
  WHEN was_accepted = true THEN 'accepted'
  WHEN was_accepted = false THEN 'rejected'
  ELSE 'draft'
END
WHERE status IS NULL;

-- 3. Index pour recherche par parent, root et status
CREATE INDEX IF NOT EXISTS idx_quotation_history_parent
ON quotation_history(parent_quotation_id);

CREATE INDEX IF NOT EXISTS idx_quotation_history_root
ON quotation_history(root_quotation_id);

CREATE INDEX IF NOT EXISTS idx_quotation_history_status
ON quotation_history(status);

CREATE INDEX IF NOT EXISTS idx_quotation_history_source_email_status
ON quotation_history(source_email_id, status);

-- 4. RLS minimale (Amendement 3)
DROP POLICY IF EXISTS "quotation_history_select" ON quotation_history;
DROP POLICY IF EXISTS "quotation_history_insert" ON quotation_history;
DROP POLICY IF EXISTS "quotation_history_update" ON quotation_history;
DROP POLICY IF EXISTS "quotation_history_delete" ON quotation_history;

CREATE POLICY "quotation_history_select" ON quotation_history
FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE POLICY "quotation_history_insert" ON quotation_history
FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "quotation_history_update" ON quotation_history
FOR UPDATE TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE POLICY "quotation_history_delete" ON quotation_history
FOR DELETE TO authenticated
USING (auth.uid() IS NOT NULL);
```

---

## 2. Type domain étendu

**Fichier : `src/features/quotation/domain/types.ts`**

Ajouter à la fin du fichier :

```typescript
// Phase 5D : Statut workflow devis
export type QuotationStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';
```

---

## 3. Hook useQuotationDraft

**Nouveau fichier : `src/features/quotation/hooks/useQuotationDraft.ts`**

```typescript
/**
 * Hook pour gérer le cycle de vie draft/sent d'un devis
 * Phase 5D — Amendements CTO intégrés
 */
import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { QuotationStatus } from '@/features/quotation/domain/types';

export interface DraftQuotation {
  id: string;
  version: number;
  status: QuotationStatus;
  parent_quotation_id: string | null;
  root_quotation_id: string | null;
}

interface SaveDraftParams {
  route_origin?: string | null;
  route_port: string;
  route_destination: string;
  cargo_type: string;
  container_types?: string[];
  client_name?: string | null;
  client_company?: string | null;
  partner_company?: string | null;
  project_name?: string | null;
  incoterm?: string | null;
  tariff_lines: Array<{
    service: string;
    description?: string;
    amount: number;
    currency: string;
    unit?: string;
  }>;
  total_amount: number;
  total_currency: string;
  source_email_id?: string | null;
  regulatory_info?: Record<string, unknown> | null;
}

export function useQuotationDraft() {
  const [currentDraft, setCurrentDraft] = useState<DraftQuotation | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  /**
   * Sauvegarder ou mettre à jour un draft
   * AMENDEMENT 2 : Idempotent par source_email_id
   */
  const saveDraft = useCallback(async (params: SaveDraftParams): Promise<DraftQuotation | null> => {
    setIsSaving(true);
    try {
      // AMENDEMENT 2 : Vérifier s'il existe déjà un draft pour cet email
      if (params.source_email_id && !currentDraft) {
        const { data: existingDraft, error: searchError } = await supabase
          .from('quotation_history')
          .select('id, version, status, parent_quotation_id, root_quotation_id')
          .eq('source_email_id', params.source_email_id)
          .eq('status', 'draft')
          .maybeSingle();

        if (searchError) throw searchError;

        if (existingDraft) {
          // Réutiliser le draft existant
          setCurrentDraft(existingDraft as DraftQuotation);
          // Mettre à jour le draft existant
          const { data, error } = await supabase
            .from('quotation_history')
            .update({
              ...params,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingDraft.id)
            .select('id, version, status, parent_quotation_id, root_quotation_id')
            .single();

          if (error) throw error;
          setCurrentDraft(data as DraftQuotation);
          return data as DraftQuotation;
        }
      }

      if (currentDraft) {
        // Mise à jour du draft actuel
        const { data, error } = await supabase
          .from('quotation_history')
          .update({
            ...params,
            status: 'draft',
            updated_at: new Date().toISOString(),
          })
          .eq('id', currentDraft.id)
          .select('id, version, status, parent_quotation_id, root_quotation_id')
          .single();

        if (error) throw error;
        setCurrentDraft(data as DraftQuotation);
        return data as DraftQuotation;
      } else {
        // Nouveau draft (v1)
        const { data, error } = await supabase
          .from('quotation_history')
          .insert({
            ...params,
            version: 1,
            status: 'draft',
            root_quotation_id: null, // v1 : root = null, sera self-reference après insert
            parent_quotation_id: null,
          })
          .select('id, version, status, parent_quotation_id, root_quotation_id')
          .single();

        if (error) throw error;

        // Pour v1, root_quotation_id = id (self-reference)
        const { error: updateError } = await supabase
          .from('quotation_history')
          .update({ root_quotation_id: data.id })
          .eq('id', data.id);

        if (updateError) throw updateError;

        const draft = { ...data, root_quotation_id: data.id } as DraftQuotation;
        setCurrentDraft(draft);
        return draft;
      }
    } catch (error) {
      console.error('Error saving draft:', error);
      toast.error('Erreur sauvegarde brouillon');
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [currentDraft]);

  /**
   * Marquer comme envoyé (transition draft → sent)
   */
  const markAsSent = useCallback(async (): Promise<boolean> => {
    if (!currentDraft) {
      toast.error('Aucun brouillon à envoyer');
      return false;
    }

    if (currentDraft.status !== 'draft') {
      toast.error('Ce devis a déjà été envoyé');
      return false;
    }

    try {
      const { error } = await supabase
        .from('quotation_history')
        .update({ status: 'sent', updated_at: new Date().toISOString() })
        .eq('id', currentDraft.id);

      if (error) throw error;

      setCurrentDraft({ ...currentDraft, status: 'sent' });
      toast.success('Devis marqué comme envoyé');
      return true;
    } catch (error) {
      console.error('Error marking as sent:', error);
      toast.error('Erreur mise à jour statut');
      return false;
    }
  }, [currentDraft]);

  /**
   * Créer une nouvelle version (révision)
   * AMENDEMENT 1 : root_quotation_id conservé
   */
  const createRevision = useCallback(async (params: SaveDraftParams): Promise<DraftQuotation | null> => {
    if (!currentDraft) {
      return saveDraft(params);
    }

    setIsSaving(true);
    try {
      // AMENDEMENT 1 : root = root du parent OU id du parent si v1
      const rootId = currentDraft.root_quotation_id ?? currentDraft.id;

      const { data, error } = await supabase
        .from('quotation_history')
        .insert({
          ...params,
          version: currentDraft.version + 1,
          parent_quotation_id: currentDraft.id,
          root_quotation_id: rootId,
          status: 'draft',
        })
        .select('id, version, status, parent_quotation_id, root_quotation_id')
        .single();

      if (error) throw error;
      setCurrentDraft(data as DraftQuotation);
      toast.success(`Révision v${data.version} créée`);
      return data as DraftQuotation;
    } catch (error) {
      console.error('Error creating revision:', error);
      toast.error('Erreur création révision');
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [currentDraft, saveDraft]);

  /**
   * Réinitialiser le draft courant
   */
  const resetDraft = useCallback(() => {
    setCurrentDraft(null);
  }, []);

  return {
    currentDraft,
    isSaving,
    saveDraft,
    markAsSent,
    createRevision,
    resetDraft,
    setCurrentDraft,
  };
}
```

---

## 4. Intégration QuotationSheet.tsx

### 4.1 Import (après ligne 77)

```typescript
// Hook versioning (Phase 5D)
import { useQuotationDraft } from '@/features/quotation/hooks/useQuotationDraft';
```

### 4.2 Instanciation hook (après ligne 173)

```typescript
// Quotation Draft lifecycle (Phase 5D)
const {
  currentDraft,
  isSaving,
  saveDraft,
  markAsSent,
} = useQuotationDraft();
```

### 4.3 Modification handleGenerateResponse (lignes 607-641)

Remplacer par :

```typescript
const handleGenerateResponse = async () => {
  setIsGenerating(true);
  try {
    // Phase 5D : Sauvegarder le draft AVANT génération
    await saveDraft({
      route_origin: cargoLines[0]?.origin || null,
      route_port: 'Dakar',
      route_destination: finalDestination || destination,
      cargo_type: cargoLines[0]?.cargo_type || 'container',
      container_types: cargoLines.filter(c => c.container_type).map(c => c.container_type!),
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
          amount: (s.rate || 0) * s.quantity,
          currency: s.currency || 'FCFA',
          unit: s.unit || '',
        })),
      total_amount: engineResult.snapshot.totals.total_ht,
      total_currency: 'FCFA',
      source_email_id: isNewQuotation ? null : emailId,
      regulatory_info: regulatoryInfo ? { ...regulatoryInfo } : null,
    });

    // Générer la réponse (existant)
    const { data, error } = await supabase.functions.invoke('generate-response', {
      body: {
        emailId: isNewQuotation ? null : emailId,
        threadEmails: threadEmails.map(e => ({
          from: e.from_address,
          subject: e.subject,
          body: decodeBase64Content(e.body_text),
          date: e.sent_at || e.received_at,
        })),
        quotationData: {
          projectContext,
          cargoLines,
          serviceLines,
          destination,
          finalDestination,
          incoterm,
          specialRequirements,
        },
      }
    });

    if (error) throw error;

    setGeneratedResponse(data.response || data.draft?.body_text || '');
    toast.success('Brouillon sauvegardé & réponse générée');
  } catch (error) {
    console.error('Error generating response:', error);
    toast.error('Erreur de génération');
  } finally {
    setIsGenerating(false);
  }
};
```

### 4.4 Ajout badge statut dans QuotationHeader

Modifier l'appel à `QuotationHeader` (ligne 687-695) pour passer le draft :

```typescript
<QuotationHeader
  isNewQuotation={isNewQuotation}
  quotationCompleted={quotationCompleted}
  selectedEmailSubject={selectedEmail?.subject ?? null}
  threadCount={threadEmails.length}
  isGenerating={isGenerating}
  onBack={() => navigate('/')}
  onGenerateResponse={handleGenerateResponse}
  currentDraft={currentDraft}  // Phase 5D
/>
```

Modification de `QuotationHeader.tsx` pour afficher le badge :

```typescript
// Ajouter dans les props
currentDraft?: { status: string; version: number } | null;

// Ajouter dans le rendu (après le badge quotationCompleted)
{currentDraft && !quotationCompleted && (
  <Badge variant={currentDraft.status === 'sent' ? 'default' : 'outline'}>
    {currentDraft.status === 'draft' && 'Brouillon'}
    {currentDraft.status === 'sent' && 'Envoyé'}
    {currentDraft.version > 1 && ` v${currentDraft.version}`}
  </Badge>
)}
```

### 4.5 Bouton "Confirmer envoi" (après generatedResponse)

Ajouter après le bloc `generatedResponse` (vers ligne 945) :

```typescript
{/* Phase 5D : Bouton confirmation envoi */}
{generatedResponse && currentDraft?.status === 'draft' && (
  <div className="flex items-center justify-end gap-2 mt-4">
    <span className="text-sm text-muted-foreground">
      Brouillon sauvegardé
    </span>
    <Button
      onClick={markAsSent}
      disabled={isSaving}
      className="gap-2"
    >
      <Send className="h-4 w-4" />
      Confirmer envoi
    </Button>
  </div>
)}
```

---

## 5. Modification QuotationHistory.tsx

### 5.1 Ajout filtre et colonne status

Dans le TableHeader (ligne 214), ajouter :

```typescript
<TableHead>Statut</TableHead>
```

Dans le TableRow (après ligne 270), ajouter :

```typescript
<TableCell>
  <div className="flex items-center gap-1">
    <Badge variant={getStatusVariant(q.status)}>
      {getStatusLabel(q.status)}
    </Badge>
    {q.version > 1 && (
      <span className="text-xs text-muted-foreground">v{q.version}</span>
    )}
  </div>
</TableCell>
```

### 5.2 Helpers status (ajouter en haut du fichier)

```typescript
function getStatusLabel(status: string | null): string {
  switch (status) {
    case 'draft': return 'Brouillon';
    case 'sent': return 'Envoyé';
    case 'accepted': return 'Accepté';
    case 'rejected': return 'Refusé';
    case 'expired': return 'Expiré';
    default: return 'Inconnu';
  }
}

function getStatusVariant(status: string | null): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'sent': return 'default';
    case 'accepted': return 'default';
    case 'rejected': return 'destructive';
    case 'draft': return 'outline';
    default: return 'secondary';
  }
}
```

### 5.3 Filtre par statut (après le filtre période ligne 184)

```typescript
<Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
  <SelectTrigger className="w-[150px]">
    <SelectValue placeholder="Statut" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="all">Tous statuts</SelectItem>
    <SelectItem value="draft">Brouillons</SelectItem>
    <SelectItem value="sent">Envoyés</SelectItem>
    <SelectItem value="accepted">Acceptés</SelectItem>
    <SelectItem value="rejected">Refusés</SelectItem>
  </SelectContent>
</Select>
```

Ajouter le state :

```typescript
const [statusFilter, setStatusFilter] = useState<string>('all');
```

Et dans le filtre `filteredQuotations` :

```typescript
// Status filter
if (statusFilter !== 'all') {
  result = result.filter(q => q.status === statusFilter);
}
```

### 5.4 Mise à jour interface QuotationRecord

```typescript
interface QuotationRecord {
  // ... existant ...
  version?: number;
  status?: string;
  parent_quotation_id?: string;
  root_quotation_id?: string;
}
```

---

## Fichiers modifiés/créés

| Fichier | Action | Lignes |
|---------|--------|--------|
| Migration SQL | CRÉER | ~35 |
| domain/types.ts | +1 type export | ~2 |
| useQuotationDraft.ts | CRÉER | ~160 |
| QuotationSheet.tsx | +import, +hook, +handleGenerateResponse modifié, +bouton | ~60 |
| QuotationHeader.tsx | +prop currentDraft, +badge | ~15 |
| QuotationHistory.tsx | +colonne, +filtre, +helpers, +interface | ~50 |

## Fichiers NON modifiés

| Fichier | Statut |
|---------|--------|
| CargoLinesForm.tsx | FROZEN |
| ServiceLinesForm.tsx | FROZEN |
| QuotationTotalsCard.tsx | Aucun changement |
| domain/engine.ts | Aucun changement |

---

## Schéma versioning (Amendement 1)

```text
Quotation v1 (id: abc-123)
├── root_quotation_id: abc-123 (self)
├── parent_quotation_id: NULL
├── version: 1
└── status: 'sent'

Quotation v2 (id: def-456)
├── root_quotation_id: abc-123 ← MÊME ROOT
├── parent_quotation_id: abc-123
├── version: 2
└── status: 'draft'

Quotation v3 (id: ghi-789)
├── root_quotation_id: abc-123 ← MÊME ROOT
├── parent_quotation_id: def-456
├── version: 3
└── status: 'draft'
```

Requête pour toutes les versions d'un devis :

```sql
SELECT * FROM quotation_history
WHERE root_quotation_id = 'abc-123'
ORDER BY version;
```

---

## Flux utilisateur final

```text
┌─────────────────────────────────────────────────────────────┐
│                    QuotationSheet                           │
│                                                             │
│  [Générer réponse] ──┬──▶ saveDraft()                      │
│                      │    └─▶ AMENDEMENT 2 : check email   │
│                      │        └─▶ réutilise ou crée v1     │
│                      │                                      │
│                      └──▶ status = 'draft' (PAS 'sent')    │
│                                  │                          │
│                                  ▼                          │
│              ┌─────────────────────────────────┐           │
│              │ Badge: "Brouillon v1"           │           │
│              │ Réponse générée visible         │           │
│              │                                 │           │
│              │ [Confirmer envoi] ──────────────────────────│
│              └─────────────────────────────────┘           │
│                                  │                          │
│                                  ▼                          │
│                         markAsSent()                        │
│                              │                              │
│                              ▼                              │
│                    status = 'sent'                          │
│                    Badge: "Envoyé v1"                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Critères de sortie Phase 5D

- [ ] Migration SQL exécutée (version, parent, root, status, RLS)
- [ ] Type QuotationStatus exporté
- [ ] Hook useQuotationDraft créé et fonctionnel
- [ ] saveDraft idempotent par source_email_id (Amendement 2)
- [ ] root_quotation_id correct dans createRevision (Amendement 1)
- [ ] RLS minimale auth.uid() (Amendement 3)
- [ ] Draft sauvegardé au clic "Générer réponse" (status = draft)
- [ ] Bouton "Confirmer envoi" visible après génération
- [ ] Statut "sent" uniquement sur confirmation explicite
- [ ] QuotationHistory affiche status et version avec filtre
- [ ] Build TypeScript OK
- [ ] Aucun composant FROZEN modifié

