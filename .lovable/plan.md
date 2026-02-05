

# Documentation du Pattern "UI dépend de l'état métier"

## Objectif

Documenter le pattern architectural validé Phase 12 pour guider les futures implémentations et éviter les régressions.

---

## Pattern à documenter

### Principe fondamental

L'UI doit dépendre de **l'état métier vérifiable** et non d'**événements historiques transitoires**.

| Anti-pattern (fragile) | Pattern correct (robuste) |
|------------------------|---------------------------|
| `is_new` (événement) | `factsCount === 0` (état) |
| `hasQuoteCase` (existence) | `needsAnalysis` (condition métier) |
| `case.created_at === now` | `case.status === 'NEW'` |

### Pourquoi ?

- **Idempotence** : Même résultat après reload, retry, ou reprise legacy
- **Testabilité** : État vérifiable en DB à tout moment
- **Résilience** : Pas de dépendance à la mémoire runtime

---

## Plan d'implémentation

### Option 1 — Ajouter au README.md (recommandé)

Ajouter une section "Architecture Patterns" après "Development Conventions" :

```markdown
## Architecture Patterns

### UI State vs Events (Phase 12)

**Règle** : Les conditions d'affichage UI doivent dépendre de l'état métier vérifiable, jamais d'événements historiques.

| Approche | Exemple | Robustesse |
|----------|---------|------------|
| Fragile | `bouton visible si case vient d'être créé` | Échoue au reload |
| Robuste | `bouton visible si factsCount === 0` | Toujours cohérent |

**Application Phase 12** :
```typescript
// Anti-pattern
const showButton = !hasQuoteCase; // Dépend de l'existence, pas du besoin

// Pattern correct
const needsAnalysis = !quoteCase || factsCount === 0; // Dépend de l'état métier
```

**Checklist nouvelle feature** :
- [ ] La condition UI peut-elle être recalculée après un reload ?
- [ ] L'état est-il vérifiable en base de données ?
- [ ] Le comportement est-il identique pour les données legacy ?
```

### Option 2 — Ajouter à la Knowledge Base Lovable

Créer une entrée memory via les paramètres projet :

**Titre** : `architecture/ui-state-pattern`

**Contenu** :
```
Les conditions d'affichage UI doivent dépendre de l'état métier vérifiable 
(ex: factsCount === 0) plutôt que d'événements transitoires (ex: is_new, 
case vient d'être créé). Ce pattern garantit l'idempotence après reload, 
retry réseau ou reprise de données legacy. Validé Phase 12 avec le fix 
needsAnalysis = !quoteCase || factsCount === 0.
```

---

## Recommandation CTO

**Faire les deux** :

1. **README.md** → Documentation technique pour développeurs
2. **Knowledge Base** → Contexte pour l'assistant IA Lovable

Cela garantit que :
- Les développeurs humains ont accès au pattern
- L'assistant IA applique automatiquement ce pattern dans les futures phases

---

## Fichiers modifiés

| Fichier | Modification |
|---------|-------------|
| `README.md` | +15 lignes section "Architecture Patterns" |

---

## Contraintes respectées

| Contrainte | Statut |
|------------|--------|
| Aucun code modifié | ✅ |
| Documentation uniquement | ✅ |
| Réutilisable futures phases | ✅ |

