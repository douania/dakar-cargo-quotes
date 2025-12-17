import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Quotation-related keywords
const QUOTATION_KEYWORDS = [
  'cotation', 'devis', 'quote', 'quotation', 'pricing', 'tarif',
  'demande de prix', 'prix', 'offre', 'proposition', 'estimation',
  'import', 'export', 'transport', 'fret', 'freight', 'shipping',
  'conteneur', 'container', 'roro', 'breakbulk', 'maritime', 'aérien',
  'dédouanement', 'customs', 'clearance', 'transit'
];

function isQuotationRelated(subject: string, body: string): boolean {
  const text = `${subject} ${body}`.toLowerCase();
  return QUOTATION_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
}

function extractThreadId(messageId: string, references: string): string {
  if (references) {
    const refs = references.split(/\s+/);
    return refs[0] || messageId;
  }
  return messageId;
}

// Simple IMAP client implementation for basic operations
class SimpleIMAPClient {
  private conn: Deno.TlsConn | Deno.TcpConn | null = null;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  private tagCounter = 0;
  private buffer = "";
  private useStartTls: boolean;

  constructor(
    private host: string,
    private port: number,
    private secure: boolean,
    useStartTls = false
  ) {
    this.useStartTls = useStartTls;
  }

  private getTag(): string {
    return `A${++this.tagCounter}`;
  }

  async connect(): Promise<void> {
    console.log(`Connecting to ${this.host}:${this.port} (secure: ${this.secure}, starttls: ${this.useStartTls})`);
    
    try {
      if (this.secure && !this.useStartTls) {
        // Direct TLS connection (port 993)
        this.conn = await Deno.connectTls({
          hostname: this.host,
          port: this.port,
        });
      } else {
        // Plain connection first (port 143 or with STARTTLS)
        this.conn = await Deno.connect({
          hostname: this.host,
          port: this.port,
        });
      }
    } catch (tlsError) {
      console.error("TLS connection failed, trying alternative approach:", tlsError);
      // If TLS fails, try plain connection on port 143 with STARTTLS
      if (this.secure) {
        console.log("Falling back to STARTTLS on port 143...");
        this.port = 143;
        this.useStartTls = true;
        this.conn = await Deno.connect({
          hostname: this.host,
          port: 143,
        });
      } else {
        throw tlsError;
      }
    }
    
    // Read greeting
    const greeting = await this.readLine();
    console.log("Server greeting:", greeting.substring(0, 100));
    
    // If using STARTTLS, upgrade connection
    if (this.useStartTls) {
      await this.startTls();
    }
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
      
      if (line.startsWith(`${tag} OK`) || line.startsWith(`${tag} NO`) || line.startsWith(`${tag} BAD`)) {
        break;
      }
    }
    
