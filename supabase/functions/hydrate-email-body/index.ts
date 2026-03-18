import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Limits for full hydration (high but finite) ───
const MAX_FULL_BODY_TEXT = 500_000;
const MAX_FULL_BODY_HTML = 1_000_000;

// ─── MIME helpers (copied from sync-emails, self-contained) ───

function decodeHeader(text: string): string {
  return text.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_: string, charset: string, encoding: string, content: string) => {
    try {
      if (encoding.toUpperCase() === 'B') {
        const decoded = atob(content);
        return new TextDecoder(charset).decode(new Uint8Array([...decoded].map(c => c.charCodeAt(0))));
      } else {
        return content.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_m: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      }
    } catch { return content; }
  });
}

function decodeBody(text: string): string {
  return text
    .replace(/=\r\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<img[^>]+src=["']data:image\/[^"']+["'][^>]*>/gi, '')
    .replace(/<img[^>]+src=["']cid:[^"']+["'][^>]*>/gi, '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/\sstyle=["'][^"']*["']/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Minimal IMAP client (modeled on force-download-attachment) ───

function getTlsServerNameCandidates(host: string): string[] {
  const candidates = [host];
  const parts = host.split('.').filter(Boolean);
  if (parts.length >= 3) {
    const domain = parts.slice(1).join('.');
    candidates.push(domain, `mail.${domain}`, `webmail.${domain}`);
  } else if (parts.length === 2) {
    candidates.push(`mail.${host}`, `webmail.${host}`);
  }
  return [...new Set(candidates)];
}

class IMAPClient {
  private conn: Deno.TlsConn | Deno.TcpConn | null = null;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  private tagCounter = 0;
  private buffer = "";

  constructor(private host: string, private port: number = 143) {}

  private getTag(): string { return `A${++this.tagCounter}`; }

  async connect(): Promise<void> {
    this.conn = await Deno.connect({ hostname: this.host, port: this.port });
    await this.readLine();
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
      result += line + '\r\n';
      // Handle IMAP literals
      const literalMatch = line.match(/\{(\d+)\}\s*$/);
      if (literalMatch) {
        const literalSize = parseInt(literalMatch[1], 10);
        const literalBytes = await this.readBytes(literalSize);
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

  private async startTls(): Promise<void> {
    const candidates = getTlsServerNameCandidates(this.host);
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
        return;
      } catch {
        try { this.conn?.close(); } catch { /* ignore */ }
        this.buffer = "";
        this.conn = await Deno.connect({ hostname: this.host, port: this.port });
        await this.readLine();
      }
    }
    throw new Error(`Could not establish TLS for ${this.host}`);
  }

  async login(username: string, password: string): Promise<boolean> {
    const response = await this.sendCommand(`LOGIN "${username}" "${password}"`);
    return response.includes("OK");
  }

  async select(mailbox: string): Promise<void> {
    await this.sendCommand(`SELECT "${mailbox}"`);
  }

  async searchByMessageId(messageId: string): Promise<number | null> {
    const response = await this.sendCommand(`UID SEARCH HEADER Message-ID "${messageId}"`);
    const match = response.match(/\* SEARCH (\d+)/);
    return match ? parseInt(match[1]) : null;
  }

  async fetchBody(uid: number): Promise<{ text: string; html: string }> {
    const response = await this.sendCommand(`UID FETCH ${uid} BODY.PEEK[TEXT]`);
    let text = '';
    let html = '';

    const bodyMarker = response.match(/BODY\[TEXT\] \{(\d+)\}\r\n/);
    if (bodyMarker) {
      const bodySize = parseInt(bodyMarker[1], 10);
      const bodyStart = response.indexOf(bodyMarker[0]) + bodyMarker[0].length;
      const rawBody = response.substring(bodyStart, bodyStart + bodySize);
      text = decodeBody(rawBody);
      if (rawBody.includes('<html') || rawBody.includes('<HTML')) {
        html = text;
        text = stripHtml(html);
      }
    }
    return { text, html };
  }

  async logout(): Promise<void> {
    try { await this.sendCommand("LOGOUT"); } catch { /* ignore */ }
  }

  close(): void {
    try { this.conn?.close(); } catch { /* ignore */ }
  }
}

// ─── Main handler ───

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let client: IMAPClient | null = null;

  try {
    // Auth guard
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;

    const { email_id } = await req.json();

    if (!email_id) {
      return new Response(
        JSON.stringify({ error: 'email_id requis' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`[hydrate] Starting hydration for email_id=${email_id}`);

    // Load email with config join (same pattern as force-download-attachment)
    const { data: email, error: emailError } = await supabase
      .from('emails')
      .select(`
        id, message_id, body_capture_mode,
        email_configs!inner (
          id, host, port, username, password_encrypted, folder
        )
      `)
      .eq('id', email_id)
      .single();

    if (emailError || !email) {
      console.error('[hydrate] Email not found:', emailError);
      return new Response(
        JSON.stringify({ error: 'Email non trouvé' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Idempotence guard
    if (email.body_capture_mode === 'full_sanitized') {
      console.log(`[hydrate] Already hydrated, returning early`);
      return new Response(
        JSON.stringify({ success: true, already_hydrated: true, body_capture_mode: 'full_sanitized', text_length: null, html_length: null }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!email.message_id) {
      return new Response(
        JSON.stringify({ error: 'Email sans message_id, hydratation impossible' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const config = (email as any).email_configs;
    console.log(`[hydrate] Connecting to IMAP ${config.host} as ${config.username}...`);

    // Connect to IMAP
    client = new IMAPClient(config.host, config.port || 143);
    await client.connect();

    const loggedIn = await client.login(config.username, config.password_encrypted);
    if (!loggedIn) {
      client.close();
      return new Response(
        JSON.stringify({ error: 'Échec de connexion IMAP' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    await client.select(config.folder || 'INBOX');

    // Find message by Message-ID
    const uid = await client.searchByMessageId(email.message_id);
    if (!uid) {
      await client.logout();
      client.close();
      return new Response(
        JSON.stringify({ error: 'Message non trouvé sur le serveur IMAP' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[hydrate] Found UID=${uid}, fetching full body...`);

    // Fetch full body
    const { text: rawText, html: rawHtml } = await client.fetchBody(uid);

    await client.logout();
    client.close();
    client = null;

    // Apply sanitization with HIGH limits (full hydration mode)
    let bodyHtml: string | null = null;
    let bodyText: string | null = null;

    if (rawHtml) {
      bodyHtml = sanitizeHtml(rawHtml).substring(0, MAX_FULL_BODY_HTML);
      // CTO rule: always derive bodyText from cleaned HTML when HTML exists
      bodyText = stripHtml(bodyHtml).substring(0, MAX_FULL_BODY_TEXT);
    } else if (rawText) {
      bodyText = rawText.substring(0, MAX_FULL_BODY_TEXT);
    }

    const textLength = bodyText?.length || 0;
    const htmlLength = bodyHtml?.length || 0;

    console.log(`[hydrate] Hydrated: text=${textLength}, html=${htmlLength}`);

    // Update email record
    const { error: updateError } = await supabase
      .from('emails')
      .update({
        body_text: bodyText,
        body_html: bodyHtml,
        body_capture_mode: 'full_sanitized',
      })
      .eq('id', email_id);

    if (updateError) {
      console.error('[hydrate] Update failed:', updateError);
      return new Response(
        JSON.stringify({ error: 'Mise à jour échouée' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[hydrate] Email ${email_id} hydrated successfully`);

    return new Response(
      JSON.stringify({
        success: true,
        already_hydrated: false,
        body_capture_mode: 'full_sanitized',
        text_length: textLength,
        html_length: htmlLength,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[hydrate] Error:', err);
    if (client) {
      try { client.close(); } catch { /* ignore */ }
    }
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
