
# Fix : Decodage MIME/Base64 tronque + vue complete de l'email

## Diagnostic technique (cause racine identifiee)

L'email `8ea0ad65` a un `body_text` de 22 173 caracteres qui commence par du Base64 pur (4 420 chars) puis contient un marqueur de boundary MIME `--_000_AM8P189MB1154...` sans declaration `boundary=` en amont.

Trace d'execution actuelle de `extractPlainTextFromMime` :

```text
1. Recherche boundary= dans rawBody         -> pas trouve (pas de declaration formelle)
2. Suppression espaces/retours a la ligne    -> stripped = 22000 chars
3. Test looksLikeBase64 sur 200 premiers     -> true (les 200 premiers sont du Base64 valide)
4. safeChunk = 8000 premiers chars           -> INCLUT "--_000_" a la position ~4300
5. atob(safeChunk)                           -> ECHOUE (caracteres "-" et "_" invalides en Base64 standard)
6. catch -> fall through
7. return rawBody.slice(0, 4000)             -> RETOURNE LE BASE64 BRUT
```

Resultat : l'utilisateur voit `DQpXQ0EgSUQgly...` au lieu de "WCA ID # 58596 -- IOR service + Dest. Air custom Clearance..."

## Probleme secondaire

Le `CollapsibleContent` (vue etendue au clic sur l'oeil) affiche seulement 200 chars supplementaires. L'utilisateur ne peut pas lire l'email complet pour identifier la demande.

## Correction : 2 fichiers

### 1. `src/lib/email/extractPlainTextFromMime.ts`

**Changement** : dans le bloc Base64 (ligne 22-46), extraire uniquement la portion de Base64 valide avant le premier caractere non-Base64, au lieu de prendre un chunk fixe de 8000.

Remplacer le bloc :
```typescript
const stripped = rawBody.replace(/[\s\r\n]/g, '');
const looksLikeBase64 = /^[A-Za-z0-9+/=]{40,}$/.test(stripped.slice(0, 200));

if (looksLikeBase64) {
  try {
    const safeChunk = stripped.slice(0, Math.floor(Math.min(stripped.length, 8000) / 4) * 4);
    const decoded = decodeURIComponent(escape(atob(safeChunk)));
```

par :
```typescript
const stripped = rawBody.replace(/[\s\r\n]/g, '');
const looksLikeBase64 = /^[A-Za-z0-9+/=]{40,}$/.test(stripped.slice(0, 200));

if (looksLikeBase64) {
  try {
    // Extract only the leading valid Base64 portion (stop at first non-Base64 char like - or _)
    const b64Match = stripped.match(/^[A-Za-z0-9+/=]+/);
    const validB64 = b64Match ? b64Match[0] : stripped;
    const maxLen = Math.min(validB64.length, 8000);
    const safeChunk = validB64.slice(0, Math.floor(maxLen / 4) * 4);
    const decoded = decodeURIComponent(escape(atob(safeChunk)));
```

**Pourquoi** : pour l'email `8ea0ad65`, `b64Match[0]` retourne les ~4300 premiers caracteres valides (avant le `--_000_`). `atob()` recoit du Base64 propre et decode "WCA ID # 58596..." correctement.

### 2. `src/components/QuotationRequestCard.tsx`

**Changement** : remplacer le `CollapsibleContent` qui affiche 200 chars par une vue scrollable affichant le contenu complet (jusqu'a 4000 chars).

Remplacer le bloc CollapsibleContent (lignes 182-188) :
```tsx
<CollapsibleContent>
  <div className="mt-3 text-sm text-muted-foreground bg-muted/30 p-3 rounded-md">
    {cleanText
      ? `${preview}${isTruncated ? '...' : ''}`
      : 'Aucun contenu disponible'}
  </div>
</CollapsibleContent>
```

par :
```tsx
<CollapsibleContent>
  <div className="mt-3 text-sm text-muted-foreground bg-muted/30 p-3 rounded-md max-h-64 overflow-y-auto whitespace-pre-wrap">
    {cleanText || 'Aucun contenu disponible'}
  </div>
</CollapsibleContent>
```

**Pourquoi** : affiche le texte complet (jusqu'a 4000 chars) dans une zone scrollable de 256px max, avec `whitespace-pre-wrap` pour respecter les retours a la ligne de l'email original.

## Ce qui ne change PAS

- Parsing MIME multipart (lignes 52-144) : inchange
- Nettoyage HTML : inchange
- Decodage quoted-printable : inchange
- Logique metier, pricing, navigation : aucun impact
- Aucune migration DB
- Aucune edge function

## Resultat attendu

- Carte 1 (`8ea0ad65`) : affiche "WCA ID # 58596 -- IOR service + Dest. Air custom Clearance..." au lieu du Base64 brut
- Vue etendue (oeil) : affiche le contenu complet de l'email dans une zone scrollable
- Tous les emails deja fonctionnels : aucune regression
