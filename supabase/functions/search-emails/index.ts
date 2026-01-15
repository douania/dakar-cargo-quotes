import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Decode MIME encoded headers
function decodeHeader(text: string): string {
  return text.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_: string, charset: string, encoding: string, content: string) => {
    try {
      if (encoding.toUpperCase() === 'B') {
        const decoded = atob(content);
        return new TextDecoder(charset).decode(new Uint8Array([...decoded].map(c => c.charCodeAt(0))));
      } else {
        return content
          .replace(/_/g, ' ')
          .replace(/=([0-9A-F]{2})/gi, (_m: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      }
    } catch {
      return content;
    }
  });
}

// Parse email date
function parseEmailDate(dateStr: string): string {
  try {
    const cleaned = dateStr.replace(/\s*\([^)]*\)\s*$/, '').trim();
    const parsed = new Date(cleaned);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
    const original = new Date(dateStr);
    if (!isNaN(original.getTime())) return original.toISOString();
  } catch { /* ignore */ }
  return new Date().toISOString();
}

// Remove Outlook spam tags and normalize subject for threading
function cleanSpamPrefix(subject: string): string {
  // Remove variations of Outlook spam prefixes: "Spam:*********, " "Spam: " "[SPAM]" etc.
  return subject
    .replace(/^Spam:\**,?\s*/i, '')
    .replace(/^\[Spam\]\s*/i, '')
    .replace(/^\*+Spam\*+:?\s*/i, '')
    .trim();
}

// Normalize subject for thread grouping
function normalizeSubject(subject: string): string {
  // 1. First clean spam prefixes
  let cleaned = cleanSpamPrefix(subject);
  
  // 2. Remove reply/forward prefixes (loop to handle multiple)
  let prev = '';
  while (prev !== cleaned) {
    prev = cleaned;
    cleaned = cleaned
      .replace(/^(Re|Fwd|Fw|TR|AW|WG|R|転送|回复|Antw):\s*/gi, '')
      .trim();
  }
  
  // 3. Remove external tag
  cleaned = cleaned.replace(/^\[External\]\s*/i, '').trim();
  
  return cleaned.toLowerCase();
}

// Simple IMAP client for search
class IMAPSearchClient {
  private conn: Deno.TlsConn | Deno.TcpConn | null = null;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  private tagCounter = 0;
  private buffer = "";

  constructor(
    private host: string,
    private port: number
  ) {}

  private getTag(): string {
    return `A${++this.tagCounter}`;
  }

  async connect(): Promise<void> {
    console.log(`Connecting to ${this.host}:143 for search...`);
    this.conn = await Deno.connect({ hostname: this.host, port: 143 });
    await this.readLine(); // greeting
    await this.startTls();
  }

  private async readLine(): Promise<string> {
    const buf = new Uint8Array(4096);
    let result = this.buffer;
    while (!result.includes('\r\n')) {
      const n = await this.conn!.read(buf);
      if (n === null) break;
      result += this.decoder.decode(buf.subarray(0, n));
    }
    const idx = result.indexOf('\r\n');
    if (idx >= 0) {
      this.buffer = result.substring(idx + 2);
      return result.substring(0, idx);
    }
    this.buffer = "";
    return result;
  }

  private async readBytes(count: number): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let totalRead = 0;

    // Use any buffered data first
    if (this.buffer.length > 0) {
      const bufferedBytes = new TextEncoder().encode(this.buffer);
      const toUse = Math.min(bufferedBytes.length, count);
      chunks.push(bufferedBytes.subarray(0, toUse));
      totalRead += toUse;
      this.buffer = this.buffer.substring(toUse);
    }

    while (totalRead < count) {
      const buf = new Uint8Array(Math.min(8192, count - totalRead));
      const n = await this.conn!.read(buf);
      if (n === null) break;
      chunks.push(buf.subarray(0, n));
      totalRead += n;
    }

    const result = new Uint8Array(totalRead);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  private async readUntilTag(tag: string): Promise<string> {
    let result = "";
    while (true) {
      const line = await this.readLine();
      result += line + "\r\n";

      const literalMatch = line.match(/\{(\d+)\}\s*$/);
      if (literalMatch) {
        const literalSize = parseInt(literalMatch[1], 10);
        console.log(`[IMAP] literal detected: {${literalSize}}`);
        const literalBytes = await this.readBytes(literalSize);
        console.log(`[IMAP] literal read: ${literalBytes.length}/${literalSize} bytes`);
        result += new TextDecoder().decode(literalBytes);
      }

      if (line.startsWith(`${tag} OK`) || line.startsWith(`${tag} NO`) || line.startsWith(`${tag} BAD`)) break;
    }
    return result;
  }

  private async writeCommand(command: string): Promise<void> {
    await this.conn!.write(this.encoder.encode(command + '\r\n'));
  }

  private async sendCommand(command: string): Promise<string> {
    const tag = this.getTag();
    await this.writeCommand(`${tag} ${command}`);
    return await this.readUntilTag(tag);
  }

