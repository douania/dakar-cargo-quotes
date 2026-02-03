
# Plan Phase 8.5 — Regroupement visuel des fils par sujet (UI Only)

## Objectif

Corriger la fragmentation visuelle des fils dans **Gestion Emails → onglet Fils**, en regroupant visuellement les threads qui appartiennent manifestement à une même conversation, **sans modifier aucune donnée backend**.

## Contraintes respectées

| Règle | Statut |
|-------|--------|
| Aucune modification backend | ✅ |
| Aucune modification sync-emails | ✅ |
| Aucune modification reclassify-threads | ✅ |
| Aucune modification email_threads | ✅ |
| Aucune écriture en base | ✅ |
| Aucune logique IA | ✅ |

---

## Architecture de la solution

```text
┌────────────────────────────────────────────────────────────────────────┐
│                         AVANT (actuel)                                 │
├────────────────────────────────────────────────────────────────────────┤
│  filteredThreads.map(thread => <Card>...</Card>)                       │
│                                                                        │
│  Thread A - "inquiry for dates to banjul"                              │
│  Thread B - "inquiry for dates to banjul"                              │
│  Thread C - "Re: inquiry for dates to banjul"                          │
│  Thread D - "quran dss"                                                │
│  Thread E - "quran dss"                                                │
└────────────────────────────────────────────────────────────────────────┘

                              │
                              ▼

┌────────────────────────────────────────────────────────────────────────┐
│                         APRÈS (Phase 8.5)                              │
├────────────────────────────────────────────────────────────────────────┤
│  groupedThreads.map(group => <ThreadSubjectGroup>)                     │
│                                                                        │
│  📌 inquiry for dates to banjul (3 fils)  [Regroupement visuel]        │
│  ├── Thread A — 1 message — 06/01/2026                                 │
│  ├── Thread B — 1 message — 05/01/2026                                 │
│  └── Thread C — 1 message — 10/01/2026                                 │
│                                                                        │
│  📌 quran dss (2 fils)  [Regroupement visuel]                          │
│  ├── Thread D — 1 message — 06/01/2026                                 │
│  └── Thread E — 1 message — 08/01/2026                                 │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Fichiers à créer

### 1. Utilitaire de normalisation

**Fichier**: `src/lib/threadGrouping.ts`

Contenu:

```typescript
// Normalise un sujet d'email pour regroupement visuel
export function normalizeSubjectForGrouping(subject: string | null): string {
  if (!subject) return 'no-subject';
  return subject
    .toLowerCase()
    .replace(/^re:\s*/gi, '')
    .replace(/^fw:\s*/gi, '')
    .replace(/^fwd:\s*/gi, '')
    .replace(/^tr:\s*/gi, '')      // French "Transféré"
    .replace(/^spam:\s*/gi, '')    // Spam prefix
    .replace(/\s+/g, ' ')
    .trim();
}

// Vérifie si deux dates sont dans la même fenêtre temporelle (30 jours)
export function isWithinDateWindow(
  dateA: string | null, 
  dateB: string | null, 
  windowDays: number = 30
): boolean {
  if (!dateA || !dateB) return true; // Si pas de date, on groupe quand même
  const a = new Date(dateA).getTime();
  const b = new Date(dateB).getTime();
  const diffMs = Math.abs(a - b);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays <= windowDays;
}

// Interface pour un groupe de threads
export interface ThreadGroup {
  groupKey: string;           // Clé de regroupement (sujet normalisé)
  displaySubject: string;     // Sujet affiché (premier sujet original)
  threads: Thread[];          // Threads du groupe
  threadCount: number;        // Nombre de threads
  dateRange: {
    first: Date | null;
    last: Date | null;
  };
}

