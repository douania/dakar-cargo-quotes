import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============ TYPES ============

interface Email {
  id: string;
  from_address: string;
  to_addresses: string[];
  cc_addresses: string[];
  subject: string | null;
  body_text: string | null;
  sent_at: string;
  message_id: string;
  thread_id: string | null;
  thread_ref: string | null;
  is_quotation_request: boolean;
}

interface ThreadGroup {
  emails: Email[];
  normalizedSubject: string;
  projectName: string | null;
  firstMessageAt: Date;
  lastMessageAt: Date;
}

// ============ SPAM DETECTION ============
// Note: 'spam:' prefix from Outlook is handled specially - it's often legitimate business email
// marked by Outlook but containing valid quotation requests

const SPAM_INDICATORS_HARD = [
  // These are always spam, regardless of content
  'notification de credit', 'notification de débit', 'notification de crédit',
  'new login from', 'nouvelle connexion', 'connexion depuis',
  'holiday operating hours', 'membership updates',
  'your daily boat', 'linkedin', 'newsletter',
  'unsubscribe', 'se désabonner', 'désinscrire',
  'daily report', 'rapport journalier', 'weekly digest',
  'password reset', 'reset password', 'mot de passe',
  'verify your email', 'vérifier votre email',
  'out of office', 'absence du bureau', 'automatic reply',
  'delivery status notification', 'undeliverable',
  'meeting reminder', 'calendar invitation',
  'bank transfer', 'virement bancaire', 'relevé de compte'
];

// Clean Outlook spam prefix from subject
function cleanSpamPrefix(subject: string): string {
  return (subject || '')
    .replace(/^Spam:\**,?\s*/i, '')
    .replace(/^\[Spam\]\s*/i, '')
    .replace(/^\*+Spam\*+:?\s*/i, '')
    .trim();
}

// Additional sender domains to always exclude
const EXCLUDED_DOMAINS = [
  'linkedin.com', 'facebook.com', 'twitter.com', 'newsletter',
  'noreply', 'no-reply', 'mailer-daemon', 'postmaster',
  'support@', 'info@', 'notification@', 'alert@'
];

function isSpam(subject: string, fromAddress?: string): boolean {
  // Clean spam prefix first - the presence of "Spam:" alone doesn't mean it's spam
  const cleanedSubject = cleanSpamPrefix(subject);
  const subjectLower = cleanedSubject.toLowerCase();
  const fromLower = (fromAddress || '').toLowerCase();
  
  // Check hard spam indicators (these are always spam)
  if (SPAM_INDICATORS_HARD.some(spam => subjectLower.includes(spam))) {
    return true;
  }
  
  // Check sender domain
  if (EXCLUDED_DOMAINS.some(domain => fromLower.includes(domain))) {
    return true;
  }
  
  return false;
}

// ============ QUOTATION DETECTION ============

const QUOTATION_KEYWORDS = [
  // French
  'cotation', 'devis', 'offre de prix', 'proposition commerciale',
  'demande de prix', 'tarif', 'tarification', 'estimation',
  // English
  'quotation', 'quote', 'rate request', 'rfq', 'freight inquiry',
  'pricing request', 'cost estimate', 'rate inquiry', 'tender',
  // Logistics specific
  'fret', 'freight', 'shipping', 'transport', 'logistics',
  'container', 'conteneur', 'breakbulk', 'roro', 'fcl', 'lcl',
  'port of loading', 'port of discharge', 'pol', 'pod',
  'incoterm', 'fob', 'cif', 'cfr', 'exw', 'dap', 'ddp',
  // Project/Mission keywords
  'minusca', 'minusma', 'unmiss', 'monusco', 'un mission',
  'peacekeeping', 'humanitarian', 'project cargo'
];

