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

// ============ TYPES ============

interface KnownBusinessContact {
  id: string;
  domain_pattern: string;
  company_name: string;
  default_role: 'partner' | 'client' | 'supplier' | 'agent' | 'internal';
  country: string | null;
  notes: string | null;
}

interface EmailRecord {
  from_address: string;
  to_addresses: string[];
  cc_addresses?: string[];
  sent_at: string;
  subject?: string;
  body_text?: string;
}

interface ParticipantInfo {
  email: string;
  role: string;
  company: string;
  isKnown: boolean;
}

interface ThreadRoles {
  clientEmail: string;
  clientCompany: string;
  partnerEmail: string | null;
  ourRole: 'direct_quote' | 'assist_partner';
  participants: ParticipantInfo[];
}

// ============ THREAD & ROLE IDENTIFICATION ============

// Normaliser le sujet (retirer RE:, FW:, etc.)
function normalizeSubject(subject: string): string {
  return (subject || '')
    .replace(/^(re:|fw:|fwd:|tr:|aw:|wg:|r:|転送:|回复:|antw:|\[external\]|\(sans sujet\))\s*/gi, '')
    .replace(/^(re:|fw:|fwd:|tr:|aw:|wg:|r:|転送:|回复:|antw:)\s*/gi, '') // Second pass
    .trim()
    .toLowerCase();
}

// Extraire le nom de l'entreprise depuis l'email (fallback si pas dans known_business_contacts)
function extractCompanyFromEmail(email: string): string {
  const match = email.match(/@([^.]+)\./);
  if (match) {
    const domain = match[1].toLowerCase();
    return domain.toUpperCase().replace(/-/g, ' ');
  }
  return 'UNKNOWN';
}

// Extraire le domaine d'un email
function extractDomain(email: string): string {
  const match = email.match(/@([^>]+)$/);
  return match ? match[1].toLowerCase() : '';
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

// ============ NOUVELLE LOGIQUE D'EXTRACTION DE L'EXPÉDITEUR ORIGINAL ============

// Extraire l'expéditeur ORIGINEL depuis les citations dans le body
function extractOriginalSender(bodyText: string): { email: string; name: string } | null {
  if (!bodyText) return null;
  
  // Patterns pour trouver le message original cité
  const patterns = [
    // Format français: "Le jeu. 18 déc. 2025 à 19:29, Knoll, Matthias <M.Knoll@group-7.de> a écrit"
    /Le\s+\w+\.?\s+\d+\s+\w+\.?\s+\d+\s+[àa]\s+\d+[:\d]+,\s*([^<]+)\s*<([^>]+)>\s*a\s+[eé]crit/i,
    // Format anglais: "On Thu, Dec 18, 2025 at 7:29 PM Matthias Knoll <M.Knoll@group-7.de> wrote:"
    /On\s+\w+,\s+\w+\s+\d+,\s+\d+\s+at\s+[\d:]+\s*(?:AM|PM)?\s*([^<]+)\s*<([^>]+)>\s*wrote/i,
    // Format Outlook: "From: Knoll, Matthias <M.Knoll@group-7.de>"
    /From:\s*([^<\r\n]+)\s*<([^>]+)>/i,
    // Format simple: "De: M.Knoll@group-7.de"
    /(?:From|De|Von):\s*<?([^\s<>\r\n]+@[^\s<>\r\n]+)>?/i,
    // Format signature: "Matthias Knoll <M.Knoll@group-7.de>"
    /([A-Za-z]+(?:\s+[A-Za-z]+)?)\s*<([^>]+@[^>]+)>/i,
  ];
  
  // Chercher dans les citations les plus profondes (fin du body)
  const lines = bodyText.split('\n').reverse();
  
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        // Pattern avec 2 groupes (nom + email)
        if (match[2]) {
          return {
            name: match[1].trim(),
            email: match[2].trim().toLowerCase()
          };
        }
        // Pattern avec 1 groupe (email seul)
        if (match[1] && match[1].includes('@')) {
          return {
            name: '',
            email: match[1].trim().toLowerCase()
          };
        }
      }
    }
  }
  
  return null;
}

// Valider qu'une chaîne est une adresse email valide
function isValidEmail(str: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
}

// Nettoyer la liste des participants (supprimer les entrées invalides)
function cleanParticipants(emails: EmailRecord[]): string[] {
  const participants = new Set<string>();
  
  for (const email of emails) {
    const allAddresses = [
      email.from_address,
      ...(email.to_addresses || []),
      ...(email.cc_addresses || [])
    ];
    
    for (const addr of allAddresses) {
      const cleaned = addr.toLowerCase().trim();
      if (isValidEmail(cleaned)) {
        participants.add(cleaned);
      }
    }
  }
  
  return Array.from(participants);
}

