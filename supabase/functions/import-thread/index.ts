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

async function analyzeThreadWithAI(emails: any[], supabase: any): Promise<any> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    console.log("LOVABLE_API_KEY not configured, skipping AI analysis");
    return null;
  }

  // Build thread context
  const sortedEmails = [...emails].sort((a, b) => 
    new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
  );

  const threadContent = sortedEmails.map((email, idx) => `
--- EMAIL ${idx + 1}/${sortedEmails.length} ---
DATE: ${email.sent_at}
DE: ${email.from_address}
À: ${email.to_addresses?.join(', ') || 'N/A'}
SUJET: ${email.subject}

CONTENU:
${email.body_text || '(Pas de contenu texte)'}
`).join('\n\n');

  console.log(`Analyzing thread with ${emails.length} emails...`);

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
      
      // Analyze the complete thread
      analysisResult = await analyzeThreadWithAI(allEmailsForAnalysis, supabase);
      
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
            extractions_count: analysisResult.extractions?.length || 0
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
        threadId,
        emails: importedEmails,
        analysis: analysisResult ? {
          summary: analysisResult.summary,
          extractionsCount: analysisResult.extractions?.length || 0,
          knowledgeStored,
          quotationDetected: analysisResult.quotation_detected,
          quotationAmount: analysisResult.quotation_amount
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