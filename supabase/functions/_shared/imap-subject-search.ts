import { quoteImapString } from "./mailbox-secret.ts";

// Fixed budgets: no unbounded header scan, even when the caller supplies a large limit.
export const SUBJECT_SEARCH_BUDGET = 200;
export function boundedSearchLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error("Limite de recherche invalide");
  }
  return Math.min(value, SUBJECT_SEARCH_BUDGET);
}

function decodeWord(charset: string, encoding: string, payload: string): string | null {
  try {
    let bytes: Uint8Array;
    if (encoding.toUpperCase() === "B") {
      const binary = atob(payload);
      bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    } else {
      const values: number[] = [];
      for (let i = 0; i < payload.length; i++) {
        if (payload[i] === "_") values.push(32);
        else if (payload[i] === "=") {
          const hex = payload.slice(i + 1, i + 3);
          if (!/^[0-9a-f]{2}$/i.test(hex)) return null;
          values.push(parseInt(hex, 16));
          i += 2;
        } else {
          const byte = payload.charCodeAt(i);
          if (byte < 33 || byte > 126) return null;
          values.push(byte);
        }
      }
      bytes = new Uint8Array(values);
    }
    return new TextDecoder(charset, { fatal: true }).decode(bytes);
  } catch {
    // Unsupported charset / malformed word stays visible, never a fabricated match.
    return null;
  }
}

/** RFC2047 Q/B octets decoded with their charset; only adjacent valid words lose folding whitespace. */
export function decodeSearchHeader(value: string): string {
  let result = "", cursor = 0, previousDecoded = false;
  const pattern = /=\?([^?\s]+)\?([BQ])\?([^?\r\n]*)\?=/gi;
  for (const match of value.matchAll(pattern)) {
    const decoded = decodeWord(match[1], match[2], match[3]);
    const between = value.slice(cursor, match.index);
    result += previousDecoded && decoded !== null && /^[ \t\r\n]*$/.test(between) ? "" : between;
    result += decoded ?? match[0];
    cursor = match.index + match[0].length;
    previousDecoded = decoded !== null;
  }
  return (result + value.slice(cursor)).replace(/\r?\n[ \t]+/g, " ");
}

export function normalizedSearchSubject(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

export function subjectMatches(subject: string, query: string): boolean {
  const needle = normalizedSearchSubject(query);
  return needle.length > 0 && normalizedSearchSubject(subject).includes(needle);
}

/** These Q payloads are hints, not a universal encoded-word index (B and split words need the window). */
export function qSubjectCriteria(query: string): string | null {
  const natural = query.normalize("NFC").replace(/\s+/g, " ").trim();
  const payload = [...new TextEncoder().encode(natural)].map(byte => {
    if (byte >= 33 && byte <= 126 && ![61, 63, 95].includes(byte)) return String.fromCharCode(byte);
    return "=" + byte.toString(16).toUpperCase().padStart(2, "0");
  }).join("");
  const variants = [...new Set([payload.replace(/=20/g, "_"), payload])].filter(v => v !== natural);
  if (variants.length === 0) return null;
  const keys = variants.map(v => "SUBJECT " + quoteImapString(v));
  return keys.length === 1 ? keys[0] : "OR " + keys.join(" ");
}

export class ImapSearchCommandError extends Error {}
export function requireImapCommandOk(response: string, operation: string): void {
  // Only the final tagged line counts; a header literal containing OK cannot turn NO/BAD into success.
  const finalLine = response.trimEnd().split("\r\n").at(-1) ?? "";
  if (!/^[A-Za-z0-9]+ OK(?:[ \t]|$)/i.test(finalLine)) {
    throw new ImapSearchCommandError("Commande IMAP " + operation + " refusée ou réponse incomplète");
  }
}

export function parseSearchUids(response: string): number[] {
  requireImapCommandOk(response, "SEARCH");
  const line = response.split("\r\n").find(l => /^\* SEARCH(?:[ \t]|$)/i.test(l));
  if (line === undefined || !/^\* SEARCH(?:[ \t]+[1-9]\d*)*[ \t]*$/i.test(line)) {
    throw new ImapSearchCommandError("Réponse IMAP SEARCH invalide");
  }
  const ids = line.slice(8).trim().split(/\s+/).filter(Boolean).map(Number);
  if (ids.some(uid => !Number.isSafeInteger(uid) || uid < 1)) throw new ImapSearchCommandError("UID IMAP invalide");
  return [...new Set(ids)].sort((a, b) => a - b);
}

export interface SubjectCandidate { uid: number; subject: string }

/** Parse FETCH framing without treating literal contents or quoted/nested values as server attributes. */
export function searchFetchMessages(response: string): Array<{ seq: number; uid: number; headerResponse: string; metadata: string }> {
  const bytes = new TextEncoder().encode(response), decoder = new TextDecoder("utf-8", { fatal: true });
  const messages: Array<{ seq: number; uid: number; headerResponse: string; metadata: string }> = [];
  let cursor = 0;
  let current: { seq: number; metadata: string; headerResponse: string | null } | null = null;
  const finish = () => {
    if (!current) return;
    // Servers may interleave unsolicited FLAGS-only FETCH updates, including frames without UID.
    if (current.headerResponse === null) {
      if (/BODY\[HEADER/i.test(current.metadata)) throw new Error("Réponse IMAP FETCH sans en-têtes valides");
      current = null;
      return;
    }
    let depth = 0, uid: number | null = null, expectUid = false;
    const tokens = current.metadata.match(/"(?:\\.|[^"\\])*"|\[[^\]]*\]|\(|\)|[^\s()[\]"]+/g) ?? [];
    for (const token of tokens) {
      if (expectUid) {
        if (!/^[1-9]\d*$/.test(token) || !Number.isSafeInteger(Number(token)) || uid !== null) throw new Error("Attribut UID IMAP invalide");
        uid = Number(token); expectUid = false;
      } else if (token === "(") depth++;
      else if (token === ")") depth--;
      else if (depth === 1 && token.toUpperCase() === "UID") expectUid = true;
    }
    if (uid === null || expectUid || depth !== 0 || !Number.isSafeInteger(current.seq) || current.headerResponse === null) {
      throw new Error("Réponse IMAP FETCH sans UID/en-têtes valides");
    }
    messages.push({ seq: current.seq, uid, headerResponse: current.headerResponse, metadata: current.metadata });
    current = null;
  };
  while (cursor < bytes.length) {
    let end = cursor;
    while (end + 1 < bytes.length && !(bytes[end] === 13 && bytes[end + 1] === 10)) end++;
    if (end + 1 >= bytes.length) throw new Error("Ligne IMAP FETCH incomplète");
    const line = decoder.decode(bytes.subarray(cursor, end));
    cursor = end + 2;
    const start = line.match(/^\* ([1-9]\d*) FETCH \(/i);
    if (start) { finish(); current = { seq: Number(start[1]), metadata: "", headerResponse: null }; }
    else if (/^(?:\* |[A-Za-z0-9]+ (?:OK|NO|BAD)(?:[ \t]|$))/i.test(line)) finish();
    if (current) current.metadata += line + "\r\n";
    const literal = line.match(/\{(\d+)\}\s*$/);
    if (literal) {
      const count = Number(literal[1]);
      if (!Number.isSafeInteger(count) || count < 0 || cursor + count > bytes.length) throw new Error("Literal IMAP FETCH incomplet");
      if (current && /BODY\[HEADER(?:\.FIELDS[^\]]*)?\]\s*\{\d+\}\s*$/i.test(line)) {
        if (current.headerResponse !== null) throw new Error("En-têtes IMAP FETCH ambigus");
        const header = decoder.decode(bytes.subarray(cursor, cursor + count));
        current.headerResponse = "BODY[HEADER.FIELDS (SUBJECT)] {" + count + "}\r\n" + header;
      }
      cursor += count;
      // Keep framing, exclude all literal data from UID/BODYSTRUCTURE metadata parsing.
      if (current) current.metadata += " NIL ";
    }
  }
  finish();
  return messages;
}

