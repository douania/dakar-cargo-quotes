import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireAdmin } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============ EMAIL FILTERING CONFIGURATION ============
// (Must match sync-emails function)

const EXCLUDED_SENDERS = [
  'banqueatlantique.net', 'banqueatlantique.com',
  'afrikabanque.sn', 'afrikabanque.com',
  'ecobank.com', 'ecobank.sn',
  'sgbs.sn', 'societegenerale.sn',
  'bicis.sn', 'bnpparibas',
  'cbao.sn', 'attijariwafa',
  'oaborable.sn', 'banque',
  'linkedin.com', 'linkedinmail.com',
  'facebook.com', 'facebookmail.com',
  'twitter.com', 'x.com',
  'broadcast@wcabroadcast.com', 'wcabroadcast.com',
  'newsletter', 'noreply', 'no-reply', 'donotreply', 'do-not-reply',
  'mailer-daemon', 'postmaster',
  'mailchimp', 'sendgrid', 'mailgun',
  '@sodatra.sn',
  'google.com', 'accounts.google',
  'microsoft.com', 'office365',
  'zoom.us', 'teams.microsoft',
  'dropbox.com', 'wetransfer.com'
];

// Subjects that indicate non-quotation emails (but check for false positives)
// Note: 'spam:' is handled specially - it's often just an Outlook tag, not real spam
const EXCLUDED_SUBJECTS = [
  // Notifications bancaires (hard exclusions)
  'notification de credit', 'notification de débit', 'notification de debit',
  'avis de credit', 'avis de débit', 'avis de debit',
  'encours ligne', 'relevé de compte', 'releve de compte',
  'virement reçu', 'virement recu', 'transfert reçu',
  'solde de compte', 'état de compte',
  'alerte compte', 'mouvement compte',
  // LinkedIn
  'a publié récemment', 'has posted', 'a partagé',
  'invitation à se connecter', 'wants to connect',
  'a consulté votre profil', 'viewed your profile',
  'new job', 'nouveau poste',
  // Newsletters/Marketing
  'holiday operating hours', 'operating hours update',
  'membership updates', 'membership renewal',
  'annual conference', 'webinar invitation',
  'unsubscribe', 'se désabonner',
  // Sécurité/Système
  'new login from', 'nouvelle connexion',
  'password reset', 'réinitialisation mot de passe',
  'verify your email', 'vérifiez votre email',
  'account security', 'sécurité du compte',
  // Autres
  'out of office', 'absence du bureau', 'automatic reply', 'réponse automatique'
];

// Clean Outlook spam prefix from subject
function cleanSpamPrefix(subject: string): string {
  return (subject || '')
    .replace(/^Spam:\**,?\s*/i, '')
    .replace(/^\[Spam\]\s*/i, '')
    .replace(/^\*+Spam\*+:?\s*/i, '')
    .trim();
}

const QUOTATION_KEYWORDS = [
  'demande de cotation', 'request for quotation', 'rfq',
  'demande de devis', 'request for quote', 'devis',
  'demande de prix', 'price request', 'pricing request',
  'besoin de cotation', 'need a quote', 'quote request',
  'dap ', 'cif ', 'fob ', 'exw ', 'cfr ', 'cpt ', 'cip ', 'ddp ',
  'dap:', 'cif:', 'fob:', 'exw:',
  'sea freight', 'ocean freight', 'fret maritime',
  'air freight', 'fret aérien', 'fret aerien',
  'door to door', 'port to port',
  'conteneur 20', 'conteneur 40', '20dv', '40dv', '40hc', '20gp', '40gp',
  'container 20', 'container 40', 'fcl', 'lcl',
  'breakbulk', 'roro', 'ro-ro', 'projet cargo', 'project cargo',
  'conventionnel', 'conventional cargo', 'vrac', 'bulk cargo',
  'dédouanement', 'dedouanement', 'customs clearance',
  'droits de douane', 'duty structure', 'hs code',
  'régime douanier', 'regime douanier', 'mise à la consommation',
  'transit request', 'trucking request', 'transport request',
  'livraison', 'delivery to', 'acheminement',
  'dakar port', 'port de dakar', 'pad ', 'dpw dakar'
];

function isQuotationRelated(from: string, subject: string, body: string): boolean {
  const fromLower = from.toLowerCase();
  // Clean spam prefix before checking subject
  const cleanedSubject = cleanSpamPrefix(subject);
  const subjectLower = cleanedSubject.toLowerCase();
  const bodyLower = body.toLowerCase();
  
  // 1. EXCLURE si expéditeur dans la liste noire
  if (EXCLUDED_SENDERS.some(sender => fromLower.includes(sender.toLowerCase()))) {
    return false;
  }
  
  // 2. EXCLURE si sujet (nettoyé) dans la liste noire
  if (EXCLUDED_SUBJECTS.some(subj => subjectLower.includes(subj.toLowerCase()))) {
    return false;
  }
  
  // 3. INCLURE si mots-clés positifs trouvés dans sujet ou corps
  const text = `${subjectLower} ${bodyLower}`;
  return QUOTATION_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
}

// ============ REIMPORT IMAP CLIENT (minimal, for attachment backfill) ============

interface AttachmentInfo {
  partNumber: string;
  filename: string;
  contentType: string;
  encoding: string;
  size: number;
}

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
      while (end < structure.length && /[A-Za-z0-9._\-]/.test(structure[end])) end++;
      tokens.push(structure.substring(i, end));
      i = end;
      continue;
    }
    i++;
  }
  return tokens;
}

