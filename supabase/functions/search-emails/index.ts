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

// Extract BODYSTRUCTURE with balanced parentheses
function extractBodyStructure(block: string): string {
  const startMarker = 'BODYSTRUCTURE ';
  const startIdx = block.indexOf(startMarker);
  if (startIdx === -1) return '';
  
  let depth = 0;
  let start = startIdx + startMarker.length;
  let end = start;
  
  for (let i = start; i < block.length; i++) {
    if (block[i] === '(') {
      if (depth === 0) start = i;
      depth++;
    }
    if (block[i] === ')') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  
  return block.substring(start, end);
}

// Extract filename from context with multiple pattern support
function extractFilenameFromContext(context: string): string {
  // Pattern 1: "name" "filename.xlsx" or "filename" "document.pdf"
  let match = context.match(/["'](?:name|filename)["']\s+["']([^"']+)["']/i);
  if (match) return decodeHeader(match[1]);
  
  // Pattern 2: ("name" "filename.xlsx") format
  match = context.match(/\(["'](?:name|filename)["']\s+["']([^"']+)["']\)/i);
  if (match) return decodeHeader(match[1]);
  
  // Pattern 3: NIL "name" "filename" format
  match = context.match(/NIL\s+["']([^"']+\.(?:pdf|xlsx?|docx?|csv|zip))["']/i);
  if (match) return decodeHeader(match[1]);
  
  // Pattern 4: RFC 2231 - "name*0" "part1" ...
  const parts: string[] = [];
  const rfc2231 = /["'](?:name|filename)\*(\d+)["']\s+["']([^"']+)["']/gi;
  let rfcMatch;
  while ((rfcMatch = rfc2231.exec(context)) !== null) {
    parts[parseInt(rfcMatch[1])] = rfcMatch[2];
  }
  if (parts.length > 0) return decodeHeader(parts.filter(Boolean).join(''));
  
  // Pattern 5: Direct filename with extension in quotes
  match = context.match(/["']([^"']*[^"'\s]\.(?:xlsx?|pdf|docx?|csv|zip|rar))["']/i);
  if (match) return decodeHeader(match[1]);
  
  return '';
}

// Parse attachments from BODYSTRUCTURE response
function parseAttachmentsFromBodyStructure(structure: string): Array<{
  filename: string;
  contentType: string;
  size: number;
}> {
  const attachments: Array<{ filename: string; contentType: string; size: number }> = [];
  
  // Log raw structure for debugging (first 800 chars)
  console.log(`[BODYSTRUCTURE] Raw (800 chars): ${structure.substring(0, 800)}`);
  
  // Pattern for document MIME types
  const docTypePatterns = [
    { pattern: /"APPLICATION"\s+"PDF"/gi, type: 'application/pdf' },
    { pattern: /"APPLICATION"\s+"VND\.OPENXMLFORMATS[^"]*SPREADSHEET[^"]*"/gi, type: 'application/xlsx' },
    { pattern: /"APPLICATION"\s+"VND\.MS-EXCEL"/gi, type: 'application/excel' },
    { pattern: /"APPLICATION"\s+"VND\.OPENXMLFORMATS[^"]*WORD[^"]*"/gi, type: 'application/docx' },
    { pattern: /"APPLICATION"\s+"MSWORD"/gi, type: 'application/msword' },
    { pattern: /"APPLICATION"\s+"OCTET-STREAM"/gi, type: 'application/octet-stream' },
    { pattern: /"TEXT"\s+"CSV"/gi, type: 'text/csv' },
    { pattern: /"APPLICATION"\s+"ZIP"/gi, type: 'application/zip' },
  ];
  
  for (const { pattern, type } of docTypePatterns) {
    let match;
    while ((match = pattern.exec(structure)) !== null) {
      // Get context around the match (500 chars before and after)
      const contextStart = Math.max(0, match.index - 200);
      const contextEnd = Math.min(structure.length, match.index + 500);
      const context = structure.substring(contextStart, contextEnd);
      
      const filename = extractFilenameFromContext(context);
      
      if (filename) {
        const lowerFilename = filename.toLowerCase();
        // Skip inline images/signatures
        if (lowerFilename.startsWith('~') || 
            lowerFilename.startsWith('image0') ||
            lowerFilename.includes('signature')) {
          continue;
        }
        
        console.log(`[BODYSTRUCTURE] Found attachment: ${filename} (${type})`);
        attachments.push({ filename, contentType: type, size: 0 });
      }
    }
  }
  
  // Also scan for filenames with known extensions even if MIME type wasn't matched
  const extensionPattern = /["']([^"']*\.(?:xlsx?|pdf|docx?|csv|zip|rar))["']/gi;
  let extMatch;
  while ((extMatch = extensionPattern.exec(structure)) !== null) {
    const filename = decodeHeader(extMatch[1]);
    const lowerFilename = filename.toLowerCase();
    
    // Skip if already found or is inline/signature
    if (attachments.some(a => a.filename === filename)) continue;
    if (lowerFilename.startsWith('~') || 
        lowerFilename.startsWith('image0') ||
        lowerFilename.includes('signature')) {
      continue;
    }
    
    // Determine content type from extension
    let contentType = 'application/octet-stream';
    if (lowerFilename.endsWith('.pdf')) contentType = 'application/pdf';
    else if (lowerFilename.endsWith('.xlsx')) contentType = 'application/xlsx';
    else if (lowerFilename.endsWith('.xls')) contentType = 'application/excel';
    else if (lowerFilename.endsWith('.docx') || lowerFilename.endsWith('.doc')) contentType = 'application/msword';
    else if (lowerFilename.endsWith('.csv')) contentType = 'text/csv';
    else if (lowerFilename.endsWith('.zip')) contentType = 'application/zip';
    
    console.log(`[BODYSTRUCTURE] Found attachment by extension: ${filename}`);
    attachments.push({ filename, contentType, size: 0 });
  }
  
  // Deduplicate by filename
  const unique = Array.from(new Map(attachments.map(a => [a.filename, a])).values());
  
  console.log(`[BODYSTRUCTURE] Total unique attachments: ${unique.length}`);
  return unique;
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
    attachments: Array<{ filename: string; contentType: string; size: number }>;
  }>> {
    if (seqNums.length === 0) return [];
    
    const range = seqNums.join(',');
    // Fetch headers AND BODYSTRUCTURE to get attachment info
    const response = await this.sendCommand(
      `FETCH ${range} (UID BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID REFERENCES IN-REPLY-TO)] BODYSTRUCTURE)`
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
      attachments: Array<{ filename: string; contentType: string; size: number }>;
    }> = [];

    // Split response by FETCH blocks
    const fetchBlocks = response.split(/(?=\* \d+ FETCH)/);
    
    for (const block of fetchBlocks) {
      if (!block.includes('FETCH')) continue;
      
      const seqMatch = block.match(/\* (\d+) FETCH/);
      const uidMatch = block.match(/UID (\d+)/);
      if (!seqMatch || !uidMatch) continue;
      
      const seq = parseInt(seqMatch[1]);
      const uid = parseInt(uidMatch[1]);
      
      // Extract header block
      const headerMatch = block.match(/BODY\[HEADER\.FIELDS[^\]]*\] \{(\d+)\}\r\n([\s\S]*?)(?=BODYSTRUCTURE|\)$)/i);
      const headerBlock = headerMatch?.[2] || '';
      
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
      
      // Extract BODYSTRUCTURE using balanced parentheses
      const bodyStructure = extractBodyStructure(block);
      const attachments = bodyStructure 
        ? parseAttachmentsFromBodyStructure(bodyStructure)
        : [];
      
      messages.push({
        seq,
        uid,
        subject,
        from,
        to,
        date: dateMatch?.[1]?.trim() || new Date().toISOString(),
        messageId: messageIdMatch?.[1]?.trim() || `<${uid}@imported>`,
        references: referencesMatch?.[1]?.trim() || inReplyToMatch?.[1]?.trim() || '',
        attachments
      });
    }
    
    return messages;
  }

  // Search by Message-ID header
  async searchByMessageId(messageId: string): Promise<number[]> {
    // Clean up the message ID for searching
    const cleanId = messageId.replace(/^<|>$/g, '');
    console.log(`Searching for Message-ID: ${cleanId}`);
    const response = await this.sendCommand(`SEARCH HEADER Message-ID "${cleanId}"`);
    const match = response.match(/\* SEARCH([\d\s]*)/);
    if (!match) return [];
    return match[1].trim().split(/\s+/).filter(Boolean).map(Number);
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
    const { configId, searchType, query, limit = 200, deepSearch = false, reconstructThread = false } = await req.json();
    
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
    let messages = await client.fetchHeaders(selectedSeqs);
    
    // Thread reconstruction by Message-ID/References
    if (reconstructThread && messages.length > 0) {
      console.log(`Thread reconstruction enabled. Starting with ${messages.length} messages.`);
      
      // Collect all Message-IDs we already have
      const foundMessageIds = new Set(messages.map(m => m.messageId));
      
      // Collect all referenced Message-IDs from References and In-Reply-To headers
      const referencedIds = new Set<string>();
      for (const msg of messages) {
        if (msg.references) {
          // References header can contain multiple Message-IDs separated by spaces
          const refs = msg.references.split(/\s+/).filter(Boolean);
          refs.forEach(ref => {
            const cleanRef = ref.trim();
            if (cleanRef && !foundMessageIds.has(cleanRef)) {
              referencedIds.add(cleanRef);
            }
          });
        }
      }
      
      console.log(`Found ${referencedIds.size} referenced Message-IDs not in current results`);
      
      // Search for each missing Message-ID
      let foundAdditional = 0;
      for (const refId of referencedIds) {
        try {
          const refSeqs = await client.searchByMessageId(refId);
          if (refSeqs.length > 0) {
            console.log(`Found ${refSeqs.length} email(s) for Message-ID: ${refId}`);
            const additionalMsgs = await client.fetchHeaders(refSeqs);
            
            // Add only if not already in our list (by UID to avoid duplicates)
            const existingUids = new Set(messages.map(m => m.uid));
            for (const addMsg of additionalMsgs) {
              if (!existingUids.has(addMsg.uid)) {
                messages.push(addMsg);
                foundAdditional++;
                existingUids.add(addMsg.uid);
              }
            }
          }
        } catch (e) {
          console.error(`Error searching for Message-ID ${refId}:`, e);
        }
      }
      
      console.log(`Thread reconstruction complete. Added ${foundAdditional} emails. Total: ${messages.length}`);
    }
    
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
      
      // Aggregate all attachments from thread messages
      const allAttachments = msgs.flatMap(m => m.attachments || []);
      const uniqueAttachments = Array.from(
        new Map(allAttachments.map(a => [a.filename, a])).values()
      );
      
      return {
        subject: displaySubject,
        normalizedSubject: subject,
        messageCount: msgs.length,
        participants: [...new Set(msgs.map(m => m.from).filter(f => f))],
        dateRange: {
          first: parseEmailDate(sortedMsgs[0].date), // Oldest
          last: parseEmailDate(sortedMsgs[sortedMsgs.length - 1].date) // Newest
        },
        attachments: uniqueAttachments,
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
