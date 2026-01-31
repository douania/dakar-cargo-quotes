
# PHASE 5D — Ownership Individuel (CORRIGÉ)

## Corrections CTO intégrées

| # | Correction | Statut |
|---|------------|--------|
| 1 | `NOT NULL` + `DEFAULT auth.uid()` sur `created_by` | INTÉGRÉ |
| 2 | Vue SAFE avec `security_invoker = true` | INTÉGRÉ |

---

## 1. Migration SQL — Schema + RLS + Vue SAFE

```sql
-- Phase 5D : Ownership individuel sur quotation_history
-- Corrections CTO : NOT NULL, DEFAULT, security_invoker

-- 1. Ajouter colonne created_by
ALTER TABLE quotation_history
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);

-- 2. Backfill données existantes (premier utilisateur admin)
UPDATE quotation_history
SET created_by = (
  SELECT id FROM auth.users 
  ORDER BY created_at ASC 
  LIMIT 1
)
WHERE created_by IS NULL;

-- 3. CORRECTION CTO #1 : NOT NULL + DEFAULT
ALTER TABLE quotation_history
ALTER COLUMN created_by SET NOT NULL;

ALTER TABLE quotation_history
ALTER COLUMN created_by SET DEFAULT auth.uid();

-- 4. Index pour performance RLS
CREATE INDEX IF NOT EXISTS idx_quotation_history_created_by
ON quotation_history(created_by);

-- 5. RLS stricte ownership sur quotation_history
DROP POLICY IF EXISTS "quotation_history_select" ON quotation_history;
DROP POLICY IF EXISTS "quotation_history_insert" ON quotation_history;
DROP POLICY IF EXISTS "quotation_history_update" ON quotation_history;
DROP POLICY IF EXISTS "quotation_history_delete" ON quotation_history;
DROP POLICY IF EXISTS "quotation_history_service_access" ON quotation_history;

CREATE POLICY "quotation_history_owner_select"
ON quotation_history FOR SELECT TO authenticated
USING (auth.uid() = created_by);

CREATE POLICY "quotation_history_owner_insert"
ON quotation_history FOR INSERT TO authenticated
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "quotation_history_owner_update"
ON quotation_history FOR UPDATE TO authenticated
USING (auth.uid() = created_by);

CREATE POLICY "quotation_history_owner_delete"
ON quotation_history FOR DELETE TO authenticated
USING (auth.uid() = created_by);

-- 6. Alignement RLS quotation_documents (ownership strict)
DROP POLICY IF EXISTS "quotation_documents_select" ON quotation_documents;
DROP POLICY IF EXISTS "quotation_documents_insert" ON quotation_documents;

CREATE POLICY "quotation_documents_owner_select"
ON quotation_documents FOR SELECT TO authenticated
USING (auth.uid() = created_by);

CREATE POLICY "quotation_documents_owner_insert"
ON quotation_documents FOR INSERT TO authenticated
WITH CHECK (auth.uid() = created_by);

-- 7. CORRECTION CTO #2 : Vue SAFE avec security_invoker
CREATE OR REPLACE VIEW v_quotation_documents_safe
WITH (security_invoker = true)
AS
SELECT
  id,
  quotation_id,
  root_quotation_id,
  version,
  status,
  document_type,
  file_size,
  created_at
FROM quotation_documents;
```

---

## 2. Modification Hook — useQuotationDraft.ts

### Problème actuel
Le hook ne passe pas `created_by` lors des inserts. Même avec `DEFAULT auth.uid()` en base, c'est une bonne pratique de le passer explicitement pour :
- Lisibilité du code
- Testabilité
- Robustesse (double vérification)

### Modifications requises

#### 2.1 Section "Nouveau draft (v1)" (lignes 121-148)

**Avant :**
```typescript
const { data, error } = await supabase
  .from('quotation_history')
  .insert({
    ...dbPayload,
    version: 1,
    status: 'draft',
    root_quotation_id: null,
    parent_quotation_id: null,
  } as any)
```

**Après :**
```typescript
// Récupérer l'utilisateur authentifié
const { data: userData } = await supabase.auth.getUser();
const userId = userData.user?.id;

if (!userId) {
  toast.error('Veuillez vous connecter pour créer un devis');
  return null;
}

const { data, error } = await supabase
  .from('quotation_history')
  .insert({
    ...dbPayload,
    version: 1,
    status: 'draft',
    root_quotation_id: null,
    parent_quotation_id: null,
    created_by: userId,  // ← AJOUT CRITIQUE
  } as any)
```

