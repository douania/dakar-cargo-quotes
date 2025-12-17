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
        return content.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_m: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      }
    } catch { return content; }
  });
}

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

// Simple IMAP client
class IMAPClient {
  private conn: Deno.TlsConn | Deno.TcpConn | null = null;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  private tagCounter = 0;
  private buffer = "";

  constructor(private host: string) {}

  private getTag(): string { return `A${++this.tagCounter}`; }

  async connect(): Promise<void> {
    this.conn = await Deno.connect({ hostname: this.host, port: 143 });
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

  private async readUntilTag(tag: string): Promise<string> {
    let result = "";
    while (true) {
      const line = await this.readLine();
      result += line + '\r\n';
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
    for (const serverName of this.getTlsCandidates()) {
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
        this.conn = await Deno.connect({ hostname: this.host, port: 143 });
        await this.readLine();
      }
    }
    throw new Error("Could not establish TLS");
  }

  async login(username: string, password: string): Promise<boolean> {
    const response = await this.sendCommand(`LOGIN "${username}" "${password}"`);
    return response.includes("OK");
  }

  async select(mailbox: string): Promise<void> {
    await this.sendCommand(`SELECT "${mailbox}"`);
  }

  async fetchMessage(uid: number): Promise<{
    subject: string;
    from: string;
    to: string[];
    date: string;
    messageId: string;
    references: string;
    bodyText: string;
    bodyHtml: string;
  }> {
    // Fetch headers
    const headerResp = await this.sendCommand(
      `UID FETCH ${uid} BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID REFERENCES IN-REPLY-TO)]`
    );
    
    let subject = '(Sans sujet)';
    let from = '';
    let to: string[] = [];
    let date = new Date().toISOString();
    let messageId = `<${uid}@imported>`;
    let references = '';

    const headerMatch = headerResp.match(/BODY\[HEADER\.FIELDS.*?\] \{\d+\}\r\n([\s\S]*?)(?=\)\r\n|\r\nA\d+)/i);
    if (headerMatch) {
      const h = headerMatch[1];
      const sm = h.match(/Subject:\s*(.+?)(?=\r\n\S|\r\n\r\n|$)/i);
      if (sm) subject = decodeHeader(sm[1].trim());
      const fm = h.match(/From:\s*(.+?)(?=\r\n\S|\r\n\r\n|$)/i);
      if (fm) {
        from = fm[1].trim();
        const em = from.match(/<([^>]+)>/);
        if (em) from = em[1];
      }
      const tm = h.match(/To:\s*(.+?)(?=\r\n\S|\r\n\r\n|$)/i);
      if (tm) {
        to = tm[1].split(',').map(e => {
          const m = e.match(/<([^>]+)>/);
          return m ? m[1].trim() : e.trim();
        }).filter(Boolean);
      }
      const dm = h.match(/Date:\s*(.+?)(?=\r\n\S|\r\n\r\n|$)/i);
      if (dm) date = dm[1].trim();
      const midm = h.match(/Message-ID:\s*(.+?)(?=\r\n\S|\r\n\r\n|$)/i);
      if (midm) messageId = midm[1].trim();
      const refm = h.match(/References:\s*(.+?)(?=\r\n\S|\r\n\r\n|$)/i);
      const irm = h.match(/In-Reply-To:\s*(.+?)(?=\r\n\S|\r\n\r\n|$)/i);
      references = refm?.[1]?.trim() || irm?.[1]?.trim() || '';
    }

    // Fetch body
    const bodyResp = await this.sendCommand(`UID FETCH ${uid} BODY.PEEK[TEXT]`);
    let bodyText = '';
    let bodyHtml = '';
    
    const bodyMatch = bodyResp.match(/BODY\[TEXT\] \{\d+\}\r\n([\s\S]*?)(?=\)\r\n|\r\nA\d+)/);
    if (bodyMatch) {
      const raw = bodyMatch[1]
        .replace(/=\r\n/g, '')
        .replace(/=([0-9A-F]{2})/gi, (_: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      
      if (raw.includes('<html') || raw.includes('<HTML')) {
        bodyHtml = raw;
        bodyText = raw
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      } else {
        bodyText = raw;
      }
    }

    return { subject, from, to, date, messageId, references, bodyText, bodyHtml };
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

  let client: IMAPClient | null = null;

  try {
    const { configId, uids, learningCase } = await req.json();
    
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

    client = new IMAPClient(config.host);
    await client.connect();
    
    const loggedIn = await client.login(config.username, config.password_encrypted);
    if (!loggedIn) throw new Error("Échec de l'authentification IMAP");

    await client.select(config.folder || 'INBOX');

    const importedEmails: any[] = [];
    let threadId: string | null = null;

    for (const uid of uids) {
      // Check if already exists
      const { data: existing } = await supabase
        .from('emails')
        .select('id')
        .eq('message_id', `<${uid}@check>`)
        .maybeSingle();

      const msg = await client.fetchMessage(uid);
      
      // Check by actual message_id
      const { data: existingByMsgId } = await supabase
        .from('emails')
        .select('id')
        .eq('message_id', msg.messageId)
        .maybeSingle();

      if (existingByMsgId) {
        console.log(`Email ${msg.messageId} already exists, skipping`);
        importedEmails.push({ id: existingByMsgId.id, ...msg, alreadyExists: true });
        continue;
      }

      // Determine thread ID
      if (!threadId) {
        if (msg.references) {
          threadId = msg.references.split(/\s+/)[0];
        } else {
          threadId = msg.messageId;
        }
      }

      const { data: inserted, error: insertError } = await supabase
        .from('emails')
        .insert({
          email_config_id: configId,
          message_id: msg.messageId,
          thread_id: threadId,
          from_address: msg.from,
          to_addresses: msg.to.length > 0 ? msg.to : [config.username],
          subject: msg.subject,
          body_text: msg.bodyText || null,
          body_html: msg.bodyHtml || null,
          sent_at: parseEmailDate(msg.date),
          is_quotation_request: learningCase === 'quotation',
          extracted_data: learningCase ? { learning_case: learningCase, imported_for_learning: true } : null
        })
        .select()
        .single();

      if (insertError) {
        console.error("Error inserting email:", insertError);
        continue;
      }

      importedEmails.push(inserted);
      console.log(`Imported: ${msg.subject.substring(0, 50)}...`);
    }

    await client.logout();
    client = null;

    // If this is a learning case, create a knowledge entry linking all emails
    if (learningCase && importedEmails.length > 0) {
      const emailIds = importedEmails.filter(e => !e.alreadyExists).map(e => e.id);
      if (emailIds.length > 0) {
        const firstEmail = importedEmails[0];
        await supabase.from('learned_knowledge').insert({
          name: `Échange: ${firstEmail.subject?.substring(0, 100) || 'Sans titre'}`,
          category: 'quotation_exchange',
          description: `Échange de ${importedEmails.length} emails importé pour apprentissage`,
          source_type: 'email_thread',
          data: {
            email_ids: emailIds,
            thread_id: threadId,
            participants: [...new Set(importedEmails.flatMap(e => [e.from_address, ...(e.to_addresses || [])]))],
            date_range: {
              first: importedEmails[importedEmails.length - 1]?.sent_at,
              last: importedEmails[0]?.sent_at
            },
            learning_case: learningCase
          },
          confidence: 0.3, // Will increase after AI analysis
          is_validated: false
        });
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        imported: importedEmails.filter(e => !e.alreadyExists).length,
        total: importedEmails.length,
        threadId,
        emails: importedEmails
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Import error:", error);
    if (client) {
      try { await client.logout(); } catch { /* ignore */ }
    }
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Erreur d'import",
        details: error instanceof Error ? error.stack : undefined
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
