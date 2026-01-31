

# PHASE 3B.3 — ThreadTimelineCard P2 (UI Hardening)

## Périmètre vérifié

| Attribut | Valeur |
|----------|--------|
| Fichier cible | `src/features/quotation/components/ThreadTimelineCard.tsx` |
| Lignes actuelles | 132 |
| Type | Améliorations UI P2 |
| Risque | **Très faible** (aucune logique modifiée) |

---

## Modifications P2 prévues

### 1. Ajout du Skeleton Loader (composant local)

```typescript
function ThreadTimelineSkeleton() {
  return (
    <Card className="border-ocean/30 bg-ocean/5 animate-pulse">
      <CardHeader className="pb-2">
        <div className="h-4 w-48 bg-muted rounded" />
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="w-3 h-3 rounded-full bg-muted mt-1.5" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-1/3 bg-muted rounded" />
              <div className="h-3 w-2/3 bg-muted rounded" />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
```

**Activation** : Garde future-proof sans nouvelle prop
```typescript
if (!threadEmails) {
  return <ThreadTimelineSkeleton />;
}
```

---

### 2. React.memo (stabilité de rendu)

```typescript
import { memo } from 'react';

export const ThreadTimelineCard = memo(function ThreadTimelineCard(
  props: ThreadTimelineCardProps
) {
  // contenu IDENTIQUE
});
```

**Sécurité** : Props primitives/tableaux déjà stabilisés, aucun state interne.

---

### 3. Accessibilité (A11y minimale)

**a) Trigger clavier + ARIA** (ligne 42-52)

```typescript
<div
  className="flex items-center justify-between cursor-pointer"
  role="button"
  tabIndex={0}
  aria-expanded={expanded}
  aria-label="Afficher l'historique du fil"
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onExpandedChange(!expanded);
    }
  }}
>
```

**b) Focus ring sur items email** (ligne 69-75)

Ajout dans className :
```typescript
"focus:outline-none focus:ring-2 focus:ring-ocean/40"
```

---

## Récapitulatif des changements

| Amélioration | Impact | Logique métier |
|-------------|--------|----------------|
| Skeleton loader | UX ⬆️ | ❌ Aucun |
| React.memo | Perf ⬆️ | ❌ Aucun |
| A11y clavier | Accessibilité ⬆️ | ❌ Aucun |
| Focus ring | UX ⬆️ | ❌ Aucun |

---

## Fichier modifié

| Fichier | Action |
|---------|--------|
| `src/features/quotation/components/ThreadTimelineCard.tsx` | **Modifier** |

---

## Lignes impactées

| Section | Lignes | Modification |
|---------|--------|--------------|
| Import | 1 | Ajouter `memo` |
| Skeleton | Après ligne 21 | Nouveau composant local |
| Garde skeleton | Ligne 33 | Ajouter check `!threadEmails` |
| Export | Ligne 23 | Wrapper `memo()` |
| Trigger A11y | Lignes 42-52 | Ajouter attributs ARIA |
| Email item | Ligne 70 | Ajouter focus ring |

---

## Validation obligatoire après exécution

- [ ] Build TypeScript OK
- [ ] Timeline comportement IDENTIQUE
- [ ] Expand/collapse souris OK
- [ ] Expand/collapse clavier (Enter / Space) OK
- [ ] Sélection email inchangée
- [ ] Focus visible sur navigation clavier
- [ ] Aucun warning React

---

## Message de clôture attendu

```
Phase 3B.3 exécutée.
ThreadTimelineCard durci (P2) :
- Skeleton loader (future-proof)
- Accessibilité clavier & ARIA
- React.memo
- Focus ring
Aucune logique métier modifiée.
Prêt pour Phase 3B.4 ou validation finale.
```

