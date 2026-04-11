

# P0 — Patch image documentaire `analyze-attachments` — Option B

## Diagnostic confirmé sur le runtime réel

Le gap est étroit et précis. Deux chemins vivants dans `analyze-attachments/index.ts` qualifient les images **uniquement par MIME** :

| Chemin | Ligne | Code actuel |
|---|---|---|
| Background | 641 | `const isImage = attachment.content_type?.startsWith('image/')` |
| Sync (loop) | 1234 | `const isImage = attachment.content_type?.startsWith('image/')` |

Si le MIME amont est `application/octet-stream`, `null`, ou un type générique, une image documentaire réelle (`.jfif`, `.jpg`, `.png`, `.webp`) tombe dans le bloc `unsupported` et ne sera jamais analysée.

Deuxième point : le `mimeType` envoyé à l'IA (lignes 835 et 1516) fait `attachment.content_type || 'image/jpeg'` — correct en fallback, mais le data URI devrait porter le MIME résolu proprement.

Troisième point : le pattern Outlook inline local (ligne 1070) ne couvre pas `.jpeg`, `.jfif`, `.webp`.

## Plan de patch — 1 seul fichier

**Fichier** : `supabase/functions/analyze-attachments/index.ts`

### Modification 1 — Helpers de résolution (après ligne ~92, zone utilitaires)

Ajouter :

```typescript
const DOC_IMAGE_EXTENSIONS: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function getFileExtension(filename: string | null): string | null {
  if (!filename) return null;
  const idx = filename.lastIndexOf('.');
  return idx >= 0 ? filename.substring(idx + 1).toLowerCase() : null;
}

function resolveDocumentImageMimeType(
  contentType: string | null | undefined,
  filename: string | null
): string | null {
  if (contentType?.startsWith('image/')) return contentType;
  const ext = getFileExtension(filename);
  return ext ? DOC_IMAGE_EXTENSIONS[ext] ?? null : null;
}
```

### Modification 2 — Chemin background (ligne 641)

```
Avant : const isImage = attachment.content_type?.startsWith('image/');
Après : const resolvedImageMime = resolveDocumentImageMimeType(attachment.content_type, attachment.filename);
        const isImage = !!resolvedImageMime;
```

Et ligne 835 :
```
Avant : const mimeType = attachment.content_type || 'image/jpeg';
Après : const mimeType = resolvedImageMime || attachment.content_type || 'image/jpeg';
```

### Modification 3 — Chemin sync/loop (ligne 1234)

Même transformation :
```
Avant : const isImage = attachment.content_type?.startsWith('image/');
Après : const resolvedImageMime = resolveDocumentImageMimeType(attachment.content_type, attachment.filename);
        const isImage = !!resolvedImageMime;
```

Et ligne 1516 :
```
Avant : const mimeType = attachment.content_type || 'image/jpeg';
Après : const mimeType = resolvedImageMime || attachment.content_type || 'image/jpeg';
```

### Modification 4 — Enrichir `unsupported` avec `filename_extension`

Lignes 647 et 1250 : ajouter `filename_extension: getFileExtension(attachment.filename)` dans l'objet `extracted_data` du bloc unsupported, pour traçabilité.

### Modification 5 — Élargir le pattern Outlook inline (ligne 1070)

```
Avant : /^image00\d+\.(jpg|png|gif)$/i
Après : /^image00\d+\.(jpg|jpeg|jfif|png|gif|webp)$/i
```

## Fichiers non touchés

- `import-thread/index.ts` — filtrage inline amont inchangé
- `sync-emails/index.ts` — filtrage inline amont inchangé
- Schéma DB — aucune migration
- Cockpit / pricing / docs — hors périmètre

## Blast radius

- 1 fichier edge function modifié
- 0 migration DB
- 0 nouveau endpoint
- Helpers purs (pas d'effet de bord)
- Le filtrage inline amont reste strictement inchangé

## Vérifications après patch

1. Une PJ `.jfif` avec `content_type: application/octet-stream` → `isImage = true`, analysée par l'IA avec `data:image/jpeg;base64,...`
2. Une PJ `.jpg` avec `content_type: image/jpeg` → comportement identique à avant
3. Une PJ `.docx` avec MIME absent → toujours `unsupported` (pas dans `DOC_IMAGE_EXTENSIONS`)
4. `image001.jfif` en inline → filtrée par le pattern élargi ligne 1070
5. Le bloc `unsupported` porte `filename_extension` pour audit

