

# Patch P0-D : Envoyer threadKey dans le payload d'import

## Probleme identifie

Le frontend (`EmailSearchImport.tsx`) n'envoie pas `threadKey` dans les appels a `import-thread` et `processQuotationRequest`. Le backend l'extrait (L1339) mais recoit toujours `undefined`, se rabattant sur le `threadId` derive du premier email du batch.

Ce fallback fonctionne dans la majorite des cas, mais est moins deterministe : si le batch melange des emails de fils differents (cas edge residuel post P0-B), le `batchRootMessageId` pourrait etre celui du mauvais fil.

## Correction

### Fichier : `src/components/EmailSearchImport.tsx`

**1) `handleImport` (L153-158)** : Ajouter `threadKey` du premier thread selectionne dans le payload.

```text
// AVANT
body: { 
  configId, 
  uids: remainingUids,
  learningCase: 'quotation'
}

// APRES
// Trouver le threadKey du thread courant dans la boucle
// Pour chaque batch, envoyer le threadKey correspondant
body: { 
  configId, 
  uids: remainingUids,
  learningCase: 'quotation',
  threadKey: currentThreadKey  // derive du thread selectionne
}
```

Attention : la logique actuelle collecte tous les UIDs de TOUS les threads selectionnes en un seul batch. Pour que `threadKey` soit coherent, il faut iterer par thread selectionne (un appel import-thread par thread), ou au minimum envoyer le threadKey du premier thread si un seul est selectionne.

**Approche recommandee** : Iterer par thread selectionne au lieu de fusionner tous les UIDs :

```text
for (const thread of threads) {
  if (!selectedThreads.has(getThreadSelectionKey(thread))) continue;
  const threadUids = thread.messages.map(m => m.uid);
  const currentThreadKey = thread.threadKey;
  // Appel import-thread avec threadKey + uids de CE thread uniquement
}
```

Cela garantit que chaque appel import-thread recoit le bon `threadKey` pour son lot d'emails.

**2) `handleProcessQuotation` (L222-232)** : Ajouter `threadKey` dans l'appel a `processQuotationRequest`.

Verifier si `processQuotationRequest` dans `src/services/emailService.ts` transmet `threadKey` au backend. Si non, l'ajouter aussi.

## Fichiers modifies

| Fichier | Changement |
|---------|-----------|
| `src/components/EmailSearchImport.tsx` | Import par thread (pas batch global) + envoi threadKey |

## Risque

Nul. Le backend accepte deja `threadKey` (L1339). L'ajout est purement additif. Le fallback reste en place si `threadKey` est absent.

## Section technique

La boucle `while (remainingUids.length > 0)` gere deja le batching par taille (le backend renvoie `remainingUids`). La modification consiste a ajouter une boucle externe par thread selectionne, puis la boucle interne par batch de taille.

Pas de changement backend necessaire.

