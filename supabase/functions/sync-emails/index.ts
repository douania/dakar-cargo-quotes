import { ImapByteReader, readImapHeaders } from "../_shared/imap-headers.ts";
import { decodeSearchHeader, requireImapCommandOk, searchFetchMessages } from "../_shared/imap-subject-search.ts";
import { readMailboxSecret, quoteImapString } from "../_shared/mailbox-secret.ts";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";

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
  'dropbox.com', 'wetransfer.com',
  // TLD marketing
  '.shop', '.vip', '.store', '.promo', '.deals', '.sale'
];

// Sujets à exclure (notifications bancaires, LinkedIn, etc.)
// Note: 'spam:' is NOT in this list - it's handled specially as often false positive
const EXCLUDED_SUBJECTS = [
  // Notifications bancaires
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
  'out of office', 'absence du bureau', 'automatic reply', 'réponse automatique',
  // Marketing/Promotions
  'invitation', 'conference', 'webinar', 'summit', 'meet global',
  'bouquet', 'offre spéciale', 'special offer', 'promo ',
  'black friday', 'soldes', 'flash sale', 'limited time',
  'your daily', 'daily digest', 'weekly report',
  'say it with', 'parfait', 'official invitation'
];

// Clean Outlook spam prefix from subject (these are often false positives)
function cleanSpamPrefix(subject: string): string {
  return (subject || '')
    .replace(/^Spam:\**,?\s*/i, '')
    .replace(/^\[Spam\]\s*/i, '')
    .replace(/^\*+Spam\*+:?\s*/i, '')
    .trim();
}

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
  
  // 0. REJETER les expéditeurs invalides
  if (!from || fromLower.trim() === '' || fromLower === 'unknown@unknown.com') {
    console.log(`Email excluded - invalid sender: ${from}`);
    return false;
  }
  
  // Clean spam prefix before checking - "Spam:" alone is not an exclusion indicator
  const cleanedSubject = cleanSpamPrefix(subject);
  const subjectLower = cleanedSubject.toLowerCase();
  const bodyLower = body.toLowerCase();
  
  // 1. EXCLURE si expéditeur dans la liste noire
  if (EXCLUDED_SENDERS.some(sender => fromLower.includes(sender.toLowerCase()))) {
    console.log(`Email excluded - sender blacklisted: ${from}`);
    return false;
  }
  
  // 1b. EXCLURE si TLD marketing
  const senderDomain = extractDomain(from);
  if (['.shop', '.vip', '.store', '.promo', '.deals', '.sale'].some(tld => senderDomain.endsWith(tld.substring(1)))) {
    console.log(`Email excluded - marketing TLD: ${from}`);
    return false;
  }
  
  // 2. EXCLURE si sujet (nettoyé) dans la liste noire
  if (EXCLUDED_SUBJECTS.some(subj => subjectLower.includes(subj.toLowerCase()))) {
    console.log(`Email excluded - subject blacklisted: ${cleanedSubject}`);
    return false;
  }
  
  // 3. INCLURE si au moins 2 mots-clés positifs trouvés (seuil strict)
  const text = `${subjectLower} ${bodyLower}`;
  const matchCount = QUOTATION_KEYWORDS.filter(kw => text.includes(kw.toLowerCase())).length;
  
  if (matchCount >= 2) {
    console.log(`Email included - ${matchCount} quotation keywords found in: ${cleanedSubject}`);
  }
  
  return matchCount >= 2;
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