function isQuotationRelated(email: Email): boolean {
  const subjectLower = (email.subject || '').toLowerCase();
  const bodyLower = (email.body_text || '').substring(0, 3000).toLowerCase();
  const combined = `${subjectLower} ${bodyLower}`;
  
  // Already marked as quotation request
  if (email.is_quotation_request) return true;
  
  // Check for quotation keywords
  const keywordMatches = QUOTATION_KEYWORDS.filter(kw => combined.includes(kw));
  
  // Need at least 2 keyword matches for confidence
  return keywordMatches.length >= 2;
}

// ============ SUBJECT NORMALIZATION ============

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

// ============ BL/BOOKING REFERENCE EXTRACTION ============

const BL_PATTERNS = [
  /\b(HLCU[A-Z0-9]+)/i,       // Hapag-Lloyd
  /\b(CMAU[A-Z0-9]+)/i,       // CMA CGM
  /\b(MSCU[A-Z0-9]+)/i,       // MSC
  /\b(MAEU[A-Z0-9]+)/i,       // Maersk
  /\b(OOCL[A-Z0-9]+)/i,       // OOCL
  /\bBL\s*[:.]?\s*([A-Z0-9-]{8,})/i,     // Generic BL
  /\bB\/L\s*[:.]?\s*([A-Z0-9-]{8,})/i,   // B/L format
  /\bBKNG\s*[:.]?\s*([A-Z0-9-]{6,})/i,   // Booking
  /\bBooking\s*[:.]?\s*([A-Z0-9-]{6,})/i, // Booking word
];

function extractBLReferences(text: string): string[] {
  const refs: string[] = [];
  for (const pattern of BL_PATTERNS) {
    const matches = text.matchAll(new RegExp(pattern, 'gi'));
    for (const match of matches) {
      const ref = (match[1] || match[0]).toUpperCase().trim();
      if (ref.length >= 6 && !refs.includes(ref)) {
        refs.push(ref);
      }
    }
  }
  return refs;
}

// ============ SUBJECT CHANGE DETECTION ============

// Keywords that indicate cargo type - if these differ, it's likely different operations
const CARGO_KEYWORDS = [
  'quran', 'holy quran', 'coran',
  'dates', 'dattes',
  'reefer', 'refrigerated', 'frigorifique',
  'vehicles', 'véhicules', 'cars', 'voitures', 'trucks', 'camions',
  'machinery', 'machines', 'équipement',
  'containers', 'conteneurs',
  'breakbulk', 'conventionnel',
  'chemicals', 'produits chimiques', 'dangerous', 'dangereux', 'imo',
];

function extractKeywords(text: string): string[] {
  const textLower = (text || '').toLowerCase();
  return CARGO_KEYWORDS.filter(kw => textLower.includes(kw));
}

function detectSubjectChange(subject1: string, subject2: string): { changed: boolean; reason?: string } {
  const norm1 = normalizeSubject(subject1);
  const norm2 = normalizeSubject(subject2);
  
  // If subjects are very similar, no change
  if (norm1 === norm2) {
    return { changed: false };
  }
  
  // Extract cargo keywords from both
  const keywords1 = extractKeywords(subject1);
  const keywords2 = extractKeywords(subject2);
  
  // If one has cargo keywords the other doesn't have, it's different
  const uniqueIn1 = keywords1.filter(k => !keywords2.includes(k));
  const uniqueIn2 = keywords2.filter(k => !keywords1.includes(k));
  
  if (uniqueIn1.length > 0 || uniqueIn2.length > 0) {
    return { 
      changed: true, 
      reason: `Cargo keywords differ: [${uniqueIn1.join(', ')}] vs [${uniqueIn2.join(', ')}]` 
    };
  }
  
  // Check BL references
  const bls1 = extractBLReferences(subject1);
  const bls2 = extractBLReferences(subject2);
  
  if (bls1.length > 0 && bls2.length > 0 && !bls1.some(b => bls2.includes(b))) {
    return { 
      changed: true, 
      reason: `BL references differ: ${bls1.join(', ')} vs ${bls2.join(', ')}` 
    };
  }
  
  // Calculate word overlap
  const words1 = new Set(norm1.split(/\s+/).filter(w => w.length > 3));
  const words2 = new Set(norm2.split(/\s+/).filter(w => w.length > 3));
  
  if (words1.size === 0 || words2.size === 0) {
    return { changed: false };
  }
  
  const overlap = [...words1].filter(w => words2.has(w));
  const overlapRatio = overlap.length / Math.max(words1.size, words2.size);
  
  if (overlapRatio < 0.3) {
    return { 
      changed: true, 
      reason: `Low word overlap: ${Math.round(overlapRatio * 100)}%` 
    };
  }
  
  return { changed: false };
}

