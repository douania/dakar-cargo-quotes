import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============ EMAIL FILTERING CONFIGURATION ============

// Expéditeurs à exclure (banques, newsletters, notifications, emails SODATRA sortants)
const EXCLUDED_SENDERS = [
  // Domaines bancaires Sénégal/Afrique
  'banqueatlantique.net', 'banqueatlantique.com',
  'afrikabanque.sn', 'afrikabanque.com',
  'ecobank.com', 'ecobank.sn',
  'sgbs.sn', 'societegenerale.sn',
  'bicis.sn', 'bnpparibas',
  'cbao.sn', 'attijariwafa',
  'oaborable.sn', 'banque',
  // Notifications automatiques réseaux sociaux
  'linkedin.com', 'linkedinmail.com',
  'facebook.com', 'facebookmail.com',
  'twitter.com', 'x.com',
  // Newsletters et broadcasts
  'broadcast@wcabroadcast.com', 'wcabroadcast.com',
  'newsletter', 'noreply', 'no-reply', 'donotreply', 'do-not-reply',
  'mailer-daemon', 'postmaster',
  'mailchimp', 'sendgrid', 'mailgun',
  // Domaine SODATRA (emails sortants/internes - on ne cote pas nos propres demandes)
  '@sodatra.sn',
  // Autres services automatiques
  'google.com', 'accounts.google',
  'microsoft.com', 'office365',
  'zoom.us', 'teams.microsoft',
  'dropbox.com', 'wetransfer.com'
];