function extractFilenameFromParams(tokens: string[], startIdx: number): string {
  let filename = '';
  for (let i = startIdx; i < Math.min(startIdx + 100, tokens.length); i++) {
    const token = tokens[i]?.toLowerCase();
    if (token === 'name' || token === 'filename') {
      for (let j = i + 1; j < Math.min(i + 5, tokens.length); j++) {
        const val = tokens[j];
        if (val && val !== '(' && val !== ')' && val.toLowerCase() !== 'nil') { filename = decodeHeader(val); break; }
      }
      if (filename) break;
    }
    if (token && token.startsWith('filename*')) {
      for (let j = i + 1; j < Math.min(i + 5, tokens.length); j++) {
        const val = tokens[j];
        if (val && val !== '(' && val !== ')' && val.toLowerCase() !== 'nil') {
          const match = val.match(/(?:UTF-8''|utf-8'')?(.*)/i);
          if (match) { try { filename = decodeURIComponent(match[1] || val); } catch { filename = match[1] || val; } }
          break;
        }
      }
      if (filename) break;
    }
  }
  return filename;
}

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
    while (ctx.pos < tokens.length && depth > 0) { if (tokens[ctx.pos] === '(') depth++; else if (tokens[ctx.pos] === ')') depth--; ctx.pos++; }
  } else {
    const startPos = ctx.pos;
    const type = tokens[ctx.pos++] || 'unknown';
    const subtype = tokens[ctx.pos++] || 'unknown';
    const contentType = `${type}/${subtype}`.toLowerCase();
    if (tokens[ctx.pos] === '(') {
      let depth = 1; ctx.pos++;
      while (ctx.pos < tokens.length && depth > 0) { if (tokens[ctx.pos] === '(') depth++; else if (tokens[ctx.pos] === ')') depth--; ctx.pos++; }
    } else { ctx.pos++; }
    ctx.pos++; ctx.pos++;
    const encoding = (tokens[ctx.pos++] || 'base64').toLowerCase();
    const size = parseInt(tokens[ctx.pos++] || '0', 10) || 0;
    let depth = 1;
    const dispositionSearchStart = ctx.pos;
    while (ctx.pos < tokens.length && depth > 0) { if (tokens[ctx.pos] === '(') depth++; else if (tokens[ctx.pos] === ')') depth--; ctx.pos++; }
    if (contentType !== 'text/plain' && contentType !== 'text/html') {
      let filename = extractFilenameFromParams(tokens, startPos);
      if (!filename) {
        for (let i = dispositionSearchStart; i < ctx.pos; i++) {
          const tok = tokens[i]?.toLowerCase();
          if (tok === 'attachment' || tok === 'inline') { filename = extractFilenameFromParams(tokens, i); if (filename) break; }
        }
      }
      if (!filename) {
        const extMap: Record<string, string> = { 'application/pdf': '.pdf', 'application/vnd.ms-excel': '.xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx', 'application/msword': '.doc', 'image/jpeg': '.jpg', 'image/png': '.png' };
        filename = `attachment_${path || '1'}${extMap[contentType] || ''}`;
      }
      attachments.push({ partNumber: path || '1', filename, contentType, encoding, size });
    }
  }
  return attachments;
}

function extractBodyStructure(response: string): string {
  const marker = 'BODYSTRUCTURE ';
  const start = response.toUpperCase().indexOf(marker);
  if (start === -1) return '';
  let depth = 0, structureStart = start + marker.length, structureEnd = structureStart, started = false;
  for (let i = structureStart; i < response.length; i++) {
    if (response[i] === '(') { if (!started) started = true; depth++; }
    if (response[i] === ')') { depth--; if (started && depth === 0) { structureEnd = i + 1; break; } }
  }
  return response.substring(structureStart, structureEnd);
}

function findPartNumberByPosition(structure: string, position: number): string {
  const before = structure.substring(0, position);
  let depth = 0, partNum = 0;
  for (const char of before) { if (char === '(') { depth++; if (depth === 2) partNum++; } if (char === ')') depth--; }
  return String(partNum || 1);
}

function parseBodyStructure(response: string): AttachmentInfo[] {
  const structure = extractBodyStructure(response);
  if (!structure || structure.length < 10) return [];
  const tokens = tokenizeBodyStructure(structure);
  const ctx: ParseContext = { pos: 0 };
  const attachments = parseMimePart(tokens, ctx, '');
  const extensionPattern = /["']([^"']*\.(?:xlsx?|pdf|docx?|csv|zip|rar|pptx?))["']/gi;
  let extMatch;
  while ((extMatch = extensionPattern.exec(structure)) !== null) {
    const filename = decodeHeader(extMatch[1]);
    if (attachments.some(a => a.filename === filename)) continue;
    if (filename.toLowerCase().startsWith('~') || filename.toLowerCase().includes('signature')) continue;
    let contentType = 'application/octet-stream';
    if (filename.toLowerCase().endsWith('.pdf')) contentType = 'application/pdf';
    else if (filename.toLowerCase().endsWith('.xlsx')) contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    attachments.push({ partNumber: findPartNumberByPosition(structure, extMatch.index), filename, contentType, encoding: 'base64', size: 0 });
  }
  return attachments;
}

function decodeBase64Chunked(content: string): Uint8Array {
  try {
    const cleaned = content.replace(/[\r\n\s]/g, '');
    if (cleaned.length === 0) return new Uint8Array(0);
    const CHUNK_SIZE = 32768;
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < cleaned.length; i += CHUNK_SIZE) {
      let chunk = cleaned.substring(i, Math.min(i + CHUNK_SIZE, cleaned.length));
      if (i + CHUNK_SIZE < cleaned.length) { const r = chunk.length % 4; if (r !== 0) chunk = chunk.substring(0, chunk.length - r); }
      try { const d = atob(chunk); chunks.push(new Uint8Array([...d].map(c => c.charCodeAt(0)))); } catch { continue; }
    }
    const totalLength = chunks.reduce((s, c) => s + c.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const c of chunks) { result.set(c, offset); offset += c.length; }
    return result;
  } catch { return new Uint8Array(0); }
}

