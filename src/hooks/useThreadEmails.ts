import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ThreadEmail {
  id: string;
  from_address: string;
  to_addresses: string[];
  cc_addresses: string[] | null;
  subject: string | null;
  body_text: string | null;
  sent_at: string | null;
  is_quotation_request: boolean;
  attachmentCount?: number;
}

export interface ThreadWithEmails {
  id: string;
  subject_normalized: string;
  emails: ThreadEmail[];
  client_email: string | null;
  partner_email: string | null;
}

// SODATRA domain patterns for identifying internal emails
const SODATRA_DOMAINS = ['sodatra.sn', 'sodatra.com'];

export function isSodatraEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  return SODATRA_DOMAINS.some(d => domain?.includes(d));
}

export type SenderType = 'internal' | 'client' | 'partner' | 'unknown';

export function getSenderType(
  fromAddress: string, 
  clientEmail: string | null, 
  partnerEmail: string | null
): SenderType {
  const from = fromAddress.toLowerCase();
  
  if (isSodatraEmail(from)) return 'internal';
  if (clientEmail && from.includes(clientEmail.toLowerCase().split('@')[0])) return 'client';
  if (partnerEmail && from.includes(partnerEmail.toLowerCase().split('@')[0])) return 'partner';
  
  // Check domain match for client/partner
  const fromDomain = from.split('@')[1];
  if (clientEmail) {
    const clientDomain = clientEmail.split('@')[1];
    if (fromDomain === clientDomain) return 'client';
  }
  if (partnerEmail) {
    const partnerDomain = partnerEmail.split('@')[1];
    if (fromDomain === partnerDomain) return 'partner';
  }
  
  return 'unknown';
}

export function useThreadEmails(threadId: string | null) {
  return useQuery({
    queryKey: ['thread-emails', threadId],
    queryFn: async (): Promise<ThreadWithEmails | null> => {
      if (!threadId) return null;
      
      // Fetch thread info
      const { data: thread, error: threadError } = await supabase
        .from('email_threads')
        .select('id, subject_normalized, client_email, partner_email')
        .eq('id', threadId)
        .single();
      
      if (threadError) throw threadError;
      if (!thread) return null;
      
      // Fetch all emails in thread
      const { data: emails, error: emailsError } = await supabase
        .from('emails')
        .select(`
          id,
          from_address,
          to_addresses,
          cc_addresses,
          subject,
          body_text,
          sent_at,
          is_quotation_request
        `)
        .eq('thread_ref', threadId)
        .order('sent_at', { ascending: true });
      
      if (emailsError) throw emailsError;
      
      // Fetch attachment counts
      const emailIds = (emails || []).map(e => e.id);
      const { data: attachments } = await supabase
        .from('email_attachments')
        .select('email_id')
        .in('email_id', emailIds);
      
      const attachmentCounts: Record<string, number> = {};
      (attachments || []).forEach(att => {
        if (att.email_id) {
          attachmentCounts[att.email_id] = (attachmentCounts[att.email_id] || 0) + 1;
        }
      });
      
      return {
        ...thread,
        emails: (emails || []).map(e => ({
          ...e,
          attachmentCount: attachmentCounts[e.id] || 0,
        })),
      };
    },
    enabled: !!threadId,
  });
}