#### 2.2 Section "createRevision" (lignes 222-232)

**Avant :**
```typescript
const { data, error } = await supabase
  .from('quotation_history')
  .insert({
    ...dbPayload,
    version: currentDraft.version + 1,
    parent_quotation_id: currentDraft.id,
    root_quotation_id: rootId,
    status: 'draft',
  } as any)
```

**Après :**
```typescript
// Récupérer l'utilisateur authentifié
const { data: userData } = await supabase.auth.getUser();
const userId = userData.user?.id;

if (!userId) {
  toast.error('Veuillez vous connecter pour créer une révision');
  return null;
}

const { data, error } = await supabase
  .from('quotation_history')
  .insert({
    ...dbPayload,
    version: currentDraft.version + 1,
    parent_quotation_id: currentDraft.id,
    root_quotation_id: rootId,
    status: 'draft',
    created_by: userId,  // ← AJOUT CRITIQUE
  } as any)
```

---

## 3. Fichiers créés/modifiés

| Fichier | Action | Lignes |
|---------|--------|--------|
| `supabase/migrations/{ts}_ownership_rls.sql` | CRÉER | ~55 |
| `src/features/quotation/hooks/useQuotationDraft.ts` | +getUser, +created_by, +validation | ~25 |

## Fichiers NON modifiés

| Fichier | Statut |
|---------|--------|
| `CargoLinesForm.tsx` | FROZEN |
| `ServiceLinesForm.tsx` | FROZEN |
| `QuotationHistory.tsx` | Aucun changement (RLS filtre auto) |
| `QuotationPdfExport.tsx` | Aucun changement |
| `generate-quotation-pdf/index.ts` | Déjà correct (user.id passé) |

---

## 4. Comportement résultant

```text
┌─────────────────────────────────────────────────────────────┐
│                     Base de données                         │
│                                                             │
│  quotation_history                                          │
│  ├── created_by UUID NOT NULL DEFAULT auth.uid()           │
│  └── RLS: auth.uid() = created_by                          │
│                                                             │
│  quotation_documents                                        │
│  ├── created_by UUID (déjà existant)                       │
│  └── RLS: auth.uid() = created_by                          │
│                                                             │
│  v_quotation_documents_safe (security_invoker=true)        │
│  └── Colonnes: id, quotation_id, version, status, ...      │
│      (sans file_path, file_hash, created_by)               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     Utilisateur A                           │
│                                                             │
│  [Créer devis] ──▶ INSERT quotation_history                │
│                    created_by = auth.uid() (User A)        │
│                              │                              │
│                              ▼                              │
│              RLS: auth.uid() = created_by ✓                │
│                                                             │
│  [Voir historique] ──▶ RLS filtre automatiquement          │
│              → User A ne voit QUE ses devis                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     Utilisateur B                           │
│                                                             │
│  [Voir historique] ──▶ RLS filtre automatiquement          │
│              → Devis de User A INVISIBLES ✓                │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Points de sécurité validés

| Point | Implémentation |
|-------|----------------|
| Pas de lignes orphelines | `NOT NULL` sur `created_by` |
| Pas de dépendance frontend | `DEFAULT auth.uid()` en base |
| Isolation stricte | RLS `auth.uid() = created_by` |
| Vue sécurisée | `security_invoker = true` |
| Double vérification | Hook passe explicitement `created_by` |

---

## 6. Critères de sortie Phase 5D (corrigés)

- [ ] Colonne `created_by NOT NULL DEFAULT auth.uid()` sur `quotation_history`
- [ ] Données existantes migrées vers premier utilisateur
- [ ] RLS stricte `auth.uid() = created_by` sur les 2 tables
- [ ] Vue `v_quotation_documents_safe` avec `security_invoker = true`
- [ ] Hook `useQuotationDraft` passe `created_by` sur tous les INSERT
- [ ] Gestion cas non-authentifié avec toast + return null
- [ ] Un utilisateur ne voit que ses propres devis
- [ ] Build TypeScript OK
- [ ] Aucun composant FROZEN modifié