// Regroupe les threads par sujet normalisé
export function groupThreadsBySubject<T extends {
  id: string;
  subject_normalized: string;
  first_message_at: string | null;
  last_message_at: string | null;
}>(threads: T[]): ThreadGroup<T>[] {
  const groups = new Map<string, T[]>();
  
  // Première passe: grouper par sujet normalisé
  threads.forEach(thread => {
    const key = normalizeSubjectForGrouping(thread.subject_normalized);
    const existing = groups.get(key) || [];
    existing.push(thread);
    groups.set(key, existing);
  });
  
  // Seconde passe: vérifier la fenêtre temporelle et éclater si nécessaire
  const result: ThreadGroup<T>[] = [];
  
  groups.forEach((threadList, groupKey) => {
    // Trier par date
    const sorted = [...threadList].sort((a, b) => {
      const dateA = a.first_message_at ? new Date(a.first_message_at).getTime() : 0;
      const dateB = b.first_message_at ? new Date(b.first_message_at).getTime() : 0;
      return dateA - dateB;
    });
    
    // Sous-grouper par fenêtre temporelle de 30 jours
    const subGroups: T[][] = [];
    let currentSubGroup: T[] = [];
    
    sorted.forEach(thread => {
      if (currentSubGroup.length === 0) {
        currentSubGroup.push(thread);
      } else {
        const firstInGroup = currentSubGroup[0];
        if (isWithinDateWindow(firstInGroup.first_message_at, thread.first_message_at, 30)) {
          currentSubGroup.push(thread);
        } else {
          subGroups.push(currentSubGroup);
          currentSubGroup = [thread];
        }
      }
    });
    if (currentSubGroup.length > 0) {
      subGroups.push(currentSubGroup);
    }
    
    // Créer les groupes finaux
    subGroups.forEach((subGroup, index) => {
      const dates = subGroup
        .map(t => t.first_message_at ? new Date(t.first_message_at) : null)
        .filter((d): d is Date => d !== null);
      
      result.push({
        groupKey: subGroups.length > 1 ? `${groupKey}_${index}` : groupKey,
        displaySubject: subGroup[0].subject_normalized || 'Sans sujet',
        threads: subGroup,
        threadCount: subGroup.length,
        dateRange: {
          first: dates.length > 0 ? new Date(Math.min(...dates.map(d => d.getTime()))) : null,
          last: dates.length > 0 ? new Date(Math.max(...dates.map(d => d.getTime()))) : null,
        },
      });
    });
  });
  
  // Trier les groupes par date la plus récente
  return result.sort((a, b) => {
    const dateA = a.dateRange.last?.getTime() || 0;
    const dateB = b.dateRange.last?.getTime() || 0;
    return dateB - dateA;
  });
}
```

---

### 2. Composant de groupe

**Fichier**: `src/components/emails/ThreadSubjectGroup.tsx`

Responsabilités:
- Afficher un header de groupe avec badge explicatif
- Lister les threads internes (chaque thread reste cliquable individuellement)
- Gérer le collapse/expand avec Collapsible de shadcn
- Afficher un tooltip explicatif sur le badge

Structure UI:

```
┌──────────────────────────────────────────────────────────────────┐
│ 📌 inquiry for dates to banjul         [5 fils] [Regroupement ⓘ]│
├──────────────────────────────────────────────────────────────────┤
│ ▼ (Collapsible ouvert)                                           │
│   ┌─ Thread A ─────────────────────────────────────────────────┐ │
│   │  [Tags] [Badges] Subject — 1 message — 06/01             │ │
│   │  [Conversation] [Analyser Puzzle]                         │ │
│   └────────────────────────────────────────────────────────────┘ │
│   ┌─ Thread B ─────────────────────────────────────────────────┐ │
│   │  ...                                                       │ │
│   └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

Props du composant:

```typescript
interface ThreadSubjectGroupProps {
  group: ThreadGroup<EmailThread>;
  // Callbacks existants passés depuis Emails.tsx
  onViewConversation: (threadId: string) => void;
  onAnalyzePuzzle: (threadId: string) => void;
  // Pour le rendu des threads individuels
  renderThread: (thread: EmailThread) => React.ReactNode;
}
```

Comportement collapse/expand:
- Groupe ouvert par défaut si 2-6 threads
- Groupe fermé par défaut si plus de 6 threads
- Un groupe avec 1 seul thread s'affiche directement sans wrapper

---

## Fichier à modifier

### `src/pages/admin/Emails.tsx`

Modifications:

**1. Imports à ajouter**:

```typescript
import { groupThreadsBySubject, type ThreadGroup } from '@/lib/threadGrouping';
import { ThreadSubjectGroup } from '@/components/emails/ThreadSubjectGroup';
```

**2. Création des groupes dans le composant** (après filteredThreads):

