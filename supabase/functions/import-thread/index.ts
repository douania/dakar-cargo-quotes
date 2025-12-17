import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const THREAD_ANALYSIS_PROMPT = `Tu es un expert en analyse d'échanges commerciaux pour une entreprise de transit logistique au Sénégal (SODATRA).

Analyse cet échange d'emails complet et extrais les connaissances suivantes:

1. **TARIFS & PRICING** (category: "tarif")
   - Prix mentionnés (transport, manutention, dédouanement, frais portuaires)
   - Devise et conditions de paiement
   - Validité des tarifs
   Format: { origine, destination, type_transport, montant, devise, conditions, validite }

2. **TEMPLATES DE RÉPONSE** (category: "template")
   - Structure des cotations envoyées
   - Formules d'introduction et de conclusion
   - Mentions légales et conditions
   Format: { type_document, structure_sections, phrases_cles, style_communication }

3. **CONTACTS** (category: "contact")
   - Clients identifiés avec leurs préférences
   - Compagnies maritimes/aériennes mentionnées
   - Agents et partenaires
   Format: { nom, email, entreprise, role, preferences, historique_interactions }

4. **PATTERNS DE NÉGOCIATION** (category: "negociation")
   - Étapes de la négociation observées
   - Concessions accordées
   - Arguments utilisés
   - Délais de réponse typiques
   Format: { etapes, arguments_cles, concessions, delai_moyen, resultat }

5. **DÉLAIS & CONDITIONS** (category: "condition")
   - Délais de transit mentionnés
   - Conditions de livraison
   - Franchises et pénalités
   Format: { type, valeur, conditions_application }

6. **MARCHANDISES** (category: "marchandise")
   - Types de marchandises traitées
   - Codes SH mentionnés
   - Volumes/poids typiques
   Format: { description, code_sh, volume, poids, conditionnement }

Réponds UNIQUEMENT avec un JSON valide au format:
{
  "summary": "Résumé de l'échange en 2-3 phrases",
  "extractions": [
    {
      "category": "tarif|template|contact|negociation|condition|marchandise",
      "name": "Nom court descriptif",
      "description": "Description détaillée",
      "data": { ... données structurées ... },
      "confidence": 0.0-1.0
    }
  ],
  "quotation_detected": true/false,
  "quotation_amount": "montant si détecté",
  "client_satisfaction": "satisfied|neutral|unsatisfied|unknown"
}

Si aucune connaissance exploitable n'est trouvée, retourne: { "summary": "Aucune information exploitable", "extractions": [], "quotation_detected": false }`;

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
  
  // Match attachment parts with filename
  const filenameRegex = /\("name"\s+"([^"]+)"\)|filename\*?=(?:"([^"]+)"|([^\s\)]+))/gi;
  const structureMatch = response.match(/BODYSTRUCTURE\s+(\([\s\S]*?\))\s*\)/i);
  
  if (!structureMatch) return attachments;
  
  const structure = structureMatch[1];
  
  // Simple parsing for common attachment patterns
  // Look for parts like: ("application" "pdf" ... "base64" 12345 ...)
  const partRegex = /\(?"(application|image|audio|video|text)"\s+"([^"]+)"[^)]*?"([^"]*)"[^)]*?"(base64|quoted-printable|7bit|8bit)"[^)]*?(\d+)/gi;
  
  let match;
  let partNum = 1;
  
  while ((match = partRegex.exec(structure)) !== null) {
    const [, type, subtype, , encoding, size] = match;
    const contentType = `${type}/${subtype}`.toLowerCase();
    
    // Skip text/plain and text/html (these are body parts, not attachments)
    if (contentType === 'text/plain' || contentType === 'text/html') continue;
    
    // Try to find filename near this match
    const beforeMatch = structure.substring(0, match.index);
    const afterMatch = structure.substring(match.index, match.index + 500);
    const contextStr = beforeMatch.slice(-200) + afterMatch;
    
    let filename = `attachment_${partNum}`;
    const fnMatch = contextStr.match(/(?:"name"\s*"([^"]+)"|filename\*?=(?:"([^"]+)"|'[^']*'([^']+)'|([^\s\);"]+)))/i);
    if (fnMatch) {
      filename = decodeHeader(fnMatch[1] || fnMatch[2] || fnMatch[3] || fnMatch[4] || filename);
    }
    
    // Add extension based on content type if missing
    if (!filename.includes('.')) {
      const extMap: Record<string, string> = {
        'application/pdf': '.pdf',
        'application/vnd.ms-excel': '.xls',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
        'application/msword': '.doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
        'image/jpeg': '.jpg',
        'image/png': '.png',
      };
      filename += extMap[contentType] || '';
    }
    
    attachments.push({
      partNumber: String(partNum),
      filename,
      contentType,
      encoding: encoding.toLowerCase(),
      size: parseInt(size) || 0
    });
    
    partNum++;
  }
  
  return attachments;
}

