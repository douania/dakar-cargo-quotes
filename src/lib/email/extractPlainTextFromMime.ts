/**
 * Phase P1: Extract readable plain text from raw MIME email body.
 * Ported from supabase/functions/build-case-puzzle/index.ts (lines 10-97).
 * Browser-native: uses atob() directly.
 */
export function extractPlainTextFromMime(rawBody: string): string {
  if (!rawBody) return "";

  // Normalize space-separated MIME: restore newlines only in MIME header contexts
  rawBody = rawBody
    // Restore newline before Content-Type only after boundary declarations
    .replace(/(boundary="[^"]+")\s+(Content-Type:)/gi, '$1\n$2')
    // Restore newline before encoding headers
    .replace(/\s+(Content-Transfer-Encoding:)/gi, '\n$1')
    // Restore header/body split after encoding declaration
    .replace(/Content-Transfer-Encoding:\s*(base64|quoted-printable)\s+/gi,
      'Content-Transfer-Encoding: $1\n\n');

  // 1. No MIME boundary → check if it's pure Base64, else return truncated raw
  const boundaryMatch = rawBody.match(/boundary="?([^"\s;]+)"?/i);
  if (!boundaryMatch) {
    const stripped = rawBody.replace(/[\s\r\n]/g, '');
    const looksLikeBase64 = /^[A-Za-z0-9+/=]{40,}$/.test(stripped.slice(0, 200));

    if (looksLikeBase64) {
      try {
        const decoded = decodeURIComponent(escape(atob(stripped)));
        // If decoded looks like HTML, strip tags
        if (decoded.includes('<html') || decoded.includes('<div')) {
          return decoded
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>').replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 4000);
        }
        return decoded.slice(0, 4000);
      } catch {
        // Not valid Base64, fall through
      }
    }

    return rawBody.slice(0, 4000);
  }

  const boundary = boundaryMatch[1];
  const parts = rawBody.split(
    new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g")
  );

  let plainText = "";
  let htmlText = "";

  for (const part of parts) {
    // Parse headers (first blank line separates headers from body)
    const headerEnd = part.indexOf("\r\n\r\n");
    const headerEnd2 = part.indexOf("\n\n");
    const splitIdx = headerEnd !== -1 ? headerEnd : headerEnd2;
    if (splitIdx === -1) continue;

    const headers = part.slice(0, splitIdx).toLowerCase();
    const content = part.slice(splitIdx).trim();

    // Skip image/* parts entirely
    if (
      headers.includes("content-type: image/") ||
      headers.includes("content-type:image/")
    ) {
      continue;
    }

    const isBase64 =
      headers.includes("content-transfer-encoding: base64") ||
      headers.includes("content-transfer-encoding:base64");
    const isQP =
      headers.includes("content-transfer-encoding: quoted-printable") ||
      headers.includes("content-transfer-encoding:quoted-printable");
    const isPlain =
      headers.includes("content-type: text/plain") ||
      headers.includes("content-type:text/plain");
    const isHtml =
      headers.includes("content-type: text/html") ||
      headers.includes("content-type:text/html");

    if (isPlain) {
      if (isBase64) {
        try {
          const cleaned = content.replace(/\s/g, "");
          plainText = atob(cleaned);
        } catch {
          plainText = "";
        }
      } else if (isQP) {
        plainText = content
          .replace(/=\r?\n/g, "")
          .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
            String.fromCharCode(parseInt(hex, 16))
          );
      } else {
        plainText = content;
      }
    } else if (isHtml && !plainText) {
      let decoded = content;
      if (isBase64) {
        try {
          decoded = atob(content.replace(/\s/g, ""));
        } catch {
          decoded = "";
        }
      } else if (isQP) {
        decoded = content
          .replace(/=\r?\n/g, "")
          .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
            String.fromCharCode(parseInt(hex, 16))
          );
      }
      // Strip HTML tags and decode entities
      htmlText = decoded
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    // If we got good plainText, no need to continue
    if (plainText && plainText.length > 20) break;
  }

  // Priority: text/plain > stripped HTML > raw truncated
  const result = plainText || htmlText || rawBody.slice(0, 4000);
  return result.slice(0, 4000); // Global guard
}
