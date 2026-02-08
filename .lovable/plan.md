

# Phase P1 -- Email Display Fix

## Problem

The "Email original" section (and ThreadConversationView) displays raw MIME multi-part content (base64 blocks, image data, multipart headers) instead of readable text. The existing `decodeBase64Content()` in `src/features/quotation/utils/parsing.ts` only handles pure base64 strings, not MIME-structured emails.

## Solution

Port the `extractPlainTextFromMime` helper (already working in the edge function) to a shared frontend module, then replace the inadequate `decodeBase64Content` calls in display components.

## Files to Create

### `src/lib/email/extractPlainTextFromMime.ts`

Exact copy of the deterministic helper from `supabase/functions/build-case-puzzle/index.ts` (lines 10-97), adapted for browser (atob is native). Same logic:
1. No MIME boundary? Return rawBody.slice(0, 4000)
2. Split by boundary, parse headers
3. Skip image/* parts
4. Decode base64 (try/catch) or quoted-printable for text/plain
5. Fallback to stripped HTML
6. Global .slice(0, 4000) guard

## Files to Modify

### 1. `src/pages/QuotationSheet.tsx` -- lines 1772-1778

Current:
```typescript
const decoded = decodeBase64Content(selectedEmail.body_text);
return decoded.substring(0, 2000) || 'Aucun contenu texte';
```

Replace with:
```typescript
const decoded = extractPlainTextFromMime(selectedEmail.body_text || '');
return decoded || 'Aucun contenu texte';
```

(The helper already truncates to 4000 chars, no need for substring(0, 2000).)

Add import at top of file:
```typescript
import { extractPlainTextFromMime } from '@/lib/email/extractPlainTextFromMime';
```

### 2. `src/components/ThreadConversationView.tsx` -- line 187

Current:
```typescript
{email.body_text?.slice(0, 500) || '(Aucun contenu texte)'}
```

Replace with:
```typescript
{extractPlainTextFromMime(email.body_text || '').slice(0, 500) || '(Aucun contenu texte)'}
```

Add import at top of file.

### 3. `src/pages/admin/Emails.tsx` -- lines 1286, 1322, 1449

Three display points that show raw body_text. Apply the same helper for consistency:
- Line 1286: `extractPlainTextFromMime(email.body_text || '').substring(0, 150)`
- Line 1322: `extractPlainTextFromMime(email.body_text || '').substring(0, 300)`
- Line 1449: `extractPlainTextFromMime(selectedEmail.body_text || '')`

## What Does NOT Change

- No edge function modifications
- No database schema changes
- No migration SQL
- No AI prompt changes
- No auth/security changes
- No quote_facts / quote_cases logic
- No pricing logic
- `decodeBase64Content` remains in parsing.ts (used elsewhere for non-display purposes)

## Expected Result

In the "Email original" section of `/quotation/[id]`, the user sees:
```
Dear team,
Nice day,
Here is an enquiry from AIO (Shanghai)...
Pieces: 6 crates
Volume: 3 cbm
Weight: 3234 kg
Term: DAP
```

Instead of raw MIME/base64 noise.