// ============ IDENTIFICATION DES RÔLES VIA known_business_contacts ============

// Trouver le rôle d'un email via la table known_business_contacts
function findKnownContact(
  email: string,
  knownContacts: KnownBusinessContact[]
): KnownBusinessContact | null {
  const domain = extractDomain(email);
  
  for (const contact of knownContacts) {
    if (domain.includes(contact.domain_pattern) || email.toLowerCase().includes(contact.domain_pattern)) {
      return contact;
    }
  }
  
  return null;
}

// Déterminer les rôles de tous les participants du fil
async function determineThreadRoles(
  supabase: any,
  emails: EmailRecord[],
  knownContacts: KnownBusinessContact[]
): Promise<ThreadRoles> {
  // 1. Collecter tous les participants avec leur rôle
  const participantsMap = new Map<string, ParticipantInfo>();
  const cleanedEmails = cleanParticipants(emails);
  
  for (const email of cleanedEmails) {
    const knownContact = findKnownContact(email, knownContacts);
    
    if (knownContact) {
      participantsMap.set(email, {
        email,
        role: knownContact.default_role,
        company: knownContact.company_name,
        isKnown: true
      });
    } else {
      participantsMap.set(email, {
        email,
        role: 'prospect', // Par défaut, on ne sait pas
        company: extractCompanyFromEmail(email),
        isKnown: false
      });
    }
  }
  
  // 2. Analyser le contenu pour trouver l'expéditeur ORIGINEL
  let originalSenderEmail: string | null = null;
  
  // Trier les emails par date pour trouver le plus ancien
  const sortedEmails = [...emails].sort(
    (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
  );
  
  // Chercher dans le corps des emails les citations (expéditeur original)
  for (const email of sortedEmails) {
    const originalSender = extractOriginalSender(email.body_text || '');
    if (originalSender && isValidEmail(originalSender.email)) {
      originalSenderEmail = originalSender.email;
      break;
    }
  }
  
  // 3. Identifier le CLIENT
  // Priorité: l'expéditeur original cité → le premier expéditeur non-internal/non-partner
  let clientEmail = '';
  let clientCompany = '';
  
  // D'abord vérifier si l'expéditeur original cité est le client
  if (originalSenderEmail) {
    const participant = participantsMap.get(originalSenderEmail);
    if (participant && !['internal', 'partner'].includes(participant.role)) {
      clientEmail = originalSenderEmail;
      clientCompany = participant.company;
      // Mettre à jour le rôle si c'était prospect
      if (participant.role === 'prospect') {
        participant.role = 'client';
      }
    }
  }
  
  // Sinon, chercher le premier expéditeur non-internal, non-partner, non-supplier
  if (!clientEmail) {
    for (const email of sortedEmails) {
      const senderEmail = email.from_address.toLowerCase();
      const participant = participantsMap.get(senderEmail);
      
      if (participant && !['internal', 'partner', 'supplier', 'agent'].includes(participant.role)) {
        clientEmail = senderEmail;
        clientCompany = participant.company;
        if (participant.role === 'prospect') {
          participant.role = 'client';
        }
        break;
      }
    }
  }
  
  // Si toujours pas de client, prendre le premier expéditeur non-internal
  if (!clientEmail) {
    for (const email of sortedEmails) {
      const senderEmail = email.from_address.toLowerCase();
      const participant = participantsMap.get(senderEmail);
      
      if (participant && participant.role !== 'internal') {
        clientEmail = senderEmail;
        clientCompany = participant.company;
        if (participant.role === 'prospect') {
          participant.role = 'client';
        }
        break;
      }
    }
  }
  
  // 4. Identifier le PARTENAIRE
  let partnerEmail: string | null = null;
  
  for (const [email, info] of participantsMap) {
    if (info.role === 'partner') {
      partnerEmail = email;
      break;
    }
  }
  
  // 5. Déterminer notre rôle (SODATRA)
  // assist_partner: Si un partenaire a transmis une demande client à SODATRA
  // direct_quote: Si le client a contacté SODATRA directement
  let ourRole: 'direct_quote' | 'assist_partner' = 'direct_quote';
  
  if (partnerEmail) {
    // Vérifier si le client a JAMAIS contacté SODATRA directement
    const clientContactedSodatraDirectly = sortedEmails.some(email => {
      const senderEmail = email.from_address.toLowerCase();
      if (senderEmail !== clientEmail) return false;
      
      const toAddresses = (email.to_addresses || []).map(e => e.toLowerCase());
      const ccAddresses = (email.cc_addresses || []).map(e => e.toLowerCase());
      
      const allRecipients = [...toAddresses, ...ccAddresses];
      return allRecipients.some(r => r.includes('@sodatra'));
    });
    
    // Si le client n'a jamais contacté SODATRA directement, c'est une assist_partner
    if (!clientContactedSodatraDirectly) {
      ourRole = 'assist_partner';
    }
    
    // OU si le partenaire nous a mis en CC (pas en TO) sur un email au client
    const partnerPutUsInCC = sortedEmails.some(email => {
      const senderEmail = email.from_address.toLowerCase();
      if (!partnerEmail || senderEmail !== partnerEmail) return false;
      
      const toAddresses = (email.to_addresses || []).map(e => e.toLowerCase());
      const ccAddresses = (email.cc_addresses || []).map(e => e.toLowerCase());
      
      const sodatraInTo = toAddresses.some(t => t.includes('@sodatra'));
      const sodatraInCc = ccAddresses.some(c => c.includes('@sodatra'));
      
      return !sodatraInTo && sodatraInCc;
    });
    
    if (partnerPutUsInCC) {
      ourRole = 'assist_partner';
    }
  }
  
  return {
    clientEmail,
    clientCompany,
    partnerEmail,
    ourRole,
    participants: Array.from(participantsMap.values())
  };
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

      if (
        line.startsWith(`${tag} OK`) ||
        line.startsWith(`${tag} NO`) ||
        line.startsWith(`${tag} BAD`)
      ) {
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
    
    // Extract body content (literal-safe)
    const bodyMarker = response.match(/BODY\[TEXT\] \{(\d+)\}\r\n/);
    if (bodyMarker) {
      const bodySize = parseInt(bodyMarker[1], 10);
      const bodyStart = response.indexOf(bodyMarker[0]) + bodyMarker[0].length;
      const rawBody = response.substring(bodyStart, bodyStart + bodySize);

      console.log(`[IMAP] BODY[TEXT] literal size=${bodySize}, extracted=${rawBody.length}`);

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

// Extraire un identifiant de projet unique depuis le contenu
function extractProjectIdentifier(subject: string, bodyText: string): { projectId: string; projectName: string } {
  const content = `${subject} ${bodyText}`.toLowerCase();
  
  // Patterns pour identifier un projet spécifique
  const projectPatterns = [
    // Événements sportifs internationaux
    { regex: /(youth\s+olympic\s+games?\s*\d*)/i, weight: 10 },
    { regex: /(olympic\s+games?\s*\d*)/i, weight: 10 },
    { regex: /(jeux\s+olympiques?\s*(?:de\s+la\s+jeunesse)?\s*\d*)/i, weight: 10 },
    { regex: /(world\s+cup\s*\d*)/i, weight: 10 },
    { regex: /(coupe\s+du\s+monde\s*\d*)/i, weight: 10 },
    { regex: /(afcon\s*\d*|can\s*\d{4})/i, weight: 10 },
    
    // Projets nommés explicitement
    { regex: /projet[:\s]+([^,.\n]{3,40})/i, weight: 8 },
    { regex: /project[:\s]+([^,.\n]{3,40})/i, weight: 8 },
    { regex: /ref[:\s]+([A-Z0-9\-\/]{4,20})/i, weight: 7 },
    { regex: /référence[:\s]+([A-Z0-9\-\/]{4,20})/i, weight: 7 },
    
    // Destinations spécifiques avec cargo
    { regex: /(ham\s*[-–]\s*dkr|hamburg\s*[-–to]+\s*dakar)/i, weight: 6 },
    { regex: /(muc\s*[-–]\s*dss|munich\s*[-–to]+\s*dakar)/i, weight: 6 },
    { regex: /(par\s*[-–]\s*dkr|paris\s*[-–to]+\s*dakar)/i, weight: 6 },
    
    // Conteneurs avec référence
    { regex: /(\d+\s*x\s*\d{2}['"]?\s*(?:hc|dv|gp|rf|ot))/i, weight: 5 },
    
    // Numéros de booking/reference
    { regex: /(booking[:\s#]+[A-Z0-9]{6,})/i, weight: 5 },
    { regex: /(bl[:\s#]+[A-Z0-9]{6,})/i, weight: 5 },
  ];
  
  let bestMatch: { projectId: string; projectName: string; weight: number } | null = null;
  
  for (const pattern of projectPatterns) {
    const match = content.match(pattern.regex);
    if (match) {
      const extracted = (match[1] || match[0]).trim();
      if (!bestMatch || pattern.weight > bestMatch.weight) {
        bestMatch = {
          projectId: extracted.toLowerCase().replace(/\s+/g, '_').substring(0, 50),
          projectName: extracted,
          weight: pattern.weight,
        };
      }
    }
  }
  
  // Si un projet est trouvé, retourner
  if (bestMatch) {
    console.log(`Project identified: ${bestMatch.projectName} (ID: ${bestMatch.projectId})`);
    return { projectId: bestMatch.projectId, projectName: bestMatch.projectName };
  }
  
  // Fallback: combiner les éléments clés du sujet et des routes
  return { projectId: '', projectName: '' };
}

// Calculer la similarité entre deux sujets
function calculateSubjectSimilarity(subject1: string, subject2: string): number {
  // Extraire les mots-clés importants
  const extractKeywords = (s: string): Set<string> => {
    const words = s.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2)
      .filter(w => !['the', 'and', 'for', 'from', 'with', 'request', 'sea', 'air', 'freight'].includes(w));
    return new Set(words);
  };
  
  const kw1 = extractKeywords(subject1);
  const kw2 = extractKeywords(subject2);
  
  if (kw1.size === 0 || kw2.size === 0) return 0;
  
  const intersection = new Set([...kw1].filter(x => kw2.has(x)));
  const union = new Set([...kw1, ...kw2]);
  
  return intersection.size / union.size; // Jaccard similarity
}

// Trouver un fil existant par projet OU par participants similaires
async function findExistingThread(
  supabase: any,
  projectId: string,
  normalizedSubject: string,
  clientEmail: string
): Promise<{ id: string; project_name: string } | null> {
  try {
    // 1. D'abord chercher par project_name si on a un projet
    if (projectId) {
      const { data: projectThread } = await supabase
        .from('email_threads')
        .select('id, project_name')
        .ilike('project_name', `%${projectId.replace(/_/g, '%')}%`)
        .order('last_message_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (projectThread) {
        console.log(`Found thread by project: ${projectThread.project_name}`);
        return projectThread;
      }
    }
    
    // 2. Chercher par sujet normalisé exact
    const { data: subjectThread } = await supabase
      .from('email_threads')
      .select('id, project_name, subject_normalized')
      .eq('subject_normalized', normalizedSubject)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (subjectThread) {
      console.log(`Found thread by subject: ${normalizedSubject}`);
      return subjectThread;
    }
    
    // 3. Chercher par client + sujet similaire
    if (clientEmail) {
      const { data: threads } = await supabase
        .from('email_threads')
        .select('id, project_name, subject_normalized')
        .eq('client_email', clientEmail)
        .order('last_message_at', { ascending: false })
        .limit(5);
      
      if (threads) {
        for (const thread of threads) {
          const similarity = calculateSubjectSimilarity(normalizedSubject, thread.subject_normalized);
          if (similarity > 0.6) {
            console.log(`Found thread by client + similar subject: ${thread.subject_normalized} (similarity: ${similarity})`);
            return thread;
          }
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error finding existing thread:', error);
    return null;
  }
}

// Liste noire pour les sujets de fil (threads non-quotation)
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

// Déterminer si un fil est lié à une demande de cotation
function isQuotationThread(
  normalizedSubject: string,
  threadEmails: EmailRecord[]
): boolean {
  const subjectLower = normalizedSubject.toLowerCase();
  
  // Exclure si sujet dans la liste noire des fils
  if (EXCLUDED_THREAD_SUBJECTS.some(excl => subjectLower.includes(excl.toLowerCase()))) {
    console.log(`Thread excluded - subject blacklisted: ${normalizedSubject}`);
    return false;
  }
  
  // Inclure si au moins un email du fil est une demande de cotation
  // (basé sur les mots-clés - on réutilise la logique existante)
  const hasQuotationEmail = threadEmails.some(email => {
    const text = `${(email.subject || '').toLowerCase()} ${(email.body_text || '').toLowerCase()}`;
    return QUOTATION_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
  });
  
  if (hasQuotationEmail) {
    console.log(`Thread included - has quotation keywords: ${normalizedSubject}`);
    return true;
  }
  
  // Exclure les fils des expéditeurs dans la liste noire
  const hasOnlyBlacklistedSenders = threadEmails.every(email => {
    const fromLower = email.from_address.toLowerCase();
    return EXCLUDED_SENDERS.some(sender => fromLower.includes(sender.toLowerCase()));
  });
  
  if (hasOnlyBlacklistedSenders) {
    console.log(`Thread excluded - all senders blacklisted: ${normalizedSubject}`);
    return false;
  }
  
  // Par défaut, inclure si aucun critère d'exclusion n'est rempli
  // (on préfère inclure les fils douteux pour ne pas rater de cotations)
  return true;
}

// Créer ou mettre à jour un fil de discussion
async function upsertEmailThread(
  supabase: any,
  normalizedSubject: string,
  email: EmailRecord,
  existingThreadEmails: EmailRecord[],
  knownContacts: KnownBusinessContact[]
): Promise<string | null> {
  try {
    // Collecter tous les emails du fil
    const allEmails = [...existingThreadEmails, email].sort(
      (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
    );
    
    // Déterminer les rôles avec la nouvelle logique
    const threadRoles = await determineThreadRoles(supabase, allEmails, knownContacts);
    
    // Extraire le projet du contenu
    const { projectId, projectName } = extractProjectIdentifier(
      normalizedSubject,
      email.body_text || ''
    );
    
    // Nettoyer les participants
    const cleanedParticipants = cleanParticipants(allEmails);
    
    // Chercher un fil existant
    const existingThread = await findExistingThread(
      supabase,
      projectId,
      normalizedSubject,
      threadRoles.clientEmail
    );
    
    const firstEmail = allEmails[0];
    const lastEmail = allEmails[allEmails.length - 1];
    
    // Utiliser le nom de projet trouvé ou celui existant
    const finalProjectName = projectName || existingThread?.project_name || '';
    
    // Construire les données enrichies des participants
    const participantsData = threadRoles.participants.map(p => ({
      email: p.email,
      role: p.role,
      company: p.company
    }));
    
    // Déterminer si c'est un fil de cotation
    const isQuotation = isQuotationThread(normalizedSubject, allEmails);
    
    const threadData = {
      subject_normalized: normalizedSubject,
      first_message_at: firstEmail?.sent_at,
      last_message_at: lastEmail?.sent_at,
      participants: participantsData,
      client_email: threadRoles.clientEmail,
      client_company: threadRoles.clientCompany,
      our_role: threadRoles.ourRole,
      partner_email: threadRoles.partnerEmail,
      project_name: finalProjectName || null,
      email_count: allEmails.length,
      is_quotation_thread: isQuotation,
      updated_at: new Date().toISOString(),
    };
    
    console.log(`Thread roles determined: client=${threadRoles.clientEmail}, partner=${threadRoles.partnerEmail}, our_role=${threadRoles.ourRole}, is_quotation=${isQuotation}`);
    
    if (existingThread) {
      // Mettre à jour le fil existant
      await supabase
        .from('email_threads')
        .update(threadData)
        .eq('id', existingThread.id);
      console.log(`Updated thread ${existingThread.id} for project: ${finalProjectName || normalizedSubject}`);
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
      console.log(`Created new thread ${newThread?.id} for project: ${finalProjectName || normalizedSubject}`);
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
  knownContacts: KnownBusinessContact[],
  name?: string
): Promise<void> {
  try {
    // Chercher d'abord dans les contacts connus
    const knownContact = findKnownContact(email, knownContacts);
    
    const company = knownContact?.company_name || extractCompanyFromEmail(email);
    const finalRole = knownContact?.default_role || role;
    
    // Upsert le contact
    await supabase
      .from('contacts')
      .upsert({
        email: email.toLowerCase(),
        name: name || null,
        company,
        role: finalRole,
        country: knownContact?.country || null,
        interaction_count: 1,
        last_interaction_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'email',
        ignoreDuplicates: false
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

    // Charger les contacts connus depuis la DB
    const { data: knownContacts } = await supabase
      .from('known_business_contacts')
      .select('*')
      .eq('is_active', true);
    
    console.log(`Loaded ${knownContacts?.length || 0} known business contacts`);

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
          
          // Créer/mettre à jour le fil de discussion avec la nouvelle logique
          const emailData: EmailRecord = {
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
            existingThreadEmails || [],
            knownContacts || []
          );
          
          // Identifier et enregistrer le contact avec les contacts connus
          const knownContact = findKnownContact(msg.from, knownContacts || []);
          const contactRole = knownContact?.default_role || 'prospect';
          await upsertContact(supabase, msg.from, contactRole, knownContacts || []);

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