// Normaliser le sujet (retirer RE:, FW:, Spam:, etc.)
function normalizeSubject(subject: string): string {
  // 1. Clean spam prefix first
  let cleaned = cleanSpamPrefix(subject);
  
  // 2. Remove reply/forward prefixes (loop)
  let prev = '';
  while (prev !== cleaned) {
    prev = cleaned;
    cleaned = cleaned
      .replace(/^(re:|fw:|fwd:|tr:|aw:|wg:|r:|転送:|回复:|antw:|\[external\]|\(sans sujet\))\s*/gi, '')
      .trim();
  }
  
  return cleaned.toLowerCase();
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
  private reader = new ImapByteReader(buffer => this.conn!.read(buffer));
  private tagCounter = 0;
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

      if (new RegExp('^' + tag + ' (?:OK|NO|BAD)(?:\\s|$)', 'i').test(line)) break;
    }

    return result;
  }

  private async reconnectPlain(): Promise<void> {
    try {
      this.conn?.close();
    } catch {
      // ignore
    }

    this.reader.clear();
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
      console.log(`STARTTLS: trying TLS server name "${serverName}"`);

      try {
        const tag = this.getTag();
        await this.writeCommand(`${tag} STARTTLS`);

        const response = await this.readUntilTag(tag);
        if (!response.includes(`${tag} OK`)) {
          throw new Error(`STARTTLS failed: ${response}`);
        }

        console.log("STARTTLS accepted, upgrading connection...");

        // Clear buffer before upgrade
        this.reader.clear();

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
        console.error(`STARTTLS attempt failed for "${serverName}":`, e);
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
    const response = await this.sendCommand(`LOGIN ${quoteImapString(username)} ${quoteImapString(password)}`);
    requireImapCommandOk(response, "LOGIN");
    return true;
  }

  async select(mailbox: string): Promise<{ exists: number }> {
    const response = await this.sendCommand(`SELECT ${quoteImapString(mailbox)}`);
    requireImapCommandOk(response, "SELECT");
    const existsMatch = response.match(/\* (\d+) EXISTS/);
    if (!existsMatch) throw new Error("Nombre de messages IMAP absent");
    return { exists: parseInt(existsMatch[1]) };
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
    
    requireImapCommandOk(response, "FETCH headers");
    return searchFetchMessages(response).map(({ uid, headerResponse }) => ({
      uid, ...readImapHeaders(headerResponse, uid, decodeSearchHeader),
    }));
  }

  async fetchBody(uid: number): Promise<{ text: string; html: string }> {
    const response = await this.sendCommand(`UID FETCH ${uid} BODY.PEEK[TEXT]`);
    requireImapCommandOk(response, "FETCH body");
    
    let text = '';
    let html = '';
    
    // Extract body content (literal-safe)
    const bodyMarker = response.match(/BODY\[TEXT\] \{(\d+)\}\r\n/);
    if (!bodyMarker) throw new Error("Corps IMAP absent ou incomplet");
    if (bodyMarker) {
      const bodySize = parseInt(bodyMarker[1], 10);
      const bodyStart = response.indexOf(bodyMarker[0]) + bodyMarker[0].length;
      const rawBytes = new TextEncoder().encode(response.slice(bodyStart));
      if (rawBytes.length < bodySize) throw new Error("Corps IMAP incomplet");
      const rawBody = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes.slice(0, bodySize));

      console.log(`[IMAP] BODY[TEXT] literal size=${bodySize}, extracted=${rawBody.length}`);

      text = decodeBody(rawBody);

      if (rawBody.includes('<html') || rawBody.includes('<HTML')) {
        html = text;
        text = stripHtml(html);
      }
    }

    return { text, html };
  }

  async fetchBodyStructure(uid: number): Promise<AttachmentInfo[]> {
    const response = await this.sendCommand(`UID FETCH ${uid} BODYSTRUCTURE`);
    requireImapCommandOk(response, "FETCH BODYSTRUCTURE");
    return parseBodyStructure(response);
  }

  async fetchAttachment(uid: number, partNumber: string, encoding: string): Promise<Uint8Array> {
    console.log(`[FETCH] Fetching attachment: UID ${uid}, part ${partNumber}, encoding ${encoding}`);
    
    const response = await this.sendCommand(`UID FETCH ${uid} BODY.PEEK[${partNumber}]`);
    requireImapCommandOk(response, "FETCH attachment");
    console.log(`[FETCH] Response length: ${response.length} chars`);
    
    let rawContent = '';
    
    // Pattern 1: BODY[X] {size}\r\ncontent - literal format
    const literalMatch = response.match(/BODY\[[\d.]+\]\s*\{(\d+)\}/i);
    if (literalMatch) {
      const expectedSize = parseInt(literalMatch[1], 10);
      const literalMarker = `{${expectedSize}}`;
      const afterBrace = response.indexOf(literalMarker) + literalMarker.length;
      let contentStart = afterBrace;
      if (response.substring(afterBrace, afterBrace + 2) === '\r\n') {
        contentStart = afterBrace + 2;
      } else if (response[afterBrace] === '\n') {
        contentStart = afterBrace + 1;
      }
      rawContent = response.substring(contentStart, contentStart + expectedSize);
      console.log(`[FETCH] Extracted ${rawContent.length}/${expectedSize} bytes using literal pattern`);
    }
    
    // Pattern 2: BODY[X] "content" - quoted format
    if (!rawContent) {
      const quotedMatch = response.match(/BODY\[[\d.]+\]\s+"([^"]*)"/i);
      if (quotedMatch && quotedMatch[1]) {
        rawContent = quotedMatch[1];
        console.log(`[FETCH] Extracted ${rawContent.length} bytes using quoted pattern`);
      }
    }
    
    // Pattern 3: Extract content between BODY[X] and closing paren
    if (!rawContent) {
      const bodyStartMatch = response.match(/BODY\[[\d.]+\]\s*/i);
      if (bodyStartMatch) {
        const startIdx = response.indexOf(bodyStartMatch[0]) + bodyStartMatch[0].length;
        const tagMatch = response.match(/\r\n[A-Z]\d+\s+(OK|NO|BAD)/i);
        const endIdx = tagMatch ? response.lastIndexOf(')', response.indexOf(tagMatch[0])) : response.lastIndexOf(')');
        if (endIdx > startIdx) {
          rawContent = response.substring(startIdx, endIdx).trim();
          console.log(`[FETCH] Extracted ${rawContent.length} bytes using fallback pattern`);
        }
      }
    }
    
    if (!rawContent || rawContent.length === 0) {
      console.log(`[FETCH] No content extracted for part ${partNumber}`);
      return new Uint8Array(0);
    }
    
    // Decode based on encoding
    if (encoding.toLowerCase() === 'base64') {
      return decodeBase64Chunked(rawContent);
    } else if (encoding.toLowerCase() === 'quoted-printable') {
      return decodeQuotedPrintableAttachment(rawContent);
    }
    
    return new TextEncoder().encode(rawContent);
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