function decodeQuotedPrintableAttachment(content: string): Uint8Array {
  const decoded = content.replace(/=\r\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  return new TextEncoder().encode(decoded);
}

class ReimportIMAPClient {
  private conn: Deno.TlsConn | null = null;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  private tagCounter = 0;

  constructor(private host: string, private port: number, private useSsl: boolean) {}
  private getTag(): string { return `R${++this.tagCounter}`; }

  async connect(): Promise<void> {
    if (this.useSsl) {
      this.conn = await Deno.connectTls({ hostname: this.host, port: this.port });
    } else {
      const tcp = await Deno.connect({ hostname: this.host, port: this.port });
      this.conn = tcp as unknown as Deno.TlsConn;
    }
    await this.readUntilTag('*');
  }

  private async readUntilTag(tag: string): Promise<string> {
    let result = '';
    const buf = new Uint8Array(8192);
    const MAX_READ = 50 * 1024 * 1024;
    while (result.length < MAX_READ) {
      const n = await this.conn!.read(buf);
      if (n === null) break;
      result += this.decoder.decode(buf.subarray(0, n));
      if (tag === '*') { if (result.includes('\r\n')) break; }
      else if (result.includes(`${tag} OK`) || result.includes(`${tag} NO`) || result.includes(`${tag} BAD`)) break;
    }
    return result;
  }

  private async sendCommand(command: string): Promise<string> {
    const tag = this.getTag();
    await this.conn!.write(this.encoder.encode(`${tag} ${command}\r\n`));
    return await this.readUntilTag(tag);
  }

  async login(username: string, password: string): Promise<boolean> {
    const response = await this.sendCommand(`LOGIN "${username}" "${password}"`);
    return response.includes('OK');
  }

  async select(mailbox: string): Promise<void> { await this.sendCommand(`SELECT "${mailbox}"`); }

  async searchByMessageId(messageId: string): Promise<number | null> {
    const cleanId = messageId.replace(/[<>]/g, '');
    const response = await this.sendCommand(`UID SEARCH HEADER Message-ID "<${cleanId}>"`);
    const match = response.match(/\* SEARCH\s+(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  async fetchBodyStructure(uid: number): Promise<AttachmentInfo[]> {
    const response = await this.sendCommand(`UID FETCH ${uid} BODYSTRUCTURE`);
    return parseBodyStructure(response);
  }

  async fetchAttachment(uid: number, partNumber: string, encoding: string): Promise<Uint8Array> {
    const response = await this.sendCommand(`UID FETCH ${uid} BODY.PEEK[${partNumber}]`);
    let rawContent = '';
    const literalMatch = response.match(/BODY\[[\d.]+\]\s*\{(\d+)\}/i);
    if (literalMatch) {
      const expectedSize = parseInt(literalMatch[1], 10);
      const marker = `{${expectedSize}}`;
      const afterBrace = response.indexOf(marker) + marker.length;
      let contentStart = afterBrace;
      if (response.substring(afterBrace, afterBrace + 2) === '\r\n') contentStart = afterBrace + 2;
      else if (response[afterBrace] === '\n') contentStart = afterBrace + 1;
      rawContent = response.substring(contentStart, contentStart + expectedSize);
    }
    if (!rawContent) {
      const quotedMatch = response.match(/BODY\[[\d.]+\]\s+"([^"]*)"/i);
      if (quotedMatch?.[1]) rawContent = quotedMatch[1];
    }
    if (!rawContent) return new Uint8Array(0);
    if (encoding.toLowerCase() === 'base64') return decodeBase64Chunked(rawContent);
    if (encoding.toLowerCase() === 'quoted-printable') return decodeQuotedPrintableAttachment(rawContent);
    return new TextEncoder().encode(rawContent);
  }

  async logout(): Promise<void> {
    try { await this.sendCommand('LOGOUT'); } catch { /* ignore */ }
    try { this.conn?.close(); } catch { /* ignore */ }
  }
}


  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Phase S0: Admin guard (before service-role client)
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { action, data } = await req.json();

    console.log(`Email admin action: ${action}`);

    switch (action) {
      case 'get_all': {
        // OPTIMIZED: Fetch only configs and counts to reduce memory usage
        // Emails/threads are paginated separately via get_emails_paginated
        const [configsRes, emailCountRes, draftCountRes, threadCountRes] = await Promise.all([
          supabase.from('email_configs').select('*').order('created_at', { ascending: false }),
          supabase.from('emails').select('id', { count: 'exact', head: true }),
          supabase.from('email_drafts').select('id', { count: 'exact', head: true }),
          supabase.from('email_threads').select('id', { count: 'exact', head: true })
        ]);

        // Mask passwords in configs
        const configs = (configsRes.data || []).map(config => ({
          ...config,
          password_encrypted: '********' // Never expose passwords
        }));

        return new Response(
          JSON.stringify({
            success: true,
            configs,
            counts: {
              emails: emailCountRes.count || 0,
              drafts: draftCountRes.count || 0,
              threads: threadCountRes.count || 0
            },
            // Return empty arrays for backward compatibility - clients should use get_emails_paginated
            emails: [],
            drafts: [],
            attachments: [],
            threads: []
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'get_emails_paginated': {
        // Paginated email fetching to avoid memory issues
        const page = data?.page || 0;
        const pageSize = Math.min(data?.pageSize || 50, 100); // Max 100 per page
        const from = page * pageSize;
        const to = from + pageSize - 1;

        const { data: emails, error, count } = await supabase
          .from('emails')
          .select('id, from_address, subject, sent_at, is_quotation_request, thread_ref', { count: 'exact' })
          .order('sent_at', { ascending: false })
          .range(from, to);

        if (error) throw error;

        return new Response(
          JSON.stringify({
            success: true,
            emails: emails || [],
            totalCount: count || 0,
            page,
            pageSize
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'get_threads_paginated': {
        // Paginated thread fetching
        const page = data?.page || 0;
        const pageSize = Math.min(data?.pageSize || 30, 50); // Max 50 per page
        const from = page * pageSize;
        const to = from + pageSize - 1;

        const { data: threads, error, count } = await supabase
          .from('email_threads')
          .select('id, subject_normalized, email_count, last_message_at, is_quotation_thread, client_email, our_role', { count: 'exact' })
          .order('last_message_at', { ascending: false })
          .range(from, to);

        if (error) throw error;

        return new Response(
          JSON.stringify({
            success: true,
            threads: threads || [],
            totalCount: count || 0,
            page,
            pageSize
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'add_config': {
        const { name, host, port, username, password, folder, use_ssl } = data;
        
        if (!name || !host || !username || !password) {
          throw new Error("Champs requis manquants");
        }

        const { data: config, error } = await supabase
          .from('email_configs')
          .insert({
            name,
            host,
            port: port || 993,
            username,
            password_encrypted: password,
            folder: folder || 'INBOX',
            use_ssl: use_ssl !== false
          })
          .select()
          .single();

        if (error) throw error;

        return new Response(
          JSON.stringify({ 
            success: true, 
            config: { ...config, password_encrypted: '********' }
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'delete_config': {
        const { configId } = data;
        
        if (!configId) throw new Error("configId requis");

        const { error } = await supabase
          .from('email_configs')
          .delete()
          .eq('id', configId);

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'delete_email': {
        const { emailId } = data;
        
        if (!emailId) throw new Error("emailId requis");

        // Get attachments to delete from storage
        const { data: attachments } = await supabase
          .from('email_attachments')
          .select('storage_path')
          .eq('email_id', emailId);

        // Delete files from storage
        if (attachments && attachments.length > 0) {
          const paths = attachments
            .filter(a => a.storage_path)
            .map(a => a.storage_path as string);
          
          if (paths.length > 0) {
            await supabase.storage.from('documents').remove(paths);
          }
        }

        // Delete attachments
        await supabase
          .from('email_attachments')
          .delete()
          .eq('email_id', emailId);

        // Delete related learned knowledge
        await supabase
          .from('learned_knowledge')
          .delete()
          .eq('source_id', emailId)
          .eq('source_type', 'email');

        // Delete related drafts
        await supabase
          .from('email_drafts')
          .delete()
          .eq('original_email_id', emailId);

        // Delete the email
        const { error } = await supabase
          .from('emails')
          .delete()
          .eq('id', emailId);

        if (error) throw error;

        console.log(`Deleted email ${emailId} and related data`);

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'delete_emails': {
        const { emailIds } = data;
        
        if (!emailIds || !Array.isArray(emailIds) || emailIds.length === 0) {
          throw new Error("emailIds requis (tableau)");
        }

        let deletedCount = 0;

        for (const emailId of emailIds) {
          try {
            // Get attachments
            const { data: attachments } = await supabase
              .from('email_attachments')
              .select('storage_path')
              .eq('email_id', emailId);

            // Delete files from storage
            if (attachments && attachments.length > 0) {
              const paths = attachments
                .filter(a => a.storage_path)
                .map(a => a.storage_path as string);
              
              if (paths.length > 0) {
                await supabase.storage.from('documents').remove(paths);
              }
            }

            // Delete attachments
            await supabase
              .from('email_attachments')
              .delete()
              .eq('email_id', emailId);

            // Delete related learned knowledge
            await supabase
              .from('learned_knowledge')
              .delete()
              .eq('source_id', emailId)
              .eq('source_type', 'email');

            // Delete related drafts
            await supabase
              .from('email_drafts')
              .delete()
              .eq('original_email_id', emailId);

            // Delete the email
            await supabase
              .from('emails')
              .delete()
              .eq('id', emailId);

            deletedCount++;
          } catch (err) {
            console.error(`Error deleting email ${emailId}:`, err);
          }
        }

        console.log(`Deleted ${deletedCount}/${emailIds.length} emails`);

        return new Response(
          JSON.stringify({ success: true, deleted: deletedCount }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'purge_non_quotation': {
        // Get all non-quotation emails
        const { data: nonQuotationEmails, error: fetchError } = await supabase
          .from('emails')
          .select('id')
          .eq('is_quotation_request', false);

        if (fetchError) throw fetchError;

        if (!nonQuotationEmails || nonQuotationEmails.length === 0) {
          return new Response(
            JSON.stringify({ success: true, deleted: 0, message: "Aucun email à purger" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const emailIds = nonQuotationEmails.map(e => e.id);
        let deletedCount = 0;

        for (const emailId of emailIds) {
          try {
            // Get attachments
            const { data: attachments } = await supabase
              .from('email_attachments')
              .select('storage_path')
              .eq('email_id', emailId);

            // Delete files from storage
            if (attachments && attachments.length > 0) {
              const paths = attachments
                .filter(a => a.storage_path)
                .map(a => a.storage_path as string);
              
              if (paths.length > 0) {
                await supabase.storage.from('documents').remove(paths);
              }
            }

            // Delete attachments
            await supabase
              .from('email_attachments')
              .delete()
              .eq('email_id', emailId);

            // Delete related learned knowledge
            await supabase
              .from('learned_knowledge')
              .delete()
              .eq('source_id', emailId)
              .eq('source_type', 'email');

            // Delete related drafts
            await supabase
              .from('email_drafts')
              .delete()
              .eq('original_email_id', emailId);

            // Delete the email
            await supabase
              .from('emails')
              .delete()
              .eq('id', emailId);

            deletedCount++;
          } catch (err) {
            console.error(`Error deleting email ${emailId}:`, err);
          }
        }

        console.log(`Purged ${deletedCount} non-quotation emails`);

        return new Response(
          JSON.stringify({ success: true, deleted: deletedCount }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'get_email': {
        const { emailId } = data;
        
        if (!emailId) throw new Error("emailId requis");

        const { data: email, error } = await supabase
          .from('emails')
          .select('*')
          .eq('id', emailId)
          .single();

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, email }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'get_drafts': {
        const { data: drafts, error } = await supabase
          .from('email_drafts')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, drafts }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'update_draft': {
        const { draftId, updates } = data;
        
        if (!draftId) throw new Error("draftId requis");

        const { data: draft, error } = await supabase
          .from('email_drafts')
          .update(updates)
          .eq('id', draftId)
          .select()
          .single();

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, draft }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'delete_draft': {
        const { draftId } = data;
        
        if (!draftId) throw new Error("draftId requis");

        const { error } = await supabase
          .from('email_drafts')
          .delete()
          .eq('id', draftId);

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'reclassify_emails': {
        // Recalculate is_quotation_request for all existing emails
        console.log('Starting email reclassification...');
        
        // Fetch all emails with pagination
        let allEmails: Array<{ id: string; from_address: string; subject: string | null; body_text: string | null; body_html: string | null }> = [];
        let offset = 0;
        const pageSize = 500;
        
        while (true) {
          const { data: batch, error } = await supabase
            .from('emails')
            .select('id, from_address, subject, body_text, body_html')
            .range(offset, offset + pageSize - 1);
          
          if (error) throw error;
          if (!batch || batch.length === 0) break;
          
          allEmails = allEmails.concat(batch);
          offset += pageSize;
        }
        
        console.log(`Reclassifying ${allEmails.length} emails...`);
        
        let reclassified = 0;
        
        for (const email of allEmails) {
          const isQuotation = isQuotationRelated(
            email.from_address,
            email.subject || '',
            email.body_text || email.body_html || ''
          );
          
          await supabase
            .from('emails')
            .update({ is_quotation_request: isQuotation })
            .eq('id', email.id);
          
          reclassified++;
        }
        
        console.log(`Reclassified ${reclassified} emails`);
        
        return new Response(
          JSON.stringify({ success: true, reclassified }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'reimport_attachments': {
        // MODE 1: Targeted thread reimport via IMAP
        if (data?.thread_id) {
          console.log(`[reimport_attachments] Targeted mode for thread_id=${data.thread_id}`);
          
          // 1. Get all emails in the thread
          const { data: threadEmails, error: threadErr } = await supabase
            .from('emails')
            .select('id, message_id, email_config_id, subject')
            .eq('thread_ref', data.thread_id)
            .order('sent_at', { ascending: true });
          
          if (threadErr) throw threadErr;
          if (!threadEmails || threadEmails.length === 0) {
            return new Response(
              JSON.stringify({ success: true, message: 'Aucun email trouvé pour ce thread', imported: 0 }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          
          // 2. Check which emails already have attachments
          const emailIds = threadEmails.map(e => e.id);
          const { data: existingAtts } = await supabase
            .from('email_attachments')
            .select('email_id')
            .in('email_id', emailIds);
          
          const emailsWithAtts = new Set((existingAtts || []).map(a => a.email_id));
          const emailsToProcess = threadEmails.filter(e => !emailsWithAtts.has(e.id));
          
          if (emailsToProcess.length === 0) {
            return new Response(
              JSON.stringify({ success: true, message: 'Tous les emails ont déjà des pièces jointes enregistrées', imported: 0 }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          
          // 3. Group by config_id and process via IMAP
          const configGroups = new Map<string, typeof emailsToProcess>();
          for (const email of emailsToProcess) {
            if (!email.email_config_id) continue;
            if (!configGroups.has(email.email_config_id)) {
              configGroups.set(email.email_config_id, []);
            }
            configGroups.get(email.email_config_id)!.push(email);
          }
          
          let totalImported = 0;
          const errors: string[] = [];
          
          for (const [configId, emails] of configGroups) {
            // Get config
            const { data: config, error: configErr } = await supabase
              .from('email_configs')
              .select('*')
              .eq('id', configId)
              .single();
            
            if (configErr || !config) {
              errors.push(`Config ${configId} introuvable`);
              continue;
            }
            
            // Connect IMAP
            let imapClient: ReimportIMAPClient | null = null;
            try {
              imapClient = new ReimportIMAPClient(config.host, config.port, config.use_ssl !== false);
              await imapClient.connect();
              const loggedIn = await imapClient.login(config.username, config.password_encrypted);
              if (!loggedIn) { errors.push(`Auth IMAP échouée pour ${config.name}`); continue; }
              await imapClient.select(config.folder || 'INBOX');
              
              for (const email of emails) {
                try {
                  // Find UID by Message-ID
                  const uid = await imapClient.searchByMessageId(email.message_id);
                  if (!uid) {
                    console.warn(`[reimport_attachments] UID not found for message_id=${email.message_id}`);
                    continue;
                  }
                  
                  // Get BODYSTRUCTURE
                  const attachments = await imapClient.fetchBodyStructure(uid);
                  if (attachments.length === 0) {
                    console.log(`[reimport_attachments] No attachments for ${email.subject}`);
                    continue;
                  }
                  
                  for (const att of attachments) {
                    // Skip inline images
                    if (att.contentType.startsWith('image/') && att.filename.startsWith('image')) continue;
                    
                    // Idempotency guard
                    const { data: existing } = await supabase
                      .from('email_attachments')
                      .select('id')
                      .eq('email_id', email.id)
                      .eq('filename', att.filename)
                      .maybeSingle();
                    
                    if (existing) continue;
                    
                    // Size check (5MB limit)
                    if (att.size > 5 * 1024 * 1024) {
                      const { error: insertErr } = await supabase.from('email_attachments').insert({
                        email_id: email.id,
                        filename: att.filename,
                        content_type: att.contentType,
                        size: att.size,
                        storage_path: null,
                        is_analyzed: false,
                        extracted_text: `[Pièce jointe trop volumineuse: ${(att.size / 1024 / 1024).toFixed(2)}MB]`
                      });
                      if (insertErr) console.warn(`[reimport_attachments] Insert error:`, insertErr.message);
                      totalImported++;
                      continue;
                    }
                    
                    // Download
                    const content = await imapClient.fetchAttachment(uid, att.partNumber, att.encoding);
                    if (content.length === 0) continue;
                    
                    // Upload
                    const safeName = att.filename.replace(/[^a-zA-Z0-9.-]/g, '_');
                    const storagePath = `email-attachments/${email.id}/${Date.now()}_${safeName}`;
                    
                    const { error: uploadErr } = await supabase.storage
                      .from('documents')
                      .upload(storagePath, content, { contentType: att.contentType, upsert: true });
                    
                    const finalPath = uploadErr ? null : storagePath;
                    if (uploadErr) console.warn(`[reimport_attachments] Upload error:`, uploadErr.message);
                    
                    const { error: insertErr } = await supabase.from('email_attachments').insert({
                      email_id: email.id,
                      filename: att.filename,
                      content_type: att.contentType,
                      size: content.length,
                      storage_path: finalPath,
                      is_analyzed: false,
                    });
                    if (insertErr) console.warn(`[reimport_attachments] Insert error:`, insertErr.message);
                    else totalImported++;
                  }
                } catch (emailErr) {
                  console.error(`[reimport_attachments] Error processing email ${email.id}:`, emailErr);
                  errors.push(`Email ${email.id}: ${emailErr instanceof Error ? emailErr.message : String(emailErr)}`);
                }
              }
              
              await imapClient.logout();
            } catch (imapErr) {
              console.error(`[reimport_attachments] IMAP error for config ${configId}:`, imapErr);
              errors.push(`IMAP ${config.name}: ${imapErr instanceof Error ? imapErr.message : String(imapErr)}`);
              if (imapClient) try { await imapClient.logout(); } catch { /* ignore */ }
            }
          }
          
          return new Response(
            JSON.stringify({
              success: true,
              imported: totalImported,
              emailsProcessed: emailsToProcess.length,
              errors: errors.length > 0 ? errors : undefined,
              message: `${totalImported} pièce(s) jointe(s) importée(s) depuis ${emailsToProcess.length} email(s)`
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        
        // MODE 2: Heuristic scan (existing behavior)
        console.log('Starting attachment reimport scan...');
        
        // Get emails with potential attachments (based on size or keywords)
        const { data: emails, error: fetchError } = await supabase
          .from('emails')
          .select(`
            id, 
            message_id, 
            email_config_id,
            subject,
            body_text,
            from_address
          `)
          .order('sent_at', { ascending: false })
          .limit(data?.limit || 50);
        
        if (fetchError) throw fetchError;
        
        if (!emails || emails.length === 0) {
          return new Response(
            JSON.stringify({ success: true, scanned: 0, needsReimport: [] }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        
        // Check which emails have PDF/Excel attachments already
        const emailIds = emails.map(e => e.id);
        const { data: existingAttachments } = await supabase
          .from('email_attachments')
          .select('email_id, filename, content_type')
          .in('email_id', emailIds);
        
        // Find emails without PDF/Excel attachments
        const attachmentMap = new Map<string, Array<{ filename: string; content_type: string }>>();
        for (const att of existingAttachments || []) {
          if (!attachmentMap.has(att.email_id)) {
            attachmentMap.set(att.email_id, []);
          }
          attachmentMap.get(att.email_id)!.push({ 
            filename: att.filename, 
            content_type: att.content_type || '' 
          });
        }
        
        const needsReimport: Array<{
          id: string;
          subject: string;
          from: string;
          currentAttachments: string[];
          reason: string;
        }> = [];
        
        for (const email of emails) {
          const attachments = attachmentMap.get(email.id) || [];
          
          const bodyLower = (email.body_text || '').toLowerCase();
          const subjectLower = (email.subject || '').toLowerCase();
          const text = `${subjectLower} ${bodyLower}`;
          
          const mentionsAttachment = 
            text.includes('pièce jointe') ||
            text.includes('piece jointe') ||
            text.includes('ci-joint') ||
            text.includes('attached') ||
            text.includes('attachment') ||
            text.includes('.pdf') ||
            text.includes('.xlsx') ||
            text.includes('.xls') ||
            text.includes('cotation') ||
            text.includes('quotation') ||
            text.includes('devis') ||
            text.includes('tarif');
          
          const hasPdfOrExcel = attachments.some(a => {
            const ct = (a.content_type || '').toLowerCase();
            const fn = (a.filename || '').toLowerCase();
            return ct.includes('pdf') || 
                   ct.includes('excel') || 
                   ct.includes('spreadsheet') ||
                   fn.endsWith('.pdf') ||
                   fn.endsWith('.xlsx') ||
                   fn.endsWith('.xls');
          });
          
          const onlyHasImages = attachments.length > 0 && attachments.every(a => {
            const ct = (a.content_type || '').toLowerCase();
            return ct.startsWith('image/');
          });
          
          let reason = '';
          if (mentionsAttachment && attachments.length === 0) {
            reason = 'Mentions pièces jointes mais aucune enregistrée';
          } else if (mentionsAttachment && !hasPdfOrExcel && onlyHasImages) {
            reason = 'Mentionne pièces jointes mais seulement des images (signatures)';
          } else if (attachments.length === 0 && (
            subjectLower.includes('cotation') ||
            subjectLower.includes('quotation') ||
            subjectLower.includes('offre') ||
            subjectLower.includes('tarif')
          )) {
            reason = 'Email de cotation sans pièce jointe';
          }
          
          if (reason) {
            needsReimport.push({
              id: email.id,
              subject: email.subject || '(sans sujet)',
              from: email.from_address,
              currentAttachments: attachments.map(a => a.filename),
              reason
            });
          }
        }
        
        console.log(`Scanned ${emails.length} emails, ${needsReimport.length} need reimport`);
        
        return new Response(
          JSON.stringify({ 
            success: true, 
            scanned: emails.length,
            needsReimport,
            message: needsReimport.length > 0 
              ? `${needsReimport.length} email(s) peuvent avoir des pièces jointes manquantes. Utilisez "Importer" sur le fil correspondant pour les récupérer.`
              : "Tous les emails semblent avoir leurs pièces jointes."
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'reclassify_threads': {
        // Recalculate is_quotation_thread for all existing threads
        console.log('Starting thread reclassification...');
        
        // Fetch all threads
        const { data: threads, error: threadsError } = await supabase
          .from('email_threads')
          .select('id, subject_normalized');
        
        if (threadsError) throw threadsError;
        
        if (!threads || threads.length === 0) {
          return new Response(
            JSON.stringify({ success: true, updated: 0, message: "Aucun fil à reclassifier" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        
        // List of subjects that indicate non-quotation threads
        const EXCLUDED_THREAD_SUBJECTS = [
          'new login from', 'nouvelle connexion',
          'daily report', 'rapport journalier', 'reporting du',
          'notification de credit', 'notification de débit',
          'membership updates', 'membership renewal',
          'merry christmas', 'happy new year', 'joyeux noël', 'bonne année',
          'holiday operating hours', 'operating hours',
          'spam:', '[spam]',
          'out of office', 'absence du bureau', 'automatic reply',
          'unsubscribe', 'se désabonner',
          'password reset', 'réinitialisation',
          'verify your email', 'vérifiez votre',
          'account security', 'sécurité du compte',
          'newsletter', 'webinar', 'conference invitation'
        ];
        
        let quotationCount = 0;
        let nonQuotationCount = 0;
        
        for (const thread of threads) {
          const subjectLower = (thread.subject_normalized || '').toLowerCase();
          
          // Check if thread subject is blacklisted
          const isBlacklisted = EXCLUDED_THREAD_SUBJECTS.some(
            excl => subjectLower.includes(excl.toLowerCase())
          );
          
          if (isBlacklisted) {
            // Mark as non-quotation
            await supabase
              .from('email_threads')
              .update({ is_quotation_thread: false })
              .eq('id', thread.id);
            nonQuotationCount++;
            continue;
          }
          
          // Check if thread has at least one quotation email
          const { data: threadEmails } = await supabase
            .from('emails')
            .select('is_quotation_request')
            .eq('thread_ref', thread.id);
          
          const hasQuotationEmail = threadEmails?.some(e => e.is_quotation_request) || false;
          
          // Also check if subject contains quotation keywords
          const hasKeywordInSubject = QUOTATION_KEYWORDS.some(
            kw => subjectLower.includes(kw.toLowerCase())
          );
          
          const isQuotation = hasQuotationEmail || hasKeywordInSubject;
          
          await supabase
            .from('email_threads')
            .update({ is_quotation_thread: isQuotation })
            .eq('id', thread.id);
          
          if (isQuotation) {
            quotationCount++;
          } else {
            nonQuotationCount++;
          }
        }
        
        console.log(`Thread reclassification complete: ${quotationCount} quotation threads, ${nonQuotationCount} non-quotation threads`);
        
        return new Response(
          JSON.stringify({ 
            success: true, 
            total: threads.length,
            quotationThreads: quotationCount,
            nonQuotationThreads: nonQuotationCount
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'merge_threads_by_subject': {
        // Merge fragmented threads by normalized subject
        console.log('Starting thread merge by normalized subject...');
        
        function normalizeSubjectForMerge(subject: string): string {
          return (subject || '')
            .replace(/^(Re:|Fwd:|Fw:|Spam:\**,?\s*)+/gi, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
        }
        
        // Fetch all emails with their subjects and thread_id
        const { data: allEmails, error: emailsError } = await supabase
          .from('emails')
          .select('id, subject, thread_id, thread_ref, sent_at');
        
        if (emailsError) throw emailsError;
        if (!allEmails || allEmails.length === 0) {
          return new Response(
            JSON.stringify({ success: true, merged: 0, message: "Aucun email à fusionner" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        
        // Group emails by normalized subject
        const subjectGroups = new Map<string, typeof allEmails>();
        
        for (const email of allEmails) {
          const normalized = normalizeSubjectForMerge(email.subject || '');
          if (!normalized) continue;
          
          if (!subjectGroups.has(normalized)) {
            subjectGroups.set(normalized, []);
          }
          subjectGroups.get(normalized)!.push(email);
        }
        
        let mergedCount = 0;
        let threadsCreated = 0;
        let skippedMultiRootGroups = 0;
        
        // Process each group
        for (const [normalizedSubject, emails] of subjectGroups) {
          if (emails.length <= 1) continue;
          
          // Sort by date to get the canonical thread_id from the first email
          emails.sort((a, b) => new Date(a.sent_at || 0).getTime() - new Date(b.sent_at || 0).getTime());
          
          // P1-D Safety: Check for multiple distinct roots in this group
          const distinctRoots = new Set(
            emails.map(e => e.thread_id).filter(Boolean)
          );
          if (distinctRoots.size > 1) {
            console.log(`[P1-D] Skipping merge for "${normalizedSubject.substring(0, 40)}" — ${distinctRoots.size} distinct roots (multi-root ambiguous)`);
            skippedMultiRootGroups++;
            continue;
          }

          const canonicalThreadId = emails[0].thread_id;
          // P1-D: Derive rootMessageId from first email
          const rootMessageId = canonicalThreadId || emails[0].message_id || null;
          
          // P1-D: Check if a email_threads entry exists by root_message_id first
          let { data: existingThread } = rootMessageId
            ? await supabase
                .from('email_threads')
                .select('id, root_message_id')
                .eq('root_message_id', rootMessageId)
                .maybeSingle()
            : { data: null };

          // Fallback to subject_normalized only for legacy threads
          if (!existingThread) {
            const { data: subjectThread } = await supabase
              .from('email_threads')
              .select('id, root_message_id')
              .eq('subject_normalized', normalizedSubject)
              .maybeSingle();
            
            // P1-D barrier: only reuse if no conflicting root
            if (subjectThread && (!subjectThread.root_message_id || subjectThread.root_message_id === rootMessageId)) {
              existingThread = subjectThread;
            }
          }
          
          // Create one if not exists
          if (!existingThread) {
            const { data: newThread, error: createError } = await supabase
              .from('email_threads')
              .insert({
                subject_normalized: normalizedSubject,
                root_message_id: rootMessageId,
                first_message_at: emails[0].sent_at,
                last_message_at: emails[emails.length - 1].sent_at,
                email_count: emails.length,
                is_quotation_thread: true,
                status: 'active',
                participants: [],
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
              .select()
              .single();
            
            if (!createError && newThread) {
              existingThread = newThread;
              threadsCreated++;
            } else if (createError) {
              // P1-C: Handle unique conflict
              if (createError.code === '23505' && rootMessageId) {
                const { data: conflictThread } = await supabase
                  .from('email_threads')
                  .select('id, root_message_id')
                  .eq('root_message_id', rootMessageId)
                  .maybeSingle();
                if (conflictThread) {
                  existingThread = conflictThread;
                }
              }
              if (!existingThread) {
                console.error(`Error creating thread for "${normalizedSubject.substring(0, 30)}...":`, createError);
                continue;
              }
            }
          }
          
          if (!existingThread) continue;

          // P1-D: Set root_message_id if missing on existing thread
          if (rootMessageId && !existingThread.root_message_id) {
            await supabase
              .from('email_threads')
              .update({ root_message_id: rootMessageId, updated_at: new Date().toISOString() })
              .eq('id', existingThread.id);
          }
          
          // Update all emails in this group to use the same thread_ref
          for (const email of emails) {
            if (email.thread_ref !== existingThread.id) {
              await supabase
                .from('emails')
                .update({ 
                  thread_ref: existingThread.id,
                  thread_id: canonicalThreadId 
                })
                .eq('id', email.id);
              mergedCount++;
            }
          }
          
          // Update thread email count
          await supabase
            .from('email_threads')
            .update({ 
              email_count: emails.length,
              updated_at: new Date().toISOString()
            })
            .eq('id', existingThread.id);
        }
        
        console.log(`Thread merge complete: ${mergedCount} emails merged, ${threadsCreated} threads created, ${skippedMultiRootGroups} multi-root groups skipped`);
        
        return new Response(
          JSON.stringify({ 
            success: true, 
            merged: mergedCount,
            threadsCreated,
            skippedMultiRootGroups,
            subjectGroups: subjectGroups.size
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'create_threads_from_emails': {
        // Create email_threads entries from existing emails that don't have thread_ref
        console.log('Creating email_threads from orphan emails...');
        
        function normalizeSubjectForCreate(subject: string): string {
          return (subject || '')
            .replace(/^(Re:|Fwd:|Fw:|Spam:\**,?\s*)+/gi, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
        }
        
        // Fetch emails without thread_ref
        const { data: orphanEmails, error: orphanError } = await supabase
          .from('emails')
          .select('id, subject, from_address, to_addresses, sent_at, is_quotation_request, thread_id, message_id')
          .is('thread_ref', null);
        
        if (orphanError) throw orphanError;
        if (!orphanEmails || orphanEmails.length === 0) {
          return new Response(
            JSON.stringify({ success: true, created: 0, message: "Aucun email orphelin" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        
        console.log(`Found ${orphanEmails.length} orphan emails`);
        
        // Group by normalized subject
        const subjectGroups = new Map<string, typeof orphanEmails>();
        
        for (const email of orphanEmails) {
          const normalized = normalizeSubjectForCreate(email.subject || '');
          if (!normalized) continue;
          
          if (!subjectGroups.has(normalized)) {
            subjectGroups.set(normalized, []);
          }
          subjectGroups.get(normalized)!.push(email);
        }
        
        let threadsCreated = 0;
        let emailsLinked = 0;
        
        for (const [normalizedSubject, emails] of subjectGroups) {
          // Sort emails by date
          emails.sort((a, b) => new Date(a.sent_at || 0).getTime() - new Date(b.sent_at || 0).getTime());

          // P1-D: Derive rootMessageId from first email
          const rootMessageId = emails[0].thread_id || emails[0].message_id || null;

          // P1-D Safety: Check for multiple distinct roots
          const distinctRoots = new Set(
            emails.map(e => e.thread_id || e.message_id).filter(Boolean)
          );
          if (distinctRoots.size > 1) {
            console.log(`[P1-D] Skipping create_threads for "${normalizedSubject.substring(0, 40)}" — ${distinctRoots.size} distinct roots`);
            continue;
          }

          // P1-D: Check if thread exists by root_message_id first
          let { data: existingThread } = rootMessageId
            ? await supabase
                .from('email_threads')
                .select('id, root_message_id')
                .eq('root_message_id', rootMessageId)
                .maybeSingle()
            : { data: null };

          // Fallback: subject_normalized (only if no conflicting root)
          if (!existingThread) {
            const { data: subjectThread } = await supabase
              .from('email_threads')
              .select('id, root_message_id')
              .eq('subject_normalized', normalizedSubject)
              .maybeSingle();
            
            if (subjectThread && (!subjectThread.root_message_id || subjectThread.root_message_id === rootMessageId)) {
              existingThread = subjectThread;
            }
          }
          
          const participants = [...new Set(emails.flatMap(e => [e.from_address, ...(e.to_addresses || [])]))];
          const hasQuotationEmail = emails.some(e => e.is_quotation_request);
          
          // Determine if quotation thread
          const THREAD_QUOTATION_KEYWORDS = [
            'dap', 'cif', 'fob', 'exw', 'cfr', 'cpt', 'cip', 'ddp',
            'cotation', 'quotation', 'devis', 'rfq', 'tarif',
            'fret', 'freight', 'transport', 'conteneur', 'container'
          ];
          const hasKeyword = THREAD_QUOTATION_KEYWORDS.some(kw => normalizedSubject.includes(kw));
          const isQuotationThread = hasQuotationEmail || hasKeyword;
          
          if (!existingThread) {
            const { data: newThread, error: createError } = await supabase
              .from('email_threads')
              .insert({
                subject_normalized: normalizedSubject,
                root_message_id: rootMessageId,
                first_message_at: emails[0].sent_at,
                last_message_at: emails[emails.length - 1].sent_at,
                email_count: emails.length,
                is_quotation_thread: isQuotationThread,
                status: 'active',
                participants: participants.map(email => ({ email, role: 'participant' })),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
              .select()
              .single();
            
            if (!createError && newThread) {
              existingThread = newThread;
              threadsCreated++;
            } else if (createError) {
              // P1-C: Handle unique conflict
              if (createError.code === '23505' && rootMessageId) {
                const { data: conflictThread } = await supabase
                  .from('email_threads')
                  .select('id, root_message_id')
                  .eq('root_message_id', rootMessageId)
                  .maybeSingle();
                if (conflictThread) existingThread = conflictThread;
              }
              if (!existingThread) {
                console.error(`Error creating thread:`, createError);
                continue;
              }
            }
          }
          
          if (!existingThread) continue;

          // P1-D: Set root_message_id if missing
          if (rootMessageId && !existingThread.root_message_id) {
            await supabase
              .from('email_threads')
              .update({ root_message_id: rootMessageId, updated_at: new Date().toISOString() })
              .eq('id', existingThread.id);
          }
          
          // Link emails to thread
          for (const email of emails) {
            await supabase
              .from('emails')
              .update({ thread_ref: existingThread.id })
              .eq('id', email.id);
            emailsLinked++;
          }
          
          // Update thread count
          await supabase
            .from('email_threads')
            .update({ 
              email_count: emails.length,
              is_quotation_thread: isQuotationThread,
              updated_at: new Date().toISOString()
            })
            .eq('id', existingThread.id);
        }
        
        console.log(`Created ${threadsCreated} threads, linked ${emailsLinked} emails`);
        
        return new Response(
          JSON.stringify({ 
            success: true, 
            threadsCreated,
            emailsLinked
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'find_missing_files': {
        // Find attachments that have NULL storage_path (file not uploaded)
        const { data: missingAttachments, error: missingError } = await supabase
          .from('email_attachments')
          .select(`
            id, 
            email_id, 
            filename, 
            content_type, 
            size,
            emails!email_attachments_email_id_fkey (
              id,
              subject,
              from_address,
              message_id
            )
          `)
          .is('storage_path', null)
          .not('content_type', 'is', null);
        
        if (missingError) {
          throw new Error(`Error finding missing files: ${missingError.message}`);
        }
        
        console.log(`Found ${missingAttachments?.length || 0} attachments with missing storage_path`);
        
        return new Response(
          JSON.stringify({ 
            success: true, 
            count: missingAttachments?.length || 0,
            attachments: missingAttachments?.map((a: any) => ({
              id: a.id,
              filename: a.filename,
              content_type: a.content_type,
              size: a.size,
              email_subject: a.emails?.subject,
              email_from: a.emails?.from_address,
              message_id: a.emails?.message_id
            })) || []
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        throw new Error(`Action inconnue: ${action}`);
    }

  } catch (error) {
    console.error("Email admin error:", JSON.stringify(error));
    const errorMessage = error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? (error as any).message
        : String(error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