// Sujets à exclure (notifications bancaires, spam, LinkedIn, etc.)
const EXCLUDED_SUBJECTS = [
  // Notifications bancaires
  'spam:', '[spam]',
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

// Mots-clés positifs plus spécifiques pour les demandes de cotation
const QUOTATION_KEYWORDS = [
  // Demandes de cotation explicites
  'demande de cotation', 'request for quotation', 'rfq',
  'demande de devis', 'request for quote', 'devis',
  'demande de prix', 'price request', 'pricing request',
  'besoin de cotation', 'need a quote', 'quote request',
  // Incoterms (espaces pour éviter faux positifs)
  'dap ', 'cif ', 'fob ', 'exw ', 'cfr ', 'cpt ', 'cip ', 'ddp ',
  'dap:', 'cif:', 'fob:', 'exw:',
  // Transport maritime/aérien
  'sea freight', 'ocean freight', 'fret maritime',
  'air freight', 'fret aérien', 'fret aerien',
  'door to door', 'port to port',
  // Conteneurs
  'conteneur 20', 'conteneur 40', '20dv', '40dv', '40hc', '20gp', '40gp',
  'container 20', 'container 40', 'fcl', 'lcl',
  // Types de cargo
  'breakbulk', 'roro', 'ro-ro', 'projet cargo', 'project cargo',
  'conventionnel', 'conventional cargo', 'vrac', 'bulk cargo',
  // Dédouanement
  'dédouanement', 'dedouanement', 'customs clearance',
  'droits de douane', 'duty structure', 'hs code',
  'régime douanier', 'regime douanier', 'mise à la consommation',
  // Opérations transit
  'transit request', 'trucking request', 'transport request',
  'livraison', 'delivery to', 'acheminement',
  // Ports/Destinations spécifiques pertinentes
  'dakar port', 'port de dakar', 'pad ', 'dpw dakar'
];

function isQuotationRelated(from: string, subject: string, body: string): boolean {
  const fromLower = from.toLowerCase();
  const subjectLower = subject.toLowerCase();
  const bodyLower = body.toLowerCase();
  
  // 1. EXCLURE si expéditeur dans la liste noire
  if (EXCLUDED_SENDERS.some(sender => fromLower.includes(sender.toLowerCase()))) {
    console.log(`Email excluded - sender blacklisted: ${from}`);
    return false;
  }
  
  // 2. EXCLURE si sujet dans la liste noire
  if (EXCLUDED_SUBJECTS.some(subj => subjectLower.includes(subj.toLowerCase()))) {
    console.log(`Email excluded - subject blacklisted: ${subject}`);
    return false;
  }
  
  // 3. INCLURE si mots-clés positifs trouvés dans sujet ou corps
  const text = `${subjectLower} ${bodyLower}`;
  const hasKeyword = QUOTATION_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
  
  if (hasKeyword) {
    console.log(`Email included - quotation keyword found in: ${subject}`);
  }
  
  return hasKeyword;
}

function extractThreadId(messageId: string, references: string): string {
  if (references) {
    const refs = references.split(/\s+/);
    return refs[0] || messageId;
  }
  return messageId;
}

// ============ THREAD & ROLE IDENTIFICATION ============

// Partenaires connus
const KNOWN_PARTNERS = [
  '2hlgroup.com', '2hl.com', '@2hl', 'th@2hlgroup', 'taleb'
];

// Fournisseurs connus (compagnies maritimes, agents)
const KNOWN_SUPPLIERS = [
  'msc.com', 'cma-cgm.com', 'maersk.com', 'hapag-lloyd.com', 'hapag.com',
  'one-line.com', 'evergreen-line.com', 'cosco', 'grimaldi',
  'dpworld', 'bollore', 'necotrans', 'getma'
];

// Normaliser le sujet (retirer RE:, FW:, etc.)
function normalizeSubject(subject: string): string {
  return (subject || '')
    .replace(/^(re:|fw:|fwd:|tr:|aw:|wg:|r:|転送:|回复:|antw:|\[external\]|\(sans sujet\))\s*/gi, '')
    .replace(/^(re:|fw:|fwd:|tr:|aw:|wg:|r:|転送:|回复:|antw:)\s*/gi, '') // Second pass
    .trim()
    .toLowerCase();
}

// Extraire le nom de l'entreprise depuis l'email
function extractCompanyFromEmail(email: string): string {
  const match = email.match(/@([^.]+)\./);
  if (match) {
    const domain = match[1].toLowerCase();
    // Map common domain patterns
    if (domain.includes('group-7') || domain.includes('group7')) return 'GROUP7 AG';
    if (domain.includes('2hl')) return '2HL Group';
    if (domain.includes('sodatra')) return 'SODATRA';
    if (domain.includes('msc')) return 'MSC';
    if (domain.includes('cma-cgm') || domain.includes('cma')) return 'CMA CGM';
    if (domain.includes('maersk')) return 'MAERSK';
    if (domain.includes('hapag')) return 'HAPAG-LLOYD';
    return domain.toUpperCase();
  }
  return 'UNKNOWN';
}

// Identifier le rôle d'un contact
function identifyContactRole(email: string, isFirstSender: boolean, bodyText: string): 'client' | 'partner' | 'supplier' | 'internal' | 'prospect' {
  const emailLower = email.toLowerCase();
  
  // SODATRA = internal
  if (emailLower.includes('@sodatra')) return 'internal';
  
  // Partenaires connus
  if (KNOWN_PARTNERS.some(p => emailLower.includes(p))) return 'partner';
  
  // Fournisseurs connus
  if (KNOWN_SUPPLIERS.some(s => emailLower.includes(s))) return 'supplier';
  
  // Si c'est le premier expéditeur et demande une cotation = client
  const bodyLower = (bodyText || '').toLowerCase();
  const quotationMarkers = ['quote', 'quotation', 'cotation', 'devis', 'rates', 'tarif', 'price', 'prix', 'offer', 'offre'];
  
  if (isFirstSender && quotationMarkers.some(m => bodyLower.includes(m))) {
    return 'client';
  }
  
  return 'prospect';
}

// Déterminer le rôle de SODATRA dans le fil
function determineOurRole(
  emails: Array<{ from_address: string; to_addresses: string[]; cc_addresses?: string[] }>,
  firstSender: string
): 'direct_quote' | 'assist_partner' {
  // Si le premier email est envoyé par un partenaire à SODATRA en CC
  const firstEmail = emails[0];
  if (!firstEmail) return 'direct_quote';
  
  const firstFromLower = firstEmail.from_address.toLowerCase();
  
  // Si le premier expéditeur est un partenaire connu
  if (KNOWN_PARTNERS.some(p => firstFromLower.includes(p))) {
    return 'direct_quote'; // Partenaire nous contacte directement
  }
  
  // Si SODATRA n'est pas dans les destinataires principaux mais en CC
  for (const email of emails) {
    const toAddresses = (email.to_addresses || []).map(e => e.toLowerCase());
    const ccAddresses = (email.cc_addresses || []).map(e => e.toLowerCase());
    
    const sodatraInTo = toAddresses.some(a => a.includes('@sodatra'));
    const sodatraInCc = ccAddresses.some(a => a.includes('@sodatra'));
    
    if (!sodatraInTo && sodatraInCc) {
      // SODATRA ajouté en CC par un partenaire = assist_partner
      const fromLower = email.from_address.toLowerCase();
      if (KNOWN_PARTNERS.some(p => fromLower.includes(p))) {
        return 'assist_partner';
      }
    }
  }
  
  return 'direct_quote';
}

// Parse email date strings - remove timezone names in parentheses that PostgreSQL can't handle
function parseEmailDate(dateStr: string): string {
  try {
    // Remove timezone name in parentheses like (UTC), (CST), (GMT+08:00)
    const cleaned = dateStr.replace(/\s*\([^)]*\)\s*$/, '').trim();
    const parsed = new Date(cleaned);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
    // Fallback: try original
    const original = new Date(dateStr);
    if (!isNaN(original.getTime())) {
      return original.toISOString();
    }
  } catch {
    // ignore
  }
  // Last fallback: current time
  return new Date().toISOString();
}