// ============ PROJECT NAME EXTRACTION ============

const PROJECT_PATTERNS = [
  // UN Missions
  /\b(MINUSCA|MINUSMA|UNMISS|MONUSCO|MINURSO|UNFICYP|UNDOF|UNIFIL|UNMIK)\b/i,
  // Events
  /Youth\s+Olympic\s+Games\s+\d{4}/i,
  // Reference numbers
  /\b(RAL\d+|REF[:\s]\s*\w+|RFPS[:\s]\s*\w+|RFQ[:\s]\s*\w+)/i,
  // Project names with indicators
  /(?:Projet|Project|Tender|AO)[:\s]\s*([^,.\n]+)/i,
  // Demobilization/Rotation patterns
  /\b(Demobilisation|Demobilization|Rotation|Repatriation|Battalion)\s+\w+/i,
];

function extractProjectName(subject: string, bodyText: string): string | null {
  const text = `${subject || ''} ${(bodyText || '').substring(0, 2000)}`;
  
  for (const pattern of PROJECT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return match[0].trim();
    }
  }
  
  return null;
}

// ============ THREAD GROUPING LOGIC ============

function extractThreadReference(email: Email): string | null {
  // Use thread_id if available (from IMAP References header)
  if (email.thread_id && !email.thread_id.includes('@imported')) {
    return email.thread_id;
  }
  return null;
}

