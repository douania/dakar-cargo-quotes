/** Byte transport and RFC header unfolding shared by search and import. */
export class ImapByteReader {
  private buffer = new Uint8Array();
  constructor(private read: (buffer: Uint8Array) => Promise<number | null>) {}
  clear() { this.buffer = new Uint8Array(); }
  private async append(): Promise<boolean> {
    const chunk = new Uint8Array(4096), n = await this.read(chunk);
    if (n === null) return false;
    const next = new Uint8Array(this.buffer.length + n); next.set(this.buffer); next.set(chunk.subarray(0,n),this.buffer.length); this.buffer = next;
    return true;
  }
  async readLine(): Promise<string> {
    while (true) {
      for (let i=0; i+1<this.buffer.length; i++) if (this.buffer[i]===13 && this.buffer[i+1]===10) {
        const line = new TextDecoder().decode(this.buffer.slice(0,i)); this.buffer=this.buffer.slice(i+2); return line;
      }
      if (!await this.append()) throw new Error("IMAP connection ended before a complete response line");
    }
  }
  async readBytes(count: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(count) || count<0) throw new Error("Invalid IMAP literal length");
    while (this.buffer.length<count) if (!await this.append()) throw new Error("Truncated IMAP literal");
    const bytes=this.buffer.slice(0,count); this.buffer=this.buffer.slice(count); return bytes;
  }
}

export function imapHeaderLiteral(response: string): string | null {
  const marker = response.match(/BODY\[HEADER(?:\.FIELDS[^\]]*)?\]\s*\{(\d+)\}\r\n/i);
  if (!marker || marker.index === undefined) return null;
  const rest = new TextEncoder().encode(response.slice(marker.index + marker[0].length)), size=Number(marker[1]);
  if (!Number.isSafeInteger(size) || rest.length<size) throw new Error("Truncated IMAP header literal");
  return new TextDecoder("utf-8", { fatal: true }).decode(rest.slice(0,size));
}

export function unfoldHeaders(raw: string): Record<string, string> {
  const headers: Record<string,string> = Object.create(null);
  let name: string | null = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line) break;
    if (/^[ \t]/.test(line)) { if (name) headers[name]=(headers[name]+" "+line.trim()).trim(); continue; }
    const match=line.match(/^([!#$%&'*+.^_`|~\w-]+):[ \t]*(.*)$/);
    name=match?.[1].toLowerCase() ?? null;
    if (name && !Object.hasOwn(headers,name)) headers[name]=match![2].trim();
    else name=null;
  }
  return headers;
}

export function headerAddresses(value: string): string[] {
  // Quoted display names can contain commas. Only actual mailbox tokens escape.
  const addresses=value.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?/gi) ?? [];
  return [...new Set(addresses)];
}

export function readImapHeaders(response: string, uid: number, decode: (s: string) => string) {
  const h=unfoldHeaders(imapHeaderLiteral(response) ?? "");
  const messageId=h["message-id"]?.match(/^<[^<>\s]+>$/)?.[0] ?? `<${uid}@imported>`;
  const ids=(s: string) => (s.match(/<[^<>\s]+>/g) ?? []).join(" ");
  return { subject: h.subject ? decode(h.subject) : "(Sans sujet)", from: headerAddresses(h.from ?? "")[0] ?? "",
    to: headerAddresses(h.to ?? ""), date: h.date || new Date().toISOString(), messageId,
    references: ids(h.references || "") || ids(h["in-reply-to"] || "") };
}