// ============ ATTACHMENT HELPERS (ported from import-thread) ============

interface AttachmentInfo {
  partNumber: string;
  filename: string;
  contentType: string;
  encoding: string;
  size: number;
}

// Maximum attachment size to process (5MB) - aligned with import-thread
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;
const INLINE_IMAGE_MIN_BYTES = 8000;
const SIGNATURE_IMAGE_FILENAME_PATTERN = /(logo|signature|banner|footer|spacer|facebook|instagram|linkedin)/i;

// Tokenizer for IMAP BODYSTRUCTURE
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

// Decode base64 by chunks to handle large attachments (ported from import-thread)
function decodeBase64Chunked(content: string): Uint8Array {
  try {
    const cleaned = content.replace(/[\r\n\s]/g, '');
    if (cleaned.length === 0) return new Uint8Array(0);
    
    const CHUNK_SIZE = 32768;
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < cleaned.length; i += CHUNK_SIZE) {
      let chunk = cleaned.substring(i, Math.min(i + CHUNK_SIZE, cleaned.length));
      if (i + CHUNK_SIZE < cleaned.length) {
        const remainder = chunk.length % 4;
        if (remainder !== 0) chunk = chunk.substring(0, chunk.length - remainder);
      }
      try {
        const decoded = atob(chunk);
        chunks.push(new Uint8Array([...decoded].map(c => c.charCodeAt(0))));
      } catch (chunkError) {
        console.error(`[BASE64] Chunk decode error at offset ${i}:`, chunkError);
        continue;
      }
    }
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    console.log(`[BASE64] Decoded ${cleaned.length} base64 chars to ${result.length} bytes`);
    return result;
  } catch (e) {
    console.error("[BASE64] Decode error:", e);
    return new Uint8Array(0);
  }
}

