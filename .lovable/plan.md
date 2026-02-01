

# Plan de correction : Bug React "setState during render"

## Problème identifié

Le composant `QuotationPuzzleView.tsx` appelle le callback `onPuzzleComplete` directement pendant le rendu React (lignes 116-119), ce qui viole les règles React et cause :

1. **Warning React** : "Cannot update a component while rendering a different component"
2. **Toasts en boucle** : Le message "Puzzle analysé: 60% complet" est affiché indéfiniment
3. **Performance dégradée** : Boucle de re-renders infinie

## Cause technique

```tsx
// QuotationPuzzleView.tsx - lignes 116-119
// ❌ MAUVAIS : exécuté pendant le render, pas dans un effet
if (isComplete && onPuzzleComplete && puzzle) {
  onPuzzleComplete(puzzle);   // Déclenche setState dans le parent
  refetchKnowledge();
}
```

Le callback `onPuzzleComplete` dans `Emails.tsx` appelle `loadData()` qui fait des `setState`, déclenchant un re-render du parent pendant que React rend encore l'enfant.

## Solution

Déplacer la logique de callback dans un `useEffect` avec les bonnes dépendances et un garde-fou contre les appels multiples.

## Fichiers à modifier

| Fichier | Modification |
|---------|--------------|
| `src/components/QuotationPuzzleView.tsx` | Refactor du callback `onPuzzleComplete` dans un `useEffect` avec flag `hasCalledComplete` |

## Implémentation détaillée

### Étape 1 : Ajouter un state pour éviter les appels multiples

```tsx
// Ajouter un state pour tracker si onPuzzleComplete a déjà été appelé
const [hasCalledComplete, setHasCalledComplete] = useState(false);
```

### Étape 2 : Déplacer la logique dans un useEffect

```tsx
// Remplacer le code problématique (lignes 116-119) par un useEffect
useEffect(() => {
  if (isComplete && onPuzzleComplete && puzzle && !hasCalledComplete) {
    setHasCalledComplete(true);
    onPuzzleComplete(puzzle);
    refetchKnowledge();
  }
}, [isComplete, puzzle, onPuzzleComplete, hasCalledComplete, refetchKnowledge]);
```

### Étape 3 : Réinitialiser le flag quand le threadId change

```tsx
// Reset le flag si on change de thread (pour permettre une nouvelle analyse)
useEffect(() => {
  setHasCalledComplete(false);
}, [threadId]);
```

## Résultat attendu

| Avant | Après |
|-------|-------|
| Toast affiché en boucle | Toast affiché **une seule fois** à la fin de l'analyse |
| Warning React dans la console | Aucun warning |
| Boucle de re-renders | Comportement stable |
| UI qui "réagit bizarrement" | UI fluide et réactive |

## Vérification post-fix

1. Lancer une analyse de puzzle sur un petit thread (5-10 emails)
2. Vérifier qu'aucun warning n'apparaît dans la console
3. Vérifier que le toast "Puzzle analysé" n'apparaît qu'une seule fois
4. Tester avec le thread de 38 messages pour confirmer la stabilité

## Bonne nouvelle

Le système asynchrone Phase 7.1 **fonctionne correctement**. Les logs montrent :
- Job `1470d07f-b9b1-4439-9a70-a62e80f6a587` terminé en ~6 minutes
- 30 connaissances stockées avec succès

Le seul problème est ce bug React côté frontend.

