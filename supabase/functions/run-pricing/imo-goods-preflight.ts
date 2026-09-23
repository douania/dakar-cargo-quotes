/**
 * Read-only IMO preflight for old cases that have no puzzle evidence yet.
 * No fact, gap, timeline or tariff writes. Never infer client identity.
 */
import {
  recognizeImoGoods, imoGoodsSourceFingerprint, type ImoGoodsAssessment,
} from "../_shared/imo-goods-recognition.ts";

export interface PricingGoodsEmail extends Record<string, unknown> {
  id: string;
  from_address: string;
  body_text: string | null;
  /** Truncation signal only; absent on older rows and callers. Never scanned. */
  body_html?: string | null;
}

// Ingestion HTML caps, in UTF-16 code units (String.substring): sync-emails
// MAX_BODY_HTML and hydrate-email-body MAX_FULL_BODY_HTML. Both importers derive
// body_text from the already truncated HTML, so its text may have lost its end
// whatever its own length. import-thread stores HTML uncapped.
const INGESTION_HTML_CAPS = [100_000, 1_000_000];
function htmlAtIngestionCap(html: unknown): boolean {
  return typeof html === "string" &&
    (INGESTION_HTML_CAPS.includes(html.length) || html.length > INGESTION_HTML_CAPS[1]);
}
function withIncompleteSource(assessment: ImoGoodsAssessment | null): ImoGoodsAssessment {
  return {
    ...(assessment ?? { version: 1, groups: [], pricingBlocked: true }),
    status: "REVIEW",
    reasons: [...new Set([...(assessment?.reasons ?? []), "INCOMPLETE_EMAIL_SOURCE"])].sort(),
  };
}

/** Keep stored evidence authoritative: a stale proof must still block, not be
 * silently replaced by a fresh interpretation during pricing.
 */
export async function resolvePricingGoodsEvidence(
  stored: unknown, clientEmail: string | null, emails: readonly PricingGoodsEmail[],
): Promise<ImoGoodsAssessment | undefined> {
  const inbound = emails.filter(e => {
    const domain = String(e.from_address).trim().toLowerCase().split("@")[1];
    return domain !== "sodatra.sn" && domain !== "sodatra.com";
  });
  const truncatedHtml = inbound.some(e => htmlAtIngestionCap(e.body_html));
  if (stored !== undefined) {
    if (!stored || typeof stored !== "object") throw new Error("IMO goods evidence invalid");
    const evidence = stored as ImoGoodsAssessment;
    if (evidence.version !== 1 || !Array.isArray(evidence.groups) ||
        !Array.isArray(evidence.reasons) || !["BOUND", "REVIEW"].includes(evidence.status)) {
      throw new Error("IMO goods evidence invalid");
    }
    // Stricter only: the stored proof is kept (fingerprint included), never refreshed.
    return truncatedHtml ? withIncompleteSource(evidence) : evidence;
  }
  const sources = inbound.map(e => {
    const raw = e.body_text || "";
    const trustedClient = !!clientEmail && String(e.from_address).trim().toLowerCase() === clientEmail.trim().toLowerCase();
    // Text derived from a truncated HTML body: scan what is left, never complete.
    if (htmlAtIngestionCap(e.body_html)) {
      return { id: e.id, body: extractFullPlainText(raw) ?? extractPlainTextFromMime(raw), complete: false, trustedClient };
    }
    const body = extractPlainTextFromMime(raw);
    const base64Prefix = raw.replace(/\s/g, "").match(/^[A-Za-z0-9+/=]{40,}/)?.[0];
    const opaque = body === raw.slice(0, 4000) && (
      !!base64Prefix ||
      /content-transfer-encoding:|boundary=/i.test(raw)
    );
    const unreadable = body.includes("\uFFFD") || [...body].some(c =>
      c.charCodeAt(0) < 32 && !["\t", "\r", "\n"].includes(c));
    if (!!body.trim() && body.length < 4000 && !opaque && !unreadable && !atIngestionCap(raw) &&
        !mimeBoundaries(raw).undeclared &&
        (!base64Prefix || base64Prefix.length <= 8000)) return { id: e.id, body, complete: true, trustedClient };
    // GO CTO 2026-09-23: the 4 000-character decoder window alone is not a
    // danger signal. Re-read the whole body; only an undecodable or masked
    // body stays incomplete. An empty body carries no mention to recognize.
    const full = extractFullPlainText(raw);
    return full === null ? { id: e.id, body, complete: false, trustedClient }
      : { id: e.id, body: full, complete: true, trustedClient };
  });
  let assessment = recognizeImoGoods(sources);
  // An undecodable or masked inbound body cannot prove absence of IMO.
  if (sources.some(s => !s.complete)) assessment = withIncompleteSource(assessment);
  if (!assessment) return undefined;
  return { ...assessment, sourceFingerprint: await imoGoodsSourceFingerprint(clientEmail, emails) };
}