  private getTlsCandidates(): string[] {
    const candidates = [this.host];
    const parts = this.host.split(".").filter(Boolean);
    if (parts.length >= 3) {
      const domain = parts.slice(1).join(".");
      candidates.push(domain, `mail.${domain}`, `webmail.${domain}`, `smtp.${domain}`);
    } else if (parts.length === 2) {
      candidates.push(`mail.${this.host}`, `webmail.${this.host}`, `smtp.${this.host}`);
    }
    return [...new Set(candidates)];
  }

  private async startTls(): Promise<void> {
    const candidates = this.getTlsCandidates();
    for (const serverName of candidates) {
      try {
        const tag = this.getTag();
        await this.writeCommand(`${tag} STARTTLS`);
        const response = await this.readUntilTag(tag);
        if (!response.includes(`${tag} OK`)) throw new Error("STARTTLS failed");
        
        this.buffer = "";
        const tcpConn = this.conn as Deno.TcpConn;
        this.conn = await Deno.startTls(tcpConn, { hostname: serverName });
        
        const noopTag = this.getTag();
        await this.writeCommand(`${noopTag} NOOP`);
        await this.readUntilTag(noopTag);
        console.log(`TLS upgraded with ${serverName}`);
        return;
      } catch (e) {
        console.error(`TLS failed for ${serverName}:`, e);
        // Reconnect for next attempt
        try { this.conn?.close(); } catch { /* ignore */ }
        this.buffer = "";
        this.conn = await Deno.connect({ hostname: this.host, port: 143 });
        await this.readLine();
      }
    }
    throw new Error("Could not establish TLS connection");
  }

  async login(username: string, password: string): Promise<boolean> {
    const response = await this.sendCommand(`LOGIN "${username}" "${password}"`);
    return response.includes("OK");
  }

  async select(mailbox: string): Promise<number> {
    const response = await this.sendCommand(`SELECT "${mailbox}"`);
    const match = response.match(/\* (\d+) EXISTS/);
    return match ? parseInt(match[1]) : 0;
  }

  async search(criteria: string): Promise<number[]> {
    console.log(`Searching: ${criteria}`);
    const response = await this.sendCommand(`SEARCH ${criteria}`);
    const match = response.match(/\* SEARCH([\d\s]*)/);
    if (!match) return [];
    return match[1].trim().split(/\s+/).filter(Boolean).map(Number);
  }