// Simple IMAP client with attachment support
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

  private async readBytes(count: number): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let totalRead = 0;
    
    // First, use any buffered data
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

  async fetchBodyStructure(uid: number): Promise<AttachmentInfo[]> {
    const response = await this.sendCommand(`UID FETCH ${uid} BODYSTRUCTURE`);
    return parseBodyStructure(response);
  }

  async fetchAttachment(uid: number, partNumber: string, encoding: string): Promise<Uint8Array> {
    const response = await this.sendCommand(`UID FETCH ${uid} BODY.PEEK[${partNumber}]`);
    
    // Extract the content from the response
    const sizeMatch = response.match(/BODY\[\d+\] \{(\d+)\}/i);
    if (!sizeMatch) {
      // Try alternative format
      const contentMatch = response.match(/BODY\[\d+\]\s+"([^"]+)"/i);
      if (contentMatch) {
        const content = contentMatch[1];
        if (encoding === 'base64') {
          return decodeBase64(content);
        } else if (encoding === 'quoted-printable') {
          return decodeQuotedPrintable(content);
        }
        return new TextEncoder().encode(content);
      }
      return new Uint8Array(0);
    }
    
    // Get content after the size indicator
    const afterSize = response.indexOf(`{${sizeMatch[1]}}`);
    if (afterSize === -1) return new Uint8Array(0);
    
    const contentStart = response.indexOf('\r\n', afterSize) + 2;
    const content = response.substring(contentStart).replace(/\)\r\n.*$/, '');
    
    if (encoding === 'base64') {
      return decodeBase64(content);
    } else if (encoding === 'quoted-printable') {
      return decodeQuotedPrintable(content);
    }
    return new TextEncoder().encode(content);
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
    attachments: AttachmentInfo[];
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

    // Fetch body text
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

    // Fetch attachments info
    const attachments = await this.fetchBodyStructure(uid);
    console.log(`Message ${uid} has ${attachments.length} attachment(s)`);

    return { subject, from, to, date, messageId, references, bodyText, bodyHtml, attachments };
  }

  async logout(): Promise<void> {
    try { await this.sendCommand('LOGOUT'); } catch { /* ignore */ }
    try { this.conn?.close(); } catch { /* ignore */ }
  }
}

async function analyzeThreadWithAI(emails: any[], attachmentTexts: string[], supabase: any): Promise<any> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    console.log("LOVABLE_API_KEY not configured, skipping AI analysis");
    return null;
  }

  // Build thread context
  const sortedEmails = [...emails].sort((a, b) => 
    new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
  );

  let threadContent = sortedEmails.map((email, idx) => `
--- EMAIL ${idx + 1}/${sortedEmails.length} ---
DATE: ${email.sent_at}
DE: ${email.from_address}
À: ${email.to_addresses?.join(', ') || 'N/A'}
SUJET: ${email.subject}

CONTENU:
${email.body_text || '(Pas de contenu texte)'}
`).join('\n\n');

  // Add attachment content if available
  if (attachmentTexts.length > 0) {
    threadContent += '\n\n=== PIÈCES JOINTES ANALYSÉES ===\n';
    threadContent += attachmentTexts.join('\n---\n');
  }

  console.log(`Analyzing thread with ${emails.length} emails and ${attachmentTexts.length} attachments...`);

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: THREAD_ANALYSIS_PROMPT },
          { role: "user", content: threadContent }
        ],
        response_format: { type: "json_object" }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI analysis error:", response.status, errorText);
      return null;
    }

    const aiResult = await response.json();
    const content = aiResult.choices?.[0]?.message?.content;
    
    try {
      return JSON.parse(content);
    } catch (e) {
      console.error("Failed to parse AI response:", content);
      return null;
    }
  } catch (error) {
    console.error("AI analysis failed:", error);
    return null;
  }
}