function groupEmailsByThread(emails: Email[]): Map<string, ThreadGroup> {
  const threadGroups = new Map<string, ThreadGroup>();
  const emailToThreadKey = new Map<string, string>();
  
  // Sort emails by date (oldest first)
  const sortedEmails = [...emails].sort(
    (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
  );
  
  for (const email of sortedEmails) {
    let threadKey: string | null = null;
    let shouldSplit = false;
    
    // 1. Try to group by thread_id (References header)
    const threadRef = extractThreadReference(email);
    if (threadRef) {
      // Check if we already have a group with this thread reference
      for (const [key, group] of threadGroups) {
        const hasMatchingRef = group.emails.some(e => 
          extractThreadReference(e) === threadRef || e.message_id === threadRef
        );
        if (hasMatchingRef) {
          // CRITICAL: Check if subject changed significantly (different operation)
          const lastEmail = group.emails[group.emails.length - 1];
          const subjectChange = detectSubjectChange(lastEmail.subject || '', email.subject || '');
          
          if (subjectChange.changed) {
            console.log(`[Thread Split] Detected subject change: ${subjectChange.reason}`);
            shouldSplit = true;
          } else {
            threadKey = key;
          }
          break;
        }
      }
    }
    
    // 2. Check for BL reference - emails with same BL should be grouped
    if (!threadKey && !shouldSplit) {
      const emailBLs = extractBLReferences(`${email.subject || ''} ${(email.body_text || '').substring(0, 2000)}`);
      
      if (emailBLs.length > 0) {
        for (const [key, group] of threadGroups) {
          // Check if any email in group has matching BL
          for (const groupEmail of group.emails) {
            const groupBLs = extractBLReferences(`${groupEmail.subject || ''} ${(groupEmail.body_text || '').substring(0, 500)}`);
            if (groupBLs.some(bl => emailBLs.includes(bl))) {
              threadKey = key;
              console.log(`[Thread Match] BL reference match: ${emailBLs.join(', ')}`);
              break;
            }
          }
          if (threadKey) break;
        }
      }
    }
    
    // 3. Try to group by project name (only if subjects are similar)
    if (!threadKey && !shouldSplit) {
      const projectName = extractProjectName(email.subject || '', email.body_text || '');
      if (projectName) {
        for (const [key, group] of threadGroups) {
          if (group.projectName && 
              group.projectName.toLowerCase() === projectName.toLowerCase()) {
            // Additional check: subjects shouldn't be too different
            const lastEmail = group.emails[group.emails.length - 1];
            const subjectChange = detectSubjectChange(lastEmail.subject || '', email.subject || '');
            
            if (!subjectChange.changed) {
              threadKey = key;
            }
            break;
          }
        }
      }
    }
    
    // 4. Try to group by normalized subject + similar participants within 7 days
    if (!threadKey && !shouldSplit) {
      const normalizedSubj = normalizeSubject(email.subject || '');
      if (normalizedSubj.length > 10) { // Avoid grouping very short subjects
        const emailDate = new Date(email.sent_at);
        const emailParticipants = new Set([
          email.from_address.toLowerCase(),
          ...(email.to_addresses || []).map(e => e.toLowerCase()),
          ...(email.cc_addresses || []).map(e => e.toLowerCase())
        ]);
        
        for (const [key, group] of threadGroups) {
          // Check time proximity (within 7 days)
          const timeDiff = Math.abs(emailDate.getTime() - group.lastMessageAt.getTime());
          if (timeDiff > 7 * 24 * 60 * 60 * 1000) continue;
          
          // Check subject similarity using improved detection
          const subjectChange = detectSubjectChange(group.normalizedSubject, normalizedSubj);
          if (subjectChange.changed) continue;
          
          // Check normalized subject match
          if (group.normalizedSubject !== normalizedSubj) continue;
          
          // Check participant overlap
          const groupParticipants = new Set<string>();
          for (const e of group.emails) {
            groupParticipants.add(e.from_address.toLowerCase());
            (e.to_addresses || []).forEach(addr => groupParticipants.add(addr.toLowerCase()));
            (e.cc_addresses || []).forEach(addr => groupParticipants.add(addr.toLowerCase()));
          }
          
          const overlap = [...emailParticipants].filter(p => groupParticipants.has(p));
          if (overlap.length >= 1) {
            threadKey = key;
            break;
          }
        }
      }
    }
    
    // 5. Create new thread group if no match found or split required
    if (!threadKey || shouldSplit) {
      threadKey = email.id; // Use email ID as thread key
      threadGroups.set(threadKey, {
        emails: [],
        normalizedSubject: normalizeSubject(email.subject || ''),
        projectName: extractProjectName(email.subject || '', email.body_text || ''),
        firstMessageAt: new Date(email.sent_at),
        lastMessageAt: new Date(email.sent_at)
      });
    }
    
    // Add email to group
    const group = threadGroups.get(threadKey)!;
    group.emails.push(email);
    
    // Update group dates
    const emailDate = new Date(email.sent_at);
    if (emailDate < group.firstMessageAt) group.firstMessageAt = emailDate;
    if (emailDate > group.lastMessageAt) group.lastMessageAt = emailDate;
    
    // Update project name if found
    if (!group.projectName) {
      group.projectName = extractProjectName(email.subject || '', email.body_text || '');
    }
    
    emailToThreadKey.set(email.id, threadKey);
  }
  
  return threadGroups;
}

// ============ PARTICIPANT ANALYSIS ============

interface ThreadRoles {
  clientEmail: string | null;
  clientCompany: string | null;
  partnerEmail: string | null;
  ourRole: 'direct_quote' | 'assist_partner';
  participants: string[];
}

function extractDomain(email: string): string {
  const match = email.match(/@([^>]+)$/);
  return match ? match[1].toLowerCase() : '';
}

function extractCompanyFromEmail(email: string): string {
  const match = email.match(/@([^.]+)\./);
  if (match) {
    return match[1].toUpperCase().replace(/-/g, ' ');
  }
  return 'UNKNOWN';
}

async function analyzeThreadRoles(
  supabase: any,
  emails: Email[]
): Promise<ThreadRoles> {
  // Get known contacts
  const { data: knownContacts } = await supabase
    .from('known_business_contacts')
    .select('*')
    .eq('is_active', true);
  
  const contacts = knownContacts || [];
  
  // Collect all participants
  const participantsSet = new Set<string>();
  const roleMap = new Map<string, string>();
  
  for (const email of emails) {
    const allAddresses = [
      email.from_address,
      ...(email.to_addresses || []),
      ...(email.cc_addresses || [])
    ].filter(Boolean);
    
    for (const addr of allAddresses) {
      const cleaned = addr.toLowerCase().trim();
      if (cleaned && cleaned.includes('@')) {
        participantsSet.add(cleaned);
        
        // Check if known contact
        const domain = extractDomain(cleaned);
        for (const contact of contacts) {
          if (domain.includes(contact.domain_pattern) || cleaned.includes(contact.domain_pattern)) {
            roleMap.set(cleaned, contact.default_role);
            break;
          }
        }
      }
    }
  }
  
  // Identify roles
  let clientEmail: string | null = null;
  let partnerEmail: string | null = null;
  
  for (const [email, role] of roleMap) {
    if (role === 'partner' && !partnerEmail) {
      partnerEmail = email;
    }
  }
  
  // Find client (first non-internal, non-partner sender)
  const sortedEmails = [...emails].sort(
    (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
  );
  
  for (const email of sortedEmails) {
    const senderEmail = email.from_address.toLowerCase();
    const role = roleMap.get(senderEmail);
    
    if (!role || (role !== 'internal' && role !== 'partner' && role !== 'supplier')) {
      if (!senderEmail.includes('@sodatra')) {
        clientEmail = senderEmail;
        break;
      }
    }
  }
  
  // Determine our role
  let ourRole: 'direct_quote' | 'assist_partner' = 'direct_quote';
  
  if (partnerEmail) {
    // Check if client contacted SODATRA directly
    const clientContactedSodatraDirectly = sortedEmails.some(email => {
      const senderEmail = email.from_address.toLowerCase();
      if (senderEmail !== clientEmail) return false;
      
      const allRecipients = [
        ...(email.to_addresses || []),
        ...(email.cc_addresses || [])
      ].map(e => e.toLowerCase());
      
      return allRecipients.some(r => r.includes('@sodatra'));
    });
    
    if (!clientContactedSodatraDirectly) {
      ourRole = 'assist_partner';
    }
  }
  
  return {
    clientEmail,
    clientCompany: clientEmail ? extractCompanyFromEmail(clientEmail) : null,
    partnerEmail,
    ourRole,
    participants: Array.from(participantsSet)
  };
}

// ============ MAIN HANDLER ============

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run || false;
    
    console.log(`=== RECLASSIFY THREADS (dry_run: ${dryRun}) ===`);
    
    // 1. Fetch all emails
    const { data: emails, error: emailsError } = await supabase
      .from('emails')
      .select('*')
      .order('sent_at', { ascending: true });
    
    if (emailsError) {
      throw new Error(`Failed to fetch emails: ${emailsError.message}`);
    }
    
    console.log(`Found ${emails.length} emails to process`);
    
    // 2. Clean spam emails (using improved detection)
    const spamEmails = emails.filter(e => isSpam(e.subject || '', e.from_address));
    const validEmails = emails.filter(e => !isSpam(e.subject || '', e.from_address));
    
    console.log(`Spam emails: ${spamEmails.length}, Valid: ${validEmails.length}`);
    
    // 3. Update quotation status for valid emails using improved detection
    let quotationUpdates = 0;
    if (!dryRun) {
      for (const email of validEmails) {
        const shouldBeQuotation = isQuotationRelated(email);
        if (shouldBeQuotation !== email.is_quotation_request) {
          await supabase
            .from('emails')
            .update({ is_quotation_request: shouldBeQuotation })
            .eq('id', email.id);
          quotationUpdates++;
        }
      }
      console.log(`Updated quotation status for ${quotationUpdates} emails`);
    }
    
    if (!dryRun && spamEmails.length > 0) {
      // Mark spam emails as non-quotation
      const spamIds = spamEmails.map(e => e.id);
      await supabase
        .from('emails')
        .update({ is_quotation_request: false })
        .in('id', spamIds);
      
      console.log(`Marked ${spamIds.length} spam emails as non-quotation`);
    }
    
    // 4. Group emails by thread
    const threadGroups = groupEmailsByThread(validEmails);
    console.log(`Created ${threadGroups.size} thread groups`);
    
    // 5. Delete old threads to rebuild fresh
    if (!dryRun) {
      await supabase.from('email_threads').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      console.log('Cleared old threads');
    }
    
    // 6. Create/Update email_threads and link emails
    const stats = {
      threadsCreated: 0,
      threadsUpdated: 0,
      emailsLinked: 0,
      spamMarked: spamEmails.length,
      quotationUpdates
    };
    
    for (const [_key, group] of threadGroups) {
      // Analyze thread roles
      const roles = await analyzeThreadRoles(supabase, group.emails);
      
      // Check if this is a quotation thread (use improved detection)
      const isQuotationThread = group.emails.some(e => isQuotationRelated(e));
      
      // Create thread data
      const threadData = {
        subject_normalized: group.normalizedSubject || 'no-subject',
        project_name: group.projectName,
        client_email: roles.clientEmail,
        client_company: roles.clientCompany,
        partner_email: roles.partnerEmail,
        our_role: roles.ourRole,
        participants: roles.participants,
        email_count: group.emails.length,
        first_message_at: group.firstMessageAt.toISOString(),
        last_message_at: group.lastMessageAt.toISOString(),
        is_quotation_thread: isQuotationThread,
        status: 'active'
      };
      
      if (dryRun) {
        console.log(`[DRY RUN] Would create thread: ${group.normalizedSubject.substring(0, 50)}... (${group.emails.length} emails)`);
        continue;
      }
      
      // Insert thread
      const { data: thread, error: threadError } = await supabase
        .from('email_threads')
        .insert(threadData)
        .select()
        .single();
      
      if (threadError) {
        console.error(`Failed to create thread: ${threadError.message}`);
        continue;
      }
      
      stats.threadsCreated++;
      
      // Link emails to thread
      const emailIds = group.emails.map(e => e.id);
      const { error: linkError } = await supabase
        .from('emails')
        .update({ thread_ref: thread.id })
        .in('id', emailIds);
      
      if (linkError) {
        console.error(`Failed to link emails: ${linkError.message}`);
      } else {
        stats.emailsLinked += emailIds.length;
      }
    }
    
    // 5. Clean old spam threads
    if (!dryRun) {
      const { error: deleteError } = await supabase
        .from('email_threads')
        .delete()
        .ilike('subject_normalized', '%spam%');
      
      if (!deleteError) {
        console.log('Cleaned up spam threads');
      }
    }
    
    console.log(`=== RECLASSIFICATION COMPLETE ===`);
    console.log(`Threads created: ${stats.threadsCreated}`);
    console.log(`Emails linked: ${stats.emailsLinked}`);
    console.log(`Spam marked: ${stats.spamMarked}`);
    
    return new Response(
      JSON.stringify({
        success: true,
        dry_run: dryRun,
        stats,
        message: dryRun 
          ? `Dry run: would create ${threadGroups.size} threads` 
          : `Created ${stats.threadsCreated} threads, linked ${stats.emailsLinked} emails`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Reclassify threads error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
