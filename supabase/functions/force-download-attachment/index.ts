import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
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

// Tokenizer for IMAP BODYSTRUCTURE (robust, from sync-emails)
function tokenizeBodyStructure(structure: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  
  while (i < structure.length) {
    const ch = structure[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '(' || ch === ')') { tokens.push(ch); i++; continue; }
    if (ch === '"') {
      let end = i + 1;
      while (end < structure.length) {
        if (structure[end] === '\\' && end + 1 < structure.length) { end += 2; continue; }
        if (structure[end] === '"') break;
        end++;
      }
      tokens.push(structure.substring(i + 1, end));
      i = end + 1;
      continue;
    }
    if (/[A-Za-z0-9]/.test(ch)) {
      let end = i;
      while (end < structure.length && /[A-Za-z0-9._-]/.test(structure[end])) end++;
      tokens.push(structure.substring(i, end));
      i = end;
      continue;
    }
    i++;
  }
  return tokens;
}

// Extract filename from BODYSTRUCTURE parameters
function extractFilenameFromParams(tokens: string[], startIdx: number): string {
  let filename = '';
  for (let i = startIdx; i < Math.min(startIdx + 100, tokens.length); i++) {
    const token = tokens[i]?.toLowerCase();
    if (token === 'name' || token === 'filename') {
      for (let j = i + 1; j < Math.min(i + 5, tokens.length); j++) {
        const val = tokens[j];
        if (val && val !== '(' && val !== ')' && val.toLowerCase() !== 'nil') {
          filename = decodeHeader(val);
          break;
        }
      }
      if (filename) break;
    }
    if (token && token.startsWith('filename*')) {
      for (let j = i + 1; j < Math.min(i + 5, tokens.length); j++) {
        const val = tokens[j];
        if (val && val !== '(' && val !== ')' && val.toLowerCase() !== 'nil') {
          const match = val.match(/(?:UTF-8''|utf-8'')?(.*)/i);
          if (match) {
            try { filename = decodeURIComponent(match[1] || val); }
            catch { filename = match[1] || val; }
          }
          break;
        }
      }
      if (filename) break;
    }
  }
  return filename;
}

// Recursive MIME parser
interface ParseContext { pos: number; }

function parseMimePart(tokens: string[], ctx: ParseContext, path: string): AttachmentInfo[] {
  const attachments: AttachmentInfo[] = [];
  if (ctx.pos >= tokens.length || tokens[ctx.pos] !== '(') return attachments;
  ctx.pos++;
  
  if (tokens[ctx.pos] === '(') {
    let subPartNum = 1;
    while (ctx.pos < tokens.length && tokens[ctx.pos] === '(') {
      const subPath = path ? `${path}.${subPartNum}` : String(subPartNum);
      attachments.push(...parseMimePart(tokens, ctx, subPath));
      subPartNum++;
    }
    let depth = 1;
    while (ctx.pos < tokens.length && depth > 0) {
      if (tokens[ctx.pos] === '(') depth++;
      else if (tokens[ctx.pos] === ')') depth--;
      ctx.pos++;
    }
  } else {
    const startPos = ctx.pos;
    const type = tokens[ctx.pos++] || 'unknown';
    const subtype = tokens[ctx.pos++] || 'unknown';
    const contentType = `${type}/${subtype}`.toLowerCase();
    
    if (tokens[ctx.pos] === '(') {
      let depth = 1; ctx.pos++;
      while (ctx.pos < tokens.length && depth > 0) {
        if (tokens[ctx.pos] === '(') depth++;
        else if (tokens[ctx.pos] === ')') depth--;
        ctx.pos++;
      }
    } else { ctx.pos++; }
    
    ctx.pos++; // id
    ctx.pos++; // description
    const encoding = (tokens[ctx.pos++] || 'base64').toLowerCase();
    const sizeStr = tokens[ctx.pos++] || '0';
    const size = parseInt(sizeStr, 10) || 0;
    
    let depth = 1;
    const dispositionSearchStart = ctx.pos;
    while (ctx.pos < tokens.length && depth > 0) {
      if (tokens[ctx.pos] === '(') depth++;
      else if (tokens[ctx.pos] === ')') depth--;
      ctx.pos++;
    }
    
    if (contentType !== 'text/plain' && contentType !== 'text/html') {
      let filename = extractFilenameFromParams(tokens, startPos);
      if (!filename) {
        for (let i = dispositionSearchStart; i < ctx.pos; i++) {
          const tok = tokens[i]?.toLowerCase();
          if (tok === 'attachment' || tok === 'inline') {
            filename = extractFilenameFromParams(tokens, i);
            if (filename) break;
          }
        }
      }
      if (!filename) {
        const extMap: Record<string, string> = {
          'application/pdf': '.pdf',
          'application/vnd.ms-excel': '.xls',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
          'application/msword': '.doc',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
          'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
        };
        const ext = extMap[contentType] || '';
        filename = `attachment_${path || '1'}${ext}`;
      }
      const partNumber = path || '1';
      console.log(`[BODYSTRUCTURE] Found attachment: ${filename} at part ${partNumber} (${contentType}, ${size} bytes, ${encoding})`);
      attachments.push({ partNumber, filename, contentType, encoding, size });
    }
  }
  return attachments;
}