async function storeExtractedKnowledge(
  analysis: any, 
  threadId: string, 
  emailIds: string[], 
  supabase: any
): Promise<number> {
  if (!analysis || !analysis.extractions || analysis.extractions.length === 0) {
    return 0;
  }

  let stored = 0;

  for (const extraction of analysis.extractions) {
    if (extraction.confidence < 0.3) {
      console.log(`Skipping low confidence extraction: ${extraction.name}`);
      continue;
    }

    // Check for existing similar knowledge
    const { data: existing } = await supabase
      .from('learned_knowledge')
      .select('id, confidence')
      .eq('category', extraction.category)
      .eq('name', extraction.name)
      .maybeSingle();

    if (existing) {
      if (extraction.confidence > existing.confidence) {
        await supabase
          .from('learned_knowledge')
          .update({
            data: extraction.data,
            confidence: extraction.confidence,
            description: extraction.description,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
        console.log(`Updated knowledge: ${extraction.name}`);
      }
      continue;
    }

    const { error } = await supabase
      .from('learned_knowledge')
      .insert({
        category: extraction.category,
        name: extraction.name,
        description: extraction.description,
        data: {
          ...extraction.data,
          source_thread_id: threadId,
          source_email_ids: emailIds
        },
        source_type: 'email_thread',
        source_id: emailIds[0],
        confidence: extraction.confidence,
        is_validated: extraction.confidence >= 0.8
      });

    if (!error) {
      stored++;
      console.log(`Stored knowledge: ${extraction.name} (${extraction.category})`);
    }
  }

  return stored;
}

async function processAttachment(
  client: IMAPClient,
  uid: number,
  attachment: AttachmentInfo,
  emailId: string,
  supabase: any
): Promise<{ id: string; extractedText: string } | null> {
  try {
    console.log(`Processing attachment: ${attachment.filename} (${attachment.contentType})`);
    
    // Download attachment content
    const content = await client.fetchAttachment(uid, attachment.partNumber, attachment.encoding);
    
    if (content.length === 0) {
      console.log(`Empty attachment content for ${attachment.filename}`);
      return null;
    }
    
    console.log(`Downloaded ${content.length} bytes for ${attachment.filename}`);
    
    // Generate storage path
    const timestamp = Date.now();
    const safeName = attachment.filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storagePath = `email-attachments/${emailId}/${timestamp}_${safeName}`;
    
    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, content, {
        contentType: attachment.contentType,
        upsert: true
      });
    
    if (uploadError) {
      console.error(`Failed to upload ${attachment.filename}:`, uploadError);
      return null;
    }
    
    console.log(`Uploaded to storage: ${storagePath}`);
    
    // Insert attachment record
    const { data: attachmentRecord, error: insertError } = await supabase
      .from('email_attachments')
      .insert({
        email_id: emailId,
        filename: attachment.filename,
        content_type: attachment.contentType,
        size: content.length,
        storage_path: storagePath,
        is_analyzed: false
      })
      .select()
      .single();
    
    if (insertError) {
      console.error(`Failed to insert attachment record:`, insertError);
      return null;
    }
    
    // Analyze document content if it's a supported type
    let extractedText = '';
    const analyzableTypes = [
      'application/pdf',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/csv',
      'text/plain'
    ];
    
    if (analyzableTypes.some(t => attachment.contentType.includes(t))) {
      try {
        // Get public URL for the file
        const { data: urlData } = supabase.storage
          .from('documents')
          .getPublicUrl(storagePath);
        
        if (urlData?.publicUrl) {
          // Call parse-document function
          const { data: parseResult, error: parseError } = await supabase.functions.invoke('parse-document', {
            body: { 
              url: urlData.publicUrl,
              filename: attachment.filename 
            }
          });
          
          if (!parseError && parseResult?.text) {
            extractedText = parseResult.text;
            
            // Update attachment with extracted text
            await supabase
              .from('email_attachments')
              .update({
                extracted_text: extractedText.substring(0, 50000), // Limit size
                extracted_data: parseResult.data || null,
                is_analyzed: true
              })
              .eq('id', attachmentRecord.id);
            
            console.log(`Analyzed ${attachment.filename}: ${extractedText.length} chars extracted`);
          }
        }
      } catch (analyzeError) {
        console.error(`Failed to analyze ${attachment.filename}:`, analyzeError);
      }
    }
    
    return {
      id: attachmentRecord.id,
      extractedText
    };
  } catch (error) {
    console.error(`Error processing attachment ${attachment.filename}:`, error);
    return null;
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
    const allAttachmentTexts: string[] = [];
    let threadId: string | null = null;
    let totalAttachments = 0;

    for (const uid of uids) {
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
          extracted_data: learningCase ? { learning_case: learningCase, imported_for_learning: true, attachments_count: msg.attachments.length } : null
        })
        .select()
        .single();

      if (insertError) {
        console.error("Error inserting email:", insertError);
        continue;
      }

      // Process attachments
      if (msg.attachments.length > 0) {
        console.log(`Processing ${msg.attachments.length} attachment(s) for email ${inserted.id}`);
        
        for (const attachment of msg.attachments) {
          const result = await processAttachment(client, uid, attachment, inserted.id, supabase);
          if (result) {
            totalAttachments++;
            if (result.extractedText) {
              allAttachmentTexts.push(`[${attachment.filename}]\n${result.extractedText.substring(0, 5000)}`);
            }
          }
        }
      }

      importedEmails.push(inserted);
      console.log(`Imported: ${msg.subject.substring(0, 50)}... with ${msg.attachments.length} attachment(s)`);
    }

    await client.logout();
    client = null;

    const newlyImportedEmails = importedEmails.filter(e => !e.alreadyExists);
    const existingEmailIds = importedEmails.filter(e => e.alreadyExists).map(e => e.id);
    const allEmailIds = importedEmails.map(e => e.id);

    // Fetch complete data for existing emails
    let allEmailsForAnalysis = [...newlyImportedEmails];
    if (existingEmailIds.length > 0) {
      const { data: existingEmails } = await supabase
        .from('emails')
        .select('*')
        .in('id', existingEmailIds);
      
      if (existingEmails) {
        allEmailsForAnalysis = [...allEmailsForAnalysis, ...existingEmails];
      }
    }

    // AI Analysis of the thread (even if all emails already exist)
    let analysisResult = null;
    let knowledgeStored = 0;

    if (learningCase && allEmailsForAnalysis.length > 0) {
      console.log(`Starting AI analysis of thread with ${allEmailsForAnalysis.length} emails (${newlyImportedEmails.length} new, ${existingEmailIds.length} existing)...`);
      
      // Analyze the complete thread with attachment content
      analysisResult = await analyzeThreadWithAI(allEmailsForAnalysis, allAttachmentTexts, supabase);
      
      if (analysisResult) {
        // Store extracted knowledge
        knowledgeStored = await storeExtractedKnowledge(
          analysisResult, 
          threadId!, 
          allEmailIds, 
          supabase
        );

        // Create/update main thread knowledge entry with analysis summary
        const threadKnowledgeName = `Échange: ${allEmailsForAnalysis[0]?.subject?.substring(0, 80) || 'Sans titre'}`;
        
        // Check if thread knowledge already exists
        const { data: existingKnowledge } = await supabase
          .from('learned_knowledge')
          .select('id')
          .eq('name', threadKnowledgeName)
          .eq('category', 'quotation_exchange')
          .maybeSingle();

        const threadKnowledgeData = {
          name: threadKnowledgeName,
          category: 'quotation_exchange',
          description: analysisResult.summary || `Échange de ${allEmailsForAnalysis.length} emails analysé`,
          source_type: 'email_thread',
          data: {
            email_ids: allEmailIds,
            thread_id: threadId,
            participants: [...new Set(allEmailsForAnalysis.flatMap(e => [e.from_address, ...(e.to_addresses || [])]))],
            date_range: {
              first: allEmailsForAnalysis[allEmailsForAnalysis.length - 1]?.sent_at,
              last: allEmailsForAnalysis[0]?.sent_at
            },
            learning_case: learningCase,
            quotation_detected: analysisResult.quotation_detected,
            quotation_amount: analysisResult.quotation_amount,
            client_satisfaction: analysisResult.client_satisfaction,
            extractions_count: analysisResult.extractions?.length || 0,
            attachments_analyzed: allAttachmentTexts.length
          },
          confidence: 0.7,
          is_validated: false,
          updated_at: new Date().toISOString()
        };

        if (existingKnowledge) {
          await supabase
            .from('learned_knowledge')
            .update(threadKnowledgeData)
            .eq('id', existingKnowledge.id);
          console.log('Updated existing thread knowledge');
        } else {
          await supabase.from('learned_knowledge').insert(threadKnowledgeData);
          console.log('Created new thread knowledge');
        }

        // Update all emails with analysis results
        for (const email of allEmailsForAnalysis) {
          await supabase
            .from('emails')
            .update({
              extracted_data: {
                ...(typeof email.extracted_data === 'object' ? email.extracted_data : {}),
                ai_analyzed: true,
                analyzed_at: new Date().toISOString(),
                thread_summary: analysisResult.summary,
                learning_case: learningCase
              }
            })
            .eq('id', email.id);
        }
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        imported: newlyImportedEmails.length,
        alreadyExisted: existingEmailIds.length,
        totalAnalyzed: allEmailsForAnalysis.length,
        attachmentsProcessed: totalAttachments,
        threadId,
        emails: importedEmails,
        analysis: analysisResult ? {
          summary: analysisResult.summary,
          extractionsCount: analysisResult.extractions?.length || 0,
          knowledgeStored,
          quotationDetected: analysisResult.quotation_detected,
          quotationAmount: analysisResult.quotation_amount,
          attachmentsAnalyzed: allAttachmentTexts.length
        } : null
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
