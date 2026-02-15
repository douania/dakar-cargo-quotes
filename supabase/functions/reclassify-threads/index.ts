import { requireAdmin } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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
  'bank transfer', 'virement bancaire', 'relevé de compte',
  'invitation', 'conference', 'webinar', 'summit', 'meet global',
  'bouquet', 'offre spéciale', 'special offer', 'promo ',
  'black friday', 'soldes', 'flash sale', 'limited time',
  'your daily', 'daily digest', 'weekly report',
  'say it with', 'parfait', 'official invitation'
];

function cleanSpamPrefix(subject: string): string {
  return (subject || '')
    .replace(/^Spam:\**,?\s*/i, '')
    .replace(/^\[Spam\]\s*/i, '')
    .replace(/^\*+Spam\*+:?\s*/i, '')
    .trim();
}

const EXCLUDED_DOMAINS = [
  'linkedin.com', 'facebook.com', 'twitter.com', 'newsletter',
  'noreply', 'no-reply', 'mailer-daemon', 'postmaster',
  'support@', 'info@', 'notification@', 'alert@'
];

const MARKETING_TLDS = ['shop', 'vip', 'store', 'promo', 'deals', 'sale'];

function isSpam(subject: string, fromAddress?: string): boolean {
  const cleanedSubject = cleanSpamPrefix(subject);
  const subjectLower = cleanedSubject.toLowerCase();
  const fromLower = (fromAddress || '').toLowerCase();
  
  if (!fromAddress || fromLower.trim() === '' || fromLower === 'unknown@unknown.com') {
    return true;
  }
  
  if (SPAM_INDICATORS_HARD.some(spam => subjectLower.includes(spam))) {
    return true;
  }
  
  if (EXCLUDED_DOMAINS.some(domain => fromLower.includes(domain))) {
    return true;
  }
  
  const senderDomain = extractDomain(fromLower);
  if (MARKETING_TLDS.some(tld => senderDomain.endsWith(tld))) {
    return true;
  }
  
  return false;
}

// ============ QUOTATION DETECTION ============

const QUOTATION_KEYWORDS = [
  'cotation', 'devis', 'offre de prix', 'proposition commerciale',
  'demande de prix', 'tarif', 'tarification', 'estimation',
  'quotation', 'quote', 'rate request', 'rfq', 'freight inquiry',
  'pricing request', 'cost estimate', 'rate inquiry', 'tender',
  'fret', 'freight', 'shipping', 'transport', 'logistics',
  'container', 'conteneur', 'breakbulk', 'roro', 'fcl', 'lcl',
  'port of loading', 'port of discharge', 'pol', 'pod',
  'incoterm', 'fob', 'cif', 'cfr', 'exw', 'dap', 'ddp',
  'minusca', 'minusma', 'unmiss', 'monusco', 'un mission',
  'peacekeeping', 'humanitarian', 'project cargo'
];

function isQuotationRelated(email: Email): boolean {
  const fromLower = (email.from_address || '').toLowerCase();
  
  if (!email.from_address || fromLower.trim() === '' || fromLower === 'unknown@unknown.com') {
    return false;
  }
  
  const subjectLower = cleanSpamPrefix(email.subject || '').toLowerCase();
  const bodyLower = (email.body_text || '').substring(0, 3000).toLowerCase();
  const combined = `${subjectLower} ${bodyLower}`;
  
  const keywordMatches = QUOTATION_KEYWORDS.filter(kw => combined.includes(kw));
  
  return keywordMatches.length >= 2;
}

// ============ SUBJECT NORMALIZATION ============

function normalizeSubject(subject: string): string {
  let cleaned = cleanSpamPrefix(subject);
  
  let prev = '';
  while (prev !== cleaned) {
    prev = cleaned;
    cleaned = cleaned
      .replace(/^(re:|fw:|fwd:|tr:|aw:|wg:|r:|転送:|回复:|antw:|\[external\]|\(sans sujet\))\s*/gi, '')
      .trim();
  }
  
  return cleaned.toLowerCase();
}

// ============ PROJECT NAME EXTRACTION ============

const PROJECT_PATTERNS = [
  /\b(MINUSCA|MINUSMA|UNMISS|MONUSCO|MINURSO|UNFICYP|UNDOF|UNIFIL|UNMIK)\b/i,
  /Youth\s+Olympic\s+Games\s+\d{4}/i,
  /\b(RAL\d+|REF[:\s]\s*\w+|RFPS[:\s]\s*\w+|RFQ[:\s]\s*\w+)/i,
  /(?:Projet|Project|Tender|AO)[:\s]\s*([^,.\n]+)/i,
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
  if (email.thread_id && !email.thread_id.includes('@imported')) {
    return email.thread_id;
  }
  return null;
}

