
# Fix echec silencieux parse-document a l'upload

## Probleme

Dans `CaseDocumentsTab.tsx` (lignes 121-128), le `fetch()` vers `parse-document` ne verifie pas `response.ok`. Comme `fetch()` ne throw pas sur les erreurs HTTP (401/404/500), le `catch` ne s'execute jamais et l'echec est completement invisible.

## Modification unique

**Fichier** : `src/components/case/CaseDocumentsTab.tsx`
**Lignes** : 120-131

Remplacer le bloc fetch + catch par :

```typescript
const { data: { session } } = await supabase.auth.getSession();
const parseRes = await fetch(
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-document`,
  {
    method: 'POST',
    headers: { Authorization: `Bearer ${session?.access_token}` },
    body: parseFormData,
  }
);
if (!parseRes.ok) {
  const errBody = await parseRes.text().catch(() => '');
  console.error('parse-document failed:', parseRes.status, errBody);
  throw new Error(`parse-document HTTP ${parseRes.status}: ${errBody || 'no body'}`);
}
console.log('parse-document ok for', docId);
} catch (parseErr) {
  console.warn('Text extraction failed (non-blocking):', parseErr);
  toast({ title: "Extraction texte echouee", description: "Vous pouvez relancer via backfill.", variant: "destructive" });
```

## Ce qui change

1. `response.ok` est teste : les erreurs HTTP deviennent visibles
2. `console.error` avec status + body pour tracabilite dans les logs
3. `throw` pour tomber dans le `catch` existant
4. Toast non-bloquant ajoute dans le catch : l'operateur voit le probleme sans bloquer l'upload
5. Log de succes pour confirmer le bon fonctionnement

## Ce qui ne change pas

- Le reste de la logique d'upload (storage, DB, timeline)
- L'upload reste fonctionnel meme si parse-document echoue (try/catch conserve)
- Aucun autre fichier modifie