// Decode quoted-printable content to Uint8Array (ported from import-thread)
function decodeQuotedPrintableAttachment(content: string): Uint8Array {
  const decoded = content
    .replace(/=\r\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  return new TextEncoder().encode(decoded);
}

// ============ ATTACHMENT IMPORT SUB-FLOW (non-blocking) ============

async function processEmailAttachments(
  client: SimpleIMAPClient,
  uid: number,
  emailId: string,
  supabase: any
): Promise<void> {
  const attachments = await client.fetchBodyStructure(uid);
  let failed = false;
  
  if (attachments.length === 0) {
    console.log(`[sync-emails/attachments] No attachments found for UID ${uid}`);
    return;
  }
  
  console.log(`[sync-emails/attachments] Processing ${attachments.length} attachment(s) for email ${emailId}`);
  
  for (const attachment of attachments) {
    try {
      if (attachment.contentType.startsWith('image/')) {
        const isTinyImage = attachment.size < INLINE_IMAGE_MIN_BYTES;
        const hasSignatureFilename = SIGNATURE_IMAGE_FILENAME_PATTERN.test(attachment.filename);
        if (isTinyImage || hasSignatureFilename) {
          console.log(`[sync-emails/attachments] Skipping tiny/signature image: ${attachment.filename} (${attachment.contentType}, ${attachment.size} bytes)`);
          continue;
        }

        console.log(`[sync-emails/attachments] Keeping inline image candidate: ${attachment.filename} (${attachment.contentType}, ${attachment.size} bytes, part ${attachment.partNumber})`);
      }

      // Idempotency guard: check if attachment already exists for this email
      let existingQuery = supabase
        .from('email_attachments')
        .select('id, storage_path, size')
        .eq('email_id', emailId)
        .eq('filename', attachment.filename);

      if (attachment.size > 0) {
        existingQuery = existingQuery.eq('size', attachment.size);
      }

      const { data: existingAttachment, error: existingErr } = await existingQuery
        .limit(1)
        .maybeSingle();
      
      if (existingErr) {
        failed = true;
        console.warn(`[sync-emails/attachments] Error checking existing attachment:`, existingErr.message);
        continue;
      }
      
      if (existingAttachment) {
        console.log(`[sync-emails/attachments] Attachment already exists: ${attachment.filename} (id=${existingAttachment.id}), skipping`);
        continue;
      }
      
      // Handle oversized attachments: create record but don't download
      if (attachment.size > MAX_ATTACHMENT_SIZE) {
        const sizeMB = (attachment.size / 1024 / 1024).toFixed(2);
        console.log(`[sync-emails/attachments] Skipping large attachment ${attachment.filename} (${sizeMB}MB > 5MB limit)`);
        
        const { error: insertError } = await supabase
          .from('email_attachments')
          .insert({
            email_id: emailId,
            filename: attachment.filename,
            content_type: attachment.contentType,
            size: attachment.size,
            storage_path: null,
            is_analyzed: false,
            extracted_text: `[Pièce jointe trop volumineuse: ${sizeMB}MB - non traitée automatiquement]`
          });
        
        if (insertError) {
          failed = true;
          console.warn(`[sync-emails/attachments] Insert error for oversized attachment:`, insertError.message);
        }
        continue;
      }
      
      // Download attachment content
      const content = await client.fetchAttachment(uid, attachment.partNumber, attachment.encoding);
      
      if (content.length === 0) {
        failed = true;
        console.warn(`[sync-emails/attachments] Empty content for ${attachment.filename}`);
        continue;
      }
      
      console.log(`[sync-emails/attachments] Downloaded ${content.length} bytes for ${attachment.filename}`);
      
      // Upload to storage
      const timestamp = Date.now();
      const safeName = attachment.filename.replace(/[^a-zA-Z0-9.-]/g, '_');
      const storagePath = `email-attachments/${emailId}/${timestamp}_${safeName}`;
      
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(storagePath, content, {
          contentType: attachment.contentType,
          upsert: true
        });
      
      if (uploadError) {
        failed = true;
        console.error(`[sync-emails/attachments] Upload failed for ${attachment.filename}:`, uploadError.message);
        // Still insert the record without storage_path
        const { error: insertError } = await supabase
          .from('email_attachments')
          .insert({
            email_id: emailId,
            filename: attachment.filename,
            content_type: attachment.contentType,
            size: content.length,
            storage_path: null,
            is_analyzed: false,
          });
        if (insertError) {
          console.warn(`[sync-emails/attachments] Insert error (no storage):`, insertError.message);
        }
        continue;
      }
      
      console.log(`[sync-emails/attachments] Uploaded to storage: ${storagePath}`);
      
      // Insert attachment record with storage_path
      const { error: insertError } = await supabase
        .from('email_attachments')
        .insert({
          email_id: emailId,
          filename: attachment.filename,
          content_type: attachment.contentType,
          size: content.length,
          storage_path: storagePath,
          is_analyzed: false,
        });
      
      if (insertError) {
        failed = true;
        console.error(`[sync-emails/attachments] Insert error:`, insertError.message);
      } else {
        console.log(`[sync-emails/attachments] Recorded attachment: ${attachment.filename}`);
      }
    } catch (attError) {
      failed = true;
      console.error(`[sync-emails/attachments] Error processing ${attachment.filename}:`, attError);
      // Non-blocking: continue with next attachment
    }
  }
  if (failed) throw new Error("Import des pièces jointes incomplet");
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

// Intelligent HTML sanitization: remove base64/cid images, scripts, styles, inline styles
// Preserves text content useful for threading, quotation detection, and AI extraction
function sanitizeHtml(html: string): string {
  if (!html) return '';
  return html
    // Remove base64 inline images (major memory offender)
    .replace(/<img[^>]+src=["']data:image\/[^"']+["'][^>]*>/gi, '')
    // Remove cid embedded images
    .replace(/<img[^>]+src=["']cid:[^"']+["'][^>]*>/gi, '')
    // Remove script blocks
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    // Remove style blocks
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    // Remove inline style attributes
    .replace(/\sstyle=["'][^"']*["']/gi, '')
    // Collapse whitespace
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
    { regex: /ref[:\s]+([A-Z0-9/-]{4,20})/i, weight: 7 },
    { regex: /référence[:\s]+([A-Z0-9/-]{4,20})/i, weight: 7 },
    
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

// Resolve only the proven root; never adopt a legacy/unknown root by subject.
async function findExistingThread(supabase: any, rootMessageId: string) {
  const { data, error } = await supabase.from('email_threads')
    .select('id, project_name, root_message_id').eq('root_message_id', rootMessageId).maybeSingle();
  if (error) throw new Error("Lecture du fil impossible");
  return data;
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

// ============ P0.1/P0.2 — QUALIFICATION STRICTE RFQ CLIENT ============

// Seuil de mots-clés cotation pour un fil (aligné sur isQuotationRelated: >= 2)
const THREAD_QUOTATION_KEYWORD_THRESHOLD = 2;

// Sous-ensemble de mots-clés exprimant une DEMANDE explicite (vs vocabulaire
// logistique générique présent aussi dans le marketing / les offres fournisseurs)
const RFQ_REQUEST_KEYWORDS = [
  'demande de cotation', 'request for quotation', 'rfq',
  'demande de devis', 'request for quote',
  'demande de prix', 'price request', 'pricing request',
  'besoin de cotation', 'need a quote', 'quote request',
  'transit request', 'trucking request', 'transport request',
];

// Rôles known_business_contacts qui ne peuvent PAS représenter un client RFQ
const NON_CLIENT_RFQ_ROLES = ['supplier', 'partner', 'agent', 'internal'];

// Détecter une adresse interne/SODATRA (cohérent avec determineThreadRoles)
function isSodatraAddress(email: string): boolean {
  return (email || '').toLowerCase().includes('@sodatra');
}

// Helper PUR (sans dépendance DB) : ce fil représente-t-il une demande de
// cotation CLIENT défendable ? S'appuie sur le sujet normalisé, les emails du
// fil et les rôles déjà résolus (threadRoles). Aucune lecture DB.
function isLikelyClientRfqThread(
  normalizedSubject: string,
  threadEmails: EmailRecord[],
  threadRoles: Pick<ThreadRoles, 'clientEmail' | 'partnerEmail' | 'ourRole' | 'participants'>
): boolean {
  if (!threadEmails || threadEmails.length === 0) return false;

  // Texte agrégé : sujet normalisé + sujets/corps disponibles du fil
  const aggregateText = [
    normalizedSubject || '',
    ...threadEmails.map(e => `${e.subject || ''} ${e.body_text || ''}`),
  ].join(' ').toLowerCase();

  // 1. Signal cotation suffisant (seuil strict > 1 mot-clé)
  const keywordCount = QUOTATION_KEYWORDS.filter(kw => aggregateText.includes(kw.toLowerCase())).length;
  if (keywordCount < THREAD_QUOTATION_KEYWORD_THRESHOLD) {
    return false;
  }

  // 2. Direction : le premier email significatif ne doit pas être SODATRA -> externe
  //    (sinon SODATRA est l'acheteur/demandeur, pas le prestataire sollicité)
  const sorted = [...threadEmails].sort(
    (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
  );
  const firstSignificant = sorted.find(e => isValidEmail((e.from_address || '').toLowerCase()));
  if (firstSignificant) {
    const recipients = [
      ...(firstSignificant.to_addresses || []),
      ...(firstSignificant.cc_addresses || []),
    ].map(r => (r || '').toLowerCase());
    const fromSodatra = isSodatraAddress(firstSignificant.from_address);
    const hasExternalRecipient = recipients.some(r => isValidEmail(r) && !isSodatraAddress(r));
    if (fromSodatra && hasExternalRecipient) {
      return false;
    }
  }

  // 3. Une demande entrante adressée à SODATRA par un externe doit exister
  const externalInboundToSodatra = sorted.some(e => {
    const from = (e.from_address || '').toLowerCase();
    if (!isValidEmail(from) || isSodatraAddress(from)) return false;
    const recipients = [
      ...(e.to_addresses || []),
      ...(e.cc_addresses || []),
    ].map(r => (r || '').toLowerCase());
    return recipients.some(r => isSodatraAddress(r));
  });
  if (!externalInboundToSodatra) {
    return false;
  }

  // 4. Un client externe défendable doit exister (rôle non supplier/partner/agent/internal).
  //    On ne promeut JAMAIS un fournisseur/partenaire/agent/interne en client par fallback.
  const participants = threadRoles?.participants || [];
  const defendableParticipant = participants.some(p =>
    !isSodatraAddress(p.email) && !NON_CLIENT_RFQ_ROLES.includes(p.role)
  );
  const clientEmail = (threadRoles?.clientEmail || '').toLowerCase();
  const clientParticipant = participants.find(p => p.email.toLowerCase() === clientEmail);
  const clientEmailDefendable = !!clientEmail
    && !isSodatraAddress(clientEmail)
    && (!clientParticipant || !NON_CLIENT_RFQ_ROLES.includes(clientParticipant.role));
  if (!defendableParticipant && !clientEmailDefendable) {
    return false;
  }

  // 5. Signal de demande défendable :
  //    - une demande explicite (RFQ_REQUEST_KEYWORDS), OU
  //    - un client CONNU (known_business_contacts.default_role = client) expéditeur
  //      avec un signal cotation suffisant (déjà validé en 1).
  //    Cela préserve assist_partner quand un partenaire transmet une demande client
  //    claire (mot-clé explicite présent), tout en rejetant le marketing/spam freight.
  const hasExplicitRequest = RFQ_REQUEST_KEYWORDS.some(kw => aggregateText.includes(kw));
  const hasKnownClientSender = sorted.some(e => {
    const from = (e.from_address || '').toLowerCase();
    const p = participants.find(x => x.email.toLowerCase() === from);
    return !!p && p.isKnown && p.role === 'client';
  });

  return hasExplicitRequest || hasKnownClientSender;
}

// Déterminer si un fil est lié à une demande de cotation CLIENT
function isQuotationThread(
  normalizedSubject: string,
  threadEmails: EmailRecord[],
  threadRoles: Pick<ThreadRoles, 'clientEmail' | 'partnerEmail' | 'ourRole' | 'participants'>
): boolean {
  const subjectLower = normalizedSubject.toLowerCase();

  // Exclure si sujet dans la liste noire des fils (exclusion existante préservée)
  if (EXCLUDED_THREAD_SUBJECTS.some(excl => subjectLower.includes(excl.toLowerCase()))) {
    console.log(`Thread excluded - subject blacklisted: ${normalizedSubject}`);
    return false;
  }

  // Exclure les fils dont TOUS les expéditeurs sont blacklistés (exclusion existante préservée)
  const hasOnlyBlacklistedSenders = threadEmails.length > 0 && threadEmails.every(email => {
    const fromLower = email.from_address.toLowerCase();
    return EXCLUDED_SENDERS.some(sender => fromLower.includes(sender.toLowerCase()));
  });
  if (hasOnlyBlacklistedSenders) {
    console.log(`Thread excluded - all senders blacklisted: ${normalizedSubject}`);
    return false;
  }

  // P0.1/P0.2 : ne classer en cotation que si un signal RFQ client est défendable.
  // (Plus de "return true" par défaut sur les fils douteux.)
  if (isLikelyClientRfqThread(normalizedSubject, threadEmails, threadRoles)) {
    console.log(`Thread included - defendable client RFQ signal: ${normalizedSubject}`);
    return true;
  }

  console.log(`Thread excluded - no defendable client RFQ signal: ${normalizedSubject}`);
  return false;
}

// Exports pour tests ciblés (le serve principal est gardé par SYNC_EMAILS_DISABLE_SERVE)
export { isLikelyClientRfqThread, isQuotationThread };

// Créer ou mettre à jour un fil de discussion
async function upsertEmailThread(
  supabase: any,
  normalizedSubject: string,
  email: EmailRecord,
  knownContacts: KnownBusinessContact[],
  rootMessageId: string,
  configId: string
): Promise<string> {
  const existingThread = await findExistingThread(supabase, rootMessageId);
  const existingThreadEmails: EmailRecord[] = [];
  if (existingThread) {
    // Page the actual linked history. A matching subject or legacy string is insufficient.
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase.from('emails')
        .select('id, email_config_id, thread_id, from_address, to_addresses, cc_addresses, sent_at, subject, body_text')
        .eq('thread_ref', existingThread.id).order('sent_at').order('id').range(offset, offset + 499);
      if (error || !Array.isArray(data)) throw new Error("Lecture du contexte du fil impossible");
      if (data.some((row: { email_config_id: string; thread_id: string }) => row.email_config_id !== configId || row.thread_id !== rootMessageId)) {
        throw new Error("Contexte du fil contradictoire : configuration ou racine différente");
      }
      existingThreadEmails.push(...data);
      if (data.length < 500) break;
    }
  }
  // Collecter tous les emails du fil
  const allEmails = [...existingThreadEmails, email].sort(
    (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
  );
    
  // Déterminer les rôles avec la nouvelle logique
  const threadRoles = await determineThreadRoles(supabase, allEmails, knownContacts);
    
  // Extraire le projet du contenu
  const { projectName } = extractProjectIdentifier(
    normalizedSubject,
    email.body_text || ''
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
    
  // Déterminer si c'est un fil de cotation (gate strict P0.1/P0.2)
  const isQuotation = isQuotationThread(normalizedSubject, allEmails, threadRoles);
    
  const threadData: Record<string, unknown> = {
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
    
  // P1-D: Store root_message_id when available
  if (rootMessageId) {
    threadData.root_message_id = rootMessageId;
  }
    
  console.log(`Thread roles determined: client=${threadRoles.clientEmail}, partner=${threadRoles.partnerEmail}, our_role=${threadRoles.ourRole}, is_quotation=${isQuotation}`);

  if (existingThread) {
    // Mettre à jour le fil existant
    const { error } = await supabase
      .from('email_threads')
      .update(threadData)
      .eq('id', existingThread.id);
    if (error) throw new Error("Mise à jour du fil impossible");
    console.log(`Updated thread ${existingThread.id} for project: ${finalProjectName || normalizedSubject}`);
    return existingThread.id;
  } else {
    // Créer un nouveau fil
    const { data: newThread, error } = await supabase
      .from('email_threads')
      .insert(threadData)
      .select('id')
      .single();
    
    if (error || !newThread?.id) throw new Error("Création du fil impossible");
    console.log(`Created new thread ${newThread?.id} for project: ${finalProjectName || normalizedSubject}`);
    return newThread.id;
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
    const { error: contactError } = await supabase
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
    if (contactError) throw new Error("Enregistrement du contact impossible");
  } catch (error) {
    console.error('Error upserting contact:', error);
    throw error;
  }
}

// Garde testabilité (cohérent avec build-case-puzzle) : permet d'importer ce
// module dans un test sans démarrer le serveur HTTP.
export const handler = async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let client: SimpleIMAPClient | null = null;

  try {
    // Phase S0: Auth guard
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;

    const { configId, limit = 10 } = await req.json();
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("Syncing emails for config:", configId);

    // Charger les contacts connus depuis la DB
    const { data: knownContacts, error: contactsError } = await supabase
      .from('known_business_contacts')
      .select('*')
      .eq('is_active', true);
    
    if (contactsError) throw new Error("Lecture des contacts impossible");
    console.log(`Loaded ${knownContacts?.length || 0} known business contacts`);

    // Get email config
    const { data: config, error: configError } = await supabase
      .from('email_configs')
      .select('id,name,host,port,username,folder,use_ssl,is_active,last_sync_at,created_at')
      .eq('id', configId)
      .single();

    if (configError || !config) {
      throw new Error("Configuration email non trouvée");
    }

    console.log(`Connecting to ${config.host}:${config.port} as ${config.username}`);

    // Create IMAP client - use STARTTLS for better certificate compatibility
    const useStartTls = config.port === 993; // If port 993, try STARTTLS as fallback
    const imapPassword = await readMailboxSecret(supabase, config.id);
    client = new SimpleIMAPClient(
      config.host,
      useStartTls ? 143 : config.port, // Use port 143 for STARTTLS
      config.use_ssl !== false,
      useStartTls
    );

    await client.connect();
    console.log("Connected to IMAP server");

    // Login
    const loggedIn = await client.login(config.username, imapPassword);
    if (!loggedIn) {
      throw new Error("Échec de l'authentification IMAP");
    }
    console.log("Logged in successfully");

    // Select mailbox
    const mailbox = config.folder || 'INBOX';
    const { exists } = await client.select(mailbox);
    console.log(`Mailbox ${mailbox} selected, ${exists} messages`);

    const processedEmails = [];
    // Phase A: Track skipped emails for UX feedback (outside if block for scope)
    let skippedCount = 0;
    const failures: Array<{ uid: number | null; stage: string }> = [];
    
    if (exists > 0) {
      // Fetch last N messages
      const fetchLimit = Math.min(limit, exists);
      const startSeq = Math.max(1, exists - fetchLimit + 1);
      const range = `${startSeq}:${exists}`;
      
      console.log(`Fetching messages ${range}`);
      const headers = await client.fetchHeaders(range);
      console.log(`Got ${headers.length} message headers`);
      if (headers.length !== fetchLimit || new Set(headers.map(m => m.uid)).size !== headers.length) {
        throw new Error("Lot d’en-têtes IMAP incomplet ou ambigu");
      }

      for (const msg of headers) {
        try {
          if (!/^<[^<>\s]+>$/.test(msg.messageId) || /^<\d+@imported>$/.test(msg.messageId)) {
            throw new Error("Message-ID absent ou ambigu : import refusé");
          }

          // Check if email already exists
          const { data: existing, error: existingError } = await supabase
            .from('emails')
            .select('id, email_config_id')
            .eq('message_id', msg.messageId)
            .maybeSingle();

          if (existingError) throw new Error("Lecture des doublons impossible");
          if (existing && existing.email_config_id !== configId) throw new Error("Identité déjà présente dans une autre configuration");
          if (existing) {
            console.log("Email already exists:", msg.messageId);
            skippedCount++;
            continue;
          }

          // Fetch body
          const { text: rawBodyText, html: rawBodyHtml } = await client.fetchBody(msg.uid);
          
          // === Memory fix: intelligent cleanup before storage ===
          const MAX_BODY_TEXT = 50_000;
          const MAX_BODY_HTML = 100_000;
          
          let bodyHtml: string | null = null;
          let bodyText: string | null = null;
          
          if (rawBodyHtml) {
            bodyHtml = sanitizeHtml(rawBodyHtml).substring(0, MAX_BODY_HTML);
            // Always derive bodyText from cleaned HTML for consistency
            bodyText = stripHtml(bodyHtml).substring(0, MAX_BODY_TEXT);
          } else if (rawBodyText) {
            bodyText = rawBodyText.substring(0, MAX_BODY_TEXT);
          }
          
          const isQuotation = isQuotationRelated(msg.from, msg.subject, bodyText || bodyHtml || '');
          const threadId = extractThreadId(msg.messageId, msg.references);
          const normalizedSubject = normalizeSubject(msg.subject);
          if (/^<\d+@imported>$/.test(threadId)) throw new Error("Racine IMAP non prouvée");
          
          // P1-D: Derive rootMessageId for deterministic threading
          const rootMessageId = msg.references
            ? (msg.references.split(/\s+/).filter(Boolean)[0] || msg.messageId)
            : msg.messageId;

          // Only the proven linked history is loaded by upsertEmailThread.
          const emailData: EmailRecord = {
            from_address: msg.from,
            to_addresses: msg.to.length > 0 ? msg.to : [config.username],
            cc_addresses: [] as string[],
            sent_at: parseEmailDate(msg.date),
            body_text: bodyText || '',
          };
          
          // P1-D: Pass rootMessageId to upsertEmailThread
          const threadRefId = await upsertEmailThread(
            supabase,
            normalizedSubject,
            emailData,
            knownContacts || [],
            rootMessageId,
            configId
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
              body_capture_mode: 'sanitized_truncated',
              sent_at: parseEmailDate(msg.date),
              is_quotation_request: isQuotation
            })
            .select()
            .single();

          if (insertError) {
            throw new Error("Enregistrement du courriel impossible");
          }

          // Import attachments (non-blocking)
          try {
            await processEmailAttachments(client, msg.uid, inserted.id, supabase);
          } catch (attachErr) {
            console.error("[sync-emails] Attachment import failed (non-blocking):", attachErr);
            failures.push({ uid: msg.uid, stage: "attachments" });
          }

          // Phase C: Notify existing quote_case of new email (quotation continuity)
          if (inserted.thread_ref) {
            try {
              const { data: existingCase, error: caseReadError } = await supabase
                .from("quote_cases")
                .select("id, status")
                .eq("thread_id", inserted.thread_ref)
                .maybeSingle();

              if (caseReadError) throw new Error("Lecture du dossier impossible");
              if (existingCase) {
                // Statuts qui peuvent être réouverts (attente d'info ou prêt à tarifer)
                const REOPENABLE_STATUSES = ["NEED_INFO", "READY_TO_PRICE", "DECISIONS_PENDING", "DECISIONS_COMPLETE", "ACK_READY_FOR_PRICING"];
                // Statuts figés (devis déjà généré)
                const FROZEN_STATUSES = ["PRICED_DRAFT", "HUMAN_REVIEW", "SENT", "ACCEPTED", "REJECTED", "ARCHIVED"];
                
                const updates: Record<string, unknown> = {
                  last_email_seen_at: new Date().toISOString(),
                  last_activity_at: new Date().toISOString(),
                };
                
                // Réouvrir si en attente d'info (nouvel email = potentielle réponse client)
                if (REOPENABLE_STATUSES.includes(existingCase.status)) {
                  updates.status = "FACTS_PARTIAL"; // Relancer l'analyse puzzle
                }
                
                const { error: caseWriteError } = await supabase
                  .from("quote_cases")
                  .update(updates)
                  .eq("id", existingCase.id);
                if (caseWriteError) throw new Error("Notification du dossier impossible");

                // Log timeline event for traceability
                const { error: timelineError } = await supabase.from("case_timeline_events").insert({
                  case_id: existingCase.id,
                  event_type: "new_email_received",
                  event_data: { 
                    email_id: inserted.id,
                    previous_status: existingCase.status,
                    new_status: updates.status || existingCase.status,
                    was_frozen: FROZEN_STATUSES.includes(existingCase.status)
                  },
                  actor_type: "system",
                });
                if (timelineError) throw new Error("Traçabilité du courriel impossible");

                console.log(`[Phase C] Notified quote_case ${existingCase.id} of new email ${inserted.id} (status: ${existingCase.status} -> ${updates.status || 'unchanged'})`);
              }
            } catch (caseError) {
              console.error("Error notifying quote_case:", caseError);
              failures.push({ uid: msg.uid, stage: "case_notification" });
              // Non-blocking error - continue with import
            }
          }

          processedEmails.push({
            id: inserted.id,
            subject: inserted.subject,
            thread_ref: inserted.thread_ref,
          });
          console.log(`Imported: ${msg.subject.substring(0, 50)}... (thread: ${threadRefId || 'none'})`);
        } catch (msgError) {
          console.error("Error processing message:", msgError);
          failures.push({ uid: msg.uid, stage: "message" });
        }
      }
    }

    // Logout
    await client.logout();
    client = null;

    // Update last sync time
    if (failures.length === 0) {
      const { error: syncError } = await supabase
        .from('email_configs')
        .update({ last_sync_at: new Date().toISOString() })
        .eq('id', configId);
      if (syncError) failures.push({ uid: null, stage: "sync_timestamp" });
    }

    console.log(`Synced ${processedEmails.length} new emails, ${skippedCount} skipped`);

    return new Response(
      JSON.stringify({ 
        success: failures.length === 0,
        partial: failures.length > 0,
        failed: new Set(failures.map(f => f.uid).filter(uid => uid !== null)).size,
        failures,
        error: failures.length ? "Synchronisation incomplète : certaines étapes ont échoué ; des écritures partielles peuvent subsister" : undefined,
        synced: processedEmails.length,
        skipped: skippedCount,
        message: skippedCount > 0 
          ? `${processedEmails.length} nouveaux, ${skippedCount} ignorés (déjà présents)`
          : null,
        emails: processedEmails
      }),
      { status: failures.length ? 503 : 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
};
if (Deno.env.get("SYNC_EMAILS_DISABLE_SERVE") !== "1" && Deno.env.get("MAIL_FUNCTION_DISABLE_SERVE") !== "1") serve(handler);