function decodeBytes(binary: string, charset: string): string {
  if ([...binary].some(c => c.charCodeAt(0) > 0xff)) return binary;
  let decoder: TextDecoder;
  try { decoder = new TextDecoder(charset); } catch { decoder = new TextDecoder(); }
  return decoder.decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
}
/** Linear on whole bodies: unclosed <style>/<script> or stray "<" must not
 * rescan to the end of a large body (Edge CPU budget).
 */
function stripHtml(html: string): string {
  const lower = html.toLowerCase();
  const open = /<(style|script)\b[^<>]*>/gi;
  let kept = "";
  let position = 0;
  for (let m = open.exec(html); m; m = open.exec(html)) {
    const close = lower.indexOf(`</${m[1].toLowerCase()}>`, open.lastIndex);
    if (close < 0) break;
    kept += html.slice(position, m.index);
    position = open.lastIndex = close + m[1].length + 3;
  }
  return (kept + html.slice(position))
    .replace(/<[^<>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    // Same flattening as the frozen decoder: HTML layout never yields bindable rows.
    .replace(/\s+/g, " ").trim();
}
/** Binary or mostly undecodable payloads can mask an ONU mention. */
function readableText(text: string): boolean {
  if ([...text].some(c => c.charCodeAt(0) < 32 && !["\t", "\n", "\v", "\f", "\r"].includes(c))) return false;
  return (text.match(/\uFFFD/g)?.length ?? 0) * 20 <= text.length;
}
// Ingestion caps (sync-emails MAX_BODY_TEXT, hydrate-email-body MAX_FULL_BODY_TEXT):
// a body stored at a cap may have been cut, so its end is unknown.
const INGESTION_TEXT_CAPS = [50_000, 500_000];
function atIngestionCap(raw: string): boolean {
  return INGESTION_TEXT_CAPS.includes(raw.length) || raw.length > INGESTION_TEXT_CAPS[1];
}

/** Declared boundaries, plus delimiters of a stored BODY[TEXT] whose top-level
 * Content-Type header (and so the outer boundary declaration) is absent.
 */
function mimeBoundaries(raw: string) {
  const declared = new Set([...raw.matchAll(/boundary="?([^"\s;]+)"?/gi)].map(m => m[1]));
  const all = new Set([...declared, ...[...raw.matchAll(/^--(\S+)\r?\n(?=content-)/gim)].map(m => m[1])]);
  return { boundaries: [...all].sort((a, b) => b.length - a.length), undeclared: all.size > declared.size };
}

/** Whole-body text for the IMO scan, without the 4 000-character window.
 * Returns null when the body cannot be decoded completely (fail closed).
 * Attachments and non-text parts stay outside coverage, as in the puzzle.
 */
export function extractFullPlainText(raw: string): string | null {
  if (!raw.trim()) return "";
  if (atIngestionCap(raw)) return null;
  const { boundaries } = mimeBoundaries(raw);
  if (boundaries.length) {
    // A missing closing delimiter means a truncated body.
    if (boundaries.some(b => !raw.includes(`--${b}--`))) return null;
    const plain: string[] = [];
    const html: string[] = [];
    let textParts = 0;
    const delimiter = new RegExp(boundaries.map(b => "--" + b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"));
    for (const part of raw.split(delimiter)) {
      const split = part.search(/\r?\n\r?\n/);
      if (split < 0) continue;
      const headers = part.slice(0, split).replace(/\r?\n[ \t]+/g, " ").toLowerCase();
      const type = headers.match(/content-type:\s*([^;\s]+)/)?.[1];
      if ((type !== "text/plain" && type !== "text/html") || /content-disposition:\s*attachment/.test(headers)) continue;
      textParts++;
      const encoding = headers.match(/content-transfer-encoding:\s*([^;\s]+)/)?.[1] ?? "7bit";
      const charset = headers.match(/charset="?([^"\s;]+)"?/)?.[1] ?? "utf-8";
      const content = part.slice(split).trim();
      let text: string;
      if (encoding === "base64") {
        const b64 = content.replace(/\s/g, "");
        if (b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return null;
        try { text = decodeBytes(atob(b64), charset); } catch { return null; }
      } else if (encoding === "quoted-printable") {
        text = decodeBytes(content.replace(/=\r?\n/g, "")
          .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))), charset);
      } else if (["7bit", "8bit", "binary"].includes(encoding)) text = content;
      else return null;
      (type === "text/plain" ? plain : html).push(type === "text/html" ? stripHtml(text) : text);
    }
    if (!textParts) return null;
    const text = (plain.join("").trim() ? plain : html).join("\n");
    return readableText(text) ? text : null;
  }
  if (/content-transfer-encoding:/i.test(raw)) return null;
  // Raw base64 body, whatever its line width: consecutive space-free base64
  // lines totalling 40 characters or more, as the frozen decoder's threshold.
  const lines = raw.trim().split(/\r?\n/).map(line => line.trim());
  let end = 0;
  while (end < lines.length && /^[A-Za-z0-9+/=]+$/.test(lines[end])) end++;
  const run = lines.slice(0, end).join("");
  if (run.length < 40) {
    const text = /<(?:html|body|div|table|td|p|br|span)\b/i.test(raw) ? stripHtml(raw) : raw;
    return readableText(text) ? text : null;
  }
  if (run.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(run)) return null;
  let text: string;
  try { text = decodeBytes(atob(run), "utf-8"); } catch { return null; }
  if (/<html|<body|<div/.test(text)) text = stripHtml(text);
  // Anything after the encoded run is scanned too, never discarded.
  const tail = lines.slice(end).join("\n").trim();
  // A further encoded block in the tail, whatever its line width, would be
  // scanned undecoded: fail closed, with the same detection as the leading run.
  let encodedRun = 0;
  for (const line of lines.slice(end)) {
    encodedRun = /^[A-Za-z0-9+/=]+$/.test(line) ? encodedRun + line.length : 0;
    if (encodedRun >= 40) return null;
  }
  if (tail) text += "\n" + tail;
  return readableText(text) ? text : null;
}

// Frozen puzzle decoder copied without alteration into this pricing-local module.
// A parity test prevents drift; no import of an Edge handler (Deno.serve side effects).
export function extractPlainTextFromMime(rawBody: string): string {
  if (!rawBody) return "";

  // 1. No MIME boundary → if the body is raw base64 (no MIME headers), decode it;
  //    otherwise return the truncated raw text unchanged. (EDGE-MIME-BASE64-FALLBACK-1:
  //    ported from src/lib/email/extractPlainTextFromMime.ts; Deno-native TextDecoder.)
  const boundaryMatch = rawBody.match(/boundary="?([^"\s;]+)"?/i);
  if (!boundaryMatch) {
    const stripped = rawBody.replace(/[\s\r\n]/g, "");
    const looksLikeBase64 = /^[A-Za-z0-9+/=]{40,}$/.test(stripped.slice(0, 200));

    if (looksLikeBase64) {
      try {
        // Keep only the leading valid base64 run (stop at first non-base64 char like - or _),
        // aligned to 4-char blocks so atob never fails on a mid-stream truncation.
        const b64Match = stripped.match(/^[A-Za-z0-9+/=]+/);
        const validB64 = b64Match ? b64Match[0] : stripped;
        const maxLen = Math.min(validB64.length, 8000);
        const safeChunk = validB64.slice(0, Math.floor(maxLen / 4) * 4);
        const bin = atob(safeChunk);
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        const decoded = new TextDecoder().decode(bytes);

        // If the decoded payload is HTML, strip tags and simple entities.
        if (decoded.includes("<html") || decoded.includes("<body") || decoded.includes("<div")) {
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
            .trim()
            .slice(0, 4000);
        }
        return decoded.slice(0, 4000);
      } catch {
        // Not valid base64 → fall through to raw truncation (unchanged behaviour).
      }
    }

    return rawBody.slice(0, 4000);
  }

  const boundary = boundaryMatch[1];
  const parts = rawBody.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'));

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
    if (headers.includes("content-type: image/") || headers.includes("content-type:image/")) {
      continue;
    }

    const isBase64 = headers.includes("content-transfer-encoding: base64") ||
                     headers.includes("content-transfer-encoding:base64");
    const isQP = headers.includes("content-transfer-encoding: quoted-printable") ||
                 headers.includes("content-transfer-encoding:quoted-printable");
    const isPlain = headers.includes("content-type: text/plain") || headers.includes("content-type:text/plain");
    const isHtml = headers.includes("content-type: text/html") || headers.includes("content-type:text/html");

    if (isPlain) {
      if (isBase64) {
        try {
          // Remove whitespace from base64 content before decoding
          const cleaned = content.replace(/\s/g, "");
          plainText = atob(cleaned);
        } catch {
          plainText = "";
        }
      } else if (isQP) {
        plainText = content
          .replace(/=\r?\n/g, "")
          .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
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
          .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
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
  return result.slice(0, 4000); // Global guard (CTO Correction 2)
}
