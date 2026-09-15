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

/** Complete text/plain MIME only: no truncated extraction, attachment or HTML guessing. */
export function proposalPlainBody(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 100000 || /\uFFFD|\[(?:truncated|tronqu[ée])/i.test(raw)) return null;
  if (!/^(?:MIME-Version|Content-Type|Content-Transfer-Encoding):/im.test(raw)) return /<html\b|boundary=/i.test(raw) ? null : raw;
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
