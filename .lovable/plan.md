

# PHASE 4B.3 — Stabilisation fetchThreadData (Safe Mode)

## Analyse de la fonction cible

| Élément | Détails |
|---------|---------|
| Fichier source | `src/pages/QuotationSheet.tsx` |
| Fonction | `fetchThreadData()` (L165-292) |
| Taille | ~127 lignes |
| Responsabilités | Fetch emails, attachments, consolidation, détection offres, alerts |

## Fonctions pures extractables

### 1. `mapRawEmailToThreadEmail()`

**Rôle** : Convertit un enregistrement brut Supabase en `ThreadEmail`

**Signature** :
```typescript
function mapRawEmailToThreadEmail(rawEmail: any): ThreadEmail
```

**Code source** : Lignes 188-199, 219-230, 236-247 (logique dupliquée 3x)

---

### 2. `loadThreadEmailsByRef()`

**Rôle** : Charge les emails d'un thread via `thread_ref`

**Signature** :
```typescript
async function loadThreadEmailsByRef(threadRef: string): Promise<ThreadEmail[]>
```

**Code source** : Lignes 179-201

---

### 3. `loadThreadEmailsBySubject()`

**Rôle** : Charge les emails similaires par sujet normalisé (fallback)

**Signature** :
```typescript
async function loadThreadEmailsBySubject(subject: string): Promise<ThreadEmail[]>
```

**Code source** : Lignes 204-232

---

### 4. `loadThreadAttachments()`

**Rôle** : Charge les pièces jointes pour une liste d'emails

**Signature** :
```typescript
async function loadThreadAttachments(
  emailIds: string[]
): Promise<Array<{ id: string; filename: string; content_type: string; email_id?: string }>>
```

**Code source** : Lignes 257-263

---

### 5. `buildCurrentEmail()`

**Rôle** : Détermine l'email sélectionné dans le thread

**Signature** :
```typescript
function buildCurrentEmail(
  emails: ThreadEmail[], 
  targetEmailId: string
): ThreadEmail
```

**Code source** : Ligne 253

---

## Structure du fichier à créer

**Chemin** : `src/features/quotation/services/threadLoader.ts`

```text
/**
 * Service de chargement des threads email
 * Phase 4B.3 — Extraction pure de fetchThreadData
 */

// Imports
import { supabase } from '@/integrations/supabase/client';
import { normalizeSubject } from '../utils/consolidation';
import type { ThreadEmail, ExtractedData } from '../types';

// Type pour les données brutes Supabase
interface RawEmailRecord { ... }

// Fonction 1: mapRawEmailToThreadEmail
export function mapRawEmailToThreadEmail(raw: RawEmailRecord): ThreadEmail { ... }

// Fonction 2: loadThreadEmailsByRef
export async function loadThreadEmailsByRef(threadRef: string): Promise<ThreadEmail[]> { ... }

// Fonction 3: loadThreadEmailsBySubject
export async function loadThreadEmailsBySubject(subject: string): Promise<ThreadEmail[]> { ... }

// Fonction 4: loadThreadAttachments
export async function loadThreadAttachments(emailIds: string[]): Promise<...> { ... }

// Fonction 5: buildCurrentEmail
export function buildCurrentEmail(emails: ThreadEmail[], targetId: string): ThreadEmail { ... }
```

---

## Modification dans QuotationSheet.tsx

### 1. Ajout de l'import

```typescript
import { 
  mapRawEmailToThreadEmail,
  loadThreadEmailsByRef,
  loadThreadEmailsBySubject,
  loadThreadAttachments,
  buildCurrentEmail
} from '@/features/quotation/services/threadLoader';
```

### 2. Simplification de fetchThreadData

**Avant** (~127 lignes) :
```typescript
const fetchThreadData = async () => {
  // Toute la logique inline
};
```

**Après** (~60 lignes estimées) :
```typescript
const fetchThreadData = async () => {
  try {
    // Fetch initial email (reste inline - besoin de emailId du scope)
    const { data: emailData, error } = await supabase
      .from('emails')
      .select('*')
      .eq('id', emailId)
      .single();
    
    if (error) throw error;
    
    // Load thread emails (appels aux fonctions extraites)
    let threadEmailsList = await loadThreadEmailsByRef(emailData.thread_ref);
    
    if (threadEmailsList.length <= 1 && emailData.subject) {
      threadEmailsList = await loadThreadEmailsBySubject(emailData.subject);
    }
    
    if (threadEmailsList.length === 0) {
      threadEmailsList = [mapRawEmailToThreadEmail(emailData)];
    }
    
    setThreadEmails(threadEmailsList);
    
    // Current email
    const currentEmail = buildCurrentEmail(threadEmailsList, emailId!);
    setSelectedEmail(currentEmail);
    
    // Attachments
    const attachmentData = await loadThreadAttachments(threadEmailsList.map(e => e.id));
    setAttachments(attachmentData);
    
    // Le reste (consolidation, detection, alerts) reste identique
    // ...
  } catch (error) { ... }
};
```

---

## Fichiers impactés

| Fichier | Action |
|---------|--------|
| `src/features/quotation/services/threadLoader.ts` | **Créer** — Nouveau service |
| `src/pages/QuotationSheet.tsx` | **Modifier** — Import + refactor fetchThreadData |

---

## Contraintes respectées

| Contrainte | Statut |
|------------|--------|
| Signature fetchThreadData inchangée | ✅ |
| useEffect non déplacé | ✅ |
| fetchThreadData reste orchestrateur | ✅ |
| Fonctions pures uniquement | ✅ |
| Aucune logique métier modifiée | ✅ |
| Aucun state supprimé/renommé | ✅ |
| Aucun composant UI touché | ✅ |

---

## Validation

- [ ] Build TypeScript OK
- [ ] Aucun runtime error
- [ ] Tests Vitest existants toujours verts (5/5)
- [ ] Comportement fonctionnel identique

---

## Message de clôture attendu

```
Phase 4B.3 exécutée.
fetchThreadData stabilisée sans changement fonctionnel.
Fichier créé : src/features/quotation/services/threadLoader.ts
5 fonctions pures extraites.
Build OK. Tests 5/5.
```