```typescript
// Regroupement visuel des threads par sujet normalisé
const groupedThreads = useMemo(() => {
  return groupThreadsBySubject(filteredThreads);
}, [filteredThreads]);
```

**3. Remplacement du rendu** (lignes 856-947):

Avant:

```tsx
{filteredThreads.map((thread) => {
  // ... rendu du thread
})}
```

Après:

```tsx
{groupedThreads.map((group) => (
  <ThreadSubjectGroup
    key={group.groupKey}
    group={group}
    onViewConversation={setViewingThreadId}
    onAnalyzePuzzle={setAnalyzingThreadId}
    renderThread={(thread) => {
      // Le code existant de rendu de thread est extrait ici
    }}
  />
))}
```

**4. Extraction du rendu de thread individuel**:

Le code actuel de rendu de thread (lignes 864-946) sera passé via `renderThread` prop pour éviter la duplication et préserver le comportement exact.

---

## Indicateurs visuels

### Badge de regroupement

```tsx
<Badge 
  variant="secondary" 
  className="text-xs bg-blue-100 text-blue-700 border-blue-300"
>
  <HelpCircle className="h-3 w-3 mr-1" />
  Regroupement visuel
</Badge>
```

### Tooltip explicatif

```tsx
<Tooltip>
  <TooltipTrigger>
    <Badge>...</Badge>
  </TooltipTrigger>
  <TooltipContent>
    <p className="max-w-xs">
      Ces fils sont regroupés visuellement par sujet similaire.
      Les données backend ne sont pas fusionnées.
    </p>
  </TooltipContent>
</Tooltip>
```

---

## Tests de validation

| Test | Critère de succès |
|------|-------------------|
| P8.5-1 Cas Banjul | "inquiry for dates to banjul" → 1 groupe avec plusieurs threads visibles |
| P8.5-2 Cas Quran DSS | Regroupement identique |
| P8.5-3 Sujet unique | Thread seul affiché directement sans wrapper de groupe |
| P8.5-4 Sécurité | Aucune requête Supabase supplémentaire, aucune écriture DB |
| P8.5-5 Collapse | Groupes de plus de 6 threads fermés par défaut |
| P8.5-6 Fenêtre 30j | Threads espacés de plus de 30 jours → groupes séparés |

---

## Ordre d'implémentation

```text
1. Créer src/lib/threadGrouping.ts (utilitaires)
   └── normalizeSubjectForGrouping()
   └── isWithinDateWindow()
   └── groupThreadsBySubject()

2. Créer src/components/emails/ThreadSubjectGroup.tsx
   └── Header avec badge et tooltip
   └── Collapsible avec shadcn
   └── Rendu des threads via renderThread prop

3. Modifier src/pages/admin/Emails.tsx
   └── Import des nouveaux modules
   └── useMemo pour groupedThreads
   └── Remplacement du .map() par le nouveau composant
```

---

## Ce qui ne change PAS

- Nombre de threads affichés: identique (tous visibles)
- Comportement des boutons: identique (Conversation, Analyser Puzzle)
- Données backend: aucune modification
- Requêtes Supabase: aucune requête supplémentaire
- Logique de filtrage: identique (threadFilter, threadSearchQuery)

---

## Effort estimé

| Étape | Temps |
|-------|-------|
| Utilitaire threadGrouping.ts | ~15 min |
| Composant ThreadSubjectGroup.tsx | ~25 min |
| Intégration Emails.tsx | ~15 min |
| **Total** | **~55 min** |

---

## Section technique

### Règle de normalisation

```typescript
// Entrée: "Re: Fw: SPAM: Inquiry for Dates to Banjul"
// Sortie: "inquiry for dates to banjul"
```

Préfixes supprimés:
- `re:` (réponse)
- `fw:` / `fwd:` (transfert anglais)
- `tr:` (transfert français)
- `spam:` (marquage spam)

### Règle de fenêtre temporelle

Deux threads sont dans le même groupe si:

```
normalizeSubject(A) === normalizeSubject(B)
ET
|date(A) - date(B)| ≤ 30 jours
```

Si des threads ont le même sujet mais sont espacés de plus de 30 jours, ils forment des groupes séparés.

### Gestion des threads uniques

Un groupe contenant un seul thread s'affiche **directement** sans le wrapper `Collapsible`, pour éviter un niveau d'indentation inutile.

