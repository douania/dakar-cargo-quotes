

# Correction de l'erreur 400 "No emails or documents found"

## Bug reel

La garde (ligne 877) utilise la variable `caseDocuments` qui est filtree par `extracted_text IS NOT NULL` (ligne 868). Les 6 documents du dossier 31efcc01 ont tous `extracted_text = null` car uploades avant le correctif. Donc `caseDocuments` est vide, et la garde retourne 400.

## Correction en 2 parties

### Partie 1 — Corriger la garde dans build-case-puzzle

Separer la requete de la garde de celle du contexte IA :

**Fichier : `supabase/functions/build-case-puzzle/index.ts`**

Avant la garde (ligne 863), ajouter une requete qui compte TOUS les case_documents (sans filtre sur extracted_text) :

```text
// Count ALL case_documents (for guard check)
const { count: totalCaseDocsCount } = await serviceClient
  .from("case_documents")
  .select("id", { count: "exact", head: true })
  .eq("case_id", case_id);
```

Modifier la garde ligne 877 :

```text
// Avant (bug) : utilise caseDocuments (filtre extracted_text IS NOT NULL)
if (!caseData.thread_id && (!caseDocuments || caseDocuments.length === 0)) {

// Apres (fix) : utilise totalCaseDocsCount (tous les documents)
if (!caseData.thread_id && (!totalCaseDocsCount || totalCaseDocsCount === 0)) {
```

Cela permet a l'analyse de continuer meme si les documents n'ont pas encore de texte extrait. L'IA travaillera avec ce qui est disponible (les facts existants en base seront pris en compte grace au fix precedent).

### Partie 2 — Backfill des documents existants

Creer une edge function `backfill-case-documents` qui :
1. Lit tous les `case_documents` ou `extracted_text IS NULL`
2. Pour chaque document, telecharge le fichier depuis le storage
3. Appelle `parse-document` en interne (via fetch)
4. Stocke le resultat dans `case_documents.extracted_text`

**Fichier : `supabase/functions/backfill-case-documents/index.ts`**

La fonction :
- Accepte un `case_id` optionnel (si omis, traite tous les documents sans texte)
- Pour chaque document sans `extracted_text` :
  - Telecharge depuis le bucket `case-documents`
  - Envoie a `parse-document` avec le `case_document_id`
  - Le texte sera stocke automatiquement par `parse-document` (deja implemente)
- Retourne un rapport : nombre de documents traites / erreurs

## Fichiers modifies

| Fichier | Modification |
|---------|-------------|
| `supabase/functions/build-case-puzzle/index.ts` | Ajout requete count, modification garde |
| `supabase/functions/backfill-case-documents/index.ts` | Nouveau fichier — backfill one-shot |

## Sequence d'execution

1. Deployer le fix de la garde (Partie 1)
2. Deployer la fonction de backfill (Partie 2)
3. Appeler backfill avec `case_id = 31efcc01-...`
4. Verifier que `extracted_text` est rempli pour les 6 documents
5. Relancer `build-case-puzzle` — l'IA aura le contenu reel des documents
6. `cargo.description` sera extrait, le gap sera resolu

## Risque

Faible. La Partie 1 est une modification minimale de la garde. La Partie 2 est un script one-shot qui reutilise `parse-document` deja en place.