    return result;
  }

  private async startTls(): Promise<void> {
    console.log("Initiating STARTTLS...");
    
    // Send STARTTLS command
    const tag = this.getTag();
    await this.writeCommand(`${tag} STARTTLS`);
    
    // Read response
    const response = await this.readUntilTag(tag);
    
    if (!response.includes(`${tag} OK`)) {
      throw new Error("STARTTLS not supported or failed: " + response);
    }
    
    console.log("STARTTLS accepted, upgrading connection...");
    
    // Clear buffer before upgrade
    this.buffer = "";
    
    // Upgrade to TLS
    const tcpConn = this.conn as Deno.TcpConn;
    this.conn = await Deno.startTls(tcpConn, { 
      hostname: this.host,
    });
    
    console.log("TLS connection upgraded successfully");
  }

  private async writeCommand(command: string): Promise<void> {
    await this.conn!.write(this.encoder.encode(command + '\r\n'));
  }

  private async sendCommand(command: string): Promise<string> {
    const tag = this.getTag();
    await this.writeCommand(`${tag} ${command}`);
    return await this.readUntilTag(tag);
  }

  async login(username: string, password: string): Promise<boolean> {
    const response = await this.sendCommand(`LOGIN "${username}" "${password}"`);
    return response.includes("OK");
  }

  async select(mailbox: string): Promise<{ exists: number }> {
    const response = await this.sendCommand(`SELECT "${mailbox}"`);
    const existsMatch = response.match(/\* (\d+) EXISTS/);
    return { exists: existsMatch ? parseInt(existsMatch[1]) : 0 };
  }

  async fetchHeaders(range: string): Promise<Array<{
    uid: number;
    subject: string;
    from: string;
    to: string[];
    date: string;
    messageId: string;
    references: string;
  }>> {
    const response = await this.sendCommand(
      `FETCH ${range} (UID BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID REFERENCES IN-REPLY-TO)])`
    );
    
    const messages: Array<{
      uid: number;
      subject: string;
      from: string;
      to: string[];
      date: string;
      messageId: string;
      references: string;
    }> = [];

    // Parse FETCH responses
    const fetchRegex = /\* (\d+) FETCH \(UID (\d+).*?BODY\[HEADER\.FIELDS.*?\] \{(\d+)\}\r\n([\s\S]*?)(?=\* \d+ FETCH|\r\nA\d+|$)/gi;
    let match;
    
    while ((match = fetchRegex.exec(response)) !== null) {
      const uid = parseInt(match[2]);
      const headerBlock = match[4];
      
      const subjectMatch = headerBlock.match(/Subject:\s*(.+?)(?=\r\n\S|\r\n\r\n|$)/i);
      const fromMatch = headerBlock.match(/From:\s*(.+?)(?=\r\n\S|\r\n\r\n|$)/i);
      const toMatch = headerBlock.match(/To:\s*(.+?)(?=\r\n\S|\r\n\r\n|$)/i);
      const dateMatch = headerBlock.match(/Date:\s*(.+?)(?=\r\n\S|\r\n\r\n|$)/i);
      const messageIdMatch = headerBlock.match(/Message-ID:\s*(.+?)(?=\r\n\S|\r\n\r\n|$)/i);
      const referencesMatch = headerBlock.match(/References:\s*(.+?)(?=\r\n\S|\r\n\r\n|$)/i);
      const inReplyToMatch = headerBlock.match(/In-Reply-To:\s*(.+?)(?=\r\n\S|\r\n\r\n|$)/i);
      
      // Decode subject if needed
      let subject = subjectMatch?.[1]?.trim() || '(Sans sujet)';
      subject = decodeHeader(subject);
      
      let from = fromMatch?.[1]?.trim() || 'unknown@unknown.com';
      // Extract email from "Name <email>" format
      const emailMatch = from.match(/<([^>]+)>/);
      if (emailMatch) {
        from = emailMatch[1];
      }
      
      const to = (toMatch?.[1]?.trim() || '').split(',').map(e => {
        const m = e.match(/<([^>]+)>/);
        return m ? m[1].trim() : e.trim();
      }).filter(e => e);
      
      messages.push({
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
    
    // Extract body content
    const bodyMatch = response.match(/BODY\[TEXT\] \{(\d+)\}\r\n([\s\S]*?)(?=\)\r\n|\r\nA\d+)/);
    if (bodyMatch) {
      const rawBody = bodyMatch[2];
      text = decodeBody(rawBody);
      
      if (rawBody.includes('<html') || rawBody.includes('<HTML')) {
        html = text;
        text = stripHtml(html);
      }
    }
    
    return { text, html };
  }

  async logout(): Promise<void> {
    try {
      await this.sendCommand('LOGOUT');
    } catch (_e) {
      // Ignore logout errors
    }
    
    try {
      this.conn?.close();
    } catch (_e) {
      // Ignore close errors
    }
  }
}

// Decode MIME encoded headers (=?UTF-8?Q?...?= or =?UTF-8?B?...?=)
function decodeHeader(text: string): string {
  return text.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_: string, charset: string, encoding: string, content: string) => {
    try {
      if (encoding.toUpperCase() === 'B') {
        // Base64
        const decoded = atob(content);
        return new TextDecoder(charset).decode(new Uint8Array([...decoded].map(c => c.charCodeAt(0))));
      } else {
        // Quoted-printable
        return content
          .replace(/_/g, ' ')
          .replace(/=([0-9A-F]{2})/gi, (_m: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      }
    } catch {
      return content;
    }
  });
}

// Decode quoted-printable body
function decodeBody(text: string): string {
  return text
    .replace(/=\r\n/g, '') // Soft line breaks
    .replace(/=([0-9A-F]{2})/gi, (_: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

// Strip HTML tags
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let client: SimpleIMAPClient | null = null;

  try {
    const { configId, limit = 50 } = await req.json();
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("Syncing emails for config:", configId);

    // Get email config
    const { data: config, error: configError } = await supabase
      .from('email_configs')
      .select('*')
      .eq('id', configId)
      .single();

    if (configError || !config) {
      throw new Error("Configuration email non trouvée");
    }

    console.log(`Connecting to ${config.host}:${config.port} as ${config.username}`);

    // Create IMAP client - use STARTTLS for better certificate compatibility
    const useStartTls = config.port === 993; // If port 993, try STARTTLS as fallback
    client = new SimpleIMAPClient(
      config.host,
      useStartTls ? 143 : config.port, // Use port 143 for STARTTLS
      config.use_ssl !== false,
      useStartTls
    );

    await client.connect();
    console.log("Connected to IMAP server");

    // Login
    const loggedIn = await client.login(config.username, config.password_encrypted);
    if (!loggedIn) {
      throw new Error("Échec de l'authentification IMAP");
    }
    console.log("Logged in successfully");

    // Select mailbox
    const mailbox = config.folder || 'INBOX';
    const { exists } = await client.select(mailbox);
    console.log(`Mailbox ${mailbox} selected, ${exists} messages`);

    const processedEmails = [];
    
    if (exists > 0) {
      // Fetch last N messages
      const fetchLimit = Math.min(limit, exists);
      const startSeq = Math.max(1, exists - fetchLimit + 1);
      const range = `${startSeq}:${exists}`;
      
      console.log(`Fetching messages ${range}`);
      const headers = await client.fetchHeaders(range);
      console.log(`Got ${headers.length} message headers`);

      for (const msg of headers) {
        try {
          // Check if email already exists
          const { data: existing } = await supabase
            .from('emails')
            .select('id')
            .eq('message_id', msg.messageId)
            .maybeSingle();

          if (existing) {
            console.log("Email already exists:", msg.messageId);
            continue;
          }

          // Fetch body
          const { text: bodyText, html: bodyHtml } = await client.fetchBody(msg.uid);
          
          const isQuotation = isQuotationRelated(msg.subject, bodyText || bodyHtml || '');
          const threadId = extractThreadId(msg.messageId, msg.references);

          const { data: inserted, error: insertError } = await supabase
            .from('emails')
            .insert({
              email_config_id: configId,
              message_id: msg.messageId,
              thread_id: threadId,
              from_address: msg.from,
              to_addresses: msg.to.length > 0 ? msg.to : [config.username],
              subject: msg.subject,
              body_text: bodyText || null,
              body_html: bodyHtml || null,
              sent_at: msg.date,
              is_quotation_request: isQuotation
            })
            .select()
            .single();

          if (insertError) {
            console.error("Error inserting email:", insertError);
            continue;
          }

          processedEmails.push(inserted);
          console.log(`Imported: ${msg.subject.substring(0, 50)}...`);
        } catch (msgError) {
          console.error("Error processing message:", msgError);
        }
      }
    }

    // Logout
    await client.logout();
    client = null;

    // Update last sync time
    await supabase
      .from('email_configs')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', configId);

    console.log(`Synced ${processedEmails.length} new emails`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        synced: processedEmails.length,
        emails: processedEmails
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Sync error:", error);
    
    if (client) {
      try {
        await client.logout();
      } catch (e) {
        console.error("Error closing IMAP connection:", e);
      }
    }
    
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Erreur de synchronisation",
        details: error instanceof Error ? error.stack : undefined
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