export interface SubjectSearchTransport {
  search(criteria: string): Promise<number[]>;
  fetchSubjects(uids: number[]): Promise<SubjectCandidate[]>;
}

export async function findDecodedSubjectUids(
  client: SubjectSearchTransport,
  query: string,
  mailboxSize: number,
  limit: number,
  deepSearch = false,
) {
  const natural = query.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!natural || natural.length > 256) throw new Error("Sujet de recherche invalide (1 à 256 caractères)");
  const quoted = quoteImapString(natural);
  const normalCriteria = deepSearch ? "OR OR SUBJECT " + quoted + " BODY " + quoted + " FROM " + quoted : "SUBJECT " + quoted;
  const normal = await client.search(normalCriteria);
  const qCriteria = qSubjectCriteria(natural);
  const qCandidates = qCriteria ? await client.search(qCriteria) : [];
  // UID SEARCH's sequence-set criterion bounds this query to 200 recent messages.
  const firstSequence = Math.max(1, mailboxSize - SUBJECT_SEARCH_BUDGET + 1);
  const recent = mailboxSize > 0 ? await client.search(firstSequence + ":" + mailboxSize) : [];
  const takeRecent = (uids: number[]) => [...new Set(uids)].sort((a, b) => a - b).slice(-SUBJECT_SEARCH_BUDGET);
  const selectedNormal = takeRecent(normal), selectedQ = takeRecent(qCandidates), selectedRecent = takeRecent(recent);
  const candidateUids = [...new Set([...selectedNormal, ...selectedQ, ...selectedRecent])];
  const candidates = await client.fetchSubjects(candidateUids);
  const allowed = new Set(candidateUids), normalIds = new Set(selectedNormal);
  // Single selected mailbox/session; UID, not Message-ID or sequence number, defines identity.
  const matching = new Set(candidates.filter(m => allowed.has(m.uid) &&
    ((deepSearch && normalIds.has(m.uid)) || subjectMatches(m.subject, natural))).map(m => m.uid));
  const confirmed = [...matching].sort((a, b) => a - b);
  const resultLimit = boundedSearchLimit(limit);
  return {
    uids: confirmed.slice(-resultLimit),
    totalFound: confirmed.length,
    coverage: {
      exhaustive: false,
      totalFoundIsLowerBound: true,
      normalServerCount: normal.length,
      normalCandidatesTruncated: normal.length > selectedNormal.length,
      qServerCount: qCandidates.length,
      qCandidatesTruncated: qCandidates.length > selectedQ.length,
      recentWindowSize: SUBJECT_SEARCH_BUDGET,
      recentWindowCoversSelectedMailbox: mailboxSize <= SUBJECT_SEARCH_BUDGET,
      recentCandidatesTruncated: recent.length > selectedRecent.length,
      inspectedSubjectCount: new Set(candidates.filter(m => allowed.has(m.uid)).map(m => m.uid)).size,
      maxSubjectCandidates: 3 * SUBJECT_SEARCH_BUDGET,
      confirmedCandidateCount: confirmed.length,
      resultLimit,
      resultsTruncated: confirmed.length > resultLimit,
    },
  };
}
