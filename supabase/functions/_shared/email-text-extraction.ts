/**
 * MULTI-CARGO-LINES-ARCHITECTURE-1 — Phase 2-Q Patch C
 * Extraction de texte lisible depuis un body_text email brut (MIME/multipart).
 *
 * Port Edge-compatible (Deno) du parseur front pur
 * src/lib/email/extractPlainTextFromMime.ts — UNIQUEMENT la logique d'extraction
 * de texte (aucune dépendance src/, aucun DOM, aucun Buffer Node).
 *
 * Garde-fous :
 *   - APIs Edge uniquement : atob, TextDecoder, regex/strings ;
 *   - aucun accès DB/réseau/I-O ;
 *   - ne lève JAMAIS : tout échec retombe sur le texte brut tronqué.
 *
 * PORTÉE : pur, en mémoire. Aucune écriture. Utilisé pour le preview de
 * dérivation cargo (derive-cargo-canonical-payload), jamais pour réécrire la DB.
 */

const MAX_OUTPUT_LEN = 4000;

/** Décodage base64 → UTF-8 sûr (atob + TextDecoder, sans Buffer). Ne lève jamais. */
function base64ToUtf8(b64: string): string {
  if (typeof atob !== "function") return "";
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/** Décodage quoted-printable (soft line breaks + =HH). */
function decodeQuotedPrintable(content: string): string {
  return content
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16))
    );
}

/** Strip des balises HTML + décodage des entités courantes. */
function stripHtml(decoded: string): string {
  return decoded
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

/**
 * Extrait le texte lisible d'un body MIME brut. Retourne au plus MAX_OUTPUT_LEN
 * caractères. Ne lève jamais ; en dernier recours, renvoie le brut tronqué.
 *
 * Gère :
 *   - MIME multipart avec déclaration de boundary ;
 *   - parties text/plain et text/html (HTML strippé si pas de texte brut) ;
 *   - Content-Transfer-Encoding base64 et quoted-printable ;
 *   - parties image/* ignorées ;
 *   - MIME aux newlines d'en-tête perdus (normalisation tolérante) ;
 *   - corps sans boundary mais base64 pur.
 */
export function extractPlainTextFromMime(rawBody: string): string {
  if (!rawBody) return "";

  // Normalisation MIME tolérante : restaure des newlines dans les contextes
  // d'en-tête lorsque le stockage a aplati les retours à la ligne.
  const body = rawBody
    .replace(/(boundary="[^"]+")\s+(Content-Type:)/gi, "$1\n$2")
    .replace(/\s+(Content-Transfer-Encoding:)/gi, "\n$1")
    .replace(
      /Content-Transfer-Encoding:\s*(base64|quoted-printable)\s+/gi,
      "Content-Transfer-Encoding: $1\n\n",
    );

  // 1. Pas de boundary MIME → tester base64 pur, sinon renvoyer le brut tronqué.
  const boundaryMatch = body.match(/boundary="?([^"\s;]+)"?/i);
  if (!boundaryMatch) {
    const stripped = body.replace(/[\s\r\n]/g, "");
    const looksLikeBase64 = /^[A-Za-z0-9+/=]{40,}$/.test(stripped.slice(0, 200));

    if (looksLikeBase64) {
      try {
        const b64Match = stripped.match(/^[A-Za-z0-9+/=]+/);
        const validB64 = b64Match ? b64Match[0] : stripped;
        const maxLen = Math.min(validB64.length, 8000);
        const safeChunk = validB64.slice(0, Math.floor(maxLen / 4) * 4);
        const decoded = base64ToUtf8(safeChunk);
        if (decoded.includes("<html") || decoded.includes("<div")) {
          return stripHtml(decoded).slice(0, MAX_OUTPUT_LEN);
        }
        return decoded.slice(0, MAX_OUTPUT_LEN);
      } catch {
        // Pas du base64 valide → on retombe sur le brut tronqué.
      }
    }

    return body.slice(0, MAX_OUTPUT_LEN);
  }

  const boundary = boundaryMatch[1];
  const parts = body.split(
    new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g"),
  );

  let plainText = "";
  let htmlText = "";

  for (const part of parts) {
    // Séparation en-têtes / corps (première ligne vide).
    const headerEnd = part.indexOf("\r\n\r\n");
    const headerEnd2 = part.indexOf("\n\n");
    const splitIdx = headerEnd !== -1 ? headerEnd : headerEnd2;
    if (splitIdx === -1) continue;

    const headers = part.slice(0, splitIdx).toLowerCase();
    const content = part.slice(splitIdx).trim();

    // Ignorer les parties image/*.
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
          plainText = base64ToUtf8(content.replace(/\s/g, ""));
        } catch {
          plainText = "";
        }
      } else if (isQP) {
        plainText = decodeQuotedPrintable(content);
      } else {
        plainText = content;
      }
    } else if (isHtml && !plainText) {
      let decoded = content;
      if (isBase64) {
        try {
          decoded = base64ToUtf8(content.replace(/\s/g, ""));
        } catch {
          decoded = "";
        }
      } else if (isQP) {
        decoded = decodeQuotedPrintable(content);
      }
      htmlText = stripHtml(decoded);
    }

    // Texte brut exploitable trouvé → inutile de continuer.
    if (plainText && plainText.length > 20) break;
  }

  // Priorité : text/plain > HTML strippé > brut tronqué.
  const result = plainText || htmlText || body.slice(0, MAX_OUTPUT_LEN);
  return result.slice(0, MAX_OUTPUT_LEN);
}
