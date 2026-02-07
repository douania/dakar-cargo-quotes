import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Decode MIME encoded headers/filenames
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

// Decode base64 content
function decodeBase64(content: string): Uint8Array {
  try {
    const cleaned = content.replace(/[\r\n\s]/g, '');
    const binary = atob(cleaned);
    return new Uint8Array([...binary].map(c => c.charCodeAt(0)));
  } catch (e) {
    console.error("Base64 decode error:", e);
    return new Uint8Array(0);
  }
}

// Decode quoted-printable content
function decodeQuotedPrintable(content: string): Uint8Array {
  const decoded = content
    .replace(/=\r\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  return new TextEncoder().encode(decoded);
}

interface AttachmentInfo {
  partNumber: string;
  filename: string;
  contentType: string;
  encoding: string;
  size: number;
}

// Parse BODYSTRUCTURE to find attachments
function parseBodyStructure(response: string): AttachmentInfo[] {
  const attachments: AttachmentInfo[] = [];
  
  const structureMatch = response.match(/BODYSTRUCTURE\s+(\([\s\S]*?\))(?:\s*\)|\s*$)/i);
  if (!structureMatch) return attachments;
  
  const structure = structureMatch[1];
  
  function parsePart(str: string, partPath: string, depth: number = 0): void {
    // Prevent infinite recursion
    if (depth > 20) return;
    
    const trimmed = str.trim();
    
    if (trimmed.startsWith('((')) {
      // Skip the outer wrapper parenthesis
      let parenDepth = 0;
      let partStart = -1;
      let subPartNum = 1;
      
      for (let i = 1; i < trimmed.length - 1; i++) {
        if (trimmed[i] === '(') {
          if (parenDepth === 0) partStart = i;
          parenDepth++;
        } else if (trimmed[i] === ')') {
          parenDepth--;
          if (parenDepth === 0 && partStart !== -1) {
            const subPart = trimmed.substring(partStart, i + 1);
            if (!subPart.match(/^\s*"[A-Z]+"/i)) {
              const newPath = partPath ? `${partPath}.${subPartNum}` : String(subPartNum);
              parsePart(subPart, newPath, depth + 1);
              subPartNum++;
            }
            partStart = -1;
          }
        }
      }
    } else if (trimmed.startsWith('(')) {
      const content = trimmed.substring(1, trimmed.length - 1);
      const tokens: string[] = [];
      let current = '';
      let inQuotes = false;
      let parenDepth = 0;
      
      for (let i = 0; i < content.length; i++) {
        const char = content[i];
        if (char === '"' && content[i - 1] !== '\\') {
          inQuotes = !inQuotes;
          current += char;
        } else if (char === '(' && !inQuotes) {
          parenDepth++;
          current += char;
        } else if (char === ')' && !inQuotes) {
          parenDepth--;
          current += char;
        } else if (char === ' ' && !inQuotes && parenDepth === 0) {
          if (current.trim()) tokens.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      if (current.trim()) tokens.push(current.trim());
      
      if (tokens.length >= 2) {
        const type = tokens[0].replace(/"/g, '').toLowerCase();
        const subtype = tokens[1].replace(/"/g, '').toLowerCase();
        
        if (type !== 'multipart') {
          let filename = '';
          let encoding = '7bit';
          let size = 0;
          
          for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            if (token.startsWith('(') && token.includes('"name"')) {
              const nameMatch = token.match(/"name"\s+"([^"]+)"/i);
              if (nameMatch) filename = decodeHeader(nameMatch[1]);
            }
            if (token.startsWith('(') && token.includes('"filename"')) {
              const fnMatch = token.match(/"filename"\s+"([^"]+)"/i);
              if (fnMatch) filename = decodeHeader(fnMatch[1]);
            }
          }
          
          if (tokens.length > 5 && /^[a-z0-9-]+$/i.test(tokens[5].replace(/"/g, ''))) {
            encoding = tokens[5].replace(/"/g, '').toLowerCase();
          }
          
          for (const token of tokens) {
            if (/^\d+$/.test(token)) {
              size = parseInt(token);
              break;
            }
          }
          
          const hasDisposition = tokens.some(t => 
            t.toLowerCase().includes('attachment') || 
            t.toLowerCase().includes('inline')
          );
          
          if (filename || (hasDisposition && type !== 'text')) {
            const partNum = partPath || '1';
            attachments.push({
              partNumber: partNum,
              filename: filename || `attachment_${partNum}.${subtype}`,
              contentType: `${type}/${subtype}`,
              encoding,
              size
            });
          }
        }
      }
    }
  }
  
  parsePart(structure, "");
  return attachments;
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

  async searchByMessageId(messageId: string): Promise<number | null> {
    const response = await this.sendCommand(`UID SEARCH HEADER Message-ID "${messageId}"`);
    const match = response.match(/\* SEARCH (\d+)/);
    return match ? parseInt(match[1]) : null;
  }

  async fetchBodyStructure(uid: number): Promise<AttachmentInfo[]> {
    const response = await this.sendCommand(`UID FETCH ${uid} BODYSTRUCTURE`);
    return parseBodyStructure(response);
  }

  async fetchAttachment(uid: number, partNumber: string, encoding: string): Promise<Uint8Array> {
    console.log(`Fetching attachment: UID ${uid}, part ${partNumber}, encoding ${encoding}`);
    const response = await this.sendCommand(`UID FETCH ${uid} BODY.PEEK[${partNumber}]`);
    
    // Pattern 1: BODY[X] {size}\r\ncontent
    const sizeMatch = response.match(/BODY\[[\d.]+\]\s*\{(\d+)\}/i);
    if (sizeMatch) {
      const size = parseInt(sizeMatch[1]);
      const afterBrace = response.indexOf(`{${size}}`);
      if (afterBrace !== -1) {
        const contentStart = response.indexOf('\r\n', afterBrace);
        if (contentStart !== -1) {
          const content = response.substring(contentStart + 2, contentStart + 2 + size);
          if (content.length > 0) {
            if (encoding === 'base64') {
              return decodeBase64(content);
            } else if (encoding === 'quoted-printable') {
              return decodeQuotedPrintable(content);
            }
            return new TextEncoder().encode(content);
          }
        }
      }
    }
    
    // Pattern 2: BODY[X] "content"
    const quotedMatch = response.match(/BODY\[[\d.]+\]\s+"([^"]*)"/i);
    if (quotedMatch && quotedMatch[1]) {
      const content = quotedMatch[1];
      if (encoding === 'base64') {
        return decodeBase64(content);
      } else if (encoding === 'quoted-printable') {
        return decodeQuotedPrintable(content);
      }
      return new TextEncoder().encode(content);
    }
    
    // Pattern 3: Try to extract everything between BODY[X] and the closing )
    const bodyMatch = response.match(/BODY\[[\d.]+\]\s*(?:\{\d+\}\r\n)?([\s\S]*?)(?:\)\r\n[A-Z]\d+|$)/i);
    if (bodyMatch && bodyMatch[1]) {
      const content = bodyMatch[1].trim();
      if (content.length > 0) {
        if (encoding === 'base64') {
          return decodeBase64(content);
        } else if (encoding === 'quoted-printable') {
          return decodeQuotedPrintable(content);
        }
        return new TextEncoder().encode(content);
      }
    }
    
    console.log("Could not extract attachment content");
    return new Uint8Array(0);
  }

  async logout(): Promise<void> {
    try {
      await this.sendCommand("LOGOUT");
    } catch { /* ignore */ }
  }

  close(): void {
    try { this.conn?.close(); } catch { /* ignore */ }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Phase S0: Auth guard
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;

    const { attachmentId } = await req.json();
    
    if (!attachmentId) {
      return new Response(
        JSON.stringify({ success: false, error: 'attachmentId requis' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    console.log(`Force downloading attachment: ${attachmentId}`);
    
    // Get attachment with email info
    const { data: attachment, error: attachmentError } = await supabase
      .from('email_attachments')
      .select(`
        id, filename, content_type, size, storage_path, extracted_text,
        emails!inner (
          id, message_id,
          email_configs!inner (
            id, host, username, password_encrypted, folder
          )
        )
      `)
      .eq('id', attachmentId)
      .single();
    
    if (attachmentError || !attachment) {
      console.error('Attachment not found:', attachmentError);
      return new Response(
        JSON.stringify({ success: false, error: 'Pièce jointe non trouvée' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Check if already downloaded
    if (attachment.storage_path) {
      return new Response(
        JSON.stringify({ success: false, error: 'Pièce jointe déjà téléchargée' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const email = attachment.emails as any;
    const config = email.email_configs;
    
    console.log(`Connecting to ${config.host} as ${config.username}...`);
    
    // Connect to IMAP
    const client = new IMAPClient(config.host);
    await client.connect();
    
    const loggedIn = await client.login(config.username, config.password_encrypted);
    if (!loggedIn) {
      client.close();
      return new Response(
        JSON.stringify({ success: false, error: 'Échec de connexion IMAP' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    await client.select(config.folder || 'INBOX');
    
    // Find message by Message-ID
    const uid = await client.searchByMessageId(email.message_id);
    if (!uid) {
      client.close();
      return new Response(
        JSON.stringify({ success: false, error: 'Message non trouvé sur le serveur' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`Found message UID: ${uid}`);
    
    // Get body structure to find the attachment
    const attachments = await client.fetchBodyStructure(uid);
    console.log(`Found ${attachments.length} attachments in message`);
    
    // Find matching attachment by filename
    const targetAttachment = attachments.find(a => 
      a.filename.toLowerCase() === attachment.filename.toLowerCase()
    );
    
    if (!targetAttachment) {
      client.close();
      return new Response(
        JSON.stringify({ success: false, error: 'Pièce jointe non trouvée dans le message' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`Downloading: ${targetAttachment.filename} (part ${targetAttachment.partNumber})`);
    
    // Download the attachment
    const content = await client.fetchAttachment(uid, targetAttachment.partNumber, targetAttachment.encoding);
    
    await client.logout();
    client.close();
    
    if (content.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Contenu de la pièce jointe vide' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`Downloaded ${content.length} bytes`);
    
    // Upload to storage
    const timestamp = Date.now();
    const safeName = attachment.filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storagePath = `email-attachments/${email.id}/${timestamp}_${safeName}`;
    
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, content, {
        contentType: attachment.content_type || 'application/octet-stream',
        upsert: true
      });
    
    if (uploadError) {
      console.error('Upload error:', uploadError);
      return new Response(
        JSON.stringify({ success: false, error: 'Échec de l\'upload' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`Uploaded to: ${storagePath}`);
    
    // Update attachment record
    const { error: updateError } = await supabase
      .from('email_attachments')
      .update({
        storage_path: storagePath,
        size: content.length,
        extracted_text: null // Clear the skip reason
      })
      .eq('id', attachmentId);
    
    if (updateError) {
      console.error('Update error:', updateError);
      return new Response(
        JSON.stringify({ success: false, error: 'Échec de mise à jour' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`Successfully force-downloaded: ${attachment.filename}`);
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Pièce jointe téléchargée avec succès',
        size: content.length,
        storagePath
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Error in force-download-attachment:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Erreur inconnue' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
