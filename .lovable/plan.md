
# Fix : Decodage MIME dans QuotationRequestCard

## Diagnostic confirme

Le `body_text` contient du MIME brut (Base64). La fonction `extractPlainTextFromMime` existe deja dans le projet et est utilisee dans `ThreadConversationView`, `QuotationSheet`, etc. Elle n'est simplement pas appelee dans `QuotationRequestCard`.

## Fichier unique : `src/components/QuotationRequestCard.tsx`

### Modification 1 -- Ligne 3 : Ajouter l'import

```text
// Apres la ligne 3 (import fr from date-fns/locale)
import { extractPlainTextFromMime } from '@/lib/email/extractPlainTextFromMime';
```

### Modification 2 -- Ligne 86 : Decoder avant de nettoyer

```text
// Avant
const cleanText = request.body_text?.replace(/\s+/g, ' ').trim() || '';

// Apres
const decodedText = extractPlainTextFromMime(request.body_text || '') || '';
const cleanText = decodedText.replace(/\s+/g, ' ').trim();
```

## Impact

- 1 fichier modifie
- 1 import ajoute, 1 ligne remplacee par 2 lignes
- Aucune migration DB
- Aucune edge function modifiee
- Aucun changement de logique metier ou de navigation
- Coherent avec l'usage existant dans `ThreadConversationView` (ligne 171) et `QuotationSheet`

## Ce qui ne change PAS

- Composant `Collapsible` et bouton oeil : inchanges
- Preview tronquee a 200 caracteres : inchange
- Logique de tri, filtrage, navigation : intacts
- Extraction de donnees (badges cargo/origin/incoterm) : intacte