// Extract BODYSTRUCTURE using balanced parenthesis counting
function extractBodyStructure(response: string): string {
  const marker = 'BODYSTRUCTURE ';
  const upperResponse = response.toUpperCase();
  const start = upperResponse.indexOf(marker);
  if (start === -1) return '';
  let depth = 0;
  const structureStart = start + marker.length;
  let structureEnd = structureStart;
  let started = false;
  for (let i = structureStart; i < response.length; i++) {
    if (response[i] === '(') { if (!started) started = true; depth++; }
    if (response[i] === ')') {
      depth--;
      if (started && depth === 0) { structureEnd = i + 1; break; }
    }
  }
  return response.substring(structureStart, structureEnd);
}

// Find part number by counting nested sections before position
function findPartNumberByPosition(structure: string, position: number): string {
  const before = structure.substring(0, position);
  let depth = 0; let partNum = 0;
  for (const char of before) {
    if (char === '(') { depth++; if (depth === 2) partNum++; }
    if (char === ')') depth--;
  }
  return String(partNum || 1);
}

// Parse BODYSTRUCTURE to find attachments with correct MIME part numbers
function parseBodyStructure(response: string): AttachmentInfo[] {
  console.log(`[BODYSTRUCTURE] Parsing response (${response.length} chars)`);
  const structure = extractBodyStructure(response);
  if (!structure || structure.length < 10) {
    console.log("[BODYSTRUCTURE] No BODYSTRUCTURE match found in response");
    return [];
  }
  console.log(`[BODYSTRUCTURE] Extracted structure (${structure.length} chars)`);
  
  const tokens = tokenizeBodyStructure(structure);
  const ctx: ParseContext = { pos: 0 };
  const attachments = parseMimePart(tokens, ctx, '');
  
  // Fallback: Search by file extension
  const extensionPattern = /["']([^"']*\.(?:xlsx?|pdf|docx?|csv|zip|rar|pptx?))["']/gi;
  let extMatch;
  while ((extMatch = extensionPattern.exec(structure)) !== null) {
    const filename = decodeHeader(extMatch[1]);
    const lowerFilename = filename.toLowerCase();
    if (attachments.some(a => a.filename === filename)) continue;
    if (lowerFilename.startsWith('~') || lowerFilename.startsWith('image0') || lowerFilename.includes('signature')) continue;
    
    let contentType = 'application/octet-stream';
    if (lowerFilename.endsWith('.pdf')) contentType = 'application/pdf';
    else if (lowerFilename.endsWith('.xlsx')) contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    else if (lowerFilename.endsWith('.xls')) contentType = 'application/vnd.ms-excel';
    else if (lowerFilename.endsWith('.docx')) contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    else if (lowerFilename.endsWith('.doc')) contentType = 'application/msword';
    else if (lowerFilename.endsWith('.csv')) contentType = 'text/csv';
    
    const partNumber = findPartNumberByPosition(structure, extMatch.index);
    console.log(`[BODYSTRUCTURE] Found attachment by extension: ${filename} -> part ${partNumber}`);
    attachments.push({ partNumber, filename, contentType, encoding: 'base64', size: 0 });
  }
  
  console.log(`[BODYSTRUCTURE] Total: ${attachments.length} attachment(s)`);
  for (const att of attachments) {
    console.log(`  - Part ${att.partNumber}: ${att.filename} (${att.contentType}, ${att.size} bytes)`);
  }
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
        is_analyzed: false,
        extracted_text: null,
        extracted_data: null,
        analysis_claimed_at: null,
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