function groupEmailsByThread(emails: Email[]): Map<string, ThreadGroup> {
  const threadGroups = new Map<string, ThreadGroup>();
  
  const sortedEmails = [...emails].sort(
    (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
  );
  
  for (const email of sortedEmails) {
    let threadKey: string | null = null;
    
    const threadRef = extractThreadReference(email);
    if (threadRef) {
      const emailDate = new Date(email.sent_at);
      for (const [key, group] of threadGroups) {
        const hasMatchingRef = group.emails.some(e => 
          extractThreadReference(e) === threadRef || e.message_id === threadRef
        );
        if (hasMatchingRef) {
          // Temporal guard: don't merge if more than 90 days apart
          const timeDiff = Math.abs(emailDate.getTime() - group.lastMessageAt.getTime());
          if (timeDiff > 90 * 24 * 60 * 60 * 1000) {
            console.log(`Thread ref match but ${Math.round(timeDiff / 86400000)}d apart, splitting: ${email.subject}`);
            continue;
          }
          threadKey = key;
          break;
        }
      }
    }
    
    if (!threadKey) {
      const projectName = extractProjectName(email.subject || '', email.body_text || '');
      if (projectName) {
        for (const [key, group] of threadGroups) {
          if (group.projectName && 
              group.projectName.toLowerCase() === projectName.toLowerCase()) {
            threadKey = key;
            break;
          }
        }
      }
    }
    
    if (!threadKey) {
      const normalizedSubj = normalizeSubject(email.subject || '');
      if (normalizedSubj.length > 10) {
        const emailDate = new Date(email.sent_at);
        const emailParticipants = new Set(
          [
            String(email.from_address || '').toLowerCase().trim(),
            ...(email.to_addresses || []).map(e => String(e || '').toLowerCase().trim()),
            ...(email.cc_addresses || []).map(e => String(e || '').toLowerCase().trim())
          ].filter(Boolean)
        );
        
        for (const [key, group] of threadGroups) {
          if (group.normalizedSubject !== normalizedSubj) continue;
          
          const timeDiff = Math.abs(emailDate.getTime() - group.lastMessageAt.getTime());
          if (timeDiff > 7 * 24 * 60 * 60 * 1000) continue;
          
          const groupParticipants = new Set<string>();
          for (const e of group.emails) {
            const f = String(e.from_address || '').toLowerCase().trim();
            if (f) groupParticipants.add(f);
            (e.to_addresses || []).forEach(addr => { const v = String(addr || '').toLowerCase().trim(); if (v) groupParticipants.add(v); });
            (e.cc_addresses || []).forEach(addr => { const v = String(addr || '').toLowerCase().trim(); if (v) groupParticipants.add(v); });
          }
          
          const overlap = [...emailParticipants].filter(p => groupParticipants.has(p));
          if (overlap.length >= 1) {
            threadKey = key;
            break;
          }
        }
      }
    }
    
    if (!threadKey) {
      threadKey = email.id;
      threadGroups.set(threadKey, {
        emails: [],
        normalizedSubject: normalizeSubject(email.subject || ''),
        projectName: extractProjectName(email.subject || '', email.body_text || ''),
        firstMessageAt: new Date(email.sent_at),
        lastMessageAt: new Date(email.sent_at)
      });
    }
    
    const group = threadGroups.get(threadKey)!;
    group.emails.push(email);
    
    const emailDate = new Date(email.sent_at);
    if (emailDate < group.firstMessageAt) group.firstMessageAt = emailDate;
    if (emailDate > group.lastMessageAt) group.lastMessageAt = emailDate;
    
    if (!group.projectName) {
      group.projectName = extractProjectName(email.subject || '', email.body_text || '');
    }
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

interface ExistingThread {
  id: string;
  subject_normalized: string;
  project_name: string | null;
  participants: string[] | null;
  first_message_at: string | null;
  last_message_at: string | null;
  email_count: number | null;
  is_quotation_thread: boolean | null;
}

function normalizeParticipants(participants: string[] | null | undefined): string[] {
  return (participants || [])
    .filter(Boolean)
    .map((p) => String(p || '').toLowerCase().trim())
    .filter(Boolean)
    .filter((p) => p.includes('@'));
}

function findMatchingThread(group: ThreadGroup, existingThreads: ExistingThread[]): ExistingThread | null {
  const normalizedSubject = (group.normalizedSubject || '').trim().toLowerCase();
  const normalizedProject = (group.projectName || '').trim().toLowerCase();
  const groupParticipants = new Set(
    group.emails.flatMap((email) => [
      email.from_address,
      ...(email.to_addresses || []),
      ...(email.cc_addresses || []),
    ].map((v) => String(v || '').toLowerCase().trim()).filter(Boolean)),
  );

  let best: { thread: ExistingThread; score: number } | null = null;

  for (const thread of existingThreads) {
    let score = 0;

    if ((thread.subject_normalized || '').trim().toLowerCase() === normalizedSubject && normalizedSubject.length > 0) {
      score += 5;
    }

    if ((thread.project_name || '').trim().toLowerCase() === normalizedProject && normalizedProject.length > 0) {
      score += 4;
    }

    const participants = normalizeParticipants(thread.participants);
    const overlapCount = participants.filter((p) => groupParticipants.has(p)).length;
    if (overlapCount > 0) score += Math.min(overlapCount, 3);

    if (thread.last_message_at) {
      const diffMs = Math.abs(new Date(thread.last_message_at).getTime() - group.lastMessageAt.getTime());
      if (diffMs <= 30 * 24 * 60 * 60 * 1000) score += 1;
    }

    if (score < 5) continue;
    if (!best || score > best.score) {
      best = { thread, score };
    }
  }

  return best?.thread || null;
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
  const { data: knownContacts } = await supabase
    .from('known_business_contacts')
    .select('*')
    .eq('is_active', true);
  
  const contacts = knownContacts || [];
  
  const participantsSet = new Set<string>();
  const roleMap = new Map<string, string>();
  
  for (const email of emails) {
    const allAddresses = [
      email.from_address,
      ...(email.to_addresses || []),
      ...(email.cc_addresses || [])
    ].filter(Boolean);
    
    for (const addr of allAddresses) {
      const cleaned = String(addr || '').toLowerCase().trim();
      if (cleaned && cleaned.includes('@')) {
        participantsSet.add(cleaned);
        
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
  
  let clientEmail: string | null = null;
  let partnerEmail: string | null = null;
  
  for (const [email, role] of roleMap) {
    if (role === 'partner' && !partnerEmail) {
      partnerEmail = email;
    }
  }
  
  const sortedEmails = [...emails].sort(
    (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
  );
  
  for (const email of sortedEmails) {
    const senderEmail = String(email.from_address || '').toLowerCase();
    const role = roleMap.get(senderEmail);
    
    if (!role || (role !== 'internal' && role !== 'partner' && role !== 'supplier')) {
      if (!senderEmail.includes('@sodatra')) {
        clientEmail = senderEmail;
        break;
      }
    }
  }
  
  let ourRole: 'direct_quote' | 'assist_partner' = 'direct_quote';
  
  if (partnerEmail) {
    const clientContactedSodatraDirectly = sortedEmails.some(email => {
      const senderEmail = String(email.from_address || '').toLowerCase();
      if (senderEmail !== clientEmail) return false;
      
      const allRecipients = [
        ...(email.to_addresses || []),
        ...(email.cc_addresses || [])
      ].map(e => String(e || '').toLowerCase());
      
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    // Phase S0: Admin-only auth guard (destructive-capable operation)
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const since = typeof body.since === 'string' ? body.since : null;
    const onlyUnthreaded = body.only_unthreaded !== false;
    const destructiveRebuild = body.destructive_rebuild === true;
    const reclassifyAll = body.reclassify_all === true;
    const requestedLimit = Number(body.limit || 2000);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(5000, Math.floor(requestedLimit)))
      : 2000;

    if (destructiveRebuild) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'destructive_rebuild is disabled in v2; use incremental non-destructive mode only',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    
    console.log(
      `=== RECLASSIFY THREADS V2 (admin=${auth.user.email || auth.user.id}, dry_run=${dryRun}, since=${since || 'none'}, only_unthreaded=${onlyUnthreaded}, reclassify_all=${reclassifyAll}, limit=${limit}) ===`,
    );
    
    // 1. Incremental fetch of candidate emails
    let emailsQuery = supabase
      .from('emails')
      .select('id, from_address, to_addresses, cc_addresses, subject, body_text, sent_at, message_id, thread_id, thread_ref, is_quotation_request')
      .order('sent_at', { ascending: true })
      .limit(limit);

    if (since) {
      emailsQuery = emailsQuery.gte('sent_at', since);
    }

    if (!reclassifyAll && onlyUnthreaded) {
      emailsQuery = emailsQuery.is('thread_ref', null);
    }

    const { data: emails, error: emailsError } = await emailsQuery;
    
    if (emailsError) {
      throw new Error(`Failed to fetch emails: ${emailsError.message}`);
    }
    
    console.log(`Found ${emails.length} candidate emails to process`);
    
    // 2. Clean spam emails (using improved detection)
    const spamEmails = emails.filter(e => isSpam(e.subject || '', e.from_address));
    const validEmails = emails.filter(e => !isSpam(e.subject || '', e.from_address));
    
    console.log(`Spam emails: ${spamEmails.length}, Valid: ${validEmails.length}`);
    
    // 3. Update quotation status for valid emails using improved detection
    let quotationUpdates = 0;
    if (!dryRun) {
      const toTrueIds: string[] = [];
      const toFalseIds: string[] = [];

      for (const email of validEmails) {
        const shouldBeQuotation = isQuotationRelated(email);
        if (shouldBeQuotation === email.is_quotation_request) continue;
        if (shouldBeQuotation) toTrueIds.push(email.id);
        else toFalseIds.push(email.id);
      }

      if (toTrueIds.length > 0) {
        const { error } = await supabase
          .from('emails')
          .update({ is_quotation_request: true })
          .in('id', toTrueIds);
        if (error) throw new Error(`Failed updating quotation=true flags: ${error.message}`);
      }

      if (toFalseIds.length > 0) {
        const { error } = await supabase
          .from('emails')
          .update({ is_quotation_request: false })
          .in('id', toFalseIds);
        if (error) throw new Error(`Failed updating quotation=false flags: ${error.message}`);
      }

      quotationUpdates = toTrueIds.length + toFalseIds.length;
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
    
    // 5. Load existing threads (non-destructive reconciliation)
    const { data: existingThreadsData, error: existingThreadsError } = await supabase
      .from('email_threads')
      .select('id, subject_normalized, project_name, participants, first_message_at, last_message_at, email_count, is_quotation_thread')
      .order('last_message_at', { ascending: false })
      .limit(5000);

    if (existingThreadsError) {
      throw new Error(`Failed to load existing threads: ${existingThreadsError.message}`);
    }

    const existingThreads: ExistingThread[] = existingThreadsData || [];
    
    // 6. Create/Update email_threads and link emails
    const stats = {
      threadsCreated: 0,
      threadsUpdated: 0,
      emailsLinked: 0,
      groupsMatchedToExisting: 0,
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
      
      let thread = findMatchingThread(group, existingThreads);

      if (dryRun) {
        const action = thread ? 'update/match' : 'create';
        console.log(`[DRY RUN] Would ${action} thread: ${group.normalizedSubject.substring(0, 50)}... (${group.emails.length} emails)`);
        continue;
      }

      if (!thread) {
        const { data: insertedThread, error: threadError } = await supabase
          .from('email_threads')
          .insert(threadData)
          .select('id, subject_normalized, project_name, participants, first_message_at, last_message_at, email_count, is_quotation_thread')
          .single();

        if (threadError || !insertedThread) {
          console.error(`Failed to create thread: ${threadError?.message || 'unknown error'}`);
          continue;
        }

        thread = insertedThread;
        existingThreads.push(insertedThread);
        stats.threadsCreated++;
      } else {
        stats.groupsMatchedToExisting++;

        const mergedParticipants = Array.from(new Set([
          ...normalizeParticipants(thread.participants),
          ...roles.participants.map((p) => String(p || '').toLowerCase().trim()).filter(Boolean),
        ]));

        const firstMessageAt = thread.first_message_at
          ? new Date(Math.min(new Date(thread.first_message_at).getTime(), group.firstMessageAt.getTime())).toISOString()
          : group.firstMessageAt.toISOString();
        const lastMessageAt = thread.last_message_at
          ? new Date(Math.max(new Date(thread.last_message_at).getTime(), group.lastMessageAt.getTime())).toISOString()
          : group.lastMessageAt.toISOString();

        const { error: updateThreadError } = await supabase
          .from('email_threads')
          .update({
            project_name: thread.project_name || group.projectName,
            client_email: roles.clientEmail,
            client_company: roles.clientCompany,
            partner_email: roles.partnerEmail,
            our_role: roles.ourRole,
            participants: mergedParticipants,
            first_message_at: firstMessageAt,
            last_message_at: lastMessageAt,
            is_quotation_thread: (thread.is_quotation_thread || false) || isQuotationThread,
            status: 'active',
          })
          .eq('id', thread.id);

        if (updateThreadError) {
          console.error(`Failed to update existing thread ${thread.id}: ${updateThreadError.message}`);
        } else {
          thread.participants = mergedParticipants;
          thread.first_message_at = firstMessageAt;
          thread.last_message_at = lastMessageAt;
          thread.is_quotation_thread = (thread.is_quotation_thread || false) || isQuotationThread;
          stats.threadsUpdated++;
        }
      }
      
      // Link emails to thread
      const emailIds = group.emails
        .filter((e) => e.thread_ref !== thread.id)
        .map((e) => e.id);
      if (emailIds.length === 0) continue;

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
    
    console.log(`=== RECLASSIFICATION COMPLETE ===`);
    console.log(`Threads created: ${stats.threadsCreated}`);
    console.log(`Emails linked: ${stats.emailsLinked}`);
    console.log(`Spam marked: ${stats.spamMarked}`);
    
    return new Response(
      JSON.stringify({
        success: true,
        mode: 'incremental_non_destructive_v2',
        dry_run: dryRun,
        filters: {
          since,
          only_unthreaded: onlyUnthreaded,
          limit,
        },
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
