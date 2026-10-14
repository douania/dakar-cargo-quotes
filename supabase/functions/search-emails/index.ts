import { ImapByteReader, readImapHeaders } from "../_shared/imap-headers.ts";
import { readMailboxSecret, quoteImapString } from "../_shared/mailbox-secret.ts";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { imapAccountKey } from "../_shared/imap-import-identity.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import {
  boundedSearchLimit, decodeSearchHeader as decodeHeader, findDecodedSubjectUids,
  parseSearchUids, requireImapCommandOk, searchFetchMessages,
} from "../_shared/imap-subject-search.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
export class IMAPSearchClient {
  private conn: Deno.TlsConn | Deno.TcpConn | null = null;
  private encoder = new TextEncoder();
  private reader = new ImapByteReader(buffer => this.conn!.read(buffer));
  private tagCounter = 0;
  uidValidity: number | null = null;


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

  private async readLine(): Promise<string> { return await this.reader.readLine(); }

  private async readBytes(count: number): Promise<Uint8Array> { return await this.reader.readBytes(count); }

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

      if (new RegExp(`^${tag} (?:OK|NO|BAD)(?:\\s|$)`, "i").test(line)) break;
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
        
        this.reader.clear();
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
        this.reader.clear();
        this.conn = await Deno.connect({ hostname: this.host, port: 143 });
        await this.readLine();
      }
    }
    throw new Error("Could not establish TLS connection");
  }

  async login(username: string, password: string): Promise<boolean> {
    const response = await this.sendCommand(`LOGIN ${quoteImapString(username)} ${quoteImapString(password)}`);
    requireImapCommandOk(response, "LOGIN");
    return true;
  }

  async select(mailbox: string): Promise<number> {
    // EXAMINE has SELECT's response shape while keeping mailbox state read-only.
    const response = await this.sendCommand(`EXAMINE ${quoteImapString(mailbox)}`);
    requireImapCommandOk(response, "EXAMINE");
    const match = response.match(/\* (\d+) EXISTS/);
    if (!match || !Number.isSafeInteger(Number(match[1]))) throw new Error("Réponse IMAP EXISTS invalide");
    const validity = response.match(/\[UIDVALIDITY ([1-9]\d*)\]/i);
    this.uidValidity = validity && Number.isSafeInteger(Number(validity[1])) ? Number(validity[1]) : null;
    return Number(match[1]);
  }

  async search(criteria: string): Promise<number[]> {
    console.log(`Searching: ${criteria}`);
    const charset = [...criteria].some(c => c.charCodeAt(0) > 127) ? "CHARSET UTF-8 " : "";
    const response = await this.sendCommand(`UID SEARCH ${charset}${criteria}`);
    return parseSearchUids(response);
  }

  async fetchSubjects(uids: number[]): Promise<Array<{ uid: number; subject: string }>> {
    return (await this.fetchHeaders(uids, true)).map(({ uid, subject }) => ({ uid, subject }));
  }

  async fetchHeaders(uids: number[], subjectOnly = false): Promise<Array<{
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
    if (uids.length === 0) return [];
    if (uids.some(uid => !Number.isSafeInteger(uid) || uid < 1)) throw new Error("UID IMAP invalide");
    
    const range = [...new Set(uids)].join(',');
    // Fetch headers AND BODYSTRUCTURE to get attachment info
    const fields = subjectOnly ? "SUBJECT" : "FROM TO SUBJECT DATE MESSAGE-ID REFERENCES IN-REPLY-TO";
    const response = await this.sendCommand(
      `UID FETCH ${range} (UID BODY.PEEK[HEADER.FIELDS (${fields})]${subjectOnly ? "" : " BODYSTRUCTURE"})`
    );
    requireImapCommandOk(response, "FETCH");
    
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

    for (const { seq, uid, headerResponse, metadata } of searchFetchMessages(response)) {
      let subjectPresent = false;
      const { subject, from, to, date, messageId, references } = readImapHeaders(headerResponse, uid, value => {
        subjectPresent = true;
        return decodeHeader(value);
      });

      // Extract BODYSTRUCTURE using balanced parentheses
      const bodyStructure = extractBodyStructure(metadata);
      const attachments = bodyStructure 
        ? parseAttachmentsFromBodyStructure(bodyStructure)
        : [];
      
      messages.push({
        seq,
        uid,
        subject: subjectOnly && !subjectPresent ? "" : subject,
        from,
        to,
        date,
        messageId,
        references,
        attachments
      });
    }
    
    const requested = new Set(uids);
    return [...new Map(messages.filter(m => requested.has(m.uid)).map(m => [m.uid, m])).values()];
  }

  // Search by Message-ID header
  async searchByMessageId(messageId: string): Promise<number[]> {
    // Clean up the message ID for searching
    const cleanId = messageId.replace(/^<|>$/g, '');
    console.log(`Searching for Message-ID: ${cleanId}`);
    return await this.search(`HEADER Message-ID ${quoteImapString(cleanId)}`);
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

export const handler = async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let client: IMAPSearchClient | null = null;

  try {
    // Phase S0: Auth guard
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;

    // Increased default limit from 30 to 200 for better thread coverage
    const { configId, searchType, query, limit: requestedLimit = 200, deepSearch = false, reconstructThread = false } = await req.json();
    const limit = boundedSearchLimit(requestedLimit);
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get config
    const { data: config, error: configError } = await supabase
      .from('email_configs')
      .select('id,name,host,port,username,folder,use_ssl,is_active,last_sync_at,created_at')
      .eq('id', configId)
      .single();

    if (configError || !config) {
      throw new Error("Configuration email non trouvée");
    }

    const imapPassword = await readMailboxSecret(supabase, config.id);
    client = new IMAPSearchClient(config.host, config.port);
    await client.connect();
    
    const loggedIn = await client.login(config.username, imapPassword);
    if (!loggedIn) throw new Error("Échec de l'authentification IMAP");

    const mailbox = config.folder || 'INBOX';
    const mailboxSize = await client.select(mailbox);
    const uidValidity = client.uidValidity;

    // Build search criteria - use OR for deep search to find related emails
    let criteria = 'ALL';
    if (searchType === 'subject' && query) {
      if (deepSearch) {
        // Deep search: OR subject, body, from
        criteria = `OR OR SUBJECT ${quoteImapString(query)} BODY ${quoteImapString(query)} FROM ${quoteImapString(query)}`;
      } else {
        criteria = `SUBJECT ${quoteImapString(query)}`;
      }
    } else if (searchType === 'from' && query) {
      criteria = `FROM ${quoteImapString(query)}`;
    } else if (searchType === 'text' && query) {
      criteria = `TEXT ${quoteImapString(query)}`;
    }

    // Subject recovery stays within fixed header budgets, even if the normal search found replies.
    const subjectResult = searchType === 'subject' && query
      ? await findDecodedSubjectUids(client, query, mailboxSize, limit, deepSearch)
      : null;
    const uids = subjectResult ? subjectResult.uids : await client.search(criteria);
    const totalFound = subjectResult ? subjectResult.totalFound : uids.length;
    const selectedUids = uids.slice(-limit);
    
    // Fetch headers
    const messages = await client.fetchHeaders(selectedUids);
    let remainingHeaderBudget = limit - selectedUids.length;
    let reconstructionTruncated = false;
    
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
      const referenceList = [...referencedIds];
      reconstructionTruncated = referenceList.length > 50;
      for (const refId of referenceList.slice(0, 50)) {
        const remaining = Math.min(limit - messages.length, remainingHeaderBudget);
        if (remaining <= 0) { reconstructionTruncated = true; break; }
        try {
          const refUids = await client.searchByMessageId(refId);
          const existing = new Set(messages.map(m => m.uid));
          const missingUids = refUids.filter(uid => !existing.has(uid));
          if (missingUids.length > 0) {
            reconstructionTruncated ||= missingUids.length > remaining;
            const requestedUids = missingUids.slice(-remaining);
            remainingHeaderBudget -= requestedUids.length;
            const additionalMsgs = await client.fetchHeaders(requestedUids);
            
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
          throw e;
        }
      }
      
      console.log(`Thread reconstruction complete. Added ${foundAdditional} emails. Total: ${messages.length}`);
    }
    
    // P0-B: Group by thread key (root Message-ID from References) instead of normalizedSubject
    function getThreadKey(msg: { messageId: string; references: string }): string {
      if (msg.references) {
        const root = msg.references.split(/\s+/).filter(Boolean)[0];
        if (root) return root;
      }
      return msg.messageId;
    }

    const threads = new Map<string, typeof messages>();
    for (const msg of messages) {
      const key = getThreadKey(msg);
      if (!threads.has(key)) {
        threads.set(key, []);
      }
      threads.get(key)!.push(msg);
    }

    console.log(`[P0-B] ${messages.length} messages grouped into ${threads.size} conversations by threadKey`);
    // Log up to 3 examples
    let exampleCount = 0;
    for (const [key, msgs] of threads) {
      if (exampleCount >= 3) break;
      console.log(`[P0-B] threadKey=${key.substring(0, 60)} subject="${msgs[0].subject.substring(0, 50)}" (${msgs.length} msg)`);
      exampleCount++;
    }

    // Convert to array format with proper date sorting
    const threadList = Array.from(threads.entries()).map(([threadKey, msgs]) => {
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
        threadKey,
        subject: displaySubject,
        normalizedSubject: normalizeSubject(sortedMsgs[0].subject),
        messageCount: msgs.length,
        participants: [...new Set(msgs.map(m => m.from).filter(f => f))],
        dateRange: {
          first: parseEmailDate(sortedMsgs[0].date),
          last: parseEmailDate(sortedMsgs[sortedMsgs.length - 1].date)
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
        totalFound,
        selectedCount: selectedUids.length,
        limitApplied: limit,
        deepSearchEnabled: deepSearch,
        mailbox,
        uidValidity,
        accountKey: await imapAccountKey(config),
        searchCoverage: subjectResult?.coverage ?? null,
        reconstructionTruncated,
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
};
if (Deno.env.get("MAIL_FUNCTION_DISABLE_SERVE") !== "1") serve(handler);
