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
}

/** Keep stored evidence authoritative: a stale proof must still block, not be
 * silently replaced by a fresh interpretation during pricing.
 */
export async function resolvePricingGoodsEvidence(
  stored: unknown, clientEmail: string | null, emails: readonly PricingGoodsEmail[],
): Promise<ImoGoodsAssessment | undefined> {
  if (stored !== undefined) {
    if (!stored || typeof stored !== "object") throw new Error("IMO goods evidence invalid");
    const evidence = stored as ImoGoodsAssessment;
    if (evidence.version !== 1 || !Array.isArray(evidence.groups) ||
        !Array.isArray(evidence.reasons) || !["BOUND", "REVIEW"].includes(evidence.status)) {
      throw new Error("IMO goods evidence invalid");
    }
    return evidence;
  }
  const sources = emails.filter(e => {
    const domain = String(e.from_address).trim().toLowerCase().split("@")[1];
    return domain !== "sodatra.sn" && domain !== "sodatra.com";
  }).map(e => {
    const raw = e.body_text || "";
    const body = extractPlainTextFromMime(raw);
    const base64Prefix = raw.replace(/\s/g, "").match(/^[A-Za-z0-9+/=]{40,}/)?.[0];
    const opaque = body === raw.slice(0, 4000) && (
      !!base64Prefix ||
      /content-transfer-encoding:|boundary=/i.test(raw)
    );
    const unreadable = body.includes("\uFFFD") || [...body].some(c =>
      c.charCodeAt(0) < 32 && !["\t", "\r", "\n"].includes(c));
    return {
      id: e.id, body,
      complete: !!body.trim() && body.length < 4000 && !opaque && !unreadable &&
        (!base64Prefix || base64Prefix.length <= 8000),
      trustedClient: !!clientEmail && String(e.from_address).trim().toLowerCase() === clientEmail.trim().toLowerCase(),
    };
  });
  let assessment = recognizeImoGoods(sources);
  // An unreadable or truncated inbound body cannot prove absence of IMO.
  if (sources.some(s => !s.complete)) {
    assessment = {
      ...(assessment ?? { version: 1, groups: [], pricingBlocked: true }),
      status: "REVIEW",
      reasons: [...new Set([...(assessment?.reasons ?? []), "INCOMPLETE_EMAIL_SOURCE"])].sort(),
    };
  }
  if (!assessment) return undefined;
  return { ...assessment, sourceFingerprint: await imoGoodsSourceFingerprint(clientEmail, emails) };
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
