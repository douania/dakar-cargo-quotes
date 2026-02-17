

# Correctif : build-case-puzzle ignore les documents Intake

## Bug reel

`build-case-puzzle` ne lit que `emails` + `email_attachments`. Les dossiers crees via Intake ont `thread_id = NULL`, donc l'IA recoit zero texte, et tous les gaps restent ouverts.

## Solution : Option A stricte

Pas de telechargement PDF dans build-case-puzzle.
Pas d'appel storage.
Pas d'Option B.

Le texte est extrait une seule fois a l'upload, stocke en base, et lu directement par build-case-puzzle.

## 3 etapes chirurgicales

### Etape 1 — Migration SQL

Ajouter la colonne `extracted_text` a `case_documents` :

```sql
ALTER TABLE case_documents ADD COLUMN IF NOT EXISTS extracted_text TEXT;
```

### Etape 2 — Remplir extracted_text a l'upload

Modifier `CaseDocumentsTab.tsx` : apres l'insert DB (ligne 98), appeler `parse-document` puis stocker le texte extrait.

```text
// Apres l'insert DB reussi (ligne 98)
// Appeler parse-document pour extraire le texte
const formData = new FormData();
formData.append('file', file);

const { data: { session } } = await supabase.auth.getSession();
const parseResponse = await fetch(
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-document`,
  {
    method: 'POST',
    headers: { Authorization: `Bearer ${session?.access_token}` },
    body: formData,
  }
);

if (parseResponse.ok) {
  const parseResult = await parseResponse.json();
  const extractedText = parseResult.document?.text_preview
    ? parseResult.document.text_preview
    : null;

  // Probleme : text_preview est tronque a 500 chars.
  // Il faut utiliser content_text complet depuis la table documents.
  if (parseResult.document?.id) {
    // Lire le content_text complet depuis documents (via edge function ou RPC)
    // Pour l'instant, stocker ce qui est disponible
    await supabase
      .from("case_documents")
      .update({ extracted_text: extractedText })
      .eq("id", docId);
  }
}
```

**Point d'attention** : `parse-document` stocke le texte complet dans la table `documents.content_text` (jusqu'a 2M chars). Il faut recuperer ce texte complet et le copier dans `case_documents.extracted_text`. Deux approches :

- **Approche simple** : lire `documents.content_text` via une requete service-role dans une edge function dediee (la table `documents` a RLS `deny all` cote client).
- **Approche retenue** : modifier `parse-document` pour qu'il accepte un parametre optionnel `case_document_id` et remplisse directement `case_documents.extracted_text` apres extraction.

Modification dans `parse-document/index.ts` (apres l'insert dans `documents`, vers ligne 218) :

```text
// Si un case_document_id est fourni, copier le texte extrait
const caseDocumentId = formData.get('case_document_id') as string | null;
if (caseDocumentId && extractedText) {
  await supabase
    .from("case_documents")
    .update({ extracted_text: extractedText.substring(0, 200000) })
    .eq("id", caseDocumentId);
}
```

Puis dans `CaseDocumentsTab.tsx`, passer `case_document_id` dans le FormData :

```text
formData.append('case_document_id', docId);
```

### Etape 3 — build-case-puzzle lit extracted_text

Modifier `supabase/functions/build-case-puzzle/index.ts` (apres la section attachments, vers ligne 885) :

```text
// Load case_documents with pre-extracted text (Intake flow)
const { data: caseDocuments } = await serviceClient
  .from("case_documents")
  .select("file_name, document_type, extracted_text")
  .eq("case_id", case_id)
  .not("extracted_text", "is", null);

let caseDocContext = "";
for (const doc of caseDocuments || []) {
  const truncated = (doc.extracted_text || "").slice(0, 3000);
  caseDocContext += `\n[Document: ${doc.file_name} (${doc.document_type})]\n${truncated}\n`;
}

// Combine with email attachments
const fullAttachmentContext = [attachmentContext, caseDocContext]
  .filter(Boolean)
  .join("\n\n");
```

Passer `fullAttachmentContext` au lieu de `attachmentContext` dans `extractFactsWithAI`.

Modifier aussi la garde ligne 863 pour ne plus bloquer si des case_documents existent :

```text
if (caseData.thread_id && emails.length === 0) {
  // Garde existante inchangee — ne concerne que les dossiers email
}
// Ajouter : si pas de thread_id ET pas de case_documents → erreur
if (!caseData.thread_id && (!caseDocuments || caseDocuments.length === 0)) {
  return new Response(
    JSON.stringify({ error: "No emails or documents found for this case" }),
    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
```

## Fichiers modifies

| Fichier | Modification |
|---------|-------------|
| Migration SQL | `ALTER TABLE case_documents ADD COLUMN extracted_text TEXT` |
| `supabase/functions/parse-document/index.ts` | Accepter `case_document_id`, ecrire `extracted_text` |
| `src/components/case/CaseDocumentsTab.tsx` | Passer `case_document_id` dans le FormData |
| `supabase/functions/build-case-puzzle/index.ts` | Lire `case_documents.extracted_text`, injecter dans le contexte IA |

## Pour les documents deja uploades

Les 6 documents existants du dossier 31efcc01 n'ont pas encore de `extracted_text`. Apres le deploiement, il faudra :
1. Re-uploader les documents, ou
2. Lancer un script one-shot qui appelle `parse-document` pour chaque `case_document` existant sans `extracted_text`

## Resultat attendu

1. Upload d'un document → `parse-document` → `extracted_text` stocke dans `case_documents`
2. `build-case-puzzle` lit `extracted_text` directement (zero appel storage)
3. L'IA recoit le vrai contenu des documents
4. `cargo.description` est extrait automatiquement
5. Le gap passe de `open` a `resolved`
6. Le statut passe a `READY_TO_PRICE`

