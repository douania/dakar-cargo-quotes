type Row = Record<string, unknown>;
/** Reuse an existing case identity, never infer one from arbitrary email senders. */
export function proposalClient(threadClient: unknown, facts: Row[]): { email: string | null; source: string; reason?: string } {
  const mailbox = (v: unknown): string | null => typeof v === "string" && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(v.trim()) ? v.trim().toLowerCase() : null;
  const present = (v: unknown) => v !== null && v !== undefined && v !== "";
  const rows = facts.filter(f => f.fact_key === "contacts.client_email");
  const values = rows.flatMap(f => {
    const scalar = [f.value_text, f.value_number, f.value_json].filter(v => present(v) && typeof v !== "object");
    return scalar.length ? scalar : [f.value_json].filter(present);
  });
  const normalized = values.map(mailbox);
  const thread = mailbox(threadClient);
  if ((present(threadClient) && !thread) || normalized.some(v => !v) || new Set(normalized).size > 1 ||
    (thread && normalized.some(v => v !== thread))) return { email: null, source: "unverified", reason: "CLIENT_IDENTITY_CONFLICT" };
  return { email: thread ?? normalized[0] ?? null, source: thread ? "email_thread" : normalized.length ? "case_contact_fact" : "unverified" };
}

/** No rendering/network: HTML is only corroboration for a header-stripped legacy alternative. */
function legacyAlternativeText(raw: string): string | null | undefined {
  const boundaries = [...raw.matchAll(/^--[A-Za-z0-9'()+_,./:=?-]{1,70}[ \t]*\r?$/gm)];
  if (!boundaries.length) return undefined;
  const first = raw.slice(0, boundaries[0].index).trim();
  // An ordinary message with a signature separator must retain its existing path.
  if (!first || !/^[A-Za-z0-9+/=\r\n]+$/.test(first)) return undefined;
  const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  if (!base64.test(first.replace(/\r?\n/g, ""))) return undefined;
  try {
    if (boundaries.length !== 1) throw new Error("LEGACY_PARTS");
    const decode = (part: string) => {
      const compact = part.trim().replace(/\r?\n/g, "");
      if (!compact || !base64.test(compact)) throw new Error("LEGACY_BASE64");
      const bytes = atob(compact);
      if (btoa(bytes) !== compact) throw new Error("LEGACY_NONCANONICAL");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes, c => c.charCodeAt(0)));
      const binary = [...text].some(c => { const n = c.codePointAt(0)!; return (n < 32 && ![9, 10, 13].includes(n)) || (n >= 127 && n <= 159) || n === 0xfffd; });
      if (binary || /\[(?:truncated|tronqu[ée])/i.test(text)) throw new Error("LEGACY_TEXT");
      return text;
    };
    const plain = decode(first);
    const html = decode(raw.slice(boundaries[0].index! + boundaries[0][0].length));
    if (/<\/?[a-z][^>]*>/i.test(plain.replace(/<https?:\/\/[^<>\s]+\s*>/gi, ""))) throw new Error("LEGACY_NOT_PLAIN");
    if (!/^\s*<(?:html|body|div|p)\b/i.test(html)) throw new Error("LEGACY_NOT_HTML");
    const stack: string[] = [];
    const allowed = new Set(["html", "body", "div", "p", "span", "b", "strong", "i", "em", "u", "a", "h1", "h2", "h3", "h4", "h5", "h6", "table", "tbody", "thead", "tr", "td", "th", "ul", "ol", "li", "br", "hr", "img"]);
    let visible = "";
    let pos = 0;
    const tagPattern = /<\/?([a-z][a-z0-9]*)(?:[^<>"']|"[^"]*"|'[^']*')*>/iy;
    while (pos < html.length) {
      if (html[pos] !== "<") {
        const end = html.indexOf("<", pos);
        visible += html.slice(pos, end < 0 ? html.length : end);
        pos = end < 0 ? html.length : end;
        continue;
      }
      tagPattern.lastIndex = pos;
      const tag = tagPattern.exec(html);
      if (!tag || !allowed.has(tag[1].toLowerCase())) throw new Error("LEGACY_HTML_TAG");
      const name = tag[1].toLowerCase();
      if (tag[0].startsWith("</")) {
        if (!/^<\/[a-z][a-z0-9]*\s*>$/i.test(tag[0]) || stack.pop() !== name) throw new Error("LEGACY_HTML_BALANCE");
      } else if (["img", "br", "hr"].includes(name)) {
        // Text-only proposal, not an exhaustive attachment inventory (existing UI warning).
        // Ignore pixels without claiming to have read them; differing alt text cannot corroborate.
        if (name === "img" && /\balt\s*=\s*(?!""|'')(?:"[^"]+"|'[^']+'|[^\s>]+)/i.test(tag[0])) throw new Error("LEGACY_IMAGE_ALT");
      } else {
        if (/\/\s*>$/.test(tag[0])) throw new Error("LEGACY_HTML_BALANCE");
        stack.push(name);
      }
      pos += tag[0].length;
    }
    if (stack.length) throw new Error("LEGACY_HTML_INCOMPLETE");
    const entities: Record<string, string> = { amp: "&", nbsp: " ", lt: "<", gt: ">", quot: '"', apos: "'" };
    visible = visible.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (_, entity: string) => {
      if (entity.startsWith("#")) {
        const point = /^#x/i.test(entity) ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
        if (point < 32 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff) || point === 0xfffd) throw new Error("LEGACY_ENTITY");
        return String.fromCodePoint(point);
      }
      if (!(entity in entities)) throw new Error("LEGACY_ENTITY");
      return entities[entity];
    });
    // Only presentational differences: wrapping, separator length and duplicated rendered URL.
    const comparable = (s: string) => s.replace(/(https?:\/\/[^\s<>]+)\s*<\1\s*>/g, "$1").replace(/[-_]{5,}/g, "").replace(/\s/g, "");
    if (!comparable(plain) || comparable(plain) !== comparable(visible)) throw new Error("LEGACY_ALTERNATIVES_DIFFER");
    return plain; // Entire original text part, never reconstructed cargo or stripped history.
  } catch { return null; }
}

/** Complete text/plain MIME or corroborated legacy alternatives; no attachment/HTML guessing. */
export function proposalPlainBody(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 100000 || /\uFFFD|\[(?:truncated|tronqu[ée])/i.test(raw)) return null;
  if (!/^(?:MIME-Version|Content-Type|Content-Transfer-Encoding):/im.test(raw)) {
    const legacy = legacyAlternativeText(raw);
    return legacy !== undefined ? legacy : /<html\b|boundary=/i.test(raw) ? null : raw;
  }
  try {
    const read = (part: string, depth: number): string[] => {
      if (depth > 4) throw new Error("MIME_DEPTH");
      const match = part.match(/\r?\n\r?\n/);
      if (!match || match.index === undefined) throw new Error("MIME_HEADERS");
      const head = part.slice(0, match.index).replace(/\r?\n[ \t]+/g, " ");
      const payload = part.slice(match.index + match[0].length);
      const headers = (name: string) => [...head.matchAll(new RegExp(`^${name}:([^\\r\\n]*)`, "gim"))].map(m => m[1].trim());
      const types = headers("Content-Type"); const encodings = headers("Content-Transfer-Encoding");
      if (types.length !== 1 || encodings.length > 1) throw new Error("MIME_AMBIGUOUS");
      const type = types[0];
      if (/^attachment\b/i.test(headers("Content-Disposition")[0] ?? "")) return [];
      if (/^multipart\//i.test(type)) {
        const boundary = type.match(/boundary\s*=\s*(?:"([^"\r\n]+)"|([^;\s]+))/i);
        if (!boundary) throw new Error("MIME_BOUNDARY");
        const marker = boundary[1] ?? boundary[2];
        const lines = payload.split(/\r?\n/); let active: string[] | null = null; let closed = false; const texts: string[] = [];
        for (const line of lines) {
          if (line === `--${marker}` || line === `--${marker}--`) {
            if (closed) throw new Error("MIME_AFTER_CLOSE");
            if (active) texts.push(...read(active.join("\n"), depth + 1));
            closed = line.endsWith("--"); active = closed ? null : [];
          } else if (active) active.push(line);
        }
        if (!closed) throw new Error("MIME_INCOMPLETE");
        return texts;
      }
      if (!/^text\/plain(?:;|$)/i.test(type)) return [];
      const charset = type.match(/charset\s*=\s*"?([^";\s]+)/i)?.[1] ?? "utf-8";
      if (!/^(utf-8|us-ascii)$/i.test(charset)) throw new Error("MIME_CHARSET");
      const encoding = (encodings[0] ?? "8bit").toLowerCase();
      let text = payload;
      if (encoding === "base64") {
        const compact = payload.replace(/\s/g, "");
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)) throw new Error("MIME_BASE64");
        text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(compact), c => c.charCodeAt(0)));
      } else if (encoding === "quoted-printable") {
        const joined = payload.replace(/=\r?\n/g, ""); const bytes: number[] = [];
        for (let i = 0; i < joined.length; i++) {
          if (joined[i] === "=") {
            const hex = joined.slice(i + 1, i + 3);
            if (!/^[a-f0-9]{2}$/i.test(hex)) throw new Error("MIME_QP");
            bytes.push(parseInt(hex, 16)); i += 2;
          } else { const code = joined.charCodeAt(i); if (code > 127) throw new Error("MIME_QP_ENCODING"); bytes.push(code); }
        }
        text = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
      } else if (!["7bit", "8bit"].includes(encoding)) throw new Error("MIME_ENCODING");
      if (/\uFFFD|\[(?:truncated|tronqu[ée])/i.test(text)) throw new Error("MIME_TEXT");
      return [text];
    };
    const texts = read(raw, 0);
    return texts.length === 1 ? texts[0] : null;
  } catch { return null; }
}