  async fetchHeaders(seqNums: number[]): Promise<Array<{
    seq: number;
    uid: number;
    subject: string;
    from: string;
    to: string[];
    date: string;
    messageId: string;
    references: string;
  }>> {
    if (seqNums.length === 0) return [];
    
    const range = seqNums.join(',');
    const response = await this.sendCommand(
      `FETCH ${range} (UID BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID REFERENCES IN-REPLY-TO)])`
    );
    
    const messages: Array<{
      seq: number;
      uid: number;
      subject: string;
      from: string;
      to: string[];
      date: string;
      messageId: string;
      references: string;
    }> = [];

    const fetchRegex = /\* (\d+) FETCH \(UID (\d+).*?BODY\[HEADER\.FIELDS.*?\] \{(\d+)\}\r\n([\s\S]*?)(?=\* \d+ FETCH|\r\nA\d+|$)/gi;
    let match;
    
    while ((match = fetchRegex.exec(response)) !== null) {
      const seq = parseInt(match[1]);
      const uid = parseInt(match[2]);
      const headerBlock = match[4];
      
      const subjectMatch = headerBlock.match(/Subject:\s*(.+?)(?=\r\n\S|\r\n\r\n|$)/i);
      const fromMatch = headerBlock.match(/From:\s*(.+?)(?=\r\n\S|\r\n\r\n|$)/i);
      const toMatch = headerBlock.match(/To:\s*(.+?)(?=\r\n\S|\r\n\r\n|$)/i);
      const dateMatch = headerBlock.match(/Date:\s*(.+?)(?=\r\n\S|\r\n\r\n|$)/i);
      const messageIdMatch = headerBlock.match(/Message-ID:\s*(.+?)(?=\r\n\S|\r\n\r\n|$)/i);
      const referencesMatch = headerBlock.match(/References:\s*(.+?)(?=\r\n\S|\r\n\r\n|$)/i);
      const inReplyToMatch = headerBlock.match(/In-Reply-To:\s*(.+?)(?=\r\n\S|\r\n\r\n|$)/i);
      
      let subject = decodeHeader(subjectMatch?.[1]?.trim() || '(Sans sujet)');
      let from = fromMatch?.[1]?.trim() || '';
      const emailMatch = from.match(/<([^>]+)>/);
      if (emailMatch) from = emailMatch[1];
      
      const to = (toMatch?.[1]?.trim() || '').split(',').map(e => {
        const m = e.match(/<([^>]+)>/);
        return m ? m[1].trim() : e.trim();
      }).filter(e => e);
      
      messages.push({
        seq,
        uid,
        subject,
        from,
        to,
        date: dateMatch?.[1]?.trim() || new Date().toISOString(),
        messageId: messageIdMatch?.[1]?.trim() || `<${uid}@imported>`,
        references: referencesMatch?.[1]?.trim() || inReplyToMatch?.[1]?.trim() || ''
      });
    }
    
    return messages;
  }

  async fetchBody(uid: number): Promise<{ text: string; html: string }> {
    const response = await this.sendCommand(`UID FETCH ${uid} BODY.PEEK[TEXT]`);
    let text = '';
    let html = '';
    
    const bodyMarker = response.match(/BODY\[TEXT\] \{(\d+)\}\r\n/);
    if (bodyMarker) {
      const bodySize = parseInt(bodyMarker[1], 10);
      const bodyStart = response.indexOf(bodyMarker[0]) + bodyMarker[0].length;
      const rawBody = response
        .substring(bodyStart, bodyStart + bodySize)
        .replace(/=\r\n/g, '')
        .replace(/=([0-9A-F]{2})/gi, (_: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));

      console.log(`[IMAP] BODY[TEXT] literal size=${bodySize}, extracted=${rawBody.length}`);

      if (rawBody.includes('<html') || rawBody.includes('<HTML')) {
        html = rawBody;
        text = rawBody
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      } else {
        text = rawBody;
      }
    }

    return { text, html };
  }

  async logout(): Promise<void> {
    try { await this.sendCommand('LOGOUT'); } catch { /* ignore */ }
    try { this.conn?.close(); } catch { /* ignore */ }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let client: IMAPSearchClient | null = null;

  try {
    // Increased default limit from 30 to 200 for better thread coverage
    const { configId, searchType, query, limit = 200, deepSearch = false } = await req.json();
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get config
    const { data: config, error: configError } = await supabase
      .from('email_configs')
      .select('*')
      .eq('id', configId)
      .single();

    if (configError || !config) {
      throw new Error("Configuration email non trouvée");
    }

    client = new IMAPSearchClient(config.host, config.port);
    await client.connect();
    
    const loggedIn = await client.login(config.username, config.password_encrypted);
    if (!loggedIn) throw new Error("Échec de l'authentification IMAP");

    const mailbox = config.folder || 'INBOX';
    await client.select(mailbox);

    // Build search criteria - use OR for deep search to find related emails
    let criteria = 'ALL';
    if (searchType === 'subject' && query) {
      if (deepSearch) {
        // Deep search: OR subject, body, from
        criteria = `OR OR SUBJECT "${query}" BODY "${query}" FROM "${query}"`;
      } else {
        criteria = `SUBJECT "${query}"`;
      }
    } else if (searchType === 'from' && query) {
      criteria = `FROM "${query}"`;
    } else if (searchType === 'text' && query) {
      criteria = `TEXT "${query}"`;
    }

    // Search emails
    const seqNums = await client.search(criteria);
    console.log(`Found ${seqNums.length} matching emails on server`);

    // Apply limit - take all if within limit, otherwise take most recent
    const selectedSeqs = seqNums.length <= limit ? seqNums : seqNums.slice(-limit);
    
    // Fetch headers
    const messages = await client.fetchHeaders(selectedSeqs);
    
    // Group by thread using improved normalization (handles Spam: prefixes)
    const threads = new Map<string, typeof messages>();
    for (const msg of messages) {
      // Use the improved normalizeSubject that handles Spam: prefixes
      const normalizedSubj = normalizeSubject(msg.subject);
      
      if (!threads.has(normalizedSubj)) {
        threads.set(normalizedSubj, []);
      }
      threads.get(normalizedSubj)!.push(msg);
    }

    // Convert to array format with proper date sorting
    const threadList = Array.from(threads.entries()).map(([subject, msgs]) => {
      // Sort messages by date (oldest first) for accurate dateRange
      const sortedMsgs = [...msgs].sort(
        (a, b) => new Date(parseEmailDate(a.date)).getTime() - new Date(parseEmailDate(b.date)).getTime()
      );
      
      // Get original subject (cleaned of spam prefix) from oldest message
      const displaySubject = cleanSpamPrefix(sortedMsgs[0].subject);
      
      return {
        subject: displaySubject,
        normalizedSubject: subject,
        messageCount: msgs.length,
        participants: [...new Set(msgs.map(m => m.from).filter(f => f))],
        dateRange: {
          first: parseEmailDate(sortedMsgs[0].date), // Oldest
          last: parseEmailDate(sortedMsgs[sortedMsgs.length - 1].date) // Newest
        },
        messages: sortedMsgs.map(m => ({
          uid: m.uid,
          seq: m.seq,
          subject: cleanSpamPrefix(m.subject),
          from: m.from,
          to: m.to,
          date: parseEmailDate(m.date),
          messageId: m.messageId
        }))
      };
    }).sort((a, b) => new Date(b.dateRange.last).getTime() - new Date(a.dateRange.last).getTime());

    await client.logout();
    client = null;

    return new Response(
      JSON.stringify({ 
        success: true, 
        totalFound: seqNums.length,
        selectedCount: selectedSeqs.length,
        limitApplied: limit,
        deepSearchEnabled: deepSearch,
        threads: threadList
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Search error:", error);
    if (client) {
      try { await client.logout(); } catch { /* ignore */ }
    }
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Erreur de recherche",
        details: error instanceof Error ? error.stack : undefined
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