function getTlsServerNameCandidates(host: string): string[] {
  const candidates: string[] = [];
  const push = (value?: string) => {
    if (!value) return;
    if (!candidates.includes(value)) candidates.push(value);
  };

  push(host);

  const parts = host.split(".").filter(Boolean);
  if (parts.length >= 3) {
    const domain = parts.slice(1).join(".");
    push(domain);
    push(`mail.${domain}`);
    push(`webmail.${domain}`);
    push(`smtp.${domain}`);
  } else if (parts.length === 2) {
    push(`mail.${host}`);
    push(`webmail.${host}`);
    push(`smtp.${host}`);
  }

  return candidates;
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
      await this.startTls(getTlsServerNameCandidates(this.host));
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

  private async reconnectPlain(): Promise<void> {
    try {
      this.conn?.close();
    } catch {
      // ignore
    }

    this.buffer = "";
    this.conn = await Deno.connect({
      hostname: this.host,
      port: this.port,
    });

    const greeting = await this.readLine();
    console.log("Server greeting:", greeting.substring(0, 100));
  }

  private async startTls(serverNameCandidates: string[]): Promise<void> {
    console.log("Initiating STARTTLS...");

    let lastError: unknown = null;

    for (const serverName of serverNameCandidates) {
      console.log(`STARTTLS: trying TLS server name \"${serverName}\"`);

      try {
        const tag = this.getTag();
        await this.writeCommand(`${tag} STARTTLS`);

        const response = await this.readUntilTag(tag);
        if (!response.includes(`${tag} OK`)) {
          throw new Error(`STARTTLS failed: ${response}`);
        }

        console.log("STARTTLS accepted, upgrading connection...");

        // Clear buffer before upgrade
        this.buffer = "";

        // Upgrade to TLS (certificate is validated against serverName)
        const tcpConn = this.conn as Deno.TcpConn;
        this.conn = await Deno.startTls(tcpConn, {
          hostname: serverName,
        });

        // Force TLS handshake + validate certificate now (avoid failing later on LOGIN)
        const noopTag = this.getTag();
        await this.writeCommand(`${noopTag} NOOP`);
        await this.readUntilTag(noopTag);

        console.log(`TLS connection upgraded successfully (server name: ${serverName})`);
        return;
      } catch (e) {
        lastError = e;
        console.error(`STARTTLS attempt failed for \"${serverName}\":`, e);
        await this.reconnectPlain();
      }
    }

    const lastMsg =
      lastError instanceof Error ? lastError.message : String(lastError ?? "");

    throw new Error(
      `Certificat SSL invalide pour ${this.host}. ` +
        `Veuillez utiliser un nom de serveur correspondant au certificat (ex: mail.domaine.tld) ` +
        `ou corriger le certificat côté serveur. ` +
        `Noms testés: ${serverNameCandidates.join(", ")}. ` +
        (lastMsg ? `Dernière erreur: ${lastMsg}` : "")
    );
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

// Créer ou mettre à jour un fil de discussion
async function upsertEmailThread(
  supabase: any,
  normalizedSubject: string,
  email: {
    from_address: string;
    to_addresses: string[];
    cc_addresses?: string[];
    sent_at: string;
    body_text?: string;
  },
  existingThreadEmails: Array<{ from_address: string; to_addresses: string[]; cc_addresses?: string[]; sent_at: string }>
): Promise<string | null> {
  try {
    // Chercher un fil existant avec ce sujet normalisé
    const { data: existingThread } = await supabase
      .from('email_threads')
      .select('*')
      .eq('subject_normalized', normalizedSubject)
      .maybeSingle();
    
    const allEmails = [...existingThreadEmails, email].sort(
      (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
    );
    
    const firstEmail = allEmails[0];
    const lastEmail = allEmails[allEmails.length - 1];
    
    // Identifier les participants
    const participants = new Set<string>();
    allEmails.forEach(e => {
      participants.add(e.from_address.toLowerCase());
      (e.to_addresses || []).forEach(a => participants.add(a.toLowerCase()));
      (e.cc_addresses || []).forEach(a => participants.add(a.toLowerCase()));
    });
    
    // Identifier le client (premier expéditeur non-SODATRA, non-partenaire)
    let clientEmail = '';
    let clientCompany = '';
    for (const e of allEmails) {
      const fromLower = e.from_address.toLowerCase();
      if (!fromLower.includes('@sodatra') && !KNOWN_PARTNERS.some(p => fromLower.includes(p))) {
        clientEmail = e.from_address;
        clientCompany = extractCompanyFromEmail(e.from_address);
        break;
      }
    }
    
    // Identifier si un partenaire est impliqué
    let partnerEmail = '';
    for (const p of Array.from(participants)) {
      if (KNOWN_PARTNERS.some(kp => p.includes(kp))) {
        partnerEmail = p;
        break;
      }
    }
    
    // Déterminer notre rôle
    const ourRole = determineOurRole(allEmails as any, firstEmail?.from_address || '');
    
    // Extraire un nom de projet potentiel
    let projectName = '';
    const projectPatterns = [
      /projet\s+([^,.\n]+)/i,
      /project\s+([^,.\n]+)/i,
      /olympic/i,
      /jeux\s+olympiques/i,
    ];
    for (const e of allEmails) {
      const content = (e as any).body_text || '';
      for (const pattern of projectPatterns) {
        const match = content.match(pattern);
        if (match) {
          projectName = match[1]?.trim() || match[0];
          break;
        }
      }
      if (projectName) break;
    }
    
    const threadData = {
      subject_normalized: normalizedSubject,
      first_message_at: firstEmail?.sent_at,
      last_message_at: lastEmail?.sent_at,
      participants: Array.from(participants),
      client_email: clientEmail,
      client_company: clientCompany,
      our_role: ourRole,
      partner_email: partnerEmail || null,
      project_name: projectName || null,
      email_count: allEmails.length,
      updated_at: new Date().toISOString(),
    };
    
    if (existingThread) {
      // Mettre à jour le fil existant
      await supabase
        .from('email_threads')
        .update(threadData)
        .eq('id', existingThread.id);
      return existingThread.id;
    } else {
      // Créer un nouveau fil
      const { data: newThread, error } = await supabase
        .from('email_threads')
        .insert(threadData)
        .select('id')
        .single();
      
      if (error) {
        console.error('Error creating thread:', error);
        return null;
      }
      return newThread?.id || null;
    }
  } catch (error) {
    console.error('Error in upsertEmailThread:', error);
    return null;
  }
}

// Créer ou mettre à jour un contact
async function upsertContact(
  supabase: any,
  email: string,
  role: string,
  name?: string
): Promise<void> {
  try {
    const company = extractCompanyFromEmail(email);
    
    // Upsert le contact
    await supabase
      .from('contacts')
      .upsert({
        email: email.toLowerCase(),
        name: name || null,
        company,
        role,
        interaction_count: 1,
        last_interaction_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'email',
        ignoreDuplicates: false
      });
    
    // Incrémenter le compteur d'interaction
    await supabase.rpc('increment_contact_interaction', { contact_email: email.toLowerCase() })
      .catch(() => {
        // Function may not exist yet, that's ok
      });
  } catch (error) {
    console.error('Error upserting contact:', error);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let client: SimpleIMAPClient | null = null;

  try {
    const { configId, limit = 20 } = await req.json();
    
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
          
          const isQuotation = isQuotationRelated(msg.from, msg.subject, bodyText || bodyHtml || '');
          const threadId = extractThreadId(msg.messageId, msg.references);
          const normalizedSubject = normalizeSubject(msg.subject);
          
          // Récupérer les emails existants du même fil pour analyse
          const { data: existingThreadEmails } = await supabase
            .from('emails')
            .select('from_address, to_addresses, cc_addresses, sent_at, body_text')
            .or(`thread_id.eq.${threadId},subject.ilike.%${normalizedSubject.substring(0, 30)}%`)
            .order('sent_at', { ascending: true });
          
          // Créer/mettre à jour le fil de discussion
          const emailData = {
            from_address: msg.from,
            to_addresses: msg.to.length > 0 ? msg.to : [config.username],
            cc_addresses: [] as string[],
            sent_at: parseEmailDate(msg.date),
            body_text: bodyText || '',
          };
          
          const threadRefId = await upsertEmailThread(
            supabase,
            normalizedSubject,
            emailData,
            existingThreadEmails || []
          );
          
          // Identifier et enregistrer le contact
          const isFirstInThread = !existingThreadEmails || existingThreadEmails.length === 0;
          const contactRole = identifyContactRole(msg.from, isFirstInThread, bodyText || '');
          await upsertContact(supabase, msg.from, contactRole);

          const { data: inserted, error: insertError } = await supabase
            .from('emails')
            .insert({
              email_config_id: configId,
              message_id: msg.messageId,
              thread_id: threadId,
              thread_ref: threadRefId,
              from_address: msg.from,
              to_addresses: msg.to.length > 0 ? msg.to : [config.username],
              subject: msg.subject,
              body_text: bodyText || null,
              body_html: bodyHtml || null,
              sent_at: parseEmailDate(msg.date),
              is_quotation_request: isQuotation
            })
            .select()
            .single();

          if (insertError) {
            console.error("Error inserting email:", insertError);
            continue;
          }

          processedEmails.push(inserted);
          console.log(`Imported: ${msg.subject.substring(0, 50)}... (thread: ${threadRefId || 'none'})`);
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
