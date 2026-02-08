

# Phase P1 -- CTO-Validated MIME Normalization Fix

## Problem

The `body_text` in the database has zero `\n` characters (503K chars on a single line). The existing parser correctly splits by boundary but then fails to find the header/body separator (`\n\n`), causing every MIME part to be skipped. Result: raw MIME noise displayed to the user.

## Fix (single file, 3 lines added)

**File: `src/lib/email/extractPlainTextFromMime.ts`**

Insert a normalization block between line 7 (`if (!rawBody) return "";`) and line 9 (`const boundaryMatch = ...`).

### Exact diff

```diff
 export function extractPlainTextFromMime(rawBody: string): string {
   if (!rawBody) return "";

+  // Normalize space-separated MIME: restore newlines only in MIME header contexts
+  rawBody = rawBody
+    // Restore newline before Content-Type only after boundary declarations
+    .replace(/(boundary="[^"]+")\s+(Content-Type:)/gi, '$1\n$2')
+    // Restore newline before encoding headers
+    .replace(/\s+(Content-Transfer-Encoding:)/gi, '\n$1')
+    // Restore header/body split after encoding declaration
+    .replace(/Content-Transfer-Encoding:\s*(base64|quoted-printable)\s+/gi,
+      'Content-Transfer-Encoding: $1\n\n');
+
   // 1. No MIME boundary -> return truncated raw
   const boundaryMatch = rawBody.match(/boundary="?([^"\s;]+)"?/i);
```

### What stays untouched

- All existing parsing logic (boundary split, header detection, base64 decode)
- `try/catch` around every `atob()` call
- `.slice(0, 4000)` global guard
- All fallbacks (plainText > htmlText > raw truncated)
- No other files modified

## Why this is safer than the original proposal

| Original regex | Risk | CTO-corrected regex | Risk |
|---|---|---|---|
| `/ (Content-Type:)/gi` | Matches inside body text | `/(boundary="[^"]+")\s+(Content-Type:)/gi` | Only after boundary declaration |
| `/(base64\|quoted-printable) /gi` | Matches "base64" in normal prose | `/Content-Transfer-Encoding:\s*(base64\|quoted-printable)\s+/gi` | Only in CTE header context |
| `/ (Content-Transfer-Encoding:)/gi` | Broad match | `/\s+(Content-Transfer-Encoding:)/gi` | Slightly narrower, acceptable |

## Expected result

"Email original" section displays clean decoded text instead of raw MIME/base64 blocks.

